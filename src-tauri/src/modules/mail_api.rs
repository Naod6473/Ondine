// Module « Mail » : parler à Gmail (API Gmail) et à Outlook / Office 365
// (Microsoft Graph). Tout ce qui ne touche pas au réseau est en fonctions
// pures, testées plus bas : lecture des réponses, texte d'un mail HTML,
// fabrication du message à envoyer (MIME pour Gmail, JSON pour Graph).
//
// Le jeton d'accès n'est utilisé que dans l'en-tête des requêtes : jamais
// journalisé, jamais renvoyé au front.

use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};

/// Le fournisseur de messagerie.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Gmail par l'API Gmail (OAuth, client Google Cloud).
    Gmail,
    /// Gmail par IMAP / SMTP avec un mot de passe d'application (mail_imap.rs).
    GmailPass,
    Outlook,
}

impl Kind {
    pub fn from_id(id: &str) -> Kind {
        match id {
            "outlook" => Kind::Outlook,
            "gmailpass" => Kind::GmailPass,
            _ => Kind::Gmail,
        }
    }

    /// Le nom du jeton rangé dans le Gestionnaire d'identifiants.
    pub fn id(self) -> &'static str {
        match self {
            Kind::Gmail => "gmail",
            Kind::GmailPass => "gmailpass",
            Kind::Outlook => "outlook",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Gmail | Kind::GmailPass => "Gmail",
            Kind::Outlook => "Outlook",
        }
    }

    /// L'adresse où partent les mails (montrée avant l'envoi).
    pub fn destination(self) -> &'static str {
        match self {
            Kind::Gmail => "gmail.googleapis.com",
            Kind::GmailPass => "imap.gmail.com et smtp.gmail.com",
            Kind::Outlook => "graph.microsoft.com",
        }
    }
}

/// Une pièce jointe de 3 Mo au plus : la limite d'un envoi simple chez
/// Microsoft Graph, gardée aussi pour Gmail (un seul comportement).
pub const MAX_ATTACHMENT: u64 = 3 * 1024 * 1024;
/// Le texte d'un mail envoyé à l'IA ou affiché : 20 000 caractères au plus.
pub const MAX_BODY_CHARS: usize = 20_000;
/// Le nombre de mails listés.
pub const LIST_SIZE: usize = 12;

/// Un mail de la liste (sans son texte).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    /// Le nom de l'expéditeur, sinon son adresse.
    pub from: String,
    pub from_addr: String,
    pub subject: String,
    /// Date de réception, en millisecondes depuis 1970 (0 si inconnue).
    pub at: i64,
    pub unread: bool,
}

/// Un mail ouvert : de quoi l'afficher, le résumer et y répondre.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub from: String,
    pub from_addr: String,
    pub to: String,
    pub subject: String,
    pub at: i64,
    pub body: String,
    /// Le texte a été coupé à MAX_BODY_CHARS.
    pub cut: bool,
    #[serde(skip)]
    pub thread_id: String,
    /// L'en-tête Message-ID (Gmail : pour que la réponse suive la conversation).
    #[serde(skip)]
    pub message_id: String,
}

/// Le fichier joint, lu par mail.rs (chemin déjà vérifié).
#[derive(Debug, Clone)]
pub struct Attachment {
    pub name: String,
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// Ce qui part.
#[derive(Debug, Clone)]
pub struct Outgoing {
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub attachment: Option<Attachment>,
    /// Réponse à ce mail (id du fournisseur, et pour Gmail la conversation et le Message-ID).
    pub reply_to: Option<Message>,
}

// ── Réseau ───────────────────────────────────────────────────────────────────

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        // Le TLS de Windows et ses certificats (comme Parler à Ondine).
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .into()
}

