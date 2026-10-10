// La fenêtre de l'île : placement sur le bon écran (DPI compris), ses deux tailles,
// les clics traversants et la lecture de la souris.
//
// Un PC n'a pas d'encoche : l'île est une forme noire dessinée au bord de
// l'écran (en haut, en bas, à gauche ou à droite, voir `Placement`), dans une fenêtre
// sans bordure, transparente, toujours au premier plan, qui ne prend pas le
// focus. La fenêtre a deux tailles :
//   - « bande » (240 × 6, ou 6 × 240 sur un côté) quand l'île est cachée : une
//     bande invisible au bord, qui réveille l'île au survol (état `peek`) ou
//     quand on y glisse un fichier ;
//   - « panneau » (720 × 320, ou 720 × 380 sur un côté) le reste du temps : assez
//     grand pour la plus grande vue. Seule la forme de l'île prend la souris, le
//     reste laisse passer les clics. Quand l'île ouverte grandit pour montrer un
//     contenu en entier (un QR code, src/island/fit.ts), le panneau passe à
//     720 × 530 le temps qu'il faut (`island_set_tall`).
//
// On déplace l'île en l'attrapant par son bord extérieur (island.ts appelle
// `drag_start`) : la fenêtre suit la souris, puis au lâcher elle s'aimante au
// bord le plus proche (haut, bas, gauche ou droite), et dans un coin ou au centre
// si on la lâche près d'eux.
//
// Clics traversants : Tauri 2 ne sait rendre transparente aux clics que la fenêtre
// ENTIÈRE (set_ignore_cursor_events). On lit donc la souris ~60 fois par seconde
// côté Rust et on bascule ce réglage quand elle entre ou sort de la forme de l'île.
// Technique reprise de Coucou (github.com/Louis-CFM/coucou, MIT).

pub mod avoid;
pub mod dodge;

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

use crate::platform;
use crate::services::log;
use crate::services::perf::{self, Loop};

pub const WINDOW_LABEL: &str = "island";

/// Taille logique (avant mise à l'échelle DPI) du panneau.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 320.0;
/// Taille logique de la bande de réveil, quand l'île est cachée.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;
/// Sur un côté de l'écran, le panneau est plus haut : l'île compacte y est une
/// pilule verticale (42 × 340).
pub const SIDE_PANEL_H: f64 = 380.0;
/// Le panneau « haut » : l'île ouverte grandit jusqu'à 480 px pour un contenu à
/// montrer en entier (FIT_MAX_H dans src/island/fit.ts), plus la place de
/// l'étirement à la souris (gestures.ts). Seulement le temps qu'il faut : tant
/// qu'un bouton est enfoncé au-dessus du panneau, tout le panneau prend la souris.
pub const TALL_PANEL_H: f64 = 530.0;

/// Près d'un coin (moins de ce nombre de px logiques), l'île s'y aimante ; près
/// du centre (moins de 6 % de la longueur du bord), au centre.
const CORNER_MAGNET: f64 = 160.0;
const CENTER_MAGNET: f64 = 0.06;

/// Où vit l'île : le bord, et sa place le long de ce bord (réglages `island.*`).
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub edge: String,
    pub align: String,
    pub offset: f64,
}

impl Placement {
    fn from_settings(app: &AppHandle) -> Placement {
        match app.try_state::<crate::Shared>() {
            Some(shared) => {
                let s = shared.settings.locked();
                Placement { edge: s.island.edge.clone(), align: s.island.align.clone(), offset: s.island.offset }
            }
            None => Placement { edge: "top".into(), align: "center".into(), offset: 0.5 },
        }
    }

    /// La place où doit être l'île maintenant : la place provisoire si elle
    /// s'écarte d'une fenêtre (dodge.rs), sinon la place réglée.
    fn current(app: &AppHandle) -> Placement {
        let provisional = app.try_state::<crate::Shared>().and_then(|s| s.gate.dodge.place());
        provisional.unwrap_or_else(|| Placement::from_settings(app))
    }

    fn side(&self) -> bool {
        self.edge == "left" || self.edge == "right"
    }

    /// Taille logique de la fenêtre (bande ou panneau) pour ce bord. `tall` :
    /// l'île ouverte a besoin de grandir (voir TALL_PANEL_H).
    fn window_size(&self, collapsed: bool, tall: bool) -> (f64, f64) {
        match (self.side(), collapsed) {
            (false, true) => (STRIP_W, STRIP_H),
            (true, true) => (STRIP_H, STRIP_W),
            (_, false) if tall => (PANEL_W, TALL_PANEL_H),
            (false, false) => (PANEL_W, PANEL_H),
            (true, false) => (PANEL_W, SIDE_PANEL_H),
        }
    }
}

