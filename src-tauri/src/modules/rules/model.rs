// Ce qu'est une règle : « Quand … (si …) alors … ».
//
// Ce fichier ne fait que DÉCRIRE et VÉRIFIER (pas de fichiers touchés ici) :
// les formes enregistrées dans rules.json, la validation à l'enregistrement,
// et les petites fonctions pures (conditions, renommage) qui ont leurs tests.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Les sujets du bus qu'une règle peut écouter (déclencheur « événement »).
/// Liste fermée : une règle ne peut pas écouter n'importe quoi.
pub const EVENT_TOPICS: &[(&str, &str)] = &[
    ("capture.done", "une capture est terminée"),
    ("timer.done", "un minuteur ou une séance Pomodoro se termine"),
    ("agenda.reminder", "un rendez-vous approche"),
    ("task.finished", "une tâche est terminée (copie, to-do cochée…)"),
];

pub const MAX_NAME: usize = 60;
pub const MAX_ACTIONS: usize = 8;
pub const MAX_RULES: usize = 50;
pub const MAX_TEXT: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Trigger {
    /// Un nouveau fichier arrive dans `folder` (et ses sous-dossiers si demandé).
    File {
        folder: String,
        #[serde(default)]
        subfolders: bool,
    },
    /// Un lecteur est branché (`removed` = false) ou débranché.
    Drive {
        #[serde(default)]
        removed: bool,
    },
    /// Un raccourci clavier global, ex. "Ctrl+Alt+V".
    Hotkey { keys: String },
    /// Un événement de l'île (voir EVENT_TOPICS).
    Event { topic: String },
    /// Un agent IA (Claude Code, Codex…) a fini (`waiting` = false) ou attend une réponse.
    Agent {
        #[serde(default)]
        waiting: bool,
    },
    /// À une heure donnée ("12:00"), certains jours (0 = lundi … 6 = dimanche ;
    /// vide = tous les jours). Avec `folder` : la règle agit sur chaque fichier
    /// de ce dossier qui remplit les conditions (ex. « plus vieux que 30 jours »).
    Schedule {
        time: String,
        #[serde(default)]
        days: Vec<u8>,
        #[serde(default)]
        folder: String,
    },
    /// Le réseau change. (Point d'extension : « un nouvel appareil sur le
    /// réseau » viendra avec le scanner du module Réseau.)
    Network { change: NetChange },
    /// La batterie passe sous `below` %.
    Battery { below: u8 },
    /// Le PC est branché sur secteur (`plugged` = true) ou débranché.
    Power {
        #[serde(default = "yes")]
        plugged: bool,
    },
    /// La session Windows est déverrouillée : on revient devant le PC.
    Unlock,
    /// Le presse-papiers contient un lien, une adresse e-mail, un code, ou un texte.
    Clipboard {
        kind: ClipKind,
        /// Pour `ClipKind::Text` : le texte cherché (sans tenir compte de la casse).
        #[serde(default)]
        text: String,
    },
    /// Une musique démarre (Musique : passe à « en lecture »).
    Music,
}

/// Ce qui change sur le réseau.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetChange {
    InternetDown,
    InternetUp,
    VpnUp,
    VpnDown,
}

/// Ce qu'on cherche dans le presse-papiers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipKind {
    Link,
    Email,
    /// Un code de vérification : 4 à 8 chiffres (« 123 456 » compris).
    Code,
    Text,
}

