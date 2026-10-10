// Module « Équipe » : les Ondine d'un même réseau local se parlent
// directement, sans serveur, sans Internet, sans compte.
//
// Désactivé par défaut (services/settings.rs, MODULES_OFF_BY_DEFAULT) : tant
// qu'il est éteint, aucun port n'est ouvert et rien ne part.
//
// Le découpage :
//   - team_proto.rs : le protocole (messages, chiffrement Noise, appairage
//     SPAKE2), en code pur testé — c'est là que se joue la sécurité ;
//   - team_net.rs   : les fils de fond (écoute TCP 47821, découverte UDP
//     47820, présence toutes les minutes, envoi et réception des fichiers) ;
//   - ici           : l'état (collègues, demandes en attente, envois), les
//     commandes du front, et ce qu'on fait de chaque message reçu.
//
// Les collègues sont rangés dans %APPDATA%\Ondine\team.json : nom, couleur,
// clé PUBLIQUE, dernière adresse, « mon PC », « IT ». La clé PRIVÉE de ce PC
// est dans le Gestionnaire d'identifiants de Windows (credentials.rs,
// team_identity_*), jamais dans un fichier, jamais dans le front.
//
// Ce qui arrive n'est jamais exécuté. Un fichier, un texte, une demande
// d'aide, une demande de l'IT (état du PC, Bureau à distance) attendent
// « Accepter » (`pending`) ; les fichiers acceptés vont dans
// Téléchargements\Ondine, sans jamais écraser un fichier existant, marqués
// « venus d'ailleurs » (Mark of the Web) pour que Windows prévienne avant de
// les ouvrir.

use crate::sync::LockExt;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::team_net;
use super::team_proto::{self as proto, Hello, Keys, Msg, Report};
use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::BusMessage;
use crate::services::{credentials, files, lan, log};

pub(super) const ID: &str = "team";
/// Au plus 100 collègues, 50 demandes en attente.
const MAX_PEERS: usize = 100;
const MAX_PENDING: usize = 50;
/// Une demande non traitée est oubliée au bout de 30 minutes.
const PENDING_FOR_MS: u64 = 30 * 60 * 1000;
/// Un fichier proposé peut être accepté pendant 10 minutes.
pub(super) const OFFER_FOR: Duration = Duration::from_secs(10 * 60);
/// Le code d'appairage marche 3 minutes, pour un seul essai.
const CODE_FOR: Duration = Duration::from_secs(3 * 60);
/// Un dossier (ou plusieurs fichiers) est zippé en mémoire : 200 Mo au plus.
const MAX_ZIP: u64 = 200 * 1024 * 1024;
/// Absent après 10 minutes sans clavier ni souris.
const AWAY_AFTER_MS: u64 = 10 * 60 * 1000;
/// Une réponse (« dispo ? », café, sondage, IT) est acceptée pendant 2 heures.
const ANSWER_FOR: Duration = Duration::from_secs(2 * 3600);

// ── Les données ──────────────────────────────────────────────────────────────

/// Un collègue appairé (rangé dans team.json).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Peer {
    /// L'empreinte de sa clé publique (16 chiffres hexadécimaux).
    pub id: String,
    /// Sa clé publique X25519 (64 chiffres hexadécimaux).
    pub public: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub mascot: String,
    /// Un de mes PC (presse-papiers, batterie, mascotte synchronisés).
    #[serde(default)]
    pub mine: bool,
    /// Un collègue de l'IT (peut demander l'inventaire).
    #[serde(default)]
    pub it: bool,
    /// Sa dernière adresse IPv4 connue sur le réseau local.
    #[serde(default)]
    pub addr: String,
    #[serde(default)]
    pub added: u64,
}

impl Peer {
    pub fn public_key(&self) -> Result<[u8; 32], String> {
        proto::from_hex(&self.public).ok().and_then(|b| b.try_into().ok()).ok_or_else(|| "clé du collègue abîmée : retirez-le puis ajoutez-le de nouveau".into())
    }

    pub fn ip(&self) -> Option<Ipv4Addr> {
        self.addr.parse().ok()
    }

    /// Ce que le front (et les notifications) savent d'un collègue.
    fn card(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "color": self.color, "mascot": self.mascot, "mine": self.mine, "it": self.it })
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Data {
    #[serde(default)]
    peers: Vec<Peer>,
}

/// Ce qu'on sait d'un collègue en ce moment (pas enregistré).
#[derive(Debug, Clone, Default)]
pub(super) struct Live {
    pub hello: Option<Hello>,
    pub seen: Option<Instant>,
}

/// Une Ondine voisine (visible), pas encore appairée.
#[derive(Debug, Clone)]
pub(super) struct Nearby {
    pub name: String,
    pub color: String,
    pub addr: Ipv4Addr,
    pub seen: Instant,
}

/// Une demande qui attend « Accepter » ou « Refuser ».
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Pending {
    pub id: u64,
    pub peer: String,
    /// text, file, help, status, rdp
    pub kind: &'static str,
    /// Le numéro choisi par l'envoyeur (pour lui répondre).
    #[serde(skip)]
    pub remote: u64,
    pub text: String,
    pub name: String,
    pub size: u64,
    pub folder: bool,
    pub at: u64,
}

/// Ce qu'on a proposé à un collègue (il vient le chercher après « Accepter »).
#[derive(Clone)]
pub(super) enum Source {
    File(PathBuf),
    Bytes(Arc<Vec<u8>>),
}

pub(super) struct Outgoing {
    pub peer: String,
    pub name: String,
    pub size: u64,
    pub source: Source,
    pub until: Instant,
}

/// Une question qu'on a posée, pour n'accepter que les vraies réponses.
#[derive(Debug, Clone)]
struct Sent {
    kind: &'static str,
    peer: Option<String>,
    at: Instant,
}

/// Un sondage que j'ai lancé.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MyPoll {
    id: u64,
    question: String,
    choices: Vec<String>,
    /// collègue → choix
    votes: HashMap<String, u8>,
}

/// Le code d'appairage affiché.
struct Code {
    code: String,
    until: Instant,
    mine: bool,
}

#[derive(Default)]
pub(super) struct State {
    keys: Option<Keys>,
    loaded: bool,
    pub peers: Vec<Peer>,
    pub live: HashMap<String, Live>,
    pub nearby: HashMap<String, Nearby>,
    pub pending: Vec<Pending>,
    pub outgoing: HashMap<u64, Outgoing>,
    code: Option<Code>,
    /// Le Minuteur est en séance de concentration.
    pub focus: bool,
    /// Statut choisi à la main (statut, petit texte) ; None = automatique.
    manual: Option<(String, String)>,
    /// La couleur et la mascotte de l'île (données par le front).
    look: (String, String),
    polls: Vec<MyPoll>,
    sent: HashMap<u64, Sent>,
    inventory: HashMap<String, (Report, u64)>,
    /// Le dernier statut envoyé (pour renvoyer la présence dès qu'il change).
    pub last_status: String,
    /// Presse-papiers partagé : numéro de copie vu, et le dernier texte reçu
    /// d'un autre de mes PC (pour ne pas le renvoyer en écho).
    pub clip_seq: u32,
    pub clip_from_peer: String,
    /// Mascotte synchronisée : la dernière envoyée ou reçue.
    pub mascot_last: String,
}

