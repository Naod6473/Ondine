// Le réseau local : les cartes réseau IPv4 en marche, l'adresse de diffusion
// de chacune, et l'adresse « privée » du PC à donner à un téléphone.
//
// Utilisé par :
//   - les Accès distants (Wake-on-LAN) : le paquet de réveil part sur chaque
//     réseau local, par l'adresse de diffusion de chaque carte ;
//   - l'Étagère (« Vers le téléphone ») : le petit serveur n'écoute que sur
//     l'adresse du PC dans le réseau local (192.168.x.x, 10.x.x.x…).
//
// Rien n'est envoyé ici : on lit seulement la configuration des cartes (crate
// sysinfo, déjà utilisée par le module Système), et on demande à Windows par
// quelle carte il sortirait (une « connexion » UDP ne fait que choisir la
// route, aucun paquet ne part).

use std::net::{IpAddr, Ipv4Addr, UdpSocket};

use sysinfo::{InterfaceOperationalState, Networks};

/// Une adresse IPv4 d'une carte réseau en marche.
#[derive(Debug, Clone, PartialEq)]
pub struct Card {
    /// Le nom de la carte (« Wi-Fi », « Ethernet 2 », « vEthernet (WSL) »…).
    pub name: String,
    pub addr: Ipv4Addr,
    /// La longueur du masque (24 pour 255.255.255.0).
    pub prefix: u8,
}

/// Les adresses IPv4 des cartes réseau en marche, sans « 127.0.0.1 » ni les
/// adresses automatiques « 169.254.x.x » (carte sans réseau).
pub fn ipv4_cards() -> Vec<Card> {
    let networks = Networks::new_with_refreshed_list();
    let mut out = Vec::new();
    for (name, data) in networks.list() {
        // « Unknown » : certaines cartes (virtuelles, Linux) ne disent pas leur état.
        if !matches!(data.operational_state(), InterfaceOperationalState::Up | InterfaceOperationalState::Unknown) {
            continue;
        }
        for net in data.ip_networks() {
            if let IpAddr::V4(addr) = net.addr {
                if !addr.is_loopback() && !addr.is_link_local() && !addr.is_unspecified() {
                    out.push(Card { name: name.clone(), addr, prefix: net.prefix.min(32) });
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.addr.cmp(&b.addr)));
    out
}

/// L'adresse de diffusion d'un réseau : l'adresse avec tous les bits « machine »
/// à 1 (192.168.1.20/24 → 192.168.1.255). None pour un masque /31 ou /32 (pas
/// de diffusion possible sur un réseau de deux machines ou moins).
pub fn broadcast(addr: Ipv4Addr, prefix: u8) -> Option<Ipv4Addr> {
    if prefix >= 31 {
        return None;
    }
    // Le masque : `prefix` bits à 1 à gauche. (Décaler de 32 n'est pas permis,
    // d'où le cas 0 à part.)
    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - u32::from(prefix)) };
    Some(Ipv4Addr::from(u32::from(addr) | !mask))
}

/// L'adresse IPv4 du PC par laquelle Windows sortirait vers « ailleurs » (la
/// carte de la route par défaut). Aucun paquet n'est envoyé : sur une socket
/// UDP, `connect` ne fait que choisir la route. 192.0.2.1 est une adresse
/// réservée à la documentation, jamais utilisée par une vraie machine.
pub fn default_route_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

/// Une carte de machine virtuelle (Hyper-V, WSL, VirtualBox, Docker…) ou de
/// VPN : un téléphone du Wi-Fi ne peut pas joindre le PC par là.
pub fn looks_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    const WORDS: &[&str] = &["vethernet", "virtualbox", "vmware", "vmnet", "hyper-v", "wsl", "docker", "loopback"];
    const STARTS: &[&str] = &["br-", "veth", "virbr", "tun", "tap", "wg", "utun"];
    WORDS.iter().any(|w| n.contains(w))
        || STARTS.iter().any(|s| n.starts_with(s))
        || crate::platform::netwatch::looks_like_vpn(0, name, "")
}