/// Les conditions (toutes facultatives ; vides = toujours vrai).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Conditions {
    /// Extensions acceptées, sans le point : ["pdf", "docx"]. Vide = toutes.
    pub extensions: Vec<String>,
    /// Le nom du fichier (ou du lecteur) contient ce texte (sans tenir compte de la casse).
    pub name_contains: String,
    /// Taille minimale / maximale en Ko.
    pub min_kb: Option<u64>,
    pub max_kb: Option<u64>,
    /// Seulement ces jours (0 = lundi … 6 = dimanche). Vide = tous. Toutes les règles.
    pub days: Vec<u8>,
    /// Seulement entre ces heures ("09:00" → "18:00" ; "22:00" → "06:00" passe
    /// minuit). Vides = toute la journée. Toutes les règles.
    pub from: String,
    pub to: String,
    /// Le fichier n'a pas été modifié depuis au moins ce nombre de jours
    /// (avec le déclencheur horaire sur un dossier).
    pub older_than_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    /// Déplacer le fichier dans un dossier.
    Move { to: String },
    /// Copier le fichier dans un dossier.
    Copy { to: String },
    /// Renommer avec un modèle : {nom}, {date}, {heure}, {ext} (voir `rename`).
    Rename { pattern: String },
    /// Envoyer à la Corbeille (jamais de suppression définitive).
    Trash,
    /// Poser sur l'étagère de l'île.
    Shelf,
    /// Montrer dans l'Explorateur.
    Reveal,
    /// Ouvrir un terminal (dans le dossier du fichier, ou à la racine du lecteur).
    Terminal,
    /// Afficher une notification de l'île ({nom} = le nom du fichier ou du lecteur).
    Notify { text: String },
    /// Ouvrir l'île sur un onglet.
    OpenIsland {
        #[serde(default)]
        tab: String,
    },
    /// Lancer un minuteur.
    Timer { minutes: u32 },
    /// Coller le presse-papiers sans mise en forme.
    PastePlain,
    /// Ajouter une note, ou une to-do si `todo` ({nom} remplacé).
    AddNote {
        text: String,
        #[serde(default)]
        todo: bool,
    },
    /// Décompresser une archive .zip dans un dossier (un sous-dossier à son
    /// nom), puis le poser sur l'étagère si `shelf`.
    Unzip {
        to: String,
        #[serde(default)]
        shelf: bool,
    },
    /// Copier le chemin complet (ou seulement le nom) dans le presse-papiers.
    CopyPath {
        #[serde(default, rename = "nameOnly")]
        name_only: bool,
    },
    /// La mascotte : danser, montrer une expression, ou tenir une pancarte.
    Mascot {
        gesture: Gesture,
        /// L'expression (gesture = emote), ex. "laugh".
        #[serde(default)]
        emotion: String,
        /// Le texte de la pancarte (gesture = sign), {nom} remplacé.
        #[serde(default)]
        text: String,
    },
    /// Mode Calme / Ne pas déranger de l'île pendant `minutes`.
    Quiet { minutes: u32 },
}

/// Ce que fait la mascotte.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Gesture {
    Dance,
    Emote,
    Sign,
}

/// Les expressions qu'une règle peut demander (liste fermée).
pub const EMOTIONS: &[&str] = &[
    "happy", "love", "laugh", "surprised", "celebrate", "starstruck", "wink", "sad", "worried", "sleep", "stretch", "yawn", "sunglasses",
    "relieved", "listening", "panic",
];

impl Action {
    /// L'action agit-elle sur un fichier (et n'a donc de sens qu'avec un
    /// déclencheur « fichier ») ?
    pub fn needs_file(&self) -> bool {
        matches!(self, Action::Move { .. } | Action::Copy { .. } | Action::Rename { .. } | Action::Trash | Action::Unzip { .. })
    }

