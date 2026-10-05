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
}

impl Action {
    /// L'action agit-elle sur un fichier (et n'a donc de sens qu'avec un
    /// déclencheur « fichier ») ?
    pub fn needs_file(&self) -> bool {
        matches!(self, Action::Move { .. } | Action::Copy { .. } | Action::Rename { .. } | Action::Trash)
    }

    /// A-t-elle besoin d'un chemin (fichier ou lecteur) ?
    pub fn needs_path(&self) -> bool {
        self.needs_file() || matches!(self, Action::Shelf | Action::Reveal)
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
pub fn validate(rule: &Rule) -> Result<(), String> {
    if rule.name.trim().is_empty() {
        return Err("donne un nom à la règle".into());
    }
    if rule.name.chars().count() > MAX_NAME {
        return Err(format!("nom trop long (au plus {MAX_NAME} caractères)"));
    }
    if rule.actions.is_empty() {
        return Err("ajoute au moins une action".into());
    }
    if rule.actions.len() > MAX_ACTIONS {
        return Err(format!("au plus {MAX_ACTIONS} actions par règle"));
    }
    let has_path = matches!(rule.trigger, Trigger::File { .. } | Trigger::Drive { removed: false });
    for a in &rule.actions {
        if a.needs_file() && !matches!(rule.trigger, Trigger::File { .. }) {
            return Err("déplacer, copier, renommer ou mettre à la Corbeille : seulement quand un fichier arrive".into());
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
        Trigger::File { folder, .. } if folder.trim().is_empty() => Err("choisis le dossier à surveiller".into()),
        _ => Ok(()),
    }
    .and_then(|_| {
        for ext in &rule.conditions.extensions {
            if ext.is_empty() || ext.len() > 10 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err(format!("extension invalide : « {ext} »"));
            }
        }
        if rule.conditions.name_contains.chars().count() > MAX_NAME {
            return Err("texte du nom trop long".into());
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
    true
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
        let c = Conditions { extensions: vec!["pdf".into()], name_contains: "Facture".into(), min_kb: Some(10), max_kb: None };
        assert!(matches(&c, &Subject { name: "facture-octobre.PDF", ext: "pdf", size: Some(50_000) }));
        assert!(!matches(&c, &Subject { name: "facture.docx", ext: "docx", size: Some(50_000) }));
        assert!(!matches(&c, &Subject { name: "facture.pdf", ext: "pdf", size: Some(2_000) }));
        assert!(matches(&Conditions::default(), &Subject { name: "KINGSTON (E:)", ext: "", size: None }));
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
    fn temporary_files_are_skipped() {
        assert!(is_temporary(Path::new("film.mkv.crdownload")));
        assert!(is_temporary(Path::new("~$rapport.docx")));
        assert!(!is_temporary(Path::new("rapport.docx")));
    }
}
