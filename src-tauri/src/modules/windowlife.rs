// Module « Ondine et les fenêtres » : Ondine vit avec les autres fenêtres.
//
// Un thread regarde Windows (4 fois par seconde, 2 en économie d'énergie ;
// plus vite seulement quand la souris est tout près de l'île) :
//   - la fenêtre au premier plan : l'île s'en écarte (plus doucement que pour
//     les réglages, island/dodge.rs), ou se perche sur sa barre de titre et la
//     suit ; Ondine sursaute quand elle passe en plein écran ; elle s'assoit
//     quand le bord d'une fenêtre arrive tout près de l'île ; la nuit, une
//     fenêtre très claire lui fait mettre ses lunettes de soleil ;
//   - la souris secouée près de l'île : elle rit, ou se cache ;
//   - les bulles de notification de Windows dans le coin : l'île leur laisse la
//     place, puis revient ;
//   - la session verrouillée puis déverrouillée : au revoir, puis étirement ;
//   - une fenêtre oubliée (pas utilisée depuis longtemps) : le front propose
//     de la réduire (jamais sans accord, jamais fermée).
// Et island/mod.rs demande `throw_window` à la fin d'un déplacement de l'île :
// lancée vers un bord, l'île y colle la fenêtre au premier plan (comme
// Windows + flèche).
// Le « trou noir » (réglage `swallow`, coupé par défaut) : une fenêtre lâchée
// sur l'île est avalée (cachée), puis recrachée d'un clic. Le tri, la liste et
// le filet de sécurité sont dans windowlife_hole.rs ; ici, seulement le suivi
// du déplacement (plus rapide pendant qu'une fenêtre est déplacée).
//
// Rien ne sort du PC ; rien n'est lu dans les fenêtres à part leur place, leur
// titre (pour la proposition « ranger ») et quelques pixels (lunettes de
// soleil, la nuit, à chaque changement de fenêtre).

use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::windowlife_hole::{self as hole, DragTrack};
use super::{ModuleContext, RustModule};
use crate::island::dodge;
use crate::platform::{self, winlife};
use crate::services::bus;
use crate::services::perf::{self, Mode};

const ID: &str = "windowlife";

/// Les rythmes du thread : normal, économie, souris tout près de l'île.
const TICK: Duration = Duration::from_millis(250);
const TICK_ECO: Duration = Duration::from_millis(500);
const TICK_NEAR: Duration = Duration::from_millis(33);
/// La souris est « près de l'île » à moins de… px physiques.
const NEAR_PX: f64 = 160.0;
/// Lancer : au moins cette vitesse (px logiques par seconde) au lâcher.
const THROW_SPEED: f64 = 1800.0;
/// Lunettes de soleil : une fenêtre plus claire que ça (0 à 1), au plus une fois par…
const BRIGHT: f64 = 0.82;
const SUNGLASSES_EVERY: Duration = Duration::from_secs(15 * 60);
/// Fenêtres oubliées : regardées toutes les minutes, une proposition au plus toutes les 10 min.
const FORGOTTEN_CHECK: Duration = Duration::from_secs(60);
const FORGOTTEN_EVERY: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct WindowLife;

