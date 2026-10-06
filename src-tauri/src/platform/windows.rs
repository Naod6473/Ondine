// Windows : Win32 pour la fenêtre de l'île et la souris, %APPDATA% pour les fichiers.
//
// Plusieurs techniques viennent de Coucou (github.com/Louis-CFM/coucou, licence MIT),
// qui les a mises au point sur la même pile Tauri 2 + WebView2.

use crate::sync::LockExt;
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

/// Le dossier `name` dans %APPDATA% ou %LOCALAPPDATA%.
fn app_dir(var: &str, name: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(".")).join(name)
}

/// %APPDATA%\Ondine : les réglages.
pub fn config_dir() -> PathBuf {
    app_dir("APPDATA", "Ondine")
}

/// %LOCALAPPDATA%\Ondine : le journal.
pub fn local_dir() -> PathBuf {
    app_dir("LOCALAPPDATA", "Ondine")
}

/// L'appli s'appelait « Island » : au premier lancement d'Ondine, on renomme
/// ses anciens dossiers (réglages, notes, favoris, journal) pour ne rien perdre.
/// Rien n'est supprimé ; si « Ondine » existe déjà, on ne touche à rien.
/// Renvoie ce qui s'est passé, pour le journal (qui n'est pas encore ouvert).
pub fn migrate_old_dirs() -> Vec<String> {
    let mut done = Vec::new();
    for var in ["APPDATA", "LOCALAPPDATA"] {
        let (old, new) = (app_dir(var, "Island"), app_dir(var, "Ondine"));
        if old.is_dir() && !new.exists() {
            match std::fs::rename(&old, &new) {
                Ok(()) => done.push(format!("dossier %{var}%\\Island renommé en Ondine")),
                Err(e) => done.push(format!("dossier %{var}%\\Island non renommé : {e}")),
            }
        }
    }
    done
}

/// Windows 11 (build 22000 ou plus) : le seul à savoir peindre le fond Mica.
pub fn supports_mica() -> bool {
    sysinfo::System::kernel_version().and_then(|b| b.trim().parse::<u32>().ok()).is_some_and(|build| build >= 22000)
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

/// La langue de l'interface quand le réglage vaut « auto » : celle choisie dans
/// l'installateur (il l'écrit dans HKCU\Software\Ondine, voir
/// windows/hooks.nsh), sinon celle de Windows. "fr" ou "en".
pub fn system_language() -> &'static str {
    use ::windows::core::HSTRING;
    use ::windows::Win32::Globalization::GetUserDefaultUILanguage;
    use ::windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    // LANGID de l'installateur, en texte (ex. « 1036 » = français, « 1033 » = anglais).
    let mut buf = [0u16; 16];
    let mut size = (buf.len() * 2) as u32;
    let found = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from(r"Software\Ondine"),
            &HSTRING::from("InstallLanguage"),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    }
    .is_ok();
    let langid: u16 = if found {
        let text = String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]);
        text.trim().parse().unwrap_or(0)
    } else {
        unsafe { GetUserDefaultUILanguage() }
    };
    // Les 10 bits du bas = la langue principale ; 0x0C = français (France, Belgique, Canada, Suisse…).
    if langid & 0x3ff == 0x0c { "fr" } else { "en" }
}

/// Depuis combien de millisecondes personne n'a touché ni la souris ni le clavier.
pub fn idle_ms() -> u64 {
    use ::windows::Win32::System::SystemInformation::GetTickCount;
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return 0;
    }
    // Les deux compteurs tournent sur 32 bits : wrapping_sub gère le passage par zéro.
    unsafe { GetTickCount() }.wrapping_sub(info.dwTime) as u64
}

