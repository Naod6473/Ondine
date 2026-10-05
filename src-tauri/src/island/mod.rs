// La fenêtre de l'île : placement sur le bon écran (DPI compris), ses deux tailles,
// les clics traversants et la lecture de la souris.
//
// Un PC n'a pas d'encoche : l'île est une forme noire dessinée en haut au centre,
// dans une fenêtre sans bordure, transparente, toujours au premier plan, qui ne
// prend pas le focus. La fenêtre a deux tailles :
//   - « bande » (240 × 6) quand l'île est cachée : une bande invisible tout en haut,
//     qui réveille l'île au survol (état `peek`) ou quand on y glisse un fichier ;
//   - « panneau » (720 × 320) le reste du temps : assez grand pour la plus grande vue.
//     Seule la forme de l'île prend la souris, le reste laisse passer les clics.
//
// Clics traversants : Tauri 2 ne sait rendre transparente aux clics que la fenêtre
// ENTIÈRE (set_ignore_cursor_events). On lit donc la souris ~60 fois par seconde
// côté Rust et on bascule ce réglage quand elle entre ou sort de la forme de l'île.
// Technique reprise de Coucou (github.com/Louis-CFM/coucou, MIT).

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::platform;
use crate::services::log;

pub const WINDOW_LABEL: &str = "island";

/// Taille logique (avant mise à l'échelle DPI) du panneau.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 320.0;
/// Taille logique de la bande de réveil, quand l'île est cachée.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;

/// Marge autour de l'île qui compte encore comme « sur l'île » (px logiques),
/// pour que le réglage soit déjà basculé quand la souris arrive sur un bouton.
const HIT_MARGIN: f64 = 14.0;

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// La forme de l'île en coordonnées logiques de la fenêtre, envoyée par le front.
#[derive(Clone, Copy, Default)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// État partagé entre les commandes et le thread qui lit la souris.
pub struct PollGate {
    /// Vrai quand l'île est visible (fenêtre « panneau »).
    active: AtomicBool,
    pub collapsed: AtomicBool,
    rect: Mutex<IslandRect>,
    /// Dernier état envoyé à Windows, pour ne l'appeler que s'il change.
    ignoring: AtomicBool,
    /// Sérialise les changements de « clics traversants » : sans lui, le thread de
    /// lecture pouvait rendre la bande de réveil transparente aux clics juste après
    /// qu'on l'a réduite, et l'île ne se réveillait plus.
    flag_lock: Mutex<()>,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            collapsed: AtomicBool::new(true),
            rect: Mutex::new(IslandRect::default()),
            ignoring: AtomicBool::new(false),
            flag_lock: Mutex::new(()),
        }
    }

    pub fn set_rect(&self, rect: IslandRect) {
        *self.rect.locked() = rect;
    }

    pub fn set_active(&self, on: bool) {
        self.active.store(on, Ordering::Relaxed);
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64 && x < (p.x + s.width as i32) as f64 && y >= p.y as f64 && y < (p.y + s.height as i32) as f64
}

/// L'écran de l'île : le principal, ou celui où se trouve la souris (réglage `screen`).
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if pref == "cursor" {
        if let Some((cx, cy)) = platform::cursor_physical() {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())
}

pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match target_monitor(app, pref) {
        Some(m) => {
            let scale = m.scale_factor();
            let p = m.position();
            let s = m.size();
            ScreenInfo {
                x: p.x as f64 / scale,
                y: p.y as f64 / scale,
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
                scale,
            }
        }
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Place et dimensionne la fenêtre, en pixels physiques : taille logique × échelle
/// de l'écran (125 %, 150 %…), centrée en haut de l'écran choisi.
pub fn apply_geometry(app: &AppHandle, pref: &str, collapsed: bool) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app, pref) else { return };

    let scale = m.scale_factor();
    let mp = *m.position();
    let ms = *m.size();

    let (lw, lh) = if collapsed { (STRIP_W, STRIP_H) } else { (PANEL_W, PANEL_H) };
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;
    let x = mp.x + (ms.width as i32 - pw as i32) / 2;
    let y = mp.y;

    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Passer d'un écran à l'autre peut changer l'échelle : on réimpose la taille.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

/// Après un changement de taille : la fenêtre reprend la souris, et le prochain
/// tour de lecture décide à nouveau d'après la position de la souris.
pub fn refresh_click_through(app: &AppHandle, gate: &PollGate) {
    let _guard = gate.flag_lock.locked();
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(false);
    }
    gate.ignoring.store(false, Ordering::Relaxed);
}