/// Ce que les fils de fond et les commandes se partagent.
#[derive(Default)]
pub(super) struct Inner {
    pub state: Mutex<State>,
    /// Envoyer la présence tout de suite (statut changé, collègue ajouté…).
    pub wake: AtomicBool,
}

impl Inner {
    /// La paire de clés de ce PC : relue dans le Gestionnaire d'identifiants,
    /// créée la première fois.
    pub fn keys(&self) -> Result<Keys, String> {
        let mut s = self.state.locked();
        if let Some(k) = &s.keys {
            return Ok(k.clone());
        }
        let keys = match credentials::team_identity_get().map(|h| Keys::from_private_hex(&h)) {
            Some(Ok(k)) => k,
            other => {
                if matches!(other, Some(Err(_))) {
                    log::warn("équipe : clé du Gestionnaire d'identifiants illisible, une nouvelle est créée");
                }
                let k = Keys::generate()?;
                if let Err(e) = credentials::team_identity_set(&k.private_hex()) {
                    // Sans coffre (hors Windows) : la clé ne vit que le temps de la session.
                    log::warn(format!("équipe : clé non enregistrée ({e}) ; les appairages ne survivront pas au redémarrage"));
                }
                k
            }
        };
        s.keys = Some(keys.clone());
        Ok(keys)
    }

    pub fn my_id(&self) -> Result<String, String> {
        Ok(proto::fingerprint(&self.keys()?.public))
    }

    fn ensure_loaded(&self) {
        let mut s = self.state.locked();
        if !s.loaded {
            s.peers = load().peers;
            s.loaded = true;
        }
    }

    pub fn peers(&self) -> Vec<Peer> {
        self.ensure_loaded();
        self.state.locked().peers.clone()
    }

    pub fn peer(&self, id: &str) -> Result<Peer, String> {
        self.peers().into_iter().find(|p| p.id == id).ok_or_else(|| "collègue inconnu".into())
    }

    pub fn peer_by_key(&self, key: &[u8; 32]) -> Option<Peer> {
        let hex = proto::to_hex(key);
        self.peers().into_iter().find(|p| p.public == hex)
    }

    /// Note qu'un collègue a répondu (ou appelé), et retient son adresse.
    pub fn seen(&self, peer_id: &str, ip: Option<Ipv4Addr>) {
        let mut s = self.state.locked();
        s.live.entry(peer_id.to_string()).or_default().seen = Some(Instant::now());
        if let Some(ip) = ip.filter(|ip| is_lan(*ip)) {
            let addr = ip.to_string();
            let changed = s.peers.iter_mut().find(|p| p.id == peer_id).filter(|p| p.addr != addr).map(|p| p.addr = addr).is_some();
            if changed {
                let _ = save(&Data { peers: s.peers.clone() });
            }
        }
    }

    fn remember(&self, id: u64, kind: &'static str, peer: Option<&str>) {
        let mut s = self.state.locked();
        s.sent.retain(|_, v| v.at.elapsed() < ANSWER_FOR);
        if s.sent.len() < 500 {
            s.sent.insert(id, Sent { kind, peer: peer.map(str::to_string), at: Instant::now() });
        }
    }

    /// Une réponse à une question qu'on a vraiment posée (à ce collègue s'il était précisé) ?
    fn expected(&self, id: u64, kinds: &[&str], from: &str) -> bool {
        let s = self.state.locked();
        s.sent.get(&id).is_some_and(|v| kinds.contains(&v.kind) && v.at.elapsed() < ANSWER_FOR && v.peer.as_deref().is_none_or(|p| p == from))
    }

    fn add_pending(&self, p: Pending) -> Result<(), String> {
        let mut s = self.state.locked();
        let now = now_ms();
        s.pending.retain(|x| now.saturating_sub(x.at) < PENDING_FOR_MS);
        if s.pending.len() >= MAX_PENDING {
            return Err("trop de demandes en attente".into());
        }
        s.pending.push(p);
        Ok(())
    }

    fn take_pending(&self, id: u64) -> Result<Pending, String> {
        let mut s = self.state.locked();
        let i = s.pending.iter().position(|p| p.id == id).ok_or("demande introuvable (expirée ?)")?;
        Ok(s.pending.remove(i))
    }
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Une adresse du réseau local (privée, ou locale au lien), jamais Internet.
pub(super) fn is_lan(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local() || ip.is_loopback()
}

// ── Le module ────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Team {
    inner: Arc<Inner>,
}

