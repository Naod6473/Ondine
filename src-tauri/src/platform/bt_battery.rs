// La batterie des appareils Bluetooth (écouteurs, casque, souris, clavier),
// pour l'onglet Contrôles.
//
// Windows lit déjà ces niveaux pour sa page Paramètres → Bluetooth et
// appareils, et les range dans une propriété du périphérique :
//   DEVPKEY_Bluetooth_Battery = {104EA319-6EE2-4701-BD47-8DDBF425BBE5}, 2
//   (un octet : 0 à 100 %).
// On parcourt les périphériques présents (SetupDi) dont l'identifiant
// commence par « BTH » (BTHENUM : Bluetooth classique, BTHLE / BTHLEDEVICE :
// Bluetooth basse consommation) et on lit cette propriété. Aucun appareil
// n'est contacté par Ondine : pas de connexion GATT, rien d'envoyé.
//
// Ce qui donne un niveau : les appareils dont Windows montre la batterie dans
// ses Paramètres (casques et écouteurs qui la donnent en mains libres « HFP »,
// souris et claviers BLE avec le « Battery Service »). Ce qui n'en donne pas :
// les appareils qui ne passent que par le pilote ou l'appli du fabricant
// (certaines souris Logitech Bolt/Unifying, casques Sony/Bose via leur appli,
// manettes) : sans pilote, rien à lire.
//
// Un appareil appairé mais éteint garde parfois son dernier niveau : on lit
// aussi « connecté » ({83DA6326-97A6-4088-9453-A1923F573B29}, 15) quand
// Windows le donne, pour ne pas alerter sur un appareil rangé dans un tiroir.

use serde::Serialize;

/// Un appareil Bluetooth et son niveau de batterie.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BtBattery {
    /// Le nom affiché par Windows (« WH-1000XM4 », « MX Master 3 »).
    pub name: String,
    pub percent: u8,
    /// Connecté en ce moment (None : Windows ne le dit pas).
    pub connected: Option<bool>,
}

/// Plusieurs nœuds du même appareil portent souvent la même propriété (le
/// casque, et son service mains libres) : on garde un exemplaire par nom, le
/// plus bas, en préférant l'information « connecté ».
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn merge(found: Vec<BtBattery>) -> Vec<BtBattery> {
    let mut out: Vec<BtBattery> = Vec::new();
    for b in found {
        if b.name.trim().is_empty() || b.percent > 100 {
            continue;
        }
        match out.iter_mut().find(|o| o.name.eq_ignore_ascii_case(&b.name)) {
            Some(o) => {
                o.percent = o.percent.min(b.percent);
                if o.connected.is_none() || b.connected == Some(true) {
                    o.connected = b.connected.or(o.connected);
                }
            }
            None => out.push(b),
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    out
}

#[cfg(windows)]
mod imp {
    use super::{merge, BtBattery};
    use ::windows::core::{GUID, PCWSTR};
    use ::windows::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW, SetupDiGetDevicePropertyW, DIGCF_ALLCLASSES,
        DIGCF_PRESENT, HDEVINFO, SP_DEVINFO_DATA,
    };
    use ::windows::Win32::Devices::Properties::{DEVPKEY_Device_FriendlyName, DEVPROPTYPE, DEVPROP_TYPE_BOOLEAN, DEVPROP_TYPE_BYTE, DEVPROP_TYPE_STRING};
    use ::windows::Win32::Foundation::DEVPROPKEY;

    const BATTERY: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5), pid: 2 };
    const CONNECTED: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0x83da6326_97a6_4088_9453_a1923f573b29), pid: 15 };

    /// Une liste de périphériques de SetupDi, détruite toute seule à la fin.
    struct Set(HDEVINFO);
    impl Drop for Set {
        fn drop(&mut self) {
            unsafe {
                let _ = SetupDiDestroyDeviceInfoList(self.0);
            }
        }
    }

    fn property(set: &Set, info: &SP_DEVINFO_DATA, key: &DEVPROPKEY, buf: &mut [u8]) -> Option<(DEVPROPTYPE, usize)> {
        let mut kind = DEVPROPTYPE(0);
        let mut size = 0u32;
        unsafe { SetupDiGetDevicePropertyW(set.0, info, key, &mut kind, Some(buf), Some(&mut size), 0) }.ok()?;
        Some((kind, size as usize))
    }

    fn text(buf: &[u8], len: usize) -> String {
        let wide: Vec<u16> = buf[..len.min(buf.len())].as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&wide).trim_end_matches('\0').trim().to_string()
    }

    pub fn devices() -> Vec<BtBattery> {
        let Ok(handle) = (unsafe { SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_ALLCLASSES | DIGCF_PRESENT) }) else { return Vec::new() };
        let set = Set(handle);
        let mut found = Vec::new();
        let mut id = [0u16; 512];
        let mut buf = [0u8; 1024];
        for index in 0..4096 {
            let mut info = SP_DEVINFO_DATA { cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
            if unsafe { SetupDiEnumDeviceInfo(set.0, index, &mut info) }.is_err() {
                break; // plus de périphériques
            }
            if unsafe { SetupDiGetDeviceInstanceIdW(set.0, &info, Some(&mut id), None) }.is_err() {
                continue;
            }
            let len = id.iter().position(|c| *c == 0).unwrap_or(id.len());
            if !String::from_utf16_lossy(&id[..len]).to_ascii_uppercase().starts_with("BTH") {
                continue;
            }
            let percent = match property(&set, &info, &BATTERY, &mut buf) {
                Some((DEVPROP_TYPE_BYTE, n)) if n >= 1 => buf[0],
                _ => continue,
            };
            let connected = match property(&set, &info, &CONNECTED, &mut buf) {
                // DEVPROP_BOOLEAN : 0 = faux, 0xFF = vrai.
                Some((DEVPROP_TYPE_BOOLEAN, n)) if n >= 1 => Some(buf[0] != 0),
                _ => None,
            };
            let name = match property(&set, &info, &DEVPKEY_Device_FriendlyName, &mut buf) {
                Some((DEVPROP_TYPE_STRING, n)) => text(&buf, n),
                _ => String::new(),
            };
            found.push(BtBattery { name, percent, connected });
        }
        merge(found)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::BtBattery;

    /// Hors Windows : aucun appareil.
    pub fn devices() -> Vec<BtBattery> {
        Vec::new()
    }
}

pub use imp::devices;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_line_per_device() {
        let b = |name: &str, percent, connected| BtBattery { name: name.into(), percent, connected };
        let merged = merge(vec![b("Casque", 60, None), b("casque", 55, Some(true)), b("", 10, None), b("Souris", 200, None), b("Clavier", 90, Some(false))]);
        assert_eq!(merged, vec![b("Casque", 55, Some(true)), b("Clavier", 90, Some(false))]);
    }
}