    /// A-t-elle besoin d'un chemin (fichier ou lecteur) ?
    pub fn needs_path(&self) -> bool {
        self.needs_file() || matches!(self, Action::Shelf | Action::Reveal | Action::CopyPath { .. })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    #[serde(default)]
    pub id: u64,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub trigger: Trigger,
    #[serde(default)]
    pub conditions: Conditions,
    pub actions: Vec<Action>,
}

fn yes() -> bool {
    true
}

/// Vérifications qui ne touchent pas au disque (les dossiers, eux, sont
/// vérifiés par `check_path` dans mod.rs). Renvoie un message clair.
impl Trigger {
    /// Le déclencheur donne-t-il un fichier à chaque fois ?
    pub fn gives_file(&self) -> bool {
        match self {
            Trigger::File { .. } => true,
            Trigger::Schedule { folder, .. } => !folder.trim().is_empty(),
            _ => false,
        }
    }
}

pub fn validate(rule: &Rule) -> Result<(), String> {
    if rule.name.trim().is_empty() {
        return Err("donnez un nom à la règle".into());
    }
    if rule.name.chars().count() > MAX_NAME {
        return Err(format!("nom trop long (au plus {MAX_NAME} caractères)"));
    }
    if rule.actions.is_empty() {
        return Err("ajoutez au moins une action".into());
    }
    if rule.actions.len() > MAX_ACTIONS {
        return Err(format!("au plus {MAX_ACTIONS} actions par règle"));
    }
    let gives_file = rule.trigger.gives_file();
    let has_path = gives_file || matches!(rule.trigger, Trigger::Drive { removed: false });
    for a in &rule.actions {
        if a.needs_file() && !gives_file {
            return Err("déplacer, copier, renommer, décompresser ou mettre à la Corbeille : seulement avec un fichier".into());
        }
        if a.needs_path() && !has_path {
            return Err("étagère et Explorateur : seulement avec un fichier ou un lecteur branché".into());
        }
        match a {
            Action::Notify { text } if text.trim().is_empty() || text.chars().count() > MAX_TEXT => {
                return Err(format!("le texte de la notification doit faire de 1 à {MAX_TEXT} caractères"));
            }
            Action::Timer { minutes } if !(1..=180).contains(minutes) => {
                return Err("minuteur : de 1 à 180 minutes".into());
            }
            Action::Rename { pattern } => check_pattern(pattern)?,
            Action::OpenIsland { tab } if tab.len() > 40 => return Err("onglet inconnu".into()),
            Action::AddNote { text, .. } if text.trim().is_empty() || text.chars().count() > MAX_TEXT => {
                return Err(format!("le texte de la note doit faire de 1 à {MAX_TEXT} caractères"));
            }
            Action::Unzip { to, .. } if to.trim().is_empty() => return Err("choisissez où décompresser l'archive".into()),
            Action::Move { to } | Action::Copy { to } if to.trim().is_empty() => return Err("choisissez le dossier de destination".into()),
            Action::Mascot { gesture: Gesture::Emote, emotion, .. } if !EMOTIONS.contains(&emotion.as_str()) => {
                return Err("expression inconnue".into());
            }
            Action::Mascot { gesture: Gesture::Sign, text, .. } if text.trim().is_empty() || text.chars().count() > 40 => {
                return Err("le texte de la pancarte doit faire de 1 à 40 caractères".into());
            }
            Action::Quiet { minutes } if !(1..=240).contains(minutes) => return Err("Calme : de 1 à 240 minutes".into()),
            _ => {}
        }
    }
    // Après une mise à la Corbeille, il n'y a plus de fichier sur lequel agir.
    if let Some(i) = rule.actions.iter().position(|a| *a == Action::Trash) {
        if rule.actions[i + 1..].iter().any(Action::needs_path) {
            return Err("après « Corbeille », plus aucune action sur le fichier n'est possible".into());
        }
    }
    match &rule.trigger {
        Trigger::Event { topic } if !EVENT_TOPICS.iter().any(|(t, _)| t == topic) => Err(format!("événement inconnu : {topic}")),
        Trigger::Hotkey { keys } => check_keys(keys),
        Trigger::File { folder, .. } if folder.trim().is_empty() => Err("choisissez le dossier à surveiller".into()),
        Trigger::Schedule { time, days, .. } => {
            if parse_hm(time).is_none() {
                Err("heure invalide (exemple : 12:00)".into())
            } else if days.iter().any(|d| *d > 6) {
                Err("jour invalide".into())
            } else {
                Ok(())
            }
        }
        Trigger::Battery { below } if !(5..=95).contains(below) => Err("batterie : un seuil de 5 à 95 %".into()),
        Trigger::Clipboard { kind: ClipKind::Text, text } if text.trim().chars().count() < 2 || text.chars().count() > MAX_NAME => {
            Err(format!("presse-papiers : un texte de 2 à {MAX_NAME} caractères"))
        }
        _ => Ok(()),
    }
    .and_then(|_| {
        for ext in &rule.conditions.extensions {
            if ext.is_empty() || ext.len() > 10 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err(format!("extension invalide : « {ext} »"));
            }
        }
        let c = &rule.conditions;
        if c.name_contains.chars().count() > MAX_NAME {
            return Err("texte du nom trop long".into());
        }
        if c.days.iter().any(|d| *d > 6) {
            return Err("jour invalide".into());
        }
        // Les deux heures vont ensemble.
        match (c.from.trim().is_empty(), c.to.trim().is_empty()) {
            (true, true) => {}
            (false, false) if parse_hm(&c.from).is_some() && parse_hm(&c.to).is_some() => {}
            _ => return Err("plage horaire invalide (exemple : de 09:00 à 18:00)".into()),
        }
        if let Some(d) = c.older_than_days {
            if !(1..=3650).contains(&d) {
                return Err("âge du fichier : de 1 à 3650 jours".into());
            }
            if !matches!(rule.trigger, Trigger::Schedule { .. }) {
                return Err("l'âge du fichier va avec le déclencheur « à une heure donnée » sur un dossier".into());
            }
        }
        Ok(())
    })
}

