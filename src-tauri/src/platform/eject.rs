// Éjecter une clé USB (ou un disque USB) « en toute sécurité », comme l'icône
// « Retirer le périphérique en toute sécurité » de la barre des tâches.
//
// La méthode standard de Windows, en trois étapes :
//   1. la lettre (E:) → le volume « \\.\E: » → le numéro du disque qui le
//      porte (IOCTL_STORAGE_GET_DEVICE_NUMBER) ;
//   2. parmi les disques branchés (SetupDi, interface « disque »), celui qui a
//      ce numéro → son « nœud » dans l'arbre des périphériques (un DEVINST,
//      comme une ligne du Gestionnaire de périphériques) ;
//   3. le PARENT de ce nœud (la clé USB elle-même, ou le boîtier du disque),
//      à qui l'on demande de s'éjecter : CM_Request_Device_EjectW. Windows
//      prévient les programmes, vide ses caches, puis arrête le périphérique.
//      Il refuse (« veto ») si un programme garde un fichier ouvert dessus.
//
// Quand Windows refuse, il dit quel GENRE de chose bloque (le « type de
// veto »), rarement QUEL programme. Mais Windows 10 et 11 notent alors
// l'événement 225 de « Kernel-PnP » : « L'application
// \Device\HarddiskVolume3\…\WINWORD.EXE avec l'ID de processus 1234 a arrêté
// la suppression ou l'éjection du périphérique USB\VID_… ». On le lit dans le
// journal d'événements pour donner le nom du programme.
//
// Rien n'est écrit dans le journal d'Ondine : ni le nom du volume, ni celui
// du programme. Sous Linux (vérifications), aucun lecteur n'est éjectable.

use serde::Serialize;

use super::DriveInfo;

/// Un lecteur qu'on propose d'éjecter (onglet Contrôles, notification).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Ejectable {
    /// « E:\ »
    pub root: String,
    /// « E: »
    pub letter: String,
    /// Le nom du volume (« KINGSTON »), vide s'il n'en a pas.
    pub label: String,
    /// true : clé USB, carte SD (lecteur « amovible » pour Windows) ;
    /// false : disque USB que Windows présente comme un disque « fixe ».
    pub removable: bool,
}

impl Ejectable {
    fn from_drive(d: &DriveInfo) -> Option<Ejectable> {
        let letter = letter_of(&d.root)?;
        Some(Ejectable { root: format!("{letter}:\\"), letter: format!("{letter}:"), label: d.label.clone(), removable: d.removable })
    }
}

/// Pourquoi l'éjection n'a pas marché.
#[cfg_attr(not(windows), allow(dead_code))] // sous Linux, seul NotRemovable sert
#[derive(Debug, Clone, PartialEq)]
pub enum EjectError {
    /// Windows a refusé. `kind` = le type de veto de Windows (PNP_VETO_TYPE,
    /// voir le module `veto` ; le message est choisi par le front, dans
    /// src/modules/controls/usb-text.ts) ; `blocker` = le programme (ou le
    /// service) qui bloque, quand on a pu le trouver.
    Veto { kind: i32, blocker: Option<Blocker> },
    /// Le lecteur n'est plus là (déjà retiré ?).
    Gone,
    /// Windows ne propose pas de retirer ce lecteur (disque interne…).
    NotRemovable,
    /// Autre refus de Windows (code CONFIGRET ou erreur Win32).
    Failed(u32),
}

/// Ce qui bloque une éjection.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Blocker {
    /// « WINWORD.EXE », « explorer.exe », ou le nom d'un service.
    pub name: String,
    /// true : un service de Windows (pas une fenêtre qu'on peut fermer).
    pub service: bool,
}

/// Les types de veto de Windows (PNP_VETO_TYPE), pour les messages du front.
#[allow(dead_code)] // tous ne sont pas utilisés côté Rust : la liste sert de référence
pub mod veto {
    pub const UNKNOWN: i32 = 0;
    pub const LEGACY_DEVICE: i32 = 1;
    pub const PENDING_CLOSE: i32 = 2;
    pub const WINDOWS_APP: i32 = 3;
    pub const WINDOWS_SERVICE: i32 = 4;
    pub const OUTSTANDING_OPEN: i32 = 5;
    pub const DEVICE: i32 = 6;
    pub const DRIVER: i32 = 7;
    pub const ILLEGAL_DEVICE_REQUEST: i32 = 8;
    pub const INSUFFICIENT_POWER: i32 = 9;
    pub const NON_DISABLEABLE: i32 = 10;
    pub const LEGACY_DRIVER: i32 = 11;
    pub const INSUFFICIENT_RIGHTS: i32 = 12;
    pub const ALREADY_REMOVED: i32 = 13;
}

