//! HTTPS pour le navigateur du téléphone. Une autorité propre à ce PC,
//! exportable uniquement sous forme publique ; sa clé reste dans Windows.
use crate::sync::LockExt;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose,
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

#[derive(Clone, Serialize, Deserialize)]
struct Identity {
    key: String,
    cert: String,
    created: i64,
    name: String,
}

fn ca_params(identity: &Identity) -> Result<CertificateParams, String> {
    let mut p = CertificateParams::default();
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    p.distinguished_name
        .push(DnType::CommonName, identity.name.clone());
    p.not_before =
        OffsetDateTime::from_unix_timestamp(identity.created - 86400).map_err(|e| e.to_string())?;
    p.not_after = OffsetDateTime::from_unix_timestamp(identity.created + ROOT_LIFE)
        .map_err(|e| e.to_string())?;
    Ok(p)
}

fn generate() -> Result<Identity, String> {
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let hash = format!("{:x}", Sha256::digest(key.public_key_raw()));
    let mut identity = Identity {
        key: key.serialize_pem(),
        cert: String::new(),
        created: OffsetDateTime::now_utc().unix_timestamp(),
        name: format!("Ondine réseau local {}", &hash[..12]),
    };
    let cert = ca_params(&identity)?
        .self_signed(&key)
        .map_err(|e| e.to_string())?;
    identity.cert = B64.encode(cert.der());
    Ok(identity)
}

#[cfg(not(test))]
fn identity() -> Result<Identity, String> {
    let _saving = SAVING.locked();
    let saved = super::credentials::phone_identity_get()?;
    let identity = match saved {
        Some(text) => {
            serde_json::from_str(&text).map_err(|_| "certificat local illisible".to_string())?
        }
        None => {
            let identity = generate()?;
            super::credentials::phone_identity_set(
                &serde_json::to_string(&identity).map_err(|e| e.to_string())?,
            )?;
            identity
        }
    };
    Ok(identity)
}

#[cfg(test)]
fn identity() -> Result<Identity, String> {
    // Les tests ne touchent jamais aux identifiants du véritable utilisateur.
    let _saving = SAVING.locked();
    static TEST_ROOT: std::sync::OnceLock<Identity> = std::sync::OnceLock::new();
    Ok(TEST_ROOT
        .get_or_init(|| generate().expect("certificat de test"))
        .clone())
}

fn config(identity: &Identity, ip: Ipv4Addr) -> Result<Arc<ServerConfig>, String> {
    let now = OffsetDateTime::now_utc();
    if now.unix_timestamp() >= identity.created + ROOT_LIFE {
        return Err("certificat téléphone expiré : retirez l'ancien certificat et préparez un nouvel appairage dans Ondine".into());
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

pub fn server(ip: Ipv4Addr) -> Result<Arc<ServerConfig>, String> {
    config(&identity()?, ip)
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
pub fn setup() -> Result<Value, String> {
    let ip =
        super::lan::private_ipv4().ok_or("connectez le PC et le téléphone au même réseau local")?;
    let identity = setup_identity()?;
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
            while head.len() < 8192
                && Instant::now() < until
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
                break;
            }
        }
    });
    Ok(
        json!({ "url": url, "qr": qr, "fingerprint": fingerprint, "name": identity.name, "seconds": 180 }),
    )
}

fn setup_identity() -> Result<Identity, String> {
    let current = identity()?;
    #[cfg(not(test))]
    if OffsetDateTime::now_utc().unix_timestamp() >= current.created + ROOT_LIFE {
        let _saving = SAVING.locked();
        let renewed = generate()?;
        super::credentials::phone_identity_set(
            &serde_json::to_string(&renewed).map_err(|e| e.to_string())?,
        )?;
        return Ok(renewed);
    }
    Ok(current)
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
            rustls::pki_types::ServerName::IpAddress(Ipv4Addr::LOCALHOST.into()),
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
    fn the_certificate_must_match_the_address() {
        assert!(exchange(Ipv4Addr::new(10, 0, 0, 1), true).is_err());
    }
}