/// Identité de l'écran de l'île (position, taille, échelle). Si elle change
/// (écran branché, débranché, DPI modifié), l'île doit être replacée.
fn screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.locked().general.screen.clone())
        .unwrap_or_else(|| "primary".into());
    let m = target_monitor(app, &pref)?;
    let p = m.position();
    let size = m.size();
    Some((p.x, p.y, size.width, size.height, m.scale_factor().to_bits()))
}

/// Lit la souris en permanence, dans un thread à part :
///   - île cachée (20 fois par seconde) : regarde seulement si la souris touche la
///     bande de réveil, et prévient le front ("wake-enter" / "wake-leave"). On ne
///     compte PAS sur les événements souris de la page : une fenêtre entièrement
///     transparente et qui ne prend pas le focus ne les reçoit pas toujours ;
///   - île visible (~60 fois par seconde) : bascule les clics traversants selon que
///     la souris est sur l'île ou non, et envoie sa position au front ("cursor"),
///     pour le survol et le regard de la mascotte ;
///   - dans les deux cas, surveille les écrans (≈ 2 fois par seconde).
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        let mut was_down = false;
        let mut last_screen = None;
        let mut last = (f64::MIN, f64::MIN);
        let mut in_wake_zone = false;
        let mut ticks: u32 = 0;
        loop {
            let active = gate.is_active();
            std::thread::sleep(Duration::from_millis(if active { 16 } else { 50 }));

            ticks = ticks.wrapping_add(1);
            if ticks % (if active { 30 } else { 10 }) == 0 {
                let now = screen_key(&app);
                if now.is_some() && now != last_screen {
                    let first = last_screen.is_none();
                    last_screen = now;
                    if !first {
                        log::info("disposition des écrans modifiée : l'île se replace");
                        let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                    }
                }
            }

            let Some(win) = window(&app) else { continue };
            let Ok(origin) = win.outer_position() else { continue };
            let Some((cx, cy)) = platform::cursor_physical() else { continue };

            // Un bouton enfoncé peut être le début d'un glisser de fichier : on
            // s'assure que l'île est bien une cible de dépôt avant qu'il n'arrive.
            let down = platform::left_button_down();
            if down && !was_down {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || platform::unblock_webview_drops(&handle));
            }
            was_down = down;

            if !active {
                // ── Île cachée : la bande de réveil ──
                last = (f64::MIN, f64::MIN);
                let Ok(size) = win.outer_size() else { continue };
                // Au moins 2 px de haut, et le bord tout en haut compte toujours.
                let inside = cx >= origin.x as f64
                    && cx < (origin.x + size.width as i32) as f64
                    && cy < (origin.y + (size.height as i32).max(2)) as f64
                    && cy >= (origin.y - 1) as f64;
                if inside != in_wake_zone {
                    in_wake_zone = inside;
                    let event = if inside { "wake-enter" } else { "wake-leave" };
                    let _ = app.emit_to(WINDOW_LABEL, event, ());
                }
                continue;
            }
            in_wake_zone = false;

            // ── Île visible ──
            let scale = win.scale_factor().unwrap_or(1.0);
            let x = (cx - origin.x as f64) / scale;
            let y = (cy - origin.y as f64) / scale;
            if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                continue;
            }
            last = (x, y);

            let r = *gate.rect.locked();
            let on_island = r.w > 0.0
                && x >= r.x - HIT_MARGIN
                && x <= r.x + r.w + HIT_MARGIN
                && y >= r.y - HIT_MARGIN
                && y <= r.y + r.h + HIT_MARGIN;

            // Glisser un fichier : une fenêtre « transparente aux clics » est
            // invisible pour le glisser-déposer de Windows. Donc tant qu'un bouton
            // est enfoncé au-dessus du panneau, tout le panneau prend la souris.
            let over_panel = x >= 0.0 && x <= PANEL_W && y >= 0.0 && y <= PANEL_H;
            let accept = on_island || (down && over_panel);
            {
                let _guard = gate.flag_lock.locked();
                // L'île a pu être réduite entre-temps : la bande doit toujours prendre la souris.
                if !gate.collapsed.load(Ordering::Relaxed) && gate.ignoring.load(Ordering::Relaxed) == accept {
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(!accept);
                }
            }

            let _ = win.emit("cursor", CursorPayload { x, y });
        }
    });
}
