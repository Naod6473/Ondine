// Les logiciels installés, pour pré-cocher les cartes de l'assistant de
// premier lancement (src/core/setup.ts) : « VS Code est là → Développement ».
//
// Tout se passe sur le PC, rien n'est envoyé ni enregistré : on lit
//   - les noms des raccourcis des deux menus Démarrer (sans ouvrir les .lnk) ;
//   - les noms affichés (DisplayName) de la liste « Programmes et
//     fonctionnalités » du registre (clés Uninstall, machine et utilisateur) ;
//   - quelques exécutables connus dans le PATH (claude, codex, gemini, git…),
//     en regardant seulement si le fichier existe (aucun programme lancé).
// Puis on garde seulement les ids d'une liste FIXE (`APPS`) : le front ne voit
// jamais la liste des logiciels, juste « vscode », « spotify »…

use std::collections::BTreeSet;
use std::path::PathBuf;

/// Un logiciel connu : son id, et les noms qui le trahissent (en minuscules).
/// « =nom » : le nom entier (pour les noms courts, comme « Zoom ») ; sinon le
/// nom contient ce morceau.
const APPS: &[(&str, &[&str])] = &[
    // Développement et agents IA
    ("vscode", &["visual studio code"]),
    ("visualstudio", &["visual studio community", "visual studio professional", "visual studio enterprise", "=visual studio 2022"]),
    ("jetbrains", &["intellij", "pycharm", "webstorm", "rider", "clion", "goland", "phpstorm", "android studio"]),
    ("cursor", &["=cursor"]),
    ("claude", &["=claude"]),
    ("git", &["git bash", "git gui", "github desktop"]),
    ("docker", &["docker desktop"]),
    // Bureautique
    ("office", &["=word", "=excel", "=powerpoint", "=outlook", "=outlook (new)", "microsoft 365", "microsoft office", "libreoffice", "=thunderbird"]),
    ("pdf", &["adobe acrobat", "foxit pdf", "pdf-xchange"]),
    // Réunions
    ("teams", &["=teams", "microsoft teams"]),
    ("zoom", &["=zoom", "zoom workplace"]),
    ("webex", &["webex"]),
    ("slack", &["=slack"]),
    // Musique et création
    ("spotify", &["=spotify"]),
    ("deezer", &["=deezer"]),
    ("vlc", &["vlc media player"]),
    ("daw", &["audacity", "fl studio", "ableton live", "=reaper", "cubase", "bitwig"]),
    ("video", &["obs studio", "davinci resolve", "adobe premiere", "shotcut", "kdenlive"]),
    ("graphics", &["photoshop", "illustrator", "lightroom", "=gimp", "=krita", "=blender", "inkscape", "=figma", "affinity"]),
    // IT et support
    ("putty", &["putty", "kitty"]),
    ("winscp", &["winscp", "filezilla"]),
    ("remote", &["mremoteng", "remote desktop connection manager", "royal ts", "=anydesk", "teamviewer", "mobaxterm", "termius"]),
    ("wireshark", &["wireshark", "nmap", "zenmap", "advanced ip scanner"]),
    ("sysinternals", &["process explorer", "sysinternals", "=rufus"]),
    // Études
    ("study", &["=anki", "=zotero", "=obsidian", "geogebra", "mendeley", "=xmind", "=notion", "=matlab"]),
    ("onenote", &["=onenote"]),
];

/// Les exécutables cherchés dans le PATH, et l'id qu'ils trahissent.
const PROGRAMS: &[(&str, &str)] = &[("claude", "claude"), ("codex", "claude"), ("gemini", "claude"), ("git", "git"), ("code", "vscode")];

/// Les ids des logiciels reconnus parmi ces noms (sans doublon, triés).
pub fn match_names<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<&'static str> {
    let mut out = BTreeSet::new();
    for raw in names {
        let name = raw.trim().to_lowercase();
        if name.is_empty() {
            continue;
        }
        for (id, needles) in APPS {
            let hit = needles.iter().any(|n| match n.strip_prefix('=') {
                Some(whole) => name == whole,
                None => name.contains(n),
            });
            if hit {
                out.insert(*id);
            }
        }
    }
    out.into_iter().collect()
}

