//! HTTPS pour le navigateur du téléphone. Une autorité propre à ce PC,
//! exportable uniquement sous forme publique ; sa clé reste dans Windows.
use crate::sync::LockExt;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rcgen::{
    BasicConstraints, CertificateParams, CidrSubnet, DnType, ExtendedKeyUsagePurpose,
    GeneralSubtree, IsCa, Issuer, KeyPair, KeyUsagePurpose, NameConstraints,
};
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use time::OffsetDateTime;

const ROOT_LIFE: i64 = 2 * 365 * 24 * 3600;
static SAVING: Mutex<()> = Mutex::new(());
static BOOTSTRAP: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// Ce qu'il faut pour signer : l'autorité d'UN téléphone (clé privée comprise).
#[derive(Clone)]
struct Identity {
    key: String,
    cert: String,
    created: i64,
    name: String,
}

/// Un téléphone préparé. Chaque téléphone a SA propre autorité : en révoquer
/// un efface sa clé, et plus rien ne peut produire un certificat qu'il croit,
/// sans toucher aux autres. Seule la partie publique est dans ce fichier
/// (phones.json) ; la clé privée reste dans le Gestionnaire d'identifiants.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Phone {
    id: String,
    /// Le nom choisi (« iPhone de Simon »).
    name: String,
    /// Le nom de l'autorité, celui que le téléphone affiche.
    authority: String,
    cert: String,
    created: i64,
    /// Quand le téléphone a téléchargé le certificat.
    #[serde(default)]
    installed: Option<i64>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Phones {
    #[serde(default)]
    list: Vec<Phone>,
    /// Le téléphone pour lequel l'Étagère et la télécommande ouvrent leur lien.
    #[serde(default)]
    active: String,
}

fn ca_params(identity: &Identity) -> Result<CertificateParams, String> {
    let mut p = CertificateParams::default();
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    // Le téléphone ne lui fait confiance QUE pour les adresses du réseau local :
    // même avec sa clé, personne ne peut s'en servir pour imiter un vrai site
    // (banque, messagerie…). Aucun nom de domaine n'est permis, hormis un nom
    // réservé qui n'existe pas sur Internet (RFC 6761).
    p.name_constraints = Some(NameConstraints {
        permitted_subtrees: vec![
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([10, 0, 0, 0], 8)),
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([172, 16, 0, 0], 12)),
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([192, 168, 0, 0], 16)),
            // Les tests du serveur tournent sur 127.0.0.1.
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([127, 0, 0, 0], 8)),
            GeneralSubtree::DnsName("ondine.invalid".into()),
        ],
        excluded_subtrees: vec![],
    });
    p.distinguished_name
        .push(DnType::CommonName, identity.name.clone());
    p.not_before =
        OffsetDateTime::from_unix_timestamp(identity.created - 86400).map_err(|e| e.to_string())?;
    p.not_after = OffsetDateTime::from_unix_timestamp(identity.created + ROOT_LIFE)
        .map_err(|e| e.to_string())?;
    Ok(p)
}

fn generate(created: i64) -> Result<Identity, String> {
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let hash = format!("{:x}", Sha256::digest(key.public_key_raw()));
    let mut identity = Identity {
        key: key.serialize_pem(),
        cert: String::new(),
        created,
        name: format!("Ondine réseau local {}", &hash[..12]),
    };
    let cert = ca_params(&identity)?
        .self_signed(&key)
        .map_err(|e| e.to_string())?;
    identity.cert = B64.encode(cert.der());
    Ok(identity)
}

// ── Où sont rangés les téléphones ───────────────────────────────────────────
// Les tests ne touchent jamais au fichier ni aux identifiants de l'utilisateur.

#[cfg(not(test))]
fn phones_path() -> std::path::PathBuf {
    crate::platform::config_dir().join("phones.json")
}