/// Le choix du bord et de la place au lâcher, d'après le centre de l'île
/// (`cx`, `cy` en px logiques, depuis le coin haut gauche de l'écran `w` × `h`).
pub fn snap(cx: f64, cy: f64, w: f64, h: f64) -> Placement {
    // Le bord le plus proche : en haut, en bas, à gauche ou à droite. En bas,
    // l'île se pose au-dessus de la barre des tâches (voir `target_frame`).
    let (top, bottom, left, right) = (cy, h - cy, cx, w - cx);
    let nearest = top.min(bottom).min(left).min(right);
    let (edge, pos, len) = if top == nearest {
        ("top", cx, w)
    } else if bottom == nearest {
        ("bottom", cx, w)
    } else if left == nearest {
        ("left", cy, h)
    } else {
        ("right", cy, h)
    };
    let pos = pos.clamp(0.0, len);
    let (align, offset) = if pos < CORNER_MAGNET {
        ("start", 0.0)
    } else if pos > len - CORNER_MAGNET {
        ("end", 1.0)
    } else if (pos / len - 0.5).abs() < CENTER_MAGNET {
        ("center", 0.5)
    } else {
        ("center", pos / len)
    };
    Placement { edge: edge.into(), align: align.into(), offset }
}

/// Marge autour de l'île qui compte encore comme « sur l'île » (px logiques),
/// pour que le réglage soit déjà basculé quand la souris arrive sur un bouton.
const HIT_MARGIN: f64 = 14.0;

/// Les rythmes de lecture de la souris sont dans le tableau des modes de
/// performance (services/perf.rs) : en mode équilibré, île visible ≈ 60 Hz,
/// « au calme » ≈ 30 Hz ; île cachée 20 Hz (seulement la bande de réveil).
/// La souris n'a pas bougé depuis… : rien à envoyer, on peut ralentir.
const CALM_AFTER: Duration = Duration::from_millis(250);
/// La souris est à plus de… px logiques de l'île : son regard peut suivre plus
/// lentement, et elle mettrait plusieurs tours à atteindre l'île.
const FAR_FROM_ISLAND: f64 = 200.0;

/// Combien attendre avant le prochain tour de lecture de la souris.
///
/// Chaque tour coûte peu (position de la souris et état du bouton ; la
/// géométrie de la fenêtre est gardée en copie, voir `WinFrame`), mais 60
/// réveils par seconde, toute la journée, c'est le premier poste de travail
/// d'Ondine au repos. Quand rien ne bouge, ou que la souris est loin, on en
/// fait moins (selon le mode de performance).
/// Jamais pendant un appui (glisser de fichier, déplacement de l'île) : là,
/// 60 Hz dans tous les modes. Dès qu'un mouvement près de l'île est vu, on
/// repasse au rythme « souris qui bouge ».
pub fn poll_interval(mode: perf::Mode, active: bool, busy: bool, still_for: Duration, distance: f64) -> Duration {
    if !active {
        perf::cadence(Loop::CursorHidden, mode)
    } else if busy {
        perf::BUSY
    } else if distance > FAR_FROM_ISLAND {
        perf::cadence(Loop::CursorFar, mode)
    } else if still_for >= CALM_AFTER {
        perf::cadence(Loop::CursorStill, mode)
    } else {
        perf::cadence(Loop::CursorMoving, mode)
    }
}

/// Le point (px logiques de la fenêtre) est-il sur la forme de l'île, à
/// `margin` près ? Une forme sans taille connue ne contient rien.
pub fn on_shape(r: &IslandRect, x: f64, y: f64, margin: f64) -> bool {
    r.w > 0.0 && x >= r.x - margin && x <= r.x + r.w + margin && y >= r.y - margin && y <= r.y + r.h + margin
}

/// Distance (px logiques) entre le point et la forme de l'île ; 0 dedans. Une
/// île sans taille connue compte comme « tout près » (on ne ralentit pas).
pub fn distance_outside(r: &IslandRect, x: f64, y: f64) -> f64 {
    if r.w <= 0.0 || r.h <= 0.0 {
        return 0.0;
    }
    let dx = (r.x - x).max(0.0).max(x - (r.x + r.w));
    let dy = (r.y - y).max(0.0).max(y - (r.y + r.h));
    dx.hypot(dy)
}

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

/// Copie de la géométrie de la fenêtre de l'île : coin haut gauche et taille
/// (px physiques), échelle de l'écran. Lire ces valeurs auprès de Tauri est un
/// aller-retour vers le thread principal ; le thread de la souris les lit donc
/// ici, et ne les redemande que lorsqu'elles ont pu changer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WinFrame {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

/// Même sans événement « déplacée / redimensionnée », la copie est relue au
/// moins une fois par seconde (filet de sécurité : 3 appels par seconde au lieu
/// de 3 par tour de lecture).
const FRAME_MAX_AGE: Duration = Duration::from_secs(1);

/// La copie est-elle encore bonne ? Oui si rien ne l'a invalidée depuis
/// qu'on l'a lue (même génération) et qu'elle n'est pas trop vieille.
pub fn frame_is_fresh(stored_gen: u64, current_gen: u64, age: Duration) -> bool {
    stored_gen == current_gen && age < FRAME_MAX_AGE
}

