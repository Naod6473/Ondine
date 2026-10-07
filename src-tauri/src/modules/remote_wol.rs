// Wake-on-LAN (module Accès distants) : réveiller un serveur ou un PC éteint
// en veille, depuis le réseau local.
//
// Le principe : la carte réseau de la machine endormie écoute encore, et se
// réveille si elle voit passer le « paquet magique » : 6 octets FF, puis son
// adresse MAC répétée 16 fois (102 octets en tout). Comme la machine n'a plus
// d'adresse IP joignable, on l'envoie en DIFFUSION (à tout le réseau local),
// en UDP sur le port 9 :
//   - vers 255.255.255.255 ;
//   - et vers l'adresse de diffusion de chaque carte réseau IPv4 en marche
//     (192.168.1.255 pour 192.168.1.20/24), depuis cette carte : avec un câble
//     ET le Wi-Fi, ou un réseau par carte, chacun reçoit le paquet.
//
// Le paquet ne contient que l'adresse MAC ; il ne sort pas du réseau local
// (les box et routeurs ne transmettent pas une diffusion). std::net suffit.

use std::net::{Ipv4Addr, UdpSocket};
use std::time::Duration;

use crate::services::lan::{self, Card};

/// Le port habituel du Wake-on-LAN (« discard »). Le 7 marche aussi, plus rare.
pub const PORT: u16 = 9;
/// On envoie le tout plusieurs fois (un paquet UDP peut se perdre).
const ROUNDS: usize = 3;
const BETWEEN_ROUNDS: Duration = Duration::from_millis(80);

/// Lit une adresse MAC : « AA:BB:CC:DD:EE:FF », « AA-BB-CC-DD-EE-FF » ou
/// « AABBCCDDEEFF » (majuscules ou minuscules).
pub fn parse_mac(text: &str) -> Result<[u8; 6], String> {
    let invalid = || "adresse MAC invalide : 12 chiffres hexadécimaux, ex. AA:BB:CC:DD:EE:FF".to_string();
    let t = text.trim();
    let hex: String = match t.len() {
        12 => t.to_string(),
        17 => {
            // Le même séparateur (« : » ou « - ») tous les deux chiffres.
            let sep = t.as_bytes()[2];
            if sep != b':' && sep != b'-' {
                return Err(invalid());
            }
            let parts: Vec<&str> = t.split(sep as char).collect();
            if parts.len() != 6 || parts.iter().any(|p| p.len() != 2) {
                return Err(invalid());
            }
            parts.concat()
        }
        _ => return Err(invalid()),
    };
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid());
    }
    let mut mac = [0u8; 6];
    for (i, byte) in mac.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).map_err(|_| invalid())?;
    }
    if mac == [0; 6] || mac == [0xFF; 6] {
        return Err("adresse MAC invalide : ce n'est pas celle d'une carte réseau".into());
    }
    Ok(mac)
}

