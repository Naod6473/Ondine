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


// ── Presse-papiers ────────────────────────────────────────────────────────────

/// Numéro qui change à chaque nouvelle copie (n'importe quelle appli).
/// Le lire ne touche pas au contenu du presse-papiers.
pub fn clipboard_sequence() -> u32 {
    unsafe { ::windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
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

/// Ouvre un programme console (cmd, PowerShell…) dans SA PROPRE fenêtre,
/// dans le dossier `dir`. Utilisé par le module Terminal.
pub fn spawn_console(program: &str, args: &[String], dir: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // CREATE_NEW_CONSOLE : une nouvelle fenêtre de console, détachée de l'île.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    std::process::Command::new(program)
        .args(args)
        .current_dir(dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => format!("{program} n'est pas installé sur ce PC"),
            _ => format!("{program} ne s'ouvre pas : {e}"),
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

/// L'île ne rendra PAS le focus à la fenêtre d'avant en se fermant : le
/// programme qu'on vient de lancer doit pouvoir passer devant.
pub fn forget_previous_foreground() {
    *PREVIOUS_FOREGROUND.lock().unwrap() = 0;
}
