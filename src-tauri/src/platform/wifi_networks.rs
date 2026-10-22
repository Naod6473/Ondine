// Les réseaux Wi-Fi à portée, et se connecter à l'un d'eux d'un clic
// (module Contrôles, « Réseaux Wi-Fi »).
//
// Windows : l'API « Native Wifi » (wlanapi.dll), comme wifi.rs :
//   - `WlanScan` demande à la carte de chercher les réseaux (la réponse
//     arrive en quelques secondes : l'onglet relit la liste toutes les 3 s) ;
//   - `WlanGetAvailableNetworkList` donne ce que la carte voit : nom (SSID),
//     qualité du signal, sécurisé ou non, déjà connu (un « profil » Windows
//     existe : mot de passe déjà enregistré) et connecté ;
//   - `WlanConnect` en mode « profil » : SEULEMENT pour un réseau déjà connu.
//     Ondine ne demande ni ne garde jamais de mot de passe Wi-Fi : pour un
//     nouveau réseau, on ouvre la liste des réseaux de Windows, qui s'en
//     occupe ;
//   - `WlanDisconnect` pour se déconnecter.
//
// ATTENTION : depuis Windows 11 24H2, Windows ne liste les réseaux qu'aux
// applis autorisées à utiliser la localisation (Paramètres → Confidentialité
// → Localisation → « Autoriser les applications de bureau »). Sinon : refus
// (ERROR_ACCESS_DENIED), et l'onglet explique quoi activer.
//
// Rien n'est envoyé ni écrit ; les noms des réseaux ne vont pas dans le journal.

use serde::Serialize;

/// Un réseau Wi-Fi à portée.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Network {
    /// Le nom du réseau (vide : réseau caché, pas listé).
    pub ssid: String,
    /// La qualité du signal (0 à 100).
    pub signal: u8,
    /// Protégé par un mot de passe.
    pub secure: bool,
    /// Windows le connaît déjà (connexion possible d'ici).
    pub known: bool,
    /// Connecté en ce moment.
    pub connected: bool,
    /// Le nom du profil Windows (pour se connecter), s'il est connu.
    #[serde(skip)]
    pub profile: Option<String>,
}

/// Pourquoi la liste n'a pas pu être lue.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub enum WifiError {
    /// Pas de carte Wi-Fi (ou service WLAN arrêté).
    NoAdapter,
    /// Windows refuse : la localisation n'est pas autorisée aux applis de bureau.
    Location,
    /// Autre refus (code Windows).
    Failed(u32),
}

impl WifiError {
    /// Le message pour l'utilisateur (le front ajoute le bouton « Ouvrir les paramètres » pour `Location`).
    pub fn text(&self) -> String {
        match self {
            WifiError::NoAdapter => "Pas de carte Wi-Fi sur ce PC".into(),
            WifiError::Location => "Windows ne montre les réseaux Wi-Fi qu'aux applis autorisées à utiliser la localisation".into(),
            WifiError::Failed(code) => format!("Windows refuse de lister les réseaux Wi-Fi (code {code})"),
        }
    }
    /// Le code court pour le front (« location », « no-adapter », « failed »).
    pub fn code(&self) -> &'static str {
        match self {
            WifiError::NoAdapter => "no-adapter",
            WifiError::Location => "location",
            WifiError::Failed(_) => "failed",
        }
    }
}

/// Un réseau tel que Windows le donne (une ligne par profil : le même nom peut revenir).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub struct RawNetwork {
    pub ssid: String,
    pub signal: u32,
    pub secure: bool,
    pub profile: Option<String>,
    pub connected: bool,
}

/// Une ligne par nom de réseau : le meilleur signal, connu si une des lignes
/// a un profil, connecté si une l'est. Les réseaux cachés (sans nom) sont
/// écartés. Rangés : le réseau connecté d'abord, puis les connus, puis par
/// signal ; 20 au plus.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn merge(raw: Vec<RawNetwork>) -> Vec<Network> {
    let mut out: Vec<Network> = Vec::new();
    for r in raw {
        let ssid = r.ssid.trim().to_string();
        if ssid.is_empty() {
            continue;
        }
        let signal = r.signal.min(100) as u8;
        match out.iter_mut().find(|n| n.ssid == ssid) {
            Some(n) => {
                n.signal = n.signal.max(signal);
                n.connected |= r.connected;
                n.secure |= r.secure;
                if n.profile.is_none() && r.profile.is_some() {
                    n.profile = r.profile;
                    n.known = true;
                }
            }
            None => out.push(Network { ssid, signal, secure: r.secure, known: r.profile.is_some(), connected: r.connected, profile: r.profile }),
        }
    }
    out.sort_by(|a, b| b.connected.cmp(&a.connected).then(b.known.cmp(&a.known)).then(b.signal.cmp(&a.signal)).then(a.ssid.cmp(&b.ssid)));
    out.truncate(20);
    out
}

