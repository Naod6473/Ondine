// Module « Équipe » : le PROTOCOLE entre deux Ondine du même réseau local.
//
// Code pur (aucune fenêtre, aucun réglage, aucun fil) : tout ce qui décide de
// la sécurité est ici, et testé en bas du fichier avec deux pairs simulés en
// mémoire (aucune vraie carte réseau).
//
// ── Les trois étages ────────────────────────────────────────────────────────
//
// 1. Découverte (UDP, port 47820, en clair) : « je suis là » sur le réseau
//    local, seulement si le réglage « Visible » est allumé. Le paquet ne dit
//    que le nom choisi, la couleur de la mascotte et l'empreinte de la clé
//    publique (16 chiffres hexadécimaux). Rien n'est jamais accepté sur la foi
//    d'un paquet de découverte : il sert à proposer « Ajouter », c'est tout.
//
// 2. Appairage (TCP, port 47821, mode « P ») : le collègue B affiche un code à
//    6 chiffres (valable 3 minutes, UN seul essai) ; A le tape.
//      - SPAKE2 (crate spake2) transforme ce code en une clé commune de 32
//        octets SANS l'envoyer : quelqu'un qui écoute n'apprend rien, et un
//        intrus qui se met au milieu n'a qu'un essai (1 chance sur 1 000 000),
//        sans pouvoir rejouer hors ligne ;
//      - puis une poignée de main Noise « XXpsk3 » (crate snow) avec cette clé
//        en « psk » : chacun apprend la clé publique X25519 de l'autre, liée au
//        code. Un code faux = la poignée de main échoue ;
//      - enfin chacun envoie, chiffré, sa fiche (nom, couleur, mascotte, « mon
//        PC »). La clé publique de l'autre est alors gardée (team.json) ; la
//        clé privée, elle, ne quitte jamais le Gestionnaire d'identifiants.
//
// 3. Échanges (TCP, port 47821, mode « S ») : chaque connexion commence par
//    une poignée de main Noise « IK » : celui qui appelle connaît déjà la clé
//    publique de l'autre (appairage), et prouve la sienne. Celui qui reçoit
//    refuse toute clé qui n'est pas celle d'un collègue appairé. Ensuite tout
//    est chiffré et authentifié (ChaCha20-Poly1305), avec une clé neuve par
//    connexion (secret de transfert : voler la clé privée plus tard ne
//    déchiffre pas les anciens échanges).
//
// ── Les règles du contenu ───────────────────────────────────────────────────
//   - un message = un objet JSON (Msg) de 60 Ko au plus, vérifié champ par
//     champ (`Msg::check`) avant toute utilisation ;
//   - rien de ce qui arrive n'est exécuté ; fichiers et textes attendent
//     « Accepter » (c'est team.rs qui s'en charge) ;
//   - un nom de fichier reçu est assaini (`safe_file_name`) : jamais de
//     chemin, de « .. », de nom réservé de Windows (CON, NUL…) ni de « : »
//     (flux NTFS cachés).
//
// Les trames sur le fil : 2 octets (longueur, gros-boutiste) + le message
// Noise (65 535 octets au plus, la limite de Noise). Dans le canal chiffré,
// chaque message commence par un octet : 0 = JSON, 1 = morceau de fichier.

use std::io::{Read, Write};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use snow::{Builder, HandshakeState, TransportState};
use spake2::{Ed25519Group, Identity, Password, Spake2};

/// Le port UDP de la découverte (documenté dans ARCHITECTURE.md).
pub const DISCOVERY_PORT: u16 = 47820;
/// Le port TCP des échanges et de l'appairage.
pub const SERVICE_PORT: u16 = 47821;

/// Les deux motifs Noise : IK entre collègues, XXpsk3 pour l'appairage.
const NOISE_SESSION: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
const NOISE_PAIR: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";
/// Le « prologue » : lié à la poignée de main, il empêche de faire passer un
/// échange d'un protocole (ou d'une version) pour un autre.
const PROLOGUE_SESSION: &[u8] = b"ondine-team-session-v1";
const PROLOGUE_PAIR: &[u8] = b"ondine-team-pair-v1";
/// Les deux rôles de SPAKE2 (celui qui tape le code, celui qui l'affiche).
const SPAKE_A: &[u8] = b"ondine-team-pair-a";
const SPAKE_B: &[u8] = b"ondine-team-pair-b";

/// Le premier octet d'une connexion TCP : appairage ou échange.
pub const MODE_PAIR: u8 = b'P';
pub const MODE_SESSION: u8 = b'S';

/// Un message Noise ne dépasse jamais 65 535 octets.
pub const MAX_FRAME: usize = 65_535;
/// Le chiffrement ajoute 16 octets (l'étiquette d'authentification).
const TAG: usize = 16;
/// Un message JSON : 60 Ko au plus.
pub const MAX_JSON: usize = 60_000;
/// Un morceau de fichier : 60 Ko.
pub const CHUNK: usize = 60_000;
/// Un paquet de découverte : 512 octets au plus.
pub const MAX_ANNOUNCE: usize = 512;

/// Les longueurs maximales (en caractères).
pub const MAX_NAME: usize = 40;
pub const MAX_NOTE: usize = 280;
pub const MAX_TEXT: usize = 20_000;
pub const MAX_STATUS_TEXT: usize = 60;
pub const MAX_FILE_NAME: usize = 120;
pub const MAX_SUMMARY: usize = 8_000;
pub const MAX_CHOICE: usize = 60;
pub const MAX_QUESTION: usize = 200;

// ── Les clés ─────────────────────────────────────────────────────────────────

/// La paire de clés X25519 de ce PC (son identité pour l'équipe).
#[derive(Clone)]
pub struct Keys {
    pub private: [u8; 32],
    pub public: [u8; 32],
}

impl std::fmt::Debug for Keys {
    // La clé privée n'apparaît jamais, même dans un message de débogage.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Keys {{ public: {} }}", fingerprint(&self.public))
    }
}

impl Keys {
    /// Une nouvelle paire, tirée du hasard du système.
    pub fn generate() -> Result<Self, String> {
        let kp = Builder::new(params(NOISE_SESSION)).generate_keypair().map_err(|e| format!("clés impossibles à créer : {e}"))?;
        Ok(Self { private: to32(&kp.private)?, public: to32(&kp.public)? })
    }

    /// Relit une clé privée (64 chiffres hexadécimaux) et recalcule la publique.
    pub fn from_private_hex(hex: &str) -> Result<Self, String> {
        let private = to32(&from_hex(hex.trim())?)?;
        let public = x25519_public(&private);
        Ok(Self { private, public })
    }

    pub fn private_hex(&self) -> String {
        to_hex(&self.private)
    }
}

