// Windows attend-il un redémarrage ? (onglet Système, rappel doux)
//
// Windows le note lui-même dans le registre, en créant une clé tant que le
// redémarrage n'est pas fait :
//   - HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired
//     (des mises à jour de Windows Update sont installées) ;
//   - HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending
//     (des composants de Windows : mises à jour, fonctionnalités ajoutées…).
// « Depuis quand » : la date de dernière écriture de la clé (RegQueryInfoKeyW).
//
// On ne fait que LIRE. (La valeur PendingFileRenameOperations, que certains
// outils regardent aussi, est remplie par beaucoup d'installateurs pour des
// détails sans importance : elle ferait croire à un redémarrage en attente
// presque tout le temps. On l'ignore.)
//
// Ondine ne redémarre JAMAIS le PC elle-même : elle ouvre seulement la page
// Windows Update des Paramètres.

use serde::Serialize;

/// L'état lu dans le registre.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebootState {
    pub pending: bool,
    /// Depuis quand (secondes depuis le 1er janvier 1970, UTC) ; 0 = inconnu.
    pub since_secs: u64,
    /// « updates » (Windows Update) et/ou « servicing » (composants de Windows).
    pub reasons: Vec<&'static str>,
}

/// Une date FILETIME de Windows (centaines de nanosecondes depuis le
/// 1er janvier 1601) → secondes depuis le 1er janvier 1970 (0 si avant).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn filetime_to_unix(ft: u64) -> u64 {
    // Entre 1601 et 1970 : 11 644 473 600 secondes.
    const EPOCH_DIFF: u64 = 116_444_736_000_000_000;
    ft.saturating_sub(EPOCH_DIFF) / 10_000_000
}

/// Assemble l'état à partir de ce qu'on a trouvé pour chaque clé :
/// (raison, Some(date ou 0) si la clé existe).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn combine(found: &[(&'static str, Option<u64>)]) -> RebootState {
    let present: Vec<(&'static str, u64)> = found.iter().filter_map(|(why, at)| at.map(|t| (*why, t))).collect();
    RebootState {
        pending: !present.is_empty(),
        // La plus ancienne des dates connues : c'est depuis là que Windows attend.
        since_secs: present.iter().map(|(_, t)| *t).filter(|t| *t > 0).min().unwrap_or(0),
        reasons: present.iter().map(|(why, _)| *why).collect(),
    }
}

#[cfg(windows)]
mod imp {
    use super::{combine, filetime_to_unix, RebootState};
    use ::windows::core::HSTRING;
    use ::windows::Win32::Foundation::{ERROR_ACCESS_DENIED, FILETIME};
    use ::windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryInfoKeyW, HKEY, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_WOW64_64KEY};

    const KEYS: [(&str, &str); 2] = [
        ("updates", r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"),
        ("servicing", r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"),
    ];

    /// La clé existe-t-elle ? Some(date de dernière écriture, 0 si illisible), None si absente.
    fn written_at(path: &str) -> Option<u64> {
        let mut key = HKEY::default();
        // Lecture seule, dans la vue 64 bits du registre.
        let err = unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, &HSTRING::from(path), None, KEY_QUERY_VALUE | KEY_WOW64_64KEY, &mut key) };
        if err == ERROR_ACCESS_DENIED {
            return Some(0); // elle existe, mais on n'a pas le droit d'en lire la date
        }
        if err.is_err() {
            return None; // absente : pas de redémarrage en attente pour cette raison
        }
        let mut ft = FILETIME::default();
        let read = unsafe { RegQueryInfoKeyW(key, None, None, None, None, None, None, None, None, None, None, Some(&mut ft as *mut FILETIME)) };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if read.is_err() {
            return Some(0);
        }
        Some(filetime_to_unix((u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime)))
    }

    pub fn pending() -> RebootState {
        let found: Vec<(&'static str, Option<u64>)> = KEYS.iter().map(|(why, path)| (*why, written_at(path))).collect();
        combine(&found)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::RebootState;
    pub fn pending() -> RebootState {
        RebootState::default()
    }
}

/// Windows attend-il un redémarrage, depuis quand et pourquoi ?
pub use imp::pending;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filetime_converts_to_unix_seconds() {
        // 2026-10-04 12:00:00 UTC = 1 791 115 200 s depuis 1970.
        let ft = (1_791_115_200u64 + 11_644_473_600) * 10_000_000;
        assert_eq!(filetime_to_unix(ft), 1_791_115_200);
        assert_eq!(filetime_to_unix(0), 0);
    }

    #[test]
    fn combine_keeps_the_oldest_date() {
        assert_eq!(combine(&[("updates", None), ("servicing", None)]), RebootState::default());
        let s = combine(&[("updates", Some(2_000)), ("servicing", Some(1_000))]);
        assert!(s.pending);
        assert_eq!(s.since_secs, 1_000);
        assert_eq!(s.reasons, vec!["updates", "servicing"]);
        // Date illisible (0) : ignorée s'il y en a une autre ; sinon « inconnue ».
        assert_eq!(combine(&[("updates", Some(0)), ("servicing", Some(1_500))]).since_secs, 1_500);
        let unknown = combine(&[("updates", None), ("servicing", Some(0))]);
        assert!(unknown.pending);
        assert_eq!(unknown.since_secs, 0);
        assert_eq!(unknown.reasons, vec!["servicing"]);
    }

    #[test]
    fn never_pending_outside_windows() {
        if cfg!(not(windows)) {
            assert!(!pending().pending);
        }
    }
}
