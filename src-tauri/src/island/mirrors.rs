// Plusieurs écrans : un « reflet » de l'île sur chaque autre écran (1.2.3).
//
// Réglage `island.otherScreens` (coupé par défaut). L'île reste UNE seule
// fenêtre (tout son état, ses modules, ses notifications vivent dans une
// seule page) ; sur chacun des autres écrans, une toute petite fenêtre montre
// une encoche avec Ondine qui somnole (mirror.html, src/mirror/). Quand la
// souris touche un reflet, l'île vient sur cet écran (elle y reste jusqu'au
// prochain reflet touché) et s'ouvre en mini-île ; un reflet apparaît alors
// sur l'écran qu'elle a quitté.
//
// Pourquoi des reflets plutôt qu'une île qui suit seulement la souris : le
// réglage « Suit la souris » (general.screen = "cursor") existe déjà, mais on
// ne voit rien sur les autres écrans, et l'île saute d'écran à chaque passage
// de la souris, même ouverte. Un reflet montre où est Ondine et ne la fait
// venir que sur un geste voulu (toucher l'encoche). Et plutôt qu'une vraie
// île par écran : une seule page garde un seul état (une notification ne
// s'affiche pas trois fois, un minuteur ne tourne qu'une fois), et un reflet
// ne coûte presque rien (une page fixe, une animation CSS).
//
// Les reflets sont transparents aux clics : c'est la boucle de la souris
// (mod.rs, `spawn_cursor_poll`) qui regarde si elle en touche un (`hover`), et
// la vérification des écrans (2 fois par seconde) qui les place (`sync`).
// Une fenêtre de reflet n'est montrée qu'une fois sa page chargée (elle
// demande son apparence, `mirror_look`) : jamais un rectangle blanc.

use crate::sync::LockExt;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};

use super::{frame_sized, Area, Placement, WINDOW_LABEL};
use crate::platform;
use crate::services::log;

/// Le début du nom des fenêtres de reflet (« mirror-0 », « mirror-1 »…).
pub const LABEL_PREFIX: &str = "mirror-";
/// Au plus ce nombre de reflets (un PC à 5 écrans).
const MAX_MIRRORS: usize = 4;
/// Taille logique d'un reflet en haut ou en bas de l'écran (sur un côté : l'inverse).
pub const MIRROR_W: f64 = 76.0;
pub const MIRROR_H: f64 = 24.0;
/// Autour d'un reflet, la souris compte encore comme dessus (px physiques).
const HOVER_MARGIN: f64 = 3.0;

/// L'identité d'un écran : la position de son coin haut gauche (px physiques).
type ScreenId = (i32, i32);

/// Un reflet montré : sa fenêtre, son écran, son rectangle à l'écran (px physiques).
#[derive(Clone, Debug)]
struct Shown {
    label: String,
    screen: ScreenId,
    rect: (f64, f64, f64, f64),
}

#[derive(Default)]
struct State {
    /// L'écran où la souris a fait venir l'île (None : l'écran réglé).
    chosen: Option<ScreenId>,
    shown: Vec<Shown>,
    /// Les fenêtres de reflet dont la page est chargée (prêtes à montrer).
    ready: Vec<String>,
    /// L'apparence envoyée aux pages (pour ne la renvoyer que si elle change).
    look: String,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
/// Un seul `sync` à la fois (la boucle de la souris et un changement de réglages).
static SYNC: Mutex<()> = Mutex::new(());

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut guard = STATE.locked();
    f(guard.get_or_insert_with(State::default))
}

/// Ce que la page d'un reflet doit savoir pour se dessiner.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MirrorLook {
    pub edge: String,
    pub theme: String,
    pub color: String,
    /// La mascotte est dans l'île (ni cachée, ni sur le bureau).
    pub mascot: bool,
    /// Le style de l'île (« classic », ou « mouth » si une version le propose).
    pub style: String,
}

fn look_of(app: &AppHandle) -> MirrorLook {
    let Some(shared) = app.try_state::<crate::Shared>() else {
        return MirrorLook { edge: "top".into(), theme: "nuit".into(), color: String::new(), mascot: true, style: "classic".into() };
    };
    let s = shared.settings.locked();
    // Le style d'île (nano / bouche) est lu tel quel s'il existe dans le fichier.
    let style = serde_json::to_value(&s.island).ok().and_then(|v| v.get("style").and_then(|x| x.as_str()).map(String::from)).unwrap_or_else(|| "classic".into());
    MirrorLook { edge: s.island.edge.clone(), theme: s.island.theme.clone(), color: s.island.color.clone(), mascot: s.mascot.enabled && !s.mascot.pet, style }
}

