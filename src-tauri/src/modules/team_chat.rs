// Module « Équipe » : le CHAT (1.2.2). Une icône 💬 dans l'onglet Équipe, la
// liste des collègues en ligne, puis un fil de conversation en bulles ; et le
// salon « Toute l'équipe ».
//
// Ce qui passe sur le réseau est le protocole Équipe habituel (team_proto.rs :
// Noise IK, chiffré de bout en bout, sans serveur), avec quatre messages de
// plus : Chat, ChatTyping (« … écrit »), ChatRead (« Lu ») et ChatReact
// (👍 😂 ❤️). Les messages des collègues appairés arrivent directement, sans
// « Accepter » : ils sont déjà de confiance. Mais rien n'y est jamais ouvert
// ni exécuté : un lien ne s'ouvre que sur un clic (`chat_open_link`), et
// seulement un lien http(s) qui est vraiment dans la conversation.
//
// Le salon « Toute l'équipe » n'a pas de serveur non plus : un message part à
// chaque collègue en ligne, et chacun le range dans son salon. On n'y voit donc
// que les messages des collègues avec qui on est appairé.
//
// L'historique :
//   - par défaut, en mémoire seulement (effacé quand on quitte Ondine) ;
//   - réglage « chatKeep » (désactivé par défaut) : gardé 7 jours dans
//     %APPDATA%\Ondine\team-chat.bin, chiffré (ChaCha20-Poly1305) avec une clé
//     tirée au hasard et rangée dans le Gestionnaire d'identifiants
//     (`team-chat-key`, comme la clé d'identité : jamais en clair sur le
//     disque, jamais lisible par le front). Éteindre le réglage efface la clé
//     (l'ancien fichier devient illisible pour de bon) et retire ce fichier
//     interne d'Ondine.
//
// Un glisser de fichier dans le fil, c'est l'envoi de fichier qui existe déjà
// (`send_files`) : toujours à accepter de l'autre côté. Le fil n'en garde
// qu'une ligne (« 📤 Rapport.pdf »).

use crate::sync::LockExt;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::team::{self, Inner, Peer};
use super::team_net;
use super::team_proto::{self as proto, Msg};
use super::ModuleContext;
use crate::platform;
use crate::services::{credentials, log};

/// Le salon « Toute l'équipe » (les conversations à deux ont l'empreinte du collègue).
pub(super) const GROUP: &str = "all";
/// Au plus 500 messages par conversation (les plus anciens partent).
const MAX_PER_ROOM: usize = 500;
/// « Garder 7 jours ».
const KEEP_FOR_MS: u64 = 7 * 24 * 3600 * 1000;
/// « … écrit » s'efface au bout de 6 s sans nouvelle frappe.
const TYPING_FOR: Duration = Duration::from_secs(6);
/// « … écrit » part au plus toutes les 3 s.
const TYPING_EVERY: Duration = Duration::from_secs(3);
/// L'historique gardé est réécrit au plus toutes les 2 s.
const SAVE_EVERY: Duration = Duration::from_secs(2);
/// Le début du fichier chiffré (et sa « donnée associée » : un autre fichier
/// renommé en team-chat.bin ne se déchiffre pas).
const MAGIC: &[u8] = b"ONDCHAT1";
/// Un lien ouvert sur un clic : 2 000 caractères au plus.
const MAX_LINK: usize = 2_000;

// ── Les données ──────────────────────────────────────────────────────────────

/// Une ligne du fil.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Line {
    pub id: u64,
    /// "" = moi ; sinon l'empreinte du collègue.
    pub from: String,
    /// text : un message ; file-out / file-in : un fichier proposé (le texte est son nom).
    #[serde(default = "text_kind")]
    pub kind: String,
    pub text: String,
    pub at: u64,
    /// Mes messages : l'autre les a lus (conversation à deux seulement).
    #[serde(default)]
    pub read: bool,
    /// (qui, réaction) ; qui = "" pour moi. Une réaction par personne.
    #[serde(default)]
    pub reactions: Vec<(String, String)>,
}