/// La clé publique X25519 qui va avec une clé privée (multiplication par le
/// point de base, comme le fait Noise ; serrée selon la RFC 7748).
fn x25519_public(private: &[u8; 32]) -> [u8; 32] {
    curve25519_dalek::MontgomeryPoint::mul_base_clamped(*private).to_bytes()
}

/// L'empreinte d'une clé publique : 16 chiffres hexadécimaux (SHA-256 tronqué).
/// Sert d'identifiant de collègue et s'affiche pour comparer à l'œil.
pub fn fingerprint(public: &[u8; 32]) -> String {
    to_hex(&Sha256::digest(public)[..8])
}

/// « 3f2a 91c0 7b4e d218 » : l'empreinte par groupes de 4, plus lisible.
pub fn fingerprint_pretty(fp: &str) -> String {
    fp.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).to_string()).collect::<Vec<_>>().join(" ")
}

fn params(pattern: &str) -> snow::params::NoiseParams {
    // Les deux motifs sont des constantes valides : l'analyse ne peut pas échouer.
    pattern.parse().expect("motif Noise valide")
}

fn to32(bytes: &[u8]) -> Result<[u8; 32], String> {
    bytes.try_into().map_err(|_| "clé de longueur invalide".to_string())
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("texte hexadécimal invalide".into());
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string())).collect()
}

/// Un nombre au hasard (identifiants d'envoi, de sondage…).
pub fn random_u64() -> u64 {
    let mut b = [0u8; 8];
    // Sans hasard du système, on se rabat sur l'heure (ces numéros ne sont pas secrets).
    if getrandom::fill(&mut b).is_err() {
        return std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
    }
    // Moins de 2^53 : le nombre reste exact une fois en JavaScript.
    u64::from_le_bytes(b) & ((1 << 53) - 1)
}

/// Un code d'appairage à 6 chiffres, tiré au hasard sans biais.
pub fn new_pair_code() -> Result<String, String> {
    loop {
        let mut b = [0u8; 4];
        getrandom::fill(&mut b).map_err(|e| format!("hasard indisponible : {e}"))?;
        let n = u32::from_le_bytes(b);
        // On rejette le haut de l'intervalle : chaque code a la même chance.
        if n < 4_294_000_000 {
            return Ok(format!("{:06}", n % 1_000_000));
        }
    }
}

/// Un code tapé : 6 chiffres, les espaces et tirets ignorés (« 482 913 »).
pub fn clean_pair_code(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    (digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_digit())).then_some(digits)
}

// ── Les fiches et les messages ───────────────────────────────────────────────

/// La fiche échangée à l'appairage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairInfo {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub mascot: String,
    /// « C'est mon PC » : l'appairage relie deux PC de la même personne.
    #[serde(default)]
    pub mine: bool,
}

impl PairInfo {
    pub fn check(&self) -> Result<(), String> {
        check_name(&self.name)?;
        check_color(&self.color)?;
        check_id(&self.mascot, 40)
    }
}

/// La présence envoyée aux collègues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub mascot: String,
    /// available, meeting, focus, away
    pub status: String,
    #[serde(default)]
    pub status_text: String,
    /// La version d'Ondine (« 1.2.2 »).
    #[serde(default)]
    pub version: String,
    /// Seulement entre mes PC : la batterie du portable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battery: Option<Battery>,
    /// Accepte les visites d'Ondine (sa mascotte qui traverse l'écran).
    #[serde(default)]
    pub visits: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Battery {
    pub percent: u8,
    pub charging: bool,
}

/// Un disque dans l'état du PC (outils IT).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskState {
    pub mount: String,
    pub free_gb: f64,
    pub total_gb: f64,
}

/// L'état du PC envoyé à l'IT, seulement après « Autoriser » (ou si le réglage
/// « Partager l'inventaire » est allumé, pour l'inventaire).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub host: String,
    pub os: String,
    pub ondine: String,
    pub cpu_pct: f64,
    pub mem_pct: f64,
    pub disks: Vec<DiskState>,
    pub reboot_pending: bool,
    pub uptime_secs: u64,
}

/// Tous les messages. Le champ « t » donne la sorte.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Msg {
    /// La présence (réponse : la présence de l'autre).
    Hello(Hello),
    /// Coucou, pouce, café… (la mascotte de l'autre fait le geste).
    Ping { kind: String },
    /// « Tu es dispo ? »
    Ask { id: u64 },
    /// Réponse à « Tu es dispo ? » : yes, later, no.
    Answer { id: u64, answer: String },
    /// Une visite d'Ondine avec un petit mot.
    Visit { note: String },
    /// Un texte ou un lien, qui attend « Accepter ».
    Text { id: u64, text: String },
    /// Un fichier (ou un dossier zippé) proposé, qui attend « Accepter ».
    Offer { id: u64, name: String, size: u64, folder: bool },
    /// « Accepter » : le destinataire vient chercher le fichier.
    Pull { id: u64 },
    /// « Refuser » : l'envoyeur oublie le fichier.
    Decline { id: u64 },
    /// Café / déjeuner collectif dans `minutes`.
    Invite { id: u64, kind: String, minutes: u32 },
    InviteReply { id: u64, answer: String },
    /// Sondage express : 2 à 4 choix.
    Poll { id: u64, question: String, choices: Vec<String> },
    Vote { id: u64, choice: u8 },
    /// Pomodoro d'équipe : chacun peut rejoindre.
    Pomodoro { minutes: u32 },
    /// Une annonce à tout le groupe.
    Announce { text: String },
    /// « Demander de l'aide » : le résumé système (et une capture proposée à part).
    Help { id: u64, summary: String, note: String },
    /// L'IT demande l'état du PC (attend « Autoriser »).
    StatusAsk { id: u64 },
    StatusReport { id: u64, report: Report },
    /// L'IT demande le Bureau à distance (attend « Autoriser »).
    RdpAsk { id: u64 },
    RdpReply { id: u64, ok: bool },
    /// L'inventaire de l'équipe (réponse : StatusReport, ou Refused).
    InventoryAsk,
    /// Entre mes PC : le texte copié (jamais un élément marqué sensible).
    Clipboard { text: String },
    /// Entre mes PC : la mascotte, sa couleur (« auto », « mint »… ou
    /// « custom ») et la couleur personnalisée.
    MascotSync { mascot: String, palette: String, custom: String },
    /// Réponses courtes.
    Ok,
    Refused { reason: String },
    /// Avant les morceaux d'un fichier, et après.
    FileStart { size: u64 },
    FileEnd { sha256: String },
}

