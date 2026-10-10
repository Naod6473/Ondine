// Module « Équipe » : le réseau (les fils de fond). Le protocole est dans
// team_proto.rs, l'état et les messages dans team.rs.
//
// Trois fils, qui ne font RIEN tant que le module est désactivé (aucun port
// ouvert) :
//   - l'écoute TCP sur le port 47821 (toutes les cartes, mais une connexion
//     qui ne vient pas d'une adresse du réseau local est fermée tout de suite ;
//     16 connexions à la fois au plus). Le pare-feu de Windows demande
//     l'autorisation la première fois, comme pour « Vers le téléphone » ;
//   - la découverte UDP sur le port 47820 : « je suis là » toutes les 30 s
//     sur l'adresse de diffusion de chaque carte, seulement si « Visible » ;
//     et « qui est là ? » quand on clique sur « Chercher ». Invisible, on
//     écoute quand même les annonces des autres (pour les proposer), sans
//     jamais répondre ;
//   - l'entretien, chaque seconde : présence envoyée aux collègues toutes les
//     minutes (ou tout de suite quand le statut change), demandes expirées,
//     presse-papiers et mascotte entre mes PC.
//
// Un envoi de fichier : l'envoyeur propose (Offer), le destinataire clique
// « Accepter », puis c'est LUI qui vient chercher le fichier (Pull) : rien
// n'arrive sur un PC sans qu'on l'ait accepté.

use crate::sync::LockExt;
use std::collections::HashSet;
use std::fs::File;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::team::{self, Inner, Live, Nearby, Peer, Source, ID};
use super::team_proto::{self as proto, Announce, Msg, Packet};
use crate::platform;
use crate::services::{files, lan, log};

/// Un collègue est « en ligne » s'il a répondu (ou appelé) il y a moins de 2 min 30.
const OFFLINE_AFTER: Duration = Duration::from_secs(150);
/// La présence part toutes les minutes.
const HEARTBEAT: Duration = Duration::from_secs(60);
/// « Je suis là » toutes les 30 s (si Visible) ; une voisine silencieuse
/// depuis 75 s disparaît de la liste.
const ANNOUNCE_EVERY: Duration = Duration::from_secs(30);
pub(super) const NEARBY_FOR: Duration = Duration::from_secs(75);
const MAX_NEARBY: usize = 50;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const IO_TIMEOUT: Duration = Duration::from_secs(15);
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_CONNECTIONS: usize = 16;
/// La progression d'un envoi : au plus 4 nouvelles par seconde.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// « Chercher » : le fil de découverte envoie « qui est là ? » au prochain tour.
static QUERY: AtomicBool = AtomicBool::new(true);

pub(super) fn query_nearby() {
    QUERY.store(true, Ordering::SeqCst);
}

pub(super) fn online(l: &Live) -> bool {
    l.seen.is_some_and(|t| t.elapsed() < OFFLINE_AFTER)
}

pub(super) fn start(app: &AppHandle, inner: Arc<Inner>) {
    for job in [listen as fn(AppHandle, Arc<Inner>), discover, housekeeping] {
        let (app, inner) = (app.clone(), inner.clone());
        std::thread::spawn(move || job(app, inner));
    }
}

// ── Se connecter à un collègue ───────────────────────────────────────────────

fn connect(ip: Ipv4Addr, timeout: Duration) -> std::io::Result<TcpStream> {
    let s = TcpStream::connect_timeout(&SocketAddr::from((ip, proto::SERVICE_PORT)), CONNECT_TIMEOUT)?;
    s.set_read_timeout(Some(timeout))?;
    s.set_write_timeout(Some(timeout))?;
    let _ = s.set_nodelay(true);
    Ok(s)
}

fn unreachable(peer: &Peer) -> String {
    format!("{} ne répond pas (PC éteint, autre réseau, ou pare-feu de Windows qui bloque Ondine)", peer.name)
}

