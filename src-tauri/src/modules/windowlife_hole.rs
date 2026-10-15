// Le « trou noir » d'Ondine et les fenêtres (réglage `swallow`, coupé par défaut).
//
// On fait glisser une fenêtre par sa barre de titre et on la lâche sur l'île :
// Ondine l'avale. La fenêtre est seulement CACHÉE (ShowWindowAsync SW_HIDE) :
// plus à l'écran, ni dans la barre des tâches, ni dans Alt+Tab, mais son
// programme continue de tourner. L'île garde la liste (icône + titre) ; un
// clic la recrache, à sa place d'avant le déplacement, au premier plan.
//
// Idée et technique (crochet d'événements MOVESIZESTART / MOVESIZEEND, place
// d'avant le glisser, filet de sécurité sur disque) : windows-dynamic-island
// de Nazim Ferragh (MIT), réécrit ici (voir THIRD-PARTY.md). Pas de crochet
// souris : deux événements par déplacement suffisent, et la souris n'est lue
// que pendant un déplacement (platform/winlife.rs, `watch_drags`).
//
// Sécurité, avant tout :
//   - jamais une fenêtre d'Ondine, le bureau, la barre des tâches, une fenêtre
//     plein écran, une boîte de dialogue, une fenêtre qui ne répond pas, ni
//     celle d'un programme administrateur quand Ondine ne l'est pas (on ne
//     serait pas sûr de pouvoir la réafficher) : `may_swallow`, testé ;
//   - jamais fermée : cachée, puis réaffichée, rien d'autre ;
//   - tout est recraché quand Ondine quitte (RunEvent::Exit dans lib.rs, juste
//     avant l'installation d'une mise à jour, panique du fil principal), quand
//     le module ou le réglage est coupé, et avec « Tout recracher » (île,
//     Accueil, menu de l'icône) ;
//   - contre un plantage ou un arrêt brutal : la liste (hwnd + programme +
//     classe + titre + place) est écrite dans %APPDATA%\Ondine\trou-noir.json
//     AVANT de cacher la fenêtre, et relue au démarrage suivant pour
//     réafficher celles qui existent encore (même fenêtre, même programme,
//     toujours cachée). Le fichier disparaît quand la liste est vide ;
//   - une fenêtre fermée par son programme (ou réaffichée par lui) sort
//     simplement de la liste (`Hole::sweep`, une fois par seconde).
// Le titre n'est jamais écrit dans le journal (seulement des nombres).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::platform::winlife::{self, Candidate, Placement};
use crate::sync::LockExt;

/// Le trou noir ne garde pas plus de fenêtres que ça.
pub const MAX_ITEMS: usize = 24;
/// Il faut rester au-dessus de l'île au moins ce temps (s) avant de lâcher :
/// une fenêtre qu'on lance vers le haut de l'écran pour l'agrandir (geste de
/// Windows) ne tombe pas dedans par accident.
pub const ARM_SECS: f64 = 0.3;
/// Le fichier de secours, dans %APPDATA%\Ondine.
const FILE_NAME: &str = "trou-noir.json";

/// Les classes de fenêtres de Windows lui-même : bureau, barre des tâches,
/// menu Démarrer, vue des tâches, bulles, menus… Jamais avalées. Les
/// applis du Store (ApplicationFrameWindow) non plus : leur contenu vit dans
/// une autre fenêtre, que Windows peut suspendre pendant qu'elle est cachée.
pub const SHELL_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "NotifyIconOverflowWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "XamlExplorerHostIslandWindow",
    "Windows.UI.Core.CoreWindow",
    "ApplicationFrameWindow",
    "MultitaskingViewFrame",
    "ForegroundStaging",
    "TaskListThumbnailWnd",
    "#32768",
];

// ── Le tri (testé) ───────────────────────────────────────────────────────────

/// Peut-on avaler cette fenêtre ? Err : la raison (pour le journal et la bulle).
pub fn may_swallow(c: &Candidate) -> Result<(), &'static str> {
    if c.own {
        return Err("une fenêtre d'Ondine");
    }
    if !c.visible || c.cloaked {
        return Err("une fenêtre cachée");
    }
    if !c.root || c.child || c.tool || c.owned {
        return Err("pas une fenêtre principale");
    }
    if SHELL_CLASSES.iter().any(|k| k.eq_ignore_ascii_case(&c.class)) {
        return Err("une fenêtre de Windows");
    }
    if super::windowlife::is_fullscreen(c.rect, c.monitor) {
        return Err("une fenêtre en plein écran");
    }
    if c.hung {
        return Err("une fenêtre qui ne répond pas");
    }
    if c.elevated {
        return Err("une fenêtre d'un programme administrateur");
    }
    if c.title.trim().is_empty() {
        return Err("une fenêtre sans titre");
    }
    Ok(())
}