fn read(mut resp: ureq::http::Response<ureq::Body>) -> Result<Value, String> {
    let status = resp.status().as_u16();
    let text = resp.body_mut().with_config().limit(8 * 1024 * 1024).read_to_string().unwrap_or_default();
    let v: Value = if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::Null) };
    if (200..300).contains(&status) {
        Ok(v)
    } else {
        Err(http_error(status, &v))
    }
}

/// Un message clair ; le détail du fournisseur, raccourci (il ne contient pas de jeton).
fn http_error(status: u16, v: &Value) -> String {
    let what = match status {
        401 => "la connexion au compte a expiré : reconnectez-le",
        403 => "accès refusé par la messagerie (autorisations du compte ?)",
        404 => "mail introuvable (supprimé ?)",
        413 => "envoi trop gros",
        429 => "trop de demandes : réessayez dans un moment",
        500..=599 => "la messagerie ne répond pas : réessayez dans un moment",
        _ => "la messagerie a refusé la demande",
    };
    let detail = v["error"]["message"].as_str().or(v["error_description"].as_str()).unwrap_or("");
    if detail.is_empty() { format!("{what} (code {status})") } else { format!("{what} (code {status}) : {}", detail.chars().take(160).collect::<String>()) }
}

pub fn get(url: &str, token: &str) -> Result<Value, String> {
    let resp = agent().get(url).header("authorization", &format!("Bearer {token}")).call().map_err(|e| format!("messagerie injoignable : {e}"))?;
    read(resp)
}

fn post_json(url: &str, token: &str, body: &Value) -> Result<Value, String> {
    let resp = agent()
        .post(url)
        .header("authorization", &format!("Bearer {token}"))
        .send_json(body)
        .map_err(|e| format!("messagerie injoignable : {e}"))?;
    read(resp)
}

/// Un formulaire (les jetons OAuth).
pub fn post_form(url: &str, form: &[(&str, String)]) -> Result<Value, String> {
    let resp = agent().post(url).send_form(form.iter().map(|(k, v)| (*k, v.as_str()))).map_err(|e| format!("connexion impossible : {e}"))?;
    let status = resp.status().as_u16();
    let mut resp = resp;
    let v: Value = resp.body_mut().with_config().limit(256 * 1024).read_json().unwrap_or(Value::Null);
    if status == 200 { Ok(v) } else { Ok(if v.is_null() { json!({ "error": format!("code {status}") }) } else { v }) }
}

// ── Les appels ───────────────────────────────────────────────────────────────

/// Gmail par mot de passe d'application passe par mail_imap.rs, jamais par ici.
const IMAP_ONLY: &str = "Gmail par mot de passe d'application passe par IMAP";

const GMAIL: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH: &str = "https://graph.microsoft.com/v1.0/me";

/// L'adresse du compte connecté.
pub fn account(kind: Kind, token: &str) -> Result<String, String> {
    match kind {
        Kind::GmailPass => Err(IMAP_ONLY.into()),
        Kind::Gmail => Ok(get(&format!("{GMAIL}/profile"), token)?["emailAddress"].as_str().unwrap_or("").to_string()),
        Kind::Outlook => {
            let v = get(&format!("{GRAPH}?$select=mail,userPrincipalName"), token)?;
            Ok(v["mail"].as_str().or(v["userPrincipalName"].as_str()).unwrap_or("").to_string())
        }
    }
}

/// Les derniers mails de la boîte de réception, du plus récent au plus ancien.
pub fn list(kind: Kind, token: &str) -> Result<Vec<Summary>, String> {
    match kind {
        Kind::GmailPass => Err(IMAP_ONLY.into()),
        Kind::Gmail => {
            let ids = get(&format!("{GMAIL}/messages?labelIds=INBOX&maxResults={LIST_SIZE}"), token)?;
            let mut out = Vec::new();
            for id in ids["messages"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str()).take(LIST_SIZE) {
                if !safe_id(id) {
                    continue;
                }
                let v = get(&format!("{GMAIL}/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject"), token)?;
                out.push(gmail_summary(&v));
            }
            Ok(out)
        }
        Kind::Outlook => {
            let v = get(
                &format!("{GRAPH}/mailFolders/inbox/messages?$top={LIST_SIZE}&$select=id,subject,from,receivedDateTime,isRead&$orderby=receivedDateTime%20desc"),
                token,
            )?;
            Ok(v["value"].as_array().into_iter().flatten().map(graph_summary).collect())
        }
    }
}

