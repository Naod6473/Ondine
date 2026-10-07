// Les réglages : %APPDATA%\Ondine\settings.json
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
pub const CURRENT_VERSION: u32 = 2;

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
    /// Les profils (« Travail », « Maison »…) : voir profiles.rs.
    pub profiles: crate::services::profiles::Profiles,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct General {
    /// "primary" = écran principal, "cursor" = l'écran où se trouve la souris.
    pub screen: String,
    /// "error", "warn", "info" ou "debug".
    pub log_level: String,
    /// La langue de l'interface : "auto" (celle choisie à l'installation, sinon
    /// celle de Windows), "fr" ou "en".
    pub language: String,
    /// Vrai une fois le petit mot de bienvenue montré (premier démarrage).
    pub welcomed: bool,
    /// Mode démo : l'île montre de fausses données (captures d'écran, vidéo).
    /// Tout se passe dans l'interface ; le Rust ne fait que garder le choix.
    pub demo: bool,
    /// Chercher une nouvelle version au démarrage (puis chaque jour) et la proposer.
    pub auto_update: bool,
    /// Lancer Ondine à l'ouverture de session Windows.
    pub autostart: bool,
    /// Le rythme des boucles : "high", "balanced" ou "eco" (voir services/perf.rs).
    pub perf_mode: String,
    /// Sur batterie (PC débranché) : mode "eco", quel que soit `perf_mode`.
    pub eco_on_battery: bool,
    /// En français : "vous" (vouvoyer, par défaut) ou "tu" (tutoyer). L'interface
    /// le fait seule (src/core/i18n.ts) ; voir `tutoie` pour les textes du Rust.
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IslandPrefs {
    /// L'île se replie quand la souris n'est plus dessus depuis ce nombre de secondes.
    pub collapse_secs: f64,
    /// Durée d'affichage par défaut d'une notification.
    pub notification_secs: f64,
    /// L'ordre des onglets (ids de modules) choisi par l'utilisateur ; vide =
    /// l'ordre d'origine. Un module absent de la liste se met après les autres.
    pub tab_order: Vec<String>,
    /// Le bord de l'écran où vit l'île : "top", "left" ou "right".
    pub edge: String,
    /// Sa place le long de ce bord : "start" (coin haut ou gauche), "center"
    /// (à `offset`), "end" (coin bas ou droit).
    pub align: String,
    /// Pour "center" : la position du centre de l'île le long du bord, de 0 à 1.
    pub offset: f64,
    /// Le thème de couleurs (voir src/island/themes.ts), "custom" = `color`.
    pub theme: String,
    /// La couleur choisie pour le thème "custom" (#rrggbb).
    pub color: String,
    /// Petits sons de clic, et leur volume (0 à 1).
    pub sounds: bool,
    pub sound_volume: f64,
    /// Raccourci clavier global qui ouvre l'île ("" = aucun).
    pub hotkey: String,
    /// Mode présentation : pendant un partage d'écran ou un plein écran, l'île
    /// se cache et garde les notifications pour après.
    pub presentation_quiet: bool,
    /// Le pack d'icônes : "color" (dessinées en couleur) ou "line" (au trait, sobres).
    pub icon_pack: String,
    /// L'île reste en mini (la pilule) au lieu de disparaître.
    pub always_mini: bool,
    /// Le style des animations : "classic" (sobre) ou "studio" (façon vidéo de
    /// présentation : flou → net, chiffres qui roulent, boutons en gélatine).
    pub motion: String,
}

fn default_motion() -> String {
    "classic".into()
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
    /// Ondine vient de temps en temps pendre au bord de l'écran quand on ne fait rien.
    pub peek: bool,
    /// Au plus une visite toutes les… (minutes).
    pub peek_every_mins: f64,
    /// Les surprises cachées (src/eggs/) : "all" (toutes), "seasonal" (le
    /// calendrier seulement) ou "none".
    pub surprises: String,
    /// Le carnet des trésors : les ids des surprises déjà trouvées.
    pub treasures: Vec<String>,
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
            profiles: Default::default(),
        }
    }
}

impl Default for General {
    fn default() -> Self {
        Self { screen: "primary".into(), log_level: "info".into(), language: "auto".into(), welcomed: false, demo: false, auto_update: true, autostart: true, perf_mode: "balanced".into(), eco_on_battery: true, address: "vous".into() }
    }
}