/// Un raccourci doit contenir Ctrl, Alt ou Windows : un raccourci global sur
/// une simple lettre (ou Maj+lettre) empêcherait d'écrire cette lettre partout.
pub fn check_keys(keys: &str) -> Result<(), String> {
    let parts: Vec<String> = keys.split('+').map(|p| p.trim().to_ascii_lowercase()).collect();
    if parts.len() < 2 || parts.iter().any(String::is_empty) {
        return Err("raccourci invalide (exemple : Ctrl+Alt+V)".into());
    }
    let strong = ["ctrl", "control", "alt", "super", "cmdorctrl", "commandorcontrol"];
    if !parts[..parts.len() - 1].iter().any(|p| strong.contains(&p.as_str())) {
        return Err("le raccourci doit contenir Ctrl, Alt ou Windows".into());
    }
    // Le même lecteur que celui qui réservera le raccourci (touche Windows = « Super »).
    keys.parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map(|_| ())
        .map_err(|_| format!("raccourci non reconnu : {keys}"))
}

/// Le modèle de renommage : pas de séparateur de dossier ni de caractère
/// interdit par Windows (le nom reste dans le même dossier).
pub fn check_pattern(pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() || pattern.chars().count() > 120 {
        return Err("modèle de nom vide ou trop long".into());
    }
    if pattern.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) {
        return Err("le modèle de nom contient un caractère interdit (/ \\ : * ? \" < > |)".into());
    }
    Ok(())
}

/// Ce qu'on sait du fichier (ou du lecteur) qui a déclenché la règle.
pub struct Subject<'a> {
    /// Nom affiché : « facture.pdf », ou « KINGSTON (E:) ».
    pub name: &'a str,
    /// Extension en minuscules, sans le point ("" pour un lecteur).
    pub ext: &'a str,
    /// Taille en octets (None pour un lecteur).
    pub size: Option<u64>,
    /// Jours depuis la dernière modification (None : pas un fichier).
    pub age_days: Option<u64>,
}

/// Les conditions sont-elles remplies ?
pub fn matches(c: &Conditions, s: &Subject) -> bool {
    if !c.extensions.is_empty() && !c.extensions.iter().any(|e| e.eq_ignore_ascii_case(s.ext)) {
        return false;
    }
    let needle = c.name_contains.trim().to_lowercase();
    if !needle.is_empty() && !s.name.to_lowercase().contains(&needle) {
        return false;
    }
    if let Some(size) = s.size {
        let kb = size / 1024;
        if c.min_kb.is_some_and(|m| kb < m) || c.max_kb.is_some_and(|m| kb > m) {
            return false;
        }
    }
    if let Some(min) = c.older_than_days {
        if s.age_days.is_none_or(|age| age < u64::from(min)) {
            return false;
        }
    }
    true
}

