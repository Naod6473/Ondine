// Module « Mail » : la connexion au compte (OAuth 2, « application de bureau »).
//
// Le parcours, le même pour Gmail et Outlook :
//   1. Ondine ouvre une petite écoute sur ce PC (127.0.0.1, un port libre) ;
//   2. elle ouvre la page de connexion de Google ou de Microsoft dans le
//      navigateur, avec un défi PKCE (le code reçu ne sert à rien sans le
//      secret gardé ici) et un `state` tiré au hasard ;
//   3. la personne se connecte et accepte ; le navigateur revient sur l'écoute
//      avec un code ; Ondine l'échange contre deux jetons :
//        - le jeton d'accès (une heure), gardé en mémoire seulement ;
//        - le jeton de renouvellement, rangé dans le Gestionnaire
//          d'identifiants Windows (services/credentials.rs), jamais ailleurs.
//
// Aucun secret dans le code : l'identifiant client vient des réglages du
// module, le « code secret » Google du Gestionnaire d'identifiants.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::mail_api::{self as api, Kind};

/// La connexion attend la personne au plus 5 minutes.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Ce que chaque fournisseur demande : lire et envoyer des mails, rien d'autre
/// (ni supprimer, ni modifier, ni les contacts).
fn scopes(kind: Kind) -> &'static str {
    match kind {
        Kind::Gmail => "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        Kind::Outlook => "offline_access User.Read Mail.Read Mail.Send",
    }
}

fn auth_url(kind: Kind) -> &'static str {
    match kind {
        Kind::Gmail => "https://accounts.google.com/o/oauth2/v2/auth",
        Kind::Outlook => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    }
}

fn token_url(kind: Kind) -> &'static str {
    match kind {
        Kind::Gmail => "https://oauth2.googleapis.com/token",
        Kind::Outlook => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    }
}

/// L'adresse de retour. Microsoft attend « localhost » (inscrit tel quel dans
/// le portail Azure, le port est libre) ; Google, l'adresse 127.0.0.1.
pub fn redirect_uri(kind: Kind, port: u16) -> String {
    match kind {
        Kind::Gmail => format!("http://127.0.0.1:{port}"),
        Kind::Outlook => format!("http://localhost:{port}"),
    }
}

