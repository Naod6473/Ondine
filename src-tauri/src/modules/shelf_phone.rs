// Étagère → « Vers le téléphone » : envoyer UN fichier à un téléphone du même
// réseau (le Wi-Fi de la maison ou du bureau), sans câble, sans appli à
// installer, sans passer par Internet.
//
// Comment : Ondine ouvre un tout petit serveur web, le temps d'un envoi.
//   - Il écoute sur l'adresse PRIVÉE du PC dans le réseau local (192.168.x.x,
//     10.x.x.x ou 172.16-31.x.x, voir services/lan.rs), sur un port choisi au
//     hasard par Windows. Pas de réseau local : on refuse, avec un message clair.
//   - Il ne sert QUE ce fichier, à une adresse secrète :
//       http://192.168.1.20:51234/<jeton>/<nom du fichier>
//     où <jeton> est un nombre tiré au hasard sur 128 bits (32 chiffres
//     hexadécimaux) : impossible à deviner. Toute autre adresse reçoit « 404 »,
//     sans rien dire de plus.
//   - Il s'arrête après UN téléchargement complet, au bout de 5 minutes, ou sur
//     « Arrêter ». Un seul partage à la fois.
// L'île montre l'adresse en QR code (clipboard_qr.rs) : l'appareil photo du
// téléphone l'ouvre, le navigateur du téléphone télécharge le fichier.
//
// Rien ne sort sur Internet. La première fois, le pare-feu de Windows peut
// demander d'autoriser Ondine sur les réseaux privés : sans cette autorisation,
// le téléphone n'arrive pas jusqu'au PC.
//
// Le serveur est écrit à la main avec std::net : il n'a qu'une demande à
// comprendre (« GET /jeton/nom »), pas besoin d'une bibliothèque. Chaque
// connexion a son petit fil ; le fichier part par morceaux (un gros fichier ne
// remplit pas la mémoire).

use std::fs::File;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};

use super::clipboard_qr;
use super::ModuleContext;
use crate::services::{bus, lan, log};
use crate::sync::LockExt;

/// Le lien marche 5 minutes au plus.
pub const SHARE_FOR: Duration = Duration::from_secs(5 * 60);
/// Au plus 8 connexions en même temps (un téléphone en ouvre 2 ou 3).
const MAX_CONNECTIONS: usize = 8;
/// Le téléphone a 10 s pour envoyer sa demande.
const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Un envoi bloqué plus d'une minute (téléphone parti, ou qui attend qu'on
/// confirme le téléchargement) est abandonné.
const WRITE_TIMEOUT: Duration = Duration::from_secs(60);
/// Après le dernier morceau : on attend au plus 15 s que le téléphone dise
/// « reçu » (sinon, l'envoi ne compte pas comme réussi).
const CLOSE_TIMEOUT: Duration = Duration::from_secs(15);
/// Une demande (sans le fichier) ne dépasse jamais 8 Ko.
const MAX_HEAD: usize = 8 * 1024;
/// Au-delà, le nom n'est pas mis dans l'adresse (le QR code serait trop serré).
const MAX_NAME_IN_URL: usize = 120;
/// Le fichier part par morceaux de 64 Ko.
const CHUNK: usize = 64 * 1024;
/// Le fil du serveur regarde s'il doit s'arrêter toutes les 100 ms.
const TICK: Duration = Duration::from_millis(100);
/// Les en-têtes de toutes les réponses : rien en cache, et la connexion se ferme.
const COMMON: &str = "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n";

const NO_LAN: &str = "aucun réseau local trouvé : connectez le PC au Wi-Fi (ou au réseau) de la maison ou du bureau, le même que le téléphone, puis réessayez";

// ── Le partage gardé par l'Étagère ───────────────────────────────────────────

/// Le partage en cours (un seul à la fois), gardé par le module Étagère.
#[derive(Default)]
pub struct Phone {
    current: Mutex<Option<Current>>,
    next_id: AtomicU64,
}