impl RustModule for WindowLife {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/windowlife/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        // Avant tout, même module coupé : les fenêtres qu'une session
        // précédente (plantée) a laissées dans le trou noir réapparaissent.
        hole::recover_at_start();
        let app = app.clone();
        std::thread::spawn(move || run(app));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // « Ranger » une fenêtre oubliée : seulement la réduire, après un clic.
            "minimize" => {
                let hwnd = args.get("hwnd").and_then(Value::as_i64).ok_or("fenêtre manquante")? as isize;
                winlife::minimize(hwnd)?;
                Ok(Value::Null)
            }
            // Le trou noir : la liste (titre, icône), recracher une fenêtre, tout recracher.
            "hole_list" => Ok(hole::list_json()),
            "spit" => {
                let hwnd = args.get("hwnd").and_then(Value::as_i64).ok_or("fenêtre manquante")?;
                let done = hole::spit(hwnd);
                // Ondine la repousse (le front, qui respecte le mode Calme).
                if done.is_ok() {
                    bus::emit(ctx.app, ID, "windowlife.spat", json!({ "count": 1 }));
                }
                hole_changed(ctx.app);
                done.map(|_| Value::Null)
            }
            "spit_all" => {
                let n = hole::release_all("« Tout recracher »");
                if n > 0 {
                    bus::emit(ctx.app, ID, "windowlife.spat", json!({ "count": n }));
                }
                hole_changed(ctx.app);
                Ok(json!({ "count": n }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Réglages ─────────────────────────────────────────────────────────────────

/// Les réglages du module, avec leurs valeurs par défaut (celles du manifeste).
#[derive(Clone, Debug, PartialEq)]
pub struct Prefs {
    pub avoid_foreground: bool,
    pub perch_title: bool,
    pub fullscreen_hop: bool,
    pub throw_snap: bool,
    pub sit_edge: bool,
    pub mouse_shake: bool,
    pub toast_room: bool,
    pub night_sunglasses: bool,
    pub tidy_forgotten: bool,
    pub forgotten_mins: f64,
    pub lock_goodbye: bool,
    pub swallow: bool,
}

impl Prefs {
    pub fn from(s: &Map<String, Value>) -> Prefs {
        let flag = |k: &str, d: bool| s.get(k).and_then(Value::as_bool).unwrap_or(d);
        Prefs {
            avoid_foreground: flag("avoidForeground", false),
            perch_title: flag("perchTitle", false),
            fullscreen_hop: flag("fullscreenHop", true),
            throw_snap: flag("throwSnap", false),
            sit_edge: flag("sitEdge", true),
            mouse_shake: flag("mouseShake", true),
            toast_room: flag("toastRoom", true),
            night_sunglasses: flag("nightSunglasses", true),
            tidy_forgotten: flag("tidyForgotten", false),
            forgotten_mins: s.get("forgottenMins").and_then(Value::as_f64).unwrap_or(60.0).clamp(10.0, 600.0),
            lock_goodbye: flag("lockGoodbye", true),
            swallow: flag("swallow", false),
        }
    }
}

fn prefs(app: &AppHandle) -> Option<Prefs> {
    super::with_context(app, ID, |ctx| Prefs::from(&ctx.settings()))
}

fn emit(app: &AppHandle, topic: &str, payload: Value) {
    let _ = super::with_context(app, ID, |ctx| ctx.emit(topic, payload));
}

// ── Les calculs (testés) ─────────────────────────────────────────────────────

type R = (i32, i32, i32, i32);

/// La fenêtre couvre tout son écran (plein écran : vidéo, jeu, diaporama).
pub fn is_fullscreen(r: R, monitor: R) -> bool {
    r.0 <= monitor.0 + 1 && r.1 <= monitor.1 + 1 && r.2 >= monitor.2 - 1 && r.3 >= monitor.3 - 1
}

/// Une fenêtre « ordinaire » qu'on peut éviter ou rejoindre : pas réduite,
/// pas agrandie, pas en plein écran, pas à Ondine.
pub fn ordinary(w: &winlife::Win) -> bool {
    !w.own && !w.minimized && !w.maximized && !is_fullscreen(w.rect, w.monitor) && w.rect.2 > w.rect.0 && w.rect.3 > w.rect.1
}

/// La direction d'un lancer d'après les dernières positions de la souris
/// (px physiques, secondes avant le lâcher, la plus récente en dernier), ou
/// None si le geste est trop lent. `scale` : l'échelle de l'écran.
pub fn throw_direction(trail: &[(f64, f64, f64)], scale: f64) -> Option<&'static str> {
    // Les 120 dernières millisecondes seulement : la fin du geste.
    let recent: Vec<&(f64, f64, f64)> = trail.iter().filter(|p| p.2 <= 0.12).collect();
    let (first, last) = (recent.first()?, recent.last()?);
    let dt = first.2 - last.2;
    if dt < 0.02 {
        return None;
    }
    let vx = (last.0 - first.0) / dt / scale;
    let vy = (last.1 - first.1) / dt / scale;
    if vx.hypot(vy) < THROW_SPEED {
        return None;
    }
    Some(if vx.abs() >= vy.abs() {
        if vx > 0.0 {
            "right"
        } else {
            "left"
        }
    } else if vy > 0.0 {
        "bottom"
    } else {
        "top"
    })
}

/// La moitié de la zone de travail où coller une fenêtre lancée à gauche ou à
/// droite ; None pour le haut (agrandir) et le bas (restaurer).
pub fn half(dir: &str, work: R) -> Option<R> {
    let mid = (work.0 + work.2) / 2;
    match dir {
        "left" => Some((work.0, work.1, mid, work.3)),
        "right" => Some((mid, work.1, work.2, work.3)),
        _ => None,
    }
}

/// Le bord d'une fenêtre arrive tout près du bord intérieur de l'île (elle
/// peut s'y asseoir) : sans la recouvrir, et en face d'elle sur au moins 40 px.
pub fn sits_on(island: (f64, f64, f64, f64), w: R, edge: &str) -> bool {
    let (l, t, r, b) = island;
    let (wl, wt, wr, wb) = (w.0 as f64, w.1 as f64, w.2 as f64, w.3 as f64);
    let facing_x = wr.min(r) - wl.max(l) >= 40.0;
    let facing_y = wb.min(b) - wt.max(t) >= 40.0;
    match edge {
        "top" => facing_x && wt >= b - 6.0 && wt <= b + 28.0,
        "bottom" => facing_x && wb <= t + 6.0 && wb >= t - 28.0,
        "left" => facing_y && wl >= r - 6.0 && wl <= r + 28.0,
        "right" => facing_y && wr <= l + 6.0 && wr >= l - 28.0,
        _ => false,
    }
}

/// La nuit (lunettes de soleil) : de 21 h à 6 h.
pub fn is_night(hour: u32) -> bool {
    !(6..21).contains(&hour)
}

/// Reconnaît une souris secouée : des allers-retours rapides (au moins
/// `TURNS` demi-tours de plus de `MIN_PX` en moins de `WINDOW_S` secondes).
#[derive(Default)]
pub struct MouseShake {
    extreme: f64,
    dir: f64,
    turns: Vec<f64>,
}

impl MouseShake {
    const TURNS: usize = 5;
    const MIN_PX: f64 = 40.0;
    const WINDOW_S: f64 = 0.9;

    /// Une position (px, sur l'axe horizontal) à l'instant `t` (s) ; vrai : secousse.
    pub fn feed(&mut self, x: f64, t: f64) -> bool {
        let d = x - self.extreme;
        if self.dir == 0.0 {
            if d.abs() >= Self::MIN_PX {
                self.dir = d.signum();
                self.extreme = x;
            } else if self.turns.is_empty() && d.abs() > 400.0 {
                self.extreme = x;
            }
            return false;
        }
        if d.signum() == self.dir || d == 0.0 {
            self.extreme = x;
            return false;
        }
        if d.abs() < Self::MIN_PX {
            return false;
        }
        self.dir = -self.dir;
        self.extreme = x;
        self.turns.retain(|&at| t - at <= Self::WINDOW_S);
        self.turns.push(t);
        if self.turns.len() >= Self::TURNS {
            self.turns.clear();
            return true;
        }
        false
    }

    pub fn reset(&mut self, x: f64) {
        self.extreme = x;
        self.dir = 0.0;
        self.turns.clear();
    }
}

/// La fenêtre oubliée à proposer : visible, pas réduite, pas à Ondine, pas
/// utilisée depuis `mins` minutes, et pas déjà proposée.
pub fn pick_forgotten(windows: &[winlife::Win], idle_secs: &HashMap<isize, f64>, mins: f64, proposed: &HashSet<isize>) -> Option<(isize, String)> {
    windows
        .iter()
        .filter(|w| !w.own && !w.minimized && !proposed.contains(&w.hwnd))
        .filter(|w| idle_secs.get(&w.hwnd).is_some_and(|s| *s >= mins * 60.0))
        .max_by(|a, b| idle_secs[&a.hwnd].total_cmp(&idle_secs[&b.hwnd]))
        .map(|w| (w.hwnd, w.title.clone()))
}

// ── Le lancer (appelé par island/mod.rs) ─────────────────────────────────────

/// Fin d'un déplacement de l'île : si c'était un lancer vif et que le réglage
/// « Ranger les fenêtres » est activé, colle la fenêtre `hwnd` au bord visé
/// (gauche / droite : la moitié de l'écran ; haut : agrandie ; bas :
/// restaurée) et renvoie ce bord. Ondine la pousse des deux mains.
pub fn throw_window(app: &AppHandle, hwnd: isize, trail: &[(f64, f64, Instant)], scale: f64) -> Option<&'static str> {
    let p = prefs(app)?;
    if !p.throw_snap {
        return None;
    }
    let end = trail.last()?.2;
    let ago: Vec<(f64, f64, f64)> = trail.iter().map(|(x, y, at)| (*x, *y, end.duration_since(*at).as_secs_f64())).collect();
    let dir = throw_direction(&ago, scale)?;
    let w = winlife::foreground().filter(|w| w.hwnd == hwnd && !w.own)?;
    let done = match half(dir, w.work) {
        Some(target) => winlife::place(hwnd, target),
        None if dir == "top" => winlife::maximize(hwnd),
        None => winlife::restore(hwnd),
    };
    match done {
        Ok(()) => {
            crate::services::log::info(format!("fenêtres : lancer vers {dir}, « {} » rangée", w.title));
            bus::emit(app, ID, "mascot.emote", json!({ "emotion": "push" }));
            Some(dir)
        }
        Err(e) => {
            crate::services::log::warn(format!("fenêtres : lancer vers {dir} impossible : {e}"));
            None
        }
    }
}

// ── Le trou noir (la liste est dans windowlife_hole.rs) ──────────────────────

/// La liste du trou noir a changé : le front relit la liste (`hole_list`), le
/// menu de l'icône suit (« Tout recracher »). Aussi appelée par tray.rs.
pub fn hole_changed(app: &AppHandle) {
    let n = hole::count();
    bus::emit(app, ID, "windowlife.hole", json!({ "count": n }));
    crate::tray::sync_hole(app, n);
}

/// « Tout recracher » du menu de l'icône (même module coupé : on ne garde rien caché).
pub fn release_from_tray(app: &AppHandle) {
    let n = hole::release_all("menu de l'icône");
    if n > 0 {
        bus::emit(app, ID, "windowlife.spat", json!({ "count": n }));
    }
    hole_changed(app);
}

/// Le point (px physiques) est-il sur l'île, quelle que soit sa forme (bande
/// de réveil, mini-île, ouverte ; sur n'importe quel bord) ?
fn on_island(app: &AppHandle, x: f64, y: f64) -> bool {
    let Some(shared) = app.try_state::<crate::Shared>() else { return false };
    crate::island::screen_point_on_island(app, &shared.gate, x, y)
}

/// Le crochet des déplacements, ouvert seulement quand le réglage est allumé.
struct HoleWatch {
    _watch: winlife::DragWatch,
    rx: Receiver<winlife::DragEvent>,
}

/// Le trou noir, à chaque tour : ouvre ou ferme le crochet selon le réglage,
/// suit le déplacement en cours (retour visuel), avale à la fin. Vrai tant
/// qu'une fenêtre est déplacée (le tour suivant vient plus vite).
fn hole_tick(app: &AppHandle, p: &Prefs, w: &mut Watch, t: f64) -> bool {
    if !p.swallow {
        w.hole_refused = false;
        if w.hole.take().is_some() {
            w.drag = None;
            if hole::release_all("réglage coupé") > 0 {
                hole_changed(app);
            }
        }
        return false;
    }
    if w.hole.is_none() {
        if w.hole_refused {
            return false;
        }
        let (tx, rx) = channel();
        match winlife::watch_drags(tx) {
            Some(watch) => w.hole = Some(HoleWatch { _watch: watch, rx }),
            // Hors de Windows, ou crochet refusé : on ne réessaie pas à chaque
            // tour (seulement après avoir coupé puis rallumé le réglage).
            None => {
                w.hole_refused = true;
                return false;
            }
        }
    }
    let Some(hw) = w.hole.as_ref() else { return false };
    let events: Vec<winlife::DragEvent> = hw.rx.try_iter().collect();
    for e in events {
        match e {
            winlife::DragEvent::Start { hwnd, placement, size } => {
                // Une fenêtre qu'on n'a pas le droit d'avaler : ni retour visuel, ni rien.
                let allowed = winlife::candidate(hwnd).is_some_and(|c| hole::may_swallow(&c).is_ok());
                w.drag = allowed.then(|| DragTrack::new(hwnd, placement, size));
            }
            winlife::DragEvent::End { hwnd, cursor } => {
                let Some(d) = w.drag.take().filter(|d| d.hwnd == hwnd) else { continue };
                if d.armed {
                    emit(app, "windowlife.hole-hover", json!({ "over": false }));
                }
                if !d.swallows(on_island(app, cursor.0 as f64, cursor.1 as f64)) {
                    continue;
                }
                // Hors du fil du module : l'icône et la vérification prennent un instant.
                let (app, placement) = (app.clone(), d.placement);
                std::thread::spawn(move || match hole::swallow(hwnd, placement) {
                    Ok(()) => {
                        bus::emit(&app, ID, "windowlife.swallowed", json!({ "ok": true }));
                        hole_changed(&app);
                    }
                    Err(e) => {
                        crate::services::log::warn(format!("trou noir : fenêtre non avalée ({e})"));
                        let reason = if e.contains("plein") { "full" } else { "refused" };
                        bus::emit(&app, ID, "windowlife.swallowed", json!({ "ok": false, "reason": reason }));
                    }
                });
            }
        }
    }
    let Some(d) = w.drag.as_mut() else { return false };
    let over = platform::cursor_physical().is_some_and(|(x, y)| on_island(app, x, y));
    if let Some(armed) = d.step(t, over, winlife::window_size(d.hwnd)) {
        emit(app, "windowlife.hole-hover", json!({ "over": armed }));
    }
    true
}

// ── Le thread ────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Watch {
    last_fg: Option<isize>,
    fullscreen: bool,
    sitting: bool,
    locked: bool,
    shake: MouseShake,
    started: Option<Instant>,
    last_slow: Option<Instant>,
    last_second: Option<Instant>,
    last_sunglasses: Option<Instant>,
    last_forgotten_check: Option<Instant>,
    last_forgotten: Option<Instant>,
    /// Pour chaque fenêtre : quand elle était au premier plan pour la dernière fois.
    active_at: HashMap<isize, Instant>,
    proposed: HashSet<isize>,
    /// Le module a placé un obstacle ou un perchoir (à retirer s'il s'arrête).
    placed: bool,
    /// Le trou noir : le crochet des déplacements, et le déplacement en cours.
    hole: Option<HoleWatch>,
    hole_refused: bool,
    drag: Option<DragTrack>,
}

fn run(app: AppHandle) {
    let mut w = Watch { started: Some(Instant::now()), ..Default::default() };
    let mut near = false;
    loop {
        let pace = if near {
            TICK_NEAR
        } else if perf::mode() == Mode::Eco {
            TICK_ECO
        } else {
            TICK
        };
        std::thread::sleep(pace);
        let Some(p) = prefs(&app) else {
            // Module coupé : l'île rentre chez elle.
            if w.placed {
                w.placed = false;
                dodge::set_obstacle(&app, "foreground", None);
                dodge::set_obstacle(&app, "toast", None);
                dodge::set_perch(&app, None);
            }
            // Et recrache tout ce qu'elle avait avalé.
            w.hole = None;
            w.drag = None;
            if hole::release_all("module coupé") > 0 {
                hole_changed(&app);
            }
            std::thread::sleep(Duration::from_secs(2));
            continue;
        };
        // Un tour qui panique ne tue pas le thread (le module continue).
        match catch_unwind(AssertUnwindSafe(|| tick(&app, &p, &mut w))) {
            Ok(n) => near = n,
            Err(_) => {
                crate::services::log::warn("fenêtres : un tour a planté");
                near = false;
                std::thread::sleep(Duration::from_secs(5));
            }
        }
    }
}

/// Un tour ; renvoie vrai si la souris est près de l'île (tour suivant plus rapide).
fn tick(app: &AppHandle, p: &Prefs, w: &mut Watch) -> bool {
    let island = crate::island::island_screen_rect(app);
    let cursor = platform::cursor_physical();
    let now = Instant::now();
    let t = now.duration_since(w.started.unwrap_or(now)).as_secs_f64();

    // ── Le trou noir (à chaque tour, rapide pendant un déplacement) ──
    let dragging = hole_tick(app, p, w, t);

    // ── La souris secouée près de l'île ──
    let near = match (island, cursor) {
        (Some((l, tp, r, b)), Some((cx, cy))) => cx >= l - NEAR_PX && cx <= r + NEAR_PX && cy >= tp - NEAR_PX && cy <= b + NEAR_PX,
        _ => false,
    };
    if p.mouse_shake && near {
        if let Some((cx, _)) = cursor {
            if w.shake.feed(cx, t) {
                // Une fois sur trois elle se cache, sinon elle rit.
                let emotion = if (t as u64).is_multiple_of(3) { "hide" } else { "laugh" };
                emit(app, "windowlife.mouse-shake", json!({ "emotion": emotion }));
            }
        }
    } else if let Some((cx, _)) = cursor {
        w.shake.reset(cx);
    }
    // Le reste à son rythme normal (pas 30 fois par seconde).
    if w.last_slow.is_some_and(|at| now.duration_since(at) < TICK - Duration::from_millis(20)) {
        return near || dragging;
    }
    w.last_slow = Some(now);

    // ── La fenêtre au premier plan ──
    let fg = winlife::foreground();
    if let Some(f) = fg.as_ref().filter(|f| !f.own) {
        w.active_at.insert(f.hwnd, now);
        w.proposed.remove(&f.hwnd);
    }
    let usable = fg.as_ref().filter(|f| ordinary(f));
    let home_top = crate::island::current_edge(app) == "top";

    // Perchée sur sa barre de titre (île du haut), sinon : s'en écarter.
    let perch = match usable {
        Some(f) if p.perch_title && home_top => Some(((f.rect.0 + f.rect.2) / 2, f.rect.1)),
        _ => None,
    };
    dodge::set_perch(app, perch);
    let avoid = match usable {
        Some(f) if p.avoid_foreground && perch.is_none() => Some((f.rect.0, f.rect.1, (f.rect.2 - f.rect.0) as u32, (f.rect.3 - f.rect.1) as u32)),
        _ => None,
    };
    dodge::set_obstacle(app, "foreground", avoid);
    w.placed = true;

    // Plein écran : un sursaut (l'île se cache ensuite d'elle-même en mode présentation).
    let fullscreen = fg.as_ref().is_some_and(|f| !f.own && is_fullscreen(f.rect, f.monitor));
    if fullscreen && !w.fullscreen && p.fullscreen_hop {
        emit(app, "windowlife.fullscreen", json!({ "on": true }));
    }
    w.fullscreen = fullscreen;

    // Le bord d'une fenêtre tout près : elle s'y assoit.
    let sitting = p.sit_edge && island.is_some_and(|i| usable.is_some_and(|f| sits_on(i, f.rect, &crate::island::current_edge(app))));
    if sitting != w.sitting {
        w.sitting = sitting;
        emit(app, "windowlife.sit", json!({ "on": sitting }));
    }

    // La nuit, une nouvelle fenêtre très claire : lunettes de soleil.
    let fg_id = fg.as_ref().map(|f| f.hwnd);
    if fg_id != w.last_fg {
        w.last_fg = fg_id;
        let can = p.night_sunglasses && is_night(platform::local_time().hour) && !w.last_sunglasses.is_some_and(|at| now.duration_since(at) < SUNGLASSES_EVERY);
        if let Some(f) = fg.as_ref().filter(|f| can && !f.own && !f.minimized) {
            if winlife::brightness(f.rect).is_some_and(|b| b >= BRIGHT) {
                w.last_sunglasses = Some(now);
                emit(app, "windowlife.bright", Value::Null);
            }
        }
    }

    // ── Une fois par seconde : bulles de Windows, verrouillage ──
    if !w.last_second.is_some_and(|at| now.duration_since(at) < Duration::from_millis(980)) {
        w.last_second = Some(now);
        let toasts = if p.toast_room { winlife::toast_rects() } else { Vec::new() };
        let union = toasts.iter().copied().reduce(|a, b| (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)));
        dodge::set_obstacle(app, "toast", union.map(|r| (r.0, r.1, (r.2 - r.0) as u32, (r.3 - r.1) as u32)));

        // Le trou noir : les fenêtres fermées (ou réaffichées par leur programme) en sortent.
        if hole::sweep() {
            hole_changed(app);
        }

        let locked = winlife::session_locked();
        if locked != w.locked {
            w.locked = locked;
            if p.lock_goodbye {
                emit(app, "windowlife.lock", json!({ "locked": locked }));
            }
        }
    }

