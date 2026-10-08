// Réseau : le scanner du réseau local (« Scanner mon réseau »), sa partie
// sans Windows ni Tauri, testée à part.
//
// Le scan lui-même (nettools.rs) : un ping vers chaque adresse du réseau local
// (un /24 au plus, et seulement une plage privée : 10.x, 172.16-31.x,
// 192.168.x), puis la table ARP de Windows (les appareils qui ne répondent pas
// au ping y figurent quand même), puis le nom DNS de chacun. Ici :
//   - les adresses à essayer (`targets`) ;
//   - le fabricant d'après l'adresse MAC (`vendor`, table oui-vendors.txt,
//     regénérée par scripts/gen-oui-vendors.mjs) ;
//   - le type d'appareil deviné (`guess_kind`), d'après le fabricant et, sur
//     clic, les ports courants ouverts ;
//   - les appareils déjà vus (`Known`, %APPDATA%\Ondine\network-devices.json) :
//     l'adresse MAC, le fabricant, la dernière adresse IP et les dates. Rien
//     d'autre, rien ne quitte le PC.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::Path;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// Au plus tant d'appareils gardés dans la liste des déjà vus.
pub const MAX_KNOWN: usize = 500;

/// Les ports essayés pour deviner le type d'un appareil (sur clic).
pub const PROBE_PORTS: &[u16] = &[80, 443, 445, 3389, 22, 9100, 631, 554, 5000, 5001, 8080, 62078];

/// Une plage privée (là où un scan est permis) ?
pub fn is_private(ip: Ipv4Addr) -> bool {
    ip.is_private()
}

/// Les adresses à essayer sur le réseau de `ip`/`prefix` : tout le /24 au plus
/// (celui de `ip` si le réseau est plus grand), sans l'adresse du réseau, celle
/// de diffusion ni la nôtre. Vide hors des plages privées ou pour un réseau
/// trop petit (/31, /32).
pub fn targets(ip: Ipv4Addr, prefix: u8) -> Vec<Ipv4Addr> {
    if !is_private(ip) || prefix > 30 {
        return Vec::new();
    }
    let prefix = prefix.max(24) as u32;
    let mask = u32::MAX << (32 - prefix);
    let me = u32::from(ip);
    let net = me & mask;
    let broadcast = net | !mask;
    (net + 1..broadcast).filter(|a| *a != me).map(Ipv4Addr::from).collect()
}

/// « 192.168.1.0/24 » : le réseau scanné (le /24 au plus, comme `targets`).
pub fn network_label(ip: Ipv4Addr, prefix: u8) -> String {
    let prefix = prefix.clamp(24, 30) as u32;
    let mask = u32::MAX << (32 - prefix);
    format!("{}/{prefix}", Ipv4Addr::from(u32::from(ip) & mask))
}

/// « AA:BB:CC:DD:EE:FF ».
pub fn mac_text(mac: &[u8; 6]) -> String {
    mac.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// Une adresse MAC « privée » (choisie au hasard par le téléphone ou le PC,
/// bit « administrée localement ») : le fabricant est alors inconnu.
pub fn is_random_mac(mac: &[u8; 6]) -> bool {
    mac[0] & 0x02 != 0
}

/// Une vraie adresse d'appareil (ni vide, ni diffusion, ni multidiffusion).
pub fn is_device_mac(mac: &[u8; 6]) -> bool {
    mac.iter().any(|b| *b != 0) && mac[0] & 0x01 == 0
}

fn vendors() -> &'static HashMap<u32, &'static str> {
    static TABLE: OnceLock<HashMap<u32, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut map = HashMap::new();
        for line in include_str!("oui-vendors.txt").lines() {
            if line.starts_with('#') {
                continue;
            }
            let Some((name, prefixes)) = line.split_once('|') else { continue };
            for p in prefixes.split(',') {
                if let Ok(n) = u32::from_str_radix(p.trim(), 16) {
                    map.insert(n, name);
                }
            }
        }
        map
    })
}

/// Le fabricant d'après les trois premiers octets de l'adresse MAC.
pub fn vendor(mac: &[u8; 6]) -> Option<&'static str> {
    if is_random_mac(mac) {
        return None;
    }
    let key = (mac[0] as u32) << 16 | (mac[1] as u32) << 8 | mac[2] as u32;
    vendors().get(&key).copied()
}

const PRINTERS: &[&str] = &["Brother", "Canon", "Epson", "Xerox", "Ricoh", "Kyocera", "Lexmark"];
const NAS: &[&str] = &["Synology", "QNAP", "Western Digital"];
const CAMERAS: &[&str] = &["Hikvision", "Dahua", "EZVIZ", "Reolink", "Axis", "Ring"];
const IOT: &[&str] = &["Espressif (objet connecté)", "Tuya (objet connecté)", "Shelly", "Netatmo", "Philips Hue", "Google Nest", "ecobee", "Withings"];
const SPEAKERS: &[&str] = &["Sonos", "Bose"];
const CONSOLES: &[&str] = &["Nintendo", "Valve"];
const BOXES: &[&str] = &["Sagemcom", "Freebox", "Technicolor", "Arcadyan (box)", "AVM (FRITZ!Box)", "Ubiquiti", "MikroTik", "Zyxel", "Netgear", "eero"];