/// Vrai pendant une présentation ou une appli en plein écran (jeu, vidéo,
/// diaporama PowerPoint) : Windows lui-même retient alors ses notifications.
pub fn presentation_busy() -> bool {
    use ::windows::Win32::UI::Shell::SHQueryUserNotificationState;
    // 2 = appli plein écran, 3 = Direct3D plein écran, 4 = mode présentation.
    matches!(unsafe { SHQueryUserNotificationState() }.map(|s| s.0), Ok(2..=4))
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
                *PREVIOUS_FOREGROUND.locked() = fg.0 as isize;
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
            let prev = std::mem::take(&mut *PREVIOUS_FOREGROUND.locked());
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


// ── Presse-papiers ────────────────────────────────────────────────────────────

/// Numéro qui change à chaque nouvelle copie (n'importe quelle appli).
/// Le lire ne touche pas au contenu du presse-papiers.
pub fn clipboard_sequence() -> u32 {
    unsafe { ::windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

/// Met un SECRET (mot de passe généré) dans le presse-papiers, marqué comme
/// le font les gestionnaires de mots de passe : pas d'historique Windows
/// (Win+V), pas de synchro dans le cloud, ignoré par les outils de surveillance
/// (dont le nôtre). Renvoie le numéro de copie, pour l'effacer plus tard.
pub fn copy_secret(text: &str) -> Result<u32, String> {
    use ::windows::core::w;
    use ::windows::Win32::Foundation::HANDLE;
    use ::windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use ::windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use ::windows::Win32::System::Ole::CF_UNICODETEXT;

    /// Copie des octets dans un bloc mémoire que le presse-papiers gardera.
    unsafe fn block(bytes: &[u8]) -> Result<HANDLE, String> {
        let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.to_string())?;
        let ptr = GlobalLock(mem) as *mut u8;
        if ptr.is_null() {
            return Err("mémoire indisponible".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(mem);
        Ok(HANDLE(mem.0))
    }

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let text_bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
    let zero = 0u32.to_le_bytes();
    unsafe {
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            return Err("le presse-papiers est occupé, réessaie".into());
        }
        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| e.to_string())?;
            // Les marques « ne pas garder » d'abord, le texte ensuite.
            for name in [w!("ExcludeClipboardContentFromMonitorProcessing"), w!("CanIncludeInClipboardHistory"), w!("CanUploadToCloudClipboard")] {
                let format = RegisterClipboardFormatW(name);
                if format != 0 {
                    SetClipboardData(format, Some(block(&zero)?)).map_err(|e| e.to_string())?;
                }
            }
            SetClipboardData(CF_UNICODETEXT.0 as u32, Some(block(&text_bytes)?)).map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = CloseClipboard();
        result?;
    }
    Ok(clipboard_sequence())
}

/// Vide le presse-papiers s'il contient encore la copie numéro `seq` (rien
/// n'a été copié depuis) : le mot de passe ne traîne pas.
pub fn clear_clipboard_if(seq: u32) -> bool {
    use ::windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
    if clipboard_sequence() != seq {
        return false;
    }
    unsafe {
        if OpenClipboard(None).is_err() {
            return false;
        }
        let ok = EmptyClipboard().is_ok();
        let _ = CloseClipboard();
        ok
    }
}

/// La copie actuelle est-elle marquée « sensible » par l'appli qui l'a faite ?
///
/// Les gestionnaires de mots de passe (KeePass, Bitwarden, 1Password…) ajoutent
/// à leurs copies des formats convenus avec Windows pour dire « ne pas garder » :
///   - `ExcludeClipboardContentFromMonitorProcessing` : ne pas surveiller du tout ;
///   - `Clipboard Viewer Ignore` : ancienne convention, même sens ;
///   - `CanIncludeInClipboardHistory` = 0 : ne pas mettre dans l'historique.
/// Dans le doute (presse-papiers occupé), on répond « sensible » : mieux vaut
/// rater une copie que garder un mot de passe.
pub fn clipboard_is_sensitive() -> bool {
    use ::windows::core::w;
    use ::windows::Win32::Foundation::HGLOBAL;
    use ::windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    };
    use ::windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    unsafe {
        for name in [w!("ExcludeClipboardContentFromMonitorProcessing"), w!("Clipboard Viewer Ignore")] {
            let format = RegisterClipboardFormatW(name);
            if format != 0 && IsClipboardFormatAvailable(format).is_ok() {
                return true;
            }
        }
        let format = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        if format == 0 || IsClipboardFormatAvailable(format).is_err() {
            return false;
        }
        // Le format est là : il faut lire sa valeur (un nombre de 4 octets).
        // Le presse-papiers peut être occupé un court instant par une autre appli.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            return true;
        }
        let mut allowed = false;
        if let Ok(handle) = GetClipboardData(format) {
            let global = HGLOBAL(handle.0);
            let ptr = GlobalLock(global) as *const u32;
            if !ptr.is_null() && GlobalSize(global) >= 4 {
                allowed = *ptr != 0;
            }
            let _ = GlobalUnlock(global);
        }
        let _ = CloseClipboard();
        !allowed
    }
}

/// Rend la main à la fenêtre qui l'avait avant l'île, puis y colle (Ctrl+V).
///
/// Le texte doit déjà être dans le presse-papiers. On simule seulement l'appui
/// sur Ctrl+V, exactement comme si tu le tapais.
pub fn paste_into_previous(app: &AppHandle) -> Result<(), String> {
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL, VK_V,
    };
    let island = app.get_webview_window(crate::island::WINDOW_LABEL).and_then(|w| {
        let hwnd = hwnd_of(&w);
        // L'île ne garde plus le clavier : la fenêtre d'avant le reprend.
        set_activating(&w, false);
        hwnd
    });
    // Laisse à Windows le temps de redonner le clavier à l'autre fenêtre.
    std::thread::sleep(std::time::Duration::from_millis(150));
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() || Some(foreground) == island {
        return Err("aucune fenêtre où coller".into());
    }
    let key = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    };
    let inputs = [
        key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
        key(VK_V, KEYBD_EVENT_FLAGS(0)),
        key(VK_V, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows a refusé la frappe simulée".into())
    }
}

// ── Captures d'écran ──────────────────────────────────────────────────────────

/// Ouvre l'outil de capture de Windows (le même que Win+Maj+S). L'image choisie
/// arrive dans le presse-papiers. L'adresse `ms-screenclip:` est fixe : on
/// n'ouvre jamais une adresse venue d'un fichier ou d'une page.
pub fn launch_screen_snip() -> Result<(), String> {
    use ::windows::core::w;
    use ::windows::Win32::UI::Shell::ShellExecuteW;
    use ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let result = unsafe { ShellExecuteW(None, w!("open"), w!("ms-screenclip:"), None, None, SW_SHOWNORMAL) };
    // Windows : une valeur supérieure à 32 veut dire « réussi ».
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("l'outil Capture d'écran ne s'ouvre pas (code {})", result.0 as isize))
    }
}

