// Règles : le déclencheur « un nouvel appareil apparaît sur le réseau local »
// (1.2.3).
//
// Tout reste sur le PC, et rien ne tourne sans une règle active qui le
// demande (le capteur démarre et s'arrête avec elle, voir sense.rs) :
//   - un balayage DOUX du réseau local de ce PC seulement : un ping (ICMP,
//     une seule demande d'écho) vers UNE adresse toutes les 3 s, sur le /24
//     privé de la carte Wi-Fi ou Ethernet (jamais un VPN, jamais une adresse
//     publique) ; un tour complet prend ~13 min, puis 5 min de pause. Aucun
//     port n'est essayé. Le ping sert seulement à ce que Windows apprenne
//     l'adresse MAC des appareils qui ne parlent jamais au PC ;
//   - toutes les minutes (et à la fin de chaque tour) : la table ARP de
//     Windows (adresses IP → MAC), lue sans rien envoyer ;
//   - une adresse MAC jamais vue → un nouvel appareil. La liste des appareils
//     déjà vus est dans %APPDATA%\Ondine\network-devices.json (MAC, dernière
//     IP, dates), le même fichier que le scanner du module Réseau (PR #62).
//     Sur un réseau jamais vu (autre box, autre /24), le premier tour complet
//     APPREND sans prévenir : sinon chaque appareil d'un nouveau Wi-Fi serait
//     « nouveau ».
//
// Repris de la PR #62 (branche bilan-du-jour, nettools_scan.rs et
// platform/netwatch.rs) : les adresses à essayer (`targets`), l'étiquette du
// réseau, les adresses MAC et la liste des appareils déjà vus. Sans la table
// des fabricants (elle viendra avec le scanner) : le nom de l'appareil vient
// du DNS local s'il en a un.

use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::platform;
use crate::services::log;

/// Un ping toutes les 3 s : le balayage reste discret.
const PING_GAP: Duration = Duration::from_secs(3);
/// Attente d'une réponse au ping.
const PING_TIMEOUT_MS: u32 = 400;
/// La table ARP : un coup d'œil par minute.
const ARP_EVERY: Duration = Duration::from_secs(60);
/// Entre deux tours complets.
const ROUND_REST: Duration = Duration::from_secs(5 * 60);
/// Pas de réseau local : on regarde de nouveau dans 30 s.
const NO_NET_WAIT: Duration = Duration::from_secs(30);
/// Au plus tant d'appareils gardés dans la liste des déjà vus.
pub const MAX_KNOWN: usize = 500;
/// Au plus tant de réseaux appris retenus.
const MAX_NETS: usize = 20;

// ── La partie sans Windows (testée) ──────────────────────────────────────────

/// Les adresses à essayer sur le réseau de `ip`/`prefix` : tout le /24 au plus
/// (celui de `ip` si le réseau est plus grand), sans l'adresse du réseau, celle
/// de diffusion ni la nôtre. Vide hors des plages privées ou pour un réseau
/// trop petit (/31, /32). (Comme `targets` de la PR #62.)
pub fn targets(ip: Ipv4Addr, prefix: u8) -> Vec<Ipv4Addr> {
    if !ip.is_private() || prefix > 30 {
        return Vec::new();
    }
    let prefix = prefix.max(24) as u32;
    let mask = u32::MAX << (32 - prefix);
    let me = u32::from(ip);
    let net = me & mask;
    let broadcast = net | !mask;
    (net + 1..broadcast).filter(|a| *a != me).map(Ipv4Addr::from).collect()
}

/// « 192.168.1.0/24 » : le réseau balayé (le /24 au plus, comme `targets`).
pub fn network_label(ip: Ipv4Addr, prefix: u8) -> String {
    let prefix = prefix.clamp(24, 30) as u32;
    let mask = u32::MAX << (32 - prefix);
    format!("{}/{prefix}", Ipv4Addr::from(u32::from(ip) & mask))
}