struct Current {
    id: u64,
    share: Share,
    /// Le QR code de l'adresse (SVG en data URL), pour le redonner à l'île.
    qr: String,
}

impl Phone {
    /// Ouvre le partage du fichier `path` (déjà validé par l'Étagère). Le
    /// partage précédent, s'il y en a un, s'arrête. Renvoie de quoi afficher
    /// le panneau : `{ id, url, qr, name, size, seconds }`.
    pub fn share(&self, ctx: &ModuleContext, path: &Path) -> Result<Value, String> {
        ctx.require("network")?;
        if !path.is_file() {
            return Err("seul un fichier peut être envoyé au téléphone (pas un dossier)".into());
        }
        let ip = lan::private_ipv4().ok_or(NO_LAN)?;
        self.stop();
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (app, app_alive) = (ctx.app.clone(), ctx.app.clone());
        // L'Étagère désactivée dans les réglages : le partage s'arrête aussi.
        let alive = move || super::is_active(&app_alive, "shelf");
        // Le fil du serveur prévient le front : "sending" (le téléphone
        // télécharge), puis "done", "expired" ou "stopped". Le numéro `id`
        // permet au front d'ignorer la fin d'un ancien partage.
        let share = start(path, ip, SHARE_FOR, alive, move |event| {
            let state = match event {
                Event::Sending => "sending",
                Event::Ended(end) => {
                    log::write(log::Level::Info, "shelf", &format!("envoi vers le téléphone : {}", end.label()));
                    end.name()
                }
            };
            bus::emit(&app, "shelf", "shelf.phone", json!({ "id": id, "state": state }));
        })?;
        let qr = match clipboard_qr::make(&share.url) {
            Ok(qr) => format!("data:image/svg+xml;base64,{}", BASE64.encode(clipboard_qr::svg(&qr))),
            Err(e) => {
                share.stop();
                return Err(e);
            }
        };
        // Ni l'adresse ni le jeton dans le journal.
        ctx.log_info("envoi vers le téléphone : serveur ouvert sur le réseau local (5 min au plus)");
        let value = status_json(id, &share, &qr);
        *self.current.locked() = Some(Current { id, share, qr });
        Ok(value)
    }

    /// « Arrêter » : le serveur se ferme (les envois en cours aussi).
    pub fn stop(&self) {
        if let Some(c) = self.current.locked().take() {
            c.share.stop();
        }
    }

    /// Le partage en cours, ou null (l'île le redemande en se rouvrant).
    pub fn status(&self) -> Value {
        let mut current = self.current.locked();
        if current.as_ref().is_some_and(|c| c.share.is_finished()) {
            *current = None;
        }
        current.as_ref().map(|c| status_json(c.id, &c.share, &c.qr)).unwrap_or(Value::Null)
    }
}

fn status_json(id: u64, share: &Share, qr: &str) -> Value {
    json!({
        "id": id,
        "url": share.url,
        "qr": qr,
        "name": share.name,
        "size": share.size,
        "seconds": share.seconds_left(),
    })
}

// ── Le serveur ───────────────────────────────────────────────────────────────

/// Comment un partage s'est terminé.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum End {
    /// Le téléphone a reçu le fichier en entier.
    Done,
    /// 5 minutes sans téléchargement complet.
    Expired,
    /// « Arrêter » (ou un nouveau partage).
    Stopped,
}

impl End {
    /// Le nom envoyé au front.
    fn name(self) -> &'static str {
        match self {
            End::Done => "done",
            End::Expired => "expired",
            End::Stopped => "stopped",
        }
    }

    /// Pour le journal.
    fn label(self) -> &'static str {
        match self {
            End::Done => "fichier reçu, serveur fermé",
            End::Expired => "lien expiré, serveur fermé",
            End::Stopped => "arrêté",
        }
    }
}

/// Ce que le serveur raconte pendant le partage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Event {
    /// Un téléphone commence à télécharger (dit une seule fois).
    Sending,
    /// Le serveur est fermé.
    Ended(End),
}

/// Un partage ouvert.
pub struct Share {
    pub url: String,
    pub name: String,
    pub size: u64,
    until: Instant,
    stop: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
}

