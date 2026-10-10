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
//     La bulle prend la taille de son contenu, en largeur et en hauteur
//     (src/pet/main.ts la mesure et l'anime) : la page demande la place qu'il
//     lui faut (`pet_bubble`), bornée à ce que l'écran laisse de son côté
//     (`max_w`, `max_h` de la disposition).
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
//
// Aussi : un raccourci global ouvre sa bulle (`mascot.petHotkey`), lâchée près
// d'un bord de l'écran ou de la barre des tâches elle s'y aimante, et quand
// personne ne touche le PC elle se promène un peu (`mascot.petWander`).

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
/// La bulle ouverte à côté d'elle (px logiques) : sa taille avant la première
/// mesure de la page, et ses bornes (mêmes valeurs dans src/pet/bubble-size.ts).
pub const BUBBLE_W: f64 = 420.0;
pub const BUBBLE_H: f64 = 480.0;
pub const BUBBLE_MIN_W: f64 = 360.0;
pub const BUBBLE_MIN_H: f64 = 120.0;
pub const BUBBLE_MAX_W: f64 = 640.0;
pub const BUBBLE_MAX_H: f64 = 560.0;
/// L'air laissé entre la bulle et le bord de la zone de travail (px logiques).
const SCREEN_GAP: f64 = 8.0;
/// La marge laissée au bord de l'écran quand Ondine n'a jamais été posée.
const DEFAULT_MARGIN: f64 = 48.0;
/// Lâchée à moins de ça (px logiques) d'un bord de la zone de travail, elle s'y colle.
const SNAP: f64 = 36.0;
/// La gomme ne touche pas les bords de sa case : collée à un bord, la case le
/// dépasse d'autant, pour qu'elle soit vraiment assise dessus.
const BOX_INSET: f64 = 10.0;
/// Les raccourcis proposés pour ouvrir sa bulle (les autres sont refusés).
pub const HOTKEYS: &[&str] = &["Ctrl+Alt+B", "Ctrl+Shift+B", "Alt+Shift+B"];
/// Le raccourci actuellement enregistré auprès de Windows ("" = aucun).
static HOTKEY: Mutex<String> = Mutex::new(String::new());
/// Personne n'a touché le PC depuis ça : elle peut aller se promener.
const WANDER_IDLE_MS: u64 = 90_000;

/// Où est la bulle par rapport à la mascotte (le front place les deux d'après ça).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub open: bool,
    /// La bulle est à droite de la mascotte (sinon à gauche).
    pub right: bool,
    /// La bulle monte au-dessus du bas de la mascotte (sinon elle descend depuis son haut).
    pub up: bool,
    /// La plus grande bulle qui tient dans l'écran de ce côté (px logiques).
    pub max_w: f64,
    pub max_h: f64,
}

const CLOSED: Layout = Layout { open: false, right: true, up: true, max_w: BUBBLE_MAX_W, max_h: BUBBLE_MAX_H };

/// La taille de la bulle (px logiques), bornée par la disposition.
fn clamp_bubble(l: Layout, (w, h): (f64, f64)) -> (f64, f64) {
    let (w, h) = (if w.is_finite() { w } else { BUBBLE_W }, if h.is_finite() { h } else { BUBBLE_H });
    (w.clamp(BUBBLE_MIN_W, l.max_w.max(BUBBLE_MIN_W)).round(), h.clamp(BUBBLE_MIN_H, l.max_h.max(BUBBLE_MIN_H)).round())
}

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
    /// La place que la fenêtre garde pour la bulle (px logiques).
    bubble: Mutex<(f64, f64)>,
    dragging: AtomicBool,
    walking: AtomicBool,
    hit: Mutex<Vec<HitRect>>,
}