#[cfg(not(test))]
fn load() -> Phones {
    std::fs::read_to_string(phones_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[cfg(not(test))]
fn store(phones: &Phones) -> Result<(), String> {
    let path = phones_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(phones).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(not(test))]
fn key_get(id: &str) -> Result<Option<String>, String> {
    super::credentials::phone_key_get(id)
}
#[cfg(not(test))]
fn key_set(id: &str, pem: &str) -> Result<(), String> {
    super::credentials::phone_key_set(id, pem)
}
#[cfg(not(test))]
fn key_delete(id: &str) -> Result<(), String> {
    super::credentials::phone_key_delete(id)
}

#[cfg(test)]
static TEST_PHONES: Mutex<Option<Phones>> = Mutex::new(None);
#[cfg(test)]
static TEST_KEYS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
#[cfg(test)]
fn load() -> Phones {
    TEST_PHONES.locked().as_ref().map(|p| Phones { list: p.list.clone(), active: p.active.clone() }).unwrap_or_default()
}
#[cfg(test)]
fn store(phones: &Phones) -> Result<(), String> {
    *TEST_PHONES.locked() = Some(Phones { list: phones.list.clone(), active: phones.active.clone() });
    Ok(())
}
#[cfg(test)]
fn key_get(id: &str) -> Result<Option<String>, String> {
    Ok(TEST_KEYS.locked().iter().find(|(k, _)| k == id).map(|(_, v)| v.clone()))
}
#[cfg(test)]
fn key_set(id: &str, pem: &str) -> Result<(), String> {
    TEST_KEYS.locked().push((id.to_string(), pem.to_string()));
    Ok(())
}
#[cfg(test)]
fn key_delete(id: &str) -> Result<(), String> {
    TEST_KEYS.locked().retain(|(k, _)| k != id);
    Ok(())
}

fn now() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp()
}

fn fingerprint(cert_b64: &str) -> String {
    B64.decode(cert_b64)
        .map(|der| format!("{:X}", Sha256::digest(der)))
        .unwrap_or_default()
}

/// L'autorité du téléphone actif (celui de l'Étagère et de la télécommande).
fn active_identity() -> Result<Identity, String> {
    #[cfg(test)]
    test_phone();
    let phones = load();
    let phone = phones
        .list
        .iter()
        .find(|p| p.id == phones.active)
        .or_else(|| phones.list.iter().max_by_key(|p| p.created))
        .ok_or("aucun téléphone préparé : Réglages → Téléphones → Ajouter un téléphone")?;
    let key = key_get(&phone.id)?.ok_or("clé de ce téléphone introuvable : révoquez-le puis préparez-le à nouveau dans Réglages → Téléphones")?;
    Ok(Identity { key, cert: phone.cert.clone(), created: phone.created, name: phone.authority.clone() })
}

/// Le nom du téléphone actif, montré à côté des QR codes HTTPS.
pub fn active_name() -> Option<String> {
    let phones = load();
    phones
        .list
        .iter()
        .find(|p| p.id == phones.active)
        .or_else(|| phones.list.iter().max_by_key(|p| p.created))
        .map(|p| p.name.clone())
}

/// Les téléphones préparés, pour la page Réglages → Téléphones.
pub fn list() -> Value {
    let phones = load();
    let active = active_name_id(&phones);
    let list: Vec<Value> = phones
        .list
        .iter()
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "authority": p.authority,
                "created": p.created,
                "installed": p.installed,
                "expires": p.created + ROOT_LIFE,
                "fingerprint": fingerprint(&p.cert),
                "active": Some(&p.id) == active.as_ref(),
            })
        })
        .collect();
    json!({ "phones": list })
}

fn active_name_id(phones: &Phones) -> Option<String> {
    phones
        .list
        .iter()
        .find(|p| p.id == phones.active)
        .or_else(|| phones.list.iter().max_by_key(|p| p.created))
        .map(|p| p.id.clone())
}

/// Le téléphone pour lequel l'Étagère et la télécommande ouvrent leur lien.
pub fn activate(id: &str) -> Result<(), String> {
    let _saving = SAVING.locked();
    let mut phones = load();
    if !phones.list.iter().any(|p| p.id == id) {
        return Err("ce téléphone n'est plus dans la liste".into());
    }
    phones.active = id.to_string();
    store(&phones)
}