/// Le dossier « Images » de l'utilisateur (même s'il est déplacé dans OneDrive).
pub fn pictures_dir() -> Option<PathBuf> {
    use ::windows::Win32::System::Com::CoTaskMemFree;
    use ::windows::Win32::UI::Shell::{FOLDERID_Pictures, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let raw = SHGetKnownFolderPath(&FOLDERID_Pictures, KF_FLAG_DEFAULT, None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(raw.0 as *const _));
        path
    }
}

/// Le dossier « Téléchargements » de l'utilisateur.
pub fn downloads_dir() -> Option<PathBuf> {
    use ::windows::Win32::System::Com::CoTaskMemFree;
    use ::windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let raw = SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(raw.0 as *const _));
        path
    }
}

/// Le dossier « Documents » de l'utilisateur (même s'il est déplacé dans OneDrive).
pub fn documents_dir() -> Option<PathBuf> {
    use ::windows::Win32::System::Com::CoTaskMemFree;
    use ::windows::Win32::UI::Shell::{FOLDERID_Documents, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let raw = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(raw.0 as *const _));
        path
    }
}

/// Ouvre un programme console (cmd, PowerShell…) dans SA PROPRE fenêtre,
/// dans le dossier `dir`. Utilisé par le module Terminal.
pub fn spawn_console(program: &str, args: &[String], dir: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // CREATE_NEW_CONSOLE : une nouvelle fenêtre de console, détachée de l'île.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    std::process::Command::new(program)
        .args(args)
        .current_dir(dir)
        // cmd.exe ne cherchera pas les programmes dans le dossier ouvert (un
        // « claude.cmd » piégé dans un projet ne doit jamais être lancé).
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => format!("{program} n'est pas installé sur ce PC"),
            _ => format!("{program} ne s'ouvre pas : {e}"),
        })
}

/// Le chemin complet d'un programme installé (« claude » → …\npm\claude.cmd),
/// cherché dans le PATH seulement : `where.exe` tourne depuis le dossier
/// système, jamais depuis un dossier de projet. `None` s'il n'est pas installé.
pub fn find_program(name: &str) -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let system = std::env::var("SystemRoot").map(|r| PathBuf::from(r).join("System32")).ok()?;
    let out = Command::new(system.join("where.exe"))
        .arg(name)
        .current_dir(&system)
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // Plusieurs réponses possibles (claude, claude.cmd, claude.ps1…) : la
    // première que cmd sait lancer.
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| PathBuf::from(l.trim()))
        .find(|p| {
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            p.is_absolute() && matches!(ext.as_str(), "exe" | "cmd" | "bat" | "com") && p.is_file()
        })
}

/// Ouvre un programme EN ADMINISTRATEUR : Windows affiche sa fenêtre de
/// confirmation (UAC). `params` = la ligne de paramètres, déjà prête.
pub fn run_as_admin(program: &str, params: &str) -> Result<(), String> {
    use ::windows::core::{w, HSTRING};
    use ::windows::Win32::UI::Shell::ShellExecuteW;
    use ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let (file, params) = (HSTRING::from(program), HSTRING::from(params));
    let result = unsafe { ShellExecuteW(None, w!("runas"), &file, &params, None, SW_SHOWNORMAL) };
    match result.0 as isize {
        r if r > 32 => Ok(()),
        // 5 = accès refusé : en général, on a cliqué « Non » dans la fenêtre UAC.
        5 => Err("ouverture en administrateur annulée".into()),
        2 | 3 => Err(format!("{program} n'est pas installé sur ce PC")),
        r => Err(format!("{program} ne s'ouvre pas en administrateur (code {r})")),
    }
}

/// Le dossier de l'utilisateur (C:\Users\<nom>).
pub fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\"))
}

/// Un lecteur (C:\, E:\…) tel que vu par les règles « clé USB branchée ».
#[derive(Debug, Clone, PartialEq)]
pub struct DriveInfo {
    /// "E:\\"
    pub root: String,
    /// Le nom du volume (« KINGSTON »), vide s'il n'en a pas.
    pub label: String,
    /// Clé USB, carte SD… (lecteur amovible). Un disque USB peut aussi se
    /// présenter comme « fixe » : les règles ne filtrent pas là-dessus.
    pub removable: bool,
}

/// Les lecteurs présents. `known` : ceux déjà vus, pour ne demander le nom
/// du volume (lent sur un lecteur vide) qu'aux nouveaux.
pub fn drives(known: &[DriveInfo]) -> Vec<DriveInfo> {
    use ::windows::core::HSTRING;
    use ::windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};
    use ::windows::Win32::System::Diagnostics::Debug::{SetThreadErrorMode, SEM_FAILCRITICALERRORS};

    // Un lecteur de cartes vide ne doit pas ouvrir la fenêtre « Insérez un disque ».
    unsafe {
        let _ = SetThreadErrorMode(SEM_FAILCRITICALERRORS, None);
    }
    let mask = unsafe { GetLogicalDrives() };
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let root = format!("{}:\\", (b'A' + i as u8) as char);
        if let Some(k) = known.iter().find(|d| d.root == root) {
            out.push(k.clone());
            continue;
        }
        let wide = HSTRING::from(root.as_str());
        // 2 = amovible, 3 = disque fixe ; on ignore le réseau (4), les CD (5)…
        let kind = unsafe { GetDriveTypeW(&wide) };
        if kind != 2 && kind != 3 {
            continue;
        }
        let mut name = [0u16; 261];
        // Pas de média (lecteur de cartes vide) : on l'ignore.
        if unsafe { GetVolumeInformationW(&wide, Some(&mut name), None, None, None, None) }.is_err() {
            continue;
        }
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        out.push(DriveInfo { root, label: String::from_utf16_lossy(&name[..len]), removable: kind == 2 });
    }
    out
}

