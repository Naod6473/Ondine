// Module « Réseau » (phase Outils IT) : ping, test de port, DNS.
//
// Trois petits outils de dépannage, sans ouvrir de console :
//   - ping : un écho ICMP (comme ping.exe), le front le répète chaque seconde ;
//   - port : une connexion TCP vers un port ; on distingue « ouvert »,
//     « fermé » (le serveur refuse : il est joignable mais rien n'écoute) et
//     « pas de réponse » (éteint, ou un pare-feu bloque) ;
//   - DNS : le nom → ses adresses, ou une adresse IPv4 → son nom.
//
// Rien d'autre n'est envoyé que ces paquets de test, et seulement vers
// l'adresse tapée. L'adresse est vérifiée comme dans Accès distants, et le
// journal ne la contient pas.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::remote::check_host;
use super::{ModuleContext, RustModule};
use crate::platform;

const PING_TIMEOUT_MS: u32 = 1000;
const PORT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct NetTools;

impl RustModule for NetTools {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/nettools/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        ctx.require("network")?;
        let host = arg_host(&args)?;
        match command {
            // { host } → { ip, ms: null si pas de réponse, ttl }
            "ping" => {
                let ip = resolve(&host)?
                    .into_iter()
                    .find_map(|a| match a.ip() {
                        IpAddr::V4(v4) => Some(v4),
                        IpAddr::V6(_) => None,
                    })
                    .ok_or("ping : seules les adresses IPv4 sont prises en charge pour l'instant")?;
                Ok(match platform::ping(ip, PING_TIMEOUT_MS)? {
                    Some((ms, ttl)) => json!({ "ip": ip.to_string(), "ms": ms, "ttl": ttl }),
                    None => json!({ "ip": ip.to_string(), "ms": null }),
                })
            }
            // { host, port } → { ip, state: "open" | "closed" | "silent", ms }
            "port" => {
                let port = args
                    .get("port")
                    .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())))
                    .filter(|p| (1..=65535).contains(p))
                    .ok_or("le port doit être un nombre entre 1 et 65535")? as u16;
                let addrs = resolve(&host)?;
                let mut last = json!({ "ip": addrs[0].ip().to_string(), "state": "silent" });
                // On essaie au plus deux adresses (IPv4 puis IPv6, souvent).
                for mut addr in addrs.into_iter().take(2) {
                    addr.set_port(port);
                    let start = Instant::now();
                    let state = match TcpStream::connect_timeout(&addr, PORT_TIMEOUT) {
                        Ok(_) => "open",
                        Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => "closed",
                        Err(_) => "silent",
                    };
                    last = json!({ "ip": addr.ip().to_string(), "state": state, "ms": start.elapsed().as_millis() as u64 });
                    if state != "silent" {
                        break;
                    }
                }
                Ok(last)
            }
            // { host } → { names } pour une IPv4, sinon { addrs }
            "dns" => {
                let start = Instant::now();
                if let Ok(ip) = host.parse::<Ipv4Addr>() {
                    let name = platform::reverse_dns(ip);
                    return Ok(json!({ "reverse": true, "names": name.into_iter().collect::<Vec<_>>(), "ms": start.elapsed().as_millis() as u64 }));
                }
                let mut addrs: Vec<String> = Vec::new();
                for a in resolve(&host)? {
                    let ip = a.ip().to_string();
                    if !addrs.contains(&ip) {
                        addrs.push(ip); // Windows donne souvent la même adresse plusieurs fois
                    }
                }
                addrs.sort_by_key(|a| a.contains(':')); // IPv4 d'abord
                Ok(json!({ "reverse": false, "addrs": addrs, "ms": start.elapsed().as_millis() as u64 }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// L'adresse tapée, vérifiée (sans crochets autour d'une IPv6).
fn arg_host(args: &Value) -> Result<String, String> {
    let host = args.get("host").and_then(Value::as_str).unwrap_or("").trim();
    check_host(host)?;
    Ok(host.trim_matches(['[', ']']).to_string())
}

/// Le nom → ses adresses, par le résolveur de Windows (comme le navigateur).
fn resolve(host: &str) -> Result<Vec<SocketAddr>, String> {
    let addrs: Vec<SocketAddr> = (host, 0).to_socket_addrs().map_err(|_| format!("« {host} » est introuvable (DNS)"))?.collect();
    if addrs.is_empty() {
        return Err(format!("« {host} » est introuvable (DNS)"));
    }
    Ok(addrs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_are_checked_and_unbracketed() {
        assert_eq!(arg_host(&json!({ "host": " [::1] " })).unwrap(), "::1");
        assert_eq!(arg_host(&json!({ "host": "srv-01" })).unwrap(), "srv-01");
        assert!(arg_host(&json!({ "host": "-n 5 srv" })).is_err());
        assert!(arg_host(&json!({})).is_err());
    }

    #[test]
    fn ip_literals_resolve_without_dns() {
        assert_eq!(resolve("127.0.0.1").unwrap()[0].ip().to_string(), "127.0.0.1");
    }

    #[test]
    fn closed_local_port_is_reported_closed() {
        // Un port local où rien n'écoute : le PC refuse tout de suite.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
        let err = TcpStream::connect_timeout(&addr, PORT_TIMEOUT).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::ConnectionRefused);
    }
}