/// Révoque un téléphone : sa clé est effacée, Ondine ne pourra plus jamais
/// produire un certificat qu'il accepte. Les autres téléphones continuent.
pub fn revoke(id: &str) -> Result<(), String> {
    let _saving = SAVING.locked();
    let mut phones = load();
    let before = phones.list.len();
    phones.list.retain(|p| p.id != id);
    if phones.list.len() == before {
        return Err("ce téléphone n'est plus dans la liste".into());
    }
    if phones.active == id {
        phones.active = phones.list.iter().max_by_key(|p| p.created).map(|p| p.id.clone()).unwrap_or_default();
    }
    // La clé d'abord : même si le fichier ne s'écrit pas, plus rien ne signe.
    key_delete(id)?;
    store(&phones)
}

/// Ajoute un téléphone (nouvelle autorité), ou reprend un téléphone existant
/// (`id`) pour montrer de nouveau son QR code.
fn prepare(id: Option<&str>, name: Option<&str>) -> Result<Phone, String> {
    let _saving = SAVING.locked();
    let mut phones = load();
    if let Some(id) = id.filter(|id| !id.is_empty()) {
        let phone = phones.list.iter().find(|p| p.id == id).cloned().ok_or("ce téléphone n'est plus dans la liste")?;
        if now() < phone.created + ROOT_LIFE && key_get(&phone.id)?.is_some() {
            return Ok(phone);
        }
        return Err("ce téléphone a expiré : révoquez-le puis ajoutez-le de nouveau".into());
    }
    let name: String = name.unwrap_or("").trim().chars().filter(|c| !c.is_control()).take(40).collect();
    let name = if name.is_empty() { format!("Téléphone {}", phones.list.len() + 1) } else { name };
    let identity = generate(now())?;
    let phone = Phone {
        id: crate::modules::shelf_phone::new_token()?[..12].to_string(),
        name,
        authority: identity.name.clone(),
        cert: identity.cert.clone(),
        created: identity.created,
        installed: None,
    };
    key_set(&phone.id, &identity.key)?;
    phones.list.push(phone.clone());
    phones.active = phone.id.clone();
    store(&phones)?;
    Ok(phone)
}

fn mark_installed(id: &str) {
    let _saving = SAVING.locked();
    let mut phones = load();
    if let Some(p) = phones.list.iter_mut().find(|p| p.id == id) {
        p.installed = Some(now());
        let _ = store(&phones);
    }
}

fn config(identity: &Identity, ip: Ipv4Addr) -> Result<Arc<ServerConfig>, String> {
    let now = OffsetDateTime::now_utc();
    if now.unix_timestamp() >= identity.created + ROOT_LIFE {
        return Err("certificat de ce téléphone expiré : révoquez-le puis ajoutez-le de nouveau dans Réglages → Téléphones".into());
    }
    let key = KeyPair::from_pem(&identity.key).map_err(|_| "clé du certificat local illisible")?;
    let issuer = Issuer::new(ca_params(identity)?, key);
    let leaf_key = KeyPair::generate().map_err(|e| e.to_string())?;
    let mut p = CertificateParams::new(vec![ip.to_string()]).map_err(|e| e.to_string())?;
    p.distinguished_name
        .push(DnType::CommonName, "Ondine réseau local");
    p.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    p.not_before = now - time::Duration::minutes(5);
    p.not_after = (now + time::Duration::days(7)).min(
        OffsetDateTime::from_unix_timestamp(identity.created + ROOT_LIFE)
            .map_err(|e| e.to_string())?,
    );
    let leaf = p.signed_by(&leaf_key, &issuer).map_err(|e| e.to_string())?;
    let root = CertificateDer::from(
        B64.decode(&identity.cert)
            .map_err(|_| "certificat local illisible")?,
    );
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(
            vec![leaf.der().clone(), root],
            PrivatePkcs8KeyDer::from(leaf_key.serialize_der()).into(),
        )
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(config))
}

/// Le serveur HTTPS de l'Étagère ou de la télécommande, pour le téléphone actif.
pub fn server(ip: Ipv4Addr) -> Result<Arc<ServerConfig>, String> {
    config(&active_identity()?, ip)
}