    // ── Toutes les minutes : une fenêtre oubliée ? ──
    if p.tidy_forgotten && !w.last_forgotten_check.is_some_and(|at| now.duration_since(at) < FORGOTTEN_CHECK) {
        w.last_forgotten_check = Some(now);
        let windows = winlife::top_windows();
        // Une fenêtre jamais vue au premier plan compte depuis le démarrage du module.
        let start = w.started.unwrap_or(now);
        let idle: HashMap<isize, f64> = windows.iter().map(|x| (x.hwnd, now.duration_since(*w.active_at.get(&x.hwnd).unwrap_or(&start)).as_secs_f64())).collect();
        // On oublie les fenêtres fermées.
        w.active_at.retain(|h, _| idle.contains_key(h));
        w.proposed.retain(|h| idle.contains_key(h));
        let calm = w.last_forgotten.is_some_and(|at| now.duration_since(at) < FORGOTTEN_EVERY);
        if !calm {
            if let Some((hwnd, title)) = pick_forgotten(&windows, &idle, p.forgotten_mins, &w.proposed) {
                w.proposed.insert(hwnd);
                w.last_forgotten = Some(now);
                emit(app, "windowlife.forgotten", json!({ "hwnd": hwnd as i64, "title": title, "minutes": p.forgotten_mins.round() as i64 }));
            }
        }
    }
    near || dragging
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(hwnd: isize, title: &str) -> winlife::Win {
        winlife::Win { hwnd, title: title.into(), rect: (100, 100, 900, 700), monitor: (0, 0, 1920, 1080), work: (0, 0, 1920, 1032), ..Default::default() }
    }