/// Ce chemin est-il sur un lecteur qui a une Corbeille ? Windows n'en a que
/// sur les disques fixes : une clé USB (amovible), un partage réseau, un CD ou
/// un disque en mémoire n'en ont pas, et « supprimer » y serait définitif.
/// (Un disque fixe dont la Corbeille est désactivée ou pleine : Windows
/// affiche lui-même un avertissement avant toute suppression définitive.)
pub fn has_recycle_bin(path: &std::path::Path) -> bool {
    use ::windows::core::HSTRING;
    use ::windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW};

    // La racine du volume (« E:\ », ou le dossier où un disque est monté).
    let mut root = [0u16; 261];
    let wide = HSTRING::from(path.as_os_str());
    if unsafe { GetVolumePathNameW(&wide, &mut root) }.is_err() {
        return false; // inconnu : on refuse plutôt que de risquer
    }
    let len = root.iter().position(|&c| c == 0).unwrap_or(root.len());
    let root = HSTRING::from_wide(&root[..len]);
    // 3 = disque fixe (DRIVE_FIXED).
    unsafe { GetDriveTypeW(&root) == 3 }
}

/// Attend (au plus `max`) que Ctrl, Alt, Maj et Windows soient relâchées :
/// après un raccourci comme Ctrl+Alt+V, envoyer Ctrl+V pendant qu'Alt est
/// encore enfoncée donnerait… Ctrl+Alt+V.
pub fn wait_modifiers_released(max: std::time::Duration) {
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};
    let start = std::time::Instant::now();
    let held = || {
        [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .iter()
            // Le bit de poids fort = la touche est enfoncée en ce moment.
            .any(|vk| unsafe { GetAsyncKeyState(vk.0 as i32) } < 0)
    };
    while held() && start.elapsed() < max {
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
}

// ── Lanceur rapide ───────────────────────────────────────────────────────────

/// Ouvre un raccourci, un fichier ou un outil Windows « comme un double-clic »
/// (ShellExecute, verbe « open »). Le lanceur n'appelle cette fonction qu'avec
/// des chemins qu'il a trouvés lui-même (menu Démarrer, fichiers récents) ou
/// avec sa liste fixe d'outils Windows : jamais avec un texte tapé.
pub fn shell_open(target: &str) -> Result<(), String> {
    use ::windows::core::{w, HSTRING};
    use ::windows::Win32::UI::Shell::ShellExecuteW;
    use ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let file = HSTRING::from(target);
    let result = unsafe { ShellExecuteW(None, w!("open"), &file, None, None, SW_SHOWNORMAL) };
    match result.0 as isize {
        r if r > 32 => Ok(()),
        2 | 3 => Err("introuvable (déplacé ou supprimé ?)".into()),
        5 => Err("accès refusé".into()),
        31 => Err("aucune application n'ouvre ce type de fichier".into()),
        r => Err(format!("ne s'ouvre pas (code {r})")),
    }
}

/// Lance `f` avec COM prêt sur ce thread (il en faut pour lire un raccourci
/// .lnk). À appeler depuis un thread à soi, pas depuis le thread principal.
pub fn with_com<R>(f: impl FnOnce() -> R) -> R {
    use ::windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let result = f();
    // On ne « défait » COM que si c'est nous qui l'avons initialisé.
    if hr.is_ok() {
        unsafe { CoUninitialize() };
    }
    result
}

/// La cible d'un raccourci .lnk (« C:\…\rapport.pdf »), ou None. Il faut COM
/// (voir `with_com`). On lit seulement le chemin : rien n'est lancé.
pub fn shortcut_target(lnk: &std::path::Path) -> Option<PathBuf> {
    use ::windows::core::{Interface, HSTRING};
    use ::windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
    use ::windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(&HSTRING::from(lnk.as_os_str()), STGM_READ).ok()?;
        let mut buf = [0u16; 1024];
        // 0 = pas de drapeau : le chemin tel qu'enregistré dans le raccourci.
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        if len == 0 {
            return None; // raccourci vers autre chose qu'un fichier (Panneau de configuration…)
        }
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
    }
}

// ── Garder une fenêtre au premier plan ───────────────────────────────────────

/// La fenêtre « de l'utilisateur » : celle qui avait le focus avant l'île, sinon
/// celle qui l'a maintenant si ce n'est pas l'île. Un entier (voir PREVIOUS_FOREGROUND).
pub fn user_window(app: &AppHandle) -> Option<isize> {
    use ::windows::Win32::UI::WindowsAndMessaging::IsWindow;
    let island = app.get_webview_window(crate::island::WINDOW_LABEL).and_then(|w| hwnd_of(&w)).map(|h| h.0 as isize);
    let prev = *PREVIOUS_FOREGROUND.locked();
    let candidate = if prev != 0 { prev } else { unsafe { GetForegroundWindow() }.0 as isize };
    let ok = candidate != 0 && Some(candidate) != island && unsafe { IsWindow(Some(HWND(candidate as *mut _))) }.as_bool();
    ok.then_some(candidate)
}