impl RustModule for Team {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/team/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        team_net::start(app, self.inner.clone());
    }

    fn on_event(&self, _ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic == "timer.focus" {
            let on = msg.payload.get("on").and_then(Value::as_bool).unwrap_or(false);
            self.inner.state.locked().focus = on;
            self.inner.wake.store(true, Ordering::SeqCst);
        }
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        ctx.require("network")?;
        let inner = &self.inner;
        inner.ensure_loaded();
        let str_arg = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
        let u64_arg = |k: &str| args.get(k).and_then(Value::as_u64).unwrap_or(0);
        match command {
            "state" => state_json(ctx, inner),
            "search" => {
                team_net::query_nearby();
                Ok(Value::Null)
            }
            // { mine } → { code, seconds, ip }
            "show_code" => {
                let code = proto::new_pair_code()?;
                let mine = args.get("mine").and_then(Value::as_bool).unwrap_or(false);
                inner.state.locked().code = Some(Code { code: code.clone(), until: Instant::now() + CODE_FOR, mine });
                ctx.log_info("équipe : code d'appairage affiché (3 min, un essai)");
                Ok(json!({ "code": code, "seconds": CODE_FOR.as_secs(), "ip": lan::private_ipv4().map(|ip| ip.to_string()) }))
            }
            "hide_code" => {
                inner.state.locked().code = None;
                Ok(Value::Null)
            }
            // { addr, code, mine } : appairage avec le PC qui affiche le code.
            "pair" => {
                let ip: Ipv4Addr = str_arg("addr").parse().map_err(|_| "adresse IP invalide (exemple : 192.168.1.20)")?;
                if !is_lan(ip) || ip.is_loopback() {
                    return Err("seules les adresses du réseau local sont acceptées (192.168.x.x, 10.x.x.x, 172.16-31.x.x)".into());
                }
                let code = proto::clean_pair_code(&str_arg("code")).ok_or("le code a 6 chiffres")?;
                let mine = args.get("mine").and_then(Value::as_bool).unwrap_or(false);
                let peer = team_net::pair_with(ctx.app, inner, ip, &code, mine)?;
                Ok(peer.card())
            }
            "remove" => {
                let id = str_arg("id");
                let mut s = inner.state.locked();
                let before = s.peers.len();
                s.peers.retain(|p| p.id != id);
                if s.peers.len() == before {
                    return Err("collègue inconnu".into());
                }
                s.live.remove(&id);
                s.inventory.remove(&id);
                s.pending.retain(|p| p.peer != id);
                save(&Data { peers: s.peers.clone() })?;
                drop(s);
                ctx.log_info("équipe : un collègue retiré");
                changed(ctx);
                Ok(Value::Null)
            }
            // { id, mine?, it? }
            "set_peer" => {
                let id = str_arg("id");
                let mut s = inner.state.locked();
                let p = s.peers.iter_mut().find(|p| p.id == id).ok_or("collègue inconnu")?;
                if let Some(v) = args.get("mine").and_then(Value::as_bool) {
                    p.mine = v;
                }
                if let Some(v) = args.get("it").and_then(Value::as_bool) {
                    p.it = v;
                }
                save(&Data { peers: s.peers.clone() })?;
                drop(s);
                changed(ctx);
                Ok(Value::Null)
            }
            // { status: null (automatique) | available | meeting | focus | away, text }
            "set_status" => {
                let status = str_arg("status");
                let text: String = str_arg("text").chars().take(proto::MAX_STATUS_TEXT).collect();
                proto::check_text(&text, proto::MAX_STATUS_TEXT, false)?;
                let manual = if status.is_empty() {
                    None
                } else if proto::STATUSES.contains(&status.as_str()) {
                    Some((status, text))
                } else {
                    return Err("statut inconnu".into());
                };
                inner.state.locked().manual = manual;
                inner.wake.store(true, Ordering::SeqCst);
                changed(ctx);
                Ok(Value::Null)
            }
            // { color, mascot } : l'apparence de la mascotte de l'île (pour les collègues).
            "set_look" => {
                let color = str_arg("color");
                let mascot = str_arg("mascot");
                if proto::check_color(&color).is_ok() && mascot.len() <= 40 && mascot.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
                    let mut s = inner.state.locked();
                    if s.look != (color.clone(), mascot.clone()) {
                        s.look = (color, mascot);
                        inner.wake.store(true, Ordering::SeqCst);
                    }
                }
                Ok(Value::Null)
            }
            "ping" => {
                let kind = str_arg("kind");
                send_to(ctx, inner, &str_arg("id"), &Msg::Ping { kind })?;
                Ok(Value::Null)
            }
            "ask" => {
                let id = proto::random_u64();
                let peer = str_arg("id");
                inner.remember(id, "ask", Some(&peer));
                send_to(ctx, inner, &peer, &Msg::Ask { id })?;
                Ok(json!({ "id": id }))
            }
            // { id (collègue), ask, answer }
            "answer" => {
                send_to(ctx, inner, &str_arg("id"), &Msg::Answer { id: u64_arg("ask"), answer: str_arg("answer") })?;
                Ok(Value::Null)
            }
            "visit" => {
                let peer = inner.peer(&str_arg("id"))?;
                let allowed = inner.state.locked().live.get(&peer.id).and_then(|l| l.hello.as_ref()).is_none_or(|h| h.visits);
                if !allowed {
                    return Err(format!("{} n'accepte pas les visites", peer.name));
                }
                send_to(ctx, inner, &peer.id, &Msg::Visit { note: str_arg("note") })?;
                Ok(Value::Null)
            }
            "send_text" => {
                let text = args.get("text").and_then(Value::as_str).unwrap_or("").to_string();
                send_to(ctx, inner, &str_arg("id"), &Msg::Text { id: proto::random_u64(), text })?;
                Ok(Value::Null)
            }
            // { id, paths } : un fichier tel quel ; un dossier ou plusieurs fichiers zippés.
            "send_files" => {
                let paths: Vec<String> = args.get("paths").and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect();
                send_files(ctx, inner, &str_arg("id"), &paths)
            }
            "accept" => accept(ctx, inner, u64_arg("id")),
            "decline" => decline(ctx, inner, u64_arg("id")),
            // { ids: [] (vide = tout le monde), kind: coffee | lunch, minutes }
            "invite" => {
                let id = proto::random_u64();
                inner.remember(id, "invite", None);
                let msg = Msg::Invite { id, kind: str_arg("kind"), minutes: u64_arg("minutes").min(120) as u32 };
                Ok(json!({ "id": id, "sent": broadcast(ctx, inner, &ids_arg(&args), &msg)? }))
            }
            "invite_reply" => {
                send_to(ctx, inner, &str_arg("id"), &Msg::InviteReply { id: u64_arg("invite"), answer: str_arg("answer") })?;
                Ok(Value::Null)
            }
            // { question, choices, ids }
            "poll" => {
                let id = proto::random_u64();
                let question = str_arg("question");
                let choices: Vec<String> = args.get("choices").and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str()).map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).collect();
                let msg = Msg::Poll { id, question: question.clone(), choices: choices.clone() };
                msg.check()?;
                {
                    let mut s = inner.state.locked();
                    s.polls.push(MyPoll { id, question, choices, votes: HashMap::new() });
                    let extra = s.polls.len().saturating_sub(5);
                    s.polls.drain(..extra);
                }
                inner.remember(id, "poll", None);
                Ok(json!({ "id": id, "sent": broadcast(ctx, inner, &ids_arg(&args), &msg)? }))
            }
            // { id (collègue), poll, choice }
            "vote" => {
                send_to(ctx, inner, &str_arg("id"), &Msg::Vote { id: u64_arg("poll"), choice: u64_arg("choice").min(9) as u8 })?;
                Ok(Value::Null)
            }
            "pomodoro" => {
                let msg = Msg::Pomodoro { minutes: u64_arg("minutes").clamp(5, 90) as u32 };
                Ok(json!({ "sent": broadcast(ctx, inner, &ids_arg(&args), &msg)? }))
            }
            "announce" => {
                let msg = Msg::Announce { text: str_arg("text") };
                Ok(json!({ "sent": broadcast(ctx, inner, &ids_arg(&args), &msg)? }))
            }
            // { id, note, withImage } : le résumé système (+ l'image copiée).
            "help" => help(ctx, inner, &str_arg("id"), &str_arg("note"), args.get("withImage").and_then(Value::as_bool).unwrap_or(false)),
            "status_ask" => {
                let id = proto::random_u64();
                let peer = str_arg("id");
                inner.remember(id, "status", Some(&peer));
                send_to(ctx, inner, &peer, &Msg::StatusAsk { id })?;
                Ok(Value::Null)
            }
            "rdp_ask" => {
                let id = proto::random_u64();
                let peer = str_arg("id");
                inner.remember(id, "rdp", Some(&peer));
                send_to(ctx, inner, &peer, &Msg::RdpAsk { id })?;
                Ok(Value::Null)
            }
            // L'inventaire : seulement les collègues qui l'acceptent (réglage chez eux).
            "inventory" => inventory(ctx, inner),
            "open_inbox" => {
                let dir = inbox(ctx)?;
                files::open_folder(&dir)?;
                Ok(Value::Null)
            }
            // { path } : seulement un fichier du dossier des fichiers reçus.
            "reveal" => {
                let dir = inbox(ctx)?;
                let path = ctx.check_path(&str_arg("path"))?;
                if path.parent() != Some(dir.as_path()) {
                    return Err("ce fichier n'est pas dans le dossier des fichiers reçus".into());
                }
                files::reveal(&path)?;
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

fn ids_arg(args: &Value) -> Vec<String> {
    args.get("ids").and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect()
}

/// Prévient le front que la liste a changé (il redemande `state`).
pub(super) fn changed(ctx: &ModuleContext) {
    ctx.emit("team.changed", Value::Null);
}

pub(super) fn emit(app: &AppHandle, topic: &str, payload: Value) {
    super::with_context(app, ID, |ctx| ctx.emit(topic, payload));
}

/// Une nouvelle pour le front : { kind, from, … }.
pub(super) fn event(app: &AppHandle, kind: &str, from: Option<&Peer>, mut extra: Value) {
    if let Some(obj) = extra.as_object_mut() {
        obj.insert("kind".into(), json!(kind));
        obj.insert("from".into(), from.map(Peer::card).unwrap_or(Value::Null));
    }
    emit(app, "team.event", extra);
}

pub(super) fn settings(app: &AppHandle) -> Map<String, Value> {
    super::with_context(app, ID, |ctx| ctx.settings()).unwrap_or_default()
}

fn flag(s: &Map<String, Value>, key: &str, default: bool) -> bool {
    s.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// Le nom montré aux collègues : le réglage, sinon le nom de la session Windows.
pub(super) fn my_name(s: &Map<String, Value>) -> String {
    let set = s.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let name = if set.is_empty() { std::env::var("USERNAME").unwrap_or_default() } else { set };
    let clean: String = name.chars().filter(|c| !c.is_control()).take(proto::MAX_NAME).collect();
    if proto::check_name(&clean).is_ok() {
        clean
    } else {
        "Collègue".into()
    }
}

/// Mon statut : celui choisi à la main, sinon d'après le Minuteur, l'agenda et l'activité.
pub(super) fn my_status(app: &AppHandle, inner: &Inner) -> (String, String) {
    let (manual, focus) = {
        let s = inner.state.locked();
        (s.manual.clone(), s.focus)
    };
    if let Some(m) = manual {
        return m;
    }
    if !flag(&settings(app), "autoStatus", true) {
        return ("available".into(), String::new());
    }
    let status = if focus {
        "focus"
    } else if super::agenda::in_meeting(now_ms() as i64) {
        "meeting"
    } else if platform::idle_ms() > AWAY_AFTER_MS {
        "away"
    } else {
        "available"
    };
    (status.into(), String::new())
}

/// Ma présence, telle qu'envoyée à `peer` (la batterie seulement à mes PC).
pub(super) fn my_hello(app: &AppHandle, inner: &Inner, peer: &Peer) -> Hello {
    let s = settings(app);
    let (status, status_text) = my_status(app, inner);
    let (color, mascot) = inner.state.locked().look.clone();
    let battery = if peer.mine {
        platform::battery().and_then(|b| b.percent.map(|percent| proto::Battery { percent: percent.min(100), charging: b.charging }))
    } else {
        None
    };
    Hello {
        name: my_name(&s),
        color: if proto::check_color(&color).is_ok() { color } else { "#4da3ff".into() },
        mascot,
        status,
        status_text,
        version: env!("CARGO_PKG_VERSION").into(),
        battery,
        visits: flag(&s, "visits", true),
    }
}

pub(super) fn my_card(app: &AppHandle, inner: &Inner, mine: bool) -> proto::PairInfo {
    let s = settings(app);
    let (color, mascot) = inner.state.locked().look.clone();
    proto::PairInfo { name: my_name(&s), color: if proto::check_color(&color).is_ok() { color } else { "#4da3ff".into() }, mascot, mine }
}

/// Ajoute (ou met à jour) un collègue après un appairage réussi.
pub(super) fn add_peer(app: &AppHandle, inner: &Inner, paired: &proto::Paired, ip: Ipv4Addr, mine: bool) -> Result<Peer, String> {
    inner.ensure_loaded();
    let id = proto::fingerprint(&paired.peer_public);
    if id == inner.my_id()? {
        return Err("c'est ce PC-ci".into());
    }
    let mut s = inner.state.locked();
    let old = s.peers.iter().position(|p| p.id == id);
    if old.is_none() && s.peers.len() >= MAX_PEERS {
        return Err("100 collègues au plus".into());
    }
    let peer = Peer {
        id: id.clone(),
        public: proto::to_hex(&paired.peer_public),
        name: paired.info.name.clone(),
        color: paired.info.color.clone(),
        mascot: paired.info.mascot.clone(),
        mine,
        it: old.map(|i| s.peers[i].it).unwrap_or(false),
        addr: ip.to_string(),
        added: now_ms(),
    };
    match old {
        Some(i) => s.peers[i] = peer.clone(),
        None => s.peers.push(peer.clone()),
    }
    s.nearby.remove(&id);
    save(&Data { peers: s.peers.clone() })?;
    drop(s);
    inner.wake.store(true, Ordering::SeqCst);
    log::info("équipe : nouveau collègue appairé");
    event(app, "paired", Some(&peer), json!({}));
    emit(app, "team.changed", Value::Null);
    Ok(peer)
}

/// Le code d'appairage, s'il est encore valable. Le prendre le consomme : un
/// seul essai par code.
pub(super) fn take_code(inner: &Inner) -> Option<(String, bool)> {
    let mut s = inner.state.locked();
    let c = s.code.take()?;
    (Instant::now() < c.until).then_some((c.code, c.mine))
}

// ── Envoyer ──────────────────────────────────────────────────────────────────

/// Envoie un message à un collègue et attend sa réponse courte.
fn send_to(ctx: &ModuleContext, inner: &Inner, peer_id: &str, msg: &Msg) -> Result<Msg, String> {
    msg.check()?;
    let peer = inner.peer(peer_id)?;
    let reply = team_net::request(inner, &peer, msg)?;
    match &reply {
        Msg::Refused { reason } => Err(format!("{} a refusé : {reason}", peer.name)),
        _ => {
            let _ = ctx;
            Ok(reply)
        }
    }
}

/// Envoie à plusieurs collègues (vide = tous ceux qui sont en ligne), en
/// parallèle. Renvoie combien l'ont reçu.
fn broadcast(ctx: &ModuleContext, inner: &Inner, ids: &[String], msg: &Msg) -> Result<usize, String> {
    msg.check()?;
    let peers: Vec<Peer> = {
        let all = inner.peers();
        let s = inner.state.locked();
        all.into_iter()
            .filter(|p| if ids.is_empty() { s.live.get(&p.id).is_some_and(|l| team_net::online(l)) } else { ids.contains(&p.id) })
            .collect()
    };
    if peers.is_empty() {
        return Err("aucun collègue en ligne".into());
    }
    let ok = std::thread::scope(|scope| {
        let handles: Vec<_> = peers.iter().map(|p| scope.spawn(move || team_net::request(inner, p, msg).is_ok_and(|r| !matches!(r, Msg::Refused { .. })))).collect();
        handles.into_iter().map(|h| h.join()).filter(|r| matches!(r, Ok(true))).count()
    });
    let _ = ctx;
    Ok(ok)
}

/// Propose des fichiers : un fichier seul part tel quel ; un dossier, ou
/// plusieurs éléments, partent dans un .zip fait en mémoire (200 Mo au plus).
fn send_files(ctx: &ModuleContext, inner: &Inner, peer_id: &str, raw: &[String]) -> Result<Value, String> {
    ctx.require("files")?;
    if raw.is_empty() || raw.len() > 100 {
        return Err("choisissez de 1 à 100 éléments".into());
    }
    let paths: Vec<PathBuf> = raw.iter().map(|p| ctx.check_path(p)).collect::<Result<_, _>>()?;
    let peer = inner.peer(peer_id)?;
    let max = max_bytes(&ctx.settings());
    let (name, size, source, folder) = if paths.len() == 1 && paths[0].is_file() {
        let size = std::fs::metadata(&paths[0]).map_err(|e| e.to_string())?.len();
        let name = paths[0].file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "fichier".into());
        (name, size, Source::File(paths[0].clone()), false)
    } else {
        let base = if paths.len() == 1 { paths[0].file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Dossier".into()) } else { "Fichiers".into() };
        let bytes = zip_in_memory(ctx, &paths)?;
        (format!("{base}.zip"), bytes.len() as u64, Source::Bytes(Arc::new(bytes)), true)
    };
    if size > max {
        return Err(format!("fichier trop gros ({} Mo au plus)", max / (1024 * 1024)));
    }
    let id = proto::random_u64();
    inner.state.locked().outgoing.insert(id, Outgoing { peer: peer.id.clone(), name: name.clone(), size, source, until: Instant::now() + OFFER_FOR });
    let offer = Msg::Offer { id, name: name.clone(), size, folder };
    match send_to(ctx, inner, &peer.id, &offer) {
        Ok(_) => {
            ctx.log_info("équipe : fichier proposé à un collègue");
            Ok(json!({ "id": id, "name": name, "size": size }))
        }
        Err(e) => {
            inner.state.locked().outgoing.remove(&id);
            Err(e)
        }
    }
}

/// La taille maximale d'un fichier (réglage, en Mo).
pub(super) fn max_bytes(s: &Map<String, Value>) -> u64 {
    s.get("maxMb").and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(2048.0).clamp(1.0, 20480.0) as u64 * 1024 * 1024
}

/// Un .zip en mémoire de ces éléments (dossiers compris), sans les liens
/// symboliques ni ce qui est dans un dossier exclu (Confidentialité).
fn zip_in_memory(ctx: &ModuleContext, paths: &[PathBuf]) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut total = 0u64;

    fn add(ctx: &ModuleContext, w: &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>, path: &Path, name: &str, o: SimpleFileOptions, total: &mut u64) -> Result<(), String> {
        // Un dossier exclu au milieu du dossier choisi : passé sans rien dire.
        if ctx.check_path(&path.display().to_string()).is_err() {
            return Ok(());
        }
        let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Ok(());
        }
        if meta.is_dir() {
            w.add_directory(format!("{name}/"), o).map_err(|e| e.to_string())?;
            for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                add(ctx, w, &entry.path(), &format!("{name}/{}", entry.file_name().to_string_lossy()), o, total)?;
            }
        } else {
            *total += meta.len();
            if *total > MAX_ZIP {
                return Err("dossier trop gros (200 Mo au plus) : envoyez plutôt une archive faite à la main".into());
            }
            w.start_file(name, o).map_err(|e| e.to_string())?;
            let mut src = std::fs::File::open(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut src, w).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    for p in paths {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).ok_or("chemin sans nom")?;
        add(ctx, &mut writer, p, &name, options, &mut total)?;
    }
    let mut cursor = writer.finish().map_err(|e| format!("compression impossible : {e}"))?;
    cursor.flush().map_err(|e| e.to_string())?;
    Ok(cursor.into_inner())
}