impl Share {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn is_finished(&self) -> bool {
        self.finished.load(Ordering::SeqCst)
    }

    pub fn seconds_left(&self) -> u64 {
        self.until.saturating_duration_since(Instant::now()).as_secs()
    }
}

/// Ce que le serveur sert : un seul fichier, à une seule adresse.
struct Served {
    path: PathBuf,
    token: String,
    /// Le nom tel qu'il apparaît (décodé) dans l'adresse.
    url_name: String,
    content_type: &'static str,
    disposition: String,
}

/// Ce que les fils des connexions se partagent.
#[derive(Default)]
struct Counters {
    /// Connexions en cours.
    active: AtomicUsize,
    /// Un téléchargement complet a eu lieu.
    done: AtomicBool,
    /// « Sending » déjà dit.
    said_sending: AtomicBool,
}

type OnEvent = Arc<dyn Fn(Event) + Send + Sync>;

/// Ouvre le serveur sur `ip` (port au hasard) pour le fichier `path`, pendant
/// `lasts`. Le serveur s'arrête aussi dès que `alive` répond false (module
/// désactivé). `on_event` est appelée depuis le fil du serveur.
pub fn start(
    path: &Path,
    ip: Ipv4Addr,
    lasts: Duration,
    alive: impl Fn() -> bool + Send + 'static,
    on_event: impl Fn(Event) + Send + Sync + 'static,
) -> Result<Share, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("fichier illisible : {e}"))?;
    if !meta.is_file() {
        return Err("seul un fichier peut être envoyé au téléphone (pas un dossier)".into());
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| "fichier".into());
    let token = new_token()?;
    let url_name = url_name(&name);
    let listener = TcpListener::bind((ip, 0)).map_err(|e| format!("impossible d'ouvrir le partage sur le réseau local ({e})"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // Sans attente : le fil regarde régulièrement s'il doit s'arrêter.
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let url = format!("http://{ip}:{port}/{token}/{}", encode(&url_name));
    let served = Arc::new(Served { path: path.to_path_buf(), token, url_name, content_type: content_type(&name), disposition: disposition(&name) });
    let stop = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let until = Instant::now() + lasts;
    let on_event: OnEvent = Arc::new(on_event);
    {
        let (stop, finished) = (stop.clone(), finished.clone());
        std::thread::spawn(move || {
            let end = catch_unwind(AssertUnwindSafe(|| serve(&listener, &served, &stop, until, &alive, &on_event))).unwrap_or(End::Stopped);
            drop(listener); // le port se ferme
            stop.store(true, Ordering::SeqCst); // les envois encore en cours s'arrêtent aussi
            finished.store(true, Ordering::SeqCst);
            on_event(Event::Ended(end));
        });
    }
    Ok(Share { url, name, size: meta.len(), until, stop, finished })
}

/// La boucle du serveur : accepte les connexions jusqu'à la fin du partage.
fn serve(listener: &TcpListener, served: &Arc<Served>, stop: &Arc<AtomicBool>, until: Instant, alive: &dyn Fn() -> bool, on_event: &OnEvent) -> End {
    let counters = Arc::new(Counters::default());
    let mut checked = Instant::now();
    loop {
        if counters.done.load(Ordering::SeqCst) {
            return End::Done;
        }
        if stop.load(Ordering::SeqCst) {
            return End::Stopped;
        }
        // Le module est-il toujours actif ? (une fois par seconde suffit)
        if checked.elapsed() >= Duration::from_secs(1) {
            checked = Instant::now();
            if !alive() {
                return End::Stopped;
            }
        }
        // Après 5 minutes : plus personne n'entre, mais un envoi commencé
        // peut finir (un gros fichier sur un Wi-Fi lent).
        if Instant::now() >= until {
            if counters.active.load(Ordering::SeqCst) == 0 {
                return End::Expired;
            }
            std::thread::sleep(TICK);
            continue;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if counters.active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    continue; // trop de monde : la connexion est fermée tout de suite
                }
                counters.active.fetch_add(1, Ordering::SeqCst);
                let (served, stop, counters, on_event) = (served.clone(), stop.clone(), counters.clone(), on_event.clone());
                std::thread::spawn(move || {
                    let _ = catch_unwind(AssertUnwindSafe(|| handle(stream, &served, &stop, until, &counters, &on_event)));
                    counters.active.fetch_sub(1, Ordering::SeqCst);
                });
            }
            // Personne à la porte (WouldBlock) ou erreur passagère : on attend un peu.
            Err(_) => std::thread::sleep(TICK),
        }
    }
}

