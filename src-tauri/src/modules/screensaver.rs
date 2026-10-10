// Module « Écran de veille » (1.2.3) : quand personne ne touche le PC, un fond
// sombre couvre l'écran de l'île ; Ondine s'y promène au bord d'une eau qui
// ondule, l'heure au centre (page screensaver.html, src/screensaver/).
//
// Désactivé par défaut (MODULES_OFF_BY_DEFAULT). Un fil regarde toutes les
// 2 secondes depuis combien de temps le clavier et la souris n'ont pas servi
// (GetLastInputInfo, comme Windows lui-même) :
//   - au-delà du délai réglé (`delay`, 10 min par défaut), la fenêtre plein
//     écran apparaît, SAUF pendant une présentation ou une appli en plein
//     écran (SHQueryUserNotificationState, et la fenêtre au premier plan qui
//     couvre son écran), un appel en cours (micro ou caméra utilisés) ou une
//     session verrouillée ;
//   - dès qu'on bouge la souris ou touche le clavier (lu 6 fois par seconde
//     tant qu'elle est là), elle se ferme. La fenêtre ne prend jamais le
//     focus : l'appli qu'on utilisait garde le clavier.
// Ondine ne demande jamais à Windows de garder l'écran allumé
// (SetThreadExecutionState) : le verrouillage automatique et la mise en veille
// de l'écran arrivent à l'heure prévue par Windows, par-dessus.
//
// La fenêtre est créée cachée la première fois que le module est actif (avec
// les mêmes arguments WebView2 que les autres fenêtres, voir lib.rs), puis
// seulement montrée ou cachée. La page n'anime rien tant qu'elle est cachée.

use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::log;

const ID: &str = "screensaver";
pub const WINDOW_LABEL: &str = "screensaver";
/// Sans écran de veille : on regarde toutes les 2 s. Affiché : 6 fois par seconde.
const IDLE_POLL: Duration = Duration::from_secs(2);
const SHOWN_POLL: Duration = Duration::from_millis(160);
/// Le fondu de sortie de la page, avant de cacher la fenêtre.
const FADE_OUT: Duration = Duration::from_millis(280);

#[derive(Default)]
pub struct Screensaver;

/// Le délai réglé, en millisecondes (1 à 120 minutes, 10 par défaut).
pub fn delay_ms(settings: &serde_json::Map<String, Value>) -> u64 {
    let minutes = settings.get("delay").and_then(Value::as_f64).filter(|m| m.is_finite()).unwrap_or(10.0).clamp(1.0, 120.0);
    (minutes * 60_000.0) as u64
}

/// La décision, en code pur (testée) : faut-il montrer l'écran de veille ?
pub fn should_show(idle_ms: u64, delay_ms: u64, busy: bool) -> bool {
    idle_ms >= delay_ms && !busy
}

/// Affiché : on le ferme dès qu'il y a eu une action (le compteur d'inactivité
/// est reparti en arrière).
pub fn input_happened(idle_now: u64, idle_before: u64) -> bool {
    idle_now < idle_before
}

/// Une fenêtre au premier plan en plein écran (vidéo, jeu, diaporama), hors
/// bureau de Windows et hors Ondine.
fn foreground_fullscreen() -> bool {
    let Some(w) = platform::winlife::foreground() else { return false };
    if w.own || matches!(w.class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
        return false;
    }
    super::windowlife::is_fullscreen(w.rect, w.monitor)
}

/// Quelque chose interdit l'écran de veille en ce moment.
fn busy() -> bool {
    if platform::presentation_busy() || foreground_fullscreen() {
        return true;
    }
    let media = platform::media_use::current();
    if !media.mic.is_empty() || !media.cam.is_empty() {
        return true;
    }
    platform::session::locked().unwrap_or(false)
}

impl RustModule for Screensaver {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/screensaver/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || watch(app));
    }

    fn invoke(&self, _ctx: &ModuleContext, command: &str, _args: Value) -> Result<Value, String> {
        Err(format!("commande inconnue : {command}"))
    }
}

fn watch(app: AppHandle) {
    let mut shown = false;
    let mut last_idle = 0u64;
    loop {
        std::thread::sleep(if shown { SHOWN_POLL } else { IDLE_POLL });
        let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if !super::is_active(&app, ID) {
                if shown {
                    hide(&app);
                    shown = false;
                }
                return;
            }
            ensure_window(&app);
            let idle = platform::idle_ms();
            if shown {
                if input_happened(idle, last_idle) {
                    hide(&app);
                    shown = false;
                }
                last_idle = idle;
                return;
            }
            let settings = super::with_context(&app, ID, |ctx| ctx.settings()).unwrap_or_default();
            if idle >= delay_ms(&settings) && should_show(idle, delay_ms(&settings), busy()) && show(&app, &settings) {
                shown = true;
                last_idle = idle;
            }
        }));
        if step.is_err() {
            log::warn("écran de veille : erreur inattendue, on continue");
            shown = false;
        }
    }
}

/// Crée la fenêtre (cachée) si elle n'existe pas encore.
fn ensure_window(app: &AppHandle) {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return;
    }
    let built = WebviewWindowBuilder::new(app, WINDOW_LABEL, crate::page_url(app, "screensaver.html"))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Ondine")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .shadow(false)
        .visible(false)
        .build();
    match built {
        Ok(win) => platform::make_non_activating(&win),
        Err(e) => log::error(format!("fenêtre de l'écran de veille impossible à créer : {e}")),
    }
}

/// Montre l'écran de veille sur l'écran de l'île. Vrai s'il est montré.
fn show(app: &AppHandle, settings: &serde_json::Map<String, Value>) -> bool {
    let Some(win) = app.get_webview_window(WINDOW_LABEL) else { return false };
    let monitor = crate::island::window(app).and_then(|w| w.current_monitor().ok().flatten()).or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return false };
    let (pos, size) = (*m.position(), *m.size());
    platform::set_bounds(&win, PhysicalPosition::new(pos.x, pos.y), PhysicalSize::new(size.width, size.height));
    let _ = win.set_always_on_top(true);
    let _ = win.show();
    let flag = |k: &str, d: bool| settings.get(k).and_then(Value::as_bool).unwrap_or(d);
    let _ = win.emit_to(WINDOW_LABEL, "screensaver", json!({ "on": true, "clock": flag("clock", true), "walk": flag("walk", true) }));
    log::info("écran de veille affiché");
    true
}

fn hide(app: &AppHandle) {
    let Some(win) = app.get_webview_window(WINDOW_LABEL) else { return };
    let _ = win.emit_to(WINDOW_LABEL, "screensaver", json!({ "on": false }));
    std::thread::sleep(FADE_OUT);
    let _ = win.hide();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    #[test]
    fn delay_is_bounded() {
        let mut s = Map::new();
        assert_eq!(delay_ms(&s), 600_000, "10 min par défaut");
        s.insert("delay".into(), json!(0));
        assert_eq!(delay_ms(&s), 60_000);
        s.insert("delay".into(), json!(500));
        assert_eq!(delay_ms(&s), 7_200_000);
        s.insert("delay".into(), json!(2.5));
        assert_eq!(delay_ms(&s), 150_000);
    }

    #[test]
    fn shows_only_when_idle_and_not_busy() {
        assert!(should_show(600_000, 600_000, false));
        assert!(!should_show(599_999, 600_000, false));
        assert!(!should_show(900_000, 600_000, true), "présentation, plein écran, appel ou session verrouillée");
    }

    #[test]
    fn any_input_closes_it() {
        assert!(input_happened(40, 650_000));
        assert!(!input_happened(650_160, 650_000));
    }
}