/// « E:\ », « e: » ou « E » → 'E'. Toute autre forme est refusée.
pub fn letter_of(root: &str) -> Option<char> {
    let mut chars = root.chars();
    let letter = chars.next()?.to_ascii_uppercase();
    if !letter.is_ascii_uppercase() {
        return None;
    }
    match chars.as_str() {
        "" | ":" | ":\\" | ":/" => Some(letter),
        _ => None,
    }
}

/// Le nom du fichier d'un chemin (« \Device\HarddiskVolume3\Windows\explorer.exe » → « explorer.exe »).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn file_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path).trim()
}

/// Défait les cinq échappements du XML (&amp; &lt; &gt; &quot; &apos;).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
fn xml_unescape(text: &str) -> String {
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// Les valeurs des balises <Data …>…</Data> d'un événement rendu en XML.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
fn event_data(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<Data") {
        rest = &rest[start + 5..];
        // « <Data/> » ou « <Data Name='x'/> » : vide. Sinon le texte jusqu'à </Data>.
        let Some(close) = rest.find('>') else { break };
        if rest[..close].ends_with('/') {
            rest = &rest[close + 1..];
            continue;
        }
        rest = &rest[close + 1..];
        let Some(end) = rest.find("</Data>") else { break };
        out.push(xml_unescape(&rest[..end]));
        rest = &rest[end + 7..];
    }
    out
}

/// Le programme nommé dans un événement 225 (« WINWORD.EXE »), ou None.
/// On ne se fie pas au nom des champs (il peut changer d'une version de
/// Windows à l'autre) : on prend la première valeur qui ressemble au chemin
/// d'un .exe.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn program_in_event(xml: &str) -> Option<String> {
    event_data(xml).into_iter().find_map(|value| {
        let value = value.trim();
        let name = file_name(value);
        let looks_like_exe = name.len() > 4 && name.to_ascii_lowercase().ends_with(".exe") && value.contains(['\\', '/']);
        looks_like_exe.then(|| name.to_string())
    })
}

/// L'événement parle-t-il de ce périphérique (« USB\VID_0781&PID_5567\… ») ?
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn event_mentions(xml: &str, device_id: &str) -> bool {
    let id = device_id.trim().to_ascii_lowercase();
    !id.is_empty() && event_data(xml).iter().any(|v| v.trim().to_ascii_lowercase() == id)
}

/// Ce que Windows donne avec certains vetos : le nom de l'appli (type 3) ou
/// du service (type 4). Pour les autres types, c'est le nom d'un
/// périphérique (« STORAGE\Volume\… »), pas utile à montrer.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn blocker_from_veto(kind: i32, name: &str) -> Option<Blocker> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    match kind {
        veto::WINDOWS_APP => Some(Blocker { name: file_name(name).to_string(), service: false }),
        veto::WINDOWS_SERVICE => Some(Blocker { name: name.to_string(), service: true }),
        _ => None,
    }
}

/// La lettre du disque de Windows (« C »), jamais proposée à l'éjection
/// (Windows sur un disque USB, « Windows To Go »).
fn system_letter() -> Option<char> {
    std::env::var("SystemDrive").ok().and_then(|d| letter_of(&d))
}

/// Les lecteurs déjà vus, et s'ils sont éjectables (pour ne pas reposer la
/// question à chaque tour : demander le nom d'un volume ou son « bus » est lent).
pub type DriveCache = Vec<(DriveInfo, bool)>;