/// Un mail entier.
pub fn message(kind: Kind, token: &str, id: &str) -> Result<Message, String> {
    if !safe_id(id) {
        return Err("identifiant de mail invalide".into());
    }
    match kind {
        Kind::GmailPass => Err(IMAP_ONLY.into()),
        Kind::Gmail => Ok(gmail_message(&get(&format!("{GMAIL}/messages/{id}?format=full"), token)?)),
        Kind::Outlook => Ok(graph_message(&get(
            &format!("{GRAPH}/messages/{id}?$select=id,subject,from,toRecipients,receivedDateTime,body"),
            token,
        )?)),
    }
}

/// Envoie (ou répond).
pub fn send(kind: Kind, token: &str, from: &str, out: &Outgoing) -> Result<(), String> {
    match kind {
        Kind::GmailPass => Err(IMAP_ONLY.into()),
        Kind::Gmail => {
            let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mime(from, out));
            let mut body = json!({ "raw": raw });
            if let Some(r) = &out.reply_to {
                if !r.thread_id.is_empty() {
                    body["threadId"] = json!(r.thread_id);
                }
            }
            post_json(&format!("{GMAIL}/messages/send"), token, &body).map(|_| ())
        }
        Kind::Outlook => match &out.reply_to {
            Some(r) if safe_id(&r.id) => post_json(&format!("{GRAPH}/messages/{}/reply", r.id), token, &graph_reply(out)).map(|_| ()),
            _ => post_json(&format!("{GRAPH}/sendMail"), token, &graph_send(out)).map(|_| ()),
        },
    }
}

/// Un identifiant de mail renvoyé par le front : rien qui puisse sortir du chemin.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 512 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '=' | '+'))
}

// ── Lecture des réponses (pur) ──────────────────────────────────────────────

/// « Marie Dupont <marie@exemple.fr> » → (« Marie Dupont », « marie@exemple.fr »).
pub fn split_from(raw: &str) -> (String, String) {
    let raw = raw.trim();
    if let (Some(a), Some(b)) = (raw.rfind('<'), raw.rfind('>')) {
        if a < b {
            let addr = raw[a + 1..b].trim().to_string();
            let name = raw[..a].trim().trim_matches('"').trim().to_string();
            return (if name.is_empty() { addr.clone() } else { name }, addr);
        }
    }
    (raw.to_string(), raw.to_string())
}

fn header<'a>(payload: &'a Value, name: &str) -> &'a str {
    payload["headers"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name)))
        .and_then(|h| h["value"].as_str())
        .unwrap_or("")
}