fn text_kind() -> String {
    "text".into()
}

impl Line {
    fn new(from: &str, kind: &str, text: String) -> Self {
        Line { id: proto::random_u64(), from: from.into(), kind: kind.into(), text, at: team::now_ms(), read: false, reactions: Vec::new() }
    }
}

/// Toutes les conversations (en mémoire ; sur le disque seulement avec « chatKeep »).
#[derive(Debug, Default)]
pub(super) struct Chat {
    rooms: HashMap<String, Vec<Line>>,
    unread: HashMap<String, u32>,
    /// (conversation, collègue) → dernière frappe vue.
    typing: HashMap<(String, String), Instant>,
    /// Dernier « … écrit » envoyé, par conversation.
    typed: HashMap<String, Instant>,
    /// L'historique gardé a-t-il été relu ? (une fois, quand « chatKeep » est allumé)
    loaded: bool,
    /// « chatKeep » au dernier tour (pour voir quand on l'éteint).
    keep: bool,
    dirty: bool,
    saved: Option<Instant>,
}

/// Ce qu'on garde sur le disque.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    rooms: HashMap<String, Vec<Line>>,
}

impl Chat {
    /// Range une ligne (une seule fois par numéro). Un message d'un collègue
    /// compte comme « non lu ».
    pub fn push(&mut self, room: &str, line: Line) -> bool {
        let lines = self.rooms.entry(room.to_string()).or_default();
        if lines.iter().any(|l| l.id == line.id && l.from == line.from) {
            return false;
        }
        if !line.from.is_empty() {
            *self.unread.entry(room.to_string()).or_default() += 1;
            self.typing.remove(&(room.to_string(), line.from.clone()));
        }
        lines.push(line);
        let extra = lines.len().saturating_sub(MAX_PER_ROOM);
        lines.drain(..extra);
        self.dirty = true;
        true
    }

    /// J'ai lu la conversation : plus rien de non lu. Renvoie le numéro du
    /// dernier message du collègue (pour lui dire « Lu »).
    pub fn read(&mut self, room: &str) -> Option<u64> {
        self.unread.remove(room);
        self.rooms.get(room)?.iter().rev().find(|l| !l.from.is_empty() && l.kind == "text").map(|l| l.id)
    }

    /// Le collègue a lu jusqu'à son message `id` : mes messages d'avant sont « Lu ».
    pub fn read_by_peer(&mut self, room: &str, id: u64) -> bool {
        let Some(lines) = self.rooms.get_mut(room) else { return false };
        let Some(upto) = lines.iter().position(|l| l.id == id && !l.from.is_empty()) else { return false };
        let mut changed = false;
        for l in lines[..upto].iter_mut().filter(|l| l.from.is_empty() && !l.read) {
            l.read = true;
            changed = true;
        }
        self.dirty |= changed;
        changed
    }

    /// Une réaction de `who` ("" = moi) : remplace la sienne ; la même une
    /// deuxième fois l'enlève. Renvoie Some(true) si elle est ajoutée,
    /// Some(false) si elle est enlevée, None si le message n'existe pas.
    pub fn react(&mut self, room: &str, id: u64, who: &str, kind: &str) -> Option<bool> {
        let line = self.rooms.get_mut(room)?.iter_mut().find(|l| l.id == id && l.kind == "text")?;
        let had = line.reactions.iter().any(|(w, k)| w == who && k == kind);
        line.reactions.retain(|(w, _)| w != who);
        if !had {
            line.reactions.push((who.to_string(), kind.to_string()));
        }
        self.dirty = true;
        Some(!had)
    }

    pub fn set_typing(&mut self, room: &str, peer: &str) {
        self.typing.insert((room.to_string(), peer.to_string()), Instant::now());
    }