/// « Demander de l'aide » : le résumé système (le même que « Copier pour le
/// support » du module Système), un petit mot, et l'image copiée en option.
fn help(ctx: &ModuleContext, inner: &Inner, peer_id: &str, note: &str, with_image: bool) -> Result<Value, String> {
    let peer = inner.peer(peer_id)?;
    let png = if with_image {
        if platform::clipboard_is_sensitive() {
            return Err("le contenu copié est marqué sensible : on n'y touche pas".into());
        }
        let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
        let img = clipboard.get_image().map_err(|_| "aucune image copiée : faites d'abord votre capture (Win+Maj+S)".to_string())?;
        let mut out = std::io::Cursor::new(Vec::new());
        image::write_buffer_with_format(&mut out, &img.bytes, img.width as u32, img.height as u32, image::ExtendedColorType::Rgba8, image::ImageFormat::Png)
            .map_err(|e| format!("image illisible : {e}"))?;
        Some(out.into_inner())
    } else {
        None
    };
    let summary: String = super::system::support_text_of(&super::system::fresh_support_snapshot()).chars().take(proto::MAX_SUMMARY).collect();
    let id = proto::random_u64();
    send_to(ctx, inner, &peer.id, &Msg::Help { id, summary, note: note.chars().take(proto::MAX_NOTE * 4).collect() })?;
    if let Some(bytes) = png {
        let size = bytes.len() as u64;
        let fid = proto::random_u64();
        let t = platform::local_time();
        let name = format!("Capture {:04}-{:02}-{:02} {:02}.{:02}.png", t.year, t.month, t.day, t.hour, t.minute);
        inner.state.locked().outgoing.insert(fid, Outgoing { peer: peer.id.clone(), name: name.clone(), size, source: Source::Bytes(Arc::new(bytes)), until: Instant::now() + OFFER_FOR });
        send_to(ctx, inner, &peer.id, &Msg::Offer { id: fid, name, size, folder: false })?;
    }
    ctx.log_info("équipe : demande d'aide envoyée");
    Ok(Value::Null)
}

