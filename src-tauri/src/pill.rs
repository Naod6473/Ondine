// La pilule de la Dictée : une petite fenêtre à part (label "pill", page
// pill.html), sans bordure, transparente, toujours au-dessus, hors de la barre
// des tâches et d'Alt+Tab, qui ne prend jamais le clavier (sinon le texte
// dicté atterrirait chez elle).
//
// Elle se pose en bas au centre de la zone de travail de l'écran où est la
// souris, ou debout contre le bord gauche ou droit (réglage « edge » du
// module). Seule la pilule elle-même prend la souris : la page envoie ses
// cases (`pill_hit`) et un petit thread lit la souris pour basculer
// set_ignore_cursor_events, comme pour Ondine sur le bureau (pet.rs).
// Au repos et cachée, le thread dort : rien ne tourne.
//
// Ce qu'elle montre (repos, écoute, mains libres, appel, message) vient de
// modules/dictation.rs par l'événement « pill-state » ; les bulles par
// « pill-bands ».

use crate::sync::LockExt;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::pet::HitRect;
use crate::platform;
use crate::services::log;

pub const WINDOW_LABEL: &str = "pill";

/// La fenêtre en bas (px logiques) : la pilule et, au-dessus, la place d'un message.
const BOTTOM: (f64, f64) = (440.0, 168.0);
/// La fenêtre debout contre un bord (px logiques).
const SIDE: (f64, f64) = (330.0, 360.0);
/// L'air entre la pilule et le bord de la zone de travail (px logiques).
const GAP: f64 = 6.0;

/// Où elle est posée.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Edge {
    #[default]
    Bottom,
    Left,
    Right,
}

impl Edge {
    pub fn from_id(id: &str) -> Edge {
        match id {
            "left" => Edge::Left,
            "right" => Edge::Right,
            _ => Edge::Bottom,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Edge::Bottom => "bottom",
            Edge::Left => "left",
            Edge::Right => "right",
        }
    }

    fn size(self) -> (f64, f64) {
        if self == Edge::Bottom {
            BOTTOM
        } else {
            SIDE
        }
    }
}

#[derive(Default)]
pub struct PillState {
    hit: Mutex<Vec<HitRect>>,
    edge: Mutex<Edge>,
}

/// La place de la fenêtre (px physiques) dans une zone de travail
/// (x, y, largeur, hauteur), pour un bord et une échelle d'affichage.
pub fn place_in(work: (i32, i32, i32, i32), scale: f64, edge: Edge) -> (i32, i32, u32, u32) {
    let (wx, wy, ww, wh) = work;
    let (lw, lh) = edge.size();
    let (w, h) = ((lw * scale).round() as i32, (lh * scale).round() as i32);
    let gap = (GAP * scale).round() as i32;
    let (x, y) = match edge {
        Edge::Bottom => (wx + (ww - w) / 2, wy + wh - h - gap),
        Edge::Left => (wx + gap, wy + (wh - h) / 2),
        Edge::Right => (wx + ww - w - gap, wy + (wh - h) / 2),
    };
    (x, y, w.max(1) as u32, h.max(1) as u32)
}

/// Crée la fenêtre, cachée, au démarrage (WebView2 : mêmes arguments que l'île).
pub fn create(app: &AppHandle, url: WebviewUrl) {
    let (w, h) = BOTTOM;
    let builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, url)
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Ondine")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
    match builder.build() {
        Ok(win) => {
            platform::make_non_activating(&win);
            let _ = win.set_ignore_cursor_events(true);
        }
        Err(err) => log::error(format!("fenêtre « pill » impossible à créer : {err}")),
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Pose la fenêtre sur l'écran où est la souris (sinon le principal).
fn place(app: &AppHandle, win: &WebviewWindow, edge: Edge) {
    let monitors = app.available_monitors().unwrap_or_default();
    let cursor = platform::cursor_physical();
    let m = cursor
        .and_then(|(cx, cy)| {
            monitors.iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                cx >= p.x as f64 && cx < (p.x + s.width as i32) as f64 && cy >= p.y as f64 && cy < (p.y + s.height as i32) as f64
            })
        })
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next());
    let Some(m) = m else { return };
    let wa = m.work_area();
    let (x, y, w, h) = place_in((wa.position.x, wa.position.y, wa.size.width as i32, wa.size.height as i32), m.scale_factor(), edge);
    let _ = win.set_size(PhysicalSize::new(w, h));
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// Montre la pilule (et la repose si le bord a changé, ou si elle était cachée).
pub fn show(app: &AppHandle, edge: Edge) {
    let Some(win) = window(app) else { return };
    let Some(state) = app.try_state::<PillState>() else { return };
    let was = win.is_visible().unwrap_or(false);
    let changed = {
        let mut e = state.edge.locked();
        let changed = *e != edge;
        *e = edge;
        changed
    };
    if !was || changed {
        place(app, &win, edge);
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.show();
        // Toujours au-dessus, même après une fenêtre plein écran.
        let _ = win.set_always_on_top(true);
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = window(app) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        }
    }
}