pub fn gmail_summary(v: &Value) -> Summary {
    let (from, from_addr) = split_from(header(&v["payload"], "From"));
    Summary {
        id: v["id"].as_str().unwrap_or("").to_string(),
        from,
        from_addr,
        subject: header(&v["payload"], "Subject").to_string(),
        at: v["internalDate"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        unread: v["labelIds"].as_array().is_some_and(|l| l.iter().any(|x| x == "UNREAD")),
    }
}

fn b64url(data: &str) -> Vec<u8> {
    let clean: String = data.chars().filter(|c| !c.is_whitespace() && *c != '=').collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(clean).unwrap_or_default()
}

/// Le texte d'un mail Gmail : la partie text/plain, sinon la partie HTML mise en texte.
fn gmail_text(payload: &Value) -> String {
    fn find(p: &Value, mime: &str) -> Option<String> {
        if p["mimeType"].as_str() == Some(mime) {
            if let Some(d) = p["body"]["data"].as_str() {
                return Some(String::from_utf8_lossy(&b64url(d)).into_owned());
            }
        }
        p["parts"].as_array().into_iter().flatten().find_map(|c| find(c, mime))
    }
    find(payload, "text/plain").or_else(|| find(payload, "text/html").map(|h| html_to_text(&h))).unwrap_or_default()
}

pub fn gmail_message(v: &Value) -> Message {
    let s = gmail_summary(v);
    let (body, cut) = clip(&gmail_text(&v["payload"]));
    Message {
        id: s.id,
        from: s.from,
        from_addr: s.from_addr,
        to: header(&v["payload"], "To").to_string(),
        subject: s.subject,
        at: s.at,
        body,
        cut,
        thread_id: v["threadId"].as_str().unwrap_or("").to_string(),
        message_id: header(&v["payload"], "Message-ID").to_string(),
    }
}

fn graph_from(v: &Value) -> (String, String) {
    let addr = v["from"]["emailAddress"]["address"].as_str().unwrap_or("").to_string();
    let name = v["from"]["emailAddress"]["name"].as_str().unwrap_or("").trim().to_string();
    (if name.is_empty() { addr.clone() } else { name }, addr)
}

/// « 2026-10-13T08:35:11Z » → millisecondes.
fn graph_date(v: &Value) -> i64 {
    v["receivedDateTime"]
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

pub fn graph_summary(v: &Value) -> Summary {
    let (from, from_addr) = graph_from(v);
    Summary {
        id: v["id"].as_str().unwrap_or("").to_string(),
        from,
        from_addr,
        subject: v["subject"].as_str().unwrap_or("").to_string(),
        at: graph_date(v),
        unread: v["isRead"] == json!(false),
    }
}

pub fn graph_message(v: &Value) -> Message {
    let (from, from_addr) = graph_from(v);
    let content = v["body"]["content"].as_str().unwrap_or("");
    let text = if v["body"]["contentType"].as_str().is_some_and(|t| t.eq_ignore_ascii_case("html")) { html_to_text(content) } else { content.to_string() };
    let (body, cut) = clip(&text);
    let to = v["toRecipients"].as_array().into_iter().flatten().filter_map(|r| r["emailAddress"]["address"].as_str()).collect::<Vec<_>>().join(", ");
    Message {
        id: v["id"].as_str().unwrap_or("").to_string(),
        from,
        from_addr,
        to,
        subject: v["subject"].as_str().unwrap_or("").to_string(),
        at: graph_date(v),
        body,
        cut,
        thread_id: String::new(),
        message_id: String::new(),
    }
}

/// Coupe à MAX_BODY_CHARS, lignes vides en trop retirées.
pub fn clip(text: &str) -> (String, bool) {
    let mut out = String::new();
    let mut blank = 0;
    for line in text.replace("\r\n", "\n").lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    let out = out.trim().to_string();
    if out.chars().count() > MAX_BODY_CHARS {
        (out.chars().take(MAX_BODY_CHARS).collect(), true)
    } else {
        (out, false)
    }
}

/// Un mail HTML en texte lisible : balises retirées (styles et scripts avec
/// leur contenu), retours à la ligne aux paragraphes, entités courantes.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let lower = html.to_ascii_lowercase();
    let mut i = 0;
    let bytes = html.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let Some(end) = html[i..].find('>').map(|e| i + e) else { break };
            let tag = lower[i + 1..end].trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("").to_string();
            if (tag == "style" || tag == "script" || tag == "head") && !lower[i + 1..].starts_with('/') {
                // Saute jusqu'à la balise fermante.
                let close = format!("</{tag}");
                i = lower[end..].find(&close).map(|c| end + c).and_then(|c| html[c..].find('>').map(|e| c + e + 1)).unwrap_or(bytes.len());
                continue;
            }
            if matches!(tag.as_str(), "br" | "p" | "div" | "tr" | "li" | "h1" | "h2" | "h3" | "h4" | "blockquote") {
                out.push('\n');
            }
            i = end + 1;
        } else {
            let next = html[i..].find('<').map(|n| i + n).unwrap_or(bytes.len());
            out.push_str(&entities(&html[i..next]));
            i = next;
        }
    }
    // Espaces multiples d'une même ligne réduits.
    out.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).collect::<Vec<_>>().join("\n")
}