/// L'inventaire : on le demande à chaque collègue en ligne ; seuls ceux qui
/// ont allumé « Partager l'inventaire » (et qui nous ont marqué IT) répondent.
fn inventory(ctx: &ModuleContext, inner: &Inner) -> Result<Value, String> {
    let peers: Vec<Peer> = {
        let all = inner.peers();
        let s = inner.state.locked();
        all.into_iter().filter(|p| s.live.get(&p.id).is_some_and(team_net::online)).collect()
    };
    let results: Vec<(Peer, Option<Report>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = peers
            .iter()
            .map(|p| {
                scope.spawn(move || match team_net::request(inner, p, &Msg::InventoryAsk) {
                    Ok(Msg::StatusReport { report, .. }) => Some(report),
                    _ => None,
                })
            })
            .collect();
        peers.iter().cloned().zip(handles.into_iter().map(|h| h.join().ok().flatten())).collect()
    });
    let now = now_ms();
    {
        let mut s = inner.state.locked();
        for (p, r) in &results {
            if let Some(r) = r {
                s.inventory.insert(p.id.clone(), (r.clone(), now));
            }
        }
    }
    let _ = ctx;
    Ok(json!({ "asked": results.len(), "answered": results.iter().filter(|(_, r)| r.is_some()).count() }))
}