/// Une connexion : lit la demande, répond 404 / 405 / 400, ou envoie le fichier.
fn handle(mut stream: TcpStream, served: &Served, stop: &AtomicBool, until: Instant, counters: &Counters, on_event: &OnEvent) {
    // Une connexion acceptée peut hériter du « sans attente » du serveur (Windows).
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let Some(request) = read_head(&mut stream).and_then(|head| parse_request(&head)) else {
        return reply(&mut stream, "400 Bad Request", "");
    };
    match route(&request, &served.token, &served.url_name) {
        Route::NotFound => reply(&mut stream, "404 Not Found", ""),
        Route::BadMethod => reply(&mut stream, "405 Method Not Allowed", "Allow: GET, HEAD\r\n"),
        Route::File { head_only } => {
            // Après les 5 minutes, ou une fois le fichier reçu : plus rien.
            if Instant::now() >= until || stop.load(Ordering::SeqCst) || counters.done.load(Ordering::SeqCst) {
                return reply(&mut stream, "404 Not Found", "");
            }
            if send_file(&mut stream, served, head_only, stop, counters, on_event) {
                counters.done.store(true, Ordering::SeqCst);
            }
        }
    }
}

/// Envoie le fichier. true = le téléphone l'a reçu en entier.
fn send_file(stream: &mut TcpStream, served: &Served, head_only: bool, stop: &AtomicBool, counters: &Counters, on_event: &OnEvent) -> bool {
    let Ok(mut file) = File::open(&served.path) else {
        reply(stream, "404 Not Found", "");
        return false;
    };
    let Ok(size) = file.metadata().map(|m| m.len()) else {
        reply(stream, "404 Not Found", "");
        return false;
    };
    let head = format!(
        // Accept-Ranges: none : on envoie toujours le fichier en entier.
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {size}\r\nContent-Disposition: {}\r\nAccept-Ranges: none\r\n{COMMON}\r\n",
        served.content_type, served.disposition
    );
    if stream.write_all(head.as_bytes()).is_err() || head_only {
        let _ = stream.flush();
        return false;
    }
    if !counters.said_sending.swap(true, Ordering::SeqCst) {
        on_event(Event::Sending);
    }
    let mut buf = vec![0u8; CHUNK];
    let mut left = size;
    while left > 0 {
        // « Arrêter », ou une autre connexion a déjà tout envoyé.
        if stop.load(Ordering::SeqCst) || counters.done.load(Ordering::SeqCst) {
            return false;
        }
        let want = usize::try_from(left).unwrap_or(usize::MAX).min(buf.len());
        let n = match file.read(&mut buf[..want]) {
            Ok(0) | Err(_) => return false, // fichier raccourci ou illisible en route
            Ok(n) => n,
        };
        if stream.write_all(&buf[..n]).is_err() {
            return false; // le téléphone a abandonné
        }
        left -= n as u64;
    }
    stream.flush().is_ok() && closed_cleanly(stream)
}