fn entities(s: &str) -> String {
    let mut s = s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'");
    for (e, c) in [("&eacute;", "é"), ("&egrave;", "è"), ("&agrave;", "à"), ("&ccedil;", "ç"), ("&ecirc;", "ê"), ("&rsquo;", "’"), ("&hellip;", "…"), ("&euro;", "€")] {
        s = s.replace(e, c);
    }
    s.replace("&amp;", "&")
}

// ── Fabrication de l'envoi (pur) ────────────────────────────────────────────

/// Une adresse plausible (un seul @, pas d'espace ni de caractère de contrôle).
pub fn valid_address(a: &str) -> bool {
    let a = a.trim();
    a.len() <= 254
        && a.matches('@').count() == 1
        && !a.starts_with('@')
        && !a.ends_with('@')
        && a.split('@').nth(1).is_some_and(|d| d.contains('.') && !d.starts_with('.') && !d.ends_with('.'))
        && !a.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | ',' | ';' | '"'))
}

/// « a@x.fr, Marie <b@y.fr>; c@z.fr » → les adresses, ou l'erreur de la première invalide.
pub fn parse_recipients(raw: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for part in raw.split([',', ';']).map(str::trim).filter(|p| !p.is_empty()) {
        let (_, addr) = split_from(part);
        if !valid_address(&addr) {
            return Err(format!("adresse invalide : « {} »", part.chars().take(80).collect::<String>()));
        }
        out.push(addr);
    }
    if out.is_empty() {
        return Err("aucun destinataire".into());
    }
    if out.len() > 20 {
        return Err("20 destinataires au plus".into());
    }
    Ok(out)
}

/// Un en-tête qui peut contenir des accents (RFC 2047), sans retour à la ligne possible.
fn encode_header(s: &str) -> String {
    let s: String = s.chars().filter(|c| !c.is_control()).collect();
    if s.is_ascii() {
        s
    } else {
        format!("=?UTF-8?B?{}?=", base64::engine::general_purpose::STANDARD.encode(s.as_bytes()))
    }
}

/// Du base64 en lignes de 76 caractères.
fn b64_lines(bytes: &[u8]) -> String {
    let b = base64::engine::general_purpose::STANDARD.encode(bytes);
    b.as_bytes().chunks(76).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("\r\n")
}

/// « Re: » devant l'objet d'une réponse, une seule fois.
pub fn reply_subject(subject: &str) -> String {
    let s = subject.trim();
    if s.get(..3).is_some_and(|p| p.eq_ignore_ascii_case("re:")) { s.to_string() } else { format!("Re: {s}") }
}

/// Le message entier, au format MIME (Gmail).
pub fn mime(from: &str, out: &Outgoing) -> Vec<u8> {
    let mut m = String::new();
    if !from.is_empty() {
        m.push_str(&format!("From: {}\r\n", encode_header(from)));
    }
    m.push_str(&format!("To: {}\r\n", out.to.join(", ")));
    m.push_str(&format!("Date: {}\r\n", chrono::Local::now().to_rfc2822()));
    m.push_str(&format!("Subject: {}\r\n", encode_header(&out.subject)));
    if let Some(r) = out.reply_to.as_ref().filter(|r| !r.message_id.is_empty()) {
        let id = encode_header(&r.message_id);
        m.push_str(&format!("In-Reply-To: {id}\r\nReferences: {id}\r\n"));
    }
    m.push_str("MIME-Version: 1.0\r\n");
    let text_part = format!("Content-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n", b64_lines(out.body.as_bytes()));
    match &out.attachment {
        None => m.push_str(&text_part),
        Some(a) => {
            let boundary = "ondine-mail-limite-7f3a";
            m.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"));
            m.push_str(&format!("--{boundary}\r\n{text_part}"));
            let name = encode_header(&a.name).replace('"', "'");
            m.push_str(&format!(
                "--{boundary}\r\nContent-Type: {}; name=\"{name}\"\r\nContent-Disposition: attachment; filename=\"{name}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",
                a.mime,
                b64_lines(&a.bytes)
            ));
            m.push_str(&format!("--{boundary}--\r\n"));
        }
    }
    m.into_bytes()
}