/// Le titre d'une fenêtre (« Sans titre - Bloc-notes »).
pub fn window_title(h: isize) -> String {
    use ::windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(HWND(h as *mut _), &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

/// Est-elle « toujours au premier plan » ?
pub fn is_topmost(h: isize) -> bool {
    use ::windows::Win32::UI::WindowsAndMessaging::WS_EX_TOPMOST;
    let ex = unsafe { GetWindowLongPtrW(HWND(h as *mut _), GWL_EXSTYLE) };
    ex & WS_EX_TOPMOST.0 as isize != 0
}

/// La garde au premier plan (ou la relâche), sans la déplacer ni lui donner le focus.
pub fn set_topmost(h: isize, on: bool) -> Result<(), String> {
    use ::windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
    let after = if on { HWND_TOPMOST } else { HWND_NOTOPMOST };
    unsafe { SetWindowPos(HWND(h as *mut _), Some(after), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) }
        .map_err(|_| "Windows refuse (fenêtre d'une appli lancée en administrateur ?)".to_string())
}

/// L'île ne rendra PAS le focus à la fenêtre d'avant en se fermant : le
/// programme qu'on vient de lancer doit pouvoir passer devant.
pub fn forget_previous_foreground() {
    *PREVIOUS_FOREGROUND.locked() = 0;
}

// ── Infos système ────────────────────────────────────────────────────────────

/// L'état de la batterie (None : pas de batterie, PC fixe).
#[derive(Debug, Clone)]
pub struct Battery {
    pub percent: Option<u8>,
    pub charging: bool,
    pub plugged: bool,
}

pub fn battery() -> Option<Battery> {
    use ::windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut st = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut st) }.ok()?;
    // BatteryFlag : 128 = pas de batterie, 255 = inconnu. 8 = en charge.
    if st.BatteryFlag == 128 || st.BatteryFlag == 255 {
        return None;
    }
    Some(Battery {
        // 255 = pourcentage inconnu.
        percent: (st.BatteryLifePercent <= 100).then_some(st.BatteryLifePercent),
        charging: st.BatteryFlag & 8 != 0,
        plugged: st.ACLineStatus == 1,
    })
}

// ── Outils réseau ────────────────────────────────────────────────────────────

/// Un « ping » (écho ICMP) vers une adresse IPv4, sans droits administrateur
/// (API IcmpSendEcho de Windows, celle qu'utilise ping.exe).
/// Ok(Some((ms, ttl))) : réponse ; Ok(None) : pas de réponse à temps.
pub fn ping(ip: std::net::Ipv4Addr, timeout_ms: u32) -> Result<Option<(u32, u8)>, String> {
    use ::windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};
    let data = *b"ile-ping-ile-ping-ile-ping-ile-p"; // 32 octets, comme ping.exe
    // La réponse : la structure, puis une copie des données, plus 8 octets de marge (doc Microsoft).
    let mut buffer = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + data.len() + 8];
    unsafe {
        let handle = IcmpCreateFile().map_err(|e| format!("ping impossible : {e}"))?;
        let count = IcmpSendEcho(
            handle,
            u32::from_ne_bytes(ip.octets()), // l'adresse « dans l'ordre du réseau »
            data.as_ptr() as *const _,
            data.len() as u16,
            None,
            buffer.as_mut_ptr() as *mut _,
            buffer.len() as u32,
            timeout_ms,
        );
        let _ = IcmpCloseHandle(handle);
        if count == 0 {
            return Ok(None); // délai dépassé, hôte injoignable…
        }
        let reply = std::ptr::read_unaligned(buffer.as_ptr() as *const ICMP_ECHO_REPLY);
        // Status 0 = IP_SUCCESS ; sinon « destination injoignable », etc.
        Ok((reply.Status == 0).then_some((reply.RoundTripTime, reply.Options.Ttl)))
    }
}

/// Le nom DNS d'une adresse IPv4 (recherche inverse), s'il existe.
pub fn reverse_dns(ip: std::net::Ipv4Addr) -> Option<String> {
    use ::windows::Win32::Networking::WinSock::{
        GetNameInfoW, WSAStartup, AF_INET, IN_ADDR, IN_ADDR_0, NI_NAMEREQD, SOCKADDR, SOCKADDR_IN, WSADATA, socklen_t,
    };
    unsafe {
        // Windows demande d'« ouvrir » les sockets avant (sans effet si c'est déjà fait).
        let mut wsa = WSADATA::default();
        if WSAStartup(0x0202, &mut wsa) != 0 {
            return None;
        }
        let addr = SOCKADDR_IN {
            sin_family: AF_INET,
            sin_port: 0,
            sin_addr: IN_ADDR { S_un: IN_ADDR_0 { S_addr: u32::from_ne_bytes(ip.octets()) } },
            sin_zero: [0; 8],
        };
        let mut name = [0u16; 1025];
        let rc = GetNameInfoW(
            &addr as *const SOCKADDR_IN as *const SOCKADDR,
            socklen_t(std::mem::size_of::<SOCKADDR_IN>() as i32),
            Some(&mut name),
            None,
            NI_NAMEREQD as i32, // pas de nom → échec, plutôt que l'adresse recopiée
        );
        if rc != 0 {
            return None;
        }
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        Some(String::from_utf16_lossy(&name[..len]))
    }
}