/// Tout est parti : on dit « fini » au téléphone et on attend qu'il ferme de
/// son côté. Il ferme proprement quand il a tout reçu ; s'il avait abandonné
/// (navigateur qui annule), la connexion est « réinitialisée » à la place.
fn closed_cleanly(stream: &mut TcpStream) -> bool {
    if stream.shutdown(Shutdown::Write).is_err() {
        return false;
    }
    let _ = stream.set_read_timeout(Some(CLOSE_TIMEOUT));
    let mut buf = [0u8; 512];
    for _ in 0..64 {
        match stream.read(&mut buf) {
            Ok(0) => return true,
            Ok(_) => continue, // le téléphone a encore écrit quelque chose : on l'ignore
            // Pas de nouvelles au bout de 15 s (téléphone en veille, Wi-Fi perdu) :
            // rien ne prouve qu'il a tout reçu. Le lien reste ouvert jusqu'à la
            // fin des 5 minutes, on peut réessayer.
            Err(_) => return false,
        }
    }
    false
}

/// Une réponse sans contenu (404, 405, 400). Rien d'autre n'est révélé.
fn reply(stream: &mut TcpStream, status: &str, extra: &str) {
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: 0\r\n{extra}{COMMON}\r\n");
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Write);
}

/// Lit l'en-tête de la demande, jusqu'à la ligne vide. None : trop long, trop
/// lent (10 s en tout) ou connexion fermée avant la fin.
fn read_head(stream: &mut impl Read) -> Option<Vec<u8>> {
    let started = Instant::now();
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            return None;
        }
        head.extend_from_slice(&buf[..n]);
        if head.windows(4).any(|w| w == b"\r\n\r\n") {
            return Some(head);
        }
        if head.len() > MAX_HEAD || started.elapsed() > READ_TIMEOUT {
            return None;
        }
    }
}

// ── Petits outils (testés plus bas) ──────────────────────────────────────────

/// Un jeton au hasard de 128 bits, en 32 chiffres hexadécimaux.
pub fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "le hasard du système est indisponible".to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// La première ligne d'une demande HTTP : « GET /chemin HTTP/1.1 ».
#[derive(Debug, PartialEq)]
struct Request {
    method: String,
    /// Le chemin, sans « ?… » ni « #… ».
    path: String,
}

/// Lit la première ligne de la demande. None si elle est mal formée.
fn parse_request(head: &[u8]) -> Option<Request> {
    let end = head.windows(2).position(|w| w == b"\r\n")?;
    let line = std::str::from_utf8(&head[..end]).ok()?;
    let mut parts = line.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || method.is_empty() || method.len() > 16 || !method.bytes().all(|b| b.is_ascii_uppercase()) {
        return None;
    }
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return None;
    }
    // Un chemin qui commence par « / », en caractères visibles (les accents
    // arrivent encodés : %C3%A9).
    if !target.starts_with('/') || target.len() > 2048 || !target.bytes().all(|b| b.is_ascii_graphic()) {
        return None;
    }
    let path = target.split(['?', '#']).next().unwrap_or_default();
    Some(Request { method: method.to_string(), path: path.to_string() })
}

#[derive(Debug, PartialEq)]
enum Route {
    /// La bonne adresse : le fichier (HEAD = les en-têtes seulement).
    File { head_only: bool },
    NotFound,
    /// La bonne adresse, mais autre chose que GET ou HEAD.
    BadMethod,
}

/// La demande vise-t-elle « /<jeton>/<nom> » ?
fn route(request: &Request, token: &str, name: &str) -> Route {
    let Some((tok, file)) = request.path.strip_prefix('/').and_then(|rest| rest.split_once('/')) else {
        return Route::NotFound;
    };
    if !same(tok.as_bytes(), token.as_bytes()) || decode(file).as_deref() != Some(name) {
        return Route::NotFound;
    }
    match request.method.as_str() {
        "GET" => Route::File { head_only: false },
        "HEAD" => Route::File { head_only: true },
        _ => Route::BadMethod,
    }
}

