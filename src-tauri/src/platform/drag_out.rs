// Glisser des fichiers DEPUIS l'île vers l'Explorateur, le Bureau ou une autre
// appli (le sens inverse de drop_target.rs).
//
// C'est un vrai glisser-déposer de Windows : on fabrique un « objet de données »
// du Shell qui contient les fichiers (le même que celui de l'Explorateur, avec
// CF_HDROP et les formats du Shell), puis SHDoDragDrop s'occupe de tout le
// reste : l'image qui suit la souris, Échap pour annuler, et les touches.
// C'est la CIBLE (l'Explorateur…) qui choisit de copier ou de déplacer, comme
// d'habitude sous Windows :
//   - même disque → déplacer ; autre disque → copier ;
//   - Ctrl → copier ; Maj → déplacer ; Ctrl+Maj (ou Alt) → raccourci.
// Ondine ne copie, ne déplace et ne supprime donc rien elle-même pendant un
// glisser : c'est l'Explorateur qui le fait (et son propre Ctrl+Z l'annule).
//
// Pourquoi pas le crate `drag` (celui de tauri-plugin-drag) : il tire sa propre
// version du crate `windows` et des dépendances d'images, alors qu'ici trois
// fonctions du Shell suffisent (ILCreateFromPathW, SHCreateDataObject,
// SHDoDragDrop), toutes déjà dans `windows` 0.61.
//
// Pendant le glisser, `active()` est vrai : la boucle de souris de l'île
// (island/mod.rs) laisse alors passer la souris partout sauf sur l'île, et
// n'envoie plus la position au front (l'île ne se replie pas) ; et la cible de
// dépôt de l'île (drop_target.rs) refuse ce qui vient d'elle-même.

use std::sync::atomic::{AtomicBool, Ordering};

/// Vrai pendant qu'un glisser vers l'extérieur est en cours.
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Un glisser vers l'extérieur est-il en cours ?
pub fn active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

/// Remet `ACTIVE` à faux quand le glisser est fini, même après une erreur.
#[cfg_attr(not(windows), allow(dead_code))]
struct ActiveGuard;

impl ActiveGuard {
    /// None si un glisser est déjà en cours.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn take() -> Option<ActiveGuard> {
        ACTIVE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed).ok().map(|_| ActiveGuard)
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::Release);
    }
}

