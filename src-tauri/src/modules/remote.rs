// Module « Accès distants » (phase Outils IT) : des favoris Bureau à distance
// (RDP) et SSH, ouverts en un clic depuis l'île ou le lanceur.
//
// Les favoris sont enregistrés dans %APPDATA%\Island\remote.json : un nom,
// le type (rdp / ssh), l'adresse, éventuellement un port et un utilisateur.
// JAMAIS de mot de passe : Windows (mstsc) et ssh gèrent eux-mêmes
// l'authentification.
//
// Sécurité : on ne lance que deux programmes, `mstsc.exe` et `ssh.exe`
// (éventuellement dans Windows Terminal). L'adresse et l'utilisateur sont
// vérifiés caractère par caractère : lettres, chiffres et quelques signes,
// jamais d'espace ni de « - » au début (sinon « -oProxyCommand=… » serait lu
// par ssh comme une option, qui peut lancer une commande). Chaque valeur est
// passée comme UN paramètre séparé, sans passer par un interpréteur.
//
// « Tester » ouvre une simple connexion TCP vers le port (3389 ou 22 par
// défaut) pour savoir si le serveur répond : rien n'est envoyé.

use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::{self, BusMessage};
use crate::services::log;
use crate::services::undo::DEFAULT_WINDOW;

const ID: &str = "remote";
const MAX_FAVORITES: usize = 200;
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Rdp,
    Ssh,
}

impl Kind {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "rdp" => Ok(Self::Rdp),
            "ssh" => Ok(Self::Ssh),
            other => Err(format!("type de connexion inconnu : {other}")),
        }
    }

    fn default_port(self) -> u16 {
        match self {
            Self::Rdp => 3389,
            Self::Ssh => 22,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Favorite {
    id: u64,
    name: String,
    kind: Kind,
    host: String,
    /// Absent = le port habituel (3389 ou 22).
    #[serde(default)]
    port: Option<u16>,
    /// Pour SSH seulement (RDP demande l'utilisateur dans sa propre fenêtre).
    #[serde(default)]
    user: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    #[serde(default)]
    favorites: Vec<Favorite>,
    #[serde(default)]
    next_id: u64,
}

type Shared = Arc<Mutex<Data>>;

#[derive(Default)]
pub struct Remote {
    data: Shared,
}

impl RustModule for Remote {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/remote/manifest.json")
    }

    fn start(&self, _app: &AppHandle) {
        *self.data.lock().unwrap() = load();
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "list" => Ok(json!({ "favorites": self.data.lock().unwrap().favorites })),
            // { id?, name, kind, host, port?, user? } : sans id = nouveau favori.
            "save" => {
                let fav = read_favorite(&args)?;
                let id = {
                    let mut d = self.data.lock().unwrap();
                    match args.get("id").and_then(Value::as_u64) {
                        Some(id) => {
                            let slot = d.favorites.iter_mut().find(|f| f.id == id).ok_or("favori introuvable")?;
                            *slot = Favorite { id, ..fav };
                            id
                        }
                        None => {
                            if d.favorites.len() >= MAX_FAVORITES {
                                return Err(format!("au plus {MAX_FAVORITES} favoris"));
                            }
                            d.next_id += 1;
                            let id = d.next_id;
                            d.favorites.push(Favorite { id, ..fav });
                            id
                        }
                    }
                };
                changed(ctx.app, &self.data);
                Ok(json!({ "id": id }))
            }
            "delete" => {
                let id = arg_id(&args)?;
                let (index, fav) = {
                    let mut d = self.data.lock().unwrap();
                    let index = d.favorites.iter().position(|f| f.id == id).ok_or("favori introuvable")?;
                    (index, d.favorites.remove(index))
                };
                changed(ctx.app, &self.data);
                let (data, app) = (self.data.clone(), ctx.app.clone());
                ctx.offer_undo(
                    "Favori supprimé",
                    DEFAULT_WINDOW,
                    Box::new(move || {
                        {
                            let mut d = data.lock().unwrap();
                            let at = index.min(d.favorites.len());
                            d.favorites.insert(at, fav);
                        }
                        changed(&app, &data);
                        Ok(())
                    }),
                );
                Ok(Value::Null)
            }
            // { id } : un favori ; ou { kind, host, port?, user? } : connexion rapide.
            "connect" => {
                let fav = match args.get("id").and_then(Value::as_u64) {
                    Some(id) => self.find(id)?,
                    None => read_favorite(&json!({ "name": "connexion rapide", "kind": args.get("kind"), "host": args.get("host"), "port": args.get("port"), "user": args.get("user") }))?,
                };
                connect(ctx, &fav)?;
                Ok(Value::Null)
            }
            // { id } → { online, ms } : le port du serveur répond-il ?
            "probe" => {
                ctx.require("network")?;
                let fav = self.find(arg_id(&args)?)?;
                let port = fav.port.unwrap_or(fav.kind.default_port());
                Ok(match probe(&fav.host, port) {
                    Some(ms) => json!({ "online": true, "ms": ms }),
                    None => json!({ "online": false }),
                })
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// "remote.connect" `{id}` : le lanceur demande d'ouvrir un favori.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic != "remote.connect" {
            return;
        }
        let result = msg
            .payload
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| "favori manquant".to_string())
            .and_then(|id| self.find(id))
            .and_then(|fav| connect(ctx, &fav));
        if let Err(e) = result {
            ctx.log_warn(format!("connexion demandée par le lanceur : {e}"));
        }
    }
}