/// Les gestes qu'un collègue peut envoyer.
pub const PING_KINDS: &[&str] = &["wave", "thumb", "coffee", "heart", "clap", "party"];
pub const ANSWERS: &[&str] = &["yes", "later", "no"];
pub const STATUSES: &[&str] = &["available", "meeting", "focus", "away"];
pub const INVITE_KINDS: &[&str] = &["coffee", "lunch"];

impl Msg {
    /// Vérifie chaque champ. Un message qui ne passe pas est ignoré en entier.
    pub fn check(&self) -> Result<(), String> {
        match self {
            Msg::Hello(h) => {
                check_name(&h.name)?;
                check_color(&h.color)?;
                check_id(&h.mascot, 40)?;
                one_of(&h.status, STATUSES)?;
                check_text(&h.status_text, MAX_STATUS_TEXT, false)?;
                check_id(&h.version, 40)?;
                if h.battery.is_some_and(|b| b.percent > 100) {
                    return Err("batterie invalide".into());
                }
                Ok(())
            }
            Msg::Ping { kind } => one_of(kind, PING_KINDS),
            Msg::Answer { answer, .. } => one_of(answer, ANSWERS),
            Msg::Visit { note } => check_text(note, MAX_NOTE, false),
            Msg::Text { text, .. } => nonempty(text).and(check_text(text, MAX_TEXT, true)),
            Msg::Offer { name, .. } => {
                // Le nom sera de toute façon assaini à l'arrivée ; ici on refuse l'absurde.
                nonempty(name)?;
                check_text(name, 255, false)
            }
            Msg::Invite { kind, minutes, .. } => {
                one_of(kind, INVITE_KINDS)?;
                in_range(*minutes, 0, 120)
            }
            Msg::InviteReply { answer, .. } => one_of(answer, ANSWERS),
            Msg::Poll { question, choices, .. } => {
                nonempty(question)?;
                check_text(question, MAX_QUESTION, false)?;
                if !(2..=4).contains(&choices.len()) {
                    return Err("un sondage a 2 à 4 choix".into());
                }
                choices.iter().try_for_each(|c| nonempty(c).and(check_text(c, MAX_CHOICE, false)))
            }
            Msg::Vote { choice, .. } => in_range(u32::from(*choice), 0, 3),
            Msg::Pomodoro { minutes } => in_range(*minutes, 5, 90),
            Msg::Announce { text } => nonempty(text).and(check_text(text, MAX_NOTE, true)),
            Msg::Help { summary, note, .. } => {
                check_text(summary, MAX_SUMMARY, true)?;
                check_text(note, MAX_NOTE * 4, true)
            }
            Msg::StatusReport { report, .. } => check_report(report),
            Msg::Clipboard { text } => nonempty(text).and(check_text(text, MAX_TEXT, true)),
            Msg::MascotSync { mascot, palette, custom } => {
                check_id(mascot, 40)?;
                check_id(palette, 20)?;
                check_color(custom)
            }
            Msg::Refused { reason } => check_text(reason, 200, false),
            Msg::FileEnd { sha256 } => {
                if sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
                    Ok(())
                } else {
                    Err("empreinte invalide".into())
                }
            }
            Msg::Ask { .. }
            | Msg::Pull { .. }
            | Msg::Decline { .. }
            | Msg::StatusAsk { .. }
            | Msg::RdpAsk { .. }
            | Msg::RdpReply { .. }
            | Msg::InventoryAsk
            | Msg::Ok
            | Msg::FileStart { .. } => Ok(()),
        }
    }
}

fn check_report(r: &Report) -> Result<(), String> {
    check_text(&r.host, 64, false)?;
    check_text(&r.os, 120, false)?;
    check_id(&r.ondine, 40)?;
    if r.disks.len() > 32 || !r.cpu_pct.is_finite() || !r.mem_pct.is_finite() {
        return Err("état du PC invalide".into());
    }
    r.disks.iter().try_for_each(|d| {
        check_text(&d.mount, 64, false)?;
        if d.free_gb.is_finite() && d.total_gb.is_finite() {
            Ok(())
        } else {
            Err("disque invalide".into())
        }
    })
}

fn nonempty(s: &str) -> Result<(), String> {
    if s.trim().is_empty() {
        Err("texte vide".into())
    } else {
        Ok(())
    }
}

fn in_range(n: u32, min: u32, max: u32) -> Result<(), String> {
    if (min..=max).contains(&n) {
        Ok(())
    } else {
        Err("nombre hors limites".into())
    }
}

fn one_of(s: &str, list: &[&str]) -> Result<(), String> {
    if list.contains(&s) {
        Ok(())
    } else {
        Err(format!("valeur inconnue : {}", s.chars().take(20).collect::<String>()))
    }
}

/// Un texte : `max` caractères au plus, sans caractère de contrôle (sauf les
/// retours à la ligne et tabulations si `multiline`), ni les caractères
/// invisibles qui retournent l'affichage (attaques « Trojan Source »).
pub fn check_text(s: &str, max: usize, multiline: bool) -> Result<(), String> {
    if s.chars().count() > max {
        return Err(format!("texte trop long ({max} caractères au plus)"));
    }
    let bad = s.chars().any(|c| {
        let allowed_ws = multiline && matches!(c, '\n' | '\r' | '\t');
        (c.is_control() && !allowed_ws) || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
    });
    if bad {
        return Err("caractères interdits".into());
    }
    Ok(())
}

pub fn check_name(s: &str) -> Result<(), String> {
    nonempty(s)?;
    check_text(s, MAX_NAME, false)
}

pub fn check_color(s: &str) -> Result<(), String> {
    if s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("couleur invalide".into())
    }
}

/// Un identifiant court ([a-z0-9.-]), vide permis.
fn check_id(s: &str, max: usize) -> Result<(), String> {
    if s.len() <= max && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.') {
        Ok(())
    } else {
        Err("identifiant invalide".into())
    }
}

// ── Noms de fichiers reçus ───────────────────────────────────────────────────

/// Les noms que Windows réserve (même avec une extension : « nul.txt »).
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3",
    "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Assainit un nom de fichier venu d'un collègue : on ne garde que le dernier
/// morceau (pas de dossier), sans caractère interdit par Windows ni « : »
/// (flux NTFS cachés), sans point ni espace au bout, jamais un nom réservé,
/// 120 caractères au plus (en gardant l'extension). Vide → « fichier ».
pub fn safe_file_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut name: String = last
        .chars()
        .map(|c| if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}') { '_' } else { c })
        .collect();
    name = name.trim().trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    if name.chars().count() > MAX_FILE_NAME {
        let (stem, ext) = match name.rfind('.') {
            Some(i) if name.len() - i <= 16 && i > 0 => (name[..i].to_string(), name[i..].to_string()),
            _ => (name.clone(), String::new()),
        };
        let keep = MAX_FILE_NAME.saturating_sub(ext.chars().count());
        name = format!("{}{ext}", stem.chars().take(keep).collect::<String>().trim_end_matches(['.', ' ']));
    }
    let stem = name.split('.').next().unwrap_or("").trim().to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        name = format!("_{name}");
    }
    if name.is_empty() {
        "fichier".into()
    } else {
        name
    }
}