/// Compare deux jetons sans s'arrêter au premier caractère différent : on ne
/// peut pas deviner le jeton petit à petit en mesurant le temps de réponse.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Encode un texte pour une adresse : lettres, chiffres et « - . _ ~ » restent,
/// le reste devient %XX (« é » → « %C3%A9 », espace → « %20 »).
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// L'inverse : « %C3%A9 » → « é ». None si l'encodage est faux.
fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes.get(i + 1..i + 3)?;
            if !hex.iter().all(u8::is_ascii_hexdigit) {
                return None;
            }
            out.push(u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Le nom mis dans l'adresse : le vrai nom, ou « fichier.pdf » s'il est trop
/// long une fois encodé. Le vrai nom est de toute façon donné au téléphone par
/// l'en-tête Content-Disposition.
fn url_name(name: &str) -> String {
    if encode(name).len() <= MAX_NAME_IN_URL {
        return name.to_string();
    }
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).filter(|e| e.len() <= 10 && e.chars().all(|c| c.is_ascii_alphanumeric()));
    match ext {
        Some(ext) => format!("fichier.{ext}"),
        None => "fichier".into(),
    }
}

/// « attachment » : le navigateur du téléphone enregistre le fichier au lieu
/// de l'ouvrir. Le nom en ASCII pour les vieux navigateurs, puis en UTF-8.
fn disposition(name: &str) -> String {
    let ascii: String = name.chars().map(|c| if (c.is_ascii_graphic() && c != '"' && c != '\\') || c == ' ' { c } else { '_' }).collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{}", encode(name))
}