/// La page d'un reflet demande son apparence : elle est chargée, on peut la montrer.
pub fn page_ready(app: &AppHandle, label: &str) -> MirrorLook {
    with(|st| {
        if !st.ready.iter().any(|l| l == label) {
            st.ready.push(label.to_string());
        }
    });
    // Elle était peut-être déjà à sa place, cachée en attendant sa page.
    let handle = app.clone();
    std::thread::spawn(move || sync(&handle));
    look_of(app)
}

fn enabled(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>().is_some_and(|s| {
        let st = s.settings.locked();
        st.island.other_screens && !(st.island.presentation_quiet && platform::presentation_busy())
    })
}

fn screen_id(m: &Monitor) -> ScreenId {
    (m.position().x, m.position().y)
}

/// L'écran choisi en touchant un reflet, s'il existe encore et que les reflets sont actifs.
pub fn chosen_monitor(app: &AppHandle, monitors: &[Monitor]) -> Option<Monitor> {
    let chosen = with(|st| st.chosen)?;
    let on = app.try_state::<crate::Shared>().is_some_and(|s| s.settings.locked().island.other_screens);
    if !on {
        return None;
    }
    monitors.iter().find(|m| screen_id(m) == chosen).cloned()
}

/// Le rectangle d'un reflet sur un écran (calcul pur, testé) : même bord et
/// même place que l'île, à la taille d'une encoche.
pub fn mirror_frame(a: &Area, scale: f64, place: &Placement) -> (u32, u32, i32, i32) {
    let (w, h) = if place.side() { (MIRROR_H, MIRROR_W) } else { (MIRROR_W, MIRROR_H) };
    frame_sized(a, scale, place, w, h)
}

/// La souris (px physiques) est-elle sur ce rectangle (gauche, haut, droite, bas), à `margin` près ?
pub fn point_in(rect: (f64, f64, f64, f64), x: f64, y: f64, margin: f64) -> bool {
    x >= rect.0 - margin && x <= rect.2 + margin && y >= rect.1 - margin && y <= rect.3 + margin
}

fn area_of(m: &Monitor) -> Area {
    let wa = m.work_area();
    Area { x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height, work_bottom: wa.position.y + wa.size.height as i32 }
}

/// Crée la fenêtre d'un reflet (cachée ; montrée quand sa page est chargée).
/// Jamais depuis le fil principal (sous Windows, la création attend la boucle
/// de messages) : appelé par la boucle de la souris ou un fil à part.
fn create(app: &AppHandle, label: &str) -> bool {
    let builder = WebviewWindowBuilder::new(app, label, crate::page_url(app, "mirror.html"))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Ondine")
        .inner_size(MIRROR_W, MIRROR_H)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .visible(false);
    match builder.build() {
        Ok(win) => {
            platform::make_non_activating(&win);
            // Les clics passent au travers : la boucle de la souris s'en occupe.
            let _ = win.set_ignore_cursor_events(true);
            true
        }
        Err(err) => {
            log::warn(format!("reflet « {label} » impossible à créer : {err}"));
            false
        }
    }
}

/// Place, montre ou cache les reflets : un par écran qui n'a pas l'île.
pub fn sync(app: &AppHandle) {
    let _one = SYNC.locked();
    if !enabled(app) {
        // Coupé (ou présentation en cours) : rien à montrer. Sans reflet créé, c'est tout.
        hide_from(app, 0);
        with(|st| st.shown.clear());
        return;
    }
    let monitors = app.available_monitors().unwrap_or_default();
    let pref = app.try_state::<crate::Shared>().map(|s| s.settings.locked().general.screen.clone()).unwrap_or_default();
    let island = super::target_monitor(app, &pref).map(|m| screen_id(&m));
    let place = Placement::from_settings(app);
    let want: Vec<(ScreenId, (u32, u32, i32, i32))> = monitors
        .iter()
        .filter(|m| Some(screen_id(m)) != island)
        .take(MAX_MIRRORS)
        .map(|m| (screen_id(m), mirror_frame(&area_of(m), m.scale_factor(), &place)))
        .collect();

    // L'apparence a changé (thème, bord, mascotte) : les pages se redessinent.
    let look = look_of(app);
    let look_json = serde_json::to_string(&look).unwrap_or_default();
    let look_changed = with(|st| {
        let changed = st.look != look_json;
        st.look = look_json.clone();
        changed
    });

    let mut shown = Vec::new();
    for (i, (screen, (w, h, x, y))) in want.iter().enumerate() {
        let label = format!("{LABEL_PREFIX}{i}");
        let win = match app.get_webview_window(&label) {
            Some(w) => Some(w),
            None if create(app, &label) => app.get_webview_window(&label),
            None => None,
        };
        let Some(win) = win else { continue };
        let _ = win.set_size(PhysicalSize::new(*w, *h));
        let _ = win.set_position(PhysicalPosition::new(*x, *y));
        // Passer d'un écran à l'autre peut changer l'échelle : on réimpose la taille.
        let _ = win.set_size(PhysicalSize::new(*w, *h));
        if look_changed {
            let _ = win.eval(format!("window.__ondineMirror && window.__ondineMirror({look_json})"));
        }
        if with(|st| st.ready.contains(&label)) {
            if !win.is_visible().unwrap_or(false) {
                let _ = win.show();
                let _ = win.set_always_on_top(true);
            }
            shown.push(Shown { label, screen: *screen, rect: (*x as f64, *y as f64, (*x + *w as i32) as f64, (*y + *h as i32) as f64) });
        }
    }
    hide_from(app, want.len());
    with(|st| st.shown = shown);
}

