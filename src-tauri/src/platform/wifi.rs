// Le nom du Wi-Fi connecté (SSID), pour les profils (« Maison » quand on est
// sur le Wi-Fi de la maison). Rien n'est envoyé : on demande à Windows à quel
// réseau il est connecté.
//
// Windows : l'API « Native Wifi » (wlanapi.dll) : WlanOpenHandle →
// WlanEnumInterfaces → WlanQueryInterface(current_connection) pour chaque
// carte Wi-Fi connectée.
// ATTENTION : depuis Windows 11 24H2, Windows ne donne ce nom qu'aux applis
// autorisées à utiliser la localisation (Paramètres → Confidentialité →
// Localisation → « Autoriser les applications de bureau »). Sans cela, on
// reçoit un refus et la fonction renvoie None.

/// Le nom du premier Wi-Fi connecté, ou None (pas de Wi-Fi, pas le droit…).
pub fn current_ssid() -> Option<String> {
    imp::current_ssid()
}

/// Les octets d'un SSID → texte (un SSID n'est pas forcément de l'UTF-8 valide).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows
fn ssid_text(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(windows)]
mod imp {
    use super::ssid_text;
    use ::windows::Win32::Foundation::HANDLE;
    use ::windows::Win32::NetworkManagement::WiFi::{
        wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle,
        WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO, WLAN_INTERFACE_INFO_LIST,
    };

    pub fn current_ssid() -> Option<String> {
        unsafe {
            let mut version = 0u32;
            let mut handle = HANDLE::default();
            // 2 = version de l'API pour Windows Vista et plus récent.
            if WlanOpenHandle(2, None, &mut version, &mut handle) != 0 {
                return None; // pas de service WLAN (PC sans Wi-Fi)
            }
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            let mut found = None;
            if WlanEnumInterfaces(handle, None, &mut list) == 0 && !list.is_null() {
                let count = (*list).dwNumberOfItems as usize;
                // La liste est un tableau C de longueur variable après l'en-tête.
                let first = std::ptr::addr_of!((*list).InterfaceInfo) as *const WLAN_INTERFACE_INFO;
                for i in 0..count {
                    let info = &*first.add(i);
                    if info.isState != wlan_interface_state_connected {
                        continue;
                    }
                    let mut size = 0u32;
                    let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
                    let rc = WlanQueryInterface(handle, &info.InterfaceGuid, wlan_intf_opcode_current_connection, None, &mut size, &mut data, None);
                    if rc != 0 || data.is_null() {
                        continue; // refus (localisation coupée) ou carte qui vient de se déconnecter
                    }
                    let attrs = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                    let ssid = &attrs.wlanAssociationAttributes.dot11Ssid;
                    let len = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
                    found = ssid_text(&ssid.ucSSID[..len]);
                    WlanFreeMemory(data);
                    if found.is_some() {
                        break;
                    }
                }
            }
            if !list.is_null() {
                WlanFreeMemory(list as *const core::ffi::c_void);
            }
            WlanCloseHandle(handle, None);
            found
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// Hors Windows (vérifications sur Linux) : `iwgetid -r` si l'outil existe.
    pub fn current_ssid() -> Option<String> {
        let out = std::process::Command::new("iwgetid").arg("-r").output().ok()?;
        if !out.status.success() {
            return None;
        }
        super::ssid_text(&out.stdout)
    }
}

#[cfg(test)]
mod tests {
    use super::ssid_text;

    #[test]
    fn ssid_bytes_become_text() {
        assert_eq!(ssid_text(b"Maison\n").as_deref(), Some("Maison"));
        assert_eq!(ssid_text(b""), None);
        assert_eq!(ssid_text(&[0xC3, 0xA9, b't', b'e']).as_deref(), Some("éte"));
    }
}