// ── Accepter, refuser ────────────────────────────────────────────────────────

fn accept(ctx: &ModuleContext, inner: &Arc<Inner>, id: u64) -> Result<Value, String> {
    let p = inner.take_pending(id)?;
    let peer = inner.peer(&p.peer)?;
    let result = match p.kind {
        "text" | "help" => {
            ctx.require("clipboard")?;
            files::copy_text(&p.text)?;
            json!({ "copied": true })
        }
        "file" => {
            let dir = inbox(ctx)?;
            let max = max_bytes(&ctx.settings());
            team_net::pull_file(ctx.app.clone(), inner.clone(), peer, p.remote, p.name.clone(), p.size, p.folder, dir, max);
            json!({ "receiving": true })
        }
        "status" => {
            let report = build_report();
            team_net::request(inner, &peer, &Msg::StatusReport { id: p.remote, report })?;
            json!({ "sent": true })
        }
        "rdp" => {
            team_net::request(inner, &peer, &Msg::RdpReply { id: p.remote, ok: true })?;
            json!({ "sent": true })
        }
        _ => Value::Null,
    };
    ctx.log_info(format!("équipe : demande acceptée ({})", p.kind));
    changed(ctx);
    Ok(result)
}

fn decline(ctx: &ModuleContext, inner: &Inner, id: u64) -> Result<Value, String> {
    let p = inner.take_pending(id)?;
    // On prévient l'envoyeur quand ça l'aide (fichier oublié, Bureau à distance refusé).
    if let Ok(peer) = inner.peer(&p.peer) {
        let msg = match p.kind {
            "file" => Some(Msg::Decline { id: p.remote }),
            "rdp" => Some(Msg::RdpReply { id: p.remote, ok: false }),
            _ => None,
        };
        if let Some(msg) = msg {
            let _ = team_net::request(inner, &peer, &msg);
        }
    }
    changed(ctx);
    Ok(Value::Null)
}

/// Le dossier des fichiers reçus : Téléchargements\Ondine (créé au besoin),
/// jamais dans un dossier exclu.
pub(super) fn inbox(ctx: &ModuleContext) -> Result<PathBuf, String> {
    let dir = platform::downloads_dir().ok_or("dossier Téléchargements introuvable")?.join("Ondine");
    std::fs::create_dir_all(&dir).map_err(|e| format!("impossible de créer {} : {e}", dir.display()))?;
    ctx.check_path(&dir.display().to_string())
}

/// L'état du PC pour l'IT, mesuré sur le moment.
pub(super) fn build_report() -> Report {
    let snap = super::system::fresh_support_snapshot();
    let mem_total = snap["mem"]["totalGb"].as_f64().unwrap_or(0.0);
    let disks = snap["disks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|d| d["removable"].as_bool() != Some(true))
        .take(16)
        .map(|d| proto::DiskState {
            mount: d["mount"].as_str().unwrap_or_default().chars().take(64).collect(),
            free_gb: d["freeGb"].as_f64().unwrap_or(0.0),
            total_gb: d["totalGb"].as_f64().unwrap_or(0.0),
        })
        .collect();
    let clean = |v: &Value, n: usize| -> String { v.as_str().unwrap_or_default().chars().filter(|c| !c.is_control()).take(n).collect() };
    Report {
        host: clean(&snap["host"], 64),
        os: clean(&snap["os"], 120),
        ondine: env!("CARGO_PKG_VERSION").into(),
        cpu_pct: snap["cpu"]["usage"].as_f64().unwrap_or(0.0),
        mem_pct: if mem_total > 0.0 { (snap["mem"]["usedGb"].as_f64().unwrap_or(0.0) / mem_total * 1000.0).round() / 10.0 } else { 0.0 },
        disks,
        reboot_pending: snap["reboot"]["pending"].as_bool().unwrap_or(false),
        uptime_secs: snap["uptimeSecs"].as_u64().unwrap_or(0),
    }
}

// ── Ce qu'on fait d'un message reçu ──────────────────────────────────────────

/// Les gestes, et l'expression que prend la mascotte de l'île.
fn ping_emotion(kind: &str) -> &'static str {
    match kind {
        "wave" => "wave",
        "thumb" => "proud",
        "coffee" => "happy",
        "heart" => "love",
        "clap" => "cheer",
        _ => "celebrate",
    }
}

