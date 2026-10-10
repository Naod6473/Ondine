// L'île qui s'écarte des fenêtres : les obstacles, la place provisoire et le
// déplacement au ressort de la fenêtre de l'île.
//
// Des « sources » donnent chacune un rectangle à éviter (px physiques de
// l'écran) : "settings" (la fenêtre de réglages, suivie par ses événements
// Moved / Resized, voir lib.rs), "foreground" (la fenêtre au premier plan,
// module Ondine et les fenêtres), "toast" (une bulle de Windows dans le coin).
// À chaque changement, `recompute` demande au calcul pur (avoid.rs) où aller.
//
// La place choisie est PROVISOIRE : elle remplace la place réglée tant qu'il le
// faut (`Placement::current`), mais n'est jamais enregistrée. Quand plus rien
// ne gêne, l'île rentre chez elle.
//
// Le déplacement : un ressort un peu amorti (un petit rebond à l'arrivée), dans
// un thread qui bouge la fenêtre ~60 fois par seconde et s'arrête quand elle est
// posée. Interruptible : une nouvelle cible ne change que la cible, la vitesse
// est gardée. Acculée, elle tremble un peu. « Réduire les animations » de
// Windows ou le mode Calme de la mascotte : elle va directement à sa place.
//
// Le front est prévenu par l'événement "island-placement" (bord, place, et ce
// qui se passe : "flee", "cornered" ou "home") : il adapte la forme de l'île au
// nouveau bord et Ondine a peur, puis est soulagée.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

use super::avoid::{self, Rect, Screen, Size};
use super::{target_monitor, window, Placement, WINDOW_LABEL};
use crate::platform;
use crate::services::log;
use crate::sync::LockExt;

/// Taille de l'île au moins prise en compte (la mini-île, px logiques) : même
/// cachée, elle peut se réveiller à tout moment.
const MIN_LEN: f64 = 340.0;
const MIN_THICK: f64 = 44.0;
/// Au plus (l'île ouverte) : au-delà, on garderait une île dodue pour rien.
const MAX_THICK: f64 = 280.0;
/// Une fenêtre au premier plan : l'île s'en écarte moins (marge plus petite).
const SOFT_MARGIN: f64 = 6.0;
/// Le ressort du déplacement (raideur, amortissement relatif : < 1 = petit rebond).
const STIFFNESS: f64 = 170.0;
const DAMPING_RATIO: f64 = 0.72;
const FRAME: Duration = Duration::from_millis(16);
/// Le tremblement d'une île acculée : amplitude (px logiques), durée, fréquence.
const SHAKE_PX: f64 = 3.0;
const SHAKE_FOR: Duration = Duration::from_millis(520);
const SHAKE_HZ: f64 = 14.0;
/// Pas plus d'un tremblement par…
const SHAKE_EVERY: Duration = Duration::from_millis(900);

/// Ce que dit l'événement "island-placement" au front.
#[derive(Serialize, Clone)]
pub struct PlacementEvent {
    pub edge: String,
    pub align: String,
    /// "flee" (elle s'écarte), "cornered" (acculée), "home" (rentrée chez elle).
    pub phase: &'static str,
    /// Seulement des fenêtres « douces » (premier plan, bulles) : pas de peur.
    pub soft: bool,
}

#[derive(Default)]
struct Mover {
    running: bool,
    pos: (f64, f64),
    vel: (f64, f64),
    target: (f64, f64),
    /// Le tremblement en cours : depuis quand, et le sens du bord (x ou y).
    shake: Option<(Instant, bool)>,
    scale: f64,
}

/// Un rectangle de l'écran en px physiques : x, y, largeur, hauteur.
pub type PhysRect = (i32, i32, u32, u32);

#[derive(Default)]
pub struct Dodge {
    /// Les rectangles à éviter, par source (px physiques de l'écran).
    obstacles: Mutex<HashMap<&'static str, PhysRect>>,
    /// La place provisoire (None : la place réglée).
    place: Mutex<Option<Placement>>,
    cornered: Mutex<bool>,
    /// La place provisoire vient de la fenêtre de réglages (Ondine a eu peur :
    /// elle sera soulagée en rentrant).
    frightened: Mutex<bool>,
    last_shake: Mutex<Option<Instant>>,
    mover: Mutex<Mover>,
    /// Posée sur la barre de titre d'une fenêtre (module Ondine et les
    /// fenêtres) : le milieu de la barre et son haut (px physiques).
    perch: Mutex<Option<(i32, i32)>>,
}