    #[test]
    fn prefs_defaults_match_the_manifest() {
        let manifest: Value = serde_json::from_str(include_str!("../../../src/modules/windowlife/manifest.json")).unwrap();
        let mut values = Map::new();
        for f in manifest["settings"]["fields"].as_array().unwrap() {
            values.insert(f["key"].as_str().unwrap().into(), f["default"].clone());
        }
        // Les valeurs par défaut du manifeste = celles du Rust quand rien n'est enregistré.
        assert_eq!(Prefs::from(&values), Prefs::from(&Map::new()));
        // Les plus intrusives sont coupées.
        let p = Prefs::from(&Map::new());
        assert!(!p.avoid_foreground && !p.perch_title && !p.throw_snap && !p.tidy_forgotten);
        // Le trou noir aussi : il cache des fenêtres (voir windowlife_hole.rs).
        assert!(!p.swallow);
    }

    #[test]
    fn fullscreen_and_ordinary_windows() {
        let m = (0, 0, 1920, 1080);
        assert!(is_fullscreen((0, 0, 1920, 1080), m));
        assert!(!is_fullscreen((0, 0, 1920, 1032), m));
        let mut w = win(1, "Bloc-notes");
        assert!(ordinary(&w));
        w.maximized = true;
        assert!(!ordinary(&w));
        let mut own = win(2, "Réglages — Ondine");
        own.own = true;
        assert!(!ordinary(&own));
    }

