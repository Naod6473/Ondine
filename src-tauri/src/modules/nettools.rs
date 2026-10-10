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
//
// En fond (réglages du module), un thread surveille aussi :
//   - Internet perdu / revenu (Windows le sait déjà, rien n'est envoyé) ;
//   - un VPN qui se coupe ou se branche ;
//   - les serveurs de la liste « Surveiller ces serveurs » (ping ou port,
//     toutes les minutes) : prévient quand l'un ne répond plus, puis revient ;
//   - SEULEMENT si on l'active : l'adresse IP publique, demandée à
//     api.ipify.org toutes les 10 minutes (ce site voit alors ton adresse IP,
//     comme n'importe quel site visité ; rien d'autre ne part) ;
//   - SEULEMENT si on l'active : l'état de Claude, ChatGPT et Gemini, lu sur
//     leurs pages d'état publiques (nettools_ai.rs).

use crate::sync::LockExt;
use std::collections::{BTreeSet, HashMap};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::AppHandle;

use super::nettools_ai::{self as ai, Level, Outage, Reading};
use super::remote::check_host;
use super::{ModuleContext, RustModule};
use crate::services::bus::BusMessage;
use crate::platform;
use crate::services::log;
use crate::services::perf::{self, Loop};

const PING_TIMEOUT_MS: u32 = 1000;
// Windows ne répond pas « fermé » tout de suite : quand un port refuse la
// connexion, il réessaie encore deux fois (environ 2 s en tout). Avec 2 s
// d'attente, un port fermé passait pour « silencieux » (vu sur la machine
// Windows de GitHub). On attend donc un peu plus.
const PORT_TIMEOUT: Duration = Duration::from_secs(4);

const ID: &str = "nettools";
const HOSTS_EVERY: Duration = Duration::from_secs(60);
const PUBLIC_IP_EVERY: Duration = Duration::from_secs(600);
const PUBLIC_IP_URL: &str = "https://api.ipify.org";
/** Au plus tant de serveurs surveillés. */
const MAX_WATCHED: usize = 10;

/// Ce que le thread de fond sait du réseau.
#[derive(Default)]
struct Watch {
    internet: Option<bool>,
    /// Lecture différente de `internet` : il faut la voir deux fois de suite (évite les faux « coupé »).
    internet_pending: Option<bool>,
    vpns: Option<BTreeSet<String>>,
    public_ip: Option<String>,
    /// Pour chaque serveur surveillé : nombre d'échecs d'affilée, et prévenu « en panne ».
    hosts: HashMap<String, (u32, bool)>,
    /// Services IA : le dernier coup d'œil, et les pannes des 7 derniers jours.
    ai: Vec<Reading>,
    ai_history: Option<Vec<Outage>>,
    /// Concentration en cours (Minuteur ou Agents IA) : pas de coup d'œil aux services IA.
    focus: bool,
    quiet: bool,
}

#[derive(Default)]
pub struct NetTools {
    watch: Arc<Mutex<Watch>>,
}