impl Dodge {
    /// La place provisoire, s'il y en a une.
    pub fn place(&self) -> Option<Placement> {
        self.place.locked().clone()
    }

    /// Oublie la place provisoire (l'île vient d'être déplacée à la main).
    pub fn forget(&self) {
        *self.place.locked() = None;
        *self.cornered.locked() = false;
        *self.frightened.locked() = false;
        let mut m = self.mover.locked();
        m.running = false;
    }

    /// Le déplacement au ressort est-il en cours ? (apply_geometry ne pose
    /// alors pas la fenêtre lui-même : il change la cible.)
    pub fn moving(&self) -> bool {
        self.mover.locked().running
    }

    /// Change la cible du ressort en cours (même place, autre taille de fenêtre).
    pub fn retarget(&self, x: i32, y: i32) {
        let mut m = self.mover.locked();
        if m.running {
            m.target = (x as f64, y as f64);
        }
    }

    pub fn has_obstacle(&self, source: &str) -> bool {
        self.obstacles.locked().contains_key(source)
    }

    /// Où elle est perchée (None : sur son bord).
    pub fn perch(&self) -> Option<(i32, i32)> {
        *self.perch.locked()
    }
}

/// Perchée sur une barre de titre (île du haut seulement) : la fenêtre de
/// l'île se centre sur `cx` et se pose sur `top` (px physiques), sans sortir
/// de l'écran `(x, y, largeur, hauteur)`. Sinon, la place calculée `frame`.
pub fn perched_frame(frame: (u32, u32, i32, i32), perch: Option<(i32, i32)>, edge: &str, screen: (i32, i32, u32, u32)) -> (u32, u32, i32, i32) {
    let (pw, ph, x, y) = frame;
    let Some((cx, top)) = perch else { return (pw, ph, x, y) };
    if edge != "top" {
        return (pw, ph, x, y);
    }
    let (sx, sy, sw, sh) = screen;
    let nx = (cx - pw as i32 / 2).clamp(sx, sx + (sw as i32 - pw as i32).max(0));
    let ny = top.clamp(sy, sy + (sh as i32 - ph as i32).max(0));
    (pw, ph, nx, ny)
}

/// Se percher sur une barre de titre (Some : son milieu et son haut, px
/// physiques), ou revenir sur son bord (None). Au ressort, comme une fuite.
pub fn set_perch(app: &AppHandle, perch: Option<(i32, i32)>) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    {
        let mut p = shared.gate.dodge.perch.locked();
        // Quelques pixels de différence : on ne bouge pas (la fenêtre tremble sinon).
        let same = match (*p, perch) {
            (Some(a), Some(b)) => (a.0 - b.0).abs() < 3 && (a.1 - b.1).abs() < 3,
            (None, None) => true,
            _ => false,
        };
        if same || shared.gate.drag.locked().is_some() {
            return;
        }
        *p = perch;
    }
    let place = super::Placement::current(app);
    move_to(app, &place);
}

/// Un rectangle à éviter (px physiques), ou None quand il n'y en a plus.
pub fn set_obstacle(app: &AppHandle, source: &'static str, rect: Option<PhysRect>) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let changed = {
        let mut obs = shared.gate.dodge.obstacles.locked();
        let before = obs.get(source).copied();
        match rect {
            Some(r) if r.2 > 0 && r.3 > 0 => {
                obs.insert(source, r);
            }
            _ => {
                obs.remove(source);
            }
        }
        before != obs.get(source).copied()
    };
    if changed {
        recompute(app);
    }
}

/// Le label de la fenêtre de réglages (lib.rs, create_hidden_window).
pub const SETTINGS_LABEL: &str = "settings";

/// Suit la fenêtre de réglages : à chaque déplacement ou changement de taille,
/// l'île vérifie qu'elle ne la cache pas. Montrée / cachée : lib.rs appelle
/// `settings_window_changed` (Tauri n'a pas d'événement pour ça).
pub fn watch_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window(SETTINGS_LABEL) else { return };
    let handle = app.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
            settings_window_changed(&handle);
        }
    });
}

