// Qui utilise le micro ou la caméra en ce moment ?
//
// Windows le note lui-même dans le registre, pour la page « Confidentialité »
// des Paramètres : sous
//   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone
// (et \webcam), chaque appli a une clé avec deux valeurs, LastUsedTimeStart et
// LastUsedTimeStop. Tant que l'appli se sert du périphérique, LastUsedTimeStop
// vaut 0. Les applis du Store sont directement là (« Microsoft.WindowsCamera_8wekyb3d8bbwe ») ;
// les autres sont sous « NonPackaged », avec leur chemin où « \ » devient « # »
// (« C:#Program Files#Zoom#bin#Zoom.exe »).
//
// On ne fait que LIRE le registre ; rien n'est écouté ni enregistré, et les noms
// d'applis ne vont pas dans le journal.

use serde::Serialize;

/// Les applis qui utilisent le micro et la caméra en ce moment (noms courts).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct MediaUse {
    pub mic: Vec<String>,
    pub cam: Vec<String>,
}

/// Le nom lisible d'une clé du registre : « Zoom » pour
/// « C:#Program Files#Zoom#bin#Zoom.exe », « WindowsCamera » pour
/// « Microsoft.WindowsCamera_8wekyb3d8bbwe ».
pub fn app_name(key: &str) -> String {
    if key.contains('#') {
        // Une appli « classique » : son chemin. On garde le nom du fichier sans .exe.
        let file = key.rsplit('#').next().unwrap_or(key);
        let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
        return stem.to_string();
    }
    // Une appli du Store : « Éditeur.Nom_identifiant ».
    let base = key.split('_').next().unwrap_or(key);
    base.rsplit('.').next().unwrap_or(base).to_string()
}

#[cfg(windows)]
mod imp {
    use super::{app_name, MediaUse};
    use ::windows::core::{HSTRING, PWSTR};
    use ::windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_QWORD,
    };

    const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

    /// Une clé ouverte, refermée toute seule à la fin (Drop).
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn open(parent: HKEY, path: &str) -> Option<Key> {
        let mut key = HKEY::default();
        let err = unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), None, KEY_READ, &mut key) };
        err.is_ok().then_some(Key(key))
    }

    /// Les noms des sous-clés.
    fn children(key: &Key) -> Vec<String> {
        let mut out = Vec::new();
        for index in 0.. {
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let err = unsafe { RegEnumKeyExW(key.0, index, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) };
            if err.is_err() {
                break; // plus de sous-clé (ou erreur) : on s'arrête
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        out
    }

    /// L'appli `sub` (sous `key`) se sert-elle du périphérique en ce moment ?
    fn in_use(key: &Key, sub: &str) -> bool {
        let read = |name: &str| -> Option<u64> {
            let mut value = 0u64;
            let mut size = 8u32;
            let err = unsafe {
                RegGetValueW(
                    key.0,
                    &HSTRING::from(sub),
                    &HSTRING::from(name),
                    RRF_RT_QWORD,
                    None,
                    Some(&mut value as *mut u64 as *mut _),
                    Some(&mut size),
                )
            };
            err.is_ok().then_some(value)
        };
        // Déjà utilisé au moins une fois (Start ≠ 0) et pas encore arrêté (Stop = 0).
        matches!((read("LastUsedTimeStart"), read("LastUsedTimeStop")), (Some(start), Some(0)) if start != 0)
    }

    fn users(capability: &str) -> Vec<String> {
        let mut names = Vec::new();
        let Some(root) = open(HKEY_CURRENT_USER, &format!(r"{BASE}\{capability}")) else { return names };
        for sub in children(&root) {
            if sub == "NonPackaged" {
                if let Some(np) = open(root.0, "NonPackaged") {
                    for app in children(&np) {
                        if in_use(&np, &app) {
                            names.push(app_name(&app));
                        }
                    }
                }
            } else if in_use(&root, &sub) {
                names.push(app_name(&sub));
            }
        }
        names.sort();
        names.dedup();
        names
    }

    pub fn current() -> MediaUse {
        MediaUse { mic: users("microphone"), cam: users("webcam") }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::MediaUse;
    pub fn current() -> MediaUse {
        MediaUse::default()
    }
}

pub use imp::current;

#[cfg(test)]
mod tests {
    use super::app_name;

    #[test]
    fn readable_app_names() {
        assert_eq!(app_name("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(app_name("C:#Users#simon#AppData#Local#Discord#app-1.0#Discord.exe"), "Discord");
        assert_eq!(app_name("Microsoft.WindowsCamera_8wekyb3d8bbwe"), "WindowsCamera");
        assert_eq!(app_name("MSTeams_8wekyb3d8bbwe"), "MSTeams");
    }
}
