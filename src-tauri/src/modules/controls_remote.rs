// Contrôles → « Télécommande sur le téléphone » : une petite page web, sur le
// réseau local, pour piloter le PC depuis le téléphone : la musique (lecture /
// pause, suivant, précédent), le volume, un minuteur, et les diapositives
// d'une présentation (Page suivante / précédente à la fenêtre au premier plan).
//
// Comme « Vers le téléphone » de l'Étagère (shelf_phone.rs, dont on réutilise
// les petits outils) :
//   - désactivée par défaut (réglage phoneRemote) ; on l'ouvre d'un clic, l'île
//     montre un QR code ;
//   - le serveur écoute seulement sur l'adresse PRIVÉE du PC (192.168…, 10…,
//     172.16-31…), sur un port choisi par Windows ; rien ne passe par Internet ;
//   - l'adresse contient un jeton de 128 bits tiré au hasard ; toute autre
//     adresse reçoit « 404 » ;
//   - le jeton ne sert qu'à UN appareil : le premier qui ouvre la page. Un
//     autre appareil, même avec l'adresse, reçoit « 404 » ;
//   - arrêt automatique après 10 minutes sans rien recevoir (la page ne se
//     manifeste que quand elle est affichée : téléphone en veille = silence),
//     et au plus 3 heures ; « Arrêter » dans l'île ferme tout de suite ;
//   - les actions sont une liste fermée (pas de texte tapé, pas de commande),
//     au plus 5 par seconde.
// La première fois, le pare-feu de Windows peut demander d'autoriser Ondine
// sur les réseaux privés (même message que pour l'Étagère).

use std::io::Write;
use std::net::{IpAddr, Shutdown, TcpListener, TcpStream};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::clipboard_qr;
use super::shelf_phone::{new_token, parse_request, read_head, same};
use crate::platform::audio::{self, Device};
use crate::platform::keys::{self, Nav};
use crate::platform::media::{self, Control};
use crate::services::{bus, lan, log};
use crate::sync::LockExt;

const ID: &str = "controls";
/// Sans rien recevoir pendant ce temps, la télécommande s'arrête.
pub const IDLE_STOP: Duration = Duration::from_secs(10 * 60);
/// Et au plus ce temps en tout.
const MAX_LIFE: Duration = Duration::from_secs(3 * 60 * 60);
const MAX_CONNECTIONS: usize = 8;
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const TICK: Duration = Duration::from_millis(100);
/// Au plus ce nombre d'actions par seconde.
const MAX_ACTIONS_PER_SECOND: usize = 5;
const COMMON: &str = "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nConnection: close\r\n";
/// La page n'a le droit de parler qu'à ce serveur (pas d'Internet, pas d'images externes).
const CSP: &str = "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'\r\n";

const NO_LAN: &str = "aucun réseau local trouvé : connectez le PC au Wi-Fi (ou au réseau) de la maison ou du bureau, le même que le téléphone, puis réessayez";

/// Ce que le téléphone peut demander (liste fermée).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteAction {
    Toggle,
    Next,
    Previous,
    VolumeUp,
    VolumeDown,
    Mute,
    Timer(u32),
    SlideNext,
    SlidePrevious,
}

impl RemoteAction {
    pub fn parse(name: &str) -> Option<RemoteAction> {
        Some(match name {
            "toggle" => RemoteAction::Toggle,
            "next" => RemoteAction::Next,
            "previous" => RemoteAction::Previous,
            "vol-up" => RemoteAction::VolumeUp,
            "vol-down" => RemoteAction::VolumeDown,
            "mute" => RemoteAction::Mute,
            "timer-5" => RemoteAction::Timer(5),
            "timer-10" => RemoteAction::Timer(10),
            "timer-25" => RemoteAction::Timer(25),
            "slide-next" => RemoteAction::SlideNext,
            "slide-prev" => RemoteAction::SlidePrevious,
            _ => return None,
        })
    }
}

/// Où va une demande.
#[derive(Debug, PartialEq)]
pub enum Route {
    Page,
    Status,
    Action(RemoteAction),
    BadMethod,
    NotFound,
}