/// Envoie un événement à la page de la pilule seulement.
pub fn emit<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(WINDOW_LABEL, event, payload);
}

/// La page dit où est la pilule (et sa barre d'outils, son message).
pub fn set_hit(app: &AppHandle, rects: Vec<HitRect>) {
    if let Some(state) = app.try_state::<PillState>() {
        *state.hit.locked() = rects.into_iter().filter(|r| r.w > 0.0 && r.h > 0.0).take(6).collect();
    }
}

fn on_hit(rects: &[HitRect], x: f64, y: f64) -> bool {
    const M: f64 = 2.0;
    rects.iter().any(|r| x >= r.x - M && x <= r.x + r.w + M && y >= r.y - M && y <= r.y + r.h + M)
}

/// Lit la souris tant que la pilule est visible : clics traversants hors de
/// ses cases. 30 fois par seconde près d'elle, 8 loin ; cachée, toutes les
/// demi-secondes seulement (rien à faire).
pub fn spawn_hit_poll(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ignoring = true;
        loop {
            let Some(win) = window(&app) else { return };
            let Some(state) = app.try_state::<PillState>() else { return };
            if !win.is_visible().unwrap_or(false) {
                ignoring = true;
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }
            let near = (|| {
                let (cx, cy) = platform::cursor_physical()?;
                let origin = win.outer_position().ok()?;
                let size = win.outer_size().ok()?;
                let scale = win.scale_factor().ok()?;
                let (x, y) = ((cx - origin.x as f64) / scale, (cy - origin.y as f64) / scale);
                let close = x >= -60.0 && y >= -60.0 && x <= size.width as f64 / scale + 60.0 && y <= size.height as f64 / scale + 60.0;
                Some((on_hit(&state.hit.locked(), x, y), close))
            })();
            let (on, close) = near.unwrap_or((false, false));
            if on == ignoring {
                ignoring = !on;
                let _ = win.set_ignore_cursor_events(ignoring);
            }
            std::thread::sleep(Duration::from_millis(if close { 33 } else { 120 }));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pill_sits_at_the_bottom_or_against_an_edge() {
        // Un écran 1920×1040 de zone de travail, à 100 %.
        let (x, y, w, h) = place_in((0, 0, 1920, 1040), 1.0, Edge::Bottom);
        assert_eq!((w, h), (440, 168));
        assert_eq!(x, (1920 - 440) / 2);
        assert_eq!(y, 1040 - 168 - 6);
        // À 150 %, sur un second écran à droite.
        let (x, y, w, h) = place_in((1920, 0, 2560, 1400), 1.5, Edge::Right);
        assert_eq!((w, h), (495, 540));
        assert_eq!(x, 1920 + 2560 - 495 - 9);
        assert_eq!(y, (1400 - 540) / 2);
        let (x, _, _, _) = place_in((0, 0, 1920, 1040), 1.0, Edge::Left);
        assert_eq!(x, 6);
        assert_eq!(Edge::from_id("left"), Edge::Left);
        assert_eq!(Edge::from_id("??"), Edge::Bottom);
        assert_eq!(Edge::from_id(Edge::Right.id()), Edge::Right);
    }

    #[test]
    fn only_the_pill_takes_the_mouse() {
        let rects = [HitRect { x: 100.0, y: 120.0, w: 80.0, h: 20.0 }];
        assert!(on_hit(&rects, 140.0, 130.0));
        assert!(on_hit(&rects, 99.0, 119.0));
        assert!(!on_hit(&rects, 40.0, 130.0));
        assert!(!on_hit(&[], 140.0, 130.0));
    }
}