/// Une fenêtre avalée.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Swallowed {
    pub hwnd: i64,
    pub pid: u32,
    #[serde(default)]
    pub class: String,
    #[serde(default)]
    pub title: String,
    /// Sa place d'avant le déplacement (elle y revient).
    #[serde(default)]
    pub placement: Option<Placement>,
    /// Son icône (data URL PNG), en mémoire seulement.
    #[serde(skip)]
    pub icon: Option<String>,
}

/// La liste des fenêtres avalées, la plus récente d'abord.
#[derive(Debug, Default)]
pub struct Hole {
    items: Vec<Swallowed>,
}

impl Hole {
    pub const fn new() -> Hole {
        Hole { items: Vec::new() }
    }

    pub fn items(&self) -> &[Swallowed] {
        &self.items
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn contains(&self, hwnd: i64) -> bool {
        self.items.iter().any(|i| i.hwnd == hwnd)
    }

    /// Ajoute en tête ; Err si elle y est déjà ou si le trou noir est plein.
    pub fn add(&mut self, item: Swallowed) -> Result<(), &'static str> {
        if self.contains(item.hwnd) {
            return Err("déjà avalée");
        }
        if self.items.len() >= MAX_ITEMS {
            return Err("le trou noir est plein");
        }
        self.items.insert(0, item);
        Ok(())
    }

    pub fn take(&mut self, hwnd: i64) -> Option<Swallowed> {
        let i = self.items.iter().position(|x| x.hwnd == hwnd)?;
        Some(self.items.remove(i))
    }

    pub fn take_all(&mut self) -> Vec<Swallowed> {
        std::mem::take(&mut self.items)
    }

    /// Retire les fenêtres fermées (ou passées à un autre programme : le
    /// numéro a été réutilisé) et celles que leur programme a réaffichées.
    /// `state` : (existe toujours au même programme, visible). Vrai si la liste a changé.
    pub fn sweep(&mut self, state: impl Fn(&Swallowed) -> (bool, bool)) -> bool {
        let before = self.items.len();
        self.items.retain(|i| matches!(state(i), (true, false)));
        self.items.len() != before
    }

    /// Le texte du fichier de secours (sans les icônes).
    pub fn to_file(&self) -> String {
        serde_json::to_string(&self.items).unwrap_or_else(|_| "[]".into())
    }
}

/// Relit le fichier de secours (un fichier abîmé = rien).
pub fn parse_file(text: &str) -> Vec<Swallowed> {
    serde_json::from_str(text).unwrap_or_default()
}

/// Celles du fichier à réafficher : même fenêtre, même programme, toujours cachée.
pub fn to_recover(saved: &[Swallowed], state: impl Fn(&Swallowed) -> (bool, bool)) -> Vec<&Swallowed> {
    saved.iter().filter(|s| matches!(state(s), (true, false))).collect()
}

/// Un déplacement de fenêtre en cours, vu par le fil du module.
#[derive(Clone, Debug, PartialEq)]
pub struct DragTrack {
    pub hwnd: isize,
    pub placement: Option<Placement>,
    size: (i32, i32),
    /// La taille a changé : on la redimensionne par un bord, ce n'est pas un glisser.
    resized: bool,
    over_since: Option<f64>,
    /// Restée assez longtemps au-dessus de l'île : la lâcher l'avale.
    pub armed: bool,
}

impl DragTrack {
    pub fn new(hwnd: isize, placement: Option<Placement>, size: (i32, i32)) -> DragTrack {
        DragTrack { hwnd, placement, size, resized: false, over_since: None, armed: false }
    }

    /// Un tour pendant le déplacement : `t` (s), la souris sur l'île, la taille
    /// de la fenêtre maintenant. Some(armée ou non) quand ça change (le retour
    /// visuel de l'île et d'Ondine), sinon None.
    pub fn step(&mut self, t: f64, over: bool, size: Option<(i32, i32)>) -> Option<bool> {
        if size.is_some_and(|s| s != self.size) {
            self.resized = true;
        }
        let was = self.armed;
        if over && !self.resized {
            let since = *self.over_since.get_or_insert(t);
            self.armed = t - since >= ARM_SECS;
        } else {
            self.over_since = None;
            self.armed = false;
        }
        (self.armed != was).then_some(self.armed)
    }

