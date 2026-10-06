// Les modes de performance : à quel rythme tournent les boucles d'Ondine.
//
// Réglage `general.perfMode` (Réglages → Général → Performances) :
//   - "high"     : Performance haute, plus réactif là où ça se voit ;
//   - "balanced" : Équilibrée (par défaut), le rythme historique ;
//   - "eco"      : Économie d'énergie, 2 à 4 fois plus lent pour ce qui ne se
//                  voit pas tout de suite.
// Et `general.ecoOnBattery` : sur batterie (PC débranché), on passe en "eco"
// quel que soit le choix.
//
// Le mode EFFECTIF (choix + batterie) est gardé ici. Toutes les boucles du Rust
// demandent leur rythme à `every(Loop::…)` à chaque tour : changer de mode
// s'applique donc au tour suivant, sans redémarrer. Le front reçoit le même
// mode (événement "perf-mode", commande `perf_state`) et a son propre tableau
// (src/core/perf.ts). Les deux tableaux sont recopiés dans docs/ARCHITECTURE.md.

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::platform;
use crate::services::log;
use crate::sync::LockExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    High,
    Balanced,
    Eco,
}

impl Mode {
    /// Lit la valeur du réglage ; une valeur inconnue = "balanced".
    pub fn parse(s: &str) -> Mode {
        match s {
            "high" => Mode::High,
            "eco" => Mode::Eco,
            _ => Mode::Balanced,
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Mode::High => 0,
            Mode::Balanced => 1,
            Mode::Eco => 2,
        }
    }

    fn from_u8(v: u8) -> Mode {
        match v {
            0 => Mode::High,
            2 => Mode::Eco,
            _ => Mode::Balanced,
        }
    }
}

/// Le mode qui s'applique vraiment : le choix, sauf sur batterie si la case
/// « Économie d'énergie automatique sur batterie » est cochée.
pub fn effective(chosen: &str, eco_on_battery: bool, on_battery: bool) -> Mode {
    if eco_on_battery && on_battery {
        Mode::Eco
    } else {
        Mode::parse(chosen)
    }
}

/// Les boucles qui tournent en permanence (une ligne du tableau chacune).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Loop {
    /// Souris, île visible, souris qui bouge près de l'île.
    CursorMoving,
    /// Souris, île visible, souris immobile depuis 250 ms.
    CursorStill,
    /// Souris, île visible, souris à plus de 200 px de l'île.
    CursorFar,
    /// Souris, île cachée : seulement la bande de réveil.
    CursorHidden,
    /// Changement d'écran (branché, débranché, échelle).
    ScreenCheck,
    /// Compteur du presse-papiers.
    Clipboard,
    /// Lecteur en cours (SMTC).
    Media,
    /// Processeur et mémoire (module Système).
    System,
    /// Place sur les disques et batterie (module Système).
    SystemDisks,
    /// Micro / caméra utilisés, micro coupé (module Contrôles).
    Controls,
    /// Dossier Téléchargements (Étagère).
    ShelfDownloads,
    /// Règles : attente d'un événement de fichier (fichiers « stables »).
    RulesWait,
    /// Règles : lecteurs branchés / débranchés.
    RulesDrives,
    /// Agenda : date de modification des .ics.
    AgendaFiles,
    /// Réseau : Internet, VPN.
    NetWatch,
    /// Lanceur : le raccourci réservé suit le réglage.
    LauncherHotkey,
    /// Profils automatiques (heure, Wi-Fi).
    Profiles,
    /// Météo : « est-ce l'heure de redemander ? » (l'appel réseau reste à 30 min).
    Weather,
}