/// Ce que la cible a fait des fichiers, d'après le code DROPEFFECT de Windows
/// (1 = copie, 2 = déplacement, 4 = raccourci, 0 = rien ou annulé).
///
/// Attention : pour un déplacement sur le même disque, l'Explorateur répond
/// souvent « rien » (il a déplacé lui-même, c'est un « déplacement optimisé »).
/// Le seul indice fiable est donc : le fichier est-il encore là ?
pub fn effect_name(effect: u32) -> &'static str {
    if effect & 2 != 0 {
        "move"
    } else if effect & 1 != 0 {
        "copy"
    } else if effect & 4 != 0 {
        "link"
    } else {
        "none"
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;
    use std::sync::mpsc;

    use ::windows::core::{implement, BOOL, HRESULT, PCWSTR};
    use ::windows::Win32::Foundation::{DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HWND, S_OK};
    use ::windows::Win32::System::Ole::{IDropSource_Impl, DROPEFFECT};
    use ::windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
    use ::windows::Win32::System::Com::IDataObject;
    use ::windows::Win32::System::Ole::{IDropSource, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE};
    use ::windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use ::windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHCreateDataObject, SHDoDragDrop};
    use tauri::{AppHandle, Manager};

    use super::ActiveGuard;
    use crate::services::log;

    /// Lance le glisser de ces fichiers et attend qu'il soit fini (fichiers
    /// lâchés quelque part, ou annulé). Renvoie le code DROPEFFECT.
    /// À appeler HORS du thread principal : le glisser lui-même y est envoyé
    /// (OLE l'exige), et on attend sa fin ici.
    pub fn drag_files(app: &AppHandle, paths: &[PathBuf]) -> Result<u32, String> {
        if paths.is_empty() {
            return Err("aucun fichier".into());
        }
        // Le bouton a déjà été relâché (clic très rapide) : rien à glisser.
        if !super::super::left_button_down() {
            return Ok(0);
        }
        let guard = ActiveGuard::take().ok_or("un glisser est déjà en cours")?;
        let (tx, rx) = mpsc::channel();
        let (handle, paths) = (app.clone(), paths.to_vec());
        app.run_on_main_thread(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&handle, &paths)))
                .unwrap_or_else(|_| Err("le glisser a planté".into()));
            let _ = tx.send(result);
        })
        .map_err(|e| format!("glisser impossible : {e}"))?;
        let result = rx.recv().map_err(|_| "glisser interrompu".to_string())?;
        drop(guard);
        result
    }

    /// Sur le thread principal : l'objet de données du Shell, puis SHDoDragDrop.
    fn run(app: &AppHandle, paths: &[PathBuf]) -> Result<u32, String> {
        // Un « PIDL » absolu par fichier (l'identifiant du Shell pour un chemin).
        let mut pidls: Vec<*const ITEMIDLIST> = Vec::new();
        for p in paths {
            let wide: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
            let pidl = unsafe { ILCreateFromPathW(PCWSTR(wide.as_ptr())) };
            if pidl.is_null() {
                free(&pidls);
                return Err(format!("{} : introuvable pour Windows", p.display()));
            }
            pidls.push(pidl as *const _);
        }
        // Dossier parent « aucun » = le Bureau, racine du Shell : les PIDL absolus
        // s'y rattachent, même si les fichiers viennent de dossiers différents.
        let data: Result<IDataObject, _> = unsafe { SHCreateDataObject(None, Some(&pidls), None) };
        free(&pidls);
        let data = data.map_err(|e| format!("objet de glisser impossible : {e}"))?;

        let hwnd = app
            .get_webview_window(crate::island::WINDOW_LABEL)
            .and_then(|w| w.hwnd().ok())
            .map(|h| HWND(h.0 as isize as *mut _));
        log::info(format!("glisser vers l'extérieur : {} élément(s)", paths.len()));
        let source: IDropSource = DropSource.into();
        let effect = unsafe { SHDoDragDrop(hwnd, &data, &source, DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK) }
            .map_err(|e| format!("glisser impossible : {e}"))?;
        Ok(effect.0)
    }

    /// La « source » du glisser : Windows lui demande sans cesse s'il faut
    /// continuer. Échap → annuler ; bouton gauche relâché → lâcher ici.
    #[implement(IDropSource)]
    struct DropSource;

    #[allow(non_snake_case)]
    impl IDropSource_Impl for DropSource_Impl {
        fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
            if escape.as_bool() {
                DRAGDROP_S_CANCEL
            } else if keys.0 & MK_LBUTTON.0 == 0 {
                DRAGDROP_S_DROP
            } else {
                S_OK
            }
        }

        fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
            // Les curseurs habituels de Windows (copier, déplacer, raccourci, 🚫).
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    fn free(pidls: &[*const ITEMIDLIST]) {
        for p in pidls {
            unsafe { ILFree(Some(*p)) };
        }
    }
}

#[cfg(windows)]
pub use imp::drag_files;

/// Hors de Windows : pas de glisser vers l'extérieur.
#[cfg(not(windows))]
pub fn drag_files(_app: &tauri::AppHandle, _paths: &[std::path::PathBuf]) -> Result<u32, String> {
    Err("glisser vers l'extérieur : disponible seulement sous Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_names() {
        assert_eq!(effect_name(0), "none");
        assert_eq!(effect_name(1), "copy");
        assert_eq!(effect_name(2), "move");
        assert_eq!(effect_name(3), "move");
        assert_eq!(effect_name(4), "link");
    }

    #[test]
    fn only_one_drag_at_a_time() {
        let first = ActiveGuard::take();
        assert!(first.is_some() && active());
        assert!(ActiveGuard::take().is_none());
        drop(first);
        assert!(!active());
    }
}