/// « GET /<jeton>/ » : la page ; « GET /<jeton>/s » : l'état ;
/// « POST /<jeton>/a/<action> » : une action. Le reste : 404.
pub fn route(method: &str, path: &str, token: &str) -> Route {
    let Some((tok, rest)) = path.strip_prefix('/').and_then(|p| p.split_once('/')) else { return Route::NotFound };
    if !same(tok.as_bytes(), token.as_bytes()) {
        return Route::NotFound;
    }
    let wanted = match rest {
        "" => Route::Page,
        "s" => Route::Status,
        _ => match rest.strip_prefix("a/").and_then(RemoteAction::parse) {
            Some(a) => Route::Action(a),
            None => return Route::NotFound,
        },
    };
    let ok = match wanted {
        Route::Action(_) => method == "POST",
        _ => method == "GET",
    };
    if ok { wanted } else { Route::BadMethod }
}

// ── La session gardée par Contrôles ──────────────────────────────────────────

pub struct Remote {
    current: Mutex<Option<Session>>,
}

struct Session {
    url: String,
    qr: String,
    stop: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    /// Un téléphone a ouvert la page.
    paired: Arc<AtomicBool>,
}

impl Remote {
    pub const fn new() -> Remote {
        Remote { current: Mutex::new(None) }
    }