    /// Qui écrit en ce moment dans cette conversation.
    pub fn typing_in(&self, room: &str) -> Vec<String> {
        let mut who: Vec<String> = self.typing.iter().filter(|((r, _), t)| r == room && t.elapsed() < TYPING_FOR).map(|((_, p), _)| p.clone()).collect();
        who.sort();
        who
    }

    /// Faut-il renvoyer « … écrit » ? (au plus toutes les 3 s)
    fn may_type(&mut self, room: &str) -> bool {
        if self.typed.get(room).is_some_and(|t| t.elapsed() < TYPING_EVERY) {
            return false;
        }
        self.typed.insert(room.to_string(), Instant::now());
        true
    }

    /// Oublie ce qui a plus de 7 jours (historique gardé).
    pub fn prune(&mut self, now: u64) {
        for lines in self.rooms.values_mut() {
            let before = lines.len();
            lines.retain(|l| now.saturating_sub(l.at) < KEEP_FOR_MS);
            self.dirty |= lines.len() != before;
        }
        self.rooms.retain(|_, l| !l.is_empty());
        self.typing.retain(|_, t| t.elapsed() < TYPING_FOR);
    }

    /// Un collègue retiré : sa conversation à deux disparaît.
    pub fn forget(&mut self, peer: &str) {
        self.rooms.remove(peer);
        self.unread.remove(peer);
        self.typing.retain(|(_, p), _| p != peer);
        self.dirty = true;
    }

    pub fn clear(&mut self, room: Option<&str>) {
        match room {
            Some(r) => {
                self.rooms.remove(r);
                self.unread.remove(r);
            }
            None => {
                self.rooms.clear();
                self.unread.clear();
            }
        }
        self.dirty = true;
    }

    /// Le lien est-il dans un message de cette conversation ?
    fn has_link(&self, room: &str, url: &str) -> bool {
        self.rooms.get(room).is_some_and(|lines| lines.iter().any(|l| l.kind == "text" && l.text.split_whitespace().any(|w| trim_link(w) == url)))
    }

    /// Relit l'historique gardé : les conversations en mémoire passent devant.
    fn restore(&mut self, stored: Stored) {
        for (room, lines) in stored.rooms {
            for line in lines {
                let unread = self.unread.get(&room).copied();
                self.push(&room, line);
                // Ce qui était déjà là n'est pas « nouveau ».
                match unread {
                    Some(n) => self.unread.insert(room.clone(), n),
                    None => self.unread.remove(&room),
                };
            }
            if let Some(l) = self.rooms.get_mut(&room) {
                l.sort_by_key(|x| x.at);
            }
        }
    }
}

// ── Les liens ────────────────────────────────────────────────────────────────

/// Un mot du message, sans la ponctuation collée au bout (« https://a.fr). »).
fn trim_link(word: &str) -> &str {
    word.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '»', '"', '\''])
}

/// Un lien qu'on accepte d'ouvrir sur un clic : http ou https, sans espace ni
/// caractère de contrôle ou invisible, de longueur raisonnable. Rien d'autre
/// (pas de file:, de ms-settings:, de chemin, de programme).
pub(super) fn safe_link(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"));
    rest.is_some_and(|r| !r.is_empty() && !r.starts_with('/'))
        && url.chars().count() <= MAX_LINK
        && proto::check_text(url, MAX_LINK, false).is_ok()
        && !url.chars().any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>')
}

// ── Le chiffrement de l'historique gardé ─────────────────────────────────────

