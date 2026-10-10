// Module « Animations de l'île » : ce que le Rust voit pour les halos.
//
// Le dessin est côté front (src/island/halo.ts) et la plupart des moments
// viennent d'autres modules (batterie, clés USB, téléchargements, agents…).
// Ici, seulement ce que personne d'autre ne regarde :
//   - la sortie de veille : le fil dort un court instant à chaque tour ; si
//     l'horloge a avancé de bien plus que ça, le PC dormait → « halos.wake » ;
//   - Verr Maj / Verr Num (« halos.lock-key » {key: "caps" | "num", on}) ;
//   - Copié / Coupé / Collé (« halos.clip » {action, text?}) : Ctrl+C, Ctrl+X,
//     Ctrl+V vus par GetAsyncKeyState sur ces quatre touches seulement (aucun
//     crochet clavier). Copié / Coupé n'est dit que si le presse-papiers a
//     vraiment changé juste après. Le début du texte (40 caractères) n'est
//     joint que si le réglage le permet ET que le presse-papiers n'est pas
//     marqué sensible (gestionnaire de mots de passe) ;
//   - les touches de volume du clavier (« halos.volume » {volume, muted}) ;
//   - le Wi-Fi qui faiblit (« halos.wifi » {quality}), une fois sous 35 %,
//     de nouveau seulement après être remonté au-dessus de 50 %.
// Et une commande, `levels` : le niveau instantané du micro et du son (0 à 1),
// pour le halo qui suit la voix en visio et la musique. Aucun flux audio n'est
// ouvert (platform/halos.rs) : rien n'est écouté ni enregistré.
//
// Rien de tout ça n'est écrit dans le journal ni envoyé.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Map, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform::{self, halos::Keys};
use crate::services::log;
use crate::services::perf::{self, Loop};

const ID: &str = "halos";
/// Le Wi-Fi est « faible » sous ce seuil, et redevient « bon » au-dessus de l'autre.
const WIFI_WEAK: u8 = 35;
const WIFI_OK: u8 = 50;
/// Le presse-papiers doit changer dans ce délai après Ctrl+C / Ctrl+X.
const CLIP_WAIT: Duration = Duration::from_millis(1200);

#[derive(Default)]
pub struct Halos;