/// « AA:BB:CC:DD:EE:FF » : la forme rangée dans remote.json et montrée à l'écran.
pub fn format_mac(mac: [u8; 6]) -> String {
    mac.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// Le paquet magique : 6 × FF, puis 16 × l'adresse MAC.
pub fn magic_packet(mac: [u8; 6]) -> [u8; 102] {
    let mut packet = [0xFF; 102];
    for copy in packet[6..].as_chunks_mut::<6>().0 {
        copy.copy_from_slice(&mac);
    }
    packet
}

/// D'où et vers où envoyer : (adresse locale de départ, destinations).
/// La première ligne part « de n'importe où » (la carte de la route par
/// défaut) vers 255.255.255.255 ; puis une ligne par carte en marche.
pub fn plan(cards: &[Card]) -> Vec<(Ipv4Addr, Vec<Ipv4Addr>)> {
    let mut out = vec![(Ipv4Addr::UNSPECIFIED, vec![Ipv4Addr::BROADCAST])];
    for card in cards {
        let mut dests = vec![Ipv4Addr::BROADCAST];
        if let Some(b) = lan::broadcast(card.addr, card.prefix) {
            dests.push(b);
        }
        out.push((card.addr, dests));
    }
    out
}

/// Envoie le paquet selon le plan, sur `port`. Renvoie combien d'envois sont
/// partis ; une erreur seulement si AUCUN n'a pu partir.
pub fn send(packet: &[u8], plan: &[(Ipv4Addr, Vec<Ipv4Addr>)], port: u16) -> Result<usize, String> {
    let mut sent = 0;
    let mut last_error = String::new();
    for round in 0..ROUNDS {
        if round > 0 {
            std::thread::sleep(BETWEEN_ROUNDS);
        }
        for (from, dests) in plan {
            let socket = match UdpSocket::bind((*from, 0)) {
                Ok(s) => s,
                Err(e) => {
                    last_error = e.to_string();
                    continue;
                }
            };
            // Sans ce réglage, le système refuse d'envoyer vers une adresse de diffusion.
            let _ = socket.set_broadcast(true);
            for dest in dests {
                match socket.send_to(packet, (*dest, port)) {
                    Ok(_) => sent += 1,
                    Err(e) => last_error = e.to_string(),
                }
            }
        }
    }
    if sent == 0 {
        return Err(format!("paquet de réveil impossible à envoyer ({last_error})"));
    }
    Ok(sent)
}

/// Réveille la machine `mac` : le paquet part sur tous les réseaux locaux.
pub fn wake(mac: [u8; 6]) -> Result<usize, String> {
    send(&magic_packet(mac), &plan(&lan::ipv4_cards()), PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC: [u8; 6] = [0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03];

    #[test]
    fn mac_formats_are_read() {
        assert_eq!(parse_mac("AA:BB:CC:01:02:03"), Ok(MAC));
        assert_eq!(parse_mac("aa-bb-cc-01-02-03"), Ok(MAC));
        assert_eq!(parse_mac("AABBCC010203"), Ok(MAC));
        assert_eq!(parse_mac("  aabbcc010203 "), Ok(MAC));
        assert_eq!(format_mac(MAC), "AA:BB:CC:01:02:03");
    }

    #[test]
    fn bad_macs_are_refused() {
        for bad in [
            "",
            "AA:BB:CC:01:02",        // trop court
            "AA:BB:CC:01:02:03:04",  // trop long
            "AA:BB-CC:01:02:03",     // séparateurs mélangés
            "AA.BB.CC.01.02.03",     // séparateur inconnu
            "AAB:BCC:010:203:xx:yy", // mauvais découpage
            "GG:BB:CC:01:02:03",     // pas de l'hexadécimal
            "AABBCC01020",           // 11 chiffres
            "+ABBCC010203",
            "00:00:00:00:00:00",
            "FF:FF:FF:FF:FF:FF",
        ] {
            assert!(parse_mac(bad).is_err(), "accepté à tort : {bad:?}");
        }
    }

    #[test]
    fn magic_packet_is_six_ff_then_sixteen_macs() {
        let p = magic_packet(MAC);
        assert_eq!(p.len(), 102);
        assert_eq!(p[..6], [0xFF; 6]);
        for i in 0..16 {
            assert_eq!(p[6 + i * 6..12 + i * 6], MAC, "copie n° {i}");
        }
    }

    #[test]
    fn plan_covers_every_card() {
        let cards = [
            Card { name: "Wi-Fi".into(), addr: Ipv4Addr::new(192, 168, 1, 20), prefix: 24 },
            Card { name: "VPN".into(), addr: Ipv4Addr::new(10, 8, 0, 2), prefix: 32 },
        ];
        let p = plan(&cards);
        assert_eq!(p[0], (Ipv4Addr::UNSPECIFIED, vec![Ipv4Addr::BROADCAST]));
        assert_eq!(p[1], (Ipv4Addr::new(192, 168, 1, 20), vec![Ipv4Addr::BROADCAST, Ipv4Addr::new(192, 168, 1, 255)]));
        // Un /32 n'a pas d'adresse de diffusion : 255.255.255.255 seulement.
        assert_eq!(p[2], (Ipv4Addr::new(10, 8, 0, 2), vec![Ipv4Addr::BROADCAST]));
    }

    #[test]
    fn the_packet_really_leaves() {
        // Sur la machine même : on écoute sur 127.0.0.1 et on s'envoie le paquet.
        let listener = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let port = listener.local_addr().unwrap().port();
        let packet = magic_packet(MAC);
        let sent = send(&packet, &[(Ipv4Addr::LOCALHOST, vec![Ipv4Addr::LOCALHOST])], port).unwrap();
        assert_eq!(sent, ROUNDS);
        let mut buf = [0u8; 200];
        let (n, _) = listener.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..n], &packet[..]);
    }
}