/// Le tableau des rythmes, en millisecondes : (haute, équilibrée, éco).
/// La colonne « équilibrée » est le comportement d'avant les modes.
///
/// Ce qui n'y est PAS, exprès : la souris pendant un appui (glisser de fichier,
/// déplacement de l'île) reste à 60 Hz dans tous les modes (`BUSY`), et les
/// attentes courtes d'une action en cours (capture, collage) ne changent pas.
pub const fn table(l: Loop) -> (u64, u64, u64) {
    match l {
        Loop::CursorMoving => (16, 16, 33),
        Loop::CursorStill => (16, 33, 33),
        Loop::CursorFar => (16, 33, 66),
        Loop::CursorHidden => (33, 50, 100),
        Loop::ScreenCheck => (500, 500, 1_000),
        Loop::Clipboard => (250, 400, 1_000),
        Loop::Media => (500, 1_000, 2_000),
        Loop::System => (1_000, 2_000, 5_000),
        Loop::SystemDisks => (30_000, 30_000, 60_000),
        Loop::Controls => (1_000, 2_000, 3_000),
        Loop::ShelfDownloads => (2_000, 3_000, 6_000),
        Loop::RulesWait => (250, 500, 1_000),
        Loop::RulesDrives => (1_000, 2_000, 5_000),
        Loop::AgendaFiles => (10_000, 15_000, 30_000),
        Loop::NetWatch => (3_000, 5_000, 15_000),
        Loop::LauncherHotkey => (1_000, 1_000, 3_000),
        Loop::Profiles => (30_000, 30_000, 60_000),
        Loop::Weather => (10_000, 10_000, 30_000),
    }
}

/// La souris pendant un appui : jamais ralentie (glisser de fichier, déplacement).
pub const BUSY: Duration = Duration::from_millis(16);

/// Le rythme d'une boucle dans un mode donné.
pub fn cadence(l: Loop, mode: Mode) -> Duration {
    let (high, balanced, eco) = table(l);
    Duration::from_millis(match mode {
        Mode::High => high,
        Mode::Balanced => balanced,
        Mode::Eco => eco,
    })
}

/// Le rythme d'une boucle dans le mode effectif actuel.
pub fn every(l: Loop) -> Duration {
    cadence(l, mode())
}

/// Le mode effectif, partagé par toutes les boucles (équilibré au démarrage).
static MODE: AtomicU8 = AtomicU8::new(1);
/// Le PC était-il sur batterie au dernier coup d'œil ?
static ON_BATTERY: AtomicU8 = AtomicU8::new(0);

pub fn mode() -> Mode {
    Mode::from_u8(MODE.load(Ordering::Relaxed))
}

/// Ce que le front reçoit (événement "perf-mode" et commande `perf_state`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfState {
    /// Le mode qui s'applique.
    pub mode: Mode,
    /// Le mode choisi dans les réglages.
    pub chosen: Mode,
    /// Le PC est sur batterie (débranché).
    pub on_battery: bool,
}

fn state_of(app: &AppHandle) -> PerfState {
    let (chosen, auto) = app
        .try_state::<crate::Shared>()
        .map(|s| {
            let g = &s.settings.locked().general;
            (g.perf_mode.clone(), g.eco_on_battery)
        })
        .unwrap_or_else(|| ("balanced".into(), true));
    let on_battery = ON_BATTERY.load(Ordering::Relaxed) == 1;
    PerfState { mode: effective(&chosen, auto, on_battery), chosen: Mode::parse(&chosen), on_battery }
}

/// Recalcule le mode effectif (réglages changés, ou secteur branché / débranché)
/// et prévient les fenêtres s'il a changé.
pub fn refresh(app: &AppHandle) {
    ON_BATTERY.store(platform::on_battery() as u8, Ordering::Relaxed);
    let state = state_of(app);
    let before = MODE.swap(state.mode.to_u8(), Ordering::Relaxed);
    if before != state.mode.to_u8() {
        log::info(format!("performances : mode {:?}{}", state.mode, if state.on_battery { " (sur batterie)" } else { "" }));
    }
    // Toujours envoyé : la page des réglages montre aussi « sur batterie ».
    let _ = app.emit("perf-mode", state);
}

