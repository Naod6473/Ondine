// La dictée partout : ce qui touche à Windows.
//
//   - la touche : un crochet clavier « bas niveau » (WH_KEYBOARD_LL) qui
//     regarde seulement, sans jamais avaler une touche ; il tourne dans son
//     propre fil avec sa boucle de messages. Les frappes simulées (la nôtre,
//     Ctrl+V, comme celles des autres programmes) sont ignorées ;
//   - l'appli au premier plan : le nom de son programme (« outlook »), pour
//     son style et les statistiques ;
//   - un champ de texte a-t-il le clavier ? Le curseur de texte de Windows
//     (GetGUIThreadInfo), sinon l'élément qui a le focus vu par UI
//     Automation (zone de saisie, document modifiable, terminal…). Sans
//     certitude, on colle quand même : on ne garde la dictée dans le
//     presse-papiers (avec un message) que quand on est sûr qu'il n'y a pas
//     de champ (bureau, liste de fichiers, bouton, page web sans champ) ;
//   - le collage : le texte entre dans le presse-papiers marqué « ne pas
//     garder » (ExcludeClipboardContentFromMonitorProcessing,
//     CanIncludeInClipboardHistory = 0, CanUploadToCloudClipboard = 0 : ni
//     l'historique d'Ondine, ni Win+V, ni le cloud), Ctrl+V est simulé
//     (SendInput), puis le presse-papiers retrouve ce qu'il contenait 700 ms
//     après, sauf si quelque chose d'autre a été copié entre-temps.
//
// Techniques reprises de Flow de Coucou (MIT), adaptées. Sous Linux, tout
// renvoie « seulement sous Windows » (la logique pure plus bas est testée).

// Sous Linux, seule la logique pure sert (aux tests).
#![cfg_attr(not(windows), allow(dead_code))]

/// La touche à maintenir pour dicter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DictKey {
    #[default]
    RightCtrl,
    RightAlt,
    RightShift,
    CtrlWin,
}

impl DictKey {
    /// La valeur du réglage « key » (sinon Ctrl droit).
    pub fn from_id(id: &str) -> DictKey {
        match id {
            "rightAlt" => DictKey::RightAlt,
            "rightShift" => DictKey::RightShift,
            "ctrlWin" => DictKey::CtrlWin,
            _ => DictKey::RightCtrl,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            DictKey::RightCtrl => "rightCtrl",
            DictKey::RightAlt => "rightAlt",
            DictKey::RightShift => "rightShift",
            DictKey::CtrlWin => "ctrlWin",
        }
    }
}

/// Ce que le crochet voit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyEvent {
    Down,
    Up,
    /// Une autre touche (pas un modificateur) : un raccourci.
    Other,
    Escape,
}

/// Y a-t-il un champ de texte qui a le clavier ?
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Yes,
    No,
    /// On ne sait pas : on colle quand même.
    Unknown,
}

/// Ce qui est arrivé aux mots.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Pasted,
    /// Dans le presse-papiers seulement (pas de champ, ou frappe refusée).
    Copied,
    Failed,
}

/// Ce qu'UI Automation dit de l'élément qui a le focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FocusInfo {
    /// UIA_CONTROLTYPE_ID (50004 : zone de saisie…).
    pub control: i32,
    /// La valeur est-elle en lecture seule (None : pas de valeur).
    pub value_readonly: Option<bool>,
    /// L'élément donne son texte (TextPattern : documents, terminaux).
    pub has_text: bool,
}

// Les types de contrôle d'UI Automation dont on a besoin.
const EDIT: i32 = 50004;
const DOCUMENT: i32 = 50030;
/// Bouton, case, lien, image, élément de liste, liste, menus, bouton radio,
/// barre de défilement, curseur, onglets, arbre, barre d'outils, fenêtre,
/// élément de données, bouton partagé, en-tête, barre de titre.
const NOT_TEXT: &[i32] = &[50000, 50002, 50005, 50006, 50007, 50008, 50009, 50010, 50011, 50013, 50014, 50015, 50018, 50019, 50021, 50023, 50024, 50029, 50031, 50032, 50035, 50037];

