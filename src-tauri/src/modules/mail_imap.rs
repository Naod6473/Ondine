// Module « Mail » : Gmail avec un mot de passe d'application (IMAP + SMTP).
//
// La voie la plus simple pour Gmail : l'adresse et un « mot de passe
// d'application » (16 lettres, créé dans le compte Google, validation en deux
// étapes obligatoire). Aucune inscription Google Cloud. Le mot de passe reste
// dans le Gestionnaire d'identifiants Windows.
//
//   - lecture : IMAP chiffré (imap.gmail.com:993). Seules quelques commandes :
//     LOGIN, EXAMINE INBOX (lecture seule : rien n'est modifié, pas même le
//     « lu »), FETCH, UID FETCH, LOGOUT ;
//   - envoi : SMTP chiffré (smtp.gmail.com:465), le message MIME fabriqué par
//     mail_api::mime. Gmail le range lui-même dans « Messages envoyés ».
//
// Le TLS est celui de Windows (native-tls, comme les appels HTTPS d'Ondine).
// Le mot de passe ne sert qu'aux commandes LOGIN et AUTH : jamais journalisé.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use base64::Engine;
use native_tls::{TlsConnector, TlsStream};

use super::mail_api::{self as api, Message, Outgoing, Summary, LIST_SIZE};

const IMAP_HOST: &str = "imap.gmail.com";
const SMTP_HOST: &str = "smtp.gmail.com";
const TIMEOUT: Duration = Duration::from_secs(30);
/// Un mail de plus de 30 Mo n'est pas lu (Gmail en refuse au-delà de 25 Mo).
const MAX_LITERAL: usize = 30 * 1024 * 1024;

/// L'adresse et le mot de passe d'application.
pub struct Login<'a> {
    pub address: &'a str,
    pub password: &'a str,
}

fn tls(host: &str, port: u16) -> Result<BufReader<TlsStream<TcpStream>>, String> {
    let addr = (host, port).to_socket_addrs().map_err(|e| format!("{host} introuvable : {e}"))?.next().ok_or(format!("{host} introuvable"))?;
    let tcp = TcpStream::connect_timeout(&addr, TIMEOUT).map_err(|e| format!("{host} injoignable : {e}"))?;
    tcp.set_read_timeout(Some(TIMEOUT)).ok();
    tcp.set_write_timeout(Some(TIMEOUT)).ok();
    let connector = TlsConnector::new().map_err(|e| format!("TLS indisponible : {e}"))?;
    let stream = connector.connect(host, tcp).map_err(|e| format!("connexion chiffrée à {host} impossible : {e}"))?;
    Ok(BufReader::new(stream))
}

/// Une ligne (sans le \r\n final).
fn read_line(r: &mut impl BufRead) -> Result<Vec<u8>, String> {
    let mut line = Vec::new();
    let n = r.by_ref().take(64 * 1024).read_until(b'\n', &mut line).map_err(|e| format!("lecture interrompue : {e}"))?;
    if n == 0 {
        return Err("le serveur a fermé la connexion".into());
    }
    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    Ok(line)
}

// ── IMAP ─────────────────────────────────────────────────────────────────────

/// Une réponse « * … » du serveur : son texte, et les blocs {n} qu'elle contient.
#[derive(Debug, Default, PartialEq)]
pub struct Untagged {
    pub text: String,
    pub literals: Vec<Vec<u8>>,
}

/// « … {123} » en fin de ligne → 123.
pub fn literal_len(line: &[u8]) -> Option<usize> {
    let line = std::str::from_utf8(line).ok()?;
    let inner = line.strip_suffix('}')?;
    let open = inner.rfind('{')?;
    inner[open + 1..].parse().ok()
}

/// Une chaîne entre guillemets IMAP.
pub fn quote(s: &str) -> String {
    let clean: String = s.chars().filter(|c| !c.is_control()).collect();
    format!("\"{}\"", clean.replace('\\', "\\\\").replace('"', "\\\""))
}

struct Imap {
    io: BufReader<TlsStream<TcpStream>>,
    tag: u32,
}