/// Regarde toutes les 15 s si le PC est passé sur batterie ou sur secteur.
/// (GetSystemPowerStatus ne coûte presque rien.)
pub fn spawn_watch(app: AppHandle) {
    const POWER_CHECK: Duration = Duration::from_secs(15);
    refresh(&app);
    std::thread::spawn(move || {
        let mut last = platform::on_battery();
        loop {
            std::thread::sleep(POWER_CHECK);
            let now = platform::on_battery();
            if now != last {
                last = now;
                refresh(&app);
            }
        }
    });
}

/// Le mode actuel, pour le front au démarrage.
#[tauri::command]
pub fn perf_state(app: AppHandle) -> PerfState {
    state_of(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_mode() {
        assert_eq!(effective("balanced", true, false), Mode::Balanced);
        assert_eq!(effective("high", true, false), Mode::High);
        // Sur batterie avec la case cochée : éco, même en haute performance.
        assert_eq!(effective("high", true, true), Mode::Eco);
        assert_eq!(effective("balanced", true, true), Mode::Eco);
        // Case décochée : le choix tient, batterie ou pas.
        assert_eq!(effective("high", false, true), Mode::High);
        assert_eq!(effective("eco", false, false), Mode::Eco);
        // Valeur inconnue : équilibrée.
        assert_eq!(effective("turbo", false, false), Mode::Balanced);
    }

    #[test]
    fn mode_round_trip() {
        for m in [Mode::High, Mode::Balanced, Mode::Eco] {
            assert_eq!(Mode::from_u8(m.to_u8()), m);
        }
        assert_eq!(serde_json::to_value(Mode::Eco).unwrap(), "eco");
    }

    const ALL: [Loop; 18] = [
        Loop::CursorMoving,
        Loop::CursorStill,
        Loop::CursorFar,
        Loop::CursorHidden,
        Loop::ScreenCheck,
        Loop::Clipboard,
        Loop::Media,
        Loop::System,
        Loop::SystemDisks,
        Loop::Controls,
        Loop::ShelfDownloads,
        Loop::RulesWait,
        Loop::RulesDrives,
        Loop::AgendaFiles,
        Loop::NetWatch,
        Loop::LauncherHotkey,
        Loop::Profiles,
        Loop::Weather,
    ];

    #[test]
    fn table_is_ordered_and_prudent() {
        for l in ALL {
            let (high, balanced, eco) = table(l);
            // Haute ≤ équilibrée ≤ éco, jamais 0.
            assert!(high > 0 && high <= balanced && balanced <= eco, "{l:?}");
            // L'éco ralentit au plus 4 fois (rien ne doit casser).
            assert!(eco <= balanced * 4, "{l:?} trop lent en éco");
        }
    }

    #[test]
    fn balanced_is_the_old_behaviour() {
        let ms = |l| cadence(l, Mode::Balanced).as_millis();
        assert_eq!(ms(Loop::CursorMoving), 16);
        assert_eq!(ms(Loop::CursorStill), 33);
        assert_eq!(ms(Loop::CursorHidden), 50);
        assert_eq!(ms(Loop::Clipboard), 400);
        assert_eq!(ms(Loop::System), 2_000);
        assert_eq!(ms(Loop::Controls), 2_000);
        assert_eq!(ms(Loop::ShelfDownloads), 3_000);
        assert_eq!(ms(Loop::Media), 1_000);
    }

    #[test]
    fn high_keeps_the_mouse_at_60_hz_and_eco_slows_it() {
        for l in [Loop::CursorMoving, Loop::CursorStill, Loop::CursorFar] {
            assert_eq!(cadence(l, Mode::High), BUSY);
        }
        assert_eq!(cadence(Loop::CursorStill, Mode::Eco).as_millis(), 33); // ≈ 30 Hz
        assert_eq!(cadence(Loop::CursorFar, Mode::Eco).as_millis(), 66); // ≈ 15 Hz
    }
}