/// Chiffre : MAGIC + 12 octets de nonce tiré au hasard + le texte chiffré et
/// authentifié (une modification du fichier le rend illisible, jamais faux).
pub(super) fn seal_store(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|e| format!("hasard indisponible : {e}"))?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let sealed = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad: MAGIC }).map_err(|_| "chiffrement impossible".to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + nonce.len() + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub(super) fn open_store(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    let body = data.strip_prefix(MAGIC).ok_or("ce n'est pas un historique d'Ondine")?;
    if body.len() < 12 + 16 {
        return Err("historique abîmé".into());
    }
    let (nonce, sealed) = body.split_at(12);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    cipher.decrypt(Nonce::from_slice(nonce), Payload { msg: sealed, aad: MAGIC }).map_err(|_| "historique illisible (abîmé, ou clé effacée)".into())
}

fn store_file() -> PathBuf {
    platform::config_dir().join("team-chat.bin")
}

/// La clé de l'historique : relue dans le Gestionnaire d'identifiants, créée
/// la première fois. None hors de Windows (l'historique reste en mémoire).
fn store_key(create: bool) -> Option<[u8; 32]> {
    if let Some(k) = credentials::team_chat_key_get().and_then(|h| proto::from_hex(&h).ok()).and_then(|b| <[u8; 32]>::try_from(b).ok()) {
        return Some(k);
    }
    if !create {
        return None;
    }
    let mut k = [0u8; 32];
    getrandom::fill(&mut k).ok()?;
    match credentials::team_chat_key_set(&proto::to_hex(&k)) {
        Ok(()) => Some(k),
        Err(e) => {
            log::warn(format!("équipe : historique du chat gardé en mémoire seulement ({e})"));
            None
        }
    }
}

fn load_stored() -> Option<Stored> {
    let data = std::fs::read(store_file()).ok()?;
    let key = store_key(false)?;
    match open_store(&key, &data).and_then(|plain| serde_json::from_slice::<Stored>(&plain).map_err(|e| e.to_string())) {
        Ok(s) => Some(s),
        Err(e) => {
            log::warn(format!("équipe : historique du chat non relu ({e})"));
            None
        }
    }
}

fn save_stored(chat: &Chat) -> Result<(), String> {
    let key = store_key(true).ok_or("clé indisponible")?;
    let plain = serde_json::to_vec(&Stored { rooms: chat.rooms.clone() }).map_err(|e| e.to_string())?;
    let sealed = seal_store(&key, &plain)?;
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("team-chat.bin.tmp");
    std::fs::write(&tmp, sealed).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, store_file()).map_err(|e| e.to_string())
}

/// « Garder 7 jours » éteint : la clé est effacée (l'ancien fichier devient
/// illisible pour de bon), puis ce fichier interne d'Ondine est retiré. (Ce
/// n'est pas un fichier de l'utilisateur : sans sa clé, il ne contient plus
/// rien de lisible.)
fn wipe_stored() {
    if let Err(e) = credentials::team_chat_key_delete() {
        log::warn(format!("équipe : clé de l'historique non effacée ({e})"));
    }
    let _ = std::fs::remove_file(store_file());
}

// ── L'entretien (appelé chaque seconde par team_net::housekeeping) ───────────

pub(super) fn tick(app: &AppHandle, inner: &Inner) {
    let keep = keep_on(app);
    let mut chat = inner.chat.locked();
    if keep && !chat.loaded {
        chat.loaded = true;
        if let Some(stored) = load_stored() {
            chat.restore(stored);
            chat.prune(team::now_ms());
            drop(chat);
            team::emit(app, "team.chat", json!({ "kind": "changed" }));
            chat = inner.chat.locked();
        }
    }
    if chat.keep && !keep {
        chat.loaded = false;
        wipe_stored();
        log::info("équipe : historique du chat effacé du disque (réglage éteint)");
    }
    if keep != chat.keep {
        chat.keep = keep;
        chat.dirty = true;
    }
    chat.typing.retain(|_, t| t.elapsed() < TYPING_FOR);
    if keep && chat.dirty && chat.saved.is_none_or(|t| t.elapsed() >= SAVE_EVERY) {
        chat.prune(team::now_ms());
        chat.dirty = false;
        chat.saved = Some(Instant::now());
        if let Err(e) = save_stored(&chat) {
            log::warn(format!("équipe : historique du chat non enregistré ({e})"));
        }
    }
}

