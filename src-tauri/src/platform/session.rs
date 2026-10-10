// La session Windows est-elle verrouillée (Win+L, écran de verrouillage) ?
// Sert au déclencheur « Je reviens devant le PC » des règles : on regarde
// toutes les quelques secondes, et le passage verrouillée → déverrouillée
// déclenche la règle.
//
// WTSQuerySessionInformationW(WTSSessionInfoEx) donne SessionFlags :
// WTS_SESSIONSTATE_LOCK (0) ou WTS_SESSIONSTATE_UNLOCK (1). (Sous Windows 7
// les deux valeurs étaient inversées ; Ondine demande Windows 10 ou plus.)
// Rien n'est écouté : c'est une simple lecture de l'état de la session.

#[cfg(windows)]
mod imp {
    use ::windows::core::PWSTR;
    use ::windows::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
        WTS_SESSIONSTATE_UNLOCK,
    };

    pub fn locked() -> Option<bool> {
        let mut buf = PWSTR::null();
        let mut size = 0u32;
        unsafe { WTSQuerySessionInformationW(Some(WTS_CURRENT_SERVER_HANDLE), WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut buf, &mut size) }.ok()?;
        if buf.is_null() {
            return None;
        }
        let result = if (size as usize) >= std::mem::size_of::<WTSINFOEXW>() {
            // SAFETY : Windows a rempli au moins un WTSINFOEXW (taille vérifiée) ; niveau 1 seulement.
            let info = unsafe { &*(buf.0 as *const WTSINFOEXW) };
            if info.Level == 1 {
                let flags = unsafe { info.Data.WTSInfoExLevel1.SessionFlags } as u32;
                match flags {
                    WTS_SESSIONSTATE_LOCK => Some(true),
                    WTS_SESSIONSTATE_UNLOCK => Some(false),
                    _ => None, // inconnu
                }
            } else {
                None
            }
        } else {
            None
        };
        unsafe { WTSFreeMemory(buf.0 as *mut _) };
        result
    }
}

#[cfg(not(windows))]
mod imp {
    /// Hors Windows : on ne sait pas.
    pub fn locked() -> Option<bool> {
        None
    }
}

pub use imp::locked;