// ── La découverte ────────────────────────────────────────────────────────────

/// Le paquet « je suis là » (ou « qui est là ? » si `query`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Announce {
    /// Toujours « team1 » : un paquet d'autre chose est ignoré.
    pub ondine: String,
    #[serde(default)]
    pub query: bool,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
}

pub const ANNOUNCE_TAG: &str = "team1";

impl Announce {
    pub fn me(id: &str, name: &str, color: &str) -> Self {
        Self { ondine: ANNOUNCE_TAG.into(), query: false, id: id.into(), name: name.into(), color: color.into() }
    }

    pub fn query() -> Self {
        Self { ondine: ANNOUNCE_TAG.into(), query: true, id: String::new(), name: String::new(), color: String::new() }
    }

    pub fn encode(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// Lit un paquet reçu ; None s'il n'est pas d'Ondine ou mal formé.
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.len() > MAX_ANNOUNCE {
            return None;
        }
        let a: Announce = serde_json::from_slice(bytes).ok()?;
        if a.ondine != ANNOUNCE_TAG {
            return None;
        }
        if a.query {
            return Some(a);
        }
        let id_ok = a.id.len() == 16 && a.id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
        (id_ok && check_name(&a.name).is_ok() && check_color(&a.color).is_ok()).then_some(a)
    }
}

// ── Le canal chiffré ─────────────────────────────────────────────────────────

/// Un canal établi (après la poignée de main) : chiffre et déchiffre.
pub struct Channel {
    t: TransportState,
}

/// Ce qui circule dans le canal.
#[derive(Debug, PartialEq)]
pub enum Packet {
    Msg(Msg),
    Chunk(Vec<u8>),
}

impl Channel {
    fn seal(&mut self, plain: &[u8]) -> Result<Vec<u8>, String> {
        if plain.len() + TAG > MAX_FRAME {
            return Err("message trop gros".into());
        }
        let mut out = vec![0u8; plain.len() + TAG];
        let n = self.t.write_message(plain, &mut out).map_err(|e| format!("chiffrement impossible : {e}"))?;
        out.truncate(n);
        Ok(out)
    }

    fn open(&mut self, sealed: &[u8]) -> Result<Vec<u8>, String> {
        let mut out = vec![0u8; sealed.len()];
        // Toute modification en route (ou mauvaise clé) est refusée ici.
        let n = self.t.read_message(sealed, &mut out).map_err(|_| "message refusé (altéré ou mauvaise clé)".to_string())?;
        out.truncate(n);
        Ok(out)
    }

    /// Chiffre un message JSON (vérifié avant l'envoi aussi).
    pub fn seal_msg(&mut self, msg: &Msg) -> Result<Vec<u8>, String> {
        msg.check()?;
        let mut plain = vec![0u8];
        serde_json::to_writer(&mut plain, msg).map_err(|e| e.to_string())?;
        if plain.len() > MAX_JSON {
            return Err("message trop long".into());
        }
        self.seal(&plain)
    }

    pub fn seal_chunk(&mut self, data: &[u8]) -> Result<Vec<u8>, String> {
        if data.len() > CHUNK {
            return Err("morceau trop gros".into());
        }
        let mut plain = Vec::with_capacity(data.len() + 1);
        plain.push(1);
        plain.extend_from_slice(data);
        self.seal(&plain)
    }

    /// Déchiffre, puis lit et vérifie le message.
    pub fn open_packet(&mut self, sealed: &[u8]) -> Result<Packet, String> {
        let plain = self.open(sealed)?;
        match plain.split_first() {
            Some((0, json)) => {
                if json.len() > MAX_JSON {
                    return Err("message trop long".into());
                }
                let msg: Msg = serde_json::from_slice(json).map_err(|_| "message illisible".to_string())?;
                msg.check()?;
                Ok(Packet::Msg(msg))
            }
            Some((1, data)) => Ok(Packet::Chunk(data.to_vec())),
            _ => Err("message de sorte inconnue".into()),
        }
    }

    pub fn open_msg(&mut self, sealed: &[u8]) -> Result<Msg, String> {
        match self.open_packet(sealed)? {
            Packet::Msg(m) => Ok(m),
            Packet::Chunk(_) => Err("morceau de fichier inattendu".into()),
        }
    }
}

// ── La poignée de main entre collègues (Noise IK) ────────────────────────────

/// Celui qui appelle : il connaît la clé publique de l'autre. Renvoie l'état
/// et le premier message à envoyer.
pub fn session_start(me: &Keys, peer_public: &[u8; 32]) -> Result<(HandshakeState, Vec<u8>), String> {
    let mut hs = Builder::new(params(NOISE_SESSION))
        .local_private_key(&me.private)
        .and_then(|b| b.remote_public_key(peer_public))
        .and_then(|b| b.prologue(PROLOGUE_SESSION))
        .and_then(|b| b.build_initiator())
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; MAX_FRAME];
    let n = hs.write_message(&[], &mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    Ok((hs, buf))
}

/// Celui qui appelle lit la réponse : le canal est prêt.
pub fn session_finish(mut hs: HandshakeState, reply: &[u8]) -> Result<Channel, String> {
    let mut buf = vec![0u8; MAX_FRAME];
    hs.read_message(reply, &mut buf).map_err(|_| "le collègue n'a pas répondu avec la bonne clé".to_string())?;
    let t = hs.into_transport_mode().map_err(|e| e.to_string())?;
    Ok(Channel { t })
}

/// Celui qui reçoit : lit le premier message, vérifie que la clé de l'appelant
/// est celle d'un collègue (`known`), et répond. Renvoie le canal, la réponse
/// à envoyer et la clé de l'appelant.
pub fn session_accept(me: &Keys, first: &[u8], known: impl Fn(&[u8; 32]) -> bool) -> Result<(Channel, Vec<u8>, [u8; 32]), String> {
    let mut hs = Builder::new(params(NOISE_SESSION))
        .local_private_key(&me.private)
        .and_then(|b| b.prologue(PROLOGUE_SESSION))
        .and_then(|b| b.build_responder())
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; MAX_FRAME];
    hs.read_message(first, &mut buf).map_err(|_| "poignée de main illisible".to_string())?;
    let peer = hs.get_remote_static().ok_or("clé de l'appelant absente").and_then(|k| to32(k).map_err(|_| "clé invalide"))?;
    if !known(&peer) {
        return Err("appelant inconnu (pas dans « Mes collègues »)".into());
    }
    let n = hs.write_message(&[], &mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    let t = hs.into_transport_mode().map_err(|e| e.to_string())?;
    Ok((Channel { t }, buf, peer))
}

