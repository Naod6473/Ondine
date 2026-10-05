// La luminosité des écrans. Deux chemins, selon l'écran :
//
//   - l'écran INTÉGRÉ d'un portable : Windows le règle lui-même, on passe par
//     WMI (l'« annuaire » d'informations de Windows), classes
//     WmiMonitorBrightness (lire) et WmiMonitorBrightnessMethods (changer) ;
//   - un écran EXTERNE : c'est l'écran qui décide. Windows lui parle par le
//     câble avec le protocole DDC/CI (fonctions de dxva2.dll). Beaucoup
//     d'écrans le gèrent, certains non (ou il est coupé dans leur menu) :
//     ceux-là n'apparaissent simplement pas.
//
// Un PC fixe n'a pas d'écran intégré, un portable sans écran branché n'a pas
// d'écran externe : on renvoie la liste de ce qui répond.
// Sous Linux (vérifications), la liste est vide.

use serde::Serialize;

/// Un écran dont on peut régler la luminosité.
#[derive(Debug, Clone, Serialize)]
pub struct Screen {
    /// "internal" pour l'écran du portable, "ext-0", "ext-1"… pour les externes.
    pub id: String,
    /// Le nom à afficher (« Écran intégré », ou celui donné par l'écran).
    pub name: String,
    /// De 0 à 100.
    pub brightness: u32,
}

#[cfg(windows)]
mod imp {
    use super::Screen;
    use std::sync::Mutex;

    /// Un seul dialogue DDC/CI à la fois : les écrans n'aiment pas les
    /// questions qui se croisent sur le câble.
    static DDC: Mutex<()> = Mutex::new(());

    pub fn list() -> Vec<Screen> {
        let mut screens = Vec::new();
        if let Some(brightness) = crate::platform::with_com(internal::get) {
            screens.push(Screen { id: "internal".into(), name: "Écran intégré".into(), brightness });
        }
        let _guard = DDC.lock().unwrap_or_else(|e| e.into_inner());
        screens.extend(external::list());
        screens
    }

    pub fn set(id: &str, percent: u32) -> Result<(), String> {
        let percent = percent.min(100);
        if id == "internal" {
            return crate::platform::with_com(|| internal::set(percent));
        }
        let index: usize = id
            .strip_prefix("ext-")
            .and_then(|n| n.parse().ok())
            .ok_or("écran inconnu")?;
        let _guard = DDC.lock().unwrap_or_else(|e| e.into_inner());
        external::set(index, percent)
    }

    /// L'écran du portable, par WMI. Il faut COM (voir `with_com`).
    mod internal {
        use ::windows::core::{w, BSTR, PCWSTR};
        use ::windows::Win32::System::Com::{
            CoCreateInstance, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
        };
        use ::windows::Win32::System::Variant::{VariantClear, VARIANT, VT_BSTR, VT_I4, VT_UI1};
        use ::windows::Win32::System::Wmi::{
            IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY,
            WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_GENERIC_FLAG_TYPE,
        };

        /// Délai d'attente pour chaque objet renvoyé par WMI (millisecondes).
        const WAIT_MS: i32 = 2000;

        /// Se connecte à l'espace « root\WMI », où vivent les classes de luminosité.
        fn connect() -> Option<IWbemServices> {
            unsafe {
                let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER).ok()?;
                let empty = BSTR::new();
                let services = locator
                    .ConnectServer(&BSTR::from("root\\WMI"), &empty, &empty, &empty, 0, &empty, None)
                    .ok()?;
                // Les réglages de sécurité recommandés par Microsoft pour parler à
                // WMI : authentification Windows (10 = RPC_C_AUTHN_WINNT), pas
                // d'autorisation particulière (0 = RPC_C_AUTHZ_NONE).
                CoSetProxyBlanket(&services, 10, 0, PCWSTR::null(), RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, None, EOAC_NONE).ok()?;
                Some(services)
            }
        }