/// Le type d'appareil deviné : "box", "pc", "phone", "printer", "nas",
/// "camera", "speaker", "iot", "console", "server", "web" ou "unknown".
/// `open` : les ports ouverts (vide tant qu'on n'a pas essayé).
pub fn guess_kind(vendor: Option<&str>, random_mac: bool, gateway: bool, open: &[u16]) -> &'static str {
    let has = |p: u16| open.contains(&p);
    let is = |list: &[&str]| vendor.is_some_and(|v| list.contains(&v));
    if gateway {
        return "box";
    }
    if has(9100) || has(631) || is(PRINTERS) {
        return "printer";
    }
    if is(NAS) || ((has(5000) || has(5001)) && has(445)) {
        return "nas";
    }
    if has(554) || is(CAMERAS) {
        return "camera";
    }
    if has(3389) || (has(445) && !has(22)) {
        return "pc";
    }
    if has(62078) {
        return "phone";
    }
    if is(SPEAKERS) {
        return "speaker";
    }
    if is(IOT) {
        return "iot";
    }
    if is(CONSOLES) {
        return "console";
    }
    if is(BOXES) {
        return "box";
    }
    if has(22) {
        return "server";
    }
    if has(80) || has(443) || has(8080) {
        return "web";
    }
    if random_mac {
        return "phone";
    }
    "unknown"
}

/// L'adresse de la page web d'un appareil du réseau local, pour un port web
/// connu (443 et 5001 en HTTPS) ; rien hors des plages privées.
pub fn web_url(ip: Ipv4Addr, port: u16) -> Option<String> {
    if !is_private(ip) {
        return None;
    }
    match port {
        80 => Some(format!("http://{ip}/")),
        443 => Some(format!("https://{ip}/")),
        8080 | 5000 => Some(format!("http://{ip}:{port}/")),
        5001 => Some(format!("https://{ip}:5001/")),
        _ => None,
    }
}

/// Un appareil déjà vu sur le réseau.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Seen {
    pub mac: String,
    pub ip: String,
    pub vendor: String,
    pub first_seen: u64,
    pub last_seen: u64,
}

/// La liste des appareils déjà vus (le fichier network-devices.json).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Known {
    pub v: u32,
    pub devices: Vec<Seen>,
}

impl Known {
    /// Note les appareils vus maintenant ; rend les adresses MAC jamais vues
    /// avant. La toute première fois (liste vide), rien n'est « nouveau » :
    /// on apprend le réseau sans alerter.
    pub fn note(&mut self, seen: &[(String, String, String)], now_ms: u64) -> Vec<String> {
        let first_time = self.devices.is_empty();
        let mut fresh = Vec::new();
        for (mac, ip, vendor) in seen {
            match self.devices.iter_mut().find(|d| &d.mac == mac) {
                Some(d) => {
                    d.ip = ip.clone();
                    d.last_seen = now_ms;
                    if !vendor.is_empty() {
                        d.vendor = vendor.clone();
                    }
                }
                None => {
                    self.devices.push(Seen { mac: mac.clone(), ip: ip.clone(), vendor: vendor.clone(), first_seen: now_ms, last_seen: now_ms });
                    if !first_time {
                        fresh.push(mac.clone());
                    }
                }
            }
        }
        // Les plus anciens partent d'abord quand la liste est pleine.
        if self.devices.len() > MAX_KNOWN {
            self.devices.sort_by_key(|d| std::cmp::Reverse(d.last_seen));
            self.devices.truncate(MAX_KNOWN);
        }
        fresh
    }
}