/// « AA:BB:CC:DD:EE:FF ».
pub fn mac_text(mac: &[u8; 6]) -> String {
    mac.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// Une vraie adresse d'appareil (ni vide, ni diffusion, ni multidiffusion).
pub fn is_device_mac(mac: &[u8; 6]) -> bool {
    mac.iter().any(|b| *b != 0) && mac[0] & 0x01 == 0
}

/// Un appareil déjà vu sur le réseau (même forme que la PR #62).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Seen {
    pub mac: String,
    pub ip: String,
    pub vendor: String,
    pub first_seen: u64,
    pub last_seen: u64,
}

/// La liste des appareils déjà vus (network-devices.json). `nets` : les
/// réseaux dont on a fait un premier tour complet (sur les autres, on apprend
/// sans prévenir).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Known {
    pub v: u32,
    pub devices: Vec<Seen>,
    pub nets: Vec<String>,
}

impl Known {
    /// Ce réseau a-t-il déjà été appris ?
    pub fn learned(&self, net: &str) -> bool {
        self.nets.iter().any(|n| n == net)
    }

    /// Fin du premier tour sur ce réseau : désormais, un inconnu est nouveau.
    pub fn learn(&mut self, net: &str) {
        if !self.learned(net) {
            self.nets.push(net.to_string());
            if self.nets.len() > MAX_NETS {
                self.nets.remove(0);
            }
        }
    }

