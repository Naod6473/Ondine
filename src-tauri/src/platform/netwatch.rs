// Surveiller le réseau sans rien envoyer : Internet est-il joignable, et
// quels VPN sont branchés ?
//
// - Internet : Windows le sait déjà (c'est l'icône réseau de la barre des
//   tâches, « Pas d'accès Internet »). On le lui demande avec NetworkListManager.
// - VPN : on regarde les cartes réseau « en marche » (GetAdaptersAddresses) et
//   on garde celles qui ressemblent à un VPN : type « tunnel / PPP / virtuelle »
//   ou un nom connu (WireGuard, OpenVPN, FortiClient, AnyConnect…).
//
// Pour le scanner du réseau local (modules/nettools.rs) : les cartes en marche
// avec leur adresse IPv4 et leur passerelle (`local_nets`), et la table ARP de
// Windows (`neighbors`), lues sans rien envoyer.
//
// Rien ne part sur Internet ici.

/// Les mots qui trahissent une carte VPN dans son nom ou sa description.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows
const VPN_WORDS: &[&str] = &[
    "vpn", "wireguard", "openvpn", "tap-windows", "wintun", "fortinet", "forticlient", "anyconnect", "globalprotect", "pangp",
    "juniper", "pulse secure", "sonicwall", "checkpoint", "nordlynx", "tailscale", "zerotier", "proton",
];

/// Types de carte (IANA ifType) : 23 = PPP (VPN Windows intégré), 131 = tunnel.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows
const IF_TYPE_PPP: u32 = 23;
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows
const IF_TYPE_TUNNEL: u32 = 131;

/// Cette carte réseau ressemble-t-elle à un VPN ?
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows
pub fn looks_like_vpn(if_type: u32, name: &str, description: &str) -> bool {
    if if_type == IF_TYPE_PPP {
        return true;
    }
    let text = format!("{name} {description}").to_lowercase();
    // Un « tunnel » seul ne suffit pas : Windows a des tunnels IPv6 (Teredo…) partout.
    let known = VPN_WORDS.iter().any(|w| text.contains(w));
    known || (if_type == IF_TYPE_TUNNEL && text.contains("vpn"))
}

/// Une carte réseau branchée avec une adresse IPv4 (pour le scanner du réseau local).
#[derive(Debug, Clone, PartialEq)]
pub struct LocalNet {
    pub ip: std::net::Ipv4Addr,
    pub prefix: u8,
    pub gateway: Option<std::net::Ipv4Addr>,
    pub name: String,
    /// Ressemble à un VPN (`looks_like_vpn`) : le scanner l'évite.
    pub vpn: bool,
}

