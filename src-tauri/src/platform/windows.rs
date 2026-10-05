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

/// Le nom du canal (named pipe) par lequel les outils parlent à l'île. Un nom
/// par utilisateur Windows ; les droits par défaut de Windows ne laissent
/// écrire que le compte qui l'a créé.
pub fn agents_pipe_name() -> String {
    let user: String = std::env::var("USERNAME").unwrap_or_default().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    format!(r"\\.\pipe\island-agents-{user}")
}

/// Écoute le canal pour toujours : chaque client envoie un message (au plus
/// `max` octets) puis ferme. `on_message` reçoit les octets. Bloquant : à
/// lancer dans un thread.
pub fn serve_agents_pipe(max: usize, mut on_message: impl FnMut(Vec<u8>)) -> Result<(), String> {
    use std::io::Read;
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use ::windows::core::HSTRING;
    use ::windows::Win32::Foundation::{ERROR_PIPE_CONNECTED, HANDLE};
    use ::windows::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAGS_AND_ATTRIBUTES, PIPE_ACCESS_INBOUND};
    use ::windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };

    let name = HSTRING::from(agents_pipe_name());
    // `first` : la toute première création échoue si le nom est déjà pris par
    // un autre programme (on refuse d'écouter à sa place).
    let create = |first: bool| -> Result<HANDLE, String> {
        let flags = if first { PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE } else { PIPE_ACCESS_INBOUND | FILE_FLAGS_AND_ATTRIBUTES(0) };
        let h = unsafe {
            CreateNamedPipeW(
                &name,
                flags,
                // Octets bruts, bloquant, et jamais depuis une autre machine.
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                0,
                max as u32,
                0,
                None,
            )
        };
        if h.is_invalid() {
            Err(format!("canal indisponible : {}", ::windows::core::Error::from_win32()))
        } else {
            Ok(h)
        }
    };

    let mut next = create(true)?;
    loop {
        let current = next;
        // Attend un client. « Déjà connecté » n'est pas une erreur.
        if let Err(e) = unsafe { ConnectNamedPipe(current, None) } {
            if e.code() != ERROR_PIPE_CONNECTED.to_hresult() {
                // On referme et on recommence avec une instance neuve.
                drop(unsafe { std::fs::File::from_raw_handle(current.0 as RawHandle) });
                next = create(false)?;
                continue;
            }
        }
        // Une nouvelle instance AVANT de lire : le nom reste à nous.
        next = create(false)?;
        // `File` lit le canal et le referme quand il est détruit.
        let file = unsafe { std::fs::File::from_raw_handle(current.0 as RawHandle) };
        let mut bytes = Vec::new();
        let _ = file.take(max as u64 + 1).read_to_end(&mut bytes);
        if !bytes.is_empty() && bytes.len() <= max {
            on_message(bytes);
        }
    }
}

/// Côté client (« island.exe notify ») : envoie un message à l'île, si elle
/// tourne. Quelques essais rapides si le canal est occupé.
pub fn send_agents_pipe(bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let name = agents_pipe_name();
    let mut last = String::new();
    for _ in 0..5 {
        match std::fs::OpenOptions::new().write(true).open(&name) {
            Ok(mut f) => return f.write_all(bytes).map_err(|e| e.to_string()),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(std::time::Duration::from_millis(60));
            }
        }
    }
    Err(format!("l'île ne répond pas ({last})"))
}

// ── Retrouver la fenêtre d'un agent (Claude Code, Codex…) ────────────────────

/// Les programmes « au-dessus » de celui-ci (son parent, le parent du parent…),
/// du plus proche au plus lointain, sans dépasser l'île elle-même. Appelé par
/// « island.exe notify » : parmi eux se trouve le terminal où tourne l'agent.
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
            Some((_, name)) if name == "island.exe" || name == "explorer.exe" => break,
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