impl RustModule for NetTools {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/nettools/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, watch) = (app.clone(), self.watch.clone());
        std::thread::spawn(move || watch_loop(app, watch));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        ctx.require("network")?;
        if command == "status" {
            // {} → { internet: bool | null, vpns: [noms], publicIp: "…" | null }
            let w = self.watch.locked();
            let vpns: Vec<&String> = w.vpns.iter().flatten().collect();
            return Ok(json!({ "internet": w.internet, "vpns": vpns, "publicIp": w.public_ip }));
        }
        if command == "ai_status" {
            // {} → { services: [{ id, name, level, description, checkedAt }], history: [{ id, from, to, level }] }
            let mut w = self.watch.locked();
            let history = w.ai_history.get_or_insert_with(ai::load_history).clone();
            return Ok(json!({ "services": w.ai, "history": history }));
        }
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

    /// La concentration commence ou finit ("timer.focus", "agents.quiet" {on}) :
    /// pendant ce temps, pas de coup d'œil aux services IA.
    fn on_event(&self, _ctx: &ModuleContext, msg: &BusMessage) {
        let on = msg.payload.get("on").and_then(Value::as_bool).unwrap_or(false);
        match msg.topic.as_str() {
            "timer.focus" => self.watch.locked().focus = on,
            "agents.quiet" => self.watch.locked().quiet = on,
            _ => {}
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

// ── La surveillance en fond ──────────────────────────────────────────────────

fn watch_loop(app: AppHandle, watch: Arc<Mutex<Watch>>) {
    let mut last_hosts: Option<Instant> = None;
    let mut last_ip: Option<Instant> = None;
    let mut last_ai: Option<Instant> = None;
    loop {
        // Toutes les 5 s (3 s en haute, 15 s en éco : services/perf.rs).
        std::thread::sleep(perf::every(Loop::NetWatch));
        if !super::is_active(&app, ID) {
            continue;
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            super::with_context(&app, ID, |ctx| {
                let settings = ctx.settings();
                let on = |key: &str, default: bool| settings.get(key).and_then(Value::as_bool).unwrap_or(default);
                watch_internet(ctx, &watch, on("alertInternet", true));
                watch_vpns(ctx, &watch, on("alertVpn", true));
                if last_hosts.is_none_or(|t| t.elapsed() >= HOSTS_EVERY) {
                    last_hosts = Some(Instant::now());
                    let list = settings.get("watchHosts").and_then(Value::as_str).unwrap_or("");
                    watch_hosts(ctx, &watch, &parse_targets(list));
                }
                if !on("publicIp", false) {
                    watch.locked().public_ip = None;
                    last_ip = None;
                } else if watch.locked().internet != Some(false) && last_ip.is_none_or(|t| t.elapsed() >= PUBLIC_IP_EVERY) {
                    last_ip = Some(Instant::now());
                    watch_public_ip(ctx, &watch);
                }
                if !on("aiStatus", false) {
                    if !watch.locked().ai.is_empty() {
                        watch.locked().ai.clear();
                        ctx.emit("nettools.ai-status", json!({ "services": [], "change": null }));
                    }
                    last_ai = None;
                } else {
                    // En pause pendant une présentation, la concentration, ou Internet coupé.
                    let paused = {
                        let w = watch.locked();
                        w.focus || w.quiet || w.internet == Some(false)
                    } || platform::presentation_busy();
                    if !paused && last_ai.is_none_or(|t| t.elapsed() >= ai::EVERY) {
                        last_ai = Some(Instant::now());
                        watch_ai(ctx, &watch);
                    }
                }
            });
        }));
        if step.is_err() {
            log::warn("réseau : erreur inattendue pendant la surveillance, on continue");
        }
    }
}

fn watch_internet(ctx: &ModuleContext, watch: &Mutex<Watch>, alert: bool) {
    let Some(now) = platform::netwatch::internet() else { return };
    let mut w = watch.locked();
    if w.internet == Some(now) {
        w.internet_pending = None;
        return;
    }
    // Première lecture : on note sans prévenir.
    if w.internet.is_none() {
        w.internet = Some(now);
        return;
    }
    if w.internet_pending != Some(now) {
        w.internet_pending = Some(now);
        return;
    }
    w.internet = Some(now);
    w.internet_pending = None;
    drop(w);
    if alert {
        ctx.emit("nettools.internet", json!({ "up": now }));
    }
}

fn watch_vpns(ctx: &ModuleContext, watch: &Mutex<Watch>, alert: bool) {
    let now: BTreeSet<String> = platform::netwatch::vpns_up().into_iter().collect();
    let mut w = watch.locked();
    let before = w.vpns.replace(now.clone());
    drop(w);
    let Some(before) = before else { return }; // première lecture
    if !alert {
        return;
    }
    for gone in before.difference(&now) {
        ctx.emit("nettools.vpn", json!({ "name": gone, "up": false }));
    }
    for new in now.difference(&before) {
        ctx.emit("nettools.vpn", json!({ "name": new, "up": true }));
    }
}