/// Relit la place de la fenêtre de réglages (cachée ou réduite : plus d'obstacle).
pub fn settings_window_changed(app: &AppHandle) {
    let Some(win) = app.get_webview_window(SETTINGS_LABEL) else { return };
    let shown = win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false);
    let rect = if shown {
        match (win.outer_position(), win.outer_size()) {
            (Ok(p), Ok(s)) => Some((p.x, p.y, s.width, s.height)),
            _ => None,
        }
    } else {
        None
    };
    set_obstacle(app, "settings", rect);
}

/// Réduire les animations (Windows) ou mode Calme : pas de ressort ni de tremblement.
fn calm(app: &AppHandle) -> bool {
    let calm = app.try_state::<crate::Shared>().is_some_and(|s| s.settings.locked().mascot.calm);
    calm || platform::winlife::reduced_motion()
}

/// Recalcule la place de l'île d'après les obstacles, et l'y emmène.
pub fn recompute(app: &AppHandle) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let gate = &shared.gate;
    let (pref, home, avoid_settings) = {
        let s = shared.settings.locked();
        let home = Placement { edge: s.island.edge.clone(), align: s.island.align.clone(), offset: s.island.offset };
        (s.general.screen.clone(), home, s.island.avoid_settings)
    };
    // Pendant un déplacement à la main : rien (la fin du déplacement décide).
    // Perchée sur une barre de titre : elle y reste (le module la fait descendre).
    if gate.drag.locked().is_some() || gate.dodge.perch().is_some() {
        return;
    }
    let Some(m) = target_monitor(app, &pref) else { return };
    let scale = m.scale_factor();
    let (mp, ms) = (*m.position(), *m.size());
    let wa = m.work_area();
    let screen = Screen {
        w: ms.width as f64 / scale,
        h: ms.height as f64 / scale,
        bottom: ((wa.position.y + wa.size.height as i32).min(mp.y + ms.height as i32) - mp.y) as f64 / scale,
    };
    // Les obstacles en px logiques depuis le coin de l'écran de l'île ; une
    // fenêtre sur un autre écran ne gêne pas.
    let to_rect = |r: &PhysRect| Rect {
        x: (r.0 - mp.x) as f64 / scale,
        y: (r.1 - mp.y) as f64 / scale,
        w: r.2 as f64 / scale,
        h: r.3 as f64 / scale,
    };
    let on_screen = |r: &Rect| r.overlaps(&Rect { x: 0.0, y: 0.0, w: screen.w, h: screen.h });
    let (hard, soft): (Vec<Rect>, Vec<Rect>) = {
        let obs = gate.dodge.obstacles.locked();
        let hard = obs.iter().filter(|(k, _)| **k == "settings" && avoid_settings).map(|(_, r)| to_rect(r)).filter(on_screen).collect();
        let soft = obs.iter().filter(|(k, _)| **k != "settings").map(|(_, r)| to_rect(r)).filter(on_screen).collect();
        (hard, soft)
    };
    let current = gate.dodge.place().unwrap_or_else(|| home.clone());
    // La taille de l'île : sa forme actuelle (couchée ou debout selon le bord), au moins la mini-île.
    let r = *gate.rect.locked();
    let (len, thick) = if current.side() { (r.h, r.w) } else { (r.w, r.h) };
    let size = Size { len: len.max(MIN_LEN), thick: thick.clamp(MIN_THICK, MAX_THICK) };
    // La fenêtre de réglages compte avec la grande marge, les autres avec la petite.
    let mut walls: Vec<Rect> = hard.iter().map(|w| w.grow(avoid::MARGIN - SOFT_MARGIN)).collect();
    walls.extend(soft);
    let mut esc = avoid::escape(&screen, size, &home, &current, &walls, SOFT_MARGIN);
    // Plus doux pour une fenêtre au premier plan ou une bulle : si elle ne
    // peut pas s'écarter, elle reste chez elle (ni coin, ni tremblement).
    let soft = hard.is_empty();
    if soft && esc.cornered {
        esc = avoid::Escape { place: home.clone(), cornered: false };
    }

    let was_cornered = std::mem::replace(&mut *gate.dodge.cornered.locked(), esc.cornered);
    let back_home = esc.place == home && !esc.cornered;
    let previous = std::mem::replace(&mut *gate.dodge.place.locked(), if back_home { None } else { Some(esc.place.clone()) });
    let moved = previous.as_ref().unwrap_or(&home) != &esc.place;
    if !moved {
        // Toujours acculée et encore poussée : elle tremble de nouveau (pas trop souvent).
        if esc.cornered {
            shake(app, &esc.place, scale);
        }
        return;
    }
    let phase = if back_home {
        "home"
    } else if esc.cornered {
        "cornered"
    } else {
        "flee"
    };
    // Rentrée chez elle : soulagée seulement si elle avait eu peur.
    let soft = if back_home { !std::mem::replace(&mut *gate.dodge.frightened.locked(), false) } else { soft };
    if !back_home && !soft {
        *gate.dodge.frightened.locked() = true;
    }
    if phase != "flee" || previous.is_none() || was_cornered != esc.cornered {
        log::info(format!("île : {phase} (bord {}, place {})", esc.place.edge, esc.place.align));
    }
    let _ = app.emit_to(WINDOW_LABEL, "island-placement", PlacementEvent { edge: esc.place.edge.clone(), align: esc.place.align.clone(), phase, soft });
    move_to(app, &esc.place);
    if esc.cornered {
        shake(app, &esc.place, scale);
    }
}