/// "12:00" → 720 (minutes depuis minuit). "7:5", "24:00", "12h00" : refusés.
pub fn parse_hm(text: &str) -> Option<u32> {
    let (h, m) = text.trim().split_once(':')?;
    if h.is_empty() || h.len() > 2 || m.len() != 2 || !h.chars().chain(m.chars()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Le moment présent remplit-il les conditions de jour et d'heure ?
/// `weekday` : 0 = lundi … 6 = dimanche ; `minutes` : depuis minuit.
pub fn in_time_window(c: &Conditions, weekday: u8, minutes: u32) -> bool {
    if !c.days.is_empty() && !c.days.contains(&weekday) {
        return false;
    }
    let (Some(from), Some(to)) = (parse_hm(&c.from), parse_hm(&c.to)) else { return true };
    if from <= to {
        (from..to).contains(&minutes)
    } else {
        // « De 22:00 à 06:00 » : passe minuit.
        minutes >= from || minutes < to
    }
}

/// Le déclencheur horaire doit-il partir ? À l'heure dite, ou jusqu'à 5 min
/// après (un PC qui sort de veille à 12:03 fait encore la règle de 12:00),
/// une seule fois par jour (`done_today`).
pub fn schedule_due(time: &str, days: &[u8], weekday: u8, minutes: u32, done_today: bool) -> bool {
    let Some(at) = parse_hm(time) else { return false };
    !done_today && (days.is_empty() || days.contains(&weekday)) && minutes >= at && minutes - at < 5
}

/// Ce que le presse-papiers contient du genre demandé : le premier lien,
/// la première adresse e-mail, le code, ou le texte entier s'il contient
/// `needle`. Rien au-delà de 10 000 caractères (on ne fouille pas un roman).
pub fn clip_match(kind: ClipKind, needle: &str, text: &str) -> Option<String> {
    if text.len() > 10_000 {
        return None;
    }
    let words = || text.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '(' | ')' | '[' | ']'));
    let trim = |w: &str| w.trim_end_matches(['.', ',', ';', ':', '!', '?', '\'']).to_string();
    match kind {
        ClipKind::Link => words()
            .find(|w| {
                let l = w.to_ascii_lowercase();
                (l.starts_with("https://") || l.starts_with("http://") || l.starts_with("www.")) && w.len() > 10
            })
            .map(trim),
        ClipKind::Email => words().map(trim).find(|w| is_email(w)),
        ClipKind::Code => {
            // Le texte entier (court) : « 123456 », « 123 456 », « 123-456 ».
            let t = text.trim();
            let digits: String = t.chars().filter(char::is_ascii_digit).collect();
            let only = t.chars().all(|c| c.is_ascii_digit() || c == ' ' || c == '-');
            (only && (4..=8).contains(&digits.len()) && t.len() <= 10).then_some(digits)
        }
        ClipKind::Text => {
            let n = needle.trim().to_lowercase();
            (!n.is_empty() && text.to_lowercase().contains(&n)).then(|| text.trim().chars().take(MAX_TEXT).collect())
        }
    }
}

/// Une adresse e-mail plausible : « nom@domaine.ext ».
fn is_email(w: &str) -> bool {
    let Some((user, domain)) = w.split_once('@') else { return false };
    let ok = |c: char| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '+');
    !user.is_empty()
        && user.chars().all(ok)
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-'))
        && domain.rsplit('.').next().is_some_and(|tld| tld.chars().count() >= 2)
}

/// Le lundi 00:00 (heure locale) de la semaine de `now_ms`, en ms : le début
/// de « cette semaine » pour le compteur de déclenchements.
/// `weekday` : 0 = lundi ; `ms_since_midnight` : heure locale du moment.
pub fn week_start(now_ms: u64, weekday: u8, ms_since_midnight: u64) -> u64 {
    now_ms.saturating_sub(u64::from(weekday) * 86_400_000 + ms_since_midnight)
}

/// Le nouveau nom d'un fichier : « {date} {nom} » + extension d'origine.
/// {nom} = le nom sans extension, {date} = 2026-10-05, {heure} = 14h30,
/// {ext} = l'extension. L'extension est toujours gardée (ajoutée à la fin).
pub fn rename(pattern: &str, path: &Path, date: &str, time: &str) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    let base = pattern
        .replace("{nom}", &stem)
        .replace("{date}", date)
        .replace("{heure}", time)
        .replace("{ext}", &ext);
    // Un modèle qui produirait un nom vide (ou que des espaces) garde l'ancien.
    let base = if base.trim().is_empty() { stem } else { base.trim().to_string() };
    if ext.is_empty() { base } else { format!("{base}.{ext}") }
}

/// Le texte d'une notification, avec {nom} remplacé.
pub fn fill(text: &str, name: &str) -> String {
    text.replace("{nom}", name)
}

/// Comme `fill`, avec aussi {date} (2026-10-05) et {heure} (14h30).
pub fn fill_all(text: &str, name: &str, date: &str, time: &str) -> String {
    fill(text, name).replace("{date}", date).replace("{heure}", time)
}