fn keep_on(app: &AppHandle) -> bool {
    team::settings(app).get("chatKeep").and_then(Value::as_bool).unwrap_or(false)
}

/// « … écrit » et « Lu » (réglage « chatReceipts », allumé par défaut) : dans
/// les deux sens. Éteint, on n'envoie rien et on ignore ceux des autres.
fn receipts_on(app: &AppHandle) -> bool {
    team::settings(app).get("chatReceipts").and_then(Value::as_bool).unwrap_or(true)
}

// ── Ce qui arrive ────────────────────────────────────────────────────────────

/// L'expression de la mascotte pour une réaction reçue.
pub(super) fn reaction_emotion(kind: &str) -> &'static str {
    match kind {
        "thumb" => "proud",
        "laugh" => "laugh",
        _ => "love",
    }
}

fn room_of(peer: &Peer, group: bool) -> String {
    if group {
        GROUP.into()
    } else {
        peer.id.clone()
    }
}

/// Un message du chat d'un collègue (déjà authentifié et vérifié).
pub(super) fn on_message(app: &AppHandle, inner: &Inner, peer: &Peer, msg: Msg) -> Msg {
    match msg {
        Msg::Chat { id, text, group } => {
            let room = room_of(peer, group);
            let line = Line { id, from: peer.id.clone(), kind: "text".into(), text, at: team::now_ms(), read: false, reactions: Vec::new() };
            let fresh = inner.chat.locked().push(&room, line.clone());
            if fresh {
                team::emit(app, "team.chat", json!({ "kind": "message", "room": room, "line": line, "from": card(peer) }));
            }
            Msg::Ok
        }
        Msg::ChatTyping { group } => {
            if receipts_on(app) {
                let room = room_of(peer, group);
                inner.chat.locked().set_typing(&room, &peer.id);
                team::emit(app, "team.chat", json!({ "kind": "typing", "room": room, "from": card(peer) }));
            }
            Msg::Ok
        }
        Msg::ChatRead { id } => {
            if receipts_on(app) && inner.chat.locked().read_by_peer(&peer.id, id) {
                team::emit(app, "team.chat", json!({ "kind": "read", "room": peer.id, "from": card(peer) }));
            }
            Msg::Ok
        }
        Msg::ChatReact { id, kind, group } => {
            let room = room_of(peer, group);
            let added = inner.chat.locked().react(&room, id, &peer.id, &kind);
            if let Some(added) = added {
                // La mascotte de l'île joue la réaction, sauf en concentration ou en réunion.
                let (status, _) = team::my_status(app, inner);
                if added && !matches!(status.as_str(), "focus" | "meeting") {
                    team::emit(app, "mascot.emote", json!({ "emotion": reaction_emotion(&kind) }));
                }
                team::emit(app, "team.chat", json!({ "kind": "react", "room": room, "id": id, "reaction": kind, "added": added, "from": card(peer) }));
            }
            Msg::Ok
        }
        _ => Msg::Refused { reason: "message inattendu".into() },
    }
}

/// Un fichier proposé par un collègue : une ligne dans la conversation à deux
/// (il attend toujours « Accepter », comme avant).
pub(super) fn note_offer(app: &AppHandle, inner: &Inner, peer: &Peer, name: &str) {
    let line = Line::new(&peer.id, "file-in", name.to_string());
    let mut chat = inner.chat.locked();
    chat.push(&peer.id, line.clone());
    // Le fichier a sa propre notification (« Accepter ») : pas un « non lu » de plus.
    if let Some(n) = chat.unread.get_mut(&peer.id) {
        *n = n.saturating_sub(1);
    }
    drop(chat);
    team::emit(app, "team.chat", json!({ "kind": "changed", "room": peer.id }));
}

fn card(peer: &Peer) -> Value {
    json!({ "id": peer.id, "name": peer.name, "color": peer.color, "mascot": peer.mascot })
}

// ── Les commandes du front (chat_*) ──────────────────────────────────────────