/// Emmène la fenêtre de l'île à cette place : la taille tout de suite (elle
/// dépend du bord), la position au ressort.
fn move_to(app: &AppHandle, place: &Placement) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let gate = &shared.gate;
    let Some(win) = window(app) else { return };
    let pref = shared.settings.locked().general.screen.clone();
    let Some(m) = target_monitor(app, &pref) else { return };
    let collapsed = gate.collapsed.load(Ordering::Relaxed);
    let tall = gate.tall.load(Ordering::Relaxed);
    let (pw, ph, x, y) = super::frame_for(&m, place, collapsed, tall, gate.dodge.perch());
    *gate.panel.locked() = place.window_size(false, tall);
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    gate.invalidate_frame();
    if calm(app) {
        gate.dodge.mover.locked().running = false;
        let _ = win.set_position(PhysicalPosition::new(x, y));
        return;
    }
    let start = {
        let mut mv = gate.dodge.mover.locked();
        mv.target = (x as f64, y as f64);
        mv.scale = m.scale_factor();
        if mv.running {
            false
        } else {
            let at = win.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or((x as f64, y as f64));
            mv.pos = at;
            mv.vel = (0.0, 0.0);
            mv.running = true;
            true
        }
    };
    if start {
        spawn_mover(app.clone());
    }
}

/// Acculée : un petit tremblement le long du bord (pas en mode Calme).
fn shake(app: &AppHandle, place: &Placement, scale: f64) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let gate = &shared.gate;
    if calm(app) {
        return;
    }
    {
        let mut last = gate.dodge.last_shake.locked();
        if last.is_some_and(|t| t.elapsed() < SHAKE_EVERY) {
            return;
        }
        *last = Some(Instant::now());
    }
    let start = {
        let mut mv = gate.dodge.mover.locked();
        mv.shake = Some((Instant::now(), !place.side()));
        mv.scale = scale;
        if mv.running {
            false
        } else {
            let Some(win) = window(app) else { return };
            let at = win.outer_position().map(|p| (p.x as f64, p.y as f64)).unwrap_or_default();
            mv.pos = at;
            mv.target = at;
            mv.vel = (0.0, 0.0);
            mv.running = true;
            true
        }
    };
    if start {
        spawn_mover(app.clone());
    }
}

/// Un pas du ressort (semi-implicite) ; vrai si posé.
pub fn spring_step(pos: &mut f64, vel: &mut f64, target: f64, dt: f64) -> bool {
    let damping = 2.0 * DAMPING_RATIO * STIFFNESS.sqrt();
    let acc = STIFFNESS * (target - *pos) - damping * *vel;
    *vel += acc * dt;
    *pos += *vel * dt;
    (target - *pos).abs() < 0.5 && vel.abs() < 8.0
}

/// Le décalage du tremblement à l'instant `t` (s depuis son début), en px logiques.
pub fn shake_offset(t: f64) -> f64 {
    let total = SHAKE_FOR.as_secs_f64();
    if !(0.0..total).contains(&t) {
        return 0.0;
    }
    SHAKE_PX * (1.0 - t / total) * (t * SHAKE_HZ * std::f64::consts::TAU).sin()
}

