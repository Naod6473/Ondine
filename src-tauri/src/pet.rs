// Ondine sur le bureau : la gomme sort de l'île et vit où on la pose.
//
// Une petite fenêtre à part (label "pet", page pet.html), sans bordure,
// transparente, hors de la barre des tâches et d'Alt+Tab, au-dessus des
// fenêtres ou derrière elles (réglage `mascot.petOnTop`). Elle a deux tailles :
//   - fermée : juste la case de la mascotte (PET_BOX × PET_BOX) ;
//   - ouverte : la case et, à côté, la bulle avec les onglets choisis
//     (`mascot.petTabs`). La bulle va du côté où l'écran a de la place
//     (droite sinon gauche, vers le haut sinon vers le bas) ; la mascotte, elle,
//     ne bouge pas à l'écran : seule la fenêtre s'agrandit autour d'elle.
//
// On la déplace en l'attrapant (`pet_drag_start`) : la fenêtre suit la souris
// jusqu'au lâcher (bulle comprise), puis la place de la mascotte est enregistrée
// (`mascot.petX`, `mascot.petY`, px physiques du coin de sa case). Une place
// négative veut dire « jamais posée » : en bas à droite de l'écran principal.
// Une place hors de tous les écrans (écran débranché) revient là aussi.
//
// Clics traversants : comme l'île, la fenêtre est un rectangle, mais seules la
// mascotte et la bulle doivent prendre la souris. La page envoie leurs cases
// (`pet_set_hit`) et un petit thread lit la souris pour basculer
// set_ignore_cursor_events (voir island/mod.rs pour la technique).

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::platform;
use crate::services::log;

pub const WINDOW_LABEL: &str = "pet";

/// La case de la mascotte (px logiques).
pub const PET_BOX: f64 = 112.0;
/// La bulle ouverte à côté d'elle (px logiques).
pub const BUBBLE_W: f64 = 420.0;
pub const BUBBLE_H: f64 = 480.0;
/// La marge laissée au bord de l'écran quand Ondine n'a jamais été posée.
const DEFAULT_MARGIN: f64 = 48.0;

/// Où est la bulle par rapport à la mascotte (le front place les deux d'après ça).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub open: bool,
    /// La bulle est à droite de la mascotte (sinon à gauche).
    pub right: bool,
    /// La bulle monte au-dessus du bas de la mascotte (sinon elle descend depuis son haut).
    pub up: bool,
}

const CLOSED: Layout = Layout { open: false, right: true, up: true };

/// Une case de la page qui prend la souris (px logiques, depuis le coin de la fenêtre).
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// L'état de la fenêtre : la disposition en cours, un déplacement en cours, et
/// les cases qui prennent la souris.
pub struct PetState {
    layout: Mutex<Layout>,
    dragging: AtomicBool,
    hit: Mutex<Vec<HitRect>>,
}

impl Default for PetState {
    fn default() -> Self {
        Self { layout: Mutex::new(CLOSED), dragging: AtomicBool::new(false), hit: Mutex::new(Vec::new()) }
    }
}

/// La page dit où sont la mascotte et la bulle.
pub fn set_hit(app: &AppHandle, rects: Vec<HitRect>) {
    if let Some(state) = app.try_state::<PetState>() {
        *state.hit.locked() = rects.into_iter().filter(|r| r.w > 0.0 && r.h > 0.0).take(8).collect();
    }
}

fn on_hit(rects: &[HitRect], x: f64, y: f64) -> bool {
    // Un rien de marge : le bord flou de la gomme se prend aussi.
    const M: f64 = 4.0;
    rects.iter().any(|r| x >= r.x - M && x <= r.x + r.w + M && y >= r.y - M && y <= r.y + r.h + M)
}

