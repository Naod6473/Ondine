// « Rester éveillé » (module awake) : demander à Windows de ne pas se mettre en
// veille, et l'arrêt programmé (éteindre, veille, redémarrer, verrouiller).
//
// - Rester éveillé : SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED
//   [| ES_DISPLAY_REQUIRED]). Cette demande appartient au FIL qui l'a faite :
//   le module l'appelle toujours depuis son fil à lui (awake.rs), et la relâche
//   avec ES_CONTINUOUS seul. Si Ondine se ferme (ou plante), Windows l'oublie
//   tout seul avec le fil. Ce n'est pas l'économiseur d'écran de Windows : il
//   peut toujours s'afficher (et verrouiller la session) à son heure.
// - Éteindre / redémarrer : InitiateShutdownW, SANS SHUTDOWN_FORCE_OTHERS ni
//   SHUTDOWN_FORCE_SELF : Windows demande poliment aux applis de se fermer, et
//   une appli qui a un document non enregistré peut l'empêcher (l'écran « Ces
//   applications empêchent l'arrêt » de Windows). Pas de délai (le compte à
//   rebours est celui d'Ondine, annulable). Le privilège SeShutdownPrivilege,
//   que tout compte a mais qui est éteint par défaut, est allumé juste avant
//   pour ce processus. (shutdown.exe aurait été plus court, mais `/t` > 0 y
//   implique `/f`, la fermeture forcée : on ne s'en sert pas.)
// - Veille : SetSuspendState(veille, pas d'hibernation, sans forcer).
// - Verrouiller : LockWorkStation, comme Windows + L.

/// Ce qu'on demande à Windows : None = plus rien (relâche), Some(écran) = ne
/// pas dormir, et garder aussi l'écran allumé si `true`.
pub fn hold(want: Option<bool>) -> Result<(), String> {
    imp::hold(want)
}

/// Éteindre (`shutdown`), mettre en veille (`sleep`), redémarrer (`restart`)
/// ou verrouiller (`lock`) le PC. Ne force jamais la fermeture des applis.
pub fn act(action: &str) -> Result<(), String> {
    imp::act(action)
}

#[cfg(windows)]
mod imp {
    use ::windows::core::{w, PCWSTR};
    use ::windows::Win32::Foundation::{CloseHandle, HANDLE, LUID};
    use ::windows::Win32::Security::{AdjustTokenPrivileges, LookupPrivilegeValueW, SE_PRIVILEGE_ENABLED, SE_SHUTDOWN_NAME, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY};
    use ::windows::Win32::System::Power::{SetSuspendState, SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
    use ::windows::Win32::System::Shutdown::{InitiateShutdownW, LockWorkStation, SHTDN_REASON_FLAG_PLANNED, SHTDN_REASON_MAJOR_OTHER, SHTDN_REASON_MINOR_OTHER, SHUTDOWN_POWEROFF, SHUTDOWN_RESTART};
    use ::windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    pub fn hold(want: Option<bool>) -> Result<(), String> {
        let flags = match want {
            None => ES_CONTINUOUS,
            Some(false) => ES_CONTINUOUS | ES_SYSTEM_REQUIRED,
            Some(true) => ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED,
        };
        // SAFETY : simple appel sans pointeur ; renvoie 0 en cas d'échec.
        let previous = unsafe { SetThreadExecutionState(flags) };
        if previous.0 == 0 {
            return Err("Windows a refusé de rester éveillé".into());
        }
        Ok(())
    }

    /// Allume SeShutdownPrivilege pour ce processus (requis par InitiateShutdownW et la veille).
    fn shutdown_privilege() -> Result<(), String> {
        let mut token = HANDLE::default();
        // SAFETY : jeton du processus courant, fermé plus bas.
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token) }.map_err(|e| format!("jeton : {e}"))?;
        let mut luid = LUID::default();
        let result = unsafe { LookupPrivilegeValueW(PCWSTR::null(), SE_SHUTDOWN_NAME, &mut luid) }.map_err(|e| format!("privilège : {e}")).and_then(|_| {
            let mut tp = TOKEN_PRIVILEGES { PrivilegeCount: 1, ..Default::default() };
            tp.Privileges[0].Luid = luid;
            tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
            // SAFETY : `tp` vit jusqu'à la fin de l'appel ; pas d'état précédent demandé.
            unsafe { AdjustTokenPrivileges(token, false, Some(&tp), 0, None, None) }.map_err(|e| format!("privilège : {e}"))
        });
        // SAFETY : le jeton ouvert plus haut.
        unsafe {
            let _ = CloseHandle(token);
        }
        result
    }

    pub fn act(action: &str) -> Result<(), String> {
        match action {
            "lock" => unsafe { LockWorkStation() }.map_err(|e| format!("verrouillage : {e}")),
            "sleep" => {
                // Sans le privilège, la veille échoue sans rien dire : on essaie quand même.
                let _ = shutdown_privilege();
                // SAFETY : veille (pas d'hibernation), sans forcer, réveils permis.
                if unsafe { SetSuspendState(false, false, false) } {
                    Ok(())
                } else {
                    Err("Windows a refusé la mise en veille".into())
                }
            }
            "shutdown" | "restart" => {
                shutdown_privilege()?;
                let flags = if action == "restart" { SHUTDOWN_RESTART } else { SHUTDOWN_POWEROFF };
                let reason = SHTDN_REASON_MAJOR_OTHER | SHTDN_REASON_MINOR_OTHER | SHTDN_REASON_FLAG_PLANNED;
                // SAFETY : chaînes constantes ; ce PC (machine nulle), aucun délai, aucune fermeture forcée.
                let code = unsafe { InitiateShutdownW(PCWSTR::null(), w!("Arrêt programmé par Ondine"), 0, flags, reason) };
                if code == 0 {
                    Ok(())
                } else {
                    Err(format!("Windows a refusé l'arrêt (code {code})"))
                }
            }
            other => Err(format!("action inconnue : {other}")),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// Hors Windows (tests) : rien à demander.
    pub fn hold(_want: Option<bool>) -> Result<(), String> {
        Ok(())
    }

    pub fn act(action: &str) -> Result<(), String> {
        Err(format!("« {action} » : seulement sous Windows"))
    }
}