#[cfg(windows)]
mod imp {
    use super::{merge, Network, RawNetwork, WifiError};
    use ::windows::core::{GUID, PCWSTR};
    use ::windows::Win32::Foundation::HANDLE;
    use ::windows::Win32::NetworkManagement::WiFi::{
        dot11_BSS_type_any, wlan_connection_mode_profile, WlanCloseHandle, WlanConnect, WlanDisconnect, WlanEnumInterfaces, WlanFreeMemory,
        WlanGetAvailableNetworkList, WlanOpenHandle, WlanScan, WLAN_AVAILABLE_NETWORK, WLAN_AVAILABLE_NETWORK_CONNECTED, WLAN_AVAILABLE_NETWORK_HAS_PROFILE,
        WLAN_AVAILABLE_NETWORK_LIST, WLAN_CONNECTION_PARAMETERS, WLAN_INTERFACE_INFO, WLAN_INTERFACE_INFO_LIST,
    };

    const ERROR_ACCESS_DENIED: u32 = 5;

    /// Le service WLAN ouvert, refermé tout seul (Drop).
    struct Client(HANDLE);
    impl Drop for Client {
        fn drop(&mut self) {
            unsafe {
                WlanCloseHandle(self.0, None);
            }
        }
    }

    fn open() -> Result<Client, WifiError> {
        let mut version = 0u32;
        let mut handle = HANDLE::default();
        // 2 = version de l'API pour Windows Vista et plus récent.
        let rc = unsafe { WlanOpenHandle(2, None, &mut version, &mut handle) };
        if rc != 0 {
            return Err(WifiError::NoAdapter);
        }
        Ok(Client(handle))
    }

    /// Les cartes Wi-Fi (leur GUID).
    fn interfaces(c: &Client) -> Vec<GUID> {
        let mut out = Vec::new();
        unsafe {
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            if WlanEnumInterfaces(c.0, None, &mut list) == 0 && !list.is_null() {
                let count = (*list).dwNumberOfItems as usize;
                // La liste est un tableau C de longueur variable après l'en-tête.
                let first = std::ptr::addr_of!((*list).InterfaceInfo) as *const WLAN_INTERFACE_INFO;
                for i in 0..count {
                    out.push((*first.add(i)).InterfaceGuid);
                }
            }
            if !list.is_null() {
                WlanFreeMemory(list as *const core::ffi::c_void);
            }
        }
        out
    }