impl Default for PetState {
    fn default() -> Self {
        Self { layout: Mutex::new(CLOSED), bubble: Mutex::new((BUBBLE_W, BUBBLE_H)), dragging: AtomicBool::new(false), walking: AtomicBool::new(false), hit: Mutex::new(Vec::new()) }
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
        // Présentation ou plein écran : elle s'éclipse, et revient après.
        let mut stepped_out = false;
        let mut was_down = false;
        let mut last_busy_check = std::time::Instant::now() - Duration::from_secs(10);
        loop {
            let Some(win) = window(&app) else { return };
            let Some(state) = app.try_state::<PetState>() else { return };
            if last_busy_check.elapsed() >= Duration::from_secs(2) {
                last_busy_check = std::time::Instant::now();
                let wanted = app.try_state::<crate::Shared>().map(|s| {
                    let s = s.settings.locked();
                    s.mascot.enabled && s.mascot.pet
                }).unwrap_or(false);
                let busy = wanted && platform::presentation_busy();
                if busy && !stepped_out && win.is_visible().unwrap_or(false) {
                    stepped_out = true;
                    let _ = win.hide();
                } else if !busy && stepped_out {
                    stepped_out = false;
                    if wanted {
                        let _ = win.show();
                    }
                }
            }
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
            // Un bouton qui s'enfonce près d'elle peut être le début d'un
            // glisser de fichier : sa page doit être une cible de dépôt.
            let down = platform::left_button_state().0;
            if down && !was_down && close {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || platform::unblock_window_drops(&handle, WINDOW_LABEL));
            }
            was_down = down;
            // Pendant son déplacement, la fenêtre garde la souris. Sinon, elle
            // la prend sur elle, bouton enfoncé ou non (un fichier qu'on lui apporte).
            let want_ignore = if state.dragging.load(Ordering::Relaxed) { ignoring } else { !on };
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

/// Le décalage (px logiques) de la case de la mascotte dans la fenêtre, pour
/// une disposition et une taille de bulle.
fn mascot_offset(l: Layout, (bw, bh): (f64, f64)) -> (f64, f64) {
    if !l.open {
        return (0.0, 0.0);
    }
    let x = if l.right { 0.0 } else { bw };
    let y = if l.up { bh.max(PET_BOX) - PET_BOX } else { 0.0 };
    (x, y)
}

/// La taille de la fenêtre (px logiques) pour une disposition et une taille de bulle.
fn window_size(l: Layout, (bw, bh): (f64, f64)) -> (f64, f64) {
    if l.open {
        (PET_BOX + bw, bh.max(PET_BOX))
    } else {
        (PET_BOX, PET_BOX)
    }
}

/// La place gardée pour la bulle.
fn bubble_of(app: &AppHandle) -> (f64, f64) {
    app.try_state::<PetState>().map(|s| *s.bubble.locked()).unwrap_or((BUBBLE_W, BUBBLE_H))
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
    // La zone de travail : l'écran sans la barre des tâches. Assise dessus, à droite.
    let wa = m.work_area();
    let pb = (PET_BOX * scale) as i32;
    let inset = (BOX_INSET * scale) as i32;
    (wa.position.x + wa.size.width as i32 - pb - (DEFAULT_MARGIN * scale) as i32, wa.position.y + wa.size.height as i32 - pb + inset)
}

/// Les bords de la zone de travail (gauche, haut, droite, bas), en px physiques.
fn work_edges(m: &Monitor) -> (i32, i32, i32, i32) {
    let wa = m.work_area();
    (wa.position.x, wa.position.y, wa.position.x + wa.size.width as i32, wa.position.y + wa.size.height as i32)
}

/// Lâchée près d'un bord de la zone de travail (barre des tâches comprise),
/// elle s'y colle ; elle ne sort jamais tout à fait de l'écran.
fn snap(edges: (i32, i32, i32, i32), scale: f64, mx: i32, my: i32) -> (i32, i32) {
    let (l, t, r, b) = edges;
    let pb = (PET_BOX * scale).round() as i32;
    let inset = (BOX_INSET * scale).round() as i32;
    let near = (SNAP * scale).round() as i32;
    let x = if (mx + inset - l).abs() < near {
        l - inset
    } else if (r - (mx + pb - inset)).abs() < near {
        r - pb + inset
    } else {
        mx.clamp(l - inset, r - pb + inset)
    };
    let y = if (my + inset - t).abs() < near {
        t - inset
    } else if (b - (my + pb - inset)).abs() < near {
        b - pb + inset
    } else {
        my.clamp(t - inset, b - pb + inset)
    };
    (x, y)
}

/// Où ouvrir la bulle : du côté où une bulle de `want` (px logiques) tient
/// dans la zone de travail de l'écran de la mascotte (`edges`, px physiques),
/// et la plus grande bulle qui y tient de ce côté.
fn choose_layout(edges: (i32, i32, i32, i32), scale: f64, mx: i32, my: i32, want: (f64, f64)) -> Layout {
    let (l, t, r, b) = (edges.0 as f64, edges.1 as f64, edges.2 as f64, edges.3 as f64);
    let (mx, my) = (mx as f64, my as f64);
    let (bw, bh, pb) = (want.0 * scale, want.1 * scale, PET_BOX * scale);
    let right = mx + pb + bw <= r || mx - bw < l;
    let up = my + pb - bh >= t;
    // La place de ce côté, en px logiques, moins un peu d'air.
    let room_w = if right { r - (mx + pb) } else { mx - l } / scale - SCREEN_GAP;
    let room_h = if up { my + pb - t } else { b - my } / scale - SCREEN_GAP;
    Layout {
        open: true,
        right,
        up,
        max_w: room_w.clamp(BUBBLE_MIN_W, BUBBLE_MAX_W).round(),
        max_h: room_h.clamp(BUBBLE_MIN_H, BUBBLE_MAX_H).round(),
    }
}

/// La disposition ouverte pour la mascotte au coin (mx, my).
fn open_layout(app: &AppHandle, mx: i32, my: i32, want: (f64, f64)) -> Layout {
    match monitor_at(app, mx as f64 + 4.0, my as f64 + 4.0) {
        Some(m) => choose_layout(work_edges(&m), m.scale_factor(), mx, my, want),
        None => Layout { open: true, ..CLOSED },
    }
}

/// Donne à la fenêtre la taille et la place d'une disposition, la mascotte
/// restant au coin (mx, my), et prévient la page.
fn apply_layout(app: &AppHandle, win: &WebviewWindow, l: Layout, mx: i32, my: i32) {
    let scale = monitor_at(app, mx as f64, my as f64).map(|m| m.scale_factor()).unwrap_or(1.0);
    let bubble = clamp_bubble(l, bubble_of(app));
    let (w, h) = window_size(l, bubble);
    let (ox, oy) = mascot_offset(l, bubble);
    let size = PhysicalSize::new((w * scale).round() as u32, (h * scale).round() as u32);
    let pos = PhysicalPosition::new(mx - (ox * scale).round() as i32, my - (oy * scale).round() as i32);
    if let Some(state) = app.try_state::<PetState>() {
        *state.layout.locked() = l;
        *state.bubble.locked() = bubble;
    }
    // La page se dispose d'abord, puis la fenêtre change : la mascotte ne saute pas.
    let _ = win.emit("pet-layout", l);
    // Place et taille d'un seul coup (une bulle qui grandit vers la gauche ou
    // vers le haut déplace la fenêtre en même temps qu'elle l'agrandit), puis
    // la taille encore une fois : passée sur un écran d'une autre échelle,
    // Windows a pu la recalculer.
    platform::set_bounds(win, pos, size);
    let _ = win.set_size(size);
}

/// La place actuelle de la mascotte à l'écran (px physiques), d'après la fenêtre.
fn current_mascot(app: &AppHandle, win: &WebviewWindow) -> Option<(i32, i32)> {
    let origin = win.outer_position().ok()?;
    let l = app.try_state::<PetState>().map(|s| *s.layout.locked()).unwrap_or(CLOSED);
    let scale = monitor_at(app, origin.x as f64, origin.y as f64).map(|m| m.scale_factor()).unwrap_or(1.0);
    let (ox, oy) = mascot_offset(l, bubble_of(app));
    Some((origin.x + (ox * scale).round() as i32, origin.y + (oy * scale).round() as i32))
}

/// Montre ou cache Ondine sur le bureau d'après les réglages (au démarrage et
/// à chaque enregistrement des réglages).
pub fn apply(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let (on, on_top, hotkey) = app.try_state::<crate::Shared>().map(|s| {
        let s = s.settings.locked();
        (s.mascot.enabled && s.mascot.pet, s.mascot.pet_on_top, s.mascot.pet_hotkey.clone())
    }).unwrap_or((false, true, String::new()));
    apply_hotkey(app, if on { &hotkey } else { "" });
    crate::tray::sync_pet(app, on);
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

/// Enregistre le raccourci qui ouvre sa bulle (ou le retire si `wanted` est
/// vide ou inconnu). Un appui envoie "pet-hotkey" à sa page.
fn apply_hotkey(app: &AppHandle, wanted: &str) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let wanted = if HOTKEYS.contains(&wanted) { wanted } else { "" };
    let mut current = HOTKEY.locked();
    if *current == wanted {
        return;
    }
    let gs = app.global_shortcut();
    if !current.is_empty() {
        let _ = gs.unregister(current.as_str());
    }
    *current = wanted.to_string();
    if wanted.is_empty() {
        return;
    }
    let result = gs.on_shortcut(wanted, |app, _shortcut, event| {
        if event.state == ShortcutState::Released {
            let _ = app.emit_to(WINDOW_LABEL, "pet-hotkey", ());
        }
    });
    if let Err(e) = result {
        log::warn(format!("Ondine sur le bureau : le raccourci {wanted} est refusé ({e}) ; choisissez-en un autre dans Réglages > Mascotte"));
    }
}

/// Ouvre (ou ferme) la bulle à côté de la mascotte. `want` : la taille de la
/// bulle mesurée par la page (px logiques), si elle l'a.
pub fn set_open(app: &AppHandle, open: bool, want: Option<(f64, f64)>) -> Layout {
    let Some(win) = window(app) else { return CLOSED };
    let Some((mx, my)) = current_mascot(app, &win) else { return CLOSED };
    if let (Some(want), Some(state)) = (want, app.try_state::<PetState>()) {
        *state.bubble.locked() = want;
    }
    let l = if open { open_layout(app, mx, my, bubble_of(app)) } else { CLOSED };
    apply_layout(app, &win, l, mx, my);
    // Ouverte : la bulle prend le clavier (le champ de « Parler à Ondine ») ;
    // fermée : le focus retourne à l'appli d'avant.
    platform::set_activating(&win, open);
    if open {
        let _ = win.set_focus();
    }
    l
}

/// La page demande une autre place pour la bulle (son contenu a changé) : la
/// fenêtre s'agrandit ou se resserre autour, la mascotte ne bouge pas. Le côté
/// ne change pas tant que la bulle est ouverte ; la taille reste bornée à l'écran.
pub fn set_bubble(app: &AppHandle, w: f64, h: f64) {
    let Some(win) = window(app) else { return };
    let Some(state) = app.try_state::<PetState>() else { return };
    let l = *state.layout.locked();
    if state.dragging.load(Ordering::SeqCst) {
        return;
    }
    let want = clamp_bubble(l, (w, h));
    if want == *state.bubble.locked() {
        return;
    }
    if !l.open {
        *state.bubble.locked() = want;
        return;
    }
    // La place de la mascotte d'abord (elle dépend de l'ancienne taille).
    let Some((mx, my)) = current_mascot(app, &win) else { return };
    *state.bubble.locked() = want;
    apply_layout(app, &win, l, mx, my);
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
        // Au-dessus de l'île : l'île se montre et Ondine le sent (lâchée là, elle rentre).
        let mut over = false;
        loop {
            std::thread::sleep(Duration::from_millis(8));
            let (down, _) = platform::left_button_state();
            let Some((cx, cy)) = platform::cursor_physical() else { break };
            if !down {
                break;
            }
            let _ = win.set_position(PhysicalPosition::new((cx - gx).round() as i32, (cy - gy).round() as i32));
            let now = over_island(&app, cx, cy);
            if now != over {
                over = now;
                let _ = app.emit("pet-over-island", over);
            }
        }
        if over {
            let _ = app.emit("pet-over-island", false);
            if let Some(state) = app.try_state::<PetState>() {
                state.dragging.store(false, Ordering::SeqCst);
            }
            let _ = win.emit("pet-drag-end", ());
            back_to_island(&app);
            return;
        }
        drag_end(&app, &win);
        if let Some(state) = app.try_state::<PetState>() {
            state.dragging.store(false, Ordering::SeqCst);
        }
    });
}

