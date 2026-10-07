// Tout ce qui dépend du système d'exploitation, derrière un seul jeu de noms.
//
// Le reste de l'appli appelle `platform::…` et ne touche jamais Win32 directement.
// windows.rs est la vraie implémentation ; other.rs ne sert qu'à ce que le code
// compile ailleurs (vérifications sur Linux), il ne fait presque rien.

// Volume des haut-parleurs et du micro (Core Audio). Contient sa propre version Linux.
pub mod audio;
// Luminosité des écrans (portable : WMI ; externes : DDC/CI). Contient sa propre version Linux.
pub mod brightness;
// Wi-Fi, Bluetooth, mode avion (Windows.Devices.Radios). Contient sa propre version Linux.
pub mod radios;
// Internet joignable, VPN branchés (surveillance du module Réseau). Contient sa propre version Linux.
pub mod netwatch;
// Qui utilise le micro ou la caméra en ce moment (registre). Contient sa propre version Linux.
pub mod media_use;
// « En cours de lecture » (SMTC). Contient sa propre version Linux.
pub mod media;
// Lire le texte d'une image (OCR de Windows). Contient sa propre version Linux.
pub mod ocr;
// La pipette : choisir une couleur à l'écran. Contient sa propre version Linux.
pub mod picker;
// Le nom du Wi-Fi connecté (profils automatiques). Contient sa propre version Linux.
pub mod wifi;
// Glisser des fichiers de l'île vers l'Explorateur (Étagère). Contient sa propre version Linux.
pub mod drag_out;

#[cfg(windows)]
mod drop_target;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(not(windows))]
mod other;
#[cfg(not(windows))]
pub use self::other::*;

/// Date et heure locales, pour les lignes du journal et les noms d'export.
pub struct LocalTime {
    pub year: u32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

impl LocalTime {
    /// "2026-10-04 21:30:00"
    pub fn stamp(&self) -> String {
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }

    /// "20261004-213000", utilisable dans un nom de fichier.
    pub fn file_stamp(&self) -> String {
        format!(
            "{:04}{:02}{:02}-{:02}{:02}{:02}",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }
}

/// Deux chemins d'exécutable Windows désignent-ils le même fichier ? Sans
/// tenir compte des majuscules (Windows non plus), des `/` à la place des `\`
/// ni du préfixe `\\?\` des chemins longs. Sert au canal des agents : seul le
/// même exe qu'Ondine a le droit d'y parler.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn same_exe_path(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        let p = p.trim().replace('/', "\\");
        let p = p.strip_prefix(r"\\?\").unwrap_or(&p);
        p.to_lowercase()
    }
    let (a, b) = (norm(a), norm(b));
    !a.is_empty() && a == b
}

/// Une fenêtre principale visible, pour retrouver celle d'un agent.
#[cfg_attr(not(windows), allow(dead_code))]
pub struct AgentWindow {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
    /// Nom de l'exe en minuscules (« windowsterminal.exe »).
    pub exe: String,
}

/// Les terminaux connus : quand un seul est ouvert, c'est sûrement celui de l'agent.
const TERMINALS: [&str; 7] = ["windowsterminal.exe", "conhost.exe", "openconsole.exe", "mintty.exe", "wezterm-gui.exe", "alacritty.exe", "conemu64.exe"];

/// Quelle fenêtre faire passer devant pour une session d'agent ?
/// 1. celle d'un des programmes au-dessus du hook (`pids`, du plus proche au
///    plus lointain) ;
/// 2. sinon (chaîne coupée, par exemple par Git Bash), une fenêtre dont le
///    titre contient le nom du projet (VS Code, terminal renommé…) ;
/// 3. sinon, le seul terminal ouvert, s'il n'y en a qu'un.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn pick_agent_window(windows: &[AgentWindow], pids: &[u32], project: &str) -> Option<isize> {
    if let Some(w) = pids.iter().find_map(|p| windows.iter().find(|w| w.pid == *p)) {
        return Some(w.hwnd);
    }
    let project = project.trim().to_lowercase();
    if project.chars().count() >= 3 {
        let mut by_title = windows.iter().filter(|w| w.title.to_lowercase().contains(&project));
        if let (Some(w), None) = (by_title.next(), by_title.next()) {
            return Some(w.hwnd);
        }
    }
    let mut terminals = windows.iter().filter(|w| TERMINALS.contains(&w.exe.as_str()));
    match (terminals.next(), terminals.next()) {
        (Some(w), None) => Some(w.hwnd),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{pick_agent_window, same_exe_path, AgentWindow};

    #[test]
    fn exe_paths_compare_like_windows() {
        let own = r"C:\Users\Simon\AppData\Local\Ondine\ondine.exe";
        assert!(same_exe_path(own, r"c:\users\simon\appdata\local\ondine\Ondine.EXE"));
        assert!(same_exe_path(own, r"\\?\C:\Users\Simon\AppData\Local\Ondine\ondine.exe"));
        assert!(same_exe_path(own, "C:/Users/Simon/AppData/Local/Ondine/ondine.exe"));
        // Un autre programme, ou un ondine.exe copié ailleurs : refusé.
        assert!(!same_exe_path(own, r"C:\Users\Simon\Downloads\ondine.exe"));
        assert!(!same_exe_path(own, r"C:\Windows\System32\cmd.exe"));
        assert!(!same_exe_path("", ""));
    }

    fn win(hwnd: isize, pid: u32, title: &str, exe: &str) -> AgentWindow {
        AgentWindow { hwnd, pid, title: title.into(), exe: exe.into() }
    }

    #[test]
    fn agent_window_by_pid_then_title_then_lone_terminal() {
        let list = [win(1, 10, "ondine — Visual Studio Code", "code.exe"), win(2, 20, "✳ Claude Code", "windowsterminal.exe"), win(3, 30, "Courrier", "outlook.exe")];
        // Le programme le plus proche d'abord.
        assert_eq!(pick_agent_window(&list, &[99, 20, 10], "ondine"), Some(2));
        // Chaîne coupée : le titre qui contient le projet.
        assert_eq!(pick_agent_window(&list, &[99], "Ondine"), Some(1));
        // Ni l'un ni l'autre : le seul terminal ouvert.
        assert_eq!(pick_agent_window(&list, &[], "autre-projet"), Some(2));
        // Deux terminaux : on ne devine pas.
        let two = [win(2, 20, "a", "windowsterminal.exe"), win(4, 40, "b", "mintty.exe")];
        assert_eq!(pick_agent_window(&two, &[], "x"), None);
        // Deux fenêtres au titre ambigu : on passe au terminal unique.
        let amb = [win(1, 10, "app — code", "code.exe"), win(5, 50, "app.txt", "notepad.exe"), win(2, 20, "z", "windowsterminal.exe")];
        assert_eq!(pick_agent_window(&amb, &[], "app"), Some(2));
    }
}