/// Relit la liste (vide si le fichier n'existe pas ou est abîmé).
pub fn load_known(path: &Path) -> Known {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Écrit la liste via un fichier temporaire renommé.
pub fn save_known(path: &Path, known: &Known) -> Result<(), String> {
    let dir = path.parent().ok_or("dossier inconnu")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&Known { v: 1, devices: known.devices.clone() }).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_stay_in_the_local_slash_24() {
        let me = Ipv4Addr::new(192, 168, 1, 23);
        let t = targets(me, 24);
        assert_eq!(t.len(), 253);
        assert_eq!(t[0], Ipv4Addr::new(192, 168, 1, 1));
        assert_eq!(*t.last().unwrap(), Ipv4Addr::new(192, 168, 1, 254));
        assert!(!t.contains(&me));
        // Un grand réseau : seulement le /24 de notre adresse.
        let big = targets(Ipv4Addr::new(10, 0, 5, 9), 16);
        assert_eq!(big.len(), 253);
        assert!(big.iter().all(|a| a.octets()[2] == 5));
        assert_eq!(network_label(Ipv4Addr::new(10, 0, 5, 9), 16), "10.0.5.0/24");
        // Un petit réseau : ses adresses seulement.
        assert_eq!(targets(Ipv4Addr::new(192, 168, 1, 1), 30), vec![Ipv4Addr::new(192, 168, 1, 2)]);
        assert_eq!(network_label(Ipv4Addr::new(192, 168, 1, 6), 30), "192.168.1.4/30");
        // Jamais hors des plages privées.
        assert!(targets(Ipv4Addr::new(8, 8, 8, 8), 24).is_empty());
        assert!(targets(Ipv4Addr::new(192, 168, 1, 1), 32).is_empty());
    }

    #[test]
    fn macs_and_vendors() {
        let apple = [0x00, 0x03, 0x93, 0x12, 0x34, 0x56];
        assert_eq!(mac_text(&apple), "00:03:93:12:34:56");
        assert_eq!(vendor(&apple), Some("Apple"));
        assert_eq!(vendor(&[0x00, 0x11, 0x32, 1, 2, 3]), Some("Synology"));
        let random = [0xDA, 0xA1, 0x19, 1, 2, 3];
        assert!(is_random_mac(&random));
        assert_eq!(vendor(&random), None);
        assert!(!is_device_mac(&[0; 6]));
        assert!(!is_device_mac(&[0xFF; 6]));
        assert!(!is_device_mac(&[0x01, 0x00, 0x5E, 0, 0, 1]));
        assert!(is_device_mac(&apple));
        assert!(vendors().len() > 10_000, "la table des fabricants est lue");
        // Chaque préfixe de la table fait 24 bits (6 chiffres hexadécimaux).
        for line in include_str!("oui-vendors.txt").lines().filter(|l| !l.starts_with('#')) {
            let (_, prefixes) = line.split_once('|').expect("Nom|préfixes");
            assert!(prefixes.split(',').all(|p| p.len() == 6 && u32::from_str_radix(p, 16).is_ok()), "{line}");
        }
    }

    #[test]
    fn kinds_are_guessed() {
        assert_eq!(guess_kind(None, false, true, &[]), "box");
        assert_eq!(guess_kind(Some("Brother"), false, false, &[]), "printer");
        assert_eq!(guess_kind(Some("HP"), false, false, &[80, 9100]), "printer");
        assert_eq!(guess_kind(Some("Synology"), false, false, &[]), "nas");
        assert_eq!(guess_kind(Some("Dell"), false, false, &[135, 445, 3389]), "pc");
        assert_eq!(guess_kind(Some("Raspberry Pi"), false, false, &[22, 80]), "server");
        assert_eq!(guess_kind(Some("Apple"), false, false, &[62078]), "phone");
        assert_eq!(guess_kind(None, true, false, &[]), "phone");
        assert_eq!(guess_kind(Some("Sonos"), false, false, &[]), "speaker");
        assert_eq!(guess_kind(Some("Espressif (objet connecté)"), false, false, &[80]), "iot");
        assert_eq!(guess_kind(None, false, false, &[443]), "web");
        assert_eq!(guess_kind(Some("Intel"), false, false, &[]), "unknown");
    }

    #[test]
    fn web_pages_only_on_the_local_network() {
        let nas = Ipv4Addr::new(192, 168, 1, 20);
        assert_eq!(web_url(nas, 80).as_deref(), Some("http://192.168.1.20/"));
        assert_eq!(web_url(nas, 5001).as_deref(), Some("https://192.168.1.20:5001/"));
        assert_eq!(web_url(nas, 22), None);
        assert_eq!(web_url(Ipv4Addr::new(1, 1, 1, 1), 80), None);
    }

    #[test]
    fn known_devices_learn_first_then_alert() {
        let mut k = Known::default();
        let a = ("AA".to_string(), "192.168.1.2".to_string(), "Apple".to_string());
        let b = ("BB".to_string(), "192.168.1.3".to_string(), String::new());
        assert!(k.note(std::slice::from_ref(&a), 1).is_empty(), "la première fois, on apprend sans alerter");
        assert_eq!(k.note(&[a.clone(), b.clone()], 2), vec!["BB".to_string()]);
        assert!(k.note(&[b], 3).is_empty());
        assert_eq!(k.devices.len(), 2);
        assert_eq!(k.devices[0].last_seen, 2);
        assert_eq!(k.devices[1].first_seen, 2);

        let dir = std::env::temp_dir().join(format!("ondine-net-known-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("network-devices.json");
        assert_eq!(load_known(&path), Known::default());
        save_known(&path, &k).unwrap();
        assert_eq!(load_known(&path).devices, k.devices);
        std::fs::write(&path, "abîmé").unwrap();
        assert!(load_known(&path).devices.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
