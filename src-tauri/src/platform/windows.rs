// Windows : Win32 pour la fenêtre de l'île et la souris, %APPDATA% pour les fichiers.
//
// Plusieurs techniques viennent de Coucou (github.com/Louis-CFM/coucou, licence MIT),
// qui les a mises au point sur la même pile Tauri 2 + WebView2.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewWindow};

use ::windows::Win32::Foundation::{HWND, POINT};
use ::windows::Win32::System::SystemInformation::GetLocalTime;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetWindowLongPtrW,
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

/// Laisse les fichiers glissés atteindre l'île : pose notre propre cible de
/// dépôt sur la fenêtre intérieure du webview (voir drop_target.rs). Sans effet
/// si c'est déjà fait : on la relance à chaque début de glisser possible.
pub fn unblock_webview_drops(app: &AppHandle) {
    let Some(win) = app.get_webview_window(crate::island::WINDOW_LABEL) else { return };
    let Some(hwnd) = hwnd_of(&win) else { return };
    super::drop_target::install(app, hwnd, crate::island::WINDOW_LABEL);
}

/// L'appli tourne-t-elle « en tant qu'administrateur » ?
///
/// Important pour le glisser-déposer : Windows interdit de glisser un fichier
/// depuis une appli normale (l'Explorateur) vers une appli administrateur
/// (curseur 🚫). C'est le cas si `npm run tauri dev` est lancé depuis un
/// terminal ouvert « en tant qu'administrateur ».
pub fn is_elevated() -> bool {
    use ::windows::Win32::Foundation::{CloseHandle, HANDLE};
    use ::windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use ::windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut info = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut info as *mut TOKEN_ELEVATION as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && info.TokenIsElevated != 0
    }
}