#[cfg(windows)]
mod imp {
    use super::looks_like_vpn;
    use ::windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use ::windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use ::windows::Win32::Networking::NetworkListManager::{
        INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET, NLM_CONNECTIVITY_IPV6_INTERNET,
    };
    use ::windows::Win32::Networking::WinSock::AF_UNSPEC;
    use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    /// Some(true) : Internet joignable ; Some(false) : pas d'Internet ; None : on ne sait pas.
    pub fn internet() -> Option<bool> {
        crate::platform::with_com(|| unsafe {
            let nlm: INetworkListManager = CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL).ok()?;
            let c = nlm.GetConnectivity().ok()?.0;
            Some(c & (NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0) != 0)
        })
    }

    /// Les noms des VPN branchés en ce moment (triés).
    pub fn vpns_up() -> Vec<String> {
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        // Windows dit la taille nécessaire ; on réessaie si une carte est apparue entre-temps.
        let mut size: u32 = 16 * 1024;
        for _ in 0..3 {
            // Un tableau de u64 : la mémoire est bien alignée pour la structure.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let first = buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
            let err = unsafe { GetAdaptersAddresses(AF_UNSPEC.0 as u32, flags, None, Some(first), &mut size) };
            if err == 111 {
                continue; // ERROR_BUFFER_OVERFLOW : `size` a été mis à jour
            }
            if err != 0 {
                return Vec::new();
            }
            let mut names = Vec::new();
            let mut cur = first as *const IP_ADAPTER_ADDRESSES_LH;
            while !cur.is_null() {
                let a = unsafe { &*cur };
                if a.OperStatus == IfOperStatusUp {
                    let name = unsafe { a.FriendlyName.to_string() }.unwrap_or_default();
                    let desc = unsafe { a.Description.to_string() }.unwrap_or_default();
                    if looks_like_vpn(a.IfType, &name, &desc) {
                        names.push(name);
                    }
                }
                cur = a.Next;
            }
            names.sort();
            names.dedup();
            return names;
        }
        Vec::new()
    }

    /// L'adresse IPv4 d'une SOCKET_ADDRESS, s'il y en a une.
    fn ipv4_of(sa: &::windows::Win32::Networking::WinSock::SOCKET_ADDRESS) -> Option<std::net::Ipv4Addr> {
        use ::windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};
        if sa.lpSockaddr.is_null() || (sa.iSockaddrLength as usize) < std::mem::size_of::<SOCKADDR_IN>() {
            return None;
        }
        let raw = unsafe { std::ptr::read_unaligned(sa.lpSockaddr as *const SOCKADDR_IN) };
        if raw.sin_family != AF_INET {
            return None;
        }
        Some(std::net::Ipv4Addr::from(unsafe { raw.sin_addr.S_un.S_addr }.to_ne_bytes()))
    }

    /// Les cartes réseau en marche (hors boucle locale), avec leur adresse IPv4,
    /// la longueur du préfixe et la passerelle.
    pub fn local_nets() -> Vec<super::LocalNet> {
        use ::windows::Win32::NetworkManagement::IpHelper::GAA_FLAG_INCLUDE_GATEWAYS;
        use ::windows::Win32::Networking::WinSock::AF_INET;
        const IF_TYPE_LOOPBACK: u32 = 24;
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_INCLUDE_GATEWAYS;
        let mut size: u32 = 16 * 1024;
        for _ in 0..3 {
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let first = buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
            let err = unsafe { GetAdaptersAddresses(AF_INET.0 as u32, flags, None, Some(first), &mut size) };
            if err == 111 {
                continue; // ERROR_BUFFER_OVERFLOW
            }
            if err != 0 {
                return Vec::new();
            }
            let mut out = Vec::new();
            let mut cur = first as *const IP_ADAPTER_ADDRESSES_LH;
            while !cur.is_null() {
                let a = unsafe { &*cur };
                if a.OperStatus == IfOperStatusUp && a.IfType != IF_TYPE_LOOPBACK {
                    let name = unsafe { a.FriendlyName.to_string() }.unwrap_or_default();
                    let desc = unsafe { a.Description.to_string() }.unwrap_or_default();
                    let mut gateway = None;
                    let mut g = a.FirstGatewayAddress as *const ::windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_GATEWAY_ADDRESS_LH;
                    while !g.is_null() && gateway.is_none() {
                        let ga = unsafe { &*g };
                        gateway = ipv4_of(&ga.Address).filter(|ip| !ip.is_unspecified());
                        g = ga.Next;
                    }
                    let mut u = a.FirstUnicastAddress as *const ::windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_UNICAST_ADDRESS_LH;
                    while !u.is_null() {
                        let ua = unsafe { &*u };
                        if let Some(ip) = ipv4_of(&ua.Address).filter(|ip| !ip.is_loopback() && !ip.is_link_local()) {
                            out.push(super::LocalNet { ip, prefix: ua.OnLinkPrefixLength, gateway, name: name.clone(), vpn: looks_like_vpn(a.IfType, &name, &desc) });
                        }
                        u = ua.Next;
                    }
                }
                cur = a.Next;
            }
            return out;
        }
        Vec::new()
    }

    /// La table ARP de Windows (adresses IPv4 → adresses MAC), sans rien
    /// envoyer : les voisins que le PC connaît déjà.
    pub fn neighbors() -> Vec<(std::net::Ipv4Addr, [u8; 6])> {
        use ::windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIpNetTable2, MIB_IPNET_TABLE2};
        use ::windows::Win32::Networking::WinSock::{NlnsIncomplete, NlnsUnreachable, AF_INET};
        let mut table: *mut MIB_IPNET_TABLE2 = std::ptr::null_mut();
        if unsafe { GetIpNetTable2(AF_INET, &mut table) }.0 != 0 || table.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        unsafe {
            let count = (*table).NumEntries as usize;
            let rows = std::ptr::addr_of!((*table).Table) as *const ::windows::Win32::NetworkManagement::IpHelper::MIB_IPNET_ROW2;
            for i in 0..count {
                let row = &*rows.add(i);
                if row.PhysicalAddressLength != 6 || row.State == NlnsUnreachable || row.State == NlnsIncomplete {
                    continue;
                }
                if row.Address.si_family != AF_INET {
                    continue;
                }
                let ip = std::net::Ipv4Addr::from(row.Address.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes());
                let mut mac = [0u8; 6];
                mac.copy_from_slice(&row.PhysicalAddress[..6]);
                out.push((ip, mac));
            }
            FreeMibTable(table as *const _);
        }
        out
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn internet() -> Option<bool> {
        None
    }
    pub fn vpns_up() -> Vec<String> {
        Vec::new()
    }
    pub fn local_nets() -> Vec<super::LocalNet> {
        Vec::new()
    }
    pub fn neighbors() -> Vec<(std::net::Ipv4Addr, [u8; 6])> {
        Vec::new()
    }
}

pub use imp::{internet, local_nets, neighbors, vpns_up};

#[cfg(test)]
mod tests {
    use super::looks_like_vpn;

    #[test]
    fn spots_vpn_adapters() {
        assert!(looks_like_vpn(23, "VPN pro", "WAN Miniport (IKEv2)"));
        assert!(looks_like_vpn(53, "WireGuard Tunnel", "WireGuard Tunnel"));
        assert!(looks_like_vpn(6, "Ethernet 3", "Fortinet Virtual Ethernet Adapter (NDIS 6.30)"));
        assert!(!looks_like_vpn(6, "Ethernet", "Intel(R) Ethernet Connection I219-LM"));
        assert!(!looks_like_vpn(71, "Wi-Fi", "Intel(R) Wi-Fi 6 AX201"));
        assert!(!looks_like_vpn(131, "Teredo", "Teredo Tunneling Pseudo-Interface"));
    }
}