/// La seule forme de transport des fichiers privés et de la télécommande.
struct DeadlineSocket {
    socket: TcpStream,
    read_until: Instant,
}
impl Read for DeadlineSocket {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let remaining = self.read_until.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "délai de réception dépassé",
            ));
        }
        self.socket.set_read_timeout(Some(remaining))?;
        self.socket.read(buf)
    }
}
impl Write for DeadlineSocket {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.socket.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.socket.flush()
    }
}
pub struct SecureStream(StreamOwned<ServerConnection, DeadlineSocket>);
impl SecureStream {
    pub fn accept(socket: TcpStream, config: Arc<ServerConfig>) -> io::Result<Self> {
        socket.set_nonblocking(false)?;
        socket.set_read_timeout(Some(Duration::from_secs(10)))?;
        socket.set_write_timeout(Some(Duration::from_secs(60)))?;
        let connection = ServerConnection::new(config).map_err(io::Error::other)?;
        Ok(Self(StreamOwned::new(
            connection,
            DeadlineSocket {
                socket,
                read_until: Instant::now() + Duration::from_secs(10),
            },
        )))
    }
    pub fn set_read_timeout(&mut self, timeout: Option<Duration>) -> io::Result<()> {
        self.0.sock.read_until = Instant::now() + timeout.unwrap_or(Duration::from_secs(10));
        self.0.sock.socket.set_read_timeout(timeout)
    }
    pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.0.sock.socket.set_write_timeout(timeout)
    }
    pub fn shutdown(&mut self, how: Shutdown) -> io::Result<()> {
        self.0.conn.send_close_notify();
        self.0.flush()?;
        self.0.sock.socket.shutdown(how)
    }
}
impl Read for SecureStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}
impl Write for SecureStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

/// HTTP sert UNIQUEMENT le certificat public, jamais un fichier ni une action.
/// L'empreinte doit être comparée avec celle affichée dans Ondine avant de
/// lui accorder confiance sur le téléphone (le réseau initial n'est pas fiable).
pub fn setup(id: Option<String>, name: Option<String>) -> Result<Value, String> {
    let ip =
        super::lan::private_ipv4().ok_or("connectez le PC et le téléphone au même réseau local")?;
    let phone = prepare(id.as_deref(), name.as_deref())?;
    let phone_id = phone.id.clone();
    let identity = Identity { key: String::new(), cert: phone.cert.clone(), created: phone.created, name: phone.authority.clone() };
    let cert = B64
        .decode(identity.cert)
        .map_err(|_| "certificat local illisible")?;
    let fingerprint = format!("{:X}", Sha256::digest(&cert));
    let token = crate::modules::shelf_phone::new_token()?;
    let path = format!("/{token}/Ondine.cer");
    let listener = TcpListener::bind((ip, 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let url = format!("http://{ip}:{port}{path}");
    let qr = crate::modules::clipboard_qr::make(&url)?;
    let qr = format!(
        "data:image/svg+xml;base64,{}",
        B64.encode(crate::modules::clipboard_qr::svg(&qr))
    );
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(previous) = BOOTSTRAP.locked().replace(stop.clone()) {
        previous.store(true, Ordering::SeqCst);
    }
    let profile = mobile_profile(&cert, &identity.name, &fingerprint)?;
    let phone_name = phone.name.clone();
    std::thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(180);
        while Instant::now() < until && !stop.load(Ordering::SeqCst) {
            let Ok((mut socket, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            };
            let _ = socket.set_nonblocking(false);
            let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
            let _ = socket.set_write_timeout(Some(Duration::from_secs(2)));
            let mut head = Vec::new();
            let mut byte = [0];
            // Une connexion lente ne garde pas le lien pour elle : 5 s au plus.
            let deadline = (Instant::now() + Duration::from_secs(5)).min(until);
            while head.len() < 8192
                && Instant::now() < deadline
                && !stop.load(Ordering::SeqCst)
                && !head.ends_with(b"\r\n\r\n")
            {
                if socket.read(&mut byte).ok() != Some(1) {
                    break;
                }
                head.push(byte[0]);
            }
            let text = String::from_utf8_lossy(&head);
            if text.lines().next() != Some(format!("GET {path} HTTP/1.1").as_str()) {
                continue;
            }
            let ios = text.lines().any(|line| {
                line.to_ascii_lowercase().starts_with("user-agent:")
                    && (line.contains("iPhone") || line.contains("iPad"))
            });
            let (body, mime, filename) = if ios {
                (
                    profile.as_bytes(),
                    "application/x-apple-aspen-config",
                    "Ondine.mobileconfig",
                )
            } else {
                (cert.as_slice(), "application/x-x509-ca-cert", "Ondine.cer")
            };
            let header = format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Disposition: attachment; filename=\"{filename}\"\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", body.len());
            if socket
                .write_all(header.as_bytes())
                .and_then(|_| socket.write_all(body))
                .is_ok()
            {
                let _ = socket.flush();
                mark_installed(&phone_id);
                break;
            }
        }
    });
    Ok(
        json!({ "id": phone.id, "phone": phone_name, "url": url, "qr": qr, "fingerprint": fingerprint, "name": identity.name, "seconds": 180 }),
    )
}