/// Lit la souris tant qu'Ondine est sur le bureau : clics traversants hors de
/// la mascotte et de la bulle. 30 fois par seconde près d'elle, 8 loin.
pub fn spawn_hit_poll(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ignoring = false;
        let mut last = (f64::MIN, f64::MIN);
        loop {
            let Some(win) = window(&app) else { return };
            let Some(state) = app.try_state::<PetState>() else { return };
            if !win.is_visible().unwrap_or(false) {
                std::thread::sleep(Duration::from_millis(400));
                continue;
            }
            let near = (|| {
                let (cx, cy) = platform::cursor_physical()?;
                let origin = win.outer_position().ok()?;
                let size = win.outer_size().ok()?;
                let scale = win.scale_factor().ok()?;
                let (x, y) = ((cx - origin.x as f64) / scale, (cy - origin.y as f64) / scale);
                let inside = x >= -40.0 && y >= -40.0 && x <= size.width as f64 / scale + 40.0 && y <= size.height as f64 / scale + 40.0;
                // La page ne voit pas la souris hors de la mascotte (clics
                // traversants) : on lui envoie, pour que ses yeux la suivent.
                if (x - last.0).abs() >= 1.0 || (y - last.1).abs() >= 1.0 {
                    last = (x, y);
                    let _ = win.emit("pet-cursor", serde_json::json!({ "x": x, "y": y }));
                }
                Some((on_hit(&state.hit.locked(), x, y), inside))
            })();
            let (on, close) = near.unwrap_or((true, true));
            // Bouton enfoncé (déplacement d'Ondine, ou d'autre chose par-dessus
            // elle) : rien ne change avant le lâcher.
            let held = state.dragging.load(Ordering::Relaxed) || platform::left_button_state().0;
            let want_ignore = if held { ignoring } else { !on };
            if want_ignore != ignoring {
                ignoring = want_ignore;
                let _ = win.set_ignore_cursor_events(ignoring);
            }
            std::thread::sleep(Duration::from_millis(if close { 33 } else { 120 }));
        }
    });
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Le décalage (px logiques) de la case de la mascotte dans la fenêtre.
fn mascot_offset(l: Layout) -> (f64, f64) {
    if !l.open {
        return (0.0, 0.0);
    }
    let x = if l.right { 0.0 } else { BUBBLE_W };
    let y = if l.up { BUBBLE_H - PET_BOX } else { 0.0 };
    (x, y)
}

/// La taille de la fenêtre (px logiques) pour une disposition.
fn window_size(l: Layout) -> (f64, f64) {
    if l.open {
        (PET_BOX + BUBBLE_W, BUBBLE_H.max(PET_BOX))
    } else {
        (PET_BOX, PET_BOX)
    }
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64 && x < (p.x + s.width as i32) as f64 && y >= p.y as f64 && y < (p.y + s.height as i32) as f64
}

/// L'écran qui contient ce point (px physiques), sinon le principal.
fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if let Some(m) = monitors.iter().find(|m| monitor_contains(m, x, y)) {
        return Some(m.clone());
    }
    app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())
}

/// La place de la mascotte (px physiques du coin de sa case) : celle des
/// réglages si elle tombe sur un écran, sinon en bas à droite du principal.
fn mascot_place(app: &AppHandle) -> (i32, i32) {
    let (x, y) = app.try_state::<crate::Shared>().map(|s| {
        let s = s.settings.locked();
        (s.mascot.pet_x, s.mascot.pet_y)
    }).unwrap_or((-1.0, -1.0));
    let monitors = app.available_monitors().unwrap_or_default();
    if x >= 0.0 && y >= 0.0 && monitors.iter().any(|m| monitor_contains(m, x + 4.0, y + 4.0)) {
        return (x as i32, y as i32);
    }
    let Some(m) = app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next()) else { return (100, 100) };
    let scale = m.scale_factor();
    let p = m.position();
    let s = m.size();
    let edge = ((PET_BOX + DEFAULT_MARGIN) * scale) as i32;
    // Un peu plus haut en bas : la barre des tâches.
    (p.x + s.width as i32 - edge, p.y + s.height as i32 - edge - (48.0 * scale) as i32)
}

/// Où ouvrir la bulle : du côté où elle tient dans l'écran de la mascotte.
fn choose_layout(m: &Monitor, mx: i32, my: i32) -> Layout {
    let scale = m.scale_factor();
    let p = m.position();
    let s = m.size();
    let (bw, bh, pb) = (BUBBLE_W * scale, BUBBLE_H * scale, PET_BOX * scale);
    let right = mx as f64 + pb + bw <= (p.x + s.width as i32) as f64 || (mx as f64 - bw) < p.x as f64;
    let up = my as f64 + pb - bh >= p.y as f64;
    Layout { open: true, right, up }
}