/// La décision, d'après ce que dit UI Automation (sans Windows : testée).
pub fn field_verdict(info: &FocusInfo) -> Field {
    // Une valeur qu'on peut écrire : une zone de saisie, une liste modifiable.
    if info.value_readonly == Some(false) {
        return Field::Yes;
    }
    if info.control == EDIT {
        return if info.value_readonly == Some(true) { Field::No } else { Field::Yes };
    }
    // Un texte lisible et pas en lecture seule : un document, un terminal.
    if info.has_text && info.value_readonly != Some(true) {
        return Field::Yes;
    }
    // Une page web sans champ : le document est en lecture seule.
    if info.control == DOCUMENT {
        return if info.value_readonly == Some(true) { Field::No } else { Field::Unknown };
    }
    if NOT_TEXT.contains(&info.control) {
        return Field::No;
    }
    Field::Unknown
}

/// Les fenêtres du bureau lui-même : jamais un endroit où écrire.
pub fn shell_class(class: &str) -> bool {
    matches!(class, "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{field_verdict, shell_class, DictKey, Field, FocusInfo, KeyEvent, Outcome};
    use crate::sync::LockExt;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use ::windows::core::PWSTR;
    use ::windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use ::windows::Win32::System::Threading::{GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, EnumWindows, GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetMessageW, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
        PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, GUITHREADINFO, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT,
        WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    const VK_ESCAPE: u32 = 0x1B;
    const VK_LSHIFT: u32 = 0xA0;
    const VK_RSHIFT: u32 = 0xA1;
    const VK_LCONTROL: u32 = 0xA2;
    const VK_RCONTROL: u32 = 0xA3;
    const VK_RMENU: u32 = 0xA5;
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;
    /// Une touche qui n'existe pas : appuyée pendant Ctrl+Windows, elle
    /// empêche le menu Démarrer de s'ouvrir au relâchement (comme AutoHotkey).
    const VK_MASK: u16 = 0xE8;

    /// Les modificateurs ne comptent jamais comme « une autre touche » (Alt Gr
    /// envoie même un faux Ctrl gauche avec chaque Alt droit).
    fn is_modifier(vk: u32) -> bool {
        matches!(vk, 0x10..=0x12 | VK_LSHIFT..=VK_RMENU | VK_LWIN | VK_RWIN | 0x14)
    }

    type Sink = Box<dyn Fn(KeyEvent) + Send>;
    static SINK: Mutex<Option<Sink>> = Mutex::new(None);
    static KEY: AtomicU8 = AtomicU8::new(0);
    /// Ctrl + Windows : lesquelles sont enfoncées (bit 0 Ctrl, bit 1 Windows).
    static COMBO: AtomicU8 = AtomicU8::new(0);

    fn code(key: DictKey) -> u8 {
        match key {
            DictKey::RightCtrl => 0,
            DictKey::RightAlt => 1,
            DictKey::RightShift => 2,
            DictKey::CtrlWin => 3,
        }
    }

    fn send(event: KeyEvent) {
        if let Some(sink) = SINK.locked().as_ref() {
            sink(event);
        }
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            // Nos frappes (Ctrl+V) et celles des autres programmes ne sont pas les vôtres.
            if info.flags.0 & LLKHF_INJECTED.0 == 0 {
                let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                let up = matches!(wparam.0 as u32, WM_KEYUP | WM_SYSKEYUP);
                on_key(info.vkCode, down, up);
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    fn on_key(vk: u32, down: bool, up: bool) {
        let key = KEY.load(Ordering::Relaxed);
        if key == 3 && matches!(vk, VK_LCONTROL | VK_RCONTROL | VK_LWIN | VK_RWIN) {
            let bit = if matches!(vk, VK_LCONTROL | VK_RCONTROL) { 1 } else { 2 };
            let before = COMBO.load(Ordering::Relaxed);
            let after = if down { before | bit } else if up { before & !bit } else { before };
            COMBO.store(after, Ordering::Relaxed);
            if before != 3 && after == 3 {
                // Hors du crochet : il doit rendre la main tout de suite.
                std::thread::spawn(mask_start_menu);
                send(KeyEvent::Down);
            } else if before == 3 && after != 3 {
                send(KeyEvent::Up);
            } else if after == 3 && down {
                send(KeyEvent::Down); // répétition
            }
            return;
        }
        let ours = match key {
            0 => vk == VK_RCONTROL,
            1 => vk == VK_RMENU,
            2 => vk == VK_RSHIFT,
            _ => false,
        };
        if ours {
            if down {
                send(KeyEvent::Down);
            } else if up {
                send(KeyEvent::Up);
            }
            return;
        }
        if !down {
            return;
        }
        if vk == VK_ESCAPE {
            send(KeyEvent::Escape);
        } else if !is_modifier(vk) {
            send(KeyEvent::Other);
        }
    }

    fn key_input(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 } },
        }
    }

    fn mask_start_menu() {
        let inputs = [key_input(VK_MASK, false), key_input(VK_MASK, true)];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    /// Le fil du crochet ; il s'arrête quand on le lâche.
    pub struct KeyListener {
        thread_id: u32,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for KeyListener {
        fn drop(&mut self) {
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
            *SINK.locked() = None;
        }
    }

    /// Commence à regarder la touche ; chaque événement passe par `sink`.
    pub fn listen(key: DictKey, sink: Box<dyn Fn(KeyEvent) + Send>) -> Result<KeyListener, String> {
        KEY.store(code(key), Ordering::Relaxed);
        COMBO.store(0, Ordering::Relaxed);
        *SINK.locked() = Some(sink);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
        let thread = std::thread::Builder::new()
            .name("ondine-dictee-touche".into())
            .spawn(move || unsafe {
                let module = GetModuleHandleW(None).ok();
                let handle = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(Into::into), 0) {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e.to_string()));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                let _ = UnhookWindowsHookEx(handle);
            })
            .map_err(|e| e.to_string())?;
        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(thread_id)) => Ok(KeyListener { thread_id, thread: Some(thread) }),
            Ok(Err(e)) => {
                *SINK.locked() = None;
                Err(e)
            }
            Err(_) => {
                *SINK.locked() = None;
                Err("le crochet du clavier n'a pas démarré".into())
            }
        }
    }

    /// Attend (une seconde au plus) que la touche de dictée soit relâchée,
    /// pour que le collage soit un simple Ctrl+V (pas Ctrl+Alt+V).
    pub fn wait_key_released(key: DictKey) {
        let keys: &[i32] = match key {
            DictKey::RightCtrl => &[VK_RCONTROL as i32],
            DictKey::RightAlt => &[VK_RMENU as i32],
            DictKey::RightShift => &[VK_RSHIFT as i32],
            DictKey::CtrlWin => &[VK_LWIN as i32, VK_RWIN as i32],
        };
        let until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < until {
            if keys.iter().all(|&vk| unsafe { GetAsyncKeyState(vk) } >= 0) {
                return;
            }
            std::thread::sleep(Duration::from_millis(15));
        }
    }

    /// Le programme d'une fenêtre : « outlook ». None pour Ondine elle-même.
    fn program_of(hwnd: HWND) -> Option<String> {
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 || pid == std::process::id() {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(process);
            if !ok {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let stem = std::path::Path::new(&path).file_stem()?.to_string_lossy().to_lowercase();
            Some(stem)
        }
    }

    /// L'appli au premier plan (« outlook »), sauf Ondine.
    pub fn foreground_app() -> Option<String> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return None;
        }
        program_of(hwnd)
    }

    /// Les applis qui ont une fenêtre visible, pour « Ajouter une appli » (Styles).
    pub fn running_apps() -> Vec<String> {
        unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> ::windows::core::BOOL {
            let list = unsafe { &mut *(lparam.0 as *mut Vec<String>) };
            if unsafe { IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 } {
                if let Some(app) = program_of(hwnd) {
                    if !list.contains(&app) {
                        list.push(app);
                    }
                }
            }
            ::windows::core::BOOL(1)
        }
        let mut list: Vec<String> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(each), LPARAM(&mut list as *mut _ as isize));
        }
        list
    }

    fn class_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    /// Ce qu'UI Automation dit de l'élément qui a le focus (None : il n'a pas répondu).
    fn uia_focus() -> Option<FocusInfo> {
        use ::windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
        use ::windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationValuePattern, UIA_TextPatternId, UIA_ValuePatternId};
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let el = uia.GetFocusedElement().ok()?;
            let control = el.CurrentControlType().ok()?.0;
            let value_readonly = el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId).ok().and_then(|v| v.CurrentIsReadOnly().ok()).map(|b| b.as_bool());
            let has_text = el.GetCurrentPattern(UIA_TextPatternId).is_ok();
            Some(FocusInfo { control, value_readonly, has_text })
        }
    }

    /// Un champ de texte a-t-il le clavier ? (voir le haut du fichier)
    pub fn text_field() -> Field {
        let fg = unsafe { GetForegroundWindow() };
        if fg.0.is_null() {
            return Field::No;
        }
        let mut pid = 0u32;
        let thread = unsafe { GetWindowThreadProcessId(fg, Some(&mut pid)) };
        // Une fenêtre d'Ondine (les Réglages) : la dictée reste dans le presse-papiers.
        if pid == std::process::id() || shell_class(&class_of(fg)) {
            return Field::No;
        }
        let mut gui = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        if unsafe { GetGUIThreadInfo(thread, &mut gui) }.is_ok() && !gui.hwndCaret.0.is_null() {
            return Field::Yes;
        }
        // UI Automation peut traîner avec une appli qui ne répond pas : 400 ms au plus.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(uia_focus());
        });
        match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(Some(info)) => field_verdict(&info),
            _ => Field::Unknown,
        }
    }

    /// Ctrl+V dans l'appli au premier plan.
    fn send_paste() -> Result<(), String> {
        const VK_CONTROL: u16 = 0x11;
        const VK_V: u16 = 0x56;
        let inputs = [key_input(VK_CONTROL, false), key_input(VK_V, false), key_input(VK_V, true), key_input(VK_CONTROL, true)];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == inputs.len() {
            Ok(())
        } else {
            Err("Windows a refusé la frappe simulée".into())
        }
    }

    /// Met le texte dans le presse-papiers, marqué « ne pas garder », et l'y laisse.
    pub fn copy(text: &str) -> bool {
        super::super::copy_secret(text).is_ok()
    }

    /// Colle `text` là où l'on écrit (voir le haut du fichier).
    pub fn paste(text: &str) -> Outcome {
        let previous = arboard::Clipboard::new().ok().and_then(|mut c| c.get_text().ok());
        let Ok(seq) = super::super::copy_secret(text) else { return Outcome::Failed };
        // Le temps que le presse-papiers soit annoncé avant que l'appli le lise.
        std::thread::sleep(Duration::from_millis(40));
        if send_paste().is_err() {
            return Outcome::Copied;
        }
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            // Quelque chose d'autre a été copié entre-temps : on le laisse.
            if super::super::clipboard_sequence() != seq {
                return;
            }
            if let Some(previous) = previous {
                let _ = super::super::copy_secret(&previous);
            }
        });
        Outcome::Pasted
    }
}