/// Choisit l'adresse privée (10.x, 172.16-31.x, 192.168.x) à donner au
/// téléphone, parmi les cartes en marche :
///   1. celle de la route par défaut, si elle est privée et pas virtuelle
///      (c'est presque toujours le Wi-Fi ou le câble de la maison / du bureau) ;
///   2. sinon une vraie carte avant une carte virtuelle, et 192.168 avant
///      172.16 avant 10 (les VPN et les machines virtuelles prennent souvent
///      les deux derniers).
pub fn pick_private(cards: &[Card], route: Option<Ipv4Addr>) -> Option<Ipv4Addr> {
    let private: Vec<&Card> = cards.iter().filter(|c| c.addr.is_private()).collect();
    if let Some(r) = route {
        if private.iter().any(|c| c.addr == r && !looks_virtual(&c.name)) {
            return Some(r);
        }
    }
    let rank = |c: &&Card| {
        let o = c.addr.octets();
        let range = if o[0] == 192 { 0 } else if o[0] == 172 { 1 } else { 2 };
        (looks_virtual(&c.name), range)
    };
    private.into_iter().min_by_key(rank).map(|c| c.addr)
}

/// L'adresse privée du PC dans le réseau local, ou None (pas de réseau local).
pub fn private_ipv4() -> Option<Ipv4Addr> {
    pick_private(&ipv4_cards(), default_route_ipv4())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(name: &str, addr: [u8; 4], prefix: u8) -> Card {
        Card { name: name.into(), addr: Ipv4Addr::from(addr), prefix }
    }

    #[test]
    fn broadcast_addresses() {
        let ip = Ipv4Addr::new(192, 168, 1, 20);
        assert_eq!(broadcast(ip, 24), Some(Ipv4Addr::new(192, 168, 1, 255)));
        assert_eq!(broadcast(Ipv4Addr::new(10, 1, 2, 3), 8), Some(Ipv4Addr::new(10, 255, 255, 255)));
        assert_eq!(broadcast(Ipv4Addr::new(172, 20, 5, 9), 20), Some(Ipv4Addr::new(172, 20, 15, 255)));
        assert_eq!(broadcast(ip, 0), Some(Ipv4Addr::BROADCAST));
        assert_eq!(broadcast(ip, 31), None);
        assert_eq!(broadcast(ip, 32), None);
    }

    #[test]
    fn route_address_is_preferred_when_private_and_real() {
        let cards = [card("Ethernet", [10, 0, 0, 5], 8), card("Wi-Fi", [192, 168, 1, 20], 24)];
        assert_eq!(pick_private(&cards, Some(Ipv4Addr::new(10, 0, 0, 5))), Some(Ipv4Addr::new(10, 0, 0, 5)));
        // La route passe par une carte inconnue (ou publique) : on choisit parmi les cartes.
        assert_eq!(pick_private(&cards, Some(Ipv4Addr::new(8, 8, 8, 8))), Some(Ipv4Addr::new(192, 168, 1, 20)));
        assert_eq!(pick_private(&cards, None), Some(Ipv4Addr::new(192, 168, 1, 20)));
    }

    #[test]
    fn virtual_cards_and_vpns_come_last() {
        let cards = [
            card("vEthernet (WSL)", [192, 168, 80, 1], 20),
            card("NordLynx", [10, 5, 0, 2], 32),
            card("Wi-Fi", [10, 0, 0, 42], 24),
        ];
        // La route par défaut passe par le VPN : on ne la prend pas.
        assert_eq!(pick_private(&cards, Some(Ipv4Addr::new(10, 5, 0, 2))), Some(Ipv4Addr::new(10, 0, 0, 42)));
        // Seulement des cartes virtuelles : mieux que rien.
        assert_eq!(pick_private(&cards[..1], None), Some(Ipv4Addr::new(192, 168, 80, 1)));
    }

    #[test]
    fn public_addresses_are_never_given() {
        let cards = [card("Ethernet", [86, 12, 1, 3], 24), card("Wi-Fi", [100, 64, 0, 9], 10)];
        assert_eq!(pick_private(&cards, Some(Ipv4Addr::new(86, 12, 1, 3))), None);
        assert_eq!(pick_private(&[], None), None);
        // 172.32.x.x n'est pas privée (la plage s'arrête à 172.31).
        assert_eq!(pick_private(&[card("Wi-Fi", [172, 32, 0, 1], 16)], None), None);
        assert_eq!(pick_private(&[card("Wi-Fi", [172, 31, 0, 1], 16)], None), Some(Ipv4Addr::new(172, 31, 0, 1)));
    }

    #[test]
    fn reading_the_cards_does_not_fail() {
        // Sur la machine de test : on ne sait pas ce qu'il y a, mais jamais 127.0.0.1.
        assert!(ipv4_cards().iter().all(|c| !c.addr.is_loopback() && c.prefix <= 32));
    }
}