// ── L'appairage (SPAKE2 puis Noise XXpsk3) ───────────────────────────────────

/// Le résultat d'un appairage réussi.
#[derive(Debug, Clone, PartialEq)]
pub struct Paired {
    pub peer_public: [u8; 32],
    pub info: PairInfo,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Stage {
    /// A : attend le message SPAKE2 de B. B : attend celui de A.
    Spake,
    /// A : attend le 2e message Noise. B : attend le 1er.
    Noise1,
    /// B : attend le 3e message Noise (avec la fiche de A).
    Noise3,
    /// A : attend la fiche de B.
    Info,
    Done,
    Failed,
}

/// La machine d'états de l'appairage, sans réseau : on lui donne ce qui
/// arrive, elle dit quoi envoyer. A = celui qui tape le code (initiateur),
/// B = celui qui l'affiche.
pub struct Pairing {
    initiator: bool,
    stage: Stage,
    keys: Keys,
    me: PairInfo,
    spake: Option<Spake2<Ed25519Group>>,
    /// B : le code, gardé jusqu'au message de A (SPAKE2 de B est créé à ce moment).
    code_for_b: Option<String>,
    hs: Option<HandshakeState>,
    result: Option<Paired>,
}

const PAIR_FAILED: &str = "appairage refusé : code incorrect, expiré, ou appairage interrompu";

impl Pairing {
    /// A (celui qui tape le code) : renvoie aussi le premier message.
    pub fn initiator(code: &str, keys: &Keys, me: PairInfo) -> (Self, Vec<u8>) {
        let (spake, msg) = Spake2::<Ed25519Group>::start_a(&Password::new(code.as_bytes()), &Identity::new(SPAKE_A), &Identity::new(SPAKE_B));
        let p = Self { initiator: true, stage: Stage::Spake, keys: keys.clone(), me, spake: Some(spake), code_for_b: None, hs: None, result: None };
        (p, msg)
    }

    /// B (celui qui affiche le code) : il parle en second.
    pub fn responder(code: &str, keys: &Keys, me: PairInfo) -> Self {
        Self { initiator: false, stage: Stage::Spake, keys: keys.clone(), me, spake: None, code_for_b: Some(code.to_string()), hs: None, result: None }
    }

    pub fn is_done(&self) -> bool {
        self.stage == Stage::Done
    }

    pub fn result(&self) -> Option<&Paired> {
        self.result.as_ref()
    }

    /// Un message arrive : renvoie ce qu'il faut envoyer (rien quand c'est fini).
    /// Une erreur arrête l'appairage pour de bon (pas de deuxième essai).
    pub fn receive(&mut self, input: &[u8]) -> Result<Option<Vec<u8>>, String> {
        if matches!(self.stage, Stage::Done | Stage::Failed) {
            return Err(PAIR_FAILED.into());
        }
        let out = self.step(input);
        if out.is_err() {
            self.stage = Stage::Failed;
            self.hs = None;
            self.spake = None;
            self.code_for_b = None;
        }
        out
    }

    fn step(&mut self, input: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let mut buf = vec![0u8; MAX_FRAME];
        match (self.initiator, self.stage) {
            (true, Stage::Spake) => {
                let psk = self.finish_spake(input)?;
                let mut hs = self.pair_builder(&psk, true)?;
                let n = hs.write_message(&[], &mut buf).map_err(|_| PAIR_FAILED)?;
                self.hs = Some(hs);
                self.stage = Stage::Noise1;
                Ok(Some(buf[..n].to_vec()))
            }
            (false, Stage::Spake) => {
                // B renvoie d'abord SON message SPAKE2.
                let (psk, msg) = self.finish_spake_b(input)?;
                self.hs = Some(self.pair_builder(&psk, false)?);
                self.stage = Stage::Noise1;
                Ok(Some(msg))
            }
            (false, Stage::Noise1) => {
                let hs = self.hs.as_mut().ok_or(PAIR_FAILED)?;
                hs.read_message(input, &mut buf).map_err(|_| PAIR_FAILED)?;
                let n = hs.write_message(&[], &mut buf).map_err(|_| PAIR_FAILED)?;
                self.stage = Stage::Noise3;
                Ok(Some(buf[..n].to_vec()))
            }
            (true, Stage::Noise1) => {
                let me = serde_json::to_vec(&self.me).map_err(|e| e.to_string())?;
                let hs = self.hs.as_mut().ok_or(PAIR_FAILED)?;
                hs.read_message(input, &mut buf).map_err(|_| PAIR_FAILED)?;
                let n = hs.write_message(&me, &mut buf).map_err(|_| PAIR_FAILED)?;
                self.stage = Stage::Info;
                Ok(Some(buf[..n].to_vec()))
            }
            (false, Stage::Noise3) => {
                let mut hs = self.hs.take().ok_or(PAIR_FAILED)?;
                // Ici le code faux se voit : le message 3 est chiffré avec la clé du code.
                let n = hs.read_message(input, &mut buf).map_err(|_| PAIR_FAILED)?;
                let info = read_info(&buf[..n])?;
                let peer = hs.get_remote_static().ok_or(PAIR_FAILED).and_then(|k| to32(k).map_err(|_| PAIR_FAILED))?;
                let mut t = Channel { t: hs.into_transport_mode().map_err(|_| PAIR_FAILED)? };
                let me = serde_json::to_vec(&self.me).map_err(|e| e.to_string())?;
                let out = t.seal(&me)?;
                self.result = Some(Paired { peer_public: peer, info });
                self.stage = Stage::Done;
                Ok(Some(out))
            }
            (true, Stage::Info) => {
                let hs = self.hs.take().ok_or(PAIR_FAILED)?;
                let peer = hs.get_remote_static().ok_or(PAIR_FAILED).and_then(|k| to32(k).map_err(|_| PAIR_FAILED))?;
                let mut t = Channel { t: hs.into_transport_mode().map_err(|_| PAIR_FAILED)? };
                let plain = t.open(input).map_err(|_| PAIR_FAILED)?;
                let info = read_info(&plain)?;
                self.result = Some(Paired { peer_public: peer, info });
                self.stage = Stage::Done;
                Ok(None)
            }
            _ => Err(PAIR_FAILED.into()),
        }
    }

    fn finish_spake(&mut self, input: &[u8]) -> Result<[u8; 32], String> {
        let spake = self.spake.take().ok_or(PAIR_FAILED)?;
        let key = spake.finish(input).map_err(|_| PAIR_FAILED)?;
        to32(&key).map_err(|_| PAIR_FAILED.into())
    }

