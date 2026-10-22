// Contrôles → « Aide-mémoire des raccourcis » (1.2.5) : maintenir Ctrl gauche,
// seul, HOLD_MS ouvre l'île sur les raccourcis de l'appli au premier plan ;
// le relâcher la referme.
//
// Un crochet clavier et un crochet souris « bas niveau » qui regardent
// seulement, sans jamais rien avaler (comme la dictée). Tout ce qui montre
// qu'on se sert de Ctrl pour autre chose annule : une autre touche
// (Ctrl+C), un clic ou la molette (Ctrl+clic, Ctrl+molette pour zoomer).
// Les frappes simulées par les programmes sont ignorées.

// Sous Linux, seule la logique pure sert (aux tests).
#![cfg_attr(not(windows), allow(dead_code))]

/// Ctrl gauche tenu seul aussi longtemps (ms) ouvre l'aide-mémoire.
pub const HOLD_MS: u64 = 1500;

/// Ce que l'île reçoit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheatEvent {
    /// Ouvrir, pour cette appli (None : on ne sait pas laquelle).
    Show(Option<String>),
    Hide,
}

/// L'état de la touche (logique pure, testée sous Linux).
#[derive(Debug, Default)]
pub struct Hold {
    /// Ctrl gauche enfoncé depuis… (ms), si rien d'autre ne s'est passé.
    since: Option<u64>,
    /// Ctrl gauche est enfoncé (même si l'appui est annulé).
    down: bool,
    shown: bool,
}

/// Ce que le crochet voit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input {
    CtrlDown,
    CtrlUp,
    /// Une autre touche, un clic, la molette.
    Other,
}

impl Hold {
    /// Une entrée. Renvoie Some(Hide) si l'aide-mémoire doit se fermer.
    pub fn input(&mut self, input: Input, now: u64) -> Option<CheatEvent> {
        match input {
            Input::CtrlDown => {
                // La répétition automatique renvoie « enfoncé » : on garde le début.
                if !self.down {
                    self.down = true;
                    self.since = Some(now);
                }
                None
            }
            Input::CtrlUp => {
                self.down = false;
                self.since = None;
                if std::mem::take(&mut self.shown) {
                    Some(CheatEvent::Hide)
                } else {
                    None
                }
            }
            Input::Other => {
                self.since = None;
                None
            }
        }
    }

    /// Le temps passe : vrai quand il faut ouvrir (une seule fois par appui).
    pub fn due(&mut self, now: u64) -> bool {
        match self.since {
            Some(t) if !self.shown && now.saturating_sub(t) >= HOLD_MS => {
                self.shown = true;
                self.since = None;
                true
            }
            _ => false,
        }
    }
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{CheatEvent, Hold, Input};
    use crate::sync::LockExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use ::windows::Win32::System::Threading::GetCurrentThreadId;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, LLMHF_INJECTED, MSG,
        MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_MOUSEMOVE, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    /// Alt Gr envoie un faux Ctrl gauche avec chaque Alt droit : l'Alt droit
    /// qui suit compte comme « une autre touche » et annule.
    const VK_LCONTROL: u32 = 0xA2;

    static STATE: Mutex<Hold> = Mutex::new(Hold { since: None, down: false, shown: false });
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

    fn now_ms() -> u64 {
        START.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    type Sink = Arc<dyn Fn(CheatEvent) + Send + Sync>;
    static SINK: Mutex<Option<Sink>> = Mutex::new(None);

    fn feed(input: Input) {
        let event = STATE.locked().input(input, now_ms());
        if let Some(e) = event {
            let sink = SINK.locked().clone();
            if let Some(sink) = sink {
                // Hors du crochet : il doit rendre la main tout de suite.
                std::thread::spawn(move || sink(e));
            }
        }
    }

    unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            if info.flags.0 & LLKHF_INJECTED.0 == 0 {
                let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                let up = matches!(wparam.0 as u32, WM_KEYUP | WM_SYSKEYUP);
                if info.vkCode == VK_LCONTROL {
                    if down {
                        feed(Input::CtrlDown);
                    } else if up {
                        feed(Input::CtrlUp);
                    }
                } else if down {
                    feed(Input::Other);
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    unsafe extern "system" fn mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && wparam.0 as u32 != WM_MOUSEMOVE {
            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            if info.flags & LLMHF_INJECTED == 0 {
                feed(Input::Other);
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// Le fil des crochets ; tout s'arrête quand on le lâche.
    pub struct CheatListener {
        thread_id: u32,
        stop: Arc<AtomicBool>,
    }

    impl Drop for CheatListener {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            *SINK.locked() = None;
            *STATE.locked() = Hold::default();
        }
    }

    pub fn listen(sink: Box<dyn Fn(CheatEvent) + Send + Sync>) -> Result<CheatListener, String> {
        let sink: Sink = Arc::from(sink);
        *SINK.locked() = Some(sink.clone());
        *STATE.locked() = Hold::default();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
        std::thread::Builder::new()
            .name("ondine-aide-memoire".into())
            .spawn(move || unsafe {
                let module = GetModuleHandleW(None).ok().map(Into::into);
                let kb = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0) {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e.to_string()));
                        return;
                    }
                };
                let ms = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0).ok();
                let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                if let Some(ms) = ms {
                    let _ = UnhookWindowsHookEx(ms);
                }
                let _ = UnhookWindowsHookEx(kb);
            })
            .map_err(|e| e.to_string())?;
        let thread_id = match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(id)) => id,
            Ok(Err(e)) => {
                *SINK.locked() = None;
                return Err(e);
            }
            Err(_) => {
                *SINK.locked() = None;
                return Err("le crochet du clavier n'a pas démarré".into());
            }
        };
        // Le temps qui passe : un coup d'œil tous les 100 ms.
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(100));
                if STATE.locked().due(now_ms()) {
                    sink(CheatEvent::Show(super::super::dictation::foreground_app()));
                }
            }
        });
        Ok(CheatListener { thread_id, stop })
    }
}

#[cfg(not(windows))]
mod stub {
    use super::CheatEvent;

    pub struct CheatListener;

    pub fn listen(_sink: Box<dyn Fn(CheatEvent) + Send + Sync>) -> Result<CheatListener, String> {
        Err("seulement sous Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_after_a_long_lonely_hold_and_closes_on_release() {
        let mut h = Hold::default();
        h.input(Input::CtrlDown, 0);
        assert!(!h.due(1000));
        h.input(Input::CtrlDown, 1200); // répétition automatique
        assert!(h.due(1500));
        assert!(!h.due(3000), "une seule fois par appui");
        assert_eq!(h.input(Input::CtrlUp, 3100), Some(CheatEvent::Hide));
    }

    #[test]
    fn a_shortcut_or_a_click_cancels() {
        let mut h = Hold::default();
        h.input(Input::CtrlDown, 0);
        h.input(Input::Other, 300); // Ctrl+C, Ctrl+clic, Ctrl+molette
        assert!(!h.due(5000));
        assert_eq!(h.input(Input::CtrlUp, 5100), None);
        // Un nouvel appui repart de zéro.
        h.input(Input::CtrlDown, 6000);
        assert!(!h.due(7000));
        assert!(h.due(7500));
    }
}