/// Cache les reflets à partir du numéro `first` (un écran débranché, le
/// réglage coupé) ; les fenêtres sont gardées pour plus tard.
fn hide_from(app: &AppHandle, first: usize) {
    for i in first..MAX_MIRRORS {
        if let Some(win) = app.get_webview_window(&format!("{LABEL_PREFIX}{i}")) {
            if win.is_visible().unwrap_or(false) {
                let _ = win.hide();
            }
        }
    }
}

/// À chaque tour de la boucle de la souris (px physiques) : la souris touche
/// un reflet ? L'île vient sur cet écran et s'ouvre en mini-île. Très peu
/// coûteux quand il n'y a pas de reflet (une liste vide).
pub fn hover(app: &AppHandle, cx: f64, cy: f64) {
    let hit = with(|st| st.shown.iter().find(|s| point_in(s.rect, cx, cy, HOVER_MARGIN)).cloned());
    let Some(hit) = hit else { return };
    log::info("reflet touché : l'île vient sur cet écran");
    with(|st| {
        st.chosen = Some(hit.screen);
        // Plus de reflet sous la souris (le prochain tour ne le retouche pas).
        st.shown.retain(|s| s.label != hit.label);
    });
    if let Some(win) = app.get_webview_window(&hit.label) {
        let _ = win.hide();
    }
    if let Some(shared) = app.try_state::<crate::Shared>() {
        let pref = shared.settings.locked().general.screen.clone();
        super::apply_geometry(app, &pref, shared.gate.collapsed.load(std::sync::atomic::Ordering::Relaxed));
        super::refresh_click_through(app, &shared.gate);
    }
    let _ = app.emit_to(WINDOW_LABEL, "mirror-arrive", ());
    // Un reflet sur l'écran quitté.
    sync(app);
}

#[cfg(test)]
mod tests {
    use super::{mirror_frame, point_in, MIRROR_H, MIRROR_W};
    use crate::island::{Area, Placement};

    #[test]
    fn mirror_sits_where_the_island_would() {
        // Deuxième écran à droite, 2560 × 1440 à 100 %, barre des tâches de 48 px.
        let a = Area { x: 1920, y: 0, w: 2560, h: 1440, work_bottom: 1392 };
        let top = Placement { edge: "top".into(), align: "center".into(), offset: 0.5 };
        assert_eq!(mirror_frame(&a, 1.0, &top), (MIRROR_W as u32, MIRROR_H as u32, 1920 + 1280 - 38, 0));
        // En bas : posé sur la barre des tâches.
        let bottom = Placement { edge: "bottom".into(), align: "start".into(), offset: 0.0 };
        assert_eq!(mirror_frame(&a, 1.0, &bottom), (76, 24, 1920, 1392 - 24));
        // Sur un côté, à 150 % : vertical.
        let left = Placement { edge: "left".into(), align: "center".into(), offset: 0.5 };
        let (w, h, x, _) = mirror_frame(&a, 1.5, &left);
        assert_eq!((w, h, x), (36, 114, 1920));
    }

    #[test]
    fn hover_has_a_small_margin() {
        let r = (100.0, 0.0, 176.0, 24.0);
        assert!(point_in(r, 120.0, 10.0, 0.0));
        assert!(point_in(r, 98.0, 0.0, 3.0));
        assert!(!point_in(r, 90.0, 10.0, 3.0));
        assert!(!point_in(r, 120.0, 40.0, 3.0));
    }
}
