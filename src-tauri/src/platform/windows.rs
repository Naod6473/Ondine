// Windows : Win32 pour la fenêtre de l'île et la souris, %APPDATA% pour les fichiers.
//
// Plusieurs techniques viennent de Coucou (github.com/Louis-CFM/coucou, licence MIT),
// qui les a mises au point sur la même pile Tauri 2 + WebView2.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewWindow};

use ::windows::core::BOOL;
use ::windows::Win32::Foundation::{HWND, LPARAM, POINT};
use ::windows::Win32::System::Ole::RevokeDragDrop;
use ::windows::Win32::System::SystemInformation::GetLocalTime;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW,
    SetForegroundWindow, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use super::LocalTime;

// ── Dossiers ──────────────────────────────────────────────────────────────────

/// %APPDATA%\Island : les réglages.
pub fn config_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Island")
}

/// %LOCALAPPDATA%\Island : le journal.
pub fn local_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Island")
}

pub fn local_time() -> LocalTime {
    let t = unsafe { GetLocalTime() };
    LocalTime {
        year: t.wYear.into(),
        month: t.wMonth.into(),
        day: t.wDay.into(),
        hour: t.wHour.into(),
        minute: t.wMinute.into(),
        second: t.wSecond.into(),
    }
}

/// Ouvre un dossier dans l'Explorateur. Le chemin est passé comme argument
/// séparé, jamais à travers un shell.
pub fn reveal_folder(path: &std::path::Path) {
    let _ = Command::new("explorer").arg(path).spawn();
}

// ── Souris ────────────────────────────────────────────────────────────────────

/// Position de la souris en pixels physiques de l'écran.
pub fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

/// Vrai tant que le bouton gauche est enfoncé : le seul signal qu'un glisser
/// de fichier commence peut-être, avant qu'il n'atteigne la fenêtre.
pub fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

// ── Fenêtre de l'île ──────────────────────────────────────────────────────────

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// WS_EX_NOACTIVATE : un clic sur l'île ne prend pas le focus à l'appli en cours.
/// WS_EX_TOOLWINDOW : l'île n'apparaît pas dans Alt+Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// La fenêtre qui avait le focus avant que l'île ne le prenne (stockée comme
/// entier, car un HWND n'est pas partageable entre threads).
static PREVIOUS_FOREGROUND: Mutex<isize> = Mutex::new(0);

/// Autorise (ou non) l'île à prendre le focus, pour Échap et les champs texte.
/// En le rendant, on redonne le focus à la fenêtre qui l'avait avant.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        if activating {
            let fg = GetForegroundWindow();
            if fg != hwnd {
                *PREVIOUS_FOREGROUND.lock().unwrap() = fg.0 as isize;
            }
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
        if !activating {
            let prev = std::mem::take(&mut *PREVIOUS_FOREGROUND.lock().unwrap());
            if prev != 0 && GetForegroundWindow() == hwnd {
                let _ = SetForegroundWindow(HWND(prev as *mut _));
            }
        }
    }
}

/// Laisse les fichiers glissés atteindre l'appli.
///
/// wry installe sa cible de dépôt une seule fois, à la création du webview.
/// WebView2 crée ensuite `Chrome_RenderWidgetHostHWND` et y enregistre sa propre
/// cible, qui refuse tout (curseur « interdit »). La révoquer laisse OLE retomber
/// sur celle de wry, qui alimente les événements de glisser-déposer de Tauri.
/// Sans effet si c'est déjà fait : on la relance à chaque début de glisser possible.
pub fn unblock_webview_drops(app: &AppHandle) {
    for label in [crate::island::WINDOW_LABEL, "settings"] {
        let Some(win) = app.get_webview_window(label) else { continue };
        let Some(hwnd) = hwnd_of(&win) else { continue };
        // Les classes des fenêtres enfants rencontrées, pour le journal.
        let mut seen: Vec<String> = Vec::new();
        unsafe {
            let _ = EnumChildWindows(Some(hwnd), Some(revoke_render_widget), LPARAM(&mut seen as *mut Vec<String> as isize));
        }
        // Diagnostic (glisser-déposer) : une ligne dans le journal quand ce qu'on
        // trouve change, pas à chaque clic.
        let summary = format!("{label} : {}", seen.join(", "));
        let mut last = LAST_DROP_SUMMARY.lock().unwrap();
        if !last.contains(&summary) {
            crate::services::log::info(format!("glisser-déposer, fenêtres enfants de {summary}"));
            last.push(summary);
        }
    }
}

/// Ce que `unblock_webview_drops` a déjà écrit dans le journal.
static LAST_DROP_SUMMARY: Mutex<Vec<String>> = Mutex::new(Vec::new());

unsafe extern "system" fn revoke_render_widget(hwnd: HWND, seen: LPARAM) -> BOOL {
    let seen = unsafe { &mut *(seen.0 as *mut Vec<String>) };
    let mut name = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut name) };
    let class = String::from_utf16_lossy(&name[..len.max(0) as usize]);
    if class == "Chrome_RenderWidgetHostHWND" {
        let revoked = unsafe { RevokeDragDrop(hwnd) }.is_ok();
        seen.push(format!("{class} (cible WebView2 {})", if revoked { "retirée" } else { "déjà retirée" }));
    } else {
        seen.push(class);
    }
    true.into()
}