/// Un message d'un collègue (déjà authentifié et vérifié). Renvoie la réponse
/// courte. (`Pull` est traité à part, dans team_net.rs.)
pub(super) fn on_message(app: &AppHandle, inner: &Inner, peer: &Peer, msg: Msg) -> Msg {
    let s = settings(app);
    let refuse = |reason: &str| Msg::Refused { reason: reason.into() };
    let pending = |kind: &'static str, remote: u64, text: String, name: String, size: u64, folder: bool| Pending { id: proto::random_u64(), peer: peer.id.clone(), kind, remote, text, name, size, folder, at: now_ms() };
    let queue = |p: Pending| -> Msg {
        let card = json!({ "id": p.id, "type": p.kind, "name": p.name, "size": p.size, "text": p.text.chars().take(400).collect::<String>() });
        match inner.add_pending(p) {
            Ok(()) => {
                event(app, "incoming", Some(peer), card);
                emit(app, "team.changed", Value::Null);
                Msg::Ok
            }
            Err(e) => Msg::Refused { reason: e },
        }
    };
    match msg {
        Msg::Hello(h) => {
            let was = inner.state.locked().live.get(&peer.id).and_then(|l| l.hello.clone());
            let new_status = was.as_ref().map(|w| (w.status != h.status) || (w.status_text != h.status_text) || w.battery != h.battery).unwrap_or(true);
            inner.state.locked().live.entry(peer.id.clone()).or_default().hello = Some(h);
            if new_status {
                emit(app, "team.changed", Value::Null);
            }
            Msg::Hello(my_hello(app, inner, peer))
        }
        Msg::Ping { kind } => {
            emit(app, "mascot.emote", json!({ "emotion": ping_emotion(&kind) }));
            event(app, "ping", Some(peer), json!({ "ping": kind }));
            Msg::Ok
        }
        Msg::Ask { id } => {
            event(app, "ask", Some(peer), json!({ "ask": id }));
            Msg::Ok
        }
        Msg::Answer { id, answer } => {
            if inner.expected(id, &["ask"], &peer.id) {
                event(app, "answer", Some(peer), json!({ "answer": answer }));
            }
            Msg::Ok
        }
        Msg::Visit { note } => {
            if !flag(&s, "visits", true) {
                return refuse("les visites sont désactivées");
            }
            event(app, "visit", Some(peer), json!({ "note": note }));
            Msg::Ok
        }
        Msg::Text { id, text } => queue(pending("text", id, text, String::new(), 0, false)),
        Msg::Offer { id, name, size, folder } => {
            if size > max_bytes(&s) {
                return refuse("fichier trop gros pour ce PC");
            }
            let mut name = proto::safe_file_name(&name);
            if folder && !name.to_ascii_lowercase().ends_with(".zip") {
                name.push_str(".zip");
            }
            queue(pending("file", id, String::new(), name, size, folder))
        }
        Msg::Decline { id } => {
            let removed = {
                let mut st = inner.state.locked();
                let mine = st.outgoing.get(&id).is_some_and(|o| o.peer == peer.id);
                if mine {
                    st.outgoing.remove(&id).map(|o| o.name)
                } else {
                    None
                }
            };
            if let Some(name) = removed {
                event(app, "declined", Some(peer), json!({ "name": name }));
            }
            Msg::Ok
        }
        Msg::Invite { id, kind, minutes } => {
            event(app, "invite", Some(peer), json!({ "invite": id, "type": kind, "minutes": minutes }));
            Msg::Ok
        }
        Msg::InviteReply { id, answer } => {
            if inner.expected(id, &["invite"], &peer.id) {
                event(app, "invite-reply", Some(peer), json!({ "invite": id, "answer": answer }));
            }
            Msg::Ok
        }
        Msg::Poll { id, question, choices } => {
            event(app, "poll", Some(peer), json!({ "poll": id, "question": question, "choices": choices }));
            Msg::Ok
        }
        Msg::Vote { id, choice } => {
            let tally = {
                let mut st = inner.state.locked();
                st.polls.iter_mut().find(|p| p.id == id && usize::from(choice) < p.choices.len()).map(|p| {
                    p.votes.insert(peer.id.clone(), choice);
                    tally(p)
                })
            };
            match tally {
                Some(t) => {
                    event(app, "vote", Some(peer), t);
                    Msg::Ok
                }
                None => refuse("sondage terminé"),
            }
        }
        Msg::Pomodoro { minutes } => {
            event(app, "pomodoro", Some(peer), json!({ "minutes": minutes }));
            Msg::Ok
        }
        Msg::Announce { text } => {
            event(app, "announce", Some(peer), json!({ "text": text }));
            Msg::Ok
        }
        Msg::Help { id, summary, note } => {
            let text = if note.trim().is_empty() { summary } else { format!("{note}\r\n\r\n{summary}") };
            queue(pending("help", id, text, String::new(), 0, false))
        }
        Msg::StatusAsk { id } => queue(pending("status", id, String::new(), String::new(), 0, false)),
        Msg::RdpAsk { id } => queue(pending("rdp", id, String::new(), String::new(), 0, false)),
        Msg::StatusReport { id, report } => {
            if !inner.expected(id, &["status"], &peer.id) {
                return refuse("état non demandé");
            }
            inner.state.locked().inventory.insert(peer.id.clone(), (report.clone(), now_ms()));
            event(app, "status-report", Some(peer), json!({ "report": report }));
            emit(app, "team.changed", Value::Null);
            Msg::Ok
        }
        Msg::RdpReply { id, ok } => {
            if !inner.expected(id, &["rdp"], &peer.id) {
                return refuse("Bureau à distance non demandé");
            }
            let mut error = None;
            if ok {
                // Le programme de Windows, avec l'adresse vérifiée (une IPv4 du réseau local) : rien d'autre.
                match peer.ip() {
                    Some(ip) if is_lan(ip) => {
                        if let Err(e) = platform::spawn_console("mstsc.exe", &[format!("/v:{ip}")], &platform::home_dir()) {
                            error = Some(e);
                        }
                    }
                    _ => error = Some("adresse du collègue inconnue".into()),
                }
            }
            event(app, "rdp-reply", Some(peer), json!({ "ok": ok, "error": error }));
            Msg::Ok
        }
        Msg::InventoryAsk => {
            if !(flag(&s, "shareInventory", false) && peer.it) {
                return refuse("inventaire non partagé");
            }
            Msg::StatusReport { id: 0, report: build_report() }
        }
        Msg::Clipboard { text } => {
            if !(peer.mine && flag(&s, "clipboardSync", false)) {
                return refuse("presse-papiers partagé désactivé");
            }
            if files::copy_text(&text).is_ok() {
                let mut st = inner.state.locked();
                st.clip_from_peer = text;
                st.clip_seq = platform::clipboard_sequence();
            }
            Msg::Ok
        }
        Msg::MascotSync { mascot, palette, custom } => {
            if !(peer.mine && flag(&s, "mascotSync", false)) {
                return refuse("mascotte synchronisée désactivée");
            }
            apply_mascot(app, inner, &mascot, &palette, &custom);
            Msg::Ok
        }
        Msg::Pull { .. } | Msg::Ok | Msg::Refused { .. } | Msg::FileStart { .. } | Msg::FileEnd { .. } => refuse("message inattendu"),
    }
}

fn tally(p: &MyPoll) -> Value {
    let mut counts = vec![0u32; p.choices.len()];
    for &c in p.votes.values() {
        if let Some(n) = counts.get_mut(usize::from(c)) {
            *n += 1;
        }
    }
    json!({ "poll": p.id, "question": p.question, "choices": p.choices, "counts": counts })
}

/// La mascotte (et sa couleur) d'un autre de mes PC.
fn apply_mascot(app: &AppHandle, inner: &Inner, mascot: &str, palette: &str, custom: &str) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let mut new = shared.settings.locked().clone();
    if new.mascot.id == mascot && new.mascot.color == palette && new.mascot.custom_color == custom {
        return;
    }
    new.mascot.id = mascot.into();
    new.mascot.color = palette.into();
    new.mascot.custom_color = custom.into();
    new.sanitize();
    inner.state.locked().mascot_last = format!("{}|{}|{}", new.mascot.id, new.mascot.color, new.mascot.custom_color);
    if let Err(e) = crate::apply_settings(app, &shared, new) {
        log::warn(format!("équipe : mascotte non synchronisée ({e})"));
    }
}