        /// Le premier objet renvoyé par une requête WQL (il n'y a qu'un écran intégré).
        fn first(services: &IWbemServices, query: &str) -> Option<IWbemClassObject> {
            unsafe {
                let flags = WBEM_GENERIC_FLAG_TYPE(WBEM_FLAG_FORWARD_ONLY.0 | WBEM_FLAG_RETURN_IMMEDIATELY.0);
                let rows: IEnumWbemClassObject = services.ExecQuery(&BSTR::from("WQL"), &BSTR::from(query), flags, None).ok()?;
                let mut found = [None];
                let mut count = 0u32;
                rows.Next(WAIT_MS, &mut found, &mut count).ok().ok()?;
                if count == 0 {
                    return None;
                }
                found[0].take()
            }
        }

        /// Une valeur VARIANT d'un nombre (VT_UI1 = octet, VT_I4 = entier).
        fn number(vt: ::windows::Win32::System::Variant::VARENUM, value: i32) -> VARIANT {
            let mut v = VARIANT::default();
            unsafe {
                let inner = &mut *v.Anonymous.Anonymous;
                inner.vt = vt;
                if vt == VT_UI1 {
                    inner.Anonymous.bVal = value as u8;
                } else {
                    inner.Anonymous.lVal = value;
                }
            }
            v
        }

        /// La luminosité de l'écran intégré (0-100), ou None (pas de portable).
        pub fn get() -> Option<u32> {
            let services = connect()?;
            let row = first(&services, "SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active = TRUE")?;
            unsafe {
                let mut value = VARIANT::default();
                row.Get(w!("CurrentBrightness"), 0, &mut value, None, None).ok()?;
                let inner = &value.Anonymous.Anonymous;
                let level = match inner.vt {
                    VT_UI1 => Some(inner.Anonymous.bVal as u32),
                    VT_I4 => Some(inner.Anonymous.lVal.max(0) as u32),
                    _ => None,
                };
                let _ = VariantClear(&mut value);
                level
            }
        }