// ── Porte d'entrée locale (« island notify ») ────────────────────────────────
//
// Sécurité du canal (audit du 5 octobre 2026) :
//   - son nom contient le SID du compte Windows (unique, contrairement au nom
//     d'utilisateur) ;
//   - côté île, ses droits (DACL) n'autorisent QUE ce compte : un autre
//     utilisateur ne peut ni s'y connecter ni le lire ;
//   - côté client (ondine.exe notify / mcp / permission), on vérifie avant
//     d'envoyer quoi que ce soit que l'autre bout est bien un « ondine.exe »
//     lancé par le même compte : un programme qui aurait créé le canal avant
//     l'île ne peut donc pas recevoir les demandes ni répondre « allow » ;
//   - le client interdit au serveur d'agir en son nom (niveau « identification »).

/// Le SID (texte « S-1-5-21-… ») du compte qui fait tourner un processus.
unsafe fn process_user_sid(process: ::windows::Win32::Foundation::HANDLE) -> Option<String> {
    use ::windows::core::PWSTR;
    use ::windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use ::windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use ::windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use ::windows::Win32::System::Threading::OpenProcessToken;
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(process, TOKEN_QUERY, &mut token).ok()?;
        // Première demande : la taille ; seconde : le contenu. Tampon en u64
        // pour que la structure (qui contient des pointeurs) soit bien alignée.
        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
        let read = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as _), len, &mut len);
        let _ = CloseHandle(token);
        read.ok()?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).ok()?;
        let sid = text.to_string().ok();
        let _ = LocalFree(Some(HLOCAL(text.0 as _)));
        sid
    }
}

/// Le SID du compte courant (calculé une fois).
fn own_sid() -> Option<String> {
    use std::sync::OnceLock;
    static SID: OnceLock<Option<String>> = OnceLock::new();
    SID.get_or_init(|| unsafe { process_user_sid(::windows::Win32::System::Threading::GetCurrentProcess()) }).clone()
}

/// Le nom du canal (named pipe) par lequel les outils parlent à l'île : un par
/// compte Windows (le SID n'a que des lettres, des chiffres et des tirets).
pub fn agents_pipe_name() -> String {
    let id = own_sid().unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_default());
    let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    format!(r"\\.\pipe\ondine-agents-{id}")
}