/// Les clés et disques USB branchés, dans l'ordre des lettres. `cache` garde
/// ce qu'on sait déjà des lecteurs (il est mis à jour).
pub fn ejectable_drives(cache: &mut DriveCache) -> Vec<Ejectable> {
    let known: Vec<DriveInfo> = cache.iter().map(|(d, _)| d.clone()).collect();
    let system = system_letter();
    let mut next: DriveCache = Vec::new();
    for d in super::drives(&known) {
        let ok = match cache.iter().find(|(k, _)| k.root == d.root) {
            Some((_, ok)) => *ok,
            None => {
                let letter = letter_of(&d.root);
                // Une clé, une carte SD (« amovible ») ; ou un disque « fixe » branché en USB.
                letter.is_some() && letter != system && (d.removable || letter.is_some_and(imp::on_usb))
            }
        };
        next.push((d, ok));
    }
    *cache = next;
    cache.iter().filter(|(_, ok)| *ok).filter_map(|(d, _)| Ejectable::from_drive(d)).collect()
}

#[cfg(windows)]
mod imp {
    use super::{blocker_from_veto, event_mentions, program_in_event, Blocker, EjectError};
    use std::ffi::c_void;
    use std::mem::{offset_of, size_of};
    use std::time::{Duration, Instant};