/// Les logiciels connus présents sur ce PC.
pub fn detect() -> Vec<String> {
    let mut names = start_menu_names();
    names.extend(imp::uninstall_names());
    let mut ids: BTreeSet<&'static str> = match_names(names.iter().map(String::as_str)).into_iter().collect();
    for (program, id) in PROGRAMS {
        if in_path(program) {
            ids.insert(id);
        }
    }
    ids.into_iter().map(String::from).collect()
}

/// Les noms des raccourcis des deux menus Démarrer (« Spotify.lnk » → « Spotify »).
fn start_menu_names() -> Vec<String> {
    let mut out = Vec::new();
    for var in ["ProgramData", "APPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            walk(&PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs"), 0, &mut out);
        }
    }
    out
}

fn walk(dir: &std::path::Path, depth: usize, out: &mut Vec<String>) {
    if depth > 3 || out.len() >= 2000 {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for item in read.flatten() {
        let path = item.path();
        let Ok(kind) = item.file_type() else { continue };
        if kind.is_dir() {
            walk(&path, depth + 1, out);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk") || e.eq_ignore_ascii_case("url")) {
            if let Some(stem) = path.file_stem() {
                out.push(stem.to_string_lossy().to_string());
            }
        }
    }
}

/// Le programme est-il dans un dossier du PATH ? On regarde seulement si le
/// fichier existe : rien n'est lancé.
fn in_path(program: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else { return false };
    std::env::split_paths(&path).take(200).any(|dir| {
        ["exe", "cmd"].iter().any(|ext| dir.join(format!("{program}.{ext}")).is_file())
    })
}

#[cfg(windows)]
mod imp {
    use ::windows::core::{HSTRING, PWSTR};
    use ::windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_SZ};

    const PATHS: &[&str] = &[r"Software\Microsoft\Windows\CurrentVersion\Uninstall", r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"];

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

    /// Le texte `name` de la sous-clé `sub` (DisplayName), s'il existe.
    fn text(key: &Key, sub: &str, name: &str) -> Option<String> {
        let mut buf = [0u16; 260];
        let mut size = (buf.len() * 2) as u32;
        let err = unsafe { RegGetValueW(key.0, &HSTRING::from(sub), &HSTRING::from(name), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut size)) };
        if err.is_err() {
            return None;
        }
        let len = (size as usize / 2).min(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]).trim_end_matches('\0').to_string())
    }

    /// Les noms affichés de « Programmes et fonctionnalités ».
    pub fn uninstall_names() -> Vec<String> {
        let mut out = Vec::new();
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            for path in PATHS {
                let Some(key) = open(root, path) else { continue };
                for index in 0..4000u32 {
                    let mut buf = [0u16; 256];
                    let mut len = buf.len() as u32;
                    let err = unsafe { RegEnumKeyExW(key.0, index, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) };
                    if err.is_err() {
                        break; // plus de sous-clé
                    }
                    let sub = String::from_utf16_lossy(&buf[..len as usize]);
                    if let Some(name) = text(&key, &sub, "DisplayName") {
                        out.push(name);
                    }
                }
            }
        }
        out
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn uninstall_names() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_names_give_their_ids() {
        let names = ["Visual Studio Code", "Spotify", "Microsoft Teams (work or school)", "Zoom", "PuTTY (64-bit)", "Word", "Anki", "Uninstall Foo", "Notepad++"];
        assert_eq!(match_names(names), ["office", "putty", "spotify", "study", "teams", "vscode", "zoom"]);
    }

    #[test]
    fn short_names_must_match_whole() {
        // « Zoom » seul, oui ; « Zoomit » (Sysinternals) ou « Word Viewer » ne sont pas Zoom / Word.
        assert_eq!(match_names(["ZoomIt"]), Vec::<&str>::new());
        assert_eq!(match_names(["Wordpad"]), Vec::<&str>::new());
        assert_eq!(match_names(["  zoom  "]), ["zoom"]);
        assert_eq!(match_names(["Cursor"]), ["cursor"]);
        assert_eq!(match_names(["Cursor Pro Max Helper"]), Vec::<&str>::new());
    }

    #[test]
    fn nothing_is_found_in_nothing() {
        assert!(match_names([""; 0]).is_empty());
        assert!(match_names(["", "   "]).is_empty());
    }
}