/// Un identifiant client plausible (rien d'autre ne part dans l'adresse).
pub fn valid_client_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Encodage « pourcent » d'une valeur d'URL ou de formulaire.
pub fn pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// L'inverse (les paramètres du retour du navigateur).
pub fn unpct(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Une valeur au hasard, en base64 « URL » (verifier PKCE, state).
fn random(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("hasard indisponible : {e}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
}

/// Le défi PKCE (S256) d'un verifier.
pub fn challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// L'adresse de la page de connexion.
pub fn login_url(kind: Kind, client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let mut url = format!(
        "{}?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        auth_url(kind),
        pct(client_id),
        pct(redirect),
        pct(scopes(kind)),
        pct(challenge),
        pct(state)
    );
    if kind == Kind::Gmail {
        // Sans ça, Google ne donne pas de jeton de renouvellement.
        url.push_str("&access_type=offline&prompt=consent");
    } else {
        url.push_str("&prompt=select_account");
    }
    url
}

/// Lit « GET /?code=…&state=… HTTP/1.1 » : les paramètres, ou None (autre page).
pub fn parse_callback(request_line: &str) -> Option<Vec<(String, String)>> {
    let mut words = request_line.split_whitespace();
    if words.next()? != "GET" {
        return None;
    }
    let target = words.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/" || query.is_empty() {
        return None;
    }
    Some(
        query
            .split('&')
            .filter_map(|kv| kv.split_once('=').map(|(k, v)| (unpct(k), unpct(v))))
            .collect(),
    )
}

/// Les jetons reçus.
pub struct Tokens {
    pub access: String,
    pub expires: Instant,
    /// Absent quand Microsoft ou Google gardent l'ancien.
    pub refresh: Option<String>,
}

fn parse_tokens(v: &Value) -> Result<Tokens, String> {
    let access = v["access_token"].as_str().filter(|s| !s.is_empty()).ok_or_else(|| token_error(v))?;
    let secs = v["expires_in"].as_u64().unwrap_or(3600).clamp(60, 24 * 3600);
    Ok(Tokens {
        access: access.to_string(),
        // Une minute de marge : un jeton presque périmé est renouvelé avant.
        expires: Instant::now() + Duration::from_secs(secs.saturating_sub(60)),
        refresh: v["refresh_token"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
    })
}

/// Le message d'erreur de Google ou Microsoft, sans jamais recopier de jeton.
fn token_error(v: &Value) -> String {
    let code = v["error"].as_str().unwrap_or("réponse inattendue");
    match code {
        "invalid_grant" => "la connexion a expiré ou a été retirée : reconnectez le compte".into(),
        "invalid_client" | "unauthorized_client" => "identifiant client refusé : vérifiez-le dans les réglages du module (et le code secret Google dans Réglages → Identifiants)".into(),
        _ => {
            let detail = v["error_description"].as_str().unwrap_or("").chars().take(160).collect::<String>();
            if detail.is_empty() { format!("connexion refusée ({code})") } else { format!("connexion refusée ({code}) : {detail}") }
        }
    }
}

/// Échange le code reçu contre les jetons.
fn exchange(kind: Kind, client_id: &str, secret: Option<&str>, code: &str, verifier: &str, redirect: &str) -> Result<Tokens, String> {
    let mut form = vec![
        ("client_id", client_id.to_string()),
        ("grant_type", "authorization_code".into()),
        ("code", code.to_string()),
        ("code_verifier", verifier.to_string()),
        ("redirect_uri", redirect.to_string()),
    ];
    if let Some(s) = secret {
        form.push(("client_secret", s.to_string()));
    }
    if kind == Kind::Outlook {
        form.push(("scope", scopes(kind).to_string()));
    }
    parse_tokens(&api::post_form(token_url(kind), &form)?)
}

/// Un nouveau jeton d'accès à partir du jeton de renouvellement.
pub fn refresh(kind: Kind, client_id: &str, secret: Option<&str>, refresh_token: &str) -> Result<Tokens, String> {
    let mut form = vec![
        ("client_id", client_id.to_string()),
        ("grant_type", "refresh_token".into()),
        ("refresh_token", refresh_token.to_string()),
    ];
    if let Some(s) = secret {
        form.push(("client_secret", s.to_string()));
    }
    if kind == Kind::Outlook {
        form.push(("scope", scopes(kind).to_string()));
    }
    parse_tokens(&api::post_form(token_url(kind), &form)?)
}

/// La petite page montrée dans le navigateur à la fin.
fn answer(stream: &mut TcpStream, ok: bool) {
    let text = if ok {
        "Ondine est connectée à votre messagerie. Vous pouvez fermer cet onglet."
    } else {
        "La connexion n'a pas abouti. Vous pouvez fermer cet onglet et réessayer depuis l'île."
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Ondine</title><body style=\"font-family:system-ui;padding:3em;text-align:center\"><p style=\"font-size:1.3em\">{text}</p></body>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// La connexion entière : ouvre le navigateur (`open`), attend le retour,
/// échange le code. Bloquant (jusqu'à 5 minutes) : à lancer dans un fil.
pub fn login(kind: Kind, client_id: &str, secret: Option<&str>, open: impl FnOnce(&str) -> Result<(), String>) -> Result<Tokens, String> {
    if !valid_client_id(client_id) {
        return Err("identifiant client manquant ou invalide : collez-le dans les réglages du module Mail".into());
    }
    if kind == Kind::Gmail && secret.is_none() {
        return Err("Google demande aussi le code secret du client : ajoutez-le dans Réglages → Identifiants".into());
    }
    // L'écoute : 127.0.0.1, et ::1 sur le même port si possible (un navigateur
    // peut traduire « localhost » par l'un ou l'autre).
    let v4 = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("écoute locale impossible : {e}"))?;
    let port = v4.local_addr().map_err(|e| e.to_string())?.port();
    let mut listeners = vec![v4];
    if kind == Kind::Outlook {
        if let Ok(v6) = TcpListener::bind(("::1", port)) {
            listeners.push(v6);
        }
    }
    for l in &listeners {
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
    }
    let redirect = redirect_uri(kind, port);
    let verifier = random(48)?;
    let state = random(24)?;
    open(&login_url(kind, client_id, &redirect, &challenge(&verifier), &state))?;

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    while Instant::now() < deadline {
        for l in &listeners {
            let Ok((mut stream, _)) = l.accept() else { continue };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut line = String::new();
            // Une ligne de 8 Ko au plus (un navigateur n'envoie rien de plus long ici).
            let _ = BufReader::new((&stream).take(8 * 1024)).read_line(&mut line);
            let Some(params) = parse_callback(&line) else {
                // Le navigateur demande aussi /favicon.ico : on l'ignore.
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            };
            let get = |k: &str| params.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str());
            if get("state") != Some(state.as_str()) {
                answer(&mut stream, false);
                return Err("réponse de connexion inattendue (state différent) : réessayez".into());
            }
            let Some(code) = get("code") else {
                answer(&mut stream, false);
                let why = get("error").unwrap_or("annulée");
                return Err(if why == "access_denied" { "connexion refusée dans le navigateur".into() } else { format!("connexion interrompue ({why})") });
            };
            let result = exchange(kind, client_id, secret, code, &verifier, &redirect);
            answer(&mut stream, result.is_ok());
            return result;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err("connexion abandonnée : pas de réponse du navigateur en 5 minutes".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pct_round_trip() {
        let s = "a b&c=d/é~";
        assert_eq!(pct(s), "a%20b%26c%3Dd%2F%C3%A9~");
        assert_eq!(unpct(&pct(s)), s);
        assert_eq!(unpct("a+b%2"), "a b%2");
    }

    #[test]
    fn pkce_challenge_is_s256() {
        // L'exemple de la RFC 7636, annexe B.
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn login_url_has_everything() {
        let url = login_url(Kind::Gmail, "abc.apps.googleusercontent.com", "http://127.0.0.1:5000", "ch", "st");
        assert!(url.starts_with("https://accounts.google.com/"));
        assert!(url.contains("client_id=abc.apps.googleusercontent.com"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5000"));
        assert!(url.contains("gmail.send"));
        assert!(url.contains("access_type=offline"));
        let url = login_url(Kind::Outlook, "id", &redirect_uri(Kind::Outlook, 5000), "ch", "st");
        assert!(url.contains("login.microsoftonline.com/common"));
        assert!(url.contains("Mail.Send"));
        assert!(url.contains("localhost%3A5000"));
    }

    #[test]
    fn callback_is_read() {
        let p = parse_callback("GET /?code=4%2F0Ab&state=xyz&scope=a+b HTTP/1.1").unwrap();
        assert_eq!(p[0], ("code".into(), "4/0Ab".into()));
        assert_eq!(p[1], ("state".into(), "xyz".into()));
        assert!(parse_callback("GET /favicon.ico HTTP/1.1").is_none());
        assert!(parse_callback("POST /?code=a HTTP/1.1").is_none());
    }

    #[test]
    fn client_id_is_checked() {
        assert!(valid_client_id("123-abc.apps.googleusercontent.com"));
        assert!(valid_client_id("1b2c3d4e-0000-1111-2222-333344445555"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("a&b"));
    }

    #[test]
    fn token_errors_never_repeat_tokens() {
        let v = serde_json::json!({ "error": "invalid_grant", "refresh_token": "SECRET" });
        assert!(!token_error(&v).contains("SECRET"));
        let t = parse_tokens(&serde_json::json!({ "access_token": "A", "expires_in": 3600, "refresh_token": "R" })).unwrap();
        assert_eq!(t.refresh.as_deref(), Some("R"));
        assert!(parse_tokens(&serde_json::json!({})).is_err());
    }
}