// ── Ce que le front affiche ──────────────────────────────────────────────────

fn state_json(ctx: &ModuleContext, inner: &Inner) -> Result<Value, String> {
    let my_id = inner.my_id()?;
    let settings = ctx.settings();
    let (status, status_text) = my_status(ctx.app, inner);
    let peers = inner.peers();
    let s = inner.state.locked();
    let peers: Vec<Value> = peers
        .iter()
        .map(|p| {
            let live = s.live.get(&p.id);
            let hello = live.and_then(|l| l.hello.as_ref());
            let online = live.is_some_and(team_net::online);
            let mut card = p.card();
            let obj = card.as_object_mut().expect("objet");
            obj.insert("addr".into(), json!(p.addr));
            obj.insert("online".into(), json!(online));
            obj.insert("status".into(), json!(if online { hello.map(|h| h.status.as_str()).unwrap_or("available") } else { "offline" }));
            obj.insert("statusText".into(), json!(hello.map(|h| h.status_text.as_str()).unwrap_or("")));
            obj.insert("version".into(), json!(hello.map(|h| h.version.as_str()).unwrap_or("")));
            obj.insert("visits".into(), json!(hello.is_none_or(|h| h.visits)));
            obj.insert("battery".into(), json!(if online { hello.and_then(|h| h.battery) } else { None }));
            obj.insert("fingerprint".into(), json!(proto::fingerprint_pretty(&p.id)));
            if let Some((r, at)) = s.inventory.get(&p.id) {
                obj.insert("report".into(), json!({ "at": at, "data": r }));
            }
            card
        })
        .collect();
    let nearby: Vec<Value> = s
        .nearby
        .iter()
        .filter(|(id, n)| **id != my_id && n.seen.elapsed() < team_net::NEARBY_FOR)
        .map(|(id, n)| json!({ "id": id, "name": n.name, "color": n.color, "addr": n.addr.to_string() }))
        .collect();
    let code = s.code.as_ref().filter(|c| Instant::now() < c.until).map(|c| json!({ "code": c.code, "seconds": c.until.saturating_duration_since(Instant::now()).as_secs(), "mine": c.mine }));
    let polls: Vec<Value> = s.polls.iter().map(tally).collect();
    Ok(json!({
        "me": {
            "id": my_id,
            "fingerprint": proto::fingerprint_pretty(&my_id),
            "name": my_name(&settings),
            "ip": lan::private_ipv4().map(|ip| ip.to_string()),
            "status": status,
            "statusText": status_text,
            "auto": s.manual.is_none(),
            "visible": flag(&settings, "visible", false),
        },
        "peers": peers,
        "nearby": nearby,
        "pending": s.pending,
        "code": code,
        "polls": polls,
    }))
}

// ── Le fichier team.json ─────────────────────────────────────────────────────

fn file() -> PathBuf {
    platform::config_dir().join("team.json")
}

/// Relit le fichier. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Data {
    let Ok(text) = std::fs::read_to_string(file()) else { return Data::default() };
    match parse_data(&text) {
        Ok(d) => d,
        Err(e) => {
            let aside = platform::config_dir().join(format!("team.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("équipe : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Data::default()
        }
    }
}

/// Lit team.json, en ne gardant que les collègues valides (modifié à la main ?).
fn parse_data(text: &str) -> Result<Data, serde_json::Error> {
    let mut d = serde_json::from_str::<Data>(text)?;
    d.peers.retain(|p| {
        p.public_key().is_ok_and(|k| proto::fingerprint(&k) == p.id) && proto::check_name(&p.name).is_ok() && proto::check_color(&p.color).is_ok()
    });
    for p in &mut d.peers {
        if p.ip().is_none_or(|ip| !is_lan(ip)) {
            p.addr.clear();
        }
    }
    d.peers.truncate(MAX_PEERS);
    Ok(d)
}

fn save(d: &Data) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    let tmp = dir.join("team.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer_json(public: &[u8; 32], addr: &str) -> String {
        format!(
            r##"{{ "peers": [{{ "id": "{}", "public": "{}", "name": "Bob", "color": "#4da3ff", "addr": "{addr}" }}] }}"##,
            proto::fingerprint(public),
            proto::to_hex(public)
        )
    }

    #[test]
    fn team_file_keeps_only_valid_colleagues() {
        let k = Keys::generate().unwrap();
        let d = parse_data(&peer_json(&k.public, "192.168.1.20")).unwrap();
        assert_eq!(d.peers.len(), 1);
        assert_eq!(d.peers[0].ip(), Some(Ipv4Addr::new(192, 168, 1, 20)));
        // Une adresse publique (modifiée à la main) est oubliée.
        let d = parse_data(&peer_json(&k.public, "8.8.8.8")).unwrap();
        assert!(d.peers[0].addr.is_empty());
        // Une empreinte qui ne correspond pas à la clé : le collègue est retiré.
        let text = peer_json(&k.public, "").replace(&proto::fingerprint(&k.public), "0000000000000000");
        assert!(parse_data(&text).unwrap().peers.is_empty());
        assert!(parse_data("pas du json").is_err());
    }

    #[test]
    fn only_local_addresses() {
        assert!(is_lan(Ipv4Addr::new(192, 168, 0, 4)));
        assert!(is_lan(Ipv4Addr::new(10, 1, 2, 3)));
        assert!(is_lan(Ipv4Addr::new(172, 20, 0, 1)));
        assert!(is_lan(Ipv4Addr::new(169, 254, 3, 3)));
        assert!(!is_lan(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_lan(Ipv4Addr::new(172, 32, 0, 1)));
    }

    #[test]
    fn names_and_sizes() {
        let mut s = Map::new();
        s.insert("name".into(), json!("  Simon  "));
        assert_eq!(my_name(&s), "Simon");
        s.insert("name".into(), json!("\u{202E}"));
        assert!(proto::check_name(&my_name(&s)).is_ok());
        assert_eq!(max_bytes(&Map::new()), 2048 * 1024 * 1024);
        s.insert("maxMb".into(), json!(0));
        assert_eq!(max_bytes(&s), 1024 * 1024);
    }

    #[test]
    fn poll_tally() {
        let mut p = MyPoll { id: 1, question: "Pizza ou sushi ?".into(), choices: vec!["Pizza".into(), "Sushi".into()], votes: HashMap::new() };
        p.votes.insert("a".into(), 1);
        p.votes.insert("b".into(), 1);
        p.votes.insert("c".into(), 0);
        assert_eq!(tally(&p)["counts"], json!([1, 2]));
    }

    #[test]
    fn pings_have_an_emotion() {
        for k in proto::PING_KINDS {
            assert!(!ping_emotion(k).is_empty());
        }
        assert_eq!(ping_emotion("wave"), "wave");
    }
}