    #[test]
    fn a_quick_throw_has_a_direction_a_slow_drag_has_none() {
        // 300 px vers la droite en 100 ms : 3000 px/s.
        let fast = [(100.0, 50.0, 0.1), (250.0, 52.0, 0.05), (400.0, 55.0, 0.0)];
        assert_eq!(throw_direction(&fast, 1.0), Some("right"));
        // Vers le haut.
        let up = [(500.0, 600.0, 0.1), (502.0, 300.0, 0.0)];
        assert_eq!(throw_direction(&up, 1.0), Some("top"));
        // Lent : 60 px en 100 ms.
        let slow = [(100.0, 50.0, 0.1), (160.0, 50.0, 0.0)];
        assert_eq!(throw_direction(&slow, 1.0), None);
        // Le début du geste (il y a longtemps) ne compte pas.
        let old = [(0.0, 0.0, 0.5), (900.0, 0.0, 0.3), (905.0, 0.0, 0.0)];
        assert_eq!(throw_direction(&old, 1.0), None);
        // À 150 %, les mêmes px physiques sont moins rapides.
        let mid = [(100.0, 50.0, 0.1), (360.0, 50.0, 0.0)];
        assert_eq!(throw_direction(&mid, 1.0), Some("right"));
        assert_eq!(throw_direction(&mid, 1.5), None);
        assert_eq!(throw_direction(&[], 1.0), None);
    }

