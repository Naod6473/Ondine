// Contrôles → Outils → « Mode nettoyage » (1.2.5) : le clavier et la souris
// sont bloqués quelques secondes, le temps de les essuyer.
//
// Deux crochets « bas niveau » (WH_KEYBOARD_LL, WH_MOUSE_LL), dans leur propre
// fil avec sa boucle de messages, avalent chaque frappe et chaque mouvement
// (ils renvoient 1). Un second fil compte le temps, prévient l'île chaque
// seconde, et arrête tout :
//   - à la fin du temps (jamais plus de MAX_SECONDS, quoi qu'on demande) ;
//   - si Échap est maintenue ESC_HOLD_MS (la seule sortie au clavier) ;
// Ctrl+Alt+Suppr reste toujours possible : Windows ne laisse personne le
// bloquer. Les frappes simulées par un programme ne sont pas bloquées.

// Sous Linux, seule la logique pure sert (aux tests).
#![cfg_attr(not(windows), allow(dead_code))]

/// Le temps le plus long qu'on accepte, quoi qu'on demande.
pub const MAX_SECONDS: u32 = 120;
/// Échap maintenue aussi longtemps arrête le nettoyage.
pub const ESC_HOLD_MS: u64 = 2000;

/// Ce que l'île reçoit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tick {
    /// Secondes restantes.
    Left(u32),
    /// Terminé ; `early` : arrêté avec Échap.
    Done { early: bool },
}

/// Les secondes restantes (arrondies au-dessus) après `elapsed_ms`.
pub fn seconds_left(total: u32, elapsed_ms: u64) -> u32 {
    let total_ms = u64::from(total) * 1000;
    total_ms.saturating_sub(elapsed_ms).div_ceil(1000) as u32
}

/// Échap est-elle maintenue assez longtemps ? (`since` : depuis quand elle
/// est enfoncée, en ms, 0 = relâchée)
pub fn escape_held(since: u64, now: u64) -> bool {
    since != 0 && now.saturating_sub(since) >= ESC_HOLD_MS
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{escape_held, seconds_left, Tick, MAX_SECONDS};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use ::windows::Win32::System::Threading::GetCurrentThreadId;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, LLMHF_INJECTED, MSG,
        MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    const VK_ESCAPE: u32 = 0x1B;

    static RUNNING: AtomicBool = AtomicBool::new(false);
    /// Depuis quand Échap est enfoncée (ms depuis START), 0 = relâchée.
    static ESC_SINCE: AtomicU64 = AtomicU64::new(0);
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

    fn now_ms() -> u64 {
        START.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
    }

    unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            if info.flags.0 & LLKHF_INJECTED.0 == 0 {
                if info.vkCode == VK_ESCAPE {
                    match wparam.0 as u32 {
                        WM_KEYDOWN | WM_SYSKEYDOWN => {
                            let _ = ESC_SINCE.compare_exchange(0, now_ms(), Ordering::Relaxed, Ordering::Relaxed);
                        }
                        WM_KEYUP | WM_SYSKEYUP => ESC_SINCE.store(0, Ordering::Relaxed),
                        _ => {}
                    }
                }
                return LRESULT(1); // avalée
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    unsafe extern "system" fn mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            if info.flags & LLMHF_INJECTED == 0 {
                return LRESULT(1);
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    /// Bloque le clavier et la souris `seconds` secondes ; `on_tick` reçoit
    /// le temps restant chaque seconde, puis la fin.
    pub fn start(seconds: u32, on_tick: Box<dyn Fn(Tick) + Send>) -> Result<(), String> {
        if RUNNING.swap(true, Ordering::Relaxed) {
            return Err("le nettoyage est déjà en cours".into());
        }
        let total = seconds.clamp(5, MAX_SECONDS);
        ESC_SINCE.store(0, Ordering::Relaxed);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
        let spawned = std::thread::Builder::new().name("ondine-nettoyage".into()).spawn(move || unsafe {
            let module = GetModuleHandleW(None).ok().map(Into::into);
            let kb = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0) {
                Ok(h) => h,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            let ms = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0) {
                Ok(h) => h,
                Err(e) => {
                    let _ = UnhookWindowsHookEx(kb);
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
            let _ = UnhookWindowsHookEx(ms);
            let _ = UnhookWindowsHookEx(kb);
        });
        let hooks = match spawned {
            Ok(t) => t,
            Err(e) => {
                RUNNING.store(false, Ordering::Relaxed);
                return Err(e.to_string());
            }
        };
        let thread_id = match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(id)) => id,
            Ok(Err(e)) => {
                RUNNING.store(false, Ordering::Relaxed);
                return Err(format!("impossible de bloquer le clavier : {e}"));
            }
            Err(_) => {
                RUNNING.store(false, Ordering::Relaxed);
                return Err("le blocage du clavier n'a pas démarré".into());
            }
        };
        std::thread::spawn(move || {
            let began = Instant::now();
            let mut last = u32::MAX;
            let early = loop {
                let left = seconds_left(total, began.elapsed().as_millis() as u64);
                if left == 0 {
                    break false;
                }
                if escape_held(ESC_SINCE.load(Ordering::Relaxed), now_ms()) {
                    break true;
                }
                if left != last {
                    last = left;
                    on_tick(Tick::Left(left));
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            unsafe {
                let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = hooks.join();
            RUNNING.store(false, Ordering::Relaxed);
            on_tick(Tick::Done { early });
        });
        Ok(())
    }
}

#[cfg(not(windows))]
mod stub {
    use super::Tick;

    pub fn start(_seconds: u32, _on_tick: Box<dyn Fn(Tick) + Send>) -> Result<(), String> {
        Err("seulement sous Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countdown_rounds_up() {
        assert_eq!(seconds_left(30, 0), 30);
        assert_eq!(seconds_left(30, 1), 30);
        assert_eq!(seconds_left(30, 1000), 29);
        assert_eq!(seconds_left(30, 29_999), 1);
        assert_eq!(seconds_left(30, 30_000), 0);
        assert_eq!(seconds_left(30, 99_000), 0);
    }

    #[test]
    fn escape_must_be_held() {
        assert!(!escape_held(0, 10_000));
        assert!(!escape_held(5_000, 6_999));
        assert!(escape_held(5_000, 7_000));
    }
}
