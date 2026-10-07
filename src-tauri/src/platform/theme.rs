// Le mode sombre de Windows (Paramètres → Personnalisation → Couleurs →
// « Choisir votre mode »), depuis une pastille de l'onglet Contrôles.
//
// Windows le garde dans le registre de l'utilisateur :
//   HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize
//     AppsUseLightTheme     (les applis)                         1 = clair, 0 = sombre
//     SystemUsesLightTheme  (barre des tâches, menu Démarrer…)   1 = clair, 0 = sombre
// Une valeur absente vaut « clair » (c'est le réglage d'usine).
//
// Pour basculer, on écrit les deux valeurs, puis on prévient toutes les
// fenêtres que les couleurs ont changé (message WM_SETTINGCHANGE avec le
// texte « ImmersiveColorSet », comme le fait la page des Paramètres). Ce
// message part dans un thread à part : une appli figée ne bloque pas l'île.
//
// Rien d'autre n'est touché (fond d'écran, couleur d'accent…).

use serde::Serialize;

/// L'état du mode sombre.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Theme {
    /// Les applis ET la barre des tâches sont en sombre.
    pub dark: bool,
    /// L'un en sombre, l'autre en clair (le mode « Personnalisé » de Windows).
    pub mixed: bool,
}

/// L'état à partir des deux valeurs du registre (None = absente = clair).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn from_values(apps_light: Option<u32>, system_light: Option<u32>) -> Theme {
    let apps_dark = apps_light == Some(0);
    let system_dark = system_light == Some(0);
    Theme { dark: apps_dark && system_dark, mixed: apps_dark != system_dark }
}

#[cfg(windows)]
mod imp {
    use super::{from_values, Theme};
    use ::windows::core::{w, HSTRING, PCWSTR};
    use ::windows::Win32::Foundation::{LPARAM, WPARAM};
    use ::windows::Win32::System::Registry::{RegCloseKey, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_DWORD, RRF_RT_REG_DWORD};
    use ::windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    /// Une valeur DWORD (nombre) du registre, ou None si elle n'existe pas.
    fn read(name: &str) -> Option<u32> {
        let mut value = 0u32;
        let mut size = 4u32;
        let err = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(KEY),
                &HSTRING::from(name),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut _),
                Some(&mut size),
            )
        };
        err.is_ok().then_some(value)
    }

    pub fn get() -> Theme {
        from_values(read("AppsUseLightTheme"), read("SystemUsesLightTheme"))
    }

    pub fn set_dark(dark: bool) -> Result<(), String> {
        let mut key = HKEY::default();
        let err = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(KEY), None, KEY_SET_VALUE, &mut key) };
        if err.is_err() {
            return Err("Windows ne permet pas de changer le mode sombre ici".into());
        }
        // 1 = clair, 0 = sombre ; un DWORD, c'est 4 octets.
        let value: u32 = if dark { 0 } else { 1 };
        let bytes = value.to_le_bytes();
        let written = ["AppsUseLightTheme", "SystemUsesLightTheme"]
            .iter()
            .all(|name| unsafe { RegSetValueExW(key, &HSTRING::from(*name), None, REG_DWORD, Some(&bytes)) }.is_ok());
        unsafe {
            let _ = RegCloseKey(key);
        }
        if !written {
            return Err("Windows ne permet pas de changer le mode sombre ici".into());
        }
        // Prévenir les fenêtres ouvertes, sans attendre (une appli figée ne doit pas bloquer).
        std::thread::spawn(|| {
            let topic: PCWSTR = w!("ImmersiveColorSet");
            unsafe {
                // Au plus 200 ms par fenêtre ; une fenêtre figée est sautée (SMTO_ABORTIFHUNG).
                let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(topic.as_ptr() as isize), SMTO_ABORTIFHUNG, 200, None);
            }
        });
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Theme;
    pub fn get() -> Theme {
        Theme::default()
    }
    pub fn set_dark(_dark: bool) -> Result<(), String> {
        Err("disponible seulement sous Windows".into())
    }
}

/// Le mode sombre de Windows, tel qu'il est maintenant.
pub use imp::get;
/// Met Windows en sombre (true) ou en clair (false), applis et barre des tâches.
pub use imp::set_dark;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_only_when_both_are_dark() {
        assert_eq!(from_values(Some(0), Some(0)), Theme { dark: true, mixed: false });
        assert_eq!(from_values(Some(1), Some(1)), Theme { dark: false, mixed: false });
        // Valeurs absentes : clair (réglage d'usine).
        assert_eq!(from_values(None, None), Theme { dark: false, mixed: false });
        // Le réglage d'usine de Windows 10 : barre des tâches sombre, applis claires.
        assert_eq!(from_values(Some(1), Some(0)), Theme { dark: false, mixed: true });
        assert_eq!(from_values(Some(0), None), Theme { dark: false, mixed: true });
    }
}