pub(super) fn invoke(ctx: &ModuleContext, inner: &Arc<Inner>, command: &str, args: &Value) -> Result<Value, String> {
    let room = args.get("room").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let check_room = |room: &str| -> Result<(), String> {
        if room == GROUP || inner.peer(room).is_ok() {
            Ok(())
        } else {
            Err("conversation inconnue".into())
        }
    };
    match command {
        // → { rooms: [{ room, unread, last, typing }], keep, receipts }
        "chat_state" => {
            let chat = inner.chat.locked();
            let rooms: Vec<Value> = chat
                .rooms
                .iter()
                .map(|(room, lines)| {
                    json!({
                        "room": room,
                        "unread": chat.unread.get(room).copied().unwrap_or(0),
                        "last": lines.last(),
                        "typing": chat.typing_in(room),
                    })
                })
                .collect();
            let s = ctx.settings();
            Ok(json!({
                "rooms": rooms,
                "keep": s.get("chatKeep").and_then(Value::as_bool).unwrap_or(false),
                "receipts": s.get("chatReceipts").and_then(Value::as_bool).unwrap_or(true),
            }))
        }
        // { room } → { lines, typing }
        "chat_history" => {
            check_room(&room)?;
            let chat = inner.chat.locked();
            Ok(json!({ "lines": chat.rooms.get(&room).cloned().unwrap_or_default(), "typing": chat.typing_in(&room) }))
        }
        // { room, text } → la ligne rangée
        "chat_send" => {
            check_room(&room)?;
            let text = args.get("text").and_then(Value::as_str).unwrap_or("").trim_end().to_string();
            if text.chars().count() > proto::MAX_CHAT {
                return Err(format!("message trop long ({} caractères au plus)", proto::MAX_CHAT));
            }
            let line = Line::new("", "text", text);
            let group = room == GROUP;
            let msg = Msg::Chat { id: line.id, text: line.text.clone(), group };
            msg.check()?;
            if group {
                if team::broadcast(ctx, inner, &[], &msg)? == 0 {
                    return Err("personne n'a reçu le message (collègues injoignables)".into());
                }
            } else {
                team::send_to(ctx, inner, &room, &msg)?;
            }
            inner.chat.locked().push(&room, line.clone());
            Ok(serde_json::to_value(&line).map_err(|e| e.to_string())?)
        }
        // { room } : « … écrit » (au plus toutes les 3 s ; rien si « chatReceipts » est éteint).
        "chat_typing" => {
            check_room(&room)?;
            if !receipts_on(ctx.app) || !inner.chat.locked().may_type(&room) {
                return Ok(Value::Null);
            }
            let group = room == GROUP;
            send_quietly(inner, &room, Msg::ChatTyping { group });
            Ok(Value::Null)
        }
        // { room } : j'ai lu (et je le dis à l'autre, conversation à deux).
        "chat_read" => {
            check_room(&room)?;
            let last = inner.chat.locked().read(&room);
            if let Some(id) = last.filter(|_| room != GROUP && receipts_on(ctx.app)) {
                send_quietly(inner, &room, Msg::ChatRead { id });
            }
            Ok(Value::Null)
        }
        // { room, id, kind: thumb | laugh | heart }
        "chat_react" => {
            check_room(&room)?;
            let kind = args.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
            let id = args.get("id").and_then(Value::as_u64).unwrap_or(0);
            let group = room == GROUP;
            let msg = Msg::ChatReact { id, kind: kind.clone(), group };
            msg.check()?;
            let added = inner.chat.locked().react(&room, id, "", &kind).ok_or("message introuvable")?;
            send_quietly(inner, &room, msg);
            Ok(json!({ "added": added }))
        }
        // { room, paths } : l'envoi de fichier habituel (toujours à accepter), noté dans le fil.
        "chat_files" => {
            if room == GROUP {
                return Err("glissez le fichier dans une conversation à deux".into());
            }
            check_room(&room)?;
            let paths: Vec<String> = args.get("paths").and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect();
            let sent = team::send_files(ctx, inner, &room, &paths)?;
            let name = sent.get("name").and_then(Value::as_str).unwrap_or("fichier").to_string();
            inner.chat.locked().push(&room, Line::new("", "file-out", name));
            Ok(sent)
        }
        // { room? } : efface une conversation (ou toutes) de la mémoire (et du disque au prochain tour).
        "chat_clear" => {
            inner.chat.locked().clear(if room.is_empty() { None } else { Some(room.as_str()) });
            Ok(Value::Null)
        }
        // { room, url } : seulement un lien http(s) qui est vraiment dans la conversation, sur un clic.
        "chat_open_link" => {
            check_room(&room)?;
            let url = args.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            if !safe_link(&url) || !inner.chat.locked().has_link(&room, &url) {
                return Err("lien refusé (seulement http ou https, tel qu'il est dans la conversation)".into());
            }
            platform::shell_open(&url).map_err(|e| format!("lien non ouvert : {e}"))?;
            Ok(Value::Null)
        }
        other => Err(format!("commande inconnue : {other}")),
    }
}