    /// Ouvre la télécommande (la précédente s'arrête). → { url, qr, idleMinutes }
    pub fn start(&self, app: &AppHandle) -> Result<Value, String> {
        let ip = lan::private_ipv4().ok_or(NO_LAN)?;
        self.stop();
        let token = new_token()?;
        let listener = TcpListener::bind((ip, 0)).map_err(|e| format!("impossible d'ouvrir la télécommande sur le réseau local ({e})"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let url = format!("http://{ip}:{port}/{token}/");
        let qr = clipboard_qr::make(&url).map(|qr| format!("data:image/svg+xml;base64,{}", BASE64.encode(clipboard_qr::svg(&qr))))?;
        let stop = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let paired = Arc::new(AtomicBool::new(false));
        {
            let (stop, finished, paired, app) = (stop.clone(), finished.clone(), paired.clone(), app.clone());
            std::thread::spawn(move || {
                media::init_thread();
                let end = catch_unwind(AssertUnwindSafe(|| serve(&app, &listener, &token, &stop, &paired))).unwrap_or("stopped");
                drop(listener);
                stop.store(true, Ordering::SeqCst);
                finished.store(true, Ordering::SeqCst);
                log::info(format!("télécommande : serveur fermé ({end})"));
                bus::emit(&app, ID, "controls.remote", json!({ "state": end }));
            });
        }
        // Ni l'adresse ni le jeton dans le journal.
        log::info("télécommande : serveur ouvert sur le réseau local");
        let value = json!({ "url": url, "qr": qr, "paired": false, "idleMinutes": IDLE_STOP.as_secs() / 60 });
        *self.current.locked() = Some(Session { url, qr, stop, finished, paired });
        Ok(value)
    }

    pub fn stop(&self) {
        if let Some(s) = self.current.locked().take() {
            s.stop.store(true, Ordering::SeqCst);
        }
    }

    /// La session en cours, ou null.
    pub fn status(&self) -> Value {
        let mut current = self.current.locked();
        if current.as_ref().is_some_and(|s| s.finished.load(Ordering::SeqCst)) {
            *current = None;
        }
        current
            .as_ref()
            .map(|s| json!({ "url": s.url, "qr": s.qr, "paired": s.paired.load(Ordering::SeqCst), "idleMinutes": IDLE_STOP.as_secs() / 60 }))
            .unwrap_or(Value::Null)
    }
}

// ── Le serveur ───────────────────────────────────────────────────────────────

struct Shared {
    token: String,
    /// Le seul appareil admis (le premier qui a ouvert la page).
    owner: Mutex<Option<IpAddr>>,
    /// Dernière demande reçue (ms depuis le départ).
    last: AtomicU64,
    active: AtomicUsize,
    actions: Mutex<Vec<Instant>>,
}

fn serve(app: &AppHandle, listener: &TcpListener, token: &str, stop: &AtomicBool, paired: &Arc<AtomicBool>) -> &'static str {
    let started = Instant::now();
    let shared = Arc::new(Shared { token: token.to_string(), owner: Mutex::new(None), last: AtomicU64::new(0), active: AtomicUsize::new(0), actions: Mutex::new(Vec::new()) });
    let mut checked = Instant::now();
    loop {
        if stop.load(Ordering::SeqCst) {
            return "stopped";
        }
        let idle = started.elapsed().saturating_sub(Duration::from_millis(shared.last.load(Ordering::SeqCst)));
        if idle >= IDLE_STOP || started.elapsed() >= MAX_LIFE {
            return "expired";
        }
        if checked.elapsed() >= Duration::from_secs(1) {
            checked = Instant::now();
            // Contrôles désactivé, ou le réglage coupé : on ferme.
            let allowed = super::with_context(app, ID, |ctx| ctx.settings().get("phoneRemote").and_then(Value::as_bool).unwrap_or(false)).unwrap_or(false);
            if !allowed {
                return "stopped";
            }
        }
        match listener.accept() {
            Ok((stream, peer)) => {
                if shared.active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    continue;
                }
                shared.active.fetch_add(1, Ordering::SeqCst);
                let (shared, app, paired) = (shared.clone(), app.clone(), paired.clone());
                std::thread::spawn(move || {
                    media::init_thread();
                    let _ = catch_unwind(AssertUnwindSafe(|| handle(&app, stream, peer.ip(), &shared, started, &paired)));
                    shared.active.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Err(_) => std::thread::sleep(TICK),
        }
    }
}

fn handle(app: &AppHandle, mut stream: TcpStream, peer: IpAddr, shared: &Shared, started: Instant, paired: &AtomicBool) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));
    let Some(req) = read_head(&mut stream).and_then(|h| parse_request(&h)) else {
        return reply(&mut stream, "400 Bad Request", "", "");
    };
    let route = route(&req.method, &req.path, &shared.token);
    if route == Route::NotFound {
        return reply(&mut stream, "404 Not Found", "", "");
    }
    // Un seul appareil : le premier qui ouvre la page (ou appelle avec le jeton).
    {
        let mut owner = shared.owner.locked();
        match *owner {
            Some(ip) if ip != peer => return reply(&mut stream, "404 Not Found", "", ""),
            Some(_) => {}
            None => {
                *owner = Some(peer);
                paired.store(true, Ordering::SeqCst);
                bus::emit(app, ID, "controls.remote", json!({ "state": "paired" }));
            }
        }
    }
    shared.last.store(started.elapsed().as_millis() as u64, Ordering::SeqCst);
    match route {
        Route::Page => reply(&mut stream, "200 OK", &format!("Content-Type: text/html; charset=utf-8\r\n{CSP}"), PAGE),
        Route::Status => reply(&mut stream, "200 OK", "Content-Type: application/json\r\n", &status().to_string()),
        Route::Action(a) => {
            let too_many = {
                let mut list = shared.actions.locked();
                list.retain(|t| t.elapsed() < Duration::from_secs(1));
                list.push(Instant::now());
                list.len() > MAX_ACTIONS_PER_SECOND
            };
            if too_many {
                return reply(&mut stream, "429 Too Many Requests", "", "");
            }
            let result = act(app, a);
            let mut body = status();
            if let Err(e) = result {
                body["error"] = json!(e);
            }
            reply(&mut stream, "200 OK", "Content-Type: application/json\r\n", &body.to_string());
        }
        Route::BadMethod => reply(&mut stream, "405 Method Not Allowed", "", ""),
        Route::NotFound => {}
    }
}