    /// B : son message SPAKE2 est créé au moment de répondre à celui de A.
    fn finish_spake_b(&mut self, input: &[u8]) -> Result<([u8; 32], Vec<u8>), String> {
        let code = self.code_for_b.take().ok_or(PAIR_FAILED)?;
        let (spake, msg) = Spake2::<Ed25519Group>::start_b(&Password::new(code.as_bytes()), &Identity::new(SPAKE_A), &Identity::new(SPAKE_B));
        let key = spake.finish(input).map_err(|_| PAIR_FAILED)?;
        Ok((to32(&key).map_err(|_| PAIR_FAILED)?, msg))
    }

    fn pair_builder(&self, psk: &[u8; 32], initiator: bool) -> Result<HandshakeState, String> {
        let b = Builder::new(params(NOISE_PAIR))
            .local_private_key(&self.keys.private)
            .and_then(|b| b.psk(3, psk))
            .and_then(|b| b.prologue(PROLOGUE_PAIR))
            .map_err(|e| e.to_string())?;
        if initiator { b.build_initiator() } else { b.build_responder() }.map_err(|e| e.to_string())
    }
}

fn read_info(bytes: &[u8]) -> Result<PairInfo, String> {
    let info: PairInfo = serde_json::from_slice(bytes).map_err(|_| PAIR_FAILED.to_string())?;
    info.check()?;
    Ok(info)
}

// ── Les trames sur le fil ────────────────────────────────────────────────────

/// Écrit une trame : 2 octets de longueur puis le contenu.
pub fn write_frame(w: &mut impl Write, bytes: &[u8]) -> Result<(), String> {
    let len = u16::try_from(bytes.len()).map_err(|_| "trame trop longue".to_string())?;
    w.write_all(&len.to_be_bytes()).and_then(|_| w.write_all(bytes)).and_then(|_| w.flush()).map_err(|e| format!("envoi interrompu : {e}"))
}

/// Lit une trame (65 535 octets au plus, par construction).
pub fn read_frame(r: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut len = [0u8; 2];
    r.read_exact(&mut len).map_err(|e| format!("réception interrompue : {e}"))?;
    let mut buf = vec![0u8; usize::from(u16::from_be_bytes(len))];
    r.read_exact(&mut buf).map_err(|e| format!("réception interrompue : {e}"))?;
    Ok(buf)
}

/// Envoie un message chiffré.
pub fn send(w: &mut impl Write, ch: &mut Channel, msg: &Msg) -> Result<(), String> {
    let sealed = ch.seal_msg(msg)?;
    write_frame(w, &sealed)
}

/// Reçoit un message chiffré (vérifié).
pub fn recv(r: &mut impl Read, ch: &mut Channel) -> Result<Msg, String> {
    let frame = read_frame(r)?;
    ch.open_msg(&frame)
}

/// Côté appelant : choisit le mode « échange » et fait la poignée de main IK.
pub fn client_session<S: Read + Write>(s: &mut S, me: &Keys, peer_public: &[u8; 32]) -> Result<Channel, String> {
    let (hs, first) = session_start(me, peer_public)?;
    s.write_all(&[MODE_SESSION]).map_err(|e| format!("connexion impossible : {e}"))?;
    write_frame(s, &first)?;
    let reply = read_frame(s)?;
    session_finish(hs, &reply)
}

/// Côté appelé, après avoir lu l'octet de mode « S ».
pub fn server_session<S: Read + Write>(s: &mut S, me: &Keys, known: impl Fn(&[u8; 32]) -> bool) -> Result<(Channel, [u8; 32]), String> {
    let first = read_frame(s)?;
    let (ch, reply, peer) = session_accept(me, &first, known)?;
    write_frame(s, &reply)?;
    Ok((ch, peer))
}

/// Côté A (qui tape le code) : tout l'appairage sur une connexion.
pub fn client_pair<S: Read + Write>(s: &mut S, code: &str, me: &Keys, info: PairInfo) -> Result<Paired, String> {
    let (mut p, first) = Pairing::initiator(code, me, info);
    s.write_all(&[MODE_PAIR]).map_err(|e| format!("connexion impossible : {e}"))?;
    write_frame(s, &first)?;
    while !p.is_done() {
        let incoming = read_frame(s).map_err(|_| PAIR_FAILED.to_string())?;
        if let Some(out) = p.receive(&incoming)? {
            write_frame(s, &out)?;
        }
    }
    p.result().cloned().ok_or_else(|| PAIR_FAILED.into())
}

/// Côté B (qui affiche le code), après avoir lu l'octet de mode « P ».
pub fn server_pair<S: Read + Write>(s: &mut S, code: &str, me: &Keys, info: PairInfo) -> Result<Paired, String> {
    let mut p = Pairing::responder(code, me, info);
    while !p.is_done() {
        let incoming = read_frame(s).map_err(|_| PAIR_FAILED.to_string())?;
        if let Some(out) = p.receive(&incoming)? {
            write_frame(s, &out)?;
        }
    }
    p.result().cloned().ok_or_else(|| PAIR_FAILED.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver, Sender};

    fn info(name: &str) -> PairInfo {
        PairInfo { name: name.into(), color: "#4da3ff".into(), mascot: "goutte-gomme".into(), mine: false }
    }

    /// Fait tourner un appairage en mémoire : A tape `code_a`, B affiche `code_b`.
    fn pair(code_a: &str, code_b: &str) -> (Result<Paired, String>, Result<Paired, String>, Keys, Keys) {
        let (ka, kb) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let (mut a, mut to_b) = Pairing::initiator(code_a, &ka, info("Alice"));
        let mut b = Pairing::responder(code_b, &kb, info("Bob"));
        let mut err_a = None;
        let mut err_b = None;
        // Au plus quelques allers-retours ; on s'arrête à la première erreur.
        for _ in 0..4 {
            let to_a = match b.receive(&to_b) {
                Ok(Some(m)) => m,
                Ok(None) => break,
                Err(e) => {
                    err_b = Some(e);
                    break;
                }
            };
            match a.receive(&to_a) {
                Ok(Some(m)) => to_b = m,
                Ok(None) => break,
                Err(e) => {
                    err_a = Some(e);
                    break;
                }
            }
        }
        let ra = a.result().cloned().ok_or_else(|| err_a.unwrap_or_else(|| "A pas fini".into()));
        let rb = b.result().cloned().ok_or_else(|| err_b.unwrap_or_else(|| "B pas fini".into()));
        (ra, rb, ka, kb)
    }

    #[test]
    fn keys_survive_the_credential_manager() {
        let k = Keys::generate().unwrap();
        let back = Keys::from_private_hex(&k.private_hex()).unwrap();
        // La clé publique recalculée est bien celle que Noise utilise.
        assert_eq!(back.public, k.public);
        assert_eq!(fingerprint(&k.public).len(), 16);
        assert!(Keys::from_private_hex("zz").is_err());
        assert!(!format!("{k:?}").contains(&k.private_hex()));
    }

    #[test]
    fn pairing_with_the_right_code_exchanges_keys_and_cards() {
        let (ra, rb, ka, kb) = pair("482913", "482913");
        let (ra, rb) = (ra.unwrap(), rb.unwrap());
        assert_eq!(ra.peer_public, kb.public);
        assert_eq!(rb.peer_public, ka.public);
        assert_eq!(ra.info.name, "Bob");
        assert_eq!(rb.info.name, "Alice");
    }

    #[test]
    fn pairing_with_a_wrong_code_fails_on_both_sides() {
        let (ra, rb, _, _) = pair("482913", "482914");
        assert!(ra.is_err());
        assert!(rb.is_err());
    }

    #[test]
    fn a_failed_pairing_never_gets_a_second_try() {
        let kb = Keys::generate().unwrap();
        let mut b = Pairing::responder("111111", &kb, info("Bob"));
        assert!(b.receive(b"n'importe quoi").is_err());
        let (_, good) = Pairing::initiator("111111", &Keys::generate().unwrap(), info("Alice"));
        assert!(b.receive(&good).is_err(), "après une erreur, plus rien n'est accepté");
    }

    #[test]
    fn pairing_rejects_a_bad_card() {
        let (ka, kb) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let bad = PairInfo { name: "\u{202E}evil".into(), ..info("x") };
        let (mut a, m1) = Pairing::initiator("123456", &ka, bad);
        let mut b = Pairing::responder("123456", &kb, info("Bob"));
        let m2 = b.receive(&m1).unwrap().unwrap();
        let m3 = a.receive(&m2).unwrap().unwrap();
        let m4 = b.receive(&m3).unwrap().unwrap();
        let m5 = a.receive(&m4).unwrap().unwrap();
        assert!(b.receive(&m5).is_err());
        assert!(b.result().is_none());
    }

    /// Une poignée de main IK en mémoire.
    fn session(known_by_b: bool) -> Result<(Channel, Channel), String> {
        let (ka, kb) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let (hs, first) = session_start(&ka, &kb.public)?;
        let a_pub = ka.public;
        let (cb, reply, peer) = session_accept(&kb, &first, |k| known_by_b && *k == a_pub)?;
        assert_eq!(peer, ka.public);
        let ca = session_finish(hs, &reply)?;
        Ok((ca, cb))
    }

    #[test]
    fn colleagues_talk_encrypted_both_ways() {
        let (mut a, mut b) = session(true).unwrap();
        let sealed = a.seal_msg(&Msg::Ping { kind: "wave".into() }).unwrap();
        assert!(!String::from_utf8_lossy(&sealed).contains("wave"), "rien en clair");
        assert_eq!(b.open_msg(&sealed).unwrap(), Msg::Ping { kind: "wave".into() });
        let back = b.seal_chunk(b"donnees").unwrap();
        assert_eq!(a.open_packet(&back).unwrap(), Packet::Chunk(b"donnees".to_vec()));
    }

    #[test]
    fn an_unknown_caller_is_refused() {
        assert!(session(false).is_err());
    }

    #[test]
    fn a_tampered_or_replayed_message_is_refused() {
        let (mut a, mut b) = session(true).unwrap();
        let mut sealed = a.seal_msg(&Msg::Ok).unwrap();
        sealed[3] ^= 1;
        assert!(b.open_msg(&sealed).is_err());
        let (mut a, mut b) = session(true).unwrap();
        let sealed = a.seal_msg(&Msg::Ok).unwrap();
        assert!(b.open_msg(&sealed).is_ok());
        assert!(b.open_msg(&sealed).is_err(), "le même message rejoué est refusé");
    }

    #[test]
    fn calling_the_wrong_key_fails() {
        let (ka, kb, kc) = (Keys::generate().unwrap(), Keys::generate().unwrap(), Keys::generate().unwrap());
        // A croit parler à B, mais C répond (et accepterait n'importe qui).
        let (_, first) = session_start(&ka, &kb.public).unwrap();
        assert!(session_accept(&kc, &first, |_| true).is_err());
    }

    #[test]
    fn messages_are_checked() {
        let poll = |n: usize| Msg::Poll { id: 1, question: "Pizza ou sushi ?".into(), choices: vec!["Pizza".into(); n] };
        assert!(poll(1).check().is_err());
        assert!(poll(2).check().is_ok());
        assert!(poll(4).check().is_ok());
        assert!(poll(5).check().is_err());
        assert!(Msg::Ping { kind: "rm -rf".into() }.check().is_err());
        assert!(Msg::Visit { note: "a\u{7}".into() }.check().is_err());
        assert!(Msg::Text { id: 1, text: "ligne 1\nligne 2".into() }.check().is_ok());
        assert!(Msg::Text { id: 1, text: "x".repeat(MAX_TEXT + 1) }.check().is_err());
        assert!(Msg::Text { id: 1, text: "  ".into() }.check().is_err());
        assert!(Msg::Pomodoro { minutes: 500 }.check().is_err());
        assert!(Msg::Vote { id: 1, choice: 7 }.check().is_err());
        assert!(Msg::FileEnd { sha256: "abc".into() }.check().is_err());
        let hello = Hello { name: "Simon".into(), color: "#ff0000".into(), mascot: "goutte-gomme".into(), status: "focus".into(), status_text: String::new(), version: "1.2.2".into(), battery: None, visits: true };
        assert!(Msg::Hello(hello.clone()).check().is_ok());
        assert!(Msg::Hello(Hello { status: "root".into(), ..hello.clone() }).check().is_err());
        assert!(Msg::Hello(Hello { color: "red".into(), ..hello }).check().is_err());
    }

    #[test]
    fn a_message_that_does_not_pass_is_not_sent_either() {
        let (mut a, _) = session(true).unwrap();
        assert!(a.seal_msg(&Msg::Ping { kind: "nope".into() }).is_err());
        assert!(a.seal_chunk(&vec![0u8; CHUNK + 1]).is_err());
    }

    #[test]
    fn received_file_names_are_made_safe() {
        assert_eq!(safe_file_name("rapport.pdf"), "rapport.pdf");
        assert_eq!(safe_file_name("..\\..\\Windows\\system32\\evil.dll"), "evil.dll");
        assert_eq!(safe_file_name("../../.bashrc"), "bashrc");
        assert_eq!(safe_file_name("C:\\a\\b.txt"), "b.txt");
        assert_eq!(safe_file_name("doc.txt:cache.exe"), "doc.txt_cache.exe");
        assert_eq!(safe_file_name("CON"), "_CON");
        assert_eq!(safe_file_name("nul.txt"), "_nul.txt");
        assert_eq!(safe_file_name("photo.jpg. . "), "photo.jpg");
        assert_eq!(safe_file_name("fac\u{202E}fdp.exe"), "fac_fdp.exe");
        assert_eq!(safe_file_name(""), "fichier");
        assert_eq!(safe_file_name("..."), "fichier");
        let long = format!("{}.docx", "a".repeat(300));
        let safe = safe_file_name(&long);
        assert!(safe.chars().count() <= MAX_FILE_NAME);
        assert!(safe.ends_with(".docx"));
    }

    #[test]
    fn discovery_packets() {
        let me = Announce::me("0123456789abcdef", "Simon", "#4da3ff");
        assert_eq!(Announce::parse(&me.encode()), Some(me));
        assert!(Announce::parse(&Announce::query().encode()).unwrap().query);
        assert!(Announce::parse(b"{\"ondine\":\"autre\"}").is_none());
        assert!(Announce::parse(&Announce::me("xyz", "Simon", "#4da3ff").encode()).is_none());
        assert!(Announce::parse(&Announce::me("0123456789abcdef", "", "#4da3ff").encode()).is_none());
        assert!(Announce::parse(&vec![b' '; MAX_ANNOUNCE + 1]).is_none());
    }

    #[test]
    fn pair_codes() {
        for _ in 0..50 {
            let c = new_pair_code().unwrap();
            assert_eq!(c.len(), 6);
            assert!(c.bytes().all(|b| b.is_ascii_digit()));
        }
        assert_eq!(clean_pair_code(" 482 913 "), Some("482913".into()));
        assert_eq!(clean_pair_code("482-913"), Some("482913".into()));
        assert_eq!(clean_pair_code("48291"), None);
        assert_eq!(clean_pair_code("48291a"), None);
    }

    // ── Les mêmes échanges, à travers de vrais flux (lecture / écriture) ──

    /// Un « câble » en mémoire : ce qu'un bout écrit, l'autre le lit.
    struct Pipe {
        tx: Sender<Vec<u8>>,
        rx: Receiver<Vec<u8>>,
        buf: Vec<u8>,
    }

    fn cable() -> (Pipe, Pipe) {
        let (t1, r1) = channel();
        let (t2, r2) = channel();
        (Pipe { tx: t1, rx: r2, buf: Vec::new() }, Pipe { tx: t2, rx: r1, buf: Vec::new() })
    }

    impl Read for Pipe {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.buf.is_empty() {
                match self.rx.recv() {
                    Ok(b) => self.buf = b,
                    Err(_) => return Ok(0),
                }
            }
            let n = out.len().min(self.buf.len());
            out[..n].copy_from_slice(&self.buf[..n]);
            self.buf.drain(..n);
            Ok(n)
        }
    }