impl Imap {
    fn open(login: &Login) -> Result<Imap, String> {
        let mut io = tls(IMAP_HOST, 993)?;
        read_line(&mut io)?; // « * OK Gimap ready »
        let mut imap = Imap { io, tag: 0 };
        // Google affiche le mot de passe d'application par groupes de 4 : sans les espaces.
        let password: String = login.password.chars().filter(|c| !c.is_whitespace()).collect();
        imap.run(&format!("LOGIN {} {}", quote(login.address), quote(&password))).map_err(|e| {
            if e.contains("AUTHENTICATIONFAILED") || e.contains("Invalid credentials") {
                "adresse Gmail ou mot de passe d'application refusé : vérifiez-les dans les réglages du module Mail".to_string()
            } else {
                e
            }
        })?;
        Ok(imap)
    }

    /// Envoie une commande ; renvoie les réponses « * » jusqu'à « tag OK ».
    fn run(&mut self, command: &str) -> Result<Vec<Untagged>, String> {
        self.tag += 1;
        let tag = format!("a{}", self.tag);
        self.io.get_mut().write_all(format!("{tag} {command}\r\n").as_bytes()).map_err(|e| format!("envoi interrompu : {e}"))?;
        let mut out = Vec::new();
        let mut current = Untagged::default();
        loop {
            let line = read_line(&mut self.io)?;
            if let Some(n) = literal_len(&line) {
                if n > MAX_LITERAL {
                    return Err("mail trop gros pour être lu ici".into());
                }
                current.text.push_str(&String::from_utf8_lossy(&line));
                let mut block = vec![0u8; n];
                self.io.read_exact(&mut block).map_err(|e| format!("lecture interrompue : {e}"))?;
                current.literals.push(block);
                continue; // la suite de la réponse est sur la ligne suivante
            }
            let text = String::from_utf8_lossy(&line).into_owned();
            if current.text.is_empty() {
                if let Some(rest) = text.strip_prefix(&format!("{tag} ")) {
                    return if rest.starts_with("OK") { Ok(out) } else { Err(format!("Gmail a refusé : {}", rest.chars().take(160).collect::<String>())) };
                }
            }
            current.text.push_str(&text);
            out.push(std::mem::take(&mut current));
        }
    }

    fn close(mut self) {
        let _ = self.run("LOGOUT");
    }
}

/// « * 42 EXISTS » → 42.
pub fn exists(responses: &[Untagged]) -> u32 {
    responses
        .iter()
        .find_map(|r| r.text.strip_prefix("* ").and_then(|t| t.strip_suffix(" EXISTS")).and_then(|n| n.trim().parse().ok()))
        .unwrap_or(0)
}

/// « UID 123 » dans une réponse FETCH.
pub fn uid_of(text: &str) -> Option<String> {
    let at = text.find("UID ")? + 4;
    let digits: String = text[at..].chars().take_while(char::is_ascii_digit).collect();
    (!digits.is_empty()).then_some(digits)
}

fn parse(raw: &[u8]) -> Option<mail_parser::Message<'_>> {
    mail_parser::MessageParser::default().parse(raw)
}

fn sender(m: &mail_parser::Message) -> (String, String) {
    let first = m.from().and_then(|a| a.first());
    let addr = first.and_then(|a| a.address()).unwrap_or("").to_string();
    let name = first.and_then(|a| a.name()).unwrap_or("").trim().to_string();
    (if name.is_empty() { addr.clone() } else { name }, addr)
}

/// Une ligne de la liste, à partir d'une réponse FETCH (en-têtes seulement).
pub fn summary_of(r: &Untagged) -> Option<Summary> {
    let id = uid_of(&r.text)?;
    let header = r.literals.first()?;
    let m = parse(header)?;
    let (from, from_addr) = sender(&m);
    Some(Summary {
        id,
        from,
        from_addr,
        subject: m.subject().unwrap_or("").to_string(),
        at: m.date().map(|d| d.to_timestamp() * 1000).unwrap_or(0),
        unread: !r.text.contains("\\Seen"),
    })
}

