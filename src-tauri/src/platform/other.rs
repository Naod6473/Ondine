// Hors Windows : juste de quoi compiler (vérifications sur Linux). L'île ne
// vise que Windows ; rien ici n'est censé fonctionner vraiment.

use std::path::PathBuf;

use tauri::{AppHandle, WebviewWindow};

use super::LocalTime;

fn base(var: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_dir() -> PathBuf {
    base("HOME").join(".config").join("island")
}

pub fn local_dir() -> PathBuf {
    base("HOME").join(".local").join("share").join("island")
}

pub fn local_time() -> LocalTime {
    // Heure UTC approximative : suffisant pour un environnement de test.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let day = secs % 86_400;
    LocalTime { year: 1970, month: 1, day: 1, hour: (day / 3600) as u32, minute: (day / 60 % 60) as u32, second: (day % 60) as u32 }
}

pub fn reveal_folder(_path: &std::path::Path) {}
pub fn cursor_physical() -> Option<(f64, f64)> {
    None
}
pub fn left_button_down() -> bool {
    false
}
pub fn make_non_activating(_win: &WebviewWindow) {}
pub fn set_activating(_win: &WebviewWindow, _activating: bool) {}
pub fn unblock_webview_drops(_app: &AppHandle) {}
pub fn is_elevated() -> bool {
    false
}
pub fn clipboard_sequence() -> u32 {
    0
}
pub fn clipboard_is_sensitive() -> bool {
    false
}
pub fn paste_into_previous(_app: &AppHandle) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}