/// Au plus tant de clients lus en même temps (les autres sont refusés).
const PIPE_MAX_CLIENTS: usize = 8;
/// Un client a ce temps pour envoyer sa ligne, sinon on raccroche.
const PIPE_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Écoute le canal pour toujours : chaque client envoie UNE ligne (au plus
/// `max` octets). `on_message` reçoit les octets et le canal lui-même : il
/// peut y écrire une réponse (une question posée par un agent), ou le laisser
/// se fermer. Chaque client est lu dans son propre fil, avec un délai : un
/// client muet ne bloque pas les autres. Bloquant : à lancer dans un thread.
///
/// Renvoie une erreur seulement si le canal n'a jamais pu être créé (par
/// exemple : un autre programme l'a créé avant l'île).
pub fn serve_agents_pipe(
    max: usize,
    on_message: impl Fn(Vec<u8>, std::fs::File) + Send + Sync + 'static,
) -> Result<(), String> {
    use std::io::{BufRead, Read};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use ::windows::core::HSTRING;
    use ::windows::Win32::Foundation::{ERROR_PIPE_CONNECTED, HANDLE};
    use ::windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use ::windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use ::windows::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAGS_AND_ATTRIBUTES, PIPE_ACCESS_DUPLEX};
    use ::windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
        PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };

    let name = HSTRING::from(agents_pipe_name());
    // Les droits du canal : accès complet pour ce compte, rien pour les autres
    // (« P » : pas d'héritage de droits plus larges).
    let sid = own_sid().ok_or("compte Windows introuvable")?;
    let sddl = HSTRING::from(format!("D:P(A;;GA;;;{sid})"));
    let mut sd = PSECURITY_DESCRIPTOR::default();
    unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut sd, None) }
        .map_err(|e| format!("droits du canal : {e}"))?;
    // (`sd` vit aussi longtemps que l'écoute : jamais libéré, c'est voulu.)
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: false.into(),
    };

    // `first` : la toute première création échoue si le nom est déjà pris par
    // un autre programme (on refuse d'écouter à sa place).
    let create = |first: bool| -> Result<HANDLE, String> {
        // Dans les deux sens : l'île peut répondre (« ask »).
        let flags = if first { PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE } else { PIPE_ACCESS_DUPLEX | FILE_FLAGS_AND_ATTRIBUTES(0) };
        let h = unsafe {
            CreateNamedPipeW(
                &name,
                flags,
                // Octets bruts, bloquant, et jamais depuis une autre machine.
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                4096,
                max as u32,
                0,
                Some(&attributes),
            )
        };
        if h.is_invalid() {
            Err(format!("canal indisponible : {}", ::windows::core::Error::from_win32()))
        } else {
            Ok(h)
        }
    };
    // Une nouvelle instance ; si Windows refuse un instant, on réessaie (au
    // lieu d'abandonner le canal jusqu'au redémarrage de l'île).
    let create_again = || -> HANDLE {
        let mut wait = 200;
        loop {
            match create(false) {
                Ok(h) => return h,
                Err(e) => {
                    crate::services::log::warn(format!("agents : {e} (nouvel essai)"));
                    std::thread::sleep(std::time::Duration::from_millis(wait));
                    wait = (wait * 2).min(10_000);
                }
            }
        }
    };

    let on_message = Arc::new(on_message);
    let active = Arc::new(AtomicUsize::new(0));
    let mut next = create(true)?;
    loop {
        let current = next;
        // Attend un client. « Déjà connecté » n'est pas une erreur.
        if let Err(e) = unsafe { ConnectNamedPipe(current, None) } {
            if e.code() != ERROR_PIPE_CONNECTED.to_hresult() {
                // On referme et on recommence avec une instance neuve.
                drop(unsafe { std::fs::File::from_raw_handle(current.0 as RawHandle) });
                next = create_again();
                continue;
            }
        }
        // Une nouvelle instance AVANT de lire : le nom reste à nous.
        next = create_again();
        // `File` lit le canal et le referme quand il est détruit.
        let file = unsafe { std::fs::File::from_raw_handle(current.0 as RawHandle) };
        if active.load(Ordering::SeqCst) >= PIPE_MAX_CLIENTS {
            continue; // trop de clients à la fois : celui-ci est refusé (fermé)
        }
        // Une copie du canal pour le « chronomètre » : elle reste valide même
        // si le fil de lecture a déjà refermé le sien.
        let Ok(guard) = file.try_clone() else { continue };
        active.fetch_add(1, Ordering::SeqCst);
        let (on_message, active) = (on_message.clone(), active.clone());
        std::thread::spawn(move || {
            let (done, timer) = std::sync::mpsc::channel::<()>();
            // Le chronomètre : sans ligne complète à temps, on raccroche, ce qui
            // débloque la lecture en cours.
            let watchdog = std::thread::spawn(move || {
                if timer.recv_timeout(PIPE_READ_TIMEOUT).is_err() {
                    let _ = unsafe { DisconnectNamedPipe(HANDLE(guard.as_raw_handle() as _)) };
                }
                drop(guard);
            });
            // On lit une ligne (jusqu'au retour à la ligne, ou jusqu'à ce que le
            // client ferme).
            let mut bytes = Vec::new();
            let _ = std::io::BufReader::new((&file).take(max as u64 + 1)).read_until(b'\n', &mut bytes);
            let _ = done.send(());
            let _ = watchdog.join();
            while bytes.last() == Some(&b'\n') || bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            if !bytes.is_empty() && bytes.len() <= max {
                on_message(bytes, file);
            }
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

/// Côté île : le programme qui attend une réponse est-il toujours là ? (Si
/// l'agent a eu sa réponse ailleurs, il a fermé le canal : on retire la question.)
pub fn pipe_client_alive(file: &std::fs::File) -> bool {
    use std::os::windows::io::AsRawHandle;
    use ::windows::Win32::Foundation::HANDLE;
    use ::windows::Win32::System::Pipes::PeekNamedPipe;
    // Regarder sans rien lire : échoue (ERROR_BROKEN_PIPE) si l'autre bout est fermé.
    unsafe { PeekNamedPipe(HANDLE(file.as_raw_handle() as _), None, 0, None, None, None).is_ok() }
}

/// Ouvre le canal de l'île (quelques essais rapides s'il est occupé), puis
/// vérifie qui est en face avant d'envoyer quoi que ce soit.
fn open_agents_pipe() -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use ::windows::Win32::Storage::FileSystem::{SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT};
    let name = agents_pipe_name();
    let mut last = String::new();
    for _ in 0..5 {
        // « Identification » : l'autre bout peut savoir qui nous sommes, mais
        // jamais agir en notre nom.
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .security_qos_flags(SECURITY_SQOS_PRESENT.0 | SECURITY_IDENTIFICATION.0)
            .open(&name)
        {
            Ok(f) => {
                check_pipe_server(&f)?;
                return Ok(f);
            }
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
        }
    }
    Err(format!("l'île n'est pas ouverte ({last})"))
}

/// Le programme qui a créé le canal est-il bien l'île (« ondine.exe ») du même
/// compte Windows ? Sinon on refuse : ce pourrait être un imposteur qui attend
/// les demandes de permission pour répondre « allow ».
fn check_pipe_server(pipe: &std::fs::File) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use ::windows::core::PWSTR;
    use ::windows::Win32::Foundation::{CloseHandle, HANDLE};
    use ::windows::Win32::System::Pipes::GetNamedPipeServerProcessId;
    use ::windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    let refused = "canal refusé : ce n'est pas l'île de ton compte qui répond";
    unsafe {
        let mut pid = 0u32;
        GetNamedPipeServerProcessId(HANDLE(pipe.as_raw_handle() as _), &mut pid).map_err(|_| refused)?;
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).map_err(|_| refused)?;
        let sid = process_user_sid(process);
        let mut path = [0u16; 1024];
        let mut len = path.len() as u32;
        let exe = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut len)
            .ok()
            .map(|_| String::from_utf16_lossy(&path[..len as usize]));
        let _ = CloseHandle(process);
        let same_user = sid.is_some() && sid == own_sid();
        let is_island = exe
            .as_deref()
            .and_then(|p| std::path::Path::new(p).file_name().map(|n| n.to_string_lossy().to_lowercase()))
            .is_some_and(|n| n == "ondine.exe");
        if same_user && is_island {
            Ok(())
        } else {
            Err(refused.into())
        }
    }
}