    /// Lâchée : faut-il l'avaler ? Armée, et la souris toujours sur l'île.
    pub fn swallows(&self, over: bool) -> bool {
        self.armed && over && !self.resized
    }
}

// ── L'état partagé (fil du module, commandes, sortie d'Ondine) ───────────────

static HOLE: Mutex<Hole> = Mutex::new(Hole::new());

fn file_path() -> PathBuf {
    crate::platform::config_dir().join(FILE_NAME)
}

/// Écrit le fichier de secours (supprimé quand la liste est vide).
fn save(hole: &Hole) {
    let path = file_path();
    if hole.is_empty() {
        let _ = std::fs::remove_file(&path);
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    let written = std::fs::write(&tmp, hole.to_file()).and_then(|_| std::fs::rename(&tmp, &path));
    if let Err(e) = written {
        crate::services::log::warn(format!("trou noir : fichier de secours non écrit ({e})"));
    }
}

pub fn count() -> usize {
    HOLE.locked().len()
}

/// Au démarrage d'Ondine : réaffiche les fenêtres qu'une session précédente a
/// laissées cachées (plantage, arrêt brutal), puis efface le fichier.
pub fn recover_at_start() {
    let path = file_path();
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    let saved = parse_file(&text);
    let back = to_recover(&saved, |s| winlife::window_state(s.hwnd as isize, s.pid));
    let n = back.iter().filter(|s| winlife::show_again(s.hwnd as isize, s.placement, false).is_ok()).count();
    let _ = std::fs::remove_file(&path);
    if !saved.is_empty() {
        crate::services::log::info(format!("trou noir : {n} fenêtre(s) laissée(s) cachée(s) par la session précédente réaffichée(s) ({} notée(s))", saved.len()));
    }
}

/// Avale une fenêtre (après le tri). L'ordre compte : notée dans la liste et
/// dans le fichier de secours d'abord, cachée ensuite ; si Windows refuse de
/// la cacher, elle ressort de la liste.
pub fn swallow(hwnd: isize, placement: Option<Placement>) -> Result<(), String> {
    let c = winlife::candidate(hwnd).ok_or("fenêtre introuvable")?;
    may_swallow(&c)?;
    let icon = winlife::icon_png(hwnd).map(|png| {
        use base64::Engine;
        format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
    });
    let item = Swallowed { hwnd: hwnd as i64, pid: c.pid, class: c.class, title: c.title, placement, icon };
    {
        let mut hole = HOLE.locked();
        hole.add(item)?;
        save(&hole);
    }
    if let Err(e) = winlife::hide(hwnd) {
        let mut hole = HOLE.locked();
        hole.take(hwnd as i64);
        save(&hole);
        return Err(e);
    }
    crate::services::log::info(format!("trou noir : une fenêtre avalée ({} dedans)", count()));
    Ok(())
}

/// Recrache une fenêtre (un clic) : à sa place, au premier plan.
pub fn spit(hwnd: i64) -> Result<(), String> {
    let item = HOLE.locked().take(hwnd).ok_or("cette fenêtre n'est plus dans le trou noir")?;
    let shown = winlife::show_again(item.hwnd as isize, item.placement, true);
    let mut hole = HOLE.locked();
    if let Err(e) = &shown {
        // Toujours là mais pas encore réaffichée (programme lent) : on la garde,
        // le tri de chaque seconde la retirera quand elle sera revenue.
        let (alive, visible) = winlife::window_state(item.hwnd as isize, item.pid);
        if alive && !visible {
            let _ = hole.add(item);
            save(&hole);
            return Err(e.clone());
        }
    }
    save(&hole);
    Ok(())
}

/// Recrache tout, sans voler le focus (sortie d'Ondine, module ou réglage
/// coupé, « Tout recracher »). Renvoie le nombre de fenêtres réaffichées.
/// Peut être appelée de n'importe quel fil, plusieurs fois.
pub fn release_all(why: &str) -> usize {
    let items = {
        let mut hole = HOLE.locked();
        let items = hole.take_all();
        if items.is_empty() {
            return 0;
        }
        items
    };
    let mut left = Hole::new();
    let mut n = 0;
    for item in items {
        match winlife::show_again(item.hwnd as isize, item.placement, false) {
            Ok(()) => n += 1,
            Err(_) => {
                // Pas encore réaffichée mais toujours là : gardée dans le fichier
                // de secours, le prochain démarrage s'en occupera.
                if winlife::window_state(item.hwnd as isize, item.pid) == (true, false) {
                    let _ = left.add(item);
                }
            }
        }
    }
    {
        let mut hole = HOLE.locked();
        for item in left.take_all() {
            let _ = hole.add(item);
        }
        save(&hole);
    }
    crate::services::log::info(format!("trou noir : {n} fenêtre(s) recrachée(s) ({why})"));
    n
}

/// Le fil principal panique (Ondine s'arrête) : réaffiche tout ce qui peut
/// l'être, sans attendre un verrou que ce fil tiendrait peut-être déjà. Le
/// fichier de secours reste : le prochain démarrage ignore celles qui sont
/// déjà visibles.
pub fn release_on_panic() {
    let items = match HOLE.try_lock() {
        Ok(mut hole) => hole.take_all(),
        Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner().take_all(),
        Err(std::sync::TryLockError::WouldBlock) => return,
    };
    for item in items {
        let _ = winlife::show_again(item.hwnd as isize, item.placement, false);
    }
}

/// Le tri de chaque seconde ; vrai si la liste a changé.
pub fn sweep() -> bool {
    let mut hole = HOLE.locked();
    if hole.is_empty() {
        return false;
    }
    let changed = hole.sweep(|s| winlife::window_state(s.hwnd as isize, s.pid));
    if changed {
        save(&hole);
    }
    changed
}

/// Ce que le front montre : numéro, titre, icône (jamais écrit sur le disque).
pub fn list_json() -> Value {
    let hole = HOLE.locked();
    Value::Array(hole.items().iter().map(|i| json!({ "hwnd": i.hwnd, "title": i.title, "icon": i.icon })).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_candidate() -> Candidate {
        Candidate {
            hwnd: 42,
            pid: 1234,
            class: "Notepad".into(),
            title: "Sans titre - Bloc-notes".into(),
            visible: true,
            root: true,
            rect: (100, 100, 900, 700),
            monitor: (0, 0, 1920, 1080),
            ..Default::default()
        }
    }

    fn item(hwnd: i64, title: &str) -> Swallowed {
        Swallowed { hwnd, pid: 7, class: "Notepad".into(), title: title.into(), placement: None, icon: None }
    }

    #[test]
    fn an_ordinary_window_can_be_swallowed() {
        assert_eq!(may_swallow(&ok_candidate()), Ok(()));
        // Agrandie (pas plein écran : la barre des tâches reste) : oui.
        let mut c = ok_candidate();
        c.rect = (0, 0, 1920, 1032);
        assert_eq!(may_swallow(&c), Ok(()));
    }

    #[test]
    fn forbidden_windows_are_refused() {
        let refused = |f: &dyn Fn(&mut Candidate)| {
            let mut c = ok_candidate();
            f(&mut c);
            may_swallow(&c).is_err()
        };
        assert!(refused(&|c| c.own = true), "Ondine elle-même");
        assert!(refused(&|c| c.class = "Progman".into()), "le bureau");
        assert!(refused(&|c| c.class = "WorkerW".into()), "le bureau (fond)");
        assert!(refused(&|c| c.class = "Shell_TrayWnd".into()), "la barre des tâches");
        assert!(refused(&|c| c.class = "shell_secondarytraywnd".into()), "la barre d'un 2e écran, casse ignorée");
        assert!(refused(&|c| c.class = "ApplicationFrameWindow".into()), "une appli du Store");
        assert!(refused(&|c| c.rect = (0, 0, 1920, 1080)), "plein écran");
        assert!(refused(&|c| c.elevated = true), "programme administrateur");
        assert!(refused(&|c| c.hung = true), "ne répond pas");
        assert!(refused(&|c| c.owned = true), "boîte de dialogue");
        assert!(refused(&|c| c.child = true), "fenêtre enfant");
        assert!(refused(&|c| c.tool = true), "fenêtre outil");
        assert!(refused(&|c| c.root = false), "pas la fenêtre principale");
        assert!(refused(&|c| c.visible = false), "déjà cachée");
        assert!(refused(&|c| c.cloaked = true), "cachée par Windows");
        assert!(refused(&|c| c.title = "  ".into()), "sans titre");
    }

    #[test]
    fn the_list_keeps_the_newest_first_without_duplicates() {
        let mut h = Hole::new();
        assert!(h.add(item(1, "Excel")).is_ok());
        assert!(h.add(item(2, "Paint")).is_ok());
        assert_eq!(h.items().iter().map(|i| i.hwnd).collect::<Vec<_>>(), vec![2, 1]);
        assert!(h.add(item(1, "Excel encore")).is_err());
        assert_eq!(h.take(1).map(|i| i.title), Some("Excel".into()));
        assert_eq!(h.take(1), None);
        assert_eq!(h.len(), 1);
        assert_eq!(h.take_all().len(), 1);
        assert!(h.is_empty());
    }

    #[test]
    fn the_list_has_a_limit() {
        let mut h = Hole::new();
        for i in 0..MAX_ITEMS as i64 {
            assert!(h.add(item(i, "x")).is_ok());
        }
        assert!(h.add(item(999, "de trop")).is_err());
    }

    #[test]
    fn closed_or_reappeared_windows_leave_the_list() {
        let mut h = Hole::new();
        for i in 1..=4 {
            h.add(item(i, "x")).unwrap();
        }
        // 1 : toujours cachée ; 2 : fermée ; 3 : réaffichée par son programme ;
        // 4 : le numéro est maintenant à un autre programme.
        let changed = h.sweep(|s| match s.hwnd {
            1 => (true, false),
            2 => (false, false),
            3 => (true, true),
            _ => (false, true),
        });
        assert!(changed);
        assert_eq!(h.items().iter().map(|i| i.hwnd).collect::<Vec<_>>(), vec![1]);
        assert!(!h.sweep(|_| (true, false)));
    }

    #[test]
    fn the_rescue_file_round_trips_without_icons() {
        let mut h = Hole::new();
        let mut a = item(10, "Rapport « final ».docx");
        a.placement = Some(Placement { normal: (10, 20, 810, 620), maximized: true });
        a.icon = Some("data:image/png;base64,AAAA".into());
        h.add(a).unwrap();
        h.add(item(11, "Paint")).unwrap();
        let text = h.to_file();
        assert!(!text.contains("base64"), "l'icône reste en mémoire");
        let back = parse_file(&text);
        assert_eq!(back.len(), 2);
        assert_eq!(back[1].title, "Rapport « final ».docx");
        assert_eq!(back[1].placement, Some(Placement { normal: (10, 20, 810, 620), maximized: true }));
        assert_eq!(back[1].icon, None);
        // Un fichier abîmé ou d'une autre forme : rien.
        assert!(parse_file("pas du json").is_empty());
        assert!(parse_file("{\"a\":1}").is_empty());
        // Un champ en moins (ancien fichier) : valeurs par défaut.
        assert_eq!(parse_file("[{\"hwnd\":5,\"pid\":9}]")[0].title, "");
    }

    #[test]
    fn only_still_hidden_windows_of_the_same_program_are_recovered() {
        let saved = vec![item(1, "a"), item(2, "b"), item(3, "c")];
        let back = to_recover(&saved, |s| match s.hwnd {
            1 => (true, false), // toujours cachée : réaffichée
            2 => (true, true),  // déjà visible : rien à faire
            _ => (false, false), // fermée ou numéro réutilisé : surtout pas
        });
        assert_eq!(back.iter().map(|s| s.hwnd).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn a_drag_arms_after_a_moment_over_the_island() {
        let mut d = DragTrack::new(5, None, (800, 600));
        assert_eq!(d.step(0.0, false, Some((800, 600))), None);
        // Arrivée sur l'île : pas encore armée.
        assert_eq!(d.step(0.1, true, Some((800, 600))), None);
        assert!(!d.swallows(true), "lâchée trop vite (le geste « agrandir » de Windows)");
        assert_eq!(d.step(0.45, true, Some((800, 600))), Some(true));
        assert!(d.swallows(true));
        assert!(!d.swallows(false), "lâchée à côté de l'île");
        // Elle repart : désarmée.
        assert_eq!(d.step(0.5, false, Some((800, 600))), Some(false));
        assert!(!d.swallows(true));
        // Elle revient : le compte repart de zéro.
        assert_eq!(d.step(0.6, true, None), None);
        assert_eq!(d.step(0.95, true, None), Some(true));
    }

    #[test]
    fn a_resize_is_not_a_drag() {
        let mut d = DragTrack::new(5, None, (800, 600));
        d.step(0.0, true, Some((820, 600)));
        assert_eq!(d.step(1.0, true, Some((840, 600))), None);
        assert!(!d.swallows(true));
    }
}
