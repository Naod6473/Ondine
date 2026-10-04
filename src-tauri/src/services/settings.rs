// Les réglages : %APPDATA%\Island\settings.json
//
// - Schéma versionné : le champ `version` dit quelle forme a le fichier. Quand la
//   forme change, on augmente CURRENT_VERSION et on ajoute une étape dans `migrate`.
// - Aucun secret ici : les clés vont dans le Gestionnaire d'identifiants (credentials.rs).
// - Les réglages de chaque module sont rangés sous `modules.<id>.values`, sans que
//   Rust ait besoin de les comprendre : le schéma est dans le manifeste du module.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::platform;
use crate::services::log;

/// Version actuelle du schéma des réglages.
pub const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub general: General,
    pub island: IslandPrefs,
    pub mascot: MascotPrefs,
    pub privacy: Privacy,
    /// Réglages par module, indexés par l'id du module.
    pub modules: BTreeMap<String, ModuleSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct General {
    /// "primary" = écran principal, "cursor" = l'écran où se trouve la souris.
    pub screen: String,
    /// "error", "warn", "info" ou "debug".
    pub log_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandPrefs {
    /// compact → hidden quand la souris est partie depuis ce nombre de secondes.
    pub compact_hide_secs: f64,
    /// expanded → compact quand la souris est partie depuis ce nombre de secondes.
    pub expanded_collapse_secs: f64,
    /// Durée d'affichage par défaut d'une notification.
    pub notification_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MascotPrefs {
    pub enabled: bool,
    /// Le dossier de la mascotte dans `mascots/`.
    pub id: String,
    /// Inactivité (secondes) avant `bored`, puis avant `sleep`.
    pub bored_after_secs: f64,
    pub sleep_after_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Privacy {
    /// Dossiers qu'aucun module ne doit lire ni envoyer nulle part.
    pub excluded_folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModuleSettings {
    pub enabled: bool,
    pub values: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            general: General::default(),
            island: IslandPrefs::default(),
            mascot: MascotPrefs::default(),
            privacy: Privacy::default(),
            modules: BTreeMap::new(),
        }
    }
}

impl Default for General {
    fn default() -> Self {
        Self { screen: "primary".into(), log_level: "info".into() }
    }
}

impl Default for IslandPrefs {
    fn default() -> Self {
        Self { compact_hide_secs: 4.0, expanded_collapse_secs: 8.0, notification_secs: 6.0 }
    }
}

impl Default for MascotPrefs {
    fn default() -> Self {
        Self { enabled: true, id: "placeholder".into(), bored_after_secs: 60.0, sleep_after_secs: 180.0 }
    }
}

impl Default for Privacy {
    fn default() -> Self {
        Self { excluded_folders: Vec::new() }
    }
}

impl Default for ModuleSettings {
    fn default() -> Self {
        // Un module jamais vu est activé ; le front complète les valeurs par défaut.
        Self { enabled: true, values: Map::new() }
    }
}

impl Settings {
    /// Un module est actif sauf si l'utilisateur l'a désactivé.
    pub fn module_enabled(&self, id: &str) -> bool {
        self.modules.get(id).map(|m| m.enabled).unwrap_or(true)
    }
}

pub fn dir() -> PathBuf {
    platform::config_dir()
}

fn path() -> PathBuf {
    dir().join("settings.json")
}

/// Fait passer un fichier d'une ancienne version à la version actuelle, étape par étape.
/// Exemple pour plus tard : `if version == 1 { ...renommer un champ...; version = 2 }`.
fn migrate(mut value: Value) -> Result<Value, String> {
    let version = value.get("version").and_then(Value::as_u64).unwrap_or(1) as u32;
    if version > CURRENT_VERSION {
        return Err(format!(
            "ces réglages viennent d'une version plus récente de l'île (schéma {version}, ici {CURRENT_VERSION})"
        ));
    }
    // (aucune migration pour l'instant : la version 1 est la première)
    if let Some(obj) = value.as_object_mut() {
        obj.insert("version".into(), Value::from(CURRENT_VERSION));
    }
    Ok(value)
}

/// Lit, migre et vérifie un texte JSON de réglages.
pub fn parse(text: &str) -> Result<Settings, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("JSON invalide : {e}"))?;
    if !value.is_object() {
        return Err("le fichier ne contient pas un objet de réglages".into());
    }
    let value = migrate(value)?;
    serde_json::from_value(value).map_err(|e| format!("réglages invalides : {e}"))
}

/// Charge les réglages au démarrage. Un fichier abîmé n'est jamais effacé : il est
/// mis de côté (settings.broken-<date>.json) et l'île repart des valeurs par défaut.
pub fn load() -> Settings {
    let text = match std::fs::read_to_string(path()) {
        Ok(t) => t,
        Err(_) => return Settings::default(),
    };
    match parse(&text) {
        Ok(s) => s,
        Err(err) => {
            let aside = dir().join(format!("settings.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(path(), &aside);
            log::warn(format!("réglages illisibles ({err}), mis de côté dans {}", aside.display()));
            Settings::default()
        }
    }
}

/// Enregistre les réglages. On écrit d'abord un fichier temporaire puis on le
/// renomme : une coupure au milieu ne laisse jamais un fichier à moitié écrit.
pub fn save(settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = dir().join("settings.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path()).map_err(|e| e.to_string())
}

/// Exporte les réglages dans %APPDATA%\Island\exports et renvoie le chemin du fichier.
pub fn export(settings: &Settings) -> Result<PathBuf, String> {
    let out_dir = dir().join("exports");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let file = out_dir.join(format!("island-settings-{}.json", platform::local_time().file_stamp()));
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&file, json).map_err(|e| e.to_string())?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_take_defaults() {
        let s = parse(r#"{ "version": 1, "general": { "screen": "cursor" } }"#).unwrap();
        assert_eq!(s.general.screen, "cursor");
        assert_eq!(s.general.log_level, "info");
        assert!(s.mascot.enabled);
    }

    #[test]
    fn newer_schema_is_refused() {
        assert!(parse(r#"{ "version": 999 }"#).is_err());
    }

    #[test]
    fn unknown_module_is_enabled() {
        assert!(Settings::default().module_enabled("hello"));
    }
}