fn spawn_mover(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(shared) = app.try_state::<crate::Shared>() else { return };
        let gate = &shared.gate;
        let mut last = Instant::now();
        loop {
            std::thread::sleep(FRAME);
            let dt = last.elapsed().as_secs_f64().min(0.05);
            last = Instant::now();
            let (x, y, done) = {
                let mut mv = gate.dodge.mover.locked();
                if !mv.running {
                    return;
                }
                let (tx, ty) = mv.target;
                let (mut px, mut vx) = (mv.pos.0, mv.vel.0);
                let (mut py, mut vy) = (mv.pos.1, mv.vel.1);
                let rx = spring_step(&mut px, &mut vx, tx, dt);
                let ry = spring_step(&mut py, &mut vy, ty, dt);
                mv.pos = (px, py);
                mv.vel = (vx, vy);
                let mut off = (0.0, 0.0);
                let mut shaking = false;
                if let Some((since, along_x)) = mv.shake {
                    let t = since.elapsed().as_secs_f64();
                    if t < SHAKE_FOR.as_secs_f64() {
                        shaking = true;
                        let d = shake_offset(t) * mv.scale;
                        off = if along_x { (d, 0.0) } else { (0.0, d) };
                    } else {
                        mv.shake = None;
                    }
                }
                let done = rx && ry && !shaking;
                if done {
                    mv.running = false;
                    mv.pos = (tx, ty);
                }
                let (x, y) = if done { (tx, ty) } else { (px + off.0, py + off.1) };
                (x, y, done)
            };
            if let Some(win) = window(&app) {
                let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
            }
            gate.invalidate_frame();
            if done {
                // La forme est posée : le front renvoie son rectangle (clics traversants).
                let _ = app.emit_to(WINDOW_LABEL, "island-drag-end", ());
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{perched_frame, shake_offset, spring_step};

    #[test]
    fn perched_on_a_title_bar_but_never_off_screen() {
        let screen = (0, 0, 1920, 1080);
        let frame = (720, 320, 600, 0);
        // Pas perchée, ou pas en haut : la place calculée.
        assert_eq!(perched_frame(frame, None, "top", screen), frame);
        assert_eq!(perched_frame(frame, Some((400, 200)), "left", screen), frame);
        // Centrée sur la barre de titre, posée sur son haut.
        assert_eq!(perched_frame(frame, Some((1000, 200)), "top", screen), (720, 320, 640, 200));
        // Une fenêtre au bord de l'écran : la fenêtre de l'île reste dedans.
        assert_eq!(perched_frame(frame, Some((100, 900)), "top", screen), (720, 320, 0, 760));
    }

    #[test]
    fn spring_reaches_target_smoothly_with_a_small_bounce() {
        let (mut x, mut v) = (0.0, 0.0);
        let mut peak: f64 = 0.0;
        let mut frames = 0;
        while !spring_step(&mut x, &mut v, 300.0, 1.0 / 60.0) {
            peak = peak.max(x);
            frames += 1;
            assert!(frames < 200, "le ressort ne se pose pas");
        }
        // Un petit dépassement (rebond), pas un grand.
        assert!(peak > 300.0 && peak < 330.0, "pic {peak}");
        // En moins d'une seconde et demie.
        assert!(frames < 90, "{frames} images");
    }

    #[test]
    fn spring_keeps_its_speed_when_the_target_moves() {
        let (mut x, mut v) = (0.0, 0.0);
        for _ in 0..10 {
            spring_step(&mut x, &mut v, 300.0, 1.0 / 60.0);
        }
        let speed = v;
        // Nouvelle cible plus loin : pas d'arrêt, la vitesse continue.
        spring_step(&mut x, &mut v, 600.0, 1.0 / 60.0);
        assert!(v > speed);
    }

    #[test]
    fn shake_fades_out() {
        assert_eq!(shake_offset(-0.1), 0.0);
        assert_eq!(shake_offset(0.6), 0.0);
        let early = (0..10).map(|i| shake_offset(i as f64 * 0.005).abs()).fold(0.0, f64::max);
        let late = (0..10).map(|i| shake_offset(0.45 + i as f64 * 0.005).abs()).fold(0.0, f64::max);
        assert!(early > late && early <= 3.0);
    }
}