/// Le type du fichier d'après son extension (le téléphone choisit l'appli qui l'ouvre).
fn content_type(name: &str) -> &'static str {
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "json" => "application/json",
        "ics" => "text/calendar",
        "vcf" => "text/vcard",
        "zip" => "application/zip",
        "epub" => "application/epub+zip",
        "apk" => "application/vnd.android.package-archive",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(text: &str) -> Option<Request> {
        parse_request(text.as_bytes())
    }

    #[test]
    fn tokens_are_128_random_bits() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(a, b);
    }

    #[test]
    fn requests_are_read() {
        let r = req("GET /abc/rapport.pdf HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        assert_eq!(r, Request { method: "GET".into(), path: "/abc/rapport.pdf".into() });
        // « ?… » et « #… » ne comptent pas.
        assert_eq!(req("HEAD /abc/a.txt?x=1 HTTP/1.0\r\n\r\n").unwrap().path, "/abc/a.txt");
        assert_eq!(req("GET /abc/a.txt#bas HTTP/1.1\r\n\r\n").unwrap().path, "/abc/a.txt");
    }

    #[test]
    fn malformed_requests_are_refused() {
        for bad in [
            "",
            "GET /a HTTP/1.1",              // pas de fin de ligne
            "GET /a\r\n\r\n",               // pas de version
            "GET  /a HTTP/1.1\r\n\r\n",     // deux espaces
            "get /a HTTP/1.1\r\n\r\n",      // méthode en minuscules
            "GET a HTTP/1.1\r\n\r\n",       // chemin sans « / »
            "GET http://x/a HTTP/1.1\r\n\r\n",
            "GET /a HTTP/2\r\n\r\n",
            "GET /a b HTTP/1.1\r\n\r\n",
            "GET /é HTTP/1.1\r\n\r\n",      // accent non encodé
            "GET /a\x01 HTTP/1.1\r\n\r\n",  // caractère de contrôle
            "GET /a HTTP/1.1 x\r\n\r\n",
        ] {
            assert_eq!(req(bad), None, "accepté à tort : {bad:?}");
        }
        assert_eq!(parse_request(b"GET /\xff HTTP/1.1\r\n\r\n"), None);
        let long = format!("GET /{} HTTP/1.1\r\n\r\n", "a".repeat(3000));
        assert_eq!(req(&long), None);
    }

    #[test]
    fn only_the_secret_address_gives_the_file() {
        let token = "0123456789abcdef0123456789abcdef";
        let name = "Facture été 2026.pdf";
        let path = format!("/{token}/{}", encode(name));
        let get = |p: &str| route(&Request { method: "GET".into(), path: p.into() }, token, name);
        assert_eq!(get(&path), Route::File { head_only: false });
        assert_eq!(route(&Request { method: "HEAD".into(), path: path.clone() }, token, name), Route::File { head_only: true });
        assert_eq!(route(&Request { method: "POST".into(), path: path.clone() }, token, name), Route::BadMethod);
        // Tout le reste : 404 (y compris un POST ailleurs, qui ne révèle rien).
        assert_eq!(route(&Request { method: "POST".into(), path: "/".into() }, token, name), Route::NotFound);
        for other in [
            "/",
            "/favicon.ico",
            &format!("/{token}"),
            &format!("/{token}/"),
            &format!("/{token}/autre.pdf"),
            &format!("/{}/{}", &token[..31], encode(name)),
            &format!("/{}0/{}", token, encode(name)),
            &format!("/{}/{}", token.to_uppercase(), encode(name)),
            &format!("/{token}/{}/x", encode(name)),
            &format!("/{token}/%ZZ"),
            &format!("/{token}/%C3"), // octet seul : pas de l'UTF-8
        ] {
            assert_eq!(get(other), Route::NotFound, "{other}");
        }
    }

    #[test]
    fn names_are_encoded_and_decoded() {
        assert_eq!(encode("a b.pdf"), "a%20b.pdf");
        assert_eq!(encode("été"), "%C3%A9t%C3%A9");
        assert_eq!(encode("x/../y?"), "x%2F..%2Fy%3F");
        assert_eq!(decode("%C3%A9t%C3%A9").as_deref(), Some("été"));
        assert_eq!(decode("a%2"), None);
        assert_eq!(decode("a%+1"), None);
        let name = "Rapport (final) #2 — 100% été.docx";
        assert_eq!(decode(&encode(name)).as_deref(), Some(name));
    }

    #[test]
    fn long_names_stay_out_of_the_address() {
        assert_eq!(url_name("photo.jpg"), "photo.jpg");
        let long = format!("{}.pdf", "é".repeat(40));
        assert_eq!(url_name(&long), "fichier.pdf");
        assert_eq!(url_name(&"é".repeat(40)), "fichier");
    }

    #[test]
    fn headers_name_the_file() {
        assert_eq!(content_type("Photo.JPG"), "image/jpeg");
        assert_eq!(content_type("notes"), "application/octet-stream");
        assert_eq!(content_type("page.html"), "application/octet-stream");
        let d = disposition("été \"ok\".pdf");
        assert!(d.starts_with("attachment; filename=\"_t_ _ok_.pdf\""), "{d}");
        assert!(d.ends_with("filename*=UTF-8''%C3%A9t%C3%A9%20%22ok%22.pdf"), "{d}");
        // Jamais de retour à la ligne dans un en-tête.
        assert!(!disposition("a\r\nX: y").contains('\n'));
    }

    // ── De bout en bout, sur la machine même (127.0.0.1) ────────────────────

    /// Envoie une demande brute, renvoie la réponse entière.
    fn ask(url_port: u16, raw: &str) -> Vec<u8> {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, url_port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        out
    }

    fn status(resp: &[u8]) -> String {
        String::from_utf8_lossy(resp).lines().next().unwrap_or_default().to_string()
    }

    fn temp_file(name: &str, content: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ondine-phone-test-{}", new_token().unwrap()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    fn wait_for(events: &Arc<Mutex<Vec<Event>>>, wanted: Event) -> bool {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if events.locked().contains(&wanted) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    #[test]
    fn a_phone_downloads_the_file_once_then_the_server_closes() {
        // Plus gros qu'un morceau : l'envoi se fait en plusieurs fois.
        let content: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let path = temp_file("relevé.bin", &content);
        let events = Arc::new(Mutex::new(Vec::new()));
        let log = events.clone();
        let share = start(&path, Ipv4Addr::LOCALHOST, Duration::from_secs(30), || true, move |e| log.locked().push(e)).unwrap();
        assert_eq!(share.size, content.len() as u64);
        let rest = share.url.strip_prefix("http://127.0.0.1:").unwrap();
        let (port, path_part) = rest.split_once('/').unwrap();
        let port: u16 = port.parse().unwrap();
        let file_path = format!("/{path_part}");
        assert!(file_path.ends_with("/relev%C3%A9.bin"));

        // Les mauvaises adresses : 404, sans contenu ; une demande illisible : 400.
        let r = ask(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
        assert_eq!(status(&r), "HTTP/1.1 404 Not Found");
        assert!(String::from_utf8_lossy(&r).ends_with("\r\n\r\n"));
        assert_eq!(status(&ask(port, "GET /0000/relev%C3%A9.bin HTTP/1.1\r\n\r\n")), "HTTP/1.1 404 Not Found");
        assert_eq!(status(&ask(port, "BONJOUR\r\n\r\n")), "HTTP/1.1 400 Bad Request");
        assert_eq!(status(&ask(port, &format!("DELETE {file_path} HTTP/1.1\r\n\r\n"))), "HTTP/1.1 405 Method Not Allowed");

        // HEAD : les en-têtes seulement, et le partage continue.
        let head = String::from_utf8(ask(port, &format!("HEAD {file_path} HTTP/1.1\r\n\r\n"))).unwrap();
        assert!(head.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(head.contains(&format!("Content-Length: {}\r\n", content.len())));
        assert!(head.contains("Content-Disposition: attachment; filename=\"relev_.bin\"; filename*=UTF-8''relev%C3%A9.bin\r\n"));
        assert!(head.ends_with("\r\n\r\n"));
        assert!(!share.is_finished());

        // GET : le fichier entier.
        let resp = ask(port, &format!("GET {file_path} HTTP/1.1\r\nHost: x\r\n\r\n"));
        let split = resp.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        assert_eq!(status(&resp), "HTTP/1.1 200 OK");
        assert_eq!(&resp[split..], &content[..]);

        // Le serveur se ferme tout seul : plus personne n'écoute sur ce port.
        assert!(wait_for(&events, Event::Ended(End::Done)), "{:?}", events.locked());
        assert!(events.locked().contains(&Event::Sending));
        assert!(share.is_finished());
        assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn stop_and_expiry_close_the_server() {
        let path = temp_file("a.txt", b"bonjour");
        let events = Arc::new(Mutex::new(Vec::new()));
        let log = events.clone();
        let share = start(&path, Ipv4Addr::LOCALHOST, Duration::from_secs(30), || true, move |e| log.locked().push(e)).unwrap();
        share.stop();
        assert!(wait_for(&events, Event::Ended(End::Stopped)));

        let events = Arc::new(Mutex::new(Vec::new()));
        let log = events.clone();
        let short = start(&path, Ipv4Addr::LOCALHOST, Duration::from_millis(200), || true, move |e| log.locked().push(e)).unwrap();
        assert!(wait_for(&events, Event::Ended(End::Expired)));
        assert_eq!(short.seconds_left(), 0);

        // Le module est désactivé pendant le partage : le serveur s'arrête aussi.
        let events = Arc::new(Mutex::new(Vec::new()));
        let log = events.clone();
        let _off = start(&path, Ipv4Addr::LOCALHOST, Duration::from_secs(30), || false, move |e| log.locked().push(e)).unwrap();
        assert!(wait_for(&events, Event::Ended(End::Stopped)));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn after_five_minutes_nobody_gets_in() {
        // Un lien expiré ne donne plus rien, même avec la bonne adresse.
        let path = temp_file("b.txt", b"salut");
        let events = Arc::new(Mutex::new(Vec::new()));
        let log = events.clone();
        let share = start(&path, Ipv4Addr::LOCALHOST, Duration::from_millis(150), || true, move |e| log.locked().push(e)).unwrap();
        assert!(wait_for(&events, Event::Ended(End::Expired)));
        let port: u16 = share.url.strip_prefix("http://127.0.0.1:").unwrap().split_once('/').unwrap().0.parse().unwrap();
        assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err());
        assert!(!events.locked().contains(&Event::Sending));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn folders_are_refused() {
        let dir = std::env::temp_dir();
        let refused = start(&dir, Ipv4Addr::LOCALHOST, Duration::from_secs(1), || true, |_| {}).err();
        assert!(refused.is_some_and(|e| e.contains("dossier")));
    }
}