fn mobile_profile(cert: &[u8], name: &str, fingerprint: &str) -> Result<String, String> {
    let name = name
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    let uuid = || -> Result<String, String> {
        let token = crate::modules::shelf_phone::new_token()?;
        Ok(format!(
            "{}-{}-{}-{}-{}",
            &token[..8],
            &token[8..12],
            &token[12..16],
            &token[16..20],
            &token[20..]
        ))
    };
    // Ces textes sont générés par Ondine, jamais fournis par un utilisateur.
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>io.github.naod6473.ondine.phone</string><key>PayloadUUID</key><string>{profile_uuid}</string>
<key>PayloadDisplayName</key><string>{name}</string><key>PayloadDescription</key><string>Certificat HTTPS du PC Ondine. Comparez l'empreinte du certificat avec celle affichée sur le PC : {fingerprint}</string>
<key>PayloadRemovalDisallowed</key><false/><key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>io.github.naod6473.ondine.phone.root</string><key>PayloadUUID</key><string>{cert_uuid}</string>
<key>PayloadDisplayName</key><string>{name}</string><key>PayloadContent</key><data>{data}</data>
</dict></array></dict></plist>"#,
        profile_uuid = uuid()?,
        cert_uuid = uuid()?,
        data = B64.encode(cert)
    ))
}

/// Les tests ont un seul téléphone actif, créé à la première demande.
#[cfg(test)]
fn test_phone() {
    static READY: std::sync::Once = std::sync::Once::new();
    READY.call_once(|| {
        prepare(None, Some("Téléphone de test")).unwrap();
    });
}
#[cfg(test)]
fn identity() -> Result<Identity, String> {
    active_identity()
}