/// État partagé entre les commandes et le thread qui lit la souris.
pub struct PollGate {
    /// Vrai quand l'île est visible (fenêtre « panneau »).
    active: AtomicBool,
    pub collapsed: AtomicBool,
    /// L'île ouverte a demandé le panneau haut (`island_set_tall`).
    pub tall: AtomicBool,
    rect: Mutex<IslandRect>,
    /// Dernier état envoyé à Windows, pour ne l'appeler que s'il change.
    ignoring: AtomicBool,
    /// Sérialise les changements de « clics traversants » : sans lui, le thread de
    /// lecture pouvait rendre la bande de réveil transparente aux clics juste après
    /// qu'on l'a réduite, et l'île ne se réveillait plus.
    flag_lock: Mutex<()>,
    /// Taille logique actuelle de la fenêtre (panneau du haut ou d'un côté).
    panel: Mutex<(f64, f64)>,
    /// Pendant un déplacement : l'écart (px physiques) entre la souris et le
    /// coin de la fenêtre au moment où on l'a attrapée.
    drag: Mutex<Option<(f64, f64)>>,
    /// Géométrie de la fenêtre en copie (voir `WinFrame`), avec la génération
    /// au moment de la lecture et l'heure de la lecture.
    frame: Mutex<Option<(u64, Instant, WinFrame)>>,
    /// Augmente à chaque fois que la fenêtre a pu bouger, changer de taille ou
    /// d'échelle : la copie lue avant n'est plus bonne.
    frame_gen: AtomicU64,
    /// Le dernier vrai clic (bouton gauche enfoncé) vu par la boucle de la
    /// souris SUR l'île visible. Les agents s'en servent pour n'accepter
    /// « Oui, autoriser » qu'après un geste réel (voir modules/agents.rs).
    last_click: Mutex<Option<Instant>>,
    /// L'île qui s'écarte des fenêtres (place provisoire, ressort).
    pub dodge: dodge::Dodge,
    /// Pendant un déplacement : les dernières positions de la souris (px
    /// physiques, instant), pour reconnaître un lancer (module Ondine et les
    /// fenêtres), et la fenêtre au premier plan quand on a attrapé l'île.
    drag_trail: Mutex<Vec<(f64, f64, Instant)>>,
    drag_fg: Mutex<Option<isize>>,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            collapsed: AtomicBool::new(true),
            tall: AtomicBool::new(false),
            rect: Mutex::new(IslandRect::default()),
            ignoring: AtomicBool::new(false),
            flag_lock: Mutex::new(()),
            panel: Mutex::new((PANEL_W, PANEL_H)),
            drag: Mutex::new(None),
            frame: Mutex::new(None),
            frame_gen: AtomicU64::new(0),
            last_click: Mutex::new(None),
            dodge: dodge::Dodge::default(),
            drag_trail: Mutex::new(Vec::new()),
            drag_fg: Mutex::new(None),
        }
    }

    /// Quand la personne a cliqué sur l'île pour la dernière fois (None : jamais).
    pub fn last_click(&self) -> Option<Instant> {
        *self.last_click.locked()
    }

    /// La fenêtre a bougé (ou va bouger) : la prochaine lecture redemande sa géométrie.
    pub fn invalidate_frame(&self) {
        self.frame_gen.fetch_add(1, Ordering::Relaxed);
    }

    /// La géométrie de la fenêtre : la copie si elle est encore bonne, sinon
    /// relue auprès de Tauri (et gardée pour les tours suivants).
    fn frame(&self, win: &WebviewWindow) -> Option<WinFrame> {
        // La génération est lue AVANT la lecture : si la fenêtre bouge pendant
        // qu'on la lit, la copie aura une génération dépassée et sera relue.
        let gen = self.frame_gen.load(Ordering::Relaxed);
        if let Some((stored, at, f)) = *self.frame.locked() {
            if frame_is_fresh(stored, gen, at.elapsed()) {
                return Some(f);
            }
        }
        let pos = win.outer_position().ok()?;
        let size = win.outer_size().ok()?;
        let scale = win.scale_factor().unwrap_or(1.0);
        let f = WinFrame { x: pos.x, y: pos.y, w: size.width, h: size.height, scale };
        *self.frame.locked() = Some((gen, Instant::now(), f));
        Some(f)
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

/// Ce point de l'écran (px physiques) est-il sur l'île ? Sur sa forme quand
/// elle est visible (avec une marge), sinon près de la bande de réveil. Sert à
/// Ondine sur le bureau : lâchée sur l'île, elle y rentre (pet.rs).
pub fn screen_point_on_island(app: &AppHandle, gate: &PollGate, px: f64, py: f64) -> bool {
    let Some(win) = window(app) else { return false };
    let Some(f) = gate.frame(&win) else { return false };
    let (x, y) = ((px - f.x as f64) / f.scale, (py - f.y as f64) / f.scale);
    if gate.collapsed.load(Ordering::Relaxed) {
        // La bande ne fait que quelques px : une large marge autour.
        let (w, h) = (f.w as f64 / f.scale, f.h as f64 / f.scale);
        return x >= -40.0 && x <= w + 40.0 && y >= -40.0 && y <= h + 40.0;
    }
    on_shape(&gate.rect.locked(), x, y, 24.0)
}

/// Le rectangle de l'île à l'écran (px physiques : gauche, haut, droite, bas),
/// la bande de réveil quand elle est cachée ; None si inconnu.
pub fn island_screen_rect(app: &AppHandle) -> Option<(f64, f64, f64, f64)> {
    let shared = app.try_state::<crate::Shared>()?;
    let gate = &shared.gate;
    let f = gate.frame(&window(app)?)?;
    let (x, y, s) = (f.x as f64, f.y as f64, f.scale);
    if gate.collapsed.load(Ordering::Relaxed) {
        return Some((x, y, x + f.w as f64, y + f.h as f64));
    }
    let r = *gate.rect.locked();
    (r.w > 0.0).then_some((x + r.x * s, y + r.y * s, x + (r.x + r.w) * s, y + (r.y + r.h) * s))
}

/// Le bord où se trouve l'île maintenant (place provisoire comprise).
pub fn current_edge(app: &AppHandle) -> String {
    Placement::current(app).edge
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

/// Où mettre la fenêtre (px physiques) : sa taille et son coin haut gauche.
fn target_frame(m: &Monitor, place: &Placement, collapsed: bool, tall: bool) -> (u32, u32, i32, i32) {
    let wa = m.work_area();
    let screen = Area {
        x: m.position().x,
        y: m.position().y,
        w: m.size().width,
        h: m.size().height,
        work_bottom: wa.position.y + wa.size.height as i32,
    };
    frame_in(&screen, m.scale_factor(), place, collapsed, tall)
}

/// Un écran pour le calcul du placement (px physiques) : sa position, sa
/// taille, et le bas de sa zone de travail (au-dessus de la barre des tâches).
#[derive(Clone, Copy, Debug)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub work_bottom: i32,
}

/// Le calcul de `target_frame`, sans Tauri (testé) : taille et coin haut gauche
/// de la fenêtre (px physiques) pour ce placement sur cet écran.
pub fn frame_in(a: &Area, scale: f64, place: &Placement, collapsed: bool, tall: bool) -> (u32, u32, i32, i32) {
    let mp = PhysicalPosition::new(a.x, a.y);
    let ms = PhysicalSize::new(a.w, a.h);
    let (lw, lh) = place.window_size(collapsed, tall);
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;

    // Le long du bord : collée au début, collée à la fin, ou centrée sur `offset`
    // (sans jamais dépasser de l'écran).
    let along = |start: i32, len: u32, size: u32| -> i32 {
        let free = (len as i32 - size as i32).max(0);
        match place.align.as_str() {
            "start" => start,
            "end" => start + free,
            _ => start + ((place.offset * len as f64) as i32 - size as i32 / 2).clamp(0, free),
        }
    };
    let (x, y) = match place.edge.as_str() {
        "left" => (mp.x, along(mp.y, ms.height, ph)),
        "right" => (mp.x + ms.width as i32 - pw as i32, along(mp.y, ms.height, ph)),
        // En bas : posée sur la barre des tâches (le bas de la zone de travail),
        // pour ne pas la recouvrir. Sans barre en bas, c'est le bas de l'écran.
        "bottom" => (along(mp.x, ms.width, pw), a.work_bottom.min(mp.y + ms.height as i32) - ph as i32),
        _ => (along(mp.x, ms.width, pw), mp.y),
    };
    (pw, ph, x, y)
}

/// `target_frame`, perchée sur une barre de titre si besoin (dodge.rs).
fn frame_for(m: &Monitor, place: &Placement, collapsed: bool, tall: bool, perch: Option<(i32, i32)>) -> (u32, u32, i32, i32) {
    let screen = (m.position().x, m.position().y, m.size().width, m.size().height);
    dodge::perched_frame(target_frame(m, place, collapsed, tall), perch, &place.edge, screen)
}

/// Place et dimensionne la fenêtre, en pixels physiques : taille logique × échelle
/// de l'écran (125 %, 150 %…), au bord et à la place choisis (`Placement`).
pub fn apply_geometry(app: &AppHandle, pref: &str, collapsed: bool) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app, pref) else { return };
    let place = Placement::current(app);
    let tall = app.try_state::<crate::Shared>().is_some_and(|s| s.gate.tall.load(Ordering::Relaxed));
    if let Some(shared) = app.try_state::<crate::Shared>() {
        *shared.gate.panel.locked() = place.window_size(false, tall);
    }
    let perch = app.try_state::<crate::Shared>().and_then(|s| s.gate.dodge.perch());
    let (pw, ph, x, y) = frame_for(&m, &place, collapsed, tall, perch);

    // L'île est en train de s'écarter d'une fenêtre (ressort de dodge.rs) : la
    // taille tout de suite, la position reste au ressort (nouvelle cible).
    if let Some(shared) = app.try_state::<crate::Shared>() {
        if shared.gate.dodge.moving() {
            let _ = win.set_size(PhysicalSize::new(pw, ph));
            shared.gate.dodge.retarget(x, y);
            shared.gate.invalidate_frame();
            return;
        }
    }
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Passer d'un écran à l'autre peut changer l'échelle : on réimpose la taille.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
    if let Some(shared) = app.try_state::<crate::Shared>() {
        shared.gate.invalidate_frame();
    }
}