/// Fait l'action demandée.
fn act(app: &AppHandle, a: RemoteAction) -> Result<(), String> {
    match a {
        RemoteAction::Toggle => media::control(Control::TogglePlayPause),
        RemoteAction::Next => media::control(Control::Next),
        RemoteAction::Previous => media::control(Control::Previous),
        RemoteAction::VolumeUp | RemoteAction::VolumeDown => {
            let now = audio::get(Device::Speakers)?;
            let v = if a == RemoteAction::VolumeUp { (now.volume + 5).min(100) } else { now.volume.saturating_sub(5) };
            if now.muted && a == RemoteAction::VolumeUp {
                audio::set_muted(Device::Speakers, false)?;
            }
            audio::set_volume(Device::Speakers, v)
        }
        RemoteAction::Mute => {
            let now = audio::get(Device::Speakers)?;
            audio::set_muted(Device::Speakers, !now.muted)
        }
        RemoteAction::Timer(minutes) => {
            bus::emit(app, ID, "timer.start", json!({ "minutes": minutes }));
            Ok(())
        }
        RemoteAction::SlideNext => keys::press(Nav::Next),
        RemoteAction::SlidePrevious => keys::press(Nav::Previous),
    }
}

/// Ce que la page affiche : le morceau en cours et le volume.
fn status() -> Value {
    let playing = media::manager().ok().and_then(|m| media::now_playing(&m).ok().flatten());
    let sound = audio::get(Device::Speakers).ok();
    json!({
        "title": playing.as_ref().map(|p| p.title.clone()).unwrap_or_default(),
        "artist": playing.as_ref().map(|p| p.artist.clone()).unwrap_or_default(),
        "playing": playing.as_ref().is_some_and(|p| p.status == "playing"),
        "volume": sound.as_ref().map(|s| s.volume),
        "muted": sound.as_ref().is_some_and(|s| s.muted),
    })
}

fn reply(stream: &mut TcpStream, status: &str, headers: &str, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}{COMMON}\r\n{body}", body.len());
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Write);
}