/// Un coup d'œil aux pages d'état des services IA. Prévient quand une panne
/// commence ou finit (la mascotte grimace, puis soupire de soulagement).
fn watch_ai(ctx: &ModuleContext, watch: &Mutex<Watch>) {
    let at = now_ms();
    let readings: Vec<Reading> = ai::SERVICES.iter().map(|s| ai::fetch(s, at)).collect();
    let mut changes = Vec::new();
    let (history, differs) = {
        let mut w = watch.locked();
        let before: Vec<Reading> = std::mem::take(&mut w.ai);
        let history = w.ai_history.get_or_insert_with(ai::load_history);
        for r in &readings {
            let prev = before.iter().find(|b| b.id == r.id).map(|b| b.level).filter(|l| *l != Level::Unknown);
            if ai::track(history, r.id, prev, r.level, at) {
                changes.push(r.clone());
            }
        }
        let differs = before.len() != readings.len() || before.iter().zip(&readings).any(|(a, b)| a.level != b.level);
        let history = history.clone();
        w.ai = readings.clone();
        (history, differs)
    };
    ai::save_history(&history);
    // Le journal dit seulement quels services ont changé.
    for c in &changes {
        log::info(format!("réseau : service IA {} : {}", c.name, if c.level.bad() { "incident" } else { "rétabli" }));
    }
    if differs || !changes.is_empty() {
        let change = changes.first();
        ctx.emit("nettools.ai-status", json!({ "services": readings, "change": change }));
    }
    if let Some(c) = changes.first() {
        let emotion = if c.level.bad() { "worried" } else { "relieved" };
        ctx.emit("mascot.emote", json!({ "emotion": emotion }));
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Un serveur à surveiller : son nom, et un port (sinon : ping).
#[derive(Debug, PartialEq)]
struct Target {
    host: String,
    port: Option<u16>,
}

/// « serveur1, 192.168.1.10:443 nas.local » → les cibles valides (10 au plus).
fn parse_targets(list: &str) -> Vec<Target> {
    list.split([',', ';', ' ', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|entry| {
            // « [::1]:443 », « nom:443 » (un seul « : »), sinon le nom seul.
            let (host, port) = if let Some(rest) = entry.strip_prefix('[') {
                let (h, after) = rest.split_once(']')?;
                (h.to_string(), after.strip_prefix(':').map(str::to_string))
            } else if entry.matches(':').count() == 1 {
                let (h, p) = entry.split_once(':')?;
                (h.to_string(), Some(p.to_string()))
            } else {
                (entry.to_string(), None)
            };
            let port = match port {
                Some(p) => Some(p.parse::<u16>().ok().filter(|p| *p > 0)?),
                None => None,
            };
            check_host(&host).ok()?;
            Some(Target { host, port })
        })
        .take(MAX_WATCHED)
        .collect()
}

/// Le serveur répond-il ? (port : connexion TCP ; sinon : ping)
fn reachable(t: &Target) -> bool {
    let Ok(addrs) = resolve(&t.host) else { return false };
    match t.port {
        Some(port) => addrs.iter().any(|a| TcpStream::connect_timeout(&SocketAddr::new(a.ip(), port), PORT_TIMEOUT).is_ok()),
        None => addrs.iter().any(|a| match a.ip() {
            IpAddr::V4(v4) => matches!(platform::ping(v4, PING_TIMEOUT_MS), Ok(Some(_))),
            IpAddr::V6(_) => false,
        }),
    }
}

fn label(t: &Target) -> String {
    match t.port {
        Some(p) => format!("{}:{p}", t.host),
        None => t.host.clone(),
    }
}

fn watch_hosts(ctx: &ModuleContext, watch: &Mutex<Watch>, targets: &[Target]) {
    // Les serveurs retirés de la liste sont oubliés.
    let names: Vec<String> = targets.iter().map(label).collect();
    watch.locked().hosts.retain(|k, _| names.contains(k));
    for (t, name) in targets.iter().zip(names) {
        let ok = reachable(t);
        let mut w = watch.locked();
        let entry = w.hosts.entry(name.clone()).or_insert((0, false));
        if ok {
            let was_down = entry.1;
            *entry = (0, false);
            drop(w);
            if was_down {
                ctx.emit("nettools.host", json!({ "host": name, "up": true }));
            }
        } else {
            entry.0 += 1;
            // Deux échecs d'affilée (deux minutes) avant de prévenir.
            if entry.0 >= 2 && !entry.1 {
                entry.1 = true;
                drop(w);
                ctx.emit("nettools.host", json!({ "host": name, "up": false }));
            }
        }
    }
}

fn watch_public_ip(ctx: &ModuleContext, watch: &Mutex<Watch>) {
    let Some(ip) = fetch_public_ip() else { return };
    let mut w = watch.locked();
    let before = w.public_ip.replace(ip.clone());
    drop(w);
    if let Some(before) = before {
        if before != ip {
            ctx.emit("nettools.public-ip", json!({ "ip": ip, "previous": before }));
        }
    }
}

/// Demande l'adresse IP publique à api.ipify.org (réponse : l'adresse, en texte).
fn fetch_public_ip() -> Option<String> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .timeout_global(Some(Duration::from_secs(10)))
        // Jamais en clair, et pas de redirection : la réponse vient d'ipify, en HTTPS.
        .https_only(true)
        .max_redirects(0)
        .build()
        .into();
    let mut resp = agent.get(PUBLIC_IP_URL).call().ok()?;
    let text = resp.body_mut().with_config().limit(256).read_to_string().ok()?;
    // On n'accepte qu'une vraie adresse IP : rien d'autre venant du site n'est utilisé.
    text.trim().parse::<IpAddr>().ok().map(|ip| ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watched_servers_parse() {
        let t = parse_targets("srv1, 192.168.1.10:443 [::1]:22;nas.local:0 -bad mauvais:port");
        assert_eq!(
            t,
            vec![
                Target { host: "srv1".into(), port: None },
                Target { host: "192.168.1.10".into(), port: Some(443) },
                Target { host: "::1".into(), port: Some(22) },
            ]
        );
    }

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