impl Default for IslandPrefs {
    fn default() -> Self {
        Self {
            collapse_secs: 1.5,
            notification_secs: 6.0,
            tab_order: Vec::new(),
            edge: "top".into(),
            align: "center".into(),
            offset: 0.5,
            theme: "nuit".into(),
            color: "#0c0d12".into(),
            sounds: true,
            sound_volume: 0.5,
            hotkey: "Ctrl+Alt+O".into(),
            presentation_quiet: true,
            icon_pack: "color".into(),
            always_mini: true,
            motion: default_motion(),
        }
    }
}

impl Default for MascotPrefs {
    fn default() -> Self {
        Self { enabled: true, id: "goutte-gomme".into(), bored_after_secs: 60.0, sleep_after_secs: 180.0, peek: true, peek_every_mins: 5.0, surprises: "all".into(), treasures: Vec::new() }
    }
}

// Écrit à la main (et pas « #[derive(Default)] ») : tests/front/settings.test.ts
// lit ces blocs « impl Default » pour comparer les valeurs par défaut du Rust
// et du front.
#[allow(clippy::derivable_impls)]
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
    /// Remet dans les clous les valeurs venues d'un fichier (abîmé, ou modifié à
    /// la main) : un bord inconnu redevient « en haut », un nombre hors limites
    /// est ramené dans ses bornes.
    pub fn sanitize(&mut self) {
        if !["color", "line"].contains(&self.island.icon_pack.as_str()) {
            self.island.icon_pack = "color".into();
        }
        if !["classic", "studio"].contains(&self.island.motion.as_str()) {
            self.island.motion = default_motion();
        }
        if !["auto", "fr", "en"].contains(&self.general.language.as_str()) {
            self.general.language = "auto".into();
        }
        if !["high", "balanced", "eco"].contains(&self.general.perf_mode.as_str()) {
            self.general.perf_mode = "balanced".into();
        }
        if !["vous", "tu"].contains(&self.general.address.as_str()) {
            self.general.address = "vous".into();
        }
        let i = &mut self.island;
        if !["top", "left", "right"].contains(&i.edge.as_str()) {
            i.edge = "top".into();
        }
        if !["start", "center", "end"].contains(&i.align.as_str()) {
            i.align = "center".into();
        }
        i.offset = if i.offset.is_finite() { i.offset.clamp(0.0, 1.0) } else { 0.5 };
        i.sound_volume = if i.sound_volume.is_finite() { i.sound_volume.clamp(0.0, 1.0) } else { 0.5 };
        let hex = i.color.len() == 7 && i.color.starts_with('#') && i.color[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !hex {
            i.color = "#0c0d12".into();
        }
        i.hotkey = i.hotkey.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '+').take(40).collect();
        let m = &mut self.mascot;
        m.peek_every_mins = if m.peek_every_mins.is_finite() { m.peek_every_mins.clamp(1.0, 120.0) } else { 5.0 };
        if !matches!(m.surprises.as_str(), "all" | "seasonal" | "none") {
            m.surprises = "all".into();
        }
        // Des ids courts ([a-z0-9-]), sans doublon : le carnet ne grossit jamais sans fin.
        let mut seen = std::collections::HashSet::new();
        m.treasures.retain(|t| t.len() <= 32 && !t.is_empty() && t.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && seen.insert(t.clone()));
        m.treasures.truncate(64);
        crate::services::profiles::sanitize(&mut self.profiles);
    }

    /// Un module est actif sauf si l'utilisateur l'a désactivé.
    pub fn module_enabled(&self, id: &str) -> bool {
        self.modules.get(id).map(|m| m.enabled).unwrap_or(true)
    }
}