/// Un mail entier (texte brut, ou le HTML mis en texte).
pub fn message_of(id: &str, raw: &[u8]) -> Message {
    let Some(m) = parse(raw) else { return Message { id: id.into(), ..Default::default() } };
    let (from, from_addr) = sender(&m);
    let to = m
        .to()
        .map(|a| a.iter().filter_map(|x| x.address()).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    let text = match m.text_body.first() {
        Some(_) => m.body_text(0).map(|t| t.into_owned()).unwrap_or_default(),
        None => m.body_html(0).map(|h| api::html_to_text(&h)).unwrap_or_default(),
    };
    let (body, cut) = api::clip(&text);
    Message {
        id: id.into(),
        from,
        from_addr,
        to,
        subject: m.subject().unwrap_or("").to_string(),
        at: m.date().map(|d| d.to_timestamp() * 1000).unwrap_or(0),
        body,
        cut,
        thread_id: String::new(),
        message_id: m.message_id().map(|id| format!("<{id}>")).unwrap_or_default(),
    }
}

/// Vérifie l'adresse et le mot de passe (une connexion, puis LOGOUT).
pub fn check(login: &Login) -> Result<(), String> {
    Imap::open(login)?.close();
    Ok(())
}

/// Les derniers mails de la boîte de réception, du plus récent au plus ancien.
pub fn list(login: &Login) -> Result<Vec<Summary>, String> {
    let mut imap = Imap::open(login)?;
    // EXAMINE : la boîte en lecture seule.
    let n = exists(&imap.run("EXAMINE INBOX")?);
    if n == 0 {
        imap.close();
        return Ok(Vec::new());
    }
    let first = n.saturating_sub(LIST_SIZE as u32 - 1).max(1);
    let responses = imap.run(&format!("FETCH {first}:{n} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"))?;
    imap.close();
    let mut items: Vec<Summary> = responses.iter().filter_map(summary_of).collect();
    items.sort_by_key(|s| std::cmp::Reverse(s.id.parse::<u64>().unwrap_or(0)));
    Ok(items)
}

/// Un mail entier, par son UID.
pub fn message(login: &Login, id: &str) -> Result<Message, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("identifiant de mail invalide".into());
    }
    let mut imap = Imap::open(login)?;
    imap.run("EXAMINE INBOX")?;
    let responses = imap.run(&format!("UID FETCH {id} (UID BODY.PEEK[])"))?;
    imap.close();
    let raw = responses.iter().find(|r| uid_of(&r.text).as_deref() == Some(id)).and_then(|r| r.literals.first()).ok_or("mail introuvable (supprimé ?)")?;
    Ok(message_of(id, raw))
}

// ── SMTP ─────────────────────────────────────────────────────────────────────

/// Lit une réponse SMTP (plusieurs lignes « 250-… » puis « 250 … ») ; erreur si le code n'est pas attendu.
fn smtp_reply(io: &mut impl BufRead, expect: &[&str]) -> Result<(), String> {
    loop {
        let line = String::from_utf8_lossy(&read_line(io)?).into_owned();
        if line.len() >= 4 && line.as_bytes()[3] == b'-' {
            continue;
        }
        let code = line.get(..3).unwrap_or("");
        return if expect.contains(&code) {
            Ok(())
        } else if code == "535" {
            Err("Gmail a refusé le mot de passe d'application".into())
        } else {
            Err(format!("Gmail a refusé l'envoi : {}", line.chars().take(160).collect::<String>()))
        };
    }
}