/// Ouvre une session chiffrée avec un collègue, envoie `msg`, lit la réponse.
pub(super) fn request(inner: &Inner, peer: &Peer, msg: &Msg) -> Result<Msg, String> {
    let ip = peer.ip().ok_or_else(|| format!("adresse de {} inconnue : il doit être allumé et visible, ou ajoutez-le par son adresse IP", peer.name))?;
    let key = peer.public_key()?;
    let keys = inner.keys()?;
    let mut s = connect(ip, IO_TIMEOUT).map_err(|_| unreachable(peer))?;
    let mut ch = proto::client_session(&mut s, &keys, &key).map_err(|_| unreachable(peer))?;
    proto::send(&mut s, &mut ch, msg)?;
    let reply = proto::recv(&mut s, &mut ch)?;
    inner.seen(&peer.id, None);
    if let Msg::Hello(h) = &reply {
        inner.state.locked().live.entry(peer.id.clone()).or_default().hello = Some(h.clone());
    }
    Ok(reply)
}

/// « Ajouter » : l'appairage avec le PC qui affiche le code.
pub(super) fn pair_with(app: &AppHandle, inner: &Inner, ip: Ipv4Addr, code: &str, mine: bool) -> Result<Peer, String> {
    let keys = inner.keys()?;
    let card = team::my_card(app, inner, mine);
    let mut s = connect(ip, IO_TIMEOUT).map_err(|_| "ce PC ne répond pas : Ondine y est-elle lancée, avec le module Équipe activé ? (le pare-feu de Windows peut aussi bloquer)".to_string())?;
    let paired = proto::client_pair(&mut s, code, &keys, card)?;
    team::add_peer(app, inner, &paired, ip, mine)
}

// ── L'écoute (TCP 47821) ─────────────────────────────────────────────────────