/// Donne à la fenêtre la taille et la place d'une disposition, la mascotte
/// restant au coin (mx, my), et prévient la page.
fn apply_layout(app: &AppHandle, win: &WebviewWindow, l: Layout, mx: i32, my: i32) {
    let scale = monitor_at(app, mx as f64, my as f64).map(|m| m.scale_factor()).unwrap_or(1.0);
    let (w, h) = window_size(l);
    let (ox, oy) = mascot_offset(l);
    let size = PhysicalSize::new((w * scale).round() as u32, (h * scale).round() as u32);
    let pos = PhysicalPosition::new(mx - (ox * scale).round() as i32, my - (oy * scale).round() as i32);
    // La page se dispose d'abord, puis la fenêtre change : la mascotte ne saute pas.
    let _ = win.emit("pet-layout", l);
    let _ = win.set_size(size);
    let _ = win.set_position(pos);
    let _ = win.set_size(size);
    if let Some(state) = app.try_state::<PetState>() {
        *state.layout.locked() = l;
    }
}

/// La place actuelle de la mascotte à l'écran (px physiques), d'après la fenêtre.
fn current_mascot(app: &AppHandle, win: &WebviewWindow) -> Option<(i32, i32)> {
    let origin = win.outer_position().ok()?;
    let l = app.try_state::<PetState>().map(|s| *s.layout.locked()).unwrap_or(CLOSED);
    let scale = monitor_at(app, origin.x as f64, origin.y as f64).map(|m| m.scale_factor()).unwrap_or(1.0);
    let (ox, oy) = mascot_offset(l);
    Some((origin.x + (ox * scale).round() as i32, origin.y + (oy * scale).round() as i32))
}

/// Montre ou cache Ondine sur le bureau d'après les réglages (au démarrage et
/// à chaque enregistrement des réglages).
pub fn apply(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let (on, on_top) = app.try_state::<crate::Shared>().map(|s| {
        let s = s.settings.locked();
        (s.mascot.enabled && s.mascot.pet, s.mascot.pet_on_top)
    }).unwrap_or((false, true));
    if !on {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            if let Some(state) = app.try_state::<PetState>() {
                *state.layout.locked() = CLOSED;
            }
        }
        return;
    }
    let _ = win.set_always_on_top(on_top);
    let _ = win.set_always_on_bottom(!on_top);
    if !win.is_visible().unwrap_or(false) {
        let (mx, my) = mascot_place(app);
        apply_layout(app, &win, CLOSED, mx, my);
        platform::make_non_activating(&win);
        let _ = win.show();
    }
}

/// Ouvre (ou ferme) la bulle à côté de la mascotte.
pub fn set_open(app: &AppHandle, open: bool) -> Layout {
    let Some(win) = window(app) else { return CLOSED };
    let Some((mx, my)) = current_mascot(app, &win) else { return CLOSED };
    let l = if open {
        match monitor_at(app, mx as f64, my as f64) {
            Some(m) => choose_layout(&m, mx, my),
            None => Layout { open: true, right: true, up: true },
        }
    } else {
        CLOSED
    };
    apply_layout(app, &win, l, mx, my);
    // Ouverte : la bulle prend le clavier (le champ de « Parler à Ondine ») ;
    // fermée : le focus retourne à l'appli d'avant.
    platform::set_activating(&win, open);
    if open {
        let _ = win.set_focus();
    }
    l
}

/// On a attrapé Ondine : la fenêtre suit la souris jusqu'au lâcher, puis la
/// place est enregistrée et la bulle, si elle est ouverte, se replace.
pub fn drag_start(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let Some(state) = app.try_state::<PetState>() else { return };
    if state.dragging.swap(true, Ordering::SeqCst) {
        return;
    }
    let (Ok(origin), Some((cx, cy))) = (win.outer_position(), platform::cursor_physical()) else {
        state.dragging.store(false, Ordering::SeqCst);
        return;
    };
    let (gx, gy) = (cx - origin.x as f64, cy - origin.y as f64);
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(8));
            let (down, _) = platform::left_button_state();
            let Some((cx, cy)) = platform::cursor_physical() else { break };
            if !down {
                break;
            }
            let _ = win.set_position(PhysicalPosition::new((cx - gx).round() as i32, (cy - gy).round() as i32));
        }
        drag_end(&app, &win);
        if let Some(state) = app.try_state::<PetState>() {
            state.dragging.store(false, Ordering::SeqCst);
        }
    });
}