/// Côté client (« ondine.exe notify ») : envoie un message à l'île, si elle tourne.
pub fn send_agents_pipe(bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut f = open_agents_pipe()?;
    f.write_all(bytes).and_then(|_| f.write_all(b"\n")).map_err(|e| e.to_string())
}

/// Côté client (« ondine.exe mcp ») : envoie une demande et attend la réponse
/// de l'île (une ligne). Bloque jusqu'à la réponse ou la fermeture du canal.
pub fn request_agents_pipe(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::{BufRead, Write};
    let mut f = open_agents_pipe()?;
    f.write_all(bytes).and_then(|_| f.write_all(b"\n")).map_err(|e| e.to_string())?;
    let mut reply = Vec::new();
    std::io::BufReader::new(f).read_until(b'\n', &mut reply).map_err(|e| e.to_string())?;
    Ok(reply)
}

// ── Retrouver la fenêtre d'un agent (Claude Code, Codex…) ────────────────────

/// Les programmes « au-dessus » de celui-ci (son parent, le parent du parent…),
/// du plus proche au plus lointain, sans dépasser l'île elle-même. Appelé par
/// « ondine.exe notify » : parmi eux se trouve le terminal où tourne l'agent.
pub fn ancestor_pids(max: usize) -> Vec<u32> {
    use ::windows::Win32::Foundation::CloseHandle;
    use ::windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    // Une photo de tous les programmes : numéro → (parent, nom).
    let mut table = std::collections::HashMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return vec![] };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut entry).is_ok();
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
            table.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
            ok = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    let mut out = Vec::new();
    let mut pid = std::process::id();
    while out.len() < max {
        let Some((parent, _)) = table.get(&pid) else { break };
        let parent = *parent;
        // 0 et 4 : le système. Une boucle (numéro réutilisé) : on s'arrête.
        if parent == 0 || parent == 4 || out.contains(&parent) {
            break;
        }
        match table.get(&parent) {
            // On ne remonte pas au-delà de l'île (quand elle a lancé l'agent).
            Some((_, name)) if name == "ondine.exe" || name == "explorer.exe" => break,
            Some(_) => out.push(parent),
            None => break,
        }
        pid = parent;
    }
    out
}

/// La fenêtre de console de ce programme, si elle est visible (sinon 0).
pub fn own_console_window() -> isize {
    use ::windows::Win32::System::Console::GetConsoleWindow;
    use ::windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    unsafe {
        let h = GetConsoleWindow();
        if !h.0.is_null() && IsWindowVisible(h).as_bool() {
            h.0 as isize
        } else {
            0
        }
    }
}

/// Fait passer devant la fenêtre d'un agent : `hwnd` (sa console) si elle
/// existe encore, sinon la première fenêtre visible d'un des programmes
/// `pids` (du plus proche au plus lointain). Err si aucune n'est trouvée.
pub fn focus_agent_window(hwnd: isize, pids: &[u32]) -> Result<(), String> {
    use ::windows::core::BOOL;
    use ::windows::Win32::Foundation::{LPARAM, HWND};
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
    };

    // Les fenêtres principales visibles (avec un titre, sans propriétaire), et leur programme.
    unsafe extern "system" fn collect(h: HWND, lparam: LPARAM) -> BOOL {
        let list = unsafe { &mut *(lparam.0 as *mut Vec<(isize, u32)>) };
        unsafe {
            if IsWindowVisible(h).as_bool() && GetWindowTextLengthW(h) > 0 && GetWindow(h, GW_OWNER).is_err() {
                let mut pid = 0u32;
                GetWindowThreadProcessId(h, Some(&mut pid));
                list.push((h.0 as isize, pid));
            }
        }
        BOOL(1) // continuer
    }

    let target = unsafe {
        let direct = HWND(hwnd as *mut _);
        if hwnd != 0 && IsWindow(Some(direct)).as_bool() && IsWindowVisible(direct).as_bool() {
            Some(direct)
        } else {
            let mut windows: Vec<(isize, u32)> = Vec::new();
            let _ = EnumWindows(Some(collect), LPARAM(&mut windows as *mut _ as isize));
            pids.iter().find_map(|p| windows.iter().find(|(_, wp)| wp == p)).map(|(h, _)| HWND(*h as *mut _))
        }
    };
    let Some(target) = target else {
        return Err("la fenêtre de cette session est introuvable (fermée ?)".into());
    };
    unsafe {
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_RESTORE);
        }
        // Windows ne laisse passer une fenêtre devant que si on vient d'agir au
        // clavier : une pression sur Alt, seule, lève ce verrou (astuce connue).
        let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        SendInput(&[key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)], std::mem::size_of::<INPUT>() as i32);
        if !SetForegroundWindow(target).as_bool() {
            return Err("Windows a refusé de passer à cette fenêtre".into());
        }
    }
    // L'île, en se refermant, ne doit pas reprendre la main.
    forget_previous_foreground();
    Ok(())
}