#[cfg(not(windows))]
mod stub {
    use super::{DictKey, Field, KeyEvent, Outcome};

    pub struct KeyListener;

    pub fn listen(_key: DictKey, _sink: Box<dyn Fn(KeyEvent) + Send>) -> Result<KeyListener, String> {
        Err("disponible seulement sous Windows".into())
    }

    pub fn wait_key_released(_key: DictKey) {}

    pub fn foreground_app() -> Option<String> {
        None
    }

    pub fn running_apps() -> Vec<String> {
        Vec::new()
    }

    pub fn text_field() -> Field {
        Field::Unknown
    }

    pub fn copy(_text: &str) -> bool {
        false
    }

    pub fn paste(_text: &str) -> Outcome {
        Outcome::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(control: i32, value_readonly: Option<bool>, has_text: bool) -> FocusInfo {
        FocusInfo { control, value_readonly, has_text }
    }

    #[test]
    fn a_text_field_is_found_and_a_button_is_not() {
        // Zone de saisie, liste modifiable.
        assert_eq!(field_verdict(&info(EDIT, Some(false), true)), Field::Yes);
        assert_eq!(field_verdict(&info(EDIT, None, false)), Field::Yes);
        assert_eq!(field_verdict(&info(50003, Some(false), false)), Field::Yes);
        // Un champ en lecture seule.
        assert_eq!(field_verdict(&info(EDIT, Some(true), true)), Field::No);
        // Word, un terminal : du texte sans valeur.
        assert_eq!(field_verdict(&info(DOCUMENT, None, true)), Field::Yes);
        assert_eq!(field_verdict(&info(50020, None, true)), Field::Yes);
        // Une page web sans champ : document en lecture seule.
        assert_eq!(field_verdict(&info(DOCUMENT, Some(true), true)), Field::No);
        // Bouton, élément de liste (bureau, Explorateur), fenêtre.
        assert_eq!(field_verdict(&info(50000, None, false)), Field::No);
        assert_eq!(field_verdict(&info(50007, None, false)), Field::No);
        assert_eq!(field_verdict(&info(50032, None, false)), Field::No);
        // Un panneau dessiné à la main : on ne sait pas, on colle.
        assert_eq!(field_verdict(&info(50033, None, false)), Field::Unknown);
        assert_eq!(field_verdict(&info(DOCUMENT, None, false)), Field::Unknown);
        assert!(shell_class("Progman") && shell_class("Shell_TrayWnd") && !shell_class("Chrome_WidgetWin_1"));
    }
}