    #[test]
    fn halves_of_the_work_area() {
        let work = (0, 0, 1920, 1032);
        assert_eq!(half("left", work), Some((0, 0, 960, 1032)));
        assert_eq!(half("right", work), Some((960, 0, 1920, 1032)));
        assert_eq!(half("top", work), None);
    }

    #[test]
    fn sitting_on_a_nearby_window_edge() {
        // L'île du haut : 600..1000 × 0..40.
        let island = (600.0, 0.0, 1000.0, 40.0);
        assert!(sits_on(island, (500, 55, 1200, 800), "top"));
        // Trop loin, ou sous l'île, ou pas en face.
        assert!(!sits_on(island, (500, 200, 1200, 800), "top"));
        assert!(!sits_on(island, (500, 10, 1200, 800), "top"));
        assert!(!sits_on(island, (1100, 50, 1400, 800), "top"));
        // L'île du bas : 600..1000 × 990..1032 ; une fenêtre qui finit juste au-dessus.
        let low = (600.0, 990.0, 1000.0, 1032.0);
        assert!(sits_on(low, (500, 300, 1200, 975), "bottom"));
        assert!(!sits_on(low, (500, 300, 1200, 800), "bottom"));
    }

    #[test]
    fn night_hours() {
        assert!(is_night(23) && is_night(2) && is_night(21));
        assert!(!is_night(6) && !is_night(14) && !is_night(20));
    }

