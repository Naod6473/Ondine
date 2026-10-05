// Hors Windows : juste de quoi compiler (vérifications sur Linux). L'île ne
// vise que Windows ; rien ici n'est censé fonctionner vraiment.

use std::path::PathBuf;

use tauri::{AppHandle, WebviewWindow};

use super::LocalTime;

fn base(var: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_dir() -> PathBuf {
    base("HOME").join(".config").join("ondine")
}

pub fn local_dir() -> PathBuf {
    base("HOME").join(".local").join("share").join("ondine")
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
pub fn copy_secret(_text: &str) -> Result<u32, String> {
    Err("disponible seulement sous Windows".into())
}
pub fn clear_clipboard_if(_seq: u32) -> bool {
    false
}
pub fn paste_into_previous(_app: &AppHandle) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}
pub fn launch_screen_snip() -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}
pub fn pictures_dir() -> Option<PathBuf> {
    Some(base("HOME").join("Pictures"))
}
pub fn downloads_dir() -> Option<PathBuf> {
    Some(base("HOME").join("Downloads"))
}
pub fn documents_dir() -> Option<PathBuf> {
    Some(base("HOME").join("Documents"))
}

pub fn spawn_console(_program: &str, _args: &[String], _dir: &std::path::Path) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

pub fn run_as_admin(_program: &str, _params: &str) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

pub fn home_dir() -> PathBuf {
    base("HOME")
}

#[derive(Debug, Clone, PartialEq)]
pub struct DriveInfo {
    pub root: String,
    pub label: String,
    pub removable: bool,
}

pub fn drives(_known: &[DriveInfo]) -> Vec<DriveInfo> {
    Vec::new()
}

pub fn wait_modifiers_released(_max: std::time::Duration) {}

pub fn shell_open(_target: &str) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

pub fn with_com<R>(f: impl FnOnce() -> R) -> R {
    f()
}

pub fn shortcut_target(_lnk: &std::path::Path) -> Option<PathBuf> {
    None
}

pub fn forget_previous_foreground() {}

#[derive(Debug, Clone)]
pub struct Battery {
    pub percent: Option<u8>,
    pub charging: bool,
    pub plugged: bool,
}

pub fn battery() -> Option<Battery> {
    None
}

pub fn ping(_ip: std::net::Ipv4Addr, _timeout_ms: u32) -> Result<Option<(u32, u8)>, String> {
    Err("disponible seulement sous Windows".into())
}

pub fn reverse_dns(_ip: std::net::Ipv4Addr) -> Option<String> {
    None
}

pub fn has_recycle_bin(_path: &std::path::Path) -> bool {
    true
}
pub fn find_program(_name: &str) -> Option<std::path::PathBuf> {
    None
}

pub fn serve_agents_pipe(_max: usize, _on_message: impl Fn(Vec<u8>, std::fs::File) + Send + Sync + 'static) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

pub fn send_agents_pipe(_bytes: &[u8]) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

pub fn request_agents_pipe(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    Err("disponible seulement sous Windows".into())
}

pub fn ancestor_pids(_max: usize) -> Vec<u32> {
    vec![]
}

pub fn own_console_window() -> isize {
    0
}

pub fn focus_agent_window(_hwnd: isize, _pids: &[u32]) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

pub fn pipe_client_alive(_file: &std::fs::File) -> bool {
    true
}

/// Hors Windows : pas d'ancienne installation à récupérer.
pub fn migrate_old_dirs() -> Vec<String> {
    Vec::new()
}

/// Hors Windows : pas de fond Mica.
pub fn supports_mica() -> bool {
    false
}

/// Hors Windows : on ne sait pas, on dit « personne n'est là depuis longtemps ».
pub fn idle_ms() -> u64 {
    u64::MAX / 2
}

pub fn presentation_busy() -> bool {
    false
}

pub fn user_window(_app: &AppHandle) -> Option<isize> {
    None
}
pub fn window_title(_h: isize) -> String {
    String::new()
}
pub fn is_topmost(_h: isize) -> bool {
    false
}
pub fn set_topmost(_h: isize, _on: bool) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}