/// Vrai quand on tutoie l'utilisateur : réglage « Tutoiement » ET interface en
/// français (`lang` : "fr" ou "en", voir `app_language` dans lib.rs).
/// Presque tous les textes du Rust passent par l'interface, qui les tutoie
/// elle-même (dictionnaire src/core/i18n-fr-tu.json) : ceci ne sert qu'aux
/// rares textes qui n'y passent pas (la consigne envoyée à Claude).
pub fn tutoie(general: &General, lang: &str) -> bool {
    lang == "fr" && general.address == "tu"
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
    // Version 1 → 2 : les deux délais de repli (compacte 4 s, agrandie 8 s)
    // deviennent un seul, plus court. On retire les anciens : le nouveau prend
    // sa valeur par défaut.
    if version < 2 {
        if let Some(island) = value.get_mut("island").and_then(Value::as_object_mut) {
            island.remove("compactHideSecs");
            island.remove("expandedCollapseSecs");
        }
    }
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
    let mut settings: Settings = serde_json::from_value(value).map_err(|e| format!("réglages invalides : {e}"))?;
    settings.sanitize();
    Ok(settings)
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

/// Une seule écriture à la fois : deux sauvegardes simultanées (la page et la
/// fin d'un déplacement de l'île, par exemple) écriraient en même temps dans
/// le même fichier temporaire.
static SAVING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Enregistre les réglages. On écrit d'abord un fichier temporaire puis on le
/// renomme : une coupure au milieu ne laisse jamais un fichier à moitié écrit.
/// Les appelants qui modifient `Shared::settings` appellent `save` sans
/// relâcher le verrou de `Shared::settings` : le fichier reçoit alors les
/// réglages dans l'ordre où ils ont été modifiés en mémoire.
pub fn save(settings: &Settings) -> Result<(), String> {
    use crate::sync::LockExt;
    let _one_at_a_time = SAVING.locked();
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = dir().join("settings.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path()).map_err(|e| e.to_string())
}

/// Exporte les réglages dans %APPDATA%\Ondine\exports et renvoie le chemin du fichier.
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
    fn old_collapse_delays_are_replaced() {
        let s = parse(r#"{ "version": 1, "island": { "compactHideSecs": 4, "expandedCollapseSecs": 8, "notificationSecs": 3 } }"#).unwrap();
        assert_eq!(s.island.collapse_secs, 1.5);
        assert_eq!(s.island.notification_secs, 3.0);
        assert_eq!(s.version, CURRENT_VERSION);
    }

    #[test]
    fn tab_order_is_kept_and_optional() {
        assert!(parse(r#"{ "version": 2, "island": { "collapseSecs": 2 } }"#).unwrap().island.tab_order.is_empty());
        let s = parse(r#"{ "version": 2, "island": { "tabOrder": ["notes", "shelf"] } }"#).unwrap();
        assert_eq!(s.island.tab_order, ["notes", "shelf"]);
    }

    #[test]
    fn surprises_and_treasures_are_checked() {
        let s = parse(r#"{ "version": 2 }"#).unwrap();
        assert_eq!(s.mascot.surprises, "all");
        assert!(s.mascot.treasures.is_empty());
        let s = parse(r#"{ "version": 2, "mascot": { "surprises": "lots", "treasures": ["split", "split", "Bad Id", "", "code-rain"] } }"#).unwrap();
        assert_eq!(s.mascot.surprises, "all");
        assert_eq!(s.mascot.treasures, ["split", "code-rain"]);
        assert_eq!(parse(r#"{ "version": 2, "mascot": { "surprises": "none" } }"#).unwrap().mascot.surprises, "none");
    }

    #[test]
    fn newer_schema_is_refused() {
        assert!(parse(r#"{ "version": 999 }"#).is_err());
    }

    #[test]
    fn perf_mode_defaults_and_unknown_value() {
        let s = parse(r#"{ "version": 2 }"#).unwrap();
        assert_eq!(s.general.perf_mode, "balanced");
        assert!(s.general.eco_on_battery);
        let s = parse(r#"{ "version": 2, "general": { "perfMode": "turbo", "ecoOnBattery": false } }"#).unwrap();
        assert_eq!(s.general.perf_mode, "balanced");
        assert!(!s.general.eco_on_battery);
        assert_eq!(parse(r#"{ "version": 2, "general": { "perfMode": "eco" } }"#).unwrap().general.perf_mode, "eco");
    }

    #[test]
    fn address_defaults_to_vous_and_tu_only_in_french() {
        let s = parse(r#"{ "version": 2 }"#).unwrap();
        assert_eq!(s.general.address, "vous");
        assert_eq!(parse(r#"{ "version": 2, "general": { "address": "toi" } }"#).unwrap().general.address, "vous");
        let s = parse(r#"{ "version": 2, "general": { "address": "tu" } }"#).unwrap();
        assert_eq!(s.general.address, "tu");
        assert!(tutoie(&s.general, "fr"));
        assert!(!tutoie(&s.general, "en"));
        assert!(!tutoie(&General::default(), "fr"));
    }

    #[test]
    fn unknown_module_is_enabled() {
        assert!(Settings::default().module_enabled("hello"));
    }
}