fn over_island(app: &AppHandle, x: f64, y: f64) -> bool {
    app.try_state::<crate::Shared>().map(|s| crate::island::screen_point_on_island(app, &s.gate, x, y)).unwrap_or(false)
}

fn drag_end(app: &AppHandle, win: &WebviewWindow) {
    let Some((mx, my)) = current_mascot(app, win) else { return };
    let open = app.try_state::<PetState>().map(|s| s.layout.locked().open).unwrap_or(false);
    let (mx, my) = match monitor_at(app, mx as f64 + 4.0, my as f64 + 4.0) {
        Some(m) => {
            // Près d'un bord : elle s'y colle. La bulle ouverte a peut-être
            // maintenant plus de place de l'autre côté.
            let (sx, sy) = snap(work_edges(&m), m.scale_factor(), mx, my);
            let l = if open { choose_layout(work_edges(&m), m.scale_factor(), sx, sy, bubble_of(app)) } else { CLOSED };
            apply_layout(app, win, l, sx, sy);
            (sx, sy)
        }
        None => (mx, my),
    };
    save_place(app, mx, my);
    let _ = win.emit("pet-drag-end", ());
}

/// Quand personne ne touche le PC, elle fait quelques pas le long de son bord
/// (réglage `mascot.petWander`) : jamais bulle ouverte, en présentation, en
/// « Calme », ni pendant un déplacement. Le moindre mouvement de souris l'arrête.
pub fn spawn_wander(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(20));
        let wanted = app.try_state::<crate::Shared>().map(|s| {
            let s = s.settings.locked();
            s.mascot.enabled && s.mascot.pet && s.mascot.pet_wander && !s.mascot.calm
        }).unwrap_or(false);
        let (Some(win), Some(state)) = (window(&app), app.try_state::<PetState>()) else { continue };
        if !wanted || !win.is_visible().unwrap_or(false) || state.layout.locked().open || state.dragging.load(Ordering::SeqCst) {
            continue;
        }
        if platform::idle_ms() < WANDER_IDLE_MS || platform::presentation_busy() {
            continue;
        }
        let Some((mx, my)) = current_mascot(&app, &win) else { continue };
        let Some(m) = monitor_at(&app, mx as f64 + 4.0, my as f64 + 4.0) else { continue };
        let scale = m.scale_factor();
        let (l, _, r, _) = work_edges(&m);
        // Un « hasard » suffisant : les nanosecondes de l'horloge.
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        let steps = (80.0 + (seed % 160) as f64) * scale;
        let pb = (PET_BOX * scale) as i32;
        let mut dir = if seed.is_multiple_of(2) { 1 } else { -1 };
        // Pas de place de ce côté : l'autre.
        if (dir > 0 && mx + pb + steps as i32 > r) || (dir < 0 && mx - (steps as i32) < l) {
            dir = -dir;
        }
        let target = (mx + dir * steps as i32).clamp(l, r - pb);
        if target == mx {
            continue;
        }
        state.walking.store(true, Ordering::SeqCst);
        let _ = win.emit("pet-walk", dir);
        // ~45 px logiques par seconde, à 30 images par seconde.
        let per_frame = (1.5 * scale).max(1.0);
        let mut x = mx as f64;
        loop {
            std::thread::sleep(Duration::from_millis(33));
            if platform::idle_ms() < 1500 || state.dragging.load(Ordering::SeqCst) || state.layout.locked().open {
                break;
            }
            x += dir as f64 * per_frame;
            if (dir > 0 && x >= target as f64) || (dir < 0 && x <= target as f64) {
                x = target as f64;
            }
            let _ = win.set_position(PhysicalPosition::new(x.round() as i32, my));
            if x as i32 == target {
                break;
            }
        }
        state.walking.store(false, Ordering::SeqCst);
        let _ = win.emit("pet-walk", 0);
        if !state.dragging.load(Ordering::SeqCst) && !state.layout.locked().open {
            save_place(&app, x.round() as i32, my);
        }
    });
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
        s.mascot.enabled = true;
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
        let b = (BUBBLE_W, BUBBLE_H);
        let open = |right, up| Layout { open: true, right, up, ..CLOSED };
        assert_eq!(mascot_offset(CLOSED, b), (0.0, 0.0));
        assert_eq!(window_size(CLOSED, b), (PET_BOX, PET_BOX));
        // Bulle à droite, vers le haut : la mascotte en bas à gauche de la fenêtre.
        assert_eq!(mascot_offset(open(true, true), b), (0.0, BUBBLE_H - PET_BOX));
        // Bulle à gauche, vers le bas : la mascotte en haut à droite.
        assert_eq!(mascot_offset(open(false, false), b), (BUBBLE_W, 0.0));
        assert_eq!(window_size(open(false, false), b), (PET_BOX + BUBBLE_W, BUBBLE_H));
        // Une petite bulle (moins haute que la case) : la fenêtre garde la hauteur de la case.
        assert_eq!(window_size(open(true, true), (300.0, 90.0)), (PET_BOX + 300.0, PET_BOX));
        assert_eq!(mascot_offset(open(false, true), (300.0, 90.0)), (300.0, 0.0));
    }

    #[test]
    fn the_bubble_fits_its_content_within_the_screen() {
        // Écran 1920 × 1080, barre des tâches de 48 px, échelle 1.
        let edges = (0, 0, 1920, 1032);
        // En bas à droite : la bulle va à gauche, vers le haut.
        let l = choose_layout(edges, 1.0, 1760, 930, (400.0, 300.0));
        assert!(!l.right && l.up);
        assert_eq!(l.max_w, BUBBLE_MAX_W);
        assert_eq!(l.max_h, BUBBLE_MAX_H);
        // Près du haut de l'écran : vers le bas, et pas plus haute que la place.
        let l = choose_layout(edges, 1.0, 400, 10, (400.0, 300.0));
        assert!(l.right && !l.up);
        assert_eq!(l.max_h, BUBBLE_MAX_H);
        // Petit écran (1024 × 600) : bornée à la place qui reste.
        let l = choose_layout((0, 0, 1024, 600), 1.0, 500, 450, (600.0, 500.0));
        assert!(l.up);
        assert_eq!(l.max_h, 450.0 + 112.0 - 8.0);
        assert_eq!(l.max_w, 1024.0 - 612.0 - 8.0);
        // Échelle 1,5 : les bornes restent en px logiques.
        let l = choose_layout((0, 0, 2880, 1620), 1.5, 100, 1400, (400.0, 300.0));
        assert!(l.right && l.up);
        assert_eq!(l.max_h, BUBBLE_MAX_H);
        // La taille demandée est bornée : jamais plus petite que le minimum, jamais plus grande que l'écran.
        let small = Layout { open: true, right: true, up: true, max_w: 500.0, max_h: 300.0 };
        assert_eq!(clamp_bubble(small, (100.0, 50.0)), (BUBBLE_MIN_W, BUBBLE_MIN_H));
        assert_eq!(clamp_bubble(small, (900.0, 900.0)), (500.0, 300.0));
        assert_eq!(clamp_bubble(small, (f64::NAN, 200.4)), (BUBBLE_W.min(500.0), 200.0));
    }

    #[test]
    fn she_sticks_to_the_nearby_edges() {
        // Écran 1920 × 1080, barre des tâches de 48 px en bas, échelle 1.
        let edges = (0, 0, 1920, 1032);
        // Au milieu : elle reste où on l'a lâchée.
        assert_eq!(snap(edges, 1.0, 800, 500), (800, 500));
        // Près de la barre des tâches : assise dessus (la case dépasse de BOX_INSET).
        assert_eq!(snap(edges, 1.0, 800, 1032 - 112 + 10 - 20), (800, 1032 - 112 + 10));
        // Près du bord gauche.
        assert_eq!(snap(edges, 1.0, 15, 500), (-10, 500));
        // Lâchée en partie hors de l'écran : ramenée dedans.
        assert_eq!(snap(edges, 1.0, 3000, 500).0, 1920 - 112 + 10);
        // Échelle 1,5 : les distances suivent.
        assert_eq!(snap(edges, 1.5, 30, 500), (-15, 500));
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