    /// Un tableau de u16 terminé par 0 → texte.
    fn wide(buf: &[u16]) -> String {
        let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    fn raw_list(c: &Client, guid: &GUID) -> Result<Vec<RawNetwork>, WifiError> {
        let mut out = Vec::new();
        unsafe {
            let mut list: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
            let rc = WlanGetAvailableNetworkList(c.0, guid, 0, None, &mut list);
            if rc == ERROR_ACCESS_DENIED {
                return Err(WifiError::Location);
            }
            if rc != 0 || list.is_null() {
                return Err(WifiError::Failed(rc));
            }
            let count = (*list).dwNumberOfItems as usize;
            let first = std::ptr::addr_of!((*list).Network) as *const WLAN_AVAILABLE_NETWORK;
            for i in 0..count {
                let n = &*first.add(i);
                let len = (n.dot11Ssid.uSSIDLength as usize).min(n.dot11Ssid.ucSSID.len());
                let ssid = String::from_utf8_lossy(&n.dot11Ssid.ucSSID[..len]).to_string();
                let profile = (n.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE != 0).then(|| wide(&n.strProfileName)).filter(|p| !p.is_empty());
                out.push(RawNetwork {
                    ssid,
                    signal: n.wlanSignalQuality,
                    secure: n.bSecurityEnabled.as_bool(),
                    profile,
                    connected: n.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED != 0,
                });
            }
            WlanFreeMemory(list as *const core::ffi::c_void);
        }
        Ok(out)
    }

    pub fn scan() {
        let Ok(c) = open() else { return };
        for guid in interfaces(&c) {
            // Sans attendre : la liste se met à jour quelques secondes plus tard.
            unsafe {
                WlanScan(c.0, &guid, None, None, None);
            }
        }
    }

    pub fn list() -> Result<Vec<Network>, WifiError> {
        let c = open()?;
        let guids = interfaces(&c);
        if guids.is_empty() {
            return Err(WifiError::NoAdapter);
        }
        let mut raw = Vec::new();
        let mut last = None;
        for guid in &guids {
            match raw_list(&c, guid) {
                Ok(mut r) => raw.append(&mut r),
                Err(e) => last = Some(e),
            }
        }
        // Toutes les cartes refusent : on dit pourquoi.
        if raw.is_empty() {
            if let Some(e) = last {
                return Err(e);
            }
        }
        Ok(merge(raw))
    }

    pub fn connect(ssid: &str) -> Result<(), String> {
        let c = open().map_err(|e| e.text())?;
        for guid in interfaces(&c) {
            let Ok(raw) = raw_list(&c, &guid) else { continue };
            let Some(profile) = merge(raw).into_iter().find(|n| n.ssid == ssid).and_then(|n| n.profile) else { continue };
            let profile: Vec<u16> = profile.encode_utf16().chain(std::iter::once(0)).collect();
            let params = WLAN_CONNECTION_PARAMETERS {
                wlanConnectionMode: wlan_connection_mode_profile,
                strProfile: PCWSTR(profile.as_ptr()),
                pDot11Ssid: std::ptr::null_mut(),
                pDesiredBssidList: std::ptr::null_mut(),
                dot11BssType: dot11_BSS_type_any,
                dwFlags: 0,
            };
            let rc = unsafe { WlanConnect(c.0, &guid, &params, None) };
            return if rc == 0 { Ok(()) } else { Err(format!("connexion refusée par Windows (code {rc})")) };
        }
        Err("ce réseau n'est pas encore connu de Windows".into())
    }

    pub fn disconnect() -> Result<(), String> {
        let c = open().map_err(|e| e.text())?;
        let mut done = false;
        for guid in interfaces(&c) {
            if unsafe { WlanDisconnect(c.0, &guid, None) } == 0 {
                done = true;
            }
        }
        if done {
            Ok(())
        } else {
            Err("déconnexion refusée par Windows".into())
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Network, WifiError};

    pub fn scan() {}
    pub fn list() -> Result<Vec<Network>, WifiError> {
        Err(WifiError::NoAdapter)
    }
    pub fn connect(_ssid: &str) -> Result<(), String> {
        Err("pas de Wi-Fi (hors Windows)".into())
    }
    pub fn disconnect() -> Result<(), String> {
        Err("pas de Wi-Fi (hors Windows)".into())
    }
}

/// Demande à la carte de chercher les réseaux (réponse quelques secondes plus tard).
pub fn scan() {
    imp::scan()
}

/// Les réseaux à portée, rangés (voir `merge`).
pub fn list() -> Result<Vec<Network>, WifiError> {
    imp::list()
}

/// Se connecter à un réseau DÉJÀ connu de Windows (son profil).
pub fn connect(ssid: &str) -> Result<(), String> {
    if ssid.trim().is_empty() || ssid.len() > 64 {
        return Err("réseau inconnu".into());
    }
    imp::connect(ssid)
}

/// Se déconnecter du Wi-Fi.
pub fn disconnect() -> Result<(), String> {
    imp::disconnect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(ssid: &str, signal: u32, profile: Option<&str>, connected: bool) -> RawNetwork {
        RawNetwork { ssid: ssid.into(), signal, secure: true, profile: profile.map(String::from), connected }
    }

    #[test]
    fn one_line_per_network() {
        let list = merge(vec![raw("Maison", 40, None, false), raw("Maison", 80, Some("Maison"), true), raw("", 99, None, false), raw("Café", 90, None, false)]);
        assert_eq!(list.len(), 2, "le réseau caché est écarté, Maison n'apparaît qu'une fois");
        assert_eq!(list[0].ssid, "Maison");
        assert!(list[0].known && list[0].connected);
        assert_eq!(list[0].signal, 80);
        assert_eq!(list[0].profile.as_deref(), Some("Maison"));
        assert!(!list[1].known);
    }

    #[test]
    fn connected_then_known_then_signal() {
        let list = merge(vec![raw("Fort", 95, None, false), raw("Bureau", 30, Some("Bureau"), false), raw("Ici", 50, Some("Ici"), true), raw("Moyen", 60, None, false)]);
        let names: Vec<&str> = list.iter().map(|n| n.ssid.as_str()).collect();
        assert_eq!(names, ["Ici", "Bureau", "Fort", "Moyen"]);
    }

    #[test]
    fn at_most_twenty_and_signal_capped() {
        let list = merge((0..30).map(|i| raw(&format!("R{i}"), 150, None, false)).collect());
        assert_eq!(list.len(), 20);
        assert!(list.iter().all(|n| n.signal == 100));
    }

    #[test]
    fn location_refusal_has_a_code() {
        assert_eq!(WifiError::Location.code(), "location");
        assert!(WifiError::Failed(87).text().contains("87"));
        assert!(connect("").is_err());
        assert!(connect(&"x".repeat(65)).is_err());
    }
}