/// Le message prêt pour DATA : fins de ligne CRLF, points doublés en début de
/// ligne, et la fin « . ».
pub fn dot_stuff(message: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(message).replace("\r\n", "\n");
    let mut out = String::with_capacity(text.len() + 16);
    for line in text.split('\n') {
        if line.starts_with('.') {
            out.push('.');
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out.push_str(".\r\n");
    out.into_bytes()
}

/// Une commande SMTP, puis sa réponse.
fn say(io: &mut BufReader<TlsStream<TcpStream>>, line: &str, expect: &[&str]) -> Result<(), String> {
    io.get_mut().write_all(format!("{line}\r\n").as_bytes()).map_err(|e| format!("envoi interrompu : {e}"))?;
    smtp_reply(io, expect)
}

/// Envoie un mail par smtp.gmail.com.
pub fn send(login: &Login, out: &Outgoing) -> Result<(), String> {
    let mut io = tls(SMTP_HOST, 465)?;
    smtp_reply(&mut io, &["220"])?;
    say(&mut io, "EHLO ondine", &["250"])?;
    let password: String = login.password.chars().filter(|c| !c.is_whitespace()).collect();
    let plain = base64::engine::general_purpose::STANDARD.encode(format!("\0{}\0{}", login.address, password));
    say(&mut io, &format!("AUTH PLAIN {plain}"), &["235"])?;
    say(&mut io, &format!("MAIL FROM:<{}>", login.address), &["250"])?;
    for to in &out.to {
        // Les adresses ont été vérifiées (mail_api::parse_recipients) : pas de < > ni de retour à la ligne.
        say(&mut io, &format!("RCPT TO:<{to}>"), &["250", "251"])?;
    }
    say(&mut io, "DATA", &["354"])?;
    io.get_mut().write_all(&dot_stuff(&api::mime(login.address, out))).map_err(|e| format!("envoi interrompu : {e}"))?;
    smtp_reply(&mut io, &["250"])?;
    let _ = say(&mut io, "QUIT", &["221"]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literals_and_quotes() {
        assert_eq!(literal_len(b"* 3 FETCH (UID 9 BODY[] {1024}"), Some(1024));
        assert_eq!(literal_len(b"* OK ready"), None);
        assert_eq!(quote("a\"b\\c\r\n"), "\"a\\\"b\\\\c\"");
    }

    #[test]
    fn exists_and_uid() {
        let r = vec![Untagged { text: "* FLAGS (\\Seen)".into(), literals: vec![] }, Untagged { text: "* 42 EXISTS".into(), literals: vec![] }];
        assert_eq!(exists(&r), 42);
        assert_eq!(uid_of("* 5 FETCH (FLAGS (\\Seen) UID 1234 BODY[] {10})"), Some("1234".into()));
        assert_eq!(uid_of("* 5 FETCH (FLAGS ())"), None);
    }

    #[test]
    fn a_fetched_header_becomes_a_summary() {
        let r = Untagged {
            text: "* 5 FETCH (UID 77 FLAGS () BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {0})".into(),
            literals: vec![b"From: =?UTF-8?B?w4lsaXNl?= <elise@x.fr>\r\nSubject: =?ISO-8859-1?Q?R=E9union?=\r\nDate: Tue, 13 Oct 2026 08:35:11 +0000\r\n\r\n".to_vec()],
        };
        let s = summary_of(&r).unwrap();
        assert_eq!((s.id.as_str(), s.from.as_str(), s.from_addr.as_str(), s.subject.as_str()), ("77", "Élise", "elise@x.fr", "Réunion"));
        assert_eq!(s.at, 1791880511000);
        assert!(s.unread);
    }

    #[test]
    fn a_raw_mail_is_read() {
        let raw = b"From: Paul <paul@x.fr>\r\nTo: moi@gmail.com\r\nSubject: Devis\r\nMessage-ID: <abc@x.fr>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Bonjour</p><p>Voici le devis&nbsp;!</p>";
        let m = message_of("9", raw);
        assert_eq!(m.from_addr, "paul@x.fr");
        assert_eq!(m.to, "moi@gmail.com");
        assert_eq!(m.message_id, "<abc@x.fr>");
        assert!(m.body.contains("Bonjour"));
        assert!(m.body.contains("Voici le devis"));
        assert!(!m.body.contains("<p>"));
    }

    #[test]
    fn data_is_dot_stuffed() {
        assert_eq!(dot_stuff(b"a\r\n.b\nc"), b"a\r\n..b\r\nc\r\n.\r\n".to_vec());
    }
}