        pub fn set(percent: u32) -> Result<(), String> {
            const NONE: &str = "pas d'écran intégré réglable";
            let services = connect().ok_or("WMI ne répond pas")?;
            let target = first(&services, "SELECT * FROM WmiMonitorBrightnessMethods WHERE Active = TRUE").ok_or(NONE)?;
            unsafe {
                // Le « chemin » de l'écran, pour lui envoyer la méthode.
                let mut path = VARIANT::default();
                target.Get(w!("__PATH"), 0, &mut path, None, None).map_err(|_| NONE)?;
                let path_text = if path.Anonymous.Anonymous.vt == VT_BSTR {
                    BSTR::clone(&path.Anonymous.Anonymous.Anonymous.bstrVal)
                } else {
                    BSTR::new()
                };
                let _ = VariantClear(&mut path);
                if path_text.is_empty() {
                    return Err(NONE.into());
                }

                // Les paramètres de WmiSetBrightness(Timeout, Brightness).
                let mut class: Option<IWbemClassObject> = None;
                services
                    .GetObject(&BSTR::from("WmiMonitorBrightnessMethods"), WBEM_GENERIC_FLAG_TYPE(0), None, Some(&mut class), None)
                    .map_err(|_| NONE)?;
                let class = class.ok_or(NONE)?;
                let mut signature: Option<IWbemClassObject> = None;
                class.GetMethod(w!("WmiSetBrightness"), 0, &mut signature, std::ptr::null_mut()).map_err(|_| NONE)?;
                let params = signature.ok_or(NONE)?.SpawnInstance(0).map_err(|_| NONE)?;
                // Timeout = 0 : le réglage reste. WMI veut un VT_I4 pour un « uint32 ».
                let timeout = number(VT_I4, 0);
                let level = number(VT_UI1, percent as i32);
                params.Put(w!("Timeout"), 0, &timeout, 0).map_err(|e| e.to_string())?;
                params.Put(w!("Brightness"), 0, &level, 0).map_err(|e| e.to_string())?;
                services
                    .ExecMethod(&path_text, &BSTR::from("WmiSetBrightness"), WBEM_GENERIC_FLAG_TYPE(0), None, &params, None, None)
                    .map_err(|e| format!("Windows a refusé le réglage ({e})"))?;
            }
            Ok(())
        }
    }

    /// Les écrans externes, par DDC/CI.
    mod external {
        use super::Screen;
        use ::windows::core::BOOL;
        use ::windows::Win32::Devices::Display::{
            DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR,
            SetMonitorBrightness, PHYSICAL_MONITOR,
        };
        use ::windows::Win32::Foundation::{LPARAM, RECT};
        use ::windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};

        /// Appelée par Windows pour chaque écran : on range son identifiant.
        unsafe extern "system" fn collect(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            let list = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
            list.push(monitor);
            BOOL(1) // continuer
        }

        /// Tous les écrans « physiques » (un écran logique peut en regrouper plusieurs).
        fn physical_monitors() -> Vec<PHYSICAL_MONITOR> {
            let mut logical: Vec<HMONITOR> = Vec::new();
            unsafe {
                let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut logical as *mut _ as isize));
            }
            let mut all = Vec::new();
            for monitor in logical {
                let mut count = 0u32;
                if unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count) }.is_err() || count == 0 {
                    continue;
                }
                let mut found = vec![PHYSICAL_MONITOR::default(); count as usize];
                if unsafe { GetPhysicalMonitorsFromHMONITOR(monitor, &mut found) }.is_ok() {
                    all.extend(found);
                }
            }
            all
        }

        /// (min, actuelle, max) si l'écran répond en DDC/CI.
        fn read(monitor: &PHYSICAL_MONITOR) -> Option<(u32, u32, u32)> {
            let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
            let ok = unsafe { GetMonitorBrightness(monitor.hPhysicalMonitor, &mut min, &mut cur, &mut max) };
            (ok != 0 && max > min).then_some((min, cur, max))
        }

        fn name(monitor: &PHYSICAL_MONITOR, index: usize) -> String {
            // Une copie : la structure est « tassée » (pas d'accès par référence).
            let raw = monitor.szPhysicalMonitorDescription;
            let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
            let text = String::from_utf16_lossy(&raw[..len]).trim().to_string();
            // Windows donne souvent un nom générique : on numérote pour s'y retrouver.
            if text.is_empty() || text.starts_with("Generic") || text.starts_with("Moniteur") {
                format!("Écran externe {}", index + 1)
            } else {
                text
            }
        }

        pub fn list() -> Vec<Screen> {
            let monitors = physical_monitors();
            let mut screens = Vec::new();
            // Le numéro « ext-N » compte tous les écrans physiques, pour que
            // `set` retrouve le même. L'écran du portable ne répond pas en DDC/CI.
            for (index, monitor) in monitors.iter().enumerate() {
                if let Some((min, cur, max)) = read(monitor) {
                    let percent = (cur.saturating_sub(min)) * 100 / (max - min);
                    screens.push(Screen { id: format!("ext-{index}"), name: name(monitor, screens.len()), brightness: percent });
                }
            }
            unsafe {
                let _ = DestroyPhysicalMonitors(&monitors);
            }
            screens
        }

        pub fn set(index: usize, percent: u32) -> Result<(), String> {
            let monitors = physical_monitors();
            let result = match monitors.get(index) {
                None => Err("écran débranché ?".to_string()),
                Some(monitor) => match read(monitor) {
                    None => Err("cet écran ne se règle pas depuis Windows (DDC/CI coupé dans son menu ?)".to_string()),
                    Some((min, _, max)) => {
                        let value = min + (max - min) * percent / 100;
                        if unsafe { SetMonitorBrightness(monitor.hPhysicalMonitor, value) } != 0 {
                            Ok(())
                        } else {
                            Err("l'écran n'a pas accepté le réglage".to_string())
                        }
                    }
                },
            };
            unsafe {
                let _ = DestroyPhysicalMonitors(&monitors);
            }
            result
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Screen;

    pub fn list() -> Vec<Screen> {
        Vec::new()
    }
    pub fn set(_id: &str, _percent: u32) -> Result<(), String> {
        Err("pas d'écran réglable (hors Windows)".into())
    }
}

pub use imp::{list, set};