    /// Note les appareils vus maintenant (MAC, IP) ; rend les MAC jamais vues
    /// avant si `alert` (sinon on apprend sans rien rendre).
    pub fn note(&mut self, seen: &[(String, String)], now_ms: u64, alert: bool) -> Vec<String> {
        let mut fresh = Vec::new();
        for (mac, ip) in seen {
            match self.devices.iter_mut().find(|d| &d.mac == mac) {
                Some(d) => {
                    d.ip = ip.clone();
                    d.last_seen = now_ms;
                }
                None => {
                    self.devices.push(Seen { mac: mac.clone(), ip: ip.clone(), vendor: String::new(), first_seen: now_ms, last_seen: now_ms });
                    if alert {
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
    let json = serde_json::to_string(&Known { v: 1, ..known.clone() }).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Le balayage : une adresse après l'autre, en boucle.
#[derive(Debug, Default)]
pub struct Sweep {
    /// Le réseau balayé (étiquette + passerelle) ; vide : aucun.
    pub net: String,
    targets: Vec<Ipv4Addr>,
    cursor: usize,
}

impl Sweep {
    /// Le réseau a changé (ou c'est le premier) : on repart du début.
    /// Renvoie vrai si c'est un autre réseau.
    pub fn follow(&mut self, net: &str, targets: Vec<Ipv4Addr>) -> bool {
        if self.net == net {
            return false;
        }
        self.net = net.to_string();
        self.targets = targets;
        self.cursor = 0;
        true
    }

    /// La prochaine adresse à essayer, et vrai si elle termine un tour.
    pub fn next(&mut self) -> Option<(Ipv4Addr, bool)> {
        let ip = *self.targets.get(self.cursor)?;
        self.cursor += 1;
        let round_done = self.cursor >= self.targets.len();
        if round_done {
            self.cursor = 0;
        }
        Some((ip, round_done))
    }

    pub fn contains(&self, ip: &Ipv4Addr) -> bool {
        self.targets.contains(ip)
    }
}

/// Le texte de la règle pour un appareil : son nom DNS s'il en a un, sinon son
/// adresse, avec son adresse MAC.
pub fn device_label(name: Option<&str>, ip: &str, mac: &str) -> String {
    match name.map(str::trim).filter(|n| !n.is_empty() && *n != ip) {
        Some(n) => format!("{n} ({ip}, {mac})"),
        None => format!("{ip} ({mac})"),
    }
}

// ── Le fil du balayage ───────────────────────────────────────────────────────

/// Le capteur en marche : s'arrête quand on le lâche (`Drop`).
pub struct Watcher {
    stop: Arc<AtomicBool>,
    /// Les nouveaux appareils, en texte prêt pour la règle.
    pub found: Receiver<String>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Démarre le balayage doux dans son propre fil.
pub fn start() -> Watcher {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, found) = mpsc::channel();
    let flag = stop.clone();
    let spawned = std::thread::Builder::new().name("ondine-rules-newdevice".into()).spawn(move || {
        log::info("règles : balayage doux du réseau local démarré (nouvel appareil)");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&flag, &tx)));
        if r.is_err() {
            log::warn("règles : le balayage du réseau local s'est arrêté (erreur inattendue)");
        }
        log::info("règles : balayage du réseau local arrêté");
    });
    if let Err(e) = spawned {
        log::warn(format!("règles : balayage du réseau local non démarré ({e})"));
    }
    Watcher { stop, found }
}

/// Attend `d` en regardant souvent si on doit s'arrêter ; faux : arrêt demandé.
fn rest(stop: &AtomicBool, d: Duration) -> bool {
    let until = Instant::now() + d;
    while Instant::now() < until {
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250).min(until.saturating_duration_since(Instant::now())));
    }
    !stop.load(Ordering::SeqCst)
}

/// La carte du réseau local : une adresse privée, pas un VPN, avec une
/// passerelle de préférence (le Wi-Fi ou l'Ethernet de tous les jours).
fn primary_net() -> Option<platform::netwatch::LocalNet> {
    let mut nets: Vec<_> = platform::netwatch::local_nets().into_iter().filter(|n| !n.vpn && n.ip.is_private() && n.prefix <= 30).collect();
    nets.sort_by_key(|n| n.gateway.is_none());
    nets.into_iter().next()
}

fn known_file() -> PathBuf {
    platform::config_dir().join("network-devices.json")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn run(stop: &AtomicBool, tx: &Sender<String>) {
    let path = known_file();
    let mut known = load_known(&path);
    let mut sweep = Sweep::default();
    let mut last_arp: Option<Instant> = None;
    loop {
        let Some(net) = primary_net() else {
            if !rest(stop, NO_NET_WAIT) {
                return;
            }
            continue;
        };
        let key = format!("{} via {}", network_label(net.ip, net.prefix), net.gateway.map(|g| g.to_string()).unwrap_or_else(|| "-".into()));
        if sweep.follow(&key, targets(net.ip, net.prefix)) {
            last_arp = None;
            if !known.learned(&key) {
                log::info(format!("règles : réseau {key} jamais vu, premier tour pour apprendre les appareils (sans prévenir)"));
            }
        }
        let Some((ip, round_done)) = sweep.next() else {
            if !rest(stop, NO_NET_WAIT) {
                return;
            }
            continue;
        };
        // Un seul écho : la réponse ne compte pas, Windows note l'adresse MAC.
        let _ = platform::ping(ip, PING_TIMEOUT_MS);
        if round_done || last_arp.is_none_or(|t| t.elapsed() >= ARP_EVERY) {
            last_arp = Some(Instant::now());
            let seen: Vec<(String, String)> = platform::netwatch::neighbors()
                .into_iter()
                .filter(|(a, mac)| sweep.contains(a) && is_device_mac(mac))
                .map(|(a, mac)| (mac_text(&mac), a.to_string()))
                .collect();
            let alert = known.learned(&key);
            let fresh = known.note(&seen, now_ms(), alert);
            if round_done {
                known.learn(&key);
            }
            if let Err(e) = save_known(&path, &known) {
                log::warn(format!("règles : liste des appareils du réseau non enregistrée ({e})"));
            }
            for mac in fresh {
                let Some((_, ip)) = seen.iter().find(|(m, _)| *m == mac) else { continue };
                let name = ip.parse().ok().and_then(platform::reverse_dns);
                // Jamais le contenu de quoi que ce soit : l'adresse et le nom local.
                log::info(format!("règles : nouvel appareil sur le réseau ({ip})"));
                if tx.send(device_label(name.as_deref(), ip, &mac)).is_err() {
                    return; // le capteur a été lâché
                }
            }
        }
        let gap = if round_done { ROUND_REST } else { PING_GAP };
        if !rest(stop, gap) {
            return;
        }
    }
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
        assert_eq!(targets(Ipv4Addr::new(192, 168, 1, 1), 30), vec![Ipv4Addr::new(192, 168, 1, 2)]);
        // Jamais hors des plages privées.
        assert!(targets(Ipv4Addr::new(8, 8, 8, 8), 24).is_empty());
        assert!(targets(Ipv4Addr::new(192, 168, 1, 1), 32).is_empty());
    }

    #[test]
    fn macs() {
        assert_eq!(mac_text(&[0x00, 0x03, 0x93, 0x12, 0x34, 0x56]), "00:03:93:12:34:56");
        assert!(!is_device_mac(&[0; 6]));
        assert!(!is_device_mac(&[0xFF; 6]));
        assert!(!is_device_mac(&[0x01, 0x00, 0x5E, 0, 0, 1]));
        assert!(is_device_mac(&[0x00, 0x03, 0x93, 1, 2, 3]));
    }

    #[test]
    fn a_new_network_is_learned_before_alerting() {
        let mut k = Known::default();
        let net = "192.168.1.0/24 via 192.168.1.1";
        let a = ("AA".to_string(), "192.168.1.2".to_string());
        let b = ("BB".to_string(), "192.168.1.3".to_string());
        // Premier tour : on apprend, rien n'est nouveau.
        assert!(!k.learned(net));
        assert!(k.note(std::slice::from_ref(&a), 1, k.learned(net)).is_empty());
        k.learn(net);
        // Ensuite : un inconnu est nouveau, une seule fois.
        assert_eq!(k.note(&[a.clone(), b.clone()], 2, k.learned(net)), vec!["BB".to_string()]);
        assert!(k.note(std::slice::from_ref(&b), 3, true).is_empty());
        assert_eq!(k.devices.len(), 2);
        assert_eq!(k.devices[0].last_seen, 2);
        assert_eq!(k.devices[1].first_seen, 2);
        // Un autre réseau : de nouveau un tour pour apprendre.
        assert!(!k.learned("10.0.0.0/24 via 10.0.0.1"));
        k.learn(net);
        assert_eq!(k.nets.len(), 1, "pas de doublon");
    }

    #[test]
    fn known_file_round_trip_and_compat() {
        let dir = std::env::temp_dir().join(format!("ondine-rules-newdevice-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("network-devices.json");
        assert_eq!(load_known(&path), Known::default());
        let mut k = Known::default();
        k.note(&[("AA".into(), "192.168.1.2".into())], 5, false);
        k.learn("net");
        save_known(&path, &k).unwrap();
        let back = load_known(&path);
        assert_eq!(back.devices, k.devices);
        assert_eq!(back.nets, k.nets);
        // Le fichier du scanner de la PR #62 (sans `nets`) se relit.
        std::fs::write(&path, r#"{"v":1,"devices":[{"mac":"BB","ip":"1","vendor":"Apple","firstSeen":1,"lastSeen":2}]}"#).unwrap();
        let old = load_known(&path);
        assert_eq!(old.devices[0].vendor, "Apple");
        assert!(old.nets.is_empty());
        std::fs::write(&path, "abîmé").unwrap();
        assert!(load_known(&path).devices.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_sweep_goes_round_gently() {
        let mut s = Sweep::default();
        assert!(s.next().is_none(), "aucun réseau : rien à essayer");
        let t = targets(Ipv4Addr::new(192, 168, 1, 1), 29); // 192.168.1.0/29 → 5 adresses
        assert!(s.follow("a", t.clone()));
        assert!(!s.follow("a", t.clone()), "même réseau : on continue");
        let mut seen = Vec::new();
        for _ in 0..t.len() {
            seen.push(s.next().unwrap());
        }
        assert!(seen[..t.len() - 1].iter().all(|(_, done)| !done));
        assert!(seen.last().unwrap().1, "la dernière termine le tour");
        assert_eq!(s.next().unwrap().0, t[0], "puis on recommence");
        // Un autre réseau : du début.
        assert!(s.follow("b", t.clone()));
        assert_eq!(s.next().unwrap().0, t[0]);
        // Au rythme choisi, un /24 prend une douzaine de minutes.
        assert!(PING_GAP.as_secs() * 253 >= 10 * 60);
    }

    #[test]
    fn labels() {
        assert_eq!(device_label(Some("imprimante.local"), "192.168.1.9", "AA"), "imprimante.local (192.168.1.9, AA)");
        assert_eq!(device_label(Some("192.168.1.9"), "192.168.1.9", "AA"), "192.168.1.9 (AA)");
        assert_eq!(device_label(None, "192.168.1.9", "AA"), "192.168.1.9 (AA)");
    }
}