/// On vient d'attraper l'île par son bord : la fenêtre va suivre la souris
/// (voir `spawn_cursor_poll`) jusqu'à ce qu'on relâche le bouton.
pub fn drag_start(app: &AppHandle, gate: &PollGate) {
    let Some(win) = window(app) else { return };
    let (Ok(origin), Some((cx, cy))) = (win.outer_position(), platform::cursor_physical()) else { return };
    // Elle s'écartait d'une fenêtre : la main reprend la main (le ressort s'arrête).
    gate.dodge.forget();
    gate.drag_trail.locked().clear();
    // L'île ne prend pas le focus : la fenêtre au premier plan est celle de la personne.
    *gate.drag_fg.locked() = platform::winlife::foreground().filter(|w| !w.own).map(|w| w.hwnd);
    *gate.drag.locked() = Some((cx - origin.x as f64, cy - origin.y as f64));
}

/// Le bouton est relâché : on choisit le bord et la place (aimant), on
/// l'enregistre, et la fenêtre glisse jusqu'à sa nouvelle place.
fn drag_end(app: &AppHandle, gate: &PollGate) {
    let Some(win) = window(app) else { return };
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let pref = shared.settings.locked().general.screen.clone();
    let Some(m) = target_monitor(app, &pref) else { return };
    let Ok(origin) = win.outer_position() else { return };

    // Le centre de l'île, en px logiques depuis le coin de l'écran.
    let scale = m.scale_factor();
    let r = *gate.rect.locked();
    let mp = *m.position();
    let ms = *m.size();
    let cx = ((origin.x - mp.x) as f64 + (r.x + r.w / 2.0) * scale) / scale;
    let cy = ((origin.y - mp.y) as f64 + (r.y + r.h / 2.0) * scale) / scale;

    // Lancée d'un geste vif vers un bord (module Ondine et les fenêtres) : c'est
    // la fenêtre au premier plan qui va se coller à ce bord ; l'île, elle,
    // revient à sa place.
    let trail: Vec<(f64, f64, Instant)> = std::mem::take(&mut *gate.drag_trail.locked());
    let fg = gate.drag_fg.locked().take();
    let thrown = fg.and_then(|hwnd| crate::modules::windowlife::throw_window(app, hwnd, &trail, scale));
    let place = if thrown.is_some() {
        Placement::current(app)
    } else {
        let place = snap(cx, cy, ms.width as f64 / scale, ms.height as f64 / scale);
        log::info(format!("île déplacée : bord {}, place {}", place.edge, place.align));

        // Enregistrer, et prévenir les fenêtres (l'île change de forme selon le bord).
        // Enregistré sous le verrou des réglages, comme apply_settings (lib.rs) :
        // une sauvegarde venue de la page ne peut pas se glisser entre les deux.
        let new = {
            let mut s = shared.settings.locked();
            s.island.edge = place.edge.clone();
            s.island.align = place.align.clone();
            s.island.offset = place.offset;
            if let Err(e) = crate::services::settings::save(&s) {
                log::warn(format!("réglages non enregistrés : {e}"));
            }
            s.clone()
        };
        let _ = app.emit("settings-changed", new);
        place
    };

    // La fenêtre glisse jusqu'à sa place (quelques images, en ralentissant),
    // puis prend la taille du panneau de ce bord.
    let collapsed = gate.collapsed.load(Ordering::Relaxed);
    let tall = gate.tall.load(Ordering::Relaxed);
    let (pw, ph, x, y) = target_frame(&m, &place, collapsed, tall);
    *gate.panel.locked() = place.window_size(false, tall);
    let (x0, y0) = (origin.x as f64, origin.y as f64);
    const STEPS: u32 = 10;
    for i in 1..=STEPS {
        let t = i as f64 / STEPS as f64;
        let k = 1.0 - (1.0 - t).powi(3); // ralentit à l'arrivée
        let nx = x0 + (x as f64 - x0) * k;
        let ny = y0 + (y as f64 - y0) * k;
        let _ = win.set_position(PhysicalPosition::new(nx.round() as i32, ny.round() as i32));
        std::thread::sleep(Duration::from_millis(14));
    }
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    gate.invalidate_frame();
    let _ = app.emit_to(WINDOW_LABEL, "island-drag-end", ());
    // Posée là où une fenêtre (les réglages…) gêne : elle s'en écarte.
    dodge::recompute(app);
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
///     pour le survol et le regard de la mascotte. Au calme (souris immobile
///     depuis 250 ms, ou à plus de 200 px de l'île), on ralentit : voir
///     `poll_interval` et le mode de performance (services/perf.rs) ;
///   - dans les deux cas, surveille les écrans (2 fois par seconde, 1 en éco).
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    // La fenêtre bouge, change de taille ou d'écran (DPI) : la copie de sa
    // géométrie gardée par `PollGate` est à relire.
    if let Some(win) = window(&app) {
        let g = gate.clone();
        win.on_window_event(move |event| {
            if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                g.invalidate_frame();
            }
        });
    }
    std::thread::spawn(move || {
        let mut was_down = false;
        let mut last_screen = None;
        let mut last = (f64::MIN, f64::MIN);
        let mut in_wake_zone = false;
        let mut last_screen_check = Instant::now();
        // Quand la souris a bougé pour la dernière fois, et à quelle distance de
        // l'île elle était : de quoi choisir le rythme du prochain tour.
        let mut last_move = Instant::now();
        let mut distance = 0.0;
        loop {
            let active = gate.is_active();
            let busy = was_down || gate.drag.locked().is_some();
            std::thread::sleep(poll_interval(perf::mode(), active, busy, last_move.elapsed(), distance));

            if last_screen_check.elapsed() >= perf::every(Loop::ScreenCheck) {
                last_screen_check = Instant::now();
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
            let Some((cx, cy)) = platform::cursor_physical() else { continue };

            // Un bouton enfoncé peut être le début d'un glisser de fichier : on
            // s'assure que l'île est bien une cible de dépôt avant qu'il n'arrive.
            let (down, pressed_since) = platform::left_button_state();
            // Un appui vu à ce tour : bouton qui vient de s'enfoncer, ou clic
            // bref tombé entre deux tours.
            let clicked = (down && !was_down) || pressed_since;
            if down && !was_down {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || platform::unblock_webview_drops(&handle));
            }
            was_down = down;

            // ── Déplacement en cours (île visible) : la fenêtre suit la souris ──
            // Placé avant la lecture de la géométrie : la fenêtre bouge à chaque
            // tour, sa copie ne servirait à rien.
            let grab = if active { *gate.drag.locked() } else { None };
            if let Some((gx, gy)) = grab {
                if down {
                    let _ = win.set_position(PhysicalPosition::new((cx - gx).round() as i32, (cy - gy).round() as i32));
                    // Les dernières positions : la vitesse au lâcher dira si c'est un lancer.
                    let mut trail = gate.drag_trail.locked();
                    trail.push((cx, cy, Instant::now()));
                    if trail.len() > 8 {
                        trail.remove(0);
                    }
                    continue;
                }
                *gate.drag.locked() = None;
                drag_end(&app, &gate);
                last = (f64::MIN, f64::MIN);
                continue;
            }

            // Position, taille et échelle de la fenêtre : la copie gardée par
            // `PollGate`, relue seulement quand la fenêtre a pu changer.
            let Some(frame) = gate.frame(&win) else { continue };
            let origin = PhysicalPosition::new(frame.x, frame.y);

            if !active {
                // ── Île cachée : la bande de réveil ──
                last = (f64::MIN, f64::MIN);
                // Au moins 2 px de haut, et le bord tout en haut compte toujours.
                let inside = cx >= origin.x as f64
                    && cx < (origin.x + frame.w as i32) as f64
                    && cy < (origin.y + (frame.h as i32).max(2)) as f64
                    && cy >= (origin.y - 1) as f64;
                if inside != in_wake_zone {
                    in_wake_zone = inside;
                    let event = if inside { "wake-enter" } else { "wake-leave" };
                    let _ = app.emit_to(WINDOW_LABEL, event, ());
                }
                continue;
            }
            in_wake_zone = false;

            // ── Glisser de fichiers vers l'extérieur (Étagère) ──
            // La souris passe au travers partout sauf sur l'île (pour lâcher sur
            // le Bureau derrière le panneau), et on n'envoie plus sa position :
            // l'île ne se replie pas pendant le glisser. Ensuite, tout reprend.
            if platform::drag_out::active() {
                let r = *gate.rect.locked();
                let scale = frame.scale;
                let (x, y) = ((cx - origin.x as f64) / scale, (cy - origin.y as f64) / scale);
                let on_island = r.w > 0.0 && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
                let _guard = gate.flag_lock.locked();
                if !gate.collapsed.load(Ordering::Relaxed) && gate.ignoring.load(Ordering::Relaxed) == on_island {
                    gate.ignoring.store(!on_island, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(!on_island);
                }
                last = (f64::MIN, f64::MIN);
                continue;
            }

            // ── Île visible ──
            let scale = frame.scale;
            let x = (cx - origin.x as f64) / scale;
            let y = (cy - origin.y as f64) / scale;
            // Un vrai clic sur l'île : noté pour les confirmations (agents).
            if clicked && on_shape(&gate.rect.locked(), x, y, 0.0) {
                *gate.last_click.locked() = Some(Instant::now());
            }
            if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                continue;
            }
            last = (x, y);
            last_move = Instant::now();

            let r = *gate.rect.locked();
            distance = distance_outside(&r, x, y);
            let on_island = on_shape(&r, x, y, HIT_MARGIN);

            // Glisser un fichier : une fenêtre « transparente aux clics » est
            // invisible pour le glisser-déposer de Windows. Donc tant qu'un bouton
            // est enfoncé au-dessus du panneau, tout le panneau prend la souris.
            let (panel_w, panel_h) = *gate.panel.locked();
            let over_panel = x >= 0.0 && x <= panel_w && y >= 0.0 && y <= panel_h;
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

// ── Raccourci clavier global : ouvrir / fermer l'île ─────────────────────────

/** Les raccourcis proposés dans les réglages (les autres sont refusés). */
pub const HOTKEYS: &[&str] = &["Ctrl+Alt+O", "Ctrl+Shift+O", "Alt+Shift+O", "Ctrl+Alt+I"];

/// Le raccourci actuellement enregistré auprès de Windows ("" = aucun).
static HOTKEY: Mutex<String> = Mutex::new(String::new());

/// Enregistre le raccourci de l'île (ou le retire si `wanted` est vide ou
/// inconnu). Un appui envoie "hotkey" à l'île, qui s'ouvre ou se referme.
pub fn apply_hotkey(app: &AppHandle, wanted: &str) {
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
        // Au relâchement : pas de répétition si on garde les touches enfoncées.
        if event.state == ShortcutState::Released {
            let _ = app.emit_to(WINDOW_LABEL, "hotkey", ());
        }
    });
    if let Err(e) = result {
        let text = e.to_string();
        let msg = if text.contains("already registered") {
            format!("{wanted} est déjà pris par un autre logiciel : choisissez un autre raccourci dans Réglages > Général")
        } else {
            format!("le raccourci {wanted} est refusé : {text}")
        };
        log::warn(format!("île : {msg}"));
        let _ = app.emit_to(WINDOW_LABEL, "hotkey-error", msg);
    }
}

#[cfg(test)]
mod tests {
    use super::{frame_in, snap, Area, Placement, PANEL_H, PANEL_W, SIDE_PANEL_H, STRIP_H, STRIP_W, TALL_PANEL_H};
    use super::{distance_outside, frame_is_fresh, on_shape, poll_interval, IslandRect};
    use crate::services::perf::Mode;
    use std::time::Duration;

    #[test]
    fn cursor_poll_slows_down_only_when_calm() {
        let ms = Duration::from_millis;
        let b = Mode::Balanced;
        // Île cachée : toujours le rythme lent de la bande de réveil (20 Hz).
        assert_eq!(poll_interval(b, false, false, ms(0), 0.0), ms(50));
        // La souris bouge près de l'île : plein rythme.
        assert_eq!(poll_interval(b, true, false, ms(10), 50.0), ms(16));
        // Immobile, ou loin : au calme.
        assert_eq!(poll_interval(b, true, false, ms(400), 0.0), ms(33));
        assert_eq!(poll_interval(b, true, false, ms(10), 500.0), ms(33));
        // Un bouton enfoncé (glisser, déplacement) : jamais ralenti, dans aucun mode.
        for m in [Mode::High, Mode::Balanced, Mode::Eco] {
            assert_eq!(poll_interval(m, true, true, ms(5000), 900.0), ms(16));
        }
    }

    #[test]
    fn cursor_poll_follows_the_perf_mode() {
        let ms = Duration::from_millis;
        // Haute : toujours 60 Hz, île visible.
        assert_eq!(poll_interval(Mode::High, true, false, ms(400), 900.0), ms(16));
        // Éco : 30 Hz au repos, 15 Hz loin de l'île, 10 Hz île cachée.
        assert_eq!(poll_interval(Mode::Eco, true, false, ms(400), 0.0), ms(33));
        assert_eq!(poll_interval(Mode::Eco, true, false, ms(10), 500.0), ms(66));
        assert_eq!(poll_interval(Mode::Eco, false, false, ms(0), 0.0), ms(100));
    }

    #[test]
    fn window_frame_copy_is_reread_when_stale() {
        let ms = Duration::from_millis;
        // Rien n'a bougé, copie récente : on la garde.
        assert!(frame_is_fresh(3, 3, ms(10)));
        // La fenêtre a bougé depuis la lecture (événement, ou bougée pendant la lecture).
        assert!(!frame_is_fresh(3, 4, ms(10)));
        // Filet de sécurité : relue au moins une fois par seconde.
        assert!(!frame_is_fresh(3, 3, ms(1000)));
        assert!(frame_is_fresh(3, 3, ms(999)));
    }

    #[test]
    fn distance_to_island() {
        let r = IslandRect { x: 100.0, y: 0.0, w: 200.0, h: 40.0 };
        assert_eq!(distance_outside(&r, 150.0, 20.0), 0.0);
        assert_eq!(distance_outside(&r, 50.0, 20.0), 50.0);
        assert_eq!(distance_outside(&r, 300.0, 70.0), 30.0);
        assert!((distance_outside(&r, 330.0, 80.0) - 50.0).abs() < 1e-9);
        // Forme inconnue : « tout près ».
        assert_eq!(distance_outside(&IslandRect::default(), 999.0, 999.0), 0.0);
        // Sur la forme, avec ou sans marge.
        assert!(on_shape(&r, 150.0, 20.0, 0.0));
        assert!(!on_shape(&r, 90.0, 20.0, 0.0));
        assert!(on_shape(&r, 90.0, 20.0, 14.0));
        assert!(!on_shape(&IslandRect::default(), 0.0, 0.0, 14.0));
    }

    #[test]
    fn island_hotkeys_parse() {
        use tauri_plugin_global_shortcut::Shortcut;
        for k in super::HOTKEYS {
            assert!(k.parse::<Shortcut>().is_ok(), "{k}");
        }
    }

    #[test]
    fn snaps_to_nearest_edge_and_magnets() {
        // Écran 1920 × 1080.
        let p = snap(960.0, 30.0, 1920.0, 1080.0);
        assert_eq!((p.edge.as_str(), p.align.as_str(), p.offset), ("top", "center", 0.5));
        let p = snap(40.0, 30.0, 1920.0, 1080.0);
        assert_eq!((p.edge.as_str(), p.align.as_str()), ("top", "start"));
        let p = snap(30.0, 500.0, 1920.0, 1080.0);
        assert_eq!((p.edge.as_str(), p.align.as_str()), ("left", "center"));
        let p = snap(1900.0, 1000.0, 1920.0, 1080.0);
        assert_eq!((p.edge.as_str(), p.align.as_str()), ("right", "end"));
        // Le bas : au centre, dans un coin, ou ailleurs le long du bord.
        let p = snap(970.0, 1060.0, 1920.0, 1080.0);
        assert_eq!((p.edge.as_str(), p.align.as_str(), p.offset), ("bottom", "center", 0.5));
        let p = snap(1850.0, 1075.0, 1920.0, 1080.0);
        assert_eq!((p.edge.as_str(), p.align.as_str()), ("bottom", "end"));
        let p = snap(500.0, 1050.0, 1920.0, 1080.0);
        assert_eq!(p.edge, "bottom");
        assert!((p.offset - 500.0 / 1920.0).abs() < 1e-9);
        // Plus près du côté que du bas : le côté.
        assert_eq!(snap(20.0, 1000.0, 1920.0, 1080.0).edge, "left");
        // Ni coin ni centre : la place exacte est gardée.
        let p = snap(1400.0, 10.0, 1920.0, 1080.0);
        assert_eq!(p.align, "center");
        assert!((p.offset - 1400.0 / 1920.0).abs() < 1e-9);
    }

    #[test]
    fn bottom_edge_sits_on_the_taskbar() {
        // 1920 × 1080 à 100 %, barre des tâches de 48 px en bas.
        let a = Area { x: 0, y: 0, w: 1920, h: 1080, work_bottom: 1032 };
        let bottom = Placement { edge: "bottom".into(), align: "center".into(), offset: 0.5 };
        // Panneau : 720 × 320, centré, posé sur la barre.
        assert_eq!(frame_in(&a, 1.0, &bottom, false, false), (720, 320, 600, 1032 - 320));
        // Bande de réveil : 240 × 6 juste au-dessus de la barre.
        assert_eq!(frame_in(&a, 1.0, &bottom, true, false), (240, 6, 840, 1026));
        // Coin bas droit, à 150 %, sur un deuxième écran à droite, sans barre en bas.
        let b = Area { x: 1920, y: 0, w: 2880, h: 1620, work_bottom: 1620 };
        let end = Placement { edge: "bottom".into(), align: "end".into(), offset: 1.0 };
        assert_eq!(frame_in(&b, 1.5, &end, false, false), (1080, 480, 1920 + 2880 - 1080, 1620 - 480));
        // Le haut, lui, reste collé en haut de l'écran.
        let top = Placement { edge: "top".into(), align: "start".into(), offset: 0.0 };
        assert_eq!(frame_in(&a, 1.0, &top, false, false), (720, 320, 0, 0));
        // Le bas n'est pas un côté : même panneau qu'en haut.
        assert_eq!(bottom.window_size(false, false), (PANEL_W, PANEL_H));
    }

    #[test]
    fn tall_panel_only_when_open() {
        let top = Placement { edge: "top".into(), align: "center".into(), offset: 0.5 };
        let side = Placement { edge: "left".into(), align: "center".into(), offset: 0.5 };
        assert_eq!(top.window_size(false, false), (PANEL_W, PANEL_H));
        assert_eq!(side.window_size(false, false), (PANEL_W, SIDE_PANEL_H));
        assert_eq!(top.window_size(false, true), (PANEL_W, TALL_PANEL_H));
        assert_eq!(side.window_size(false, true), (PANEL_W, TALL_PANEL_H));
        // Île cachée : la bande de réveil, haute ou pas.
        assert_eq!(top.window_size(true, true), (STRIP_W, STRIP_H));
        assert_eq!(side.window_size(true, true), (STRIP_H, STRIP_W));
    }
}