impl RustModule for Halos {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/halos/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || watch(app));
    }

    fn invoke(&self, _ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // { mic?: bool, out?: bool } → { mic: 0..1 | null, out: 0..1 | null }
            "levels" => {
                let want = |k: &str| args.get(k).and_then(Value::as_bool).unwrap_or(false);
                let mic = if want("mic") { platform::halos::peak(platform::halos::Device::Microphone) } else { None };
                let out = if want("out") { platform::halos::peak(platform::halos::Device::Speakers) } else { None };
                Ok(json!({ "mic": mic, "out": out }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Les règles (testées) ─────────────────────────────────────────────────────

/// Le fil a dormi `slept` mais l'horloge a avancé de `wall` : le PC sortait de veille ?
/// (Une minute de marge : un PC très chargé peut prendre un peu de retard.)
fn woke_up(slept: Duration, wall: Duration) -> bool {
    wall > slept + Duration::from_secs(60)
}

/// Une touche vient d'être enfoncée (elle ne l'était pas au tour d'avant).
#[derive(Debug, PartialEq, Clone, Copy)]
enum KeyNews {
    Copy,
    Cut,
    Paste,
    Volume,
}

fn key_news(prev: Keys, now: Keys) -> Vec<KeyNews> {
    let mut out = Vec::new();
    if now.ctrl {
        if now.c && !prev.c {
            out.push(KeyNews::Copy);
        }
        if now.x && !prev.x {
            out.push(KeyNews::Cut);
        }
        if now.v && !prev.v {
            out.push(KeyNews::Paste);
        }
    }
    if (now.vol_up && !prev.vol_up) || (now.vol_down && !prev.vol_down) || (now.mute && !prev.mute) {
        out.push(KeyNews::Volume);
    }
    out
}

/// Le Wi-Fi vient de passer sous le seuil (une fois) ; `weak` retient qu'on l'a dit.
fn wifi_news(weak: &mut bool, quality: u8) -> Option<u8> {
    if !*weak && quality < WIFI_WEAK {
        *weak = true;
        return Some(quality);
    }
    if *weak && quality > WIFI_OK {
        *weak = false;
    }
    None
}

/// Le début d'un texte copié, sur une ligne : 40 caractères au plus.
fn snippet(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = line.chars().take(40).collect();
    if line.chars().count() > 40 {
        out.push('…');
    }
    out
}

// ── Le fil de fond ───────────────────────────────────────────────────────────

/// Les réglages qui comptent ici (relus une fois par seconde).
#[derive(Default, Clone, Copy)]
struct Wanted {
    wake: bool,
    caps: bool,
    num: bool,
    clip: bool,
    clip_text: bool,
    volume: bool,
    wifi: bool,
}

impl Wanted {
    fn from(v: &Map<String, Value>) -> Self {
        let on = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(true);
        Wanted {
            wake: on("wake"),
            caps: on("capsLock"),
            num: on("numLock"),
            clip: on("clipboard"),
            clip_text: on("clipText"),
            volume: on("volumeKeys"),
            wifi: on("wifi"),
        }
    }
    fn keys(&self) -> bool {
        self.caps || self.num || self.clip || self.volume
    }
}

fn watch(app: AppHandle) {
    let mut wanted = Wanted::default();
    let mut read_at: Option<Instant> = None;
    let mut last_wall = SystemTime::now();
    let mut prev_keys = Keys::default();
    let mut locks: Option<(bool, bool)> = None;
    let mut wifi_weak = false;
    let mut wifi_at: Option<Instant> = None;
    // Ctrl+C / Ctrl+X vus : on attend que le presse-papiers change.
    let mut pending: Option<(KeyNews, u32, Instant)> = None;
    let mut volume_at: Option<Instant> = None;
    loop {
        let tick = if wanted.keys() { perf::every(Loop::HaloKeys) } else { perf::every(Loop::HaloIdle) };
        std::thread::sleep(tick);
        let wall = SystemTime::now().duration_since(last_wall).unwrap_or_default();
        last_wall = SystemTime::now();
        if !super::is_active(&app, ID) {
            locks = None;
            pending = None;
            continue;
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            if read_at.is_none_or(|t| t.elapsed() >= Duration::from_secs(1)) {
                read_at = Some(Instant::now());
                wanted = super::with_context(&app, ID, |ctx| Wanted::from(&ctx.settings())).unwrap_or_default();
            }
            if wanted.wake && woke_up(tick, wall) {
                super::with_context(&app, ID, |ctx| ctx.emit("halos.wake", json!({ "secs": wall.as_secs() })));
            }
            // Verr Maj, Verr Num : seulement un changement (pas l'état du démarrage).
            let now_locks = platform::halos::lock_keys();
            if let Some((caps, num)) = locks {
                if wanted.caps && now_locks.0 != caps {
                    super::with_context(&app, ID, |ctx| ctx.emit("halos.lock-key", json!({ "key": "caps", "on": now_locks.0 })));
                }
                if wanted.num && now_locks.1 != num {
                    super::with_context(&app, ID, |ctx| ctx.emit("halos.lock-key", json!({ "key": "num", "on": now_locks.1 })));
                }
            }
            locks = Some(now_locks);
            if wanted.clip || wanted.volume {
                let keys = platform::halos::keys_down();
                for news in key_news(prev_keys, keys) {
                    match news {
                        KeyNews::Copy | KeyNews::Cut if wanted.clip => pending = Some((news, platform::clipboard_sequence(), Instant::now())),
                        KeyNews::Paste if wanted.clip => emit_clip(&app, "paste", wanted.clip_text),
                        KeyNews::Volume if wanted.volume => volume_at = Some(Instant::now()),
                        _ => {}
                    }
                }
                prev_keys = keys;
            }
            if let Some((news, seq, at)) = pending {
                if platform::clipboard_sequence() != seq {
                    pending = None;
                    emit_clip(&app, if news == KeyNews::Cut { "cut" } else { "copy" }, wanted.clip_text);
                } else if at.elapsed() > CLIP_WAIT {
                    pending = None; // rien de copié (Ctrl+C dans un terminal, par exemple)
                }
            }
            // Le volume : relu un court instant après la touche (Windows l'a changé entre-temps).
            if volume_at.is_some_and(|t| t.elapsed() >= Duration::from_millis(90)) {
                volume_at = None;
                if let Ok(level) = platform::audio::get(platform::audio::Device::Speakers) {
                    super::with_context(&app, ID, |ctx| ctx.emit("halos.volume", json!({ "volume": level.volume, "muted": level.muted })));
                }
            }
            if wanted.wifi && wifi_at.is_none_or(|t| t.elapsed() >= Duration::from_secs(10)) {
                wifi_at = Some(Instant::now());
                if let Some(q) = platform::halos::wifi_quality().and_then(|q| wifi_news(&mut wifi_weak, q)) {
                    super::with_context(&app, ID, |ctx| ctx.emit("halos.wifi", json!({ "quality": q })));
                }
            }
        }));
        if step.is_err() {
            log::warn("animations de l'île : erreur inattendue, on continue");
        }
    }
}

/// « Copié », « Coupé », « Collé », avec le début du texte si permis et pas sensible.
fn emit_clip(app: &AppHandle, action: &str, with_text: bool) {
    let text = if with_text && !platform::clipboard_is_sensitive() {
        arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok()).map(|t| snippet(&t)).filter(|t| !t.is_empty())
    } else {
        None
    };
    super::with_context(app, ID, |ctx| ctx.emit("halos.clip", json!({ "action": action, "text": text })));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_needs_a_real_jump() {
        let s = Duration::from_secs;
        assert!(!woke_up(s(1), s(1)));
        assert!(!woke_up(s(1), s(30))); // un PC qui rame, pas une veille
        assert!(woke_up(s(1), s(3600)));
    }

    #[test]
    fn keys_are_said_once_per_press() {
        let k = |ctrl, c, x, v| Keys { ctrl, c, x, v, ..Keys::default() };
        assert_eq!(key_news(Keys::default(), k(true, true, false, false)), vec![KeyNews::Copy]);
        assert_eq!(key_news(k(true, true, false, false), k(true, true, false, false)), vec![]); // touche tenue
        assert_eq!(key_news(Keys::default(), k(false, true, false, false)), vec![]); // « c » sans Ctrl
        assert_eq!(key_news(Keys::default(), k(true, false, true, false)), vec![KeyNews::Cut]);
        assert_eq!(key_news(Keys::default(), k(true, false, false, true)), vec![KeyNews::Paste]);
        let vol = Keys { vol_up: true, ..Keys::default() };
        assert_eq!(key_news(Keys::default(), vol), vec![KeyNews::Volume]);
    }

    #[test]
    fn wifi_weak_once_with_hysteresis() {
        let mut weak = false;
        assert_eq!(wifi_news(&mut weak, 80), None);
        assert_eq!(wifi_news(&mut weak, 30), Some(30));
        assert_eq!(wifi_news(&mut weak, 20), None);
        assert_eq!(wifi_news(&mut weak, 45), None); // pas encore « bon »
        assert_eq!(wifi_news(&mut weak, 34), None);
        assert_eq!(wifi_news(&mut weak, 60), None);
        assert_eq!(wifi_news(&mut weak, 30), Some(30));
    }

    #[test]
    fn snippet_is_one_short_line() {
        assert_eq!(snippet("  Bonjour\n  tout le monde "), "Bonjour tout le monde");
        assert_eq!(snippet(&"a".repeat(50)), format!("{}…", "a".repeat(40)));
        assert_eq!(snippet(""), "");
    }
}