    use ::windows::core::{GUID, HSTRING, PCWSTR};
    use ::windows::Win32::Devices::DeviceAndDriverInstallation::{
        CM_Get_DevNode_Status, CM_Get_Device_IDW, CM_Get_Parent, CM_Request_Device_EjectW, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces,
        SetupDiGetClassDevsW, SetupDiGetDeviceInterfaceDetailW, CM_DEVNODE_STATUS_FLAGS, CM_PROB, CR_SUCCESS, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT,
        DN_REMOVABLE, HDEVINFO, MAX_DEVICE_ID_LEN, PNP_VETO_TYPE, PNP_VetoAlreadyRemoved, PNP_VetoTypeUnknown, SP_DEVICE_INTERFACE_DATA,
        SP_DEVICE_INTERFACE_DETAIL_DATA_W, SP_DEVINFO_DATA,
    };
    use ::windows::Win32::Foundation::{CloseHandle, HANDLE};
    use ::windows::Win32::Storage::FileSystem::{BusTypeUsb, CreateFileW, FILE_DEVICE_DISK, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
    use ::windows::Win32::System::EventLog::{
        EvtClose, EvtNext, EvtQuery, EvtQueryChannelPath, EvtQueryReverseDirection, EvtQueryTolerateQueryErrors, EvtRender, EvtRenderEventXml, EVT_HANDLE,
    };
    use ::windows::Win32::System::IO::DeviceIoControl;
    use ::windows::Win32::System::Ioctl::{
        PropertyStandardQuery, StorageDeviceProperty, GUID_DEVINTERFACE_DISK, IOCTL_STORAGE_GET_DEVICE_NUMBER, IOCTL_STORAGE_QUERY_PROPERTY,
        STORAGE_DEVICE_DESCRIPTOR, STORAGE_DEVICE_NUMBER, STORAGE_PROPERTY_QUERY,
    };

    /// Un handle de fichier ou de périphérique, refermé tout seul à la fin (Drop).
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    /// Une liste de périphériques de SetupDi, détruite toute seule à la fin.
    struct DevInfoList(HDEVINFO);
    impl Drop for DevInfoList {
        fn drop(&mut self) {
            unsafe {
                let _ = SetupDiDestroyDeviceInfoList(self.0);
            }
        }
    }

    /// Un résultat du journal d'événements, refermé tout seul à la fin.
    struct Evt(EVT_HANDLE);
    impl Drop for Evt {
        fn drop(&mut self) {
            unsafe {
                let _ = EvtClose(self.0);
            }
        }
    }

    /// Ouvre un volume (« \\.\E: ») ou un disque SANS droit de lecture ni
    /// d'écriture (accès 0) : assez pour lui poser des questions, sans être
    /// administrateur et sans gêner l'éjection.
    fn open_device(path: &str) -> Option<Handle> {
        let h = unsafe { CreateFileW(&HSTRING::from(path), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None) };
        h.ok().map(Handle)
    }

    /// Le numéro du disque qui porte ce volume (ou de ce disque), et son type.
    fn device_number(h: &Handle) -> Option<STORAGE_DEVICE_NUMBER> {
        let mut sdn = STORAGE_DEVICE_NUMBER::default();
        let mut got = 0u32;
        unsafe {
            DeviceIoControl(
                h.0,
                IOCTL_STORAGE_GET_DEVICE_NUMBER,
                None,
                0,
                Some(&mut sdn as *mut STORAGE_DEVICE_NUMBER as *mut c_void),
                size_of::<STORAGE_DEVICE_NUMBER>() as u32,
                Some(&mut got as *mut u32),
                None,
            )
        }
        .ok()?;
        (got as usize >= size_of::<STORAGE_DEVICE_NUMBER>()).then_some(sdn)
    }

    /// Le lecteur est-il branché en USB ? (pour un disque que Windows dit « fixe »)
    pub fn on_usb(letter: char) -> bool {
        let Some(h) = open_device(&format!(r"\\.\{letter}:")) else { return false };
        let query = STORAGE_PROPERTY_QUERY { PropertyId: StorageDeviceProperty, QueryType: PropertyStandardQuery, ..Default::default() };
        // La réponse (STORAGE_DEVICE_DESCRIPTOR + textes du fabricant) dans
        // une mémoire alignée ; 1 Ko suffit largement pour l'en-tête.
        let mut out = [0u32; 256];
        let mut got = 0u32;
        let asked = unsafe {
            DeviceIoControl(
                h.0,
                IOCTL_STORAGE_QUERY_PROPERTY,
                Some(&query as *const STORAGE_PROPERTY_QUERY as *const c_void),
                size_of::<STORAGE_PROPERTY_QUERY>() as u32,
                Some(out.as_mut_ptr() as *mut c_void),
                (out.len() * 4) as u32,
                Some(&mut got as *mut u32),
                None,
            )
        };
        // On lit seulement le champ BusType (un nombre de 4 octets), à sa place
        // dans la structure, sans recopier toute la structure.
        let at = offset_of!(STORAGE_DEVICE_DESCRIPTOR, BusType);
        if asked.is_err() || (got as usize) < at + 4 {
            return false;
        }
        let bytes: Vec<u8> = out.iter().flat_map(|w| w.to_ne_bytes()).collect();
        let bus = i32::from_ne_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
        bus == BusTypeUsb.0
    }

    /// Le nœud (DEVINST) du disque qui porte ce numéro, parmi les disques branchés.
    fn disk_devinst(number: u32) -> Option<u32> {
        let set = unsafe { SetupDiGetClassDevsW(Some(&GUID_DEVINTERFACE_DISK as *const GUID), PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE) }.ok()?;
        let set = DevInfoList(set);
        for index in 0..256u32 {
            let mut iface = SP_DEVICE_INTERFACE_DATA { cbSize: size_of::<SP_DEVICE_INTERFACE_DATA>() as u32, ..Default::default() };
            if unsafe { SetupDiEnumDeviceInterfaces(set.0, None, &GUID_DEVINTERFACE_DISK, index, &mut iface) }.is_err() {
                break; // plus de disque dans la liste
            }
            // 1er appel : Windows dit combien de place il faut pour le chemin du disque.
            let mut needed = 0u32;
            let _ = unsafe { SetupDiGetDeviceInterfaceDetailW(set.0, &iface, None, 0, Some(&mut needed as *mut u32), None) };
            if !(8..=64 * 1024).contains(&needed) {
                continue;
            }
            // La structure est de taille variable : { cbSize, DevicePath[…] }.
            // Une mémoire de u32 (bien alignée) assez grande ; cbSize = la
            // taille de la partie fixe (8 octets en 64 bits), comme le veut Windows.
            let mut buf = vec![0u32; (needed as usize).div_ceil(4)];
            buf[0] = size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
            let mut info = SP_DEVINFO_DATA { cbSize: size_of::<SP_DEVINFO_DATA>() as u32, ..Default::default() };
            let detail = buf.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
            if unsafe { SetupDiGetDeviceInterfaceDetailW(set.0, &iface, Some(detail), (buf.len() * 4) as u32, None, Some(&mut info as *mut SP_DEVINFO_DATA)) }.is_err() {
                continue;
            }
            // Le chemin commence juste après cbSize (4 octets = 2 caractères), terminé par un zéro.
            let wide: Vec<u16> = buf.iter().flat_map(|w| {
                let b = w.to_ne_bytes();
                [u16::from_ne_bytes([b[0], b[1]]), u16::from_ne_bytes([b[2], b[3]])]
            }).collect();
            let start = offset_of!(SP_DEVICE_INTERFACE_DETAIL_DATA_W, DevicePath) / 2;
            let path = &wide[start.min(wide.len())..];
            let len = path.iter().position(|&c| c == 0).unwrap_or(path.len());
            let path = String::from_utf16_lossy(&path[..len]);
            let Some(disk) = open_device(&path) else { continue };
            let found = device_number(&disk).is_some_and(|n| n.DeviceNumber == number && n.DeviceType == FILE_DEVICE_DISK.0);
            if found {
                return Some(info.DevInst);
            }
        }
        None
    }

    /// Windows dit-il ce nœud « amovible » (DN_REMOVABLE) ?
    fn is_removable(devinst: u32) -> bool {
        let mut status = CM_DEVNODE_STATUS_FLAGS(0);
        let mut problem = CM_PROB(0);
        let cr = unsafe { CM_Get_DevNode_Status(&mut status, &mut problem, devinst, 0) };
        cr == CR_SUCCESS && (status.0 & DN_REMOVABLE.0) != 0
    }

    /// L'identifiant d'un nœud (« USB\VID_0781&PID_5567\4C53… »).
    fn instance_id(devinst: u32) -> Option<String> {
        let mut buf = [0u16; MAX_DEVICE_ID_LEN as usize + 1];
        if unsafe { CM_Get_Device_IDW(devinst, &mut buf, 0) } != CR_SUCCESS {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }

    pub fn eject(letter: char) -> Result<(), EjectError> {
        let started = Instant::now();
        // 1. Le volume → le numéro de son disque. Le handle est refermé tout
        //    de suite (fin du bloc) : ouvert, il bloquerait notre propre éjection.
        let number = {
            let volume = open_device(&format!(r"\\.\{letter}:")).ok_or(EjectError::Gone)?;
            device_number(&volume).ok_or(EjectError::NotRemovable)?
        };
        if number.DeviceType != FILE_DEVICE_DISK.0 {
            return Err(EjectError::NotRemovable); // lecteur de CD, disque virtuel…
        }
        // 2. Le numéro → le nœud du disque.
        let disk = disk_devinst(number.DeviceNumber).ok_or(EjectError::NotRemovable)?;
        // 3. Le parent (la clé, le boîtier USB) s'il est amovible ; sinon le
        //    disque lui-même s'il l'est (carte SD dans un lecteur intégré).
        //    Ni l'un ni l'autre : on ne touche à rien (on n'éjecte jamais un
        //    contrôleur interne du PC).
        let mut parent = 0u32;
        let has_parent = unsafe { CM_Get_Parent(&mut parent, disk, 0) } == CR_SUCCESS;
        let target = if has_parent && is_removable(parent) {
            parent
        } else if is_removable(disk) {
            disk
        } else {
            return Err(EjectError::NotRemovable);
        };

        // Souvent, le premier essai échoue et le deuxième passe : jusqu'à 3 essais.
        let mut last = (PNP_VetoTypeUnknown, String::new(), 0u32);
        for attempt in 0..3 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(500));
            }
            let mut veto = PNP_VetoTypeUnknown;
            let mut name = [0u16; 260];
            // Avec un « veto » à remplir, Windows n'affiche pas sa propre fenêtre d'erreur.
            let cr = unsafe { CM_Request_Device_EjectW(target, Some(&mut veto as *mut PNP_VETO_TYPE), Some(&mut name[..]), 0) };
            if (cr == CR_SUCCESS && veto == PNP_VetoTypeUnknown) || veto == PNP_VetoAlreadyRemoved {
                return Ok(());
            }
            let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            last = (veto, String::from_utf16_lossy(&name[..len]), cr.0);
        }
        let (veto, name, code) = last;
        if veto == PNP_VetoTypeUnknown && code != CR_SUCCESS.0 {
            // Pas un veto : une autre erreur de Windows. Peut-être quand même un programme qui bloque.
            let ids: Vec<String> = [instance_id(target), instance_id(disk)].into_iter().flatten().collect();
            if let Some(program) = blocker_from_events(started, &ids) {
                return Err(EjectError::Veto { kind: veto.0, blocker: Some(Blocker { name: program, service: false }) });
            }
            return Err(EjectError::Failed(code));
        }
        let blocker = blocker_from_veto(veto.0, &name).or_else(|| {
            let ids: Vec<String> = [instance_id(target), instance_id(disk)].into_iter().flatten().collect();
            blocker_from_events(started, &ids).map(|name| Blocker { name, service: false })
        });
        Err(EjectError::Veto { kind: veto.0, blocker })
    }

    /// Cherche, dans le journal d'événements, le programme qui vient de bloquer
    /// l'éjection (événement 225). Windows l'écrit juste après le refus : on
    /// regarde quelques fois, pendant au plus ≈ 1,5 s.
    fn blocker_from_events(since: Instant, device_ids: &[String]) -> Option<String> {
        for attempt in 0..4 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(400));
            }
            // Les événements écrits depuis le début de l'éjection (+ 3 s de marge).
            let window_ms = since.elapsed().as_millis() as u64 + 3_000;
            if let Some(program) = query_225(window_ms, device_ids) {
                return Some(program);
            }
        }
        None
    }

    /// Les événements 225 des `window_ms` dernières millisecondes, du plus
    /// récent au plus ancien : le programme de celui qui parle de notre
    /// périphérique, sinon du plus récent.
    fn query_225(window_ms: u64, device_ids: &[String]) -> Option<String> {
        // Selon la version de Windows, l'événement est dans le journal
        // « Système » ou dans « Kernel-PnP/Configuration » : on lit les deux.
        // (« &lt;= » : le signe « <= » écrit en XML.)
        let query = format!(
            "<QueryList><Query Id=\"0\">\
             <Select Path=\"System\">*[System[Provider[@Name='Microsoft-Windows-Kernel-PnP'] and (EventID=225) and TimeCreated[timediff(@SystemTime) &lt;= {window_ms}]]]</Select>\
             <Select Path=\"Microsoft-Windows-Kernel-PnP/Configuration\">*[System[(EventID=225) and TimeCreated[timediff(@SystemTime) &lt;= {window_ms}]]]</Select>\
             </Query></QueryList>"
        );
        // Tolérer les erreurs : un journal absent ou illisible n'empêche pas de lire l'autre.
        let flags = EvtQueryChannelPath.0 | EvtQueryReverseDirection.0 | EvtQueryTolerateQueryErrors.0;
        let results = unsafe { EvtQuery(None, PCWSTR::null(), &HSTRING::from(query), flags) }.ok()?;
        let results = Evt(results);
        let mut raw = [0isize; 16];
        let mut got = 0u32;
        unsafe { EvtNext(results.0, &mut raw, 1_000, 0, &mut got) }.ok()?;
        // Chaque événement reçu est refermé à la fin (Drop), même ceux qu'on ne lit pas.
        let events: Vec<Evt> = raw.iter().take(got as usize).map(|&h| Evt(EVT_HANDLE(h))).collect();
        let mut newest = None;
        for event in &events {
            let Some(xml) = render_xml(event) else { continue };
            let Some(program) = program_in_event(&xml) else { continue };
            if device_ids.iter().any(|id| event_mentions(&xml, id)) {
                return Some(program);
            }
            newest.get_or_insert(program);
        }
        newest
    }

    /// Un événement en texte XML.
    fn render_xml(event: &Evt) -> Option<String> {
        let (mut used, mut count) = (0u32, 0u32);
        // 1er appel sans mémoire : Windows dit combien d'octets il faut.
        let _ = unsafe { EvtRender(None, event.0, EvtRenderEventXml.0, 0, None, &mut used, &mut count) };
        if used == 0 || used > 1 << 20 {
            return None;
        }
        let mut buf = vec![0u16; (used as usize).div_ceil(2)];
        unsafe { EvtRender(None, event.0, EvtRenderEventXml.0, (buf.len() * 2) as u32, Some(buf.as_mut_ptr() as *mut c_void), &mut used, &mut count) }.ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }
}