/// La page du téléphone : de gros boutons, l'état relu toutes les 5 s tant
/// qu'elle est affichée. Aucune ressource externe (CSP).
const PAGE: &str = r#"<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ondine · télécommande</title>
<style>
:root{color-scheme:dark;--bg:#0d1420;--card:#1a2433;--fg:#eef3fb;--muted:#9fb0c7;--accent:#3d8bff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);padding:16px;max-width:520px;margin-inline:auto}
h1{font-size:18px;margin:4px 0 12px}h2{font-size:13px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 8px}
.now{background:var(--card);border-radius:16px;padding:12px 14px;min-height:56px}.now b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.now span{color:var(--muted);font-size:14px}
.row{display:flex;gap:10px}.row button{flex:1}
button{appearance:none;border:0;border-radius:16px;background:var(--card);color:var(--fg);font:inherit;font-size:22px;padding:18px 8px;touch-action:manipulation}
button:active{transform:scale(.96);background:#24324a}button.main{background:var(--accent)}
small{font-size:13px;display:block;color:var(--muted);margin-top:4px}
#msg{color:#ffb4a8;min-height:20px;font-size:14px;margin-top:12px}
@media (prefers-reduced-motion:reduce){button:active{transform:none}}
</style></head><body>
<h1>🌊 Ondine · télécommande</h1>
<div class="now"><b id="title">—</b><span id="artist"></span></div>
<h2>Musique</h2>
<div class="row"><button data-a="previous" aria-label="Précédent">⏮</button><button class="main" data-a="toggle" aria-label="Lecture / pause" id="play">⏯</button><button data-a="next" aria-label="Suivant">⏭</button></div>
<h2>Volume <span id="vol"></span></h2>
<div class="row"><button data-a="vol-down" aria-label="Moins fort">🔉</button><button data-a="mute" aria-label="Couper le son">🔇</button><button data-a="vol-up" aria-label="Plus fort">🔊</button></div>
<h2>Minuteur</h2>
<div class="row"><button data-a="timer-5">5<small>min</small></button><button data-a="timer-10">10<small>min</small></button><button data-a="timer-25">25<small>min</small></button></div>
<h2>Présentation</h2>
<div class="row"><button data-a="slide-prev" aria-label="Diapositive précédente">◀<small>précédente</small></button><button class="main" data-a="slide-next" aria-label="Diapositive suivante">▶<small>suivante</small></button></div>
<div id="msg"></div>
<script>
const base=location.pathname.replace(/[^/]*$/,"");const $=(id)=>document.getElementById(id);
function show(s){if(!s)return;$("title").textContent=s.title||"Rien en cours";$("artist").textContent=s.artist||"";$("play").textContent=s.playing?"⏸":"▶";$("vol").textContent=s.volume==null?"":(s.muted?"· coupé":"· "+s.volume+" %");$("msg").textContent=s.error||"";}
async function call(path,opt){try{const r=await fetch(base+path,opt);if(r.status===404){$("msg").textContent="Télécommande arrêtée : rouvrez-la depuis l'île.";return null;}if(!r.ok)return null;return await r.json();}catch(e){$("msg").textContent="PC injoignable.";return null;}}
document.querySelectorAll("button[data-a]").forEach((b)=>b.addEventListener("click",async()=>{if(navigator.vibrate)navigator.vibrate(10);show(await call("a/"+b.dataset.a,{method:"POST"}));}));
async function poll(){if(document.visibilityState==="visible")show(await call("s"));}
poll();setInterval(poll,5000);document.addEventListener("visibilitychange",poll);
</script></body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::Ipv4Addr;

    /// L'adresse locale (127.0.0.1), pour le test de bout en bout.
    const LOCAL: Ipv4Addr = Ipv4Addr::LOCALHOST;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn only_known_addresses_and_actions() {
        let t = TOKEN;
        assert_eq!(route("GET", &format!("/{t}/"), t), Route::Page);
        assert_eq!(route("GET", &format!("/{t}/s"), t), Route::Status);
        assert_eq!(route("POST", &format!("/{t}/a/toggle"), t), Route::Action(RemoteAction::Toggle));
        assert_eq!(route("POST", &format!("/{t}/a/timer-25"), t), Route::Action(RemoteAction::Timer(25)));
        assert_eq!(route("POST", &format!("/{t}/a/slide-prev"), t), Route::Action(RemoteAction::SlidePrevious));
        // Une action en GET (préchargement d'un navigateur) : refusée.
        assert_eq!(route("GET", &format!("/{t}/a/next"), t), Route::BadMethod);
        assert_eq!(route("POST", &format!("/{t}/"), t), Route::BadMethod);
        for bad in ["/", "/favicon.ico", &format!("/{t}"), &format!("/{t}/a/rm"), &format!("/{t}/a/timer-999"), &format!("/{}/", &t[..31]), &format!("/{t}/x")] {
            assert_eq!(route("GET", bad, t), Route::NotFound, "{bad}");
            assert_eq!(route("POST", bad, t), Route::NotFound, "{bad}");
        }
    }

    #[test]
    fn the_page_talks_only_to_its_server() {
        assert!(!PAGE.contains("http://") && !PAGE.contains("https://"));
        assert!(CSP.contains("connect-src 'self'"));
        for a in ["toggle", "next", "previous", "vol-up", "vol-down", "mute", "timer-5", "timer-10", "timer-25", "slide-next", "slide-prev"] {
            assert!(PAGE.contains(&format!("data-a=\"{a}\"")), "{a}");
            assert!(RemoteAction::parse(a).is_some(), "{a}");
        }
    }

    #[test]
    fn page_is_served_with_its_headers() {
        // Un petit serveur à la main, pour vérifier la réponse complète (sans AppHandle).
        let listener = TcpListener::bind((LOCAL, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let req = read_head(&mut s).and_then(|h| parse_request(&h)).unwrap();
            assert_eq!(route(&req.method, &req.path, TOKEN), Route::Page);
            reply(&mut s, "200 OK", &format!("Content-Type: text/html; charset=utf-8\r\n{CSP}"), PAGE);
        });
        let mut c = TcpStream::connect((LOCAL, port)).unwrap();
        c.write_all(format!("GET /{TOKEN}/ HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).unwrap();
        let mut out = String::new();
        c.read_to_string(&mut out).unwrap();
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(out.contains("Content-Security-Policy: default-src 'none'"));
        assert!(out.contains(&format!("Content-Length: {}\r\n", PAGE.len())));
        assert!(out.ends_with("</html>"));
    }
}