fn graph_attachments(out: &Outgoing) -> Vec<Value> {
    out.attachment
        .iter()
        .map(|a| {
            json!({
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a.name,
                "contentType": a.mime,
                "contentBytes": base64::engine::general_purpose::STANDARD.encode(&a.bytes),
            })
        })
        .collect()
}

/// Le corps de « sendMail » (Graph).
pub fn graph_send(out: &Outgoing) -> Value {
    json!({
        "message": {
            "subject": out.subject,
            "body": { "contentType": "Text", "content": out.body },
            "toRecipients": out.to.iter().map(|a| json!({ "emailAddress": { "address": a } })).collect::<Vec<_>>(),
            "attachments": graph_attachments(out),
        },
        "saveToSentItems": true,
    })
}

/// Le corps de « reply » (Graph) : Outlook ajoute le mail d'origine en dessous.
pub fn graph_reply(out: &Outgoing) -> Value {
    json!({
        "message": {
            "toRecipients": out.to.iter().map(|a| json!({ "emailAddress": { "address": a } })).collect::<Vec<_>>(),
            "attachments": graph_attachments(out),
        },
        "comment": out.body,
    })
}

/// Le type d'un fichier joint, d'après son extension.
pub fn mime_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_header_is_split() {
        assert_eq!(split_from("\"Marie Dupont\" <marie@exemple.fr>"), ("Marie Dupont".into(), "marie@exemple.fr".into()));
        assert_eq!(split_from("<a@b.fr>"), ("a@b.fr".into(), "a@b.fr".into()));
        assert_eq!(split_from("a@b.fr"), ("a@b.fr".into(), "a@b.fr".into()));
    }

    #[test]
    fn gmail_metadata_is_read() {
        let v = json!({
            "id": "18c2", "threadId": "18c0", "internalDate": "1760344511000", "labelIds": ["INBOX", "UNREAD"],
            "payload": { "headers": [{ "name": "From", "value": "Paul <paul@x.fr>" }, { "name": "Subject", "value": "Réunion" }] }
        });
        let s = gmail_summary(&v);
        assert_eq!((s.from.as_str(), s.from_addr.as_str(), s.subject.as_str(), s.at, s.unread), ("Paul", "paul@x.fr", "Réunion", 1760344511000, true));
    }

    #[test]
    fn gmail_body_prefers_plain_text() {
        let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        let v = json!({
            "id": "1", "threadId": "t",
            "payload": { "mimeType": "multipart/alternative", "headers": [{ "name": "Message-ID", "value": "<abc@mail>" }], "parts": [
                { "mimeType": "text/html", "body": { "data": enc("<p>HTML</p>") } },
                { "mimeType": "text/plain", "body": { "data": enc("Bonjour,\r\n\r\n\r\n\r\nÀ demain") } },
            ]}
        });
        let m = gmail_message(&v);
        assert_eq!(m.body, "Bonjour,\n\nÀ demain");
        assert_eq!(m.message_id, "<abc@mail>");
        assert_eq!(m.thread_id, "t");
    }

    #[test]
    fn graph_message_is_read() {
        let v = json!({
            "id": "AAMk=", "subject": "Facture", "receivedDateTime": "2026-10-13T08:35:11Z", "isRead": false,
            "from": { "emailAddress": { "name": "Compta", "address": "compta@x.fr" } },
            "toRecipients": [{ "emailAddress": { "address": "moi@x.fr" } }],
            "body": { "contentType": "html", "content": "<html><head><style>p{}</style></head><body><p>Bonjour&nbsp;Simon</p><p>Ci-joint&hellip;</p></body></html>" }
        });
        let s = graph_summary(&v);
        assert!(s.unread);
        assert_eq!(s.at, 1791880511000);
        let m = graph_message(&v);
        assert_eq!(m.body, "Bonjour Simon\n\nCi-joint…");
        assert_eq!(m.to, "moi@x.fr");
    }

    #[test]
    fn html_scripts_are_dropped() {
        assert_eq!(html_to_text("a<script>alert(1)</script>b<br>c &amp; d"), "ab\nc & d");
    }

    #[test]
    fn long_bodies_are_cut() {
        let (b, cut) = clip(&"x".repeat(MAX_BODY_CHARS + 5));
        assert!(cut);
        assert_eq!(b.chars().count(), MAX_BODY_CHARS);
    }

    #[test]
    fn recipients_are_checked() {
        assert_eq!(parse_recipients("a@x.fr; Marie <b@y.fr>,").unwrap(), vec!["a@x.fr", "b@y.fr"]);
        assert!(parse_recipients("").is_err());
        assert!(parse_recipients("pas une adresse").is_err());
        assert!(parse_recipients("a@x.fr\r\nBcc: z@z.fr").is_err());
        assert!(!valid_address("a@b"));
        assert!(!valid_address("a b@c.fr"));
    }

    #[test]
    fn reply_subject_has_one_re() {
        assert_eq!(reply_subject("Réunion"), "Re: Réunion");
        assert_eq!(reply_subject("RE: Réunion"), "RE: Réunion");
    }

    #[test]
    fn mime_has_attachment_and_accents() {
        let out = Outgoing {
            to: vec!["a@x.fr".into()],
            subject: "Été\r\nBcc: z@z.fr".into(),
            body: "Bonjour".into(),
            attachment: Some(Attachment { name: "devis.pdf".into(), mime: "application/pdf", bytes: b"%PDF".to_vec() }),
            reply_to: Some(Message { message_id: "<m@x>".into(), ..Default::default() }),
        };
        let text = String::from_utf8(mime("moi@x.fr", &out)).unwrap();
        // Pas d'en-tête glissé par l'objet : il est encodé, sans retour à la ligne.
        assert!(!text.contains("\r\nBcc:"));
        assert!(text.contains("Subject: =?UTF-8?B?"));
        assert!(text.contains("In-Reply-To: <m@x>"));
        assert!(text.contains("filename=\"devis.pdf\""));
        assert!(text.contains("multipart/mixed"));
        assert!(text.contains(&base64::engine::general_purpose::STANDARD.encode("Bonjour")));
    }

    #[test]
    fn graph_bodies() {
        let out = Outgoing { to: vec!["a@x.fr".into()], subject: "S".into(), body: "B".into(), attachment: None, reply_to: None };
        let v = graph_send(&out);
        assert_eq!(v["message"]["toRecipients"][0]["emailAddress"]["address"], "a@x.fr");
        assert_eq!(v["message"]["body"]["contentType"], "Text");
        assert_eq!(graph_reply(&out)["comment"], "B");
    }

    #[test]
    fn ids_cannot_leave_the_path() {
        assert!(safe_id("18c2a0f"));
        assert!(safe_id("AAMkAGI2T=="));
        assert!(!safe_id("../x"));
        assert!(!safe_id("a?b"));
        assert!(!safe_id(""));
    }

    #[test]
    fn mime_types() {
        assert_eq!(mime_of("Devis.PDF"), "application/pdf");
        assert_eq!(mime_of("x"), "application/octet-stream");
    }
}