impl Remote {
    fn find(&self, id: u64) -> Result<Favorite, String> {
        let d = self.data.lock().unwrap();
        d.favorites.iter().find(|f| f.id == id).cloned().ok_or_else(|| "favori introuvable".into())
    }
}

// ── Ouvrir la connexion ──────────────────────────────────────────────────────

fn connect(ctx: &ModuleContext, fav: &Favorite) -> Result<(), String> {
    let (program, args) = command_line(fav, &ctx.settings());
    platform::spawn_console(program, &args, &platform::home_dir())?;
    // Le journal dit quel type de connexion, pas vers où (l'adresse reste privée).
    ctx.log_info(format!("ouvre une connexion {}", if fav.kind == Kind::Rdp { "RDP" } else { "SSH" }));
    Ok(())
}

/// Le programme et ses paramètres, un par case (aucun interpréteur au milieu).
fn command_line(fav: &Favorite, settings: &serde_json::Map<String, Value>) -> (&'static str, Vec<String>) {
    match fav.kind {
        Kind::Rdp => {
            // mstsc /v:serveur[:port] ; une IPv6 doit être entre crochets.
            let host = if fav.host.contains(':') { format!("[{}]", fav.host.trim_matches(['[', ']'])) } else { fav.host.clone() };
            let target = match fav.port {
                Some(p) => format!("/v:{host}:{p}"),
                None => format!("/v:{host}"),
            };
            let mut args = vec![target];
            if settings.get("rdpFullscreen").and_then(Value::as_bool) == Some(true) {
                args.push("/f".into());
            }
            ("mstsc.exe", args)
        }
        Kind::Ssh => {
            let mut ssh = vec!["ssh.exe".to_string()];
            if let Some(p) = fav.port {
                ssh.extend(["-p".into(), p.to_string()]);
            }
            if !fav.user.is_empty() {
                ssh.extend(["-l".into(), fav.user.clone()]);
            }
            ssh.push(fav.host.trim_matches(['[', ']']).to_string());
            if settings.get("sshIn").and_then(Value::as_str) == Some("wt") {
                // Windows Terminal : « wt new-tab ssh.exe … ».
                let mut args = vec!["new-tab".to_string()];
                args.extend(ssh);
                ("wt.exe", args)
            } else {
                ("ssh.exe", ssh.split_off(1))
            }
        }
    }
}

/// Le temps (ms) pour que le port accepte une connexion, ou None.
fn probe(host: &str, port: u16) -> Option<u64> {
    let addrs = (host.trim_matches(['[', ']']), port).to_socket_addrs().ok()?;
    for addr in addrs.take(3) {
        let start = Instant::now();
        if TcpStream::connect_timeout(&addr, PROBE_TIMEOUT).is_ok() {
            return Some(start.elapsed().as_millis() as u64);
        }
    }
    None
}

// ── Vérifier ce que l'utilisateur a tapé ─────────────────────────────────────

fn read_favorite(args: &Value) -> Result<Favorite, String> {
    let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let name = text("name");
    let kind = Kind::parse(&text("kind"))?;
    let host = text("host");
    let user = text("user");
    check_host(&host)?;
    if !user.is_empty() {
        check_user(&user)?;
    }
    let port = match args.get("port") {
        None | Some(Value::Null) => None,
        Some(v) => {
            let p = v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).filter(|p| (1..=65535).contains(p));
            match p {
                Some(p) => Some(p as u16),
                None if v.as_str().is_some_and(|s| s.trim().is_empty()) => None,
                None => return Err("le port doit être un nombre entre 1 et 65535".into()),
            }
        }
    };
    let name = if name.is_empty() { host.clone() } else { name.chars().take(60).collect() };
    Ok(Favorite { id: 0, name, kind, host, port, user: if kind == Kind::Ssh { user } else { String::new() } })
}

/// Un nom de serveur (srv-01.domaine.local), une IPv4 ou une IPv6.
fn check_host(host: &str) -> Result<(), String> {
    let ok_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']');
    let first_ok = host.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '[');
    if host.is_empty() || host.len() > 253 || !first_ok || !host.chars().all(ok_char) {
        return Err("adresse invalide : lettres, chiffres, « . », « - » et « : » seulement".into());
    }
    Ok(())
}