#[cfg(test)]
pub fn test_client(socket: TcpStream) -> StreamOwned<rustls::ClientConnection, TcpStream> {
    let root = B64.decode(identity().unwrap().cert).unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(CertificateDer::from(root)).unwrap();
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    let name = rustls::pki_types::ServerName::IpAddress(Ipv4Addr::LOCALHOST.into());
    StreamOwned::new(
        rustls::ClientConnection::new(Arc::new(config), name).unwrap(),
        socket,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn iphone_profile_contains_only_the_public_certificate() {
        let identity = identity().unwrap();
        let cert = B64.decode(&identity.cert).unwrap();
        let profile = mobile_profile(&cert, &identity.name, "fingerprint").unwrap();
        assert!(profile.contains(&format!("<data>{}</data>", identity.cert)));
        assert!(!profile.contains(&identity.key));
        assert_eq!(profile.matches("<key>PayloadType</key>").count(), 2);
        assert!(profile.contains("<string>com.apple.security.root</string>"));
    }
    fn exchange(ip: Ipv4Addr, trust: bool) -> io::Result<Vec<u8>> {
        exchange_as(ip, Ipv4Addr::LOCALHOST, trust)
    }
    fn exchange_as(ip: Ipv4Addr, asked: Ipv4Addr, trust: bool) -> io::Result<Vec<u8>> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let tls = server(ip).unwrap();
        let worker = std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            let mut stream = SecureStream::accept(socket, tls).unwrap();
            let _ = stream.write_all(b"private file");
            let _ = stream.shutdown(Shutdown::Write);
        });
        let socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut roots = rustls::RootCertStore::empty();
        if trust {
            roots
                .add(CertificateDer::from(
                    B64.decode(identity().unwrap().cert).unwrap(),
                ))
                .unwrap();
        }
        let config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
        let connection = rustls::ClientConnection::new(
            Arc::new(config),
            rustls::pki_types::ServerName::IpAddress(asked.into()),
        )
        .unwrap();
        let mut stream = StreamOwned::new(connection, socket);
        let mut output = Vec::new();
        let result = stream.read_to_end(&mut output).map(|_| output);
        drop(stream);
        worker.join().unwrap();
        result
    }
    #[test]
    fn trusted_phone_receives_the_file() {
        assert_eq!(
            exchange(Ipv4Addr::LOCALHOST, true).unwrap(),
            b"private file"
        );
    }
    #[test]
    fn an_untrusted_certificate_is_rejected() {
        assert!(exchange(Ipv4Addr::LOCALHOST, false).is_err());
    }
    #[test]
    fn the_authority_cannot_vouch_for_a_public_address() {
        // Même avec la clé de l'autorité, un certificat pour une adresse
        // d'Internet est refusé par le téléphone.
        let public = Ipv4Addr::new(1, 1, 1, 1);
        assert!(exchange_as(public, public, true).is_err());
        let local = Ipv4Addr::new(192, 168, 1, 20);
        assert!(exchange_as(local, local, true).is_ok());
    }
    #[test]
    fn the_authority_cannot_vouch_for_a_domain_name() {
        use rustls::client::danger::ServerCertVerifier;
        let identity = identity().unwrap();
        let key = KeyPair::from_pem(&identity.key).unwrap();
        let issuer = Issuer::new(ca_params(&identity).unwrap(), key);
        let leaf_key = KeyPair::generate().unwrap();
        let mut p = CertificateParams::new(vec!["banque.example".to_string()]).unwrap();
        p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let leaf = p.signed_by(&leaf_key, &issuer).unwrap();
        let root = CertificateDer::from(B64.decode(&identity.cert).unwrap());
        let mut roots = rustls::RootCertStore::empty();
        roots.add(root).unwrap();
        let verifier = rustls::client::WebPkiServerVerifier::builder_with_provider(
            Arc::new(roots),
            Arc::new(rustls::crypto::ring::default_provider()),
        )
        .build()
        .unwrap();
        let name = rustls::pki_types::ServerName::try_from("banque.example").unwrap();
        let checked = verifier.verify_server_cert(
            leaf.der(),
            &[],
            &name,
            &[],
            rustls::pki_types::UnixTime::now(),
        );
        assert!(checked.is_err());
    }
    #[test]
    fn a_revoked_phone_loses_its_key_and_leaves_the_others() {
        let kept = identity().unwrap();
        // Un deuxième téléphone, ajouté sans devenir le téléphone actif.
        let other = generate(now()).unwrap();
        {
            let _saving = SAVING.locked();
            let mut phones = load();
            phones.list.push(Phone {
                id: "autre".into(),
                name: "Autre".into(),
                authority: other.name.clone(),
                cert: other.cert.clone(),
                created: other.created,
                installed: None,
            });
            store(&phones).unwrap();
            key_set("autre", &other.key).unwrap();
        }
        assert!(list()["phones"].as_array().unwrap().iter().any(|p| p["id"] == "autre"));
        revoke("autre").unwrap();
        assert_eq!(key_get("autre").unwrap(), None);
        assert!(!list()["phones"].as_array().unwrap().iter().any(|p| p["id"] == "autre"));
        assert!(revoke("autre").is_err());
        // Le téléphone actif n'a pas bougé.
        assert_eq!(active_identity().unwrap().cert, kept.cert);
    }
    #[test]
    fn the_certificate_must_match_the_address() {
        assert!(exchange(Ipv4Addr::new(10, 0, 0, 1), true).is_err());
    }
}