fn drag_end(app: &AppHandle, win: &WebviewWindow) {
    let Some((mx, my)) = current_mascot(app, win) else { return };
    save_place(app, mx, my);
    // La bulle ouverte a peut-être maintenant plus de place de l'autre côté.
    let open = app.try_state::<PetState>().map(|s| s.layout.locked().open).unwrap_or(false);
    if open {
        if let Some(m) = monitor_at(app, mx as f64, my as f64) {
            apply_layout(app, win, choose_layout(&m, mx, my), mx, my);
        }
    }
    let _ = win.emit("pet-drag-end", ());
}

/// Enregistre la place de la mascotte, sous le verrou des réglages (comme
/// apply_settings), et prévient les fenêtres.
fn save_place(app: &AppHandle, mx: i32, my: i32) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let new = {
        let mut s = shared.settings.locked();
        s.mascot.pet_x = mx as f64;
        s.mascot.pet_y = my as f64;
        if let Err(e) = crate::services::settings::save(&s) {
            log::warn(format!("place d'Ondine non enregistrée : {e}"));
        }
        s.clone()
    };
    let _ = app.emit("settings-changed", new);
}

/// Ondine quitte l'île pour le bureau, posée au point (px physiques) où on
/// l'a lâchée (glisser depuis l'île), ou à sa dernière place.
pub fn place_on_desk(app: &AppHandle, at: Option<(f64, f64)>) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let new = {
        let mut s = shared.settings.locked();
        s.mascot.pet = true;
        if let Some((x, y)) = at {
            let scale = monitor_at(app, x, y).map(|m| m.scale_factor()).unwrap_or(1.0);
            // Le point lâché devient le centre de la mascotte.
            s.mascot.pet_x = (x - PET_BOX * scale / 2.0).max(0.0).round();
            s.mascot.pet_y = (y - PET_BOX * scale / 2.0).max(0.0).round();
        }
        if let Err(e) = crate::services::settings::save(&s) {
            log::warn(format!("réglages non enregistrés : {e}"));
        }
        s.clone()
    };
    log::info("Ondine posée sur le bureau");
    if let Some(win) = window(app) {
        // Déjà sur le bureau : elle se déplace au nouveau point.
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        }
    }
    let _ = app.emit("settings-changed", new);
    apply(app);
}

/// Ondine rentre dans l'île.
pub fn back_to_island(app: &AppHandle) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let new = {
        let mut s = shared.settings.locked();
        s.mascot.pet = false;
        if let Err(e) = crate::services::settings::save(&s) {
            log::warn(format!("réglages non enregistrés : {e}"));
        }
        s.clone()
    };
    log::info("Ondine rentre dans l'île");
    let _ = app.emit("settings-changed", new);
    apply(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mascot_stays_in_its_corner() {
        assert_eq!(mascot_offset(CLOSED), (0.0, 0.0));
        assert_eq!(window_size(CLOSED), (PET_BOX, PET_BOX));
        // Bulle à droite, vers le haut : la mascotte en bas à gauche de la fenêtre.
        assert_eq!(mascot_offset(Layout { open: true, right: true, up: true }), (0.0, BUBBLE_H - PET_BOX));
        // Bulle à gauche, vers le bas : la mascotte en haut à droite.
        assert_eq!(mascot_offset(Layout { open: true, right: false, up: false }), (BUBBLE_W, 0.0));
        assert_eq!(window_size(Layout { open: true, right: false, up: false }), (PET_BOX + BUBBLE_W, BUBBLE_H));
    }

    #[test]
    fn only_the_mascot_and_bubble_catch_the_mouse() {
        let rects = [HitRect { x: 0.0, y: 0.0, w: 112.0, h: 112.0 }, HitRect { x: 112.0, y: 0.0, w: 420.0, h: 300.0 }];
        assert!(on_hit(&rects, 50.0, 50.0));
        assert!(on_hit(&rects, 300.0, 200.0));
        assert!(!on_hit(&rects, 300.0, 400.0));
        assert!(!on_hit(&[], 1.0, 1.0));
    }
}