/// simon, DOMAINE\simon, simon@domaine.local.
fn check_user(user: &str) -> Result<(), String> {
    let ok_char = |c: char| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '\\' | '@' | '$');
    if user.chars().count() > 100 || user.starts_with('-') || !user.chars().all(ok_char) {
        return Err("utilisateur invalide : pas d'espace, et pas de « - » au début".into());
    }
    Ok(())
}

fn arg_id(args: &Value) -> Result<u64, String> {
    args.get("id").and_then(Value::as_u64).ok_or_else(|| "paramètre « id » manquant".into())
}

// ── Enregistrer ──────────────────────────────────────────────────────────────

/// Enregistre, puis prévient (le lanceur s'en sert) : seulement le numéro, le
/// nom et le type, pas l'adresse.
fn changed(app: &AppHandle, data: &Shared) {
    let list: Vec<Value> = {
        let d = data.lock().unwrap();
        if let Err(e) = save(&d) {
            log::warn(format!("accès distants : enregistrement impossible : {e}"));
        }
        d.favorites.iter().map(|f| json!({ "id": f.id, "name": f.name, "kind": f.kind })).collect()
    };
    bus::emit(app, ID, "remote.changed", json!({ "favorites": list }));
}

fn file() -> PathBuf {
    platform::config_dir().join("remote.json")
}

/// Relit le fichier. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Data {
    let Ok(text) = std::fs::read_to_string(file()) else { return Data::default() };
    match serde_json::from_str::<Data>(&text) {
        Ok(mut d) => {
            // Modifié à la main ? On ne garde que les favoris valides.
            d.favorites.retain(|f| check_host(&f.host).is_ok() && (f.user.is_empty() || check_user(&f.user).is_ok()));
            d.next_id = d.next_id.max(d.favorites.iter().map(|f| f.id).max().unwrap_or(0));
            d
        }
        Err(e) => {
            let aside = platform::config_dir().join(format!("remote.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("accès distants : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Data::default()
        }
    }
}

fn save(d: &Data) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    let tmp = dir.join("remote.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fav(kind: &str, host: &str, port: Value, user: &str) -> Result<Favorite, String> {
        read_favorite(&json!({ "name": "", "kind": kind, "host": host, "port": port, "user": user }))
    }

    #[test]
    fn hosts_are_checked() {
        assert!(check_host("srv-01.domaine.local").is_ok());
        assert!(check_host("192.168.1.10").is_ok());
        assert!(check_host("fe80::1").is_ok());
        assert!(check_host("[2a01:cb00::1]").is_ok());
        // Une option déguisée, des espaces, un séparateur de commande : refusés.
        assert!(check_host("-oProxyCommand=calc").is_err());
        assert!(check_host("srv 01").is_err());
        assert!(check_host("srv;calc").is_err());
        assert!(check_host("").is_err());
    }

    #[test]
    fn users_are_checked() {
        assert!(check_user("simon").is_ok());
        assert!(check_user(r"MAISON\simon").is_ok());
        assert!(check_user("simon@domaine.local").is_ok());
        assert!(check_user("-oProxyCommand=calc").is_err());
        assert!(check_user("simon dupont").is_err());
    }

    #[test]
    fn ports_are_checked() {
        assert_eq!(fav("ssh", "srv", json!("2222"), "").unwrap().port, Some(2222));
        assert_eq!(fav("ssh", "srv", json!(""), "").unwrap().port, None);
        assert!(fav("ssh", "srv", json!(70000), "").is_err());
        assert!(fav("telnet", "srv", Value::Null, "").is_err());
    }

    #[test]
    fn rdp_command_line() {
        let f = fav("rdp", "srv-01", Value::Null, "ignoré").unwrap();
        assert!(f.user.is_empty());
        assert_eq!(command_line(&f, &Default::default()), ("mstsc.exe", vec!["/v:srv-01".to_string()]));
        let f = fav("rdp", "fe80::1", json!(3390), "").unwrap();
        let settings = json!({ "rdpFullscreen": true }).as_object().unwrap().clone();
        assert_eq!(command_line(&f, &settings), ("mstsc.exe", vec!["/v:[fe80::1]:3390".to_string(), "/f".to_string()]));
    }

    #[test]
    fn ssh_command_line() {
        let f = fav("ssh", "srv-01", json!(2222), "admin").unwrap();
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(command_line(&f, &Default::default()), ("ssh.exe", args(&["-p", "2222", "-l", "admin", "srv-01"])));
        let settings = json!({ "sshIn": "wt" }).as_object().unwrap().clone();
        assert_eq!(
            command_line(&f, &settings),
            ("wt.exe", args(&["new-tab", "ssh.exe", "-p", "2222", "-l", "admin", "srv-01"]))
        );
    }
}