    #[test]
    fn mouse_shake_needs_quick_back_and_forth() {
        let mut s = MouseShake::default();
        s.reset(500.0);
        let mut hit = false;
        // Allers-retours de 80 px toutes les 60 ms.
        for i in 0..12 {
            let x = if i % 2 == 0 { 540.0 } else { 460.0 };
            hit |= s.feed(x, i as f64 * 0.06);
        }
        assert!(hit);
        // Lentement (un demi-tour par seconde) : non.
        let mut s = MouseShake::default();
        s.reset(500.0);
        let slow = (0..12).any(|i| s.feed(if i % 2 == 0 { 540.0 } else { 460.0 }, i as f64));
        assert!(!slow);
    }

    #[test]
    fn forgotten_window_is_the_oldest_not_yet_proposed() {
        let windows = vec![win(1, "Excel"), win(2, "Paint"), win(3, "Explorateur")];
        let idle: HashMap<isize, f64> = [(1, 30.0 * 60.0), (2, 90.0 * 60.0), (3, 120.0 * 60.0)].into_iter().collect();
        let mut proposed = HashSet::new();
        assert_eq!(pick_forgotten(&windows, &idle, 60.0, &proposed), Some((3, "Explorateur".into())));
        proposed.insert(3);
        assert_eq!(pick_forgotten(&windows, &idle, 60.0, &proposed), Some((2, "Paint".into())));
        proposed.insert(2);
        assert_eq!(pick_forgotten(&windows, &idle, 60.0, &proposed), None);
        // Réduite : jamais proposée.
        let mut min = win(4, "Word");
        min.minimized = true;
        let idle4: HashMap<isize, f64> = [(4, 9999.0)].into_iter().collect();
        assert_eq!(pick_forgotten(&[min], &idle4, 60.0, &HashSet::new()), None);
    }
}
