// « Bureau propre » : cacher ou montrer les icônes du bureau d'un clic
// (onglet Contrôles), comme le menu du bureau « Affichage → Afficher les
// icônes du bureau ».
//
// La méthode propre : envoyer à la vue du bureau (fenêtre SHELLDLL_DefView,
// dans Progman, ou dans un WorkerW quand un fond d'écran animé ou le
// diaporama est actif) la commande que ce menu envoie lui-même
// (WM_COMMAND 0x7402). L'Explorateur bascule tout seul, rafraîchit le bureau
// et enregistre le choix (valeur HideIcons du registre) : c'est réversible,
// et Windows s'en souvient après un redémarrage, exactement comme avec le menu.
//
// Écrire HideIcons dans le registre ne suffirait pas : l'Explorateur ne le
// relit qu'à son redémarrage. Pour connaître l'état, on regarde si la liste
// des icônes (SysListView32 « FolderView ») est visible.
//
// Rien d'autre n'est touché : les fichiers du bureau restent où ils sont.

#[cfg(windows)]
mod imp {
    use ::windows::core::{w, BOOL, PCWSTR};
    use ::windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use ::windows::Win32::UI::WindowsAndMessaging::{EnumWindows, FindWindowExW, FindWindowW, IsWindowVisible, SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_COMMAND};

    /// L'identifiant de la commande « Afficher les icônes du bureau ».
    const TOGGLE_DESKTOP_ICONS: usize = 0x7402;

    /// La vue du bureau (SHELLDLL_DefView).
    fn defview() -> Option<HWND> {
        unsafe {
            if let Ok(progman) = FindWindowW(w!("Progman"), PCWSTR::null()) {
                if let Ok(view) = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
                    return Some(view);
                }
            }
            // Sinon, elle est dans un des WorkerW.
            let mut found = HWND::default();
            unsafe extern "system" fn each(hwnd: HWND, out: LPARAM) -> BOOL {
                if let Ok(view) = unsafe { FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), PCWSTR::null()) } {
                    unsafe { *(out.0 as *mut HWND) = view };
                    return BOOL(0); // trouvé : on arrête
                }
                BOOL(1)
            }
            let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut HWND as isize));
            (!found.is_invalid()).then_some(found)
        }
    }

    fn folder_view(view: HWND) -> Option<HWND> {
        unsafe { FindWindowExW(Some(view), None, w!("SysListView32"), w!("FolderView")) }.ok()
    }

    pub fn hidden() -> Option<bool> {
        let list = folder_view(defview()?)?;
        Some(!unsafe { IsWindowVisible(list) }.as_bool())
    }

    pub fn set_hidden(hide: bool) -> Result<bool, String> {
        let view = defview().ok_or("bureau introuvable (l'Explorateur est-il lancé ?)")?;
        if hidden() == Some(hide) {
            return Ok(hide);
        }
        // Délai maximum : un Explorateur figé ne bloque pas l'île.
        let r = unsafe { SendMessageTimeoutW(view, WM_COMMAND, WPARAM(TOGGLE_DESKTOP_ICONS), LPARAM(0), SMTO_ABORTIFHUNG, 2000, None) };
        if r.0 == 0 {
            return Err("l'Explorateur ne répond pas".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
        hidden().ok_or_else(|| "état du bureau inconnu".to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    /// Hors Windows : on ne sait pas.
    pub fn hidden() -> Option<bool> {
        None
    }

    pub fn set_hidden(_hide: bool) -> Result<bool, String> {
        Err("seulement sous Windows".into())
    }
}

pub use imp::{hidden, set_hidden};