/// Envoie sans attendre ni rien dire en cas d'échec (« … écrit », « Lu »,
/// réactions) : au collègue, ou à toute l'équipe en ligne.
fn send_quietly(inner: &Arc<Inner>, room: &str, msg: Msg) {
    let peers: Vec<Peer> = {
        let all = inner.peers();
        let s = inner.state.locked();
        all.into_iter().filter(|p| if room == GROUP { s.live.get(&p.id).is_some_and(team_net::online) } else { p.id == room }).collect()
    };
    let inner = inner.clone();
    std::thread::spawn(move || {
        for p in peers {
            let _ = team_net::request(&inner, &p, &msg);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: u64, from: &str, text: &str) -> Line {
        Line { id, from: from.into(), kind: "text".into(), text: text.into(), at: team::now_ms(), read: false, reactions: Vec::new() }
    }

    #[test]
    fn messages_are_kept_once_and_counted_unread() {
        let mut c = Chat::default();
        assert!(c.push("bob", line(1, "bob", "Salut")));
        assert!(!c.push("bob", line(1, "bob", "Salut")), "le même message deux fois : une seule ligne");
        assert!(c.push("bob", line(2, "", "Coucou")));
        assert_eq!(c.unread.get("bob"), Some(&1));
        assert_eq!(c.read("bob"), Some(1));
        assert_eq!(c.unread.get("bob"), None);
        for i in 0..(MAX_PER_ROOM as u64 + 20) {
            c.push("all", line(100 + i, "x", "m"));
        }
        assert_eq!(c.rooms["all"].len(), MAX_PER_ROOM);
    }

    #[test]
    fn read_receipts_mark_only_my_earlier_messages() {
        let mut c = Chat::default();
        c.push("bob", line(1, "", "Tu viens ?"));
        c.push("bob", line(2, "", "On commence"));
        c.push("bob", line(3, "bob", "J'arrive"));
        c.push("bob", line(4, "", "Super"));
        assert!(c.read_by_peer("bob", 3));
        let read: Vec<bool> = c.rooms["bob"].iter().map(|l| l.read).collect();
        assert_eq!(read, vec![true, true, false, false]);
        // Un numéro inconnu, ou un de MES messages : rien ne change.
        assert!(!c.read_by_peer("bob", 99));
        assert!(!c.read_by_peer("bob", 4));
    }

    #[test]
    fn reactions_toggle_one_per_person() {
        let mut c = Chat::default();
        c.push("all", line(1, "bob", "Pizza ?"));
        assert_eq!(c.react("all", 1, "", "thumb"), Some(true));
        assert_eq!(c.react("all", 1, "", "heart"), Some(true));
        assert_eq!(c.rooms["all"][0].reactions, vec![(String::new(), "heart".to_string())]);
        assert_eq!(c.react("all", 1, "", "heart"), Some(false));
        assert!(c.rooms["all"][0].reactions.is_empty());
        assert_eq!(c.react("all", 42, "", "thumb"), None);
        for k in proto::REACTIONS {
            assert!(!reaction_emotion(k).is_empty());
        }
    }

    #[test]
    fn typing_fades_and_a_message_clears_it() {
        let mut c = Chat::default();
        c.set_typing("bob", "bob");
        assert_eq!(c.typing_in("bob"), vec!["bob".to_string()]);
        c.push("bob", line(1, "bob", "Voilà"));
        assert!(c.typing_in("bob").is_empty());
        assert!(c.may_type("bob"));
        assert!(!c.may_type("bob"), "au plus toutes les 3 s");
    }

    #[test]
    fn seven_days_then_gone() {
        let mut c = Chat::default();
        let mut old = line(1, "bob", "vieux");
        old.at = team::now_ms() - KEEP_FOR_MS - 1;
        c.push("bob", old);
        c.push("bob", line(2, "bob", "récent"));
        c.prune(team::now_ms());
        assert_eq!(c.rooms["bob"].len(), 1);
        c.forget("bob");
        assert!(!c.rooms.contains_key("bob"));
    }

    #[test]
    fn only_plain_web_links_open_and_only_from_the_conversation() {
        assert!(safe_link("https://exemple.fr/page?a=1"));
        assert!(safe_link("http://intranet.local/wiki"));
        for bad in ["file:///C:/Windows/System32/calc.exe", "ms-settings:privacy", "javascript:alert(1)", "https://", "https:///x", "https://a.fr/\u{202E}exe", "https://a.fr/ b", "C:\\x.exe", "\\\\serveur\\partage"] {
            assert!(!safe_link(bad), "{bad}");
        }
        let mut c = Chat::default();
        c.push("bob", line(1, "bob", "Regarde https://exemple.fr/doc. C'est bien"));
        assert!(c.has_link("bob", "https://exemple.fr/doc"));
        assert!(!c.has_link("bob", "https://autre.fr"));
        assert!(!c.has_link("alice", "https://exemple.fr/doc"));
    }

    #[test]
    fn stored_history_is_encrypted_and_tamper_proof() {
        let key = [7u8; 32];
        let plain = br#"{"rooms":{"bob":[]}}"#;
        let sealed = seal_store(&key, plain).unwrap();
        assert!(sealed.starts_with(MAGIC));
        assert!(!String::from_utf8_lossy(&sealed).contains("bob"), "rien en clair sur le disque");
        assert_eq!(open_store(&key, &sealed).unwrap(), plain);
        // Deux chiffrements du même texte ne se ressemblent pas (nonce neuf).
        assert_ne!(seal_store(&key, plain).unwrap(), sealed);
        let mut bad = sealed.clone();
        let last = bad.len() - 1;
        bad[last] ^= 1;
        assert!(open_store(&key, &bad).is_err());
        assert!(open_store(&[8u8; 32], &sealed).is_err(), "une autre clé (effacée puis recréée) ne lit rien");
        assert!(open_store(&key, b"ONDCHAT1court").is_err());
        assert!(open_store(&key, b"autre chose").is_err());
    }

    #[test]
    fn restoring_keeps_what_is_in_memory() {
        let mut c = Chat::default();
        c.push("bob", line(5, "bob", "nouveau"));
        let mut stored = Stored::default();
        let mut old = line(4, "bob", "ancien");
        old.at -= 1000;
        stored.rooms.insert("bob".into(), vec![old, line(5, "bob", "nouveau")]);
        c.restore(stored);
        let texts: Vec<&str> = c.rooms["bob"].iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, vec!["ancien", "nouveau"]);
        assert_eq!(c.unread.get("bob"), Some(&1), "l'ancien n'est pas un nouveau non lu");
    }
}