/// Les fichiers à ne pas traiter : téléchargements en cours, fichiers
/// temporaires d'Office, fichiers cachés « ~$… ».
pub fn is_temporary(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    name.starts_with("~$")
        || name.starts_with(".~")
        || name == "desktop.ini"
        || name == "thumbs.db"
        || matches!(ext.as_str(), "crdownload" | "part" | "partial" | "download" | "tmp" | "temp" | "opdownload")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(trigger: Trigger, actions: Vec<Action>) -> Rule {
        Rule { id: 1, name: "Test".into(), enabled: true, trigger, conditions: Conditions::default(), actions }
    }

    fn downloads() -> Trigger {
        Trigger::File { folder: r"C:\Users\Simon\Downloads".into(), subfolders: false }
    }

    #[test]
    fn json_shape_is_readable() {
        let json = r#"{ "name": "PDF", "trigger": { "type": "file", "folder": "C:\\D" },
            "conditions": { "extensions": ["pdf"] },
            "actions": [ { "type": "move", "to": "C:\\PDF" }, { "type": "notify", "text": "{nom} rangé" } ] }"#;
        let r: Rule = serde_json::from_str(json).unwrap();
        assert!(r.enabled);
        assert_eq!(r.actions.len(), 2);
        assert!(validate(&r).is_ok());
    }

    #[test]
    fn file_actions_need_a_file_trigger() {
        let r = rule(Trigger::Hotkey { keys: "Ctrl+Alt+M".into() }, vec![Action::Move { to: "C:\\x".into() }]);
        assert!(validate(&r).is_err());
        let r = rule(Trigger::Drive { removed: false }, vec![Action::Reveal, Action::Terminal]);
        assert!(validate(&r).is_ok());
        let r = rule(Trigger::Drive { removed: true }, vec![Action::Reveal]);
        assert!(validate(&r).is_err());
    }

    #[test]
    fn nothing_on_the_file_after_trash() {
        let r = rule(downloads(), vec![Action::Trash, Action::Shelf]);
        assert!(validate(&r).is_err());
        let r = rule(downloads(), vec![Action::Trash, Action::Notify { text: "{nom} jeté".into() }]);
        assert!(validate(&r).is_ok());
    }

    #[test]
    fn hotkeys_need_a_strong_modifier() {
        assert!(check_keys("Ctrl+Alt+V").is_ok());
        assert!(check_keys("Super+T").is_ok());
        assert!(check_keys("Ctrl+Alt+KeyV").is_ok());
        assert!(check_keys("Ctrl+Alt+Nimporte").is_err());
        assert!(check_keys("Shift+A").is_err());
        assert!(check_keys("A").is_err());
        assert!(check_keys("Ctrl++").is_err());
    }

    #[test]
    fn unknown_event_is_refused() {
        let r = rule(Trigger::Event { topic: "clipboard.changed".into() }, vec![Action::Notify { text: "x".into() }]);
        assert!(validate(&r).is_err());
    }

    #[test]
    fn conditions() {
        let c = Conditions { extensions: vec!["pdf".into()], name_contains: "Facture".into(), min_kb: Some(10), ..Default::default() };
        let s = |name, ext, size| Subject { name, ext, size: Some(size), age_days: Some(0) };
        assert!(matches(&c, &s("facture-octobre.PDF", "pdf", 50_000)));
        assert!(!matches(&c, &s("facture.docx", "docx", 50_000)));
        assert!(!matches(&c, &s("facture.pdf", "pdf", 2_000)));
        assert!(matches(&Conditions::default(), &Subject { name: "KINGSTON (E:)", ext: "", size: None, age_days: None }));
    }

    #[test]
    fn rename_patterns() {
        let p = Path::new("dossier/facture.pdf");
        assert_eq!(rename("{date} {nom}", p, "2026-10-05", "14h30"), "2026-10-05 facture.pdf");
        assert_eq!(rename("   ", p, "d", "h"), "facture.pdf");
        assert!(check_pattern("../x").is_err());
        assert!(check_pattern("a:b").is_err());
        assert!(check_pattern("{date} - {nom}").is_ok());
    }

    #[test]
    fn file_age() {
        let c = Conditions { older_than_days: Some(30), ..Default::default() };
        let s = |age| Subject { name: "a.zip", ext: "zip", size: Some(1), age_days: age };
        assert!(matches(&c, &s(Some(30))));
        assert!(matches(&c, &s(Some(400))));
        assert!(!matches(&c, &s(Some(29))));
        assert!(!matches(&c, &s(None)));
        // L'âge ne va qu'avec le déclencheur horaire.
        let mut r = rule(downloads(), vec![Action::Trash]);
        r.conditions.older_than_days = Some(30);
        assert!(validate(&r).is_err());
        r.trigger = Trigger::Schedule { time: "17:00".into(), days: vec![4], folder: r"C:\D".into() };
        assert!(validate(&r).is_ok());
        r.conditions.older_than_days = Some(0);
        assert!(validate(&r).is_err());
    }

    #[test]
    fn hours_and_days() {
        assert_eq!(parse_hm("12:00"), Some(720));
        assert_eq!(parse_hm("7:05"), Some(425));
        assert_eq!(parse_hm("23:59"), Some(1439));
        assert_eq!(parse_hm("24:00"), None);
        assert_eq!(parse_hm("12h00"), None);
        assert_eq!(parse_hm("7:5"), None);
        assert_eq!(parse_hm(""), None);

        let office = Conditions { days: vec![0, 1, 2, 3, 4], from: "09:00".into(), to: "18:00".into(), ..Default::default() };
        assert!(in_time_window(&office, 0, 9 * 60));
        assert!(in_time_window(&office, 4, 17 * 60 + 59));
        assert!(!in_time_window(&office, 4, 18 * 60));
        assert!(!in_time_window(&office, 5, 12 * 60)); // samedi
        let night = Conditions { from: "22:00".into(), to: "06:00".into(), ..Default::default() };
        assert!(in_time_window(&night, 6, 23 * 60));
        assert!(in_time_window(&night, 6, 60));
        assert!(!in_time_window(&night, 6, 12 * 60));
        assert!(in_time_window(&Conditions::default(), 3, 0));

        // Une seule heure sur deux : refusé.
        let mut r = rule(Trigger::Unlock, vec![Action::Notify { text: "x".into() }]);
        r.conditions.from = "09:00".into();
        assert!(validate(&r).is_err());
        r.conditions.to = "18:00".into();
        assert!(validate(&r).is_ok());
        r.conditions.days = vec![7];
        assert!(validate(&r).is_err());
    }

    #[test]
    fn schedule() {
        assert!(schedule_due("12:00", &[], 2, 720, false));
        assert!(schedule_due("12:00", &[], 2, 724, false));
        assert!(!schedule_due("12:00", &[], 2, 725, false));
        assert!(!schedule_due("12:00", &[], 2, 719, false));
        assert!(!schedule_due("12:00", &[], 2, 720, true));
        assert!(schedule_due("17:00", &[4], 4, 1020, false));
        assert!(!schedule_due("17:00", &[4], 3, 1020, false));
        let r = rule(Trigger::Schedule { time: "25:00".into(), days: vec![], folder: String::new() }, vec![Action::Timer { minutes: 5 }]);
        assert!(validate(&r).is_err());
        // Sans dossier, pas d'action sur un fichier.
        let r = rule(Trigger::Schedule { time: "12:00".into(), days: vec![], folder: String::new() }, vec![Action::Trash]);
        assert!(validate(&r).is_err());
    }

    #[test]
    fn clipboard_patterns() {
        use ClipKind::*;
        assert_eq!(clip_match(Link, "", "Regarde https://exemple.fr/page?x=1, c'est bien").as_deref(), Some("https://exemple.fr/page?x=1"));
        assert_eq!(clip_match(Link, "", "(www.ondine.app/aide)").as_deref(), Some("www.ondine.app/aide"));
        assert_eq!(clip_match(Link, "", "pas de lien ici"), None);
        assert_eq!(clip_match(Email, "", "Écris à simon.v+test@exemple.fr.").as_deref(), Some("simon.v+test@exemple.fr"));
        assert_eq!(clip_match(Email, "", "@twitter ou a@b"), None);
        assert_eq!(clip_match(Email, "", "x@y.c"), None);
        assert_eq!(clip_match(Code, "", " 123 456 ").as_deref(), Some("123456"));
        assert_eq!(clip_match(Code, "", "4821").as_deref(), Some("4821"));
        assert_eq!(clip_match(Code, "", "123"), None);
        assert_eq!(clip_match(Code, "", "Votre code est 123456"), None);
        assert_eq!(clip_match(Code, "", "06 12 34 56 78"), None);
        assert_eq!(clip_match(Text, "facture", "Votre FACTURE d'octobre").as_deref(), Some("Votre FACTURE d'octobre"));
        assert_eq!(clip_match(Text, "facture", "rien"), None);
        assert_eq!(clip_match(Link, "", &"https://a.fr ".repeat(2000)), None);
    }

    #[test]
    fn week_counter_start() {
        // Mercredi (2) à 10:00 : le lundi 00:00 est 2 jours et 10 h plus tôt.
        let now = 1_000_000_000_000;
        assert_eq!(week_start(now, 2, 10 * 3_600_000), now - 2 * 86_400_000 - 10 * 3_600_000);
        assert_eq!(week_start(now, 0, 0), now);
    }

    #[test]
    fn new_actions_are_checked() {
        let agent = || Trigger::Agent { waiting: false };
        assert!(validate(&rule(agent(), vec![Action::Mascot { gesture: Gesture::Dance, emotion: String::new(), text: String::new() }])).is_ok());
        assert!(validate(&rule(agent(), vec![Action::Mascot { gesture: Gesture::Emote, emotion: "rm -rf".into(), text: String::new() }])).is_err());
        assert!(validate(&rule(agent(), vec![Action::Mascot { gesture: Gesture::Sign, emotion: String::new(), text: " ".into() }])).is_err());
        assert!(validate(&rule(agent(), vec![Action::Quiet { minutes: 0 }])).is_err());
        assert!(validate(&rule(agent(), vec![Action::AddNote { text: "{nom} a fini".into(), todo: true }])).is_ok());
        assert!(validate(&rule(agent(), vec![Action::CopyPath { name_only: false }])).is_err());
        assert!(validate(&rule(agent(), vec![Action::Unzip { to: "C:\\x".into(), shelf: true }])).is_err());
        assert!(validate(&rule(downloads(), vec![Action::Unzip { to: "C:\\x".into(), shelf: true }, Action::CopyPath { name_only: true }])).is_ok());
        assert!(validate(&rule(downloads(), vec![Action::Unzip { to: " ".into(), shelf: false }])).is_err());
        assert!(validate(&rule(Trigger::Battery { below: 2 }, vec![Action::Notify { text: "x".into() }])).is_err());
        assert!(validate(&rule(Trigger::Clipboard { kind: ClipKind::Text, text: "a".into() }, vec![Action::Notify { text: "x".into() }])).is_err());
        // Formes JSON des nouveaux déclencheurs.
        let t: Trigger = serde_json::from_str(r#"{ "type": "unlock" }"#).unwrap();
        assert_eq!(t, Trigger::Unlock);
        let t: Trigger = serde_json::from_str(r#"{ "type": "network", "change": "internetDown" }"#).unwrap();
        assert_eq!(t, Trigger::Network { change: NetChange::InternetDown });
        let t: Trigger = serde_json::from_str(r#"{ "type": "power" }"#).unwrap();
        assert_eq!(t, Trigger::Power { plugged: true });
        let a: Action = serde_json::from_str(r#"{ "type": "copyPath", "nameOnly": true }"#).unwrap();
        assert_eq!(a, Action::CopyPath { name_only: true });
        let c: Conditions = serde_json::from_str(r#"{ "olderThanDays": 30, "days": [4], "from": "", "to": "" }"#).unwrap();
        assert_eq!(c.older_than_days, Some(30));
    }

    #[test]
    fn fill_with_date() {
        assert_eq!(fill_all("{nom} le {date} à {heure}", "Claude", "2026-10-10", "12h00"), "Claude le 2026-10-10 à 12h00");
        let p = Path::new("photo.jpg");
        assert_eq!(rename("{nom} {date} {heure}", p, "2026-10-10", "09h05"), "photo 2026-10-10 09h05.jpg");
    }

    #[test]
    fn temporary_files_are_skipped() {
        assert!(is_temporary(Path::new("film.mkv.crdownload")));
        assert!(is_temporary(Path::new("~$rapport.docx")));
        assert!(!is_temporary(Path::new("rapport.docx")));
    }
}