#[cfg(not(windows))]
mod imp {
    use super::EjectError;

    pub fn on_usb(_letter: char) -> bool {
        false
    }
    pub fn eject(_letter: char) -> Result<(), EjectError> {
        Err(EjectError::NotRemovable)
    }
}

/// Éjecte le lecteur « E:\ ». Peut prendre plusieurs secondes (Windows
/// demande leur avis aux programmes) : à appeler depuis un thread à soi.
pub fn eject(root: &str) -> Result<(), EjectError> {
    let letter = letter_of(root).ok_or(EjectError::Gone)?;
    imp::eject(letter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_letters() {
        assert_eq!(letter_of("E:\\"), Some('E'));
        assert_eq!(letter_of("e:"), Some('E'));
        assert_eq!(letter_of("F"), Some('F'));
        assert_eq!(letter_of("E:\\dossier"), None);
        assert_eq!(letter_of("\\\\serveur\\partage"), None);
        assert_eq!(letter_of("1:"), None);
        assert_eq!(letter_of(""), None);
        assert_eq!(letter_of("É:"), None);
    }

    /// Un événement 225 tel que Windows le rend (forme du XML de EvtRender).
    const EVENT_225: &str = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System>\
        <Provider Name='Microsoft-Windows-Kernel-PnP' Guid='{9c205a39-1250-487d-abd7-e831c6290539}'/><EventID>225</EventID>\
        <Level>3</Level><TimeCreated SystemTime='2026-10-07T14:03:12.4561234Z'/><Channel>System</Channel></System>\
        <EventData><Data Name='DeviceInstance'>USB\\VID_0781&amp;PID_5567\\4C530001230608115384</Data>\
        <Data Name='ProcessId'>5764</Data><Data Name='ProcessName'>\\Device\\HarddiskVolume3\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE</Data>\
        <Data Name='Empty'/></EventData></Event>";

    #[test]
    fn program_from_event_225() {
        assert_eq!(program_in_event(EVENT_225).as_deref(), Some("WINWORD.EXE"));
        assert!(event_mentions(EVENT_225, "usb\\vid_0781&pid_5567\\4c530001230608115384"));
        assert!(!event_mentions(EVENT_225, "USB\\VID_0951&PID_1666\\AAAA"));
        assert!(!event_mentions(EVENT_225, ""));
        // Des champs sans nom, dans un autre ordre : on trouve quand même l'exe.
        let other = "<EventData><Data>1234</Data><Data>\\Device\\HarddiskVolume2\\Windows\\explorer.exe</Data></EventData>";
        assert_eq!(program_in_event(other).as_deref(), Some("explorer.exe"));
        // Pas de chemin d'exe : rien (« System », un nombre…).
        assert_eq!(program_in_event("<EventData><Data>System</Data><Data>4</Data></EventData>"), None);
        assert_eq!(program_in_event("<EventData><Data>.exe</Data></EventData>"), None);
        assert_eq!(program_in_event(""), None);
        // XML coupé : pas de panique.
        assert_eq!(program_in_event("<EventData><Data Name='x'>C:\\a\\b.exe"), None);
    }

    #[test]
    fn blockers_named_by_windows() {
        let app = blocker_from_veto(veto::WINDOWS_APP, "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe").unwrap();
        assert_eq!(app, Blocker { name: "vlc.exe".into(), service: false });
        let svc = blocker_from_veto(veto::WINDOWS_SERVICE, "WSearch").unwrap();
        assert_eq!(svc, Blocker { name: "WSearch".into(), service: true });
        // Pour les autres types, Windows donne un périphérique : on ne l'affiche pas.
        assert_eq!(blocker_from_veto(veto::OUTSTANDING_OPEN, "STORAGE\\Volume\\_??_USBSTOR#Disk"), None);
        assert_eq!(blocker_from_veto(veto::WINDOWS_APP, "  "), None);
    }

    #[test]
    fn file_names() {
        assert_eq!(file_name("\\Device\\HarddiskVolume3\\Windows\\explorer.exe"), "explorer.exe");
        assert_eq!(file_name("vlc.exe"), "vlc.exe");
        assert_eq!(file_name("C:/a/b.exe"), "b.exe");
    }

    #[test]
    fn nothing_to_eject_outside_windows() {
        // Sous Linux, platform::drives ne voit aucun lecteur.
        if cfg!(not(windows)) {
            let mut cache = DriveCache::new();
            assert!(ejectable_drives(&mut cache).is_empty());
            assert_eq!(eject("E:\\"), Err(EjectError::NotRemovable));
        }
        assert_eq!(eject("pas une lettre"), Err(EjectError::Gone));
    }
}