fn listen(app: AppHandle, inner: Arc<Inner>) {
    let mut listener: Option<TcpListener> = None;
    let busy = Arc::new(AtomicUsize::new(0));
    let mut warned = false;
    loop {
        if !super::is_active(&app, ID) {
            listener = None; // le port se ferme
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        if listener.is_none() {
            match TcpListener::bind((Ipv4Addr::UNSPECIFIED, proto::SERVICE_PORT)).and_then(|l| l.set_nonblocking(true).map(|_| l)) {
                Ok(l) => {
                    log::info("équipe : à l'écoute sur le réseau local (port 47821)");
                    listener = Some(l);
                    warned = false;
                }
                Err(e) => {
                    if !warned {
                        log::warn(format!("équipe : port 47821 indisponible ({e})"));
                        warned = true;
                    }
                    std::thread::sleep(Duration::from_secs(10));
                    continue;
                }
            }
        }
        let Some(l) = &listener else { continue };
        match l.accept() {
            Ok((stream, addr)) => {
                let ip = match addr.ip() {
                    IpAddr::V4(v4) => v4,
                    IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
                        Some(v4) => v4,
                        None => continue,
                    },
                };
                // Pas du réseau local, ou trop de monde : fermée tout de suite.
                if !team::is_lan(ip) || busy.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    continue;
                }
                busy.fetch_add(1, Ordering::SeqCst);
                let (app, inner, busy) = (app.clone(), inner.clone(), busy.clone());
                std::thread::spawn(move || {
                    if catch_unwind(AssertUnwindSafe(|| handle(&app, &inner, stream, ip))).is_err() {
                        log::warn("équipe : erreur inattendue sur une connexion");
                    }
                    busy.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => std::thread::sleep(Duration::from_millis(500)),
        }
    }
}

/// Une connexion entrante : appairage (si un code est affiché) ou échange.
fn handle(app: &AppHandle, inner: &Arc<Inner>, mut s: TcpStream, ip: Ipv4Addr) {
    // Une connexion acceptée peut hériter du « sans attente » de l'écoute (Windows).
    let _ = s.set_nonblocking(false);
    let _ = s.set_read_timeout(Some(IO_TIMEOUT));
    let _ = s.set_write_timeout(Some(IO_TIMEOUT));
    let mut mode = [0u8; 1];
    if s.read_exact(&mut mode).is_err() {
        return;
    }
    let Ok(keys) = inner.keys() else { return };
    match mode[0] {
        proto::MODE_PAIR => {
            // Pas de code affiché (ou expiré) : on ferme sans rien dire. Le
            // code est consommé dès maintenant : un seul essai.
            let Some((code, mine)) = team::take_code(inner) else { return };
            let card = team::my_card(app, inner, mine);
            match proto::server_pair(&mut s, &code, &keys, card) {
                Ok(paired) => {
                    let mine = mine || paired.info.mine;
                    if let Err(e) = team::add_peer(app, inner, &paired, ip, mine) {
                        team::event(app, "pair-failed", None, json!({ "error": e }));
                    }
                }
                Err(e) => {
                    log::info("équipe : appairage refusé (code faux ou interrompu)");
                    team::event(app, "pair-failed", None, json!({ "error": e }));
                    team::emit(app, "team.changed", Value::Null);
                }
            }
        }
        proto::MODE_SESSION => {
            let Ok((mut ch, key)) = proto::server_session(&mut s, &keys, |k| inner.peer_by_key(k).is_some()) else { return };
            let Some(peer) = inner.peer_by_key(&key) else { return };
            inner.seen(&peer.id, Some(ip));
            let Ok(msg) = proto::recv(&mut s, &mut ch) else { return };
            if let Msg::Pull { id } = msg {
                serve_pull(app, inner, &peer, id, &mut s, &mut ch);
                return;
            }
            let reply = team::on_message(app, inner, &peer, msg);
            let _ = proto::send(&mut s, &mut ch, &reply);
        }
        _ => {}
    }
}

// ── Les fichiers ─────────────────────────────────────────────────────────────

fn progress(app: &AppHandle, id: u64, name: &str, peer: &Peer, done: u64, size: u64, dir: &str) {
    let percent = done.saturating_mul(100).checked_div(size).map_or(100, |p| p.min(100));
    team::emit(app, "team.progress", json!({ "id": id, "name": name, "percent": percent, "dir": dir, "peer": peer.id, "peerName": peer.name }));
}

/// Le collègue a accepté : il vient chercher le fichier proposé.
fn serve_pull(app: &AppHandle, inner: &Inner, peer: &Peer, id: u64, s: &mut TcpStream, ch: &mut proto::Channel) {
    let offer = {
        let st = inner.state.locked();
        st.outgoing.get(&id).filter(|o| o.peer == peer.id && Instant::now() < o.until).map(|o| (o.name.clone(), o.size, o.source.clone()))
    };
    let Some((name, size, source)) = offer else {
        let _ = proto::send(s, ch, &Msg::Refused { reason: "envoi expiré".into() });
        return;
    };
    let _ = s.set_write_timeout(Some(TRANSFER_TIMEOUT));
    let _ = s.set_read_timeout(Some(TRANSFER_TIMEOUT));
    let result = (|| -> Result<(), String> {
        proto::send(s, ch, &Msg::FileStart { size })?;
        let mut hasher = Sha256::new();
        let mut sent = 0u64;
        let mut last = Instant::now();
        let mut push = |data: &[u8], s: &mut TcpStream, ch: &mut proto::Channel| -> Result<(), String> {
            hasher.update(data);
            proto::write_frame(s, &ch.seal_chunk(data)?)?;
            sent += data.len() as u64;
            if last.elapsed() >= PROGRESS_EVERY {
                last = Instant::now();
                progress(app, id, &name, peer, sent, size, "out");
            }
            Ok(())
        };
        match &source {
            Source::File(path) => {
                let mut f = File::open(path).map_err(|e| format!("fichier illisible : {e}"))?;
                let mut buf = vec![0u8; proto::CHUNK];
                let mut left = size;
                while left > 0 {
                    let want = usize::try_from(left).unwrap_or(usize::MAX).min(buf.len());
                    let n = f.read(&mut buf[..want]).map_err(|e| e.to_string())?;
                    if n == 0 {
                        return Err("le fichier a changé pendant l'envoi".into());
                    }
                    push(&buf[..n], s, ch)?;
                    left -= n as u64;
                }
            }
            Source::Bytes(bytes) => {
                for c in bytes.chunks(proto::CHUNK) {
                    push(c, s, ch)?;
                }
            }
        }
        proto::send(s, ch, &Msg::FileEnd { sha256: proto::to_hex(&hasher.finalize()) })?;
        match proto::recv(s, ch)? {
            Msg::Ok => Ok(()),
            _ => Err("le collègue n'a pas confirmé la réception".into()),
        }
    })();
    inner.state.locked().outgoing.remove(&id);
    match result {
        Ok(()) => {
            progress(app, id, &name, peer, size, size, "out");
            team::event(app, "sent", Some(peer), json!({ "name": name }));
        }
        Err(e) => team::event(app, "send-failed", Some(peer), json!({ "name": name, "error": e })),
    }
}

/// « Accepter » un fichier : on va le chercher, on l'écrit dans
/// Téléchargements\Ondine sous un nom libre (jamais d'écrasement), on vérifie
/// son empreinte SHA-256, et on le marque « venu d'ailleurs ».
#[allow(clippy::too_many_arguments)]
pub(super) fn pull_file(app: AppHandle, inner: Arc<Inner>, peer: Peer, remote: u64, name: String, size: u64, folder: bool, dir: PathBuf, max: u64) {
    std::thread::spawn(move || {
        let mut part: Option<PathBuf> = None;
        let result = catch_unwind(AssertUnwindSafe(|| receive(&app, &inner, &peer, remote, &name, size, &dir, max, &mut part))).unwrap_or_else(|_| Err("erreur inattendue".into()));
        match result {
            Ok(dest) => {
                log::info("équipe : fichier reçu d'un collègue");
                team::event(&app, "received", Some(&peer), json!({ "name": name, "path": dest.display().to_string(), "folder": folder }));
            }
            Err(e) => {
                // Un fichier à moitié reçu : à la Corbeille, jamais supprimé.
                if let Some(p) = part.filter(|p| p.exists()) {
                    let _ = files::to_trash(&[p]);
                }
                team::event(&app, "receive-failed", Some(&peer), json!({ "name": name, "error": e }));
            }
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn receive(app: &AppHandle, inner: &Inner, peer: &Peer, remote: u64, name: &str, size: u64, dir: &std::path::Path, max: u64, part: &mut Option<PathBuf>) -> Result<PathBuf, String> {
    let ip = peer.ip().ok_or_else(|| unreachable(peer))?;
    let keys = inner.keys()?;
    let mut s = connect(ip, TRANSFER_TIMEOUT).map_err(|_| unreachable(peer))?;
    let mut ch = proto::client_session(&mut s, &keys, &peer.public_key()?).map_err(|_| unreachable(peer))?;
    proto::send(&mut s, &mut ch, &Msg::Pull { id: remote })?;
    match proto::recv(&mut s, &mut ch)? {
        // La taille annoncée doit être celle de la proposition acceptée.
        Msg::FileStart { size: n } if n == size && n <= max => {}
        Msg::Refused { reason } => return Err(reason),
        _ => return Err("réponse inattendue".into()),
    }
    let tmp = files::unique_dest(dir, std::ffi::OsStr::new(&format!("{name}.part")));
    let mut f = File::options().write(true).create_new(true).open(&tmp).map_err(|e| format!("écriture impossible : {e}"))?;
    *part = Some(tmp.clone());
    let mut hasher = Sha256::new();
    let mut got = 0u64;
    let mut last = Instant::now();
    while got < size {
        match ch.open_packet(&proto::read_frame(&mut s)?)? {
            Packet::Chunk(c) => {
                got += c.len() as u64;
                if got > size {
                    return Err("le fichier dépasse la taille annoncée".into());
                }
                hasher.update(&c);
                f.write_all(&c).map_err(|e| format!("écriture impossible : {e}"))?;
                if last.elapsed() >= PROGRESS_EVERY {
                    last = Instant::now();
                    progress(app, remote, name, peer, got, size, "in");
                }
            }
            Packet::Msg(_) => return Err("envoi interrompu".into()),
        }
    }
    let Msg::FileEnd { sha256 } = proto::recv(&mut s, &mut ch)? else { return Err("fin d'envoi manquante".into()) };
    if sha256 != proto::to_hex(&hasher.finalize()) {
        return Err("fichier abîmé en route (empreinte différente)".into());
    }
    f.flush().and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    drop(f);
    let _ = proto::send(&mut s, &mut ch, &Msg::Ok);
    // Le nom libre est choisi au dernier moment (un fichier du même nom a pu arriver entre-temps).
    let dest = files::unique_dest(dir, std::ffi::OsStr::new(name));
    std::fs::rename(&tmp, &dest).map_err(|e| format!("impossible de nommer le fichier : {e}"))?;
    *part = None;
    mark_of_the_web(&dest);
    progress(app, remote, name, peer, size, size, "in");
    Ok(dest)
}

/// La « marque du Web » (flux Zone.Identifier) : Windows et Office traitent le
/// fichier comme venu d'ailleurs (SmartScreen avant d'ouvrir un programme,
/// mode protégé pour un document).
#[cfg(windows)]
fn mark_of_the_web(path: &std::path::Path) {
    let mut ads = path.as_os_str().to_owned();
    ads.push(":Zone.Identifier");
    let _ = std::fs::write(PathBuf::from(ads), "[ZoneTransfer]\r\nZoneId=3\r\n");
}

#[cfg(not(windows))]
fn mark_of_the_web(_path: &std::path::Path) {}

// ── La découverte (UDP 47820) ────────────────────────────────────────────────

/// Les adresses de diffusion de chaque carte du réseau local, plus la générale.
fn broadcast_targets() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = lan::ipv4_cards().iter().filter(|c| c.addr.is_private()).filter_map(|c| lan::broadcast(c.addr, c.prefix)).collect();
    out.push(Ipv4Addr::BROADCAST);
    out.sort();
    out.dedup();
    out
}

fn discover(app: AppHandle, inner: Arc<Inner>) {
    let mut sock: Option<UdpSocket> = None;
    let mut last_announce: Option<Instant> = None;
    let mut warned = false;
    let mut buf = [0u8; proto::MAX_ANNOUNCE + 1];
    loop {
        if !super::is_active(&app, ID) {
            sock = None;
            last_announce = None;
            QUERY.store(true, Ordering::SeqCst);
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        if sock.is_none() {
            let bound = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, proto::DISCOVERY_PORT))
                .and_then(|s| s.set_broadcast(true).map(|_| s))
                .and_then(|s| s.set_read_timeout(Some(Duration::from_millis(500))).map(|_| s));
            match bound {
                Ok(s) => {
                    sock = Some(s);
                    warned = false;
                }
                Err(e) => {
                    if !warned {
                        log::warn(format!("équipe : découverte indisponible, port 47820 ({e}) ; l'ajout par adresse IP reste possible"));
                        warned = true;
                    }
                    std::thread::sleep(Duration::from_secs(10));
                    continue;
                }
            }
        }
        let Some(s) = &sock else { continue };
        let step = catch_unwind(AssertUnwindSafe(|| discover_step(&app, &inner, s, &mut last_announce, &mut buf)));
        if step.is_err() {
            log::warn("équipe : erreur inattendue dans la découverte, on continue");
            std::thread::sleep(Duration::from_secs(1));
        }
    }
}

fn discover_step(app: &AppHandle, inner: &Inner, s: &UdpSocket, last_announce: &mut Option<Instant>, buf: &mut [u8]) {
    let settings = team::settings(app);
    let visible = settings.get("visible").and_then(Value::as_bool).unwrap_or(false);
    let Ok(my_id) = inner.my_id() else { return };
    let me = {
        let card = team::my_card(app, inner, false);
        Announce::me(&my_id, &card.name, &card.color)
    };
    if QUERY.swap(false, Ordering::SeqCst) {
        let q = Announce::query().encode();
        for t in broadcast_targets() {
            let _ = s.send_to(&q, (t, proto::DISCOVERY_PORT));
        }
    }
    if visible && last_announce.is_none_or(|t| t.elapsed() >= ANNOUNCE_EVERY) {
        *last_announce = Some(Instant::now());
        let bytes = me.encode();
        for t in broadcast_targets() {
            let _ = s.send_to(&bytes, (t, proto::DISCOVERY_PORT));
        }
    }
    let Ok((n, from)) = s.recv_from(buf) else { return };
    let IpAddr::V4(ip) = from.ip() else { return };
    if !team::is_lan(ip) {
        return;
    }
    let Some(a) = Announce::parse(&buf[..n]) else { return };
    if a.query {
        // On ne répond que si on est visible.
        if visible {
            let _ = s.send_to(&me.encode(), from);
        }
        return;
    }
    if a.id == my_id {
        return;
    }
    // Un collègue déjà appairé a peut-être changé d'adresse. (Le paquet n'est
    // pas authentifié : au pire, la prochaine connexion échoue à la poignée de
    // main ; elle ne peut jamais réussir avec quelqu'un d'autre.)
    let peers = inner.peers();
    let known = peers.iter().any(|p| p.id == a.id);
    let mut st = inner.state.locked();
    if known {
        if let Some(p) = st.peers.iter_mut().find(|p| p.id == a.id) {
            p.addr = ip.to_string();
        }
        return;
    }
    let new = !st.nearby.contains_key(&a.id);
    st.nearby.retain(|_, v| v.seen.elapsed() < NEARBY_FOR);
    if new && st.nearby.len() >= MAX_NEARBY {
        return;
    }
    st.nearby.insert(a.id, Nearby { name: a.name, color: a.color, addr: ip, seen: Instant::now() });
    drop(st);
    if new {
        team::emit(app, "team.changed", Value::Null);
    }
}

// ── L'entretien ──────────────────────────────────────────────────────────────

fn housekeeping(app: AppHandle, inner: Arc<Inner>) {
    let hello_running = Arc::new(AtomicBool::new(false));
    let mut last_hello: Option<Instant> = None;
    let mut was_online: HashSet<String> = HashSet::new();
    let mut tick: u64 = 0;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        if !super::is_active(&app, ID) {
            last_hello = None;
            continue;
        }
        tick += 1;
        let step = catch_unwind(AssertUnwindSafe(|| {
            expire(&app, &inner);
            // Mon statut a changé : la présence part tout de suite.
            let (status, text) = team::my_status(&app, &inner);
            let key = format!("{status}|{text}");
            {
                let mut st = inner.state.locked();
                if st.last_status != key {
                    st.last_status = key;
                    inner.wake.store(true, Ordering::SeqCst);
                    drop(st);
                    team::emit(&app, "team.changed", Value::Null);
                }
            }
            let due = inner.wake.swap(false, Ordering::SeqCst) || last_hello.is_none_or(|t| t.elapsed() >= HEARTBEAT);
            if due && !hello_running.swap(true, Ordering::SeqCst) {
                last_hello = Some(Instant::now());
                let (app, inner, running) = (app.clone(), inner.clone(), hello_running.clone());
                std::thread::spawn(move || {
                    let _ = catch_unwind(AssertUnwindSafe(|| say_hello_all(&app, &inner)));
                    running.store(false, Ordering::SeqCst);
                });
            }
            // Un collègue arrive ou s'en va : la liste se redessine.
            let now_online: HashSet<String> = inner.state.locked().live.iter().filter(|(_, l)| online(l)).map(|(id, _)| id.clone()).collect();
            if now_online != was_online {
                was_online = now_online;
                team::emit(&app, "team.changed", Value::Null);
            }
            sync_clipboard(&app, &inner);
            // Le chat : « … écrit » qui s'efface, historique gardé 7 jours (si réglé).
            super::team_chat::tick(&app, &inner);
            if tick.is_multiple_of(5) {
                sync_mascot(&app, &inner);
            }
        }));
        if step.is_err() {
            log::warn("équipe : erreur inattendue pendant l'entretien, on continue");
        }
    }
}

/// Oublie les demandes, envois et voisines trop vieux.
fn expire(app: &AppHandle, inner: &Inner) {
    let now = team::now_ms();
    let mut st = inner.state.locked();
    let before = st.pending.len();
    st.pending.retain(|p| now.saturating_sub(p.at) < 30 * 60 * 1000);
    st.outgoing.retain(|_, o| Instant::now() < o.until);
    let nearby = st.nearby.len();
    st.nearby.retain(|_, v| v.seen.elapsed() < NEARBY_FOR);
    let changed = st.pending.len() != before || st.nearby.len() != nearby;
    drop(st);
    if changed {
        team::emit(app, "team.changed", Value::Null);
    }
}

/// La présence à chaque collègue dont on connaît l'adresse (en parallèle).
fn say_hello_all(app: &AppHandle, inner: &Inner) {
    let peers: Vec<Peer> = inner.peers().into_iter().filter(|p| p.ip().is_some()).collect();
    std::thread::scope(|scope| {
        for p in &peers {
            scope.spawn(move || {
                let hello = Msg::Hello(team::my_hello(app, inner, p));
                let _ = request(inner, p, &hello);
            });
        }
    });
}

/// Mes PC en ligne.
fn my_pcs_online(inner: &Inner) -> Vec<Peer> {
    let peers = inner.peers();
    let st = inner.state.locked();
    peers.into_iter().filter(|p| p.mine && st.live.get(&p.id).is_some_and(online)).collect()
}

fn send_to_my_pcs(inner: &Arc<Inner>, msg: Msg) {
    let pcs = my_pcs_online(inner);
    if pcs.is_empty() {
        return;
    }
    let inner = inner.clone();
    std::thread::spawn(move || {
        for p in &pcs {
            let _ = request(&inner, p, &msg);
        }
    });
}

/// Presse-papiers partagé entre mes PC : le texte copié ici part sur mes
/// autres PC (jamais un élément marqué sensible, comme un mot de passe copié
/// depuis un gestionnaire de mots de passe).
fn sync_clipboard(app: &AppHandle, inner: &Arc<Inner>) {
    if !team::settings(app).get("clipboardSync").and_then(Value::as_bool).unwrap_or(false) {
        return;
    }
    let seq = platform::clipboard_sequence();
    {
        let mut st = inner.state.locked();
        if seq == 0 || seq == st.clip_seq {
            return;
        }
        // Le premier tour ne fait que noter le numéro : ce qui était copié
        // avant d'allumer le réglage ne part pas.
        let first = st.clip_seq == 0;
        st.clip_seq = seq;
        if first {
            return;
        }
    }
    if platform::clipboard_is_sensitive() || my_pcs_online(inner).is_empty() {
        return;
    }
    let Ok(text) = arboard::Clipboard::new().and_then(|mut c| c.get_text()) else { return };
    if text.trim().is_empty() || text.chars().count() > proto::MAX_TEXT || text == inner.state.locked().clip_from_peer {
        return;
    }
    let msg = Msg::Clipboard { text };
    if msg.check().is_ok() {
        send_to_my_pcs(inner, msg);
    }
}

/// Même mascotte sur mes PC : la mascotte (ou sa couleur) a changé ici.
fn sync_mascot(app: &AppHandle, inner: &Arc<Inner>) {
    if !team::settings(app).get("mascotSync").and_then(Value::as_bool).unwrap_or(false) {
        return;
    }
    let Some(shared) = tauri::Manager::try_state::<crate::Shared>(app) else { return };
    let m = shared.settings.locked().mascot.clone();
    let key = format!("{}|{}|{}", m.id, m.color, m.custom_color);
    {
        let mut st = inner.state.locked();
        if st.mascot_last == key {
            return;
        }
        let first = st.mascot_last.is_empty();
        st.mascot_last = key;
        if first {
            return;
        }
    }
    let msg = Msg::MascotSync { mascot: m.id, palette: m.color, custom: m.custom_color };
    if msg.check().is_ok() {
        send_to_my_pcs(inner, msg);
    }
}