    impl Write for Pipe {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.tx.send(b.to_vec()).map_err(|_| std::io::Error::from(std::io::ErrorKind::BrokenPipe))?;
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn pairing_then_a_file_over_streams() {
        let (ka, kb) = (Keys::generate().unwrap(), Keys::generate().unwrap());
        let (mut ca, mut cb) = cable();
        let kb2 = kb.clone();
        let server = std::thread::spawn(move || {
            let mut mode = [0u8; 1];
            cb.read_exact(&mut mode).unwrap();
            assert_eq!(mode[0], MODE_PAIR);
            server_pair(&mut cb, "654321", &kb2, info("Bob")).map(|p| (p, cb))
        });
        let paired = client_pair(&mut ca, "654321", &ka, PairInfo { mine: true, ..info("Alice") }).unwrap();
        let (paired_b, _) = server.join().unwrap().unwrap();
        assert_eq!(paired.peer_public, kb.public);
        assert!(paired_b.info.mine);

        // Une session : A envoie un fichier de 150 Ko en morceaux.
        let (mut ca, mut cb) = cable();
        let (a_pub, kb2) = (ka.public, kb.clone());
        let server = std::thread::spawn(move || {
            let mut mode = [0u8; 1];
            cb.read_exact(&mut mode).unwrap();
            assert_eq!(mode[0], MODE_SESSION);
            let (mut ch, peer) = server_session(&mut cb, &kb2, |k| *k == a_pub).unwrap();
            assert_eq!(peer, a_pub);
            let Msg::FileStart { size } = recv(&mut cb, &mut ch).unwrap() else { panic!("FileStart attendu") };
            let mut data = Vec::new();
            while (data.len() as u64) < size {
                match ch.open_packet(&read_frame(&mut cb).unwrap()).unwrap() {
                    Packet::Chunk(c) => data.extend(c),
                    Packet::Msg(_) => panic!("morceau attendu"),
                }
            }
            let Msg::FileEnd { sha256 } = recv(&mut cb, &mut ch).unwrap() else { panic!("FileEnd attendu") };
            assert_eq!(sha256, to_hex(&Sha256::digest(&data)));
            send(&mut cb, &mut ch, &Msg::Ok).unwrap();
            data.len()
        });
        let mut ch = client_session(&mut ca, &ka, &kb.public).unwrap();
        let file: Vec<u8> = (0..150_000u32).map(|i| (i % 251) as u8).collect();
        send(&mut ca, &mut ch, &Msg::FileStart { size: file.len() as u64 }).unwrap();
        for c in file.chunks(CHUNK) {
            write_frame(&mut ca, &ch.seal_chunk(c).unwrap()).unwrap();
        }
        send(&mut ca, &mut ch, &Msg::FileEnd { sha256: to_hex(&Sha256::digest(&file)) }).unwrap();
        assert_eq!(recv(&mut ca, &mut ch).unwrap(), Msg::Ok);
        assert_eq!(server.join().unwrap(), 150_000);
    }

    #[test]
    fn a_stranger_cannot_open_a_session() {
        let (ka, kb, stranger) = (Keys::generate().unwrap(), Keys::generate().unwrap(), Keys::generate().unwrap());
        let (mut ca, mut cb) = cable();
        let (a_pub, b_pub) = (ka.public, kb.public);
        let server = std::thread::spawn(move || {
            let mut mode = [0u8; 1];
            cb.read_exact(&mut mode).unwrap();
            server_session(&mut cb, &kb, |k| *k == a_pub).is_ok()
        });
        // L'inconnu connaît la clé publique de B (une clé publique n'est pas un secret).
        let (_hs, first) = session_start(&stranger, &b_pub).unwrap();
        ca.write_all(&[MODE_SESSION]).unwrap();
        write_frame(&mut ca, &first).unwrap();
        drop(ca);
        assert!(!server.join().unwrap());
    }
}
