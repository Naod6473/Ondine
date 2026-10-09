// Le système de modules, côté Rust.
//
// Un module = un manifeste JSON (partagé avec le front) + éventuellement du code
// Rust qui implémente le trait `RustModule`. Le front n'appelle jamais une
// fonction Rust d'un module directement : il passe par UNE commande Tauri,
// `module_invoke(module, command, args)`, qui vérifie dans l'ordre :
//   1. que le module existe et est activé dans les réglages ;
//   2. qu'il n'a pas été mis à l'écart après trop de plantages ;
//   3. que la commande est déclarée dans son manifeste ;
// puis l'appelle à l'intérieur de `catch_unwind` : une panique dans un module
// devient une erreur, l'île continue.
//
// Ajouter un module Rust : voir docs/ARCHITECTURE.md, « Ajouter un module ».

mod agenda;
mod agents;
mod askclaude;
// Les fournisseurs d'IA de « Parler à Ondine » : Claude, OpenAI, Gemini.
mod askclaude_providers;
// Ses outils de fichiers : chercher, lire, créer, proposer.
mod askclaude_tools;
mod capture;
mod clipboard;
mod controls;
mod launcher;
mod media;
mod nettools;
mod rules;
mod notes;
mod remote;
// Wake-on-LAN des Accès distants : paquet magique, adresses MAC.
mod remote_wol;
mod shelf;
// « Vers le téléphone » de l'Étagère : un petit serveur web le temps d'un envoi.
mod shelf_phone;
// Étagère → cible « Empreinte » : SHA-256 (ou l'algorithme d'une empreinte copiée).
mod shelf_hash;
mod shelf_tools;
mod system;
mod terminal;
mod clipboard_qr;
mod weather;
// Le bilan de la semaine (Pomodoros, concentration, tâches cochées).
mod weekly;
// Installer les hooks d'Ondine dans la configuration de Claude Code, Codex, Gemini.
mod agents_hooks;
// Le bilan de fin de tâche d'un agent (ce qui a changé dans le dépôt git).
mod agents_git;
// « Reprendre » : la dernière session de Claude Code d'un projet.
mod agents_resume;
mod agents_usage;
// L'historique des agents gardé 7 jours (fichier agents-history.json).
mod agents_history;
// Le calendrier de contributions GitHub de l'onglet Agents IA.
mod agents_github;
// Les autres outils (Copilot CLI, Cursor, Qwen Code, Goose…), « Autre outil ».
mod agents_tools;
// Les outils MCP note / étagère / capture / ouvrir (vérifications).
mod agents_mcp_extra;
// Les rappels d'attente.
mod agents_wait;

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use crate::services::bus::{self, BusMessage};
use crate::services::{credentials, log, privacy, undo};

/// Après ce nombre de plantages, le module est mis à l'écart jusqu'au redémarrage.
const MAX_FAILURES: u32 = 3;

/// Les permissions qu'un module peut demander. Toute autre valeur est refusée.
pub const KNOWN_PERMISSIONS: &[&str] = &["files", "clipboard", "network", "claude-api", "credentials"];

/// La partie du manifeste dont le Rust a besoin (le front lit le reste : nom,
/// icône, vues, schéma de réglages…).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub commands: Vec<String>,
    #[serde(default)]
    pub events: Events,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Events {
    #[serde(default)]
    pub emits: Vec<String>,
    #[serde(default)]
    pub listens: Vec<String>,
}

/// Ce qu'un module Rust doit (ou peut) implémenter.
pub trait RustModule: Send + Sync {
    /// Le texte de manifest.json, en général `include_str!(...)`.
    fn manifest_json(&self) -> &'static str;

    /// Appelée une fois au démarrage de l'île, pour un module qui a besoin de
    /// travailler en fond (un thread qui surveille quelque chose). Le thread doit
    /// vérifier `is_active` avant chaque tour et rattraper ses propres paniques.
    fn start(&self, app: &AppHandle) {
        let _ = app;
    }

    /// Une commande déclarée dans le manifeste est appelée par le front.
    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let _ = (ctx, args);
        Err(format!("commande non gérée : {command}"))
    }

    /// Un message du bus correspond à un sujet listé dans `events.listens`.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        let _ = (ctx, msg);
    }
}

/// Ce que l'île met à disposition d'un module. Chaque accès sensible vérifie
/// d'abord la permission correspondante du manifeste.
pub struct ModuleContext<'a> {
    pub app: &'a AppHandle,
    pub manifest: &'a Manifest,
}

impl ModuleContext<'_> {
    pub fn id(&self) -> &str {
        &self.manifest.id
    }

    /// Erreur si le manifeste ne déclare pas cette permission.
    pub fn require(&self, permission: &str) -> Result<(), String> {
        if self.manifest.permissions.iter().any(|p| p == permission) {
            Ok(())
        } else {
            Err(format!("le module {} n'a pas la permission « {permission} »", self.id()))
        }
    }

    /// Publie sur le bus. Le sujet doit être déclaré dans `events.emits`.
    pub fn emit(&self, topic: &str, payload: Value) {
        if !self.manifest.events.emits.iter().any(|p| bus::matches(p, topic)) {
            log::warn(format!("{} publie « {topic} » sans l'avoir déclaré : ignoré", self.id()));
            return;
        }
        bus::emit(self.app, self.id(), topic, payload);
    }

    /// Les réglages de ce module (tels qu'enregistrés ; le front y a mis les valeurs par défaut).
    pub fn settings(&self) -> Map<String, Value> {
        let shared = self.app.state::<crate::Shared>();
        let s = shared.settings.locked();
        s.modules.get(self.id()).map(|m| m.values.clone()).unwrap_or_default()
    }

    /// Valide un chemin de fichier (permission "files" + dossiers exclus).
    pub fn check_path(&self, raw: &str) -> Result<std::path::PathBuf, String> {
        self.require("files")?;
        let shared = self.app.state::<crate::Shared>();
        let s = shared.settings.locked();
        privacy::check_path(&s, raw)
    }

    /// Lit un identifiant (permission "credentials"). Ne jamais le renvoyer au front.
    pub fn credential(&self, key: &str) -> Result<Option<String>, String> {
        self.require("credentials")?;
        Ok(credentials::get(key))
    }

    /// Propose « Annuler » pendant quelques secondes.
    pub fn offer_undo(&self, label: &str, window: Duration, undo: undo::UndoFn) -> u64 {
        let service = self.app.state::<undo::UndoService>();
        service.offer(self.app, self.id(), label, window, undo)
    }

    pub fn log_info(&self, message: impl AsRef<str>) {
        log::write(log::Level::Info, self.id(), message.as_ref());
    }

    pub fn log_warn(&self, message: impl AsRef<str>) {
        log::write(log::Level::Warn, self.id(), message.as_ref());
    }
}

struct Entry {
    manifest: Manifest,
    module: Box<dyn RustModule>,
    failures: AtomicU32,
}

/// Tous les modules Rust connus. Gardé dans l'état de Tauri (`app.manage`).
pub struct Registry {
    entries: Vec<Entry>,
}

/// Infos renvoyées au front au démarrage.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModuleStatus {
    pub id: String,
    pub crashed: bool,
}

impl Registry {
    /// La liste des modules Rust. AJOUTER UN MODULE = ajouter une ligne ici.
    pub fn new() -> Self {
        let modules: Vec<Box<dyn RustModule>> = vec![
            Box::new(shelf::Shelf::default()),
            Box::new(media::Media::default()),
            Box::new(clipboard::Clipboard::default()),
            Box::new(capture::Capture::default()),
            Box::new(notes::Notes::default()),
            Box::new(agenda::Agenda::default()),
            Box::new(terminal::Terminal),
            Box::new(rules::Rules::default()),
            Box::new(launcher::Launcher::default()),
            Box::new(system::SystemInfo::default()),
            Box::new(remote::Remote::default()),
            Box::new(nettools::NetTools::default()),
            Box::new(controls::Controls),
            Box::new(agents::Agents::default()),
            Box::new(askclaude::AskClaude::default()),
            Box::new(weather::WeatherModule::default()),
            Box::new(weekly::Weekly::default()),
        ];

        let mut entries = Vec::new();
        for module in modules {
            match check_manifest(module.manifest_json()) {
                Ok(manifest) => entries.push(Entry { manifest, module, failures: AtomicU32::new(0) }),
                Err(err) => log::error(format!("module refusé : {err}")),
            }
        }
        Self { entries }
    }

    /// Lance le travail de fond des modules (`RustModule::start`). Un module qui
    /// panique ici est compté comme un plantage, les autres démarrent quand même.
    pub fn start_all(&self, app: &AppHandle) {
        for entry in &self.entries {
            if catch_unwind(AssertUnwindSafe(|| entry.module.start(app))).is_err() {
                record_failure(app, entry, "démarrage");
            }
        }
    }

    pub fn statuses(&self) -> Vec<ModuleStatus> {
        self.entries
            .iter()
            .map(|e| ModuleStatus { id: e.manifest.id.clone(), crashed: e.failures.load(Ordering::Relaxed) >= MAX_FAILURES })
            .collect()
    }

    fn find(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.manifest.id == id)
    }
}

/// Lit un manifeste et refuse ce qui n'est pas valide (permissions inconnues…).
fn check_manifest(text: &str) -> Result<Manifest, String> {
    let m: Manifest = serde_json::from_str(text).map_err(|e| format!("manifeste illisible : {e}"))?;
    let id_ok = !m.id.is_empty() && m.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !id_ok {
        return Err(format!("id de module invalide : {:?}", m.id));
    }
    if let Some(p) = m.permissions.iter().find(|p| !KNOWN_PERMISSIONS.contains(&p.as_str())) {
        return Err(format!("{} : permission inconnue « {p} »", m.id));
    }
    Ok(m)
}

fn enabled(app: &AppHandle, id: &str) -> bool {
    app.state::<crate::Shared>().settings.locked().module_enabled(id)
}

/// Le module est-il activé ET pas mis à l'écart ? Pour les threads de fond.
pub fn is_active(app: &AppHandle, id: &str) -> bool {
    let Some(registry) = app.try_state::<Registry>() else { return false };
    let Some(entry) = registry.find(id) else { return false };
    enabled(app, id) && entry.failures.load(Ordering::Relaxed) < MAX_FAILURES
}

/// Pour un thread de fond : appelle `f` avec le contexte du module (permissions,
/// réglages, annulation…). Ne fait rien (None) si le module est inactif.
pub fn with_context<R>(app: &AppHandle, id: &str, f: impl FnOnce(&ModuleContext) -> R) -> Option<R> {
    if !is_active(app, id) {
        return None;
    }
    let registry = app.try_state::<Registry>()?;
    let entry = registry.find(id)?;
    let ctx = ModuleContext { app, manifest: &entry.manifest };
    Some(f(&ctx))
}

/// Note un plantage ; au-delà de MAX_FAILURES, le module est mis à l'écart.
fn record_failure(app: &AppHandle, entry: &Entry, what: &str) {
    let n = entry.failures.fetch_add(1, Ordering::Relaxed) + 1;
    log::error(format!("le module {} a planté ({what}), {n}/{MAX_FAILURES}", entry.manifest.id));
    bus::emit(
        app,
        "island",
        "module.crashed",
        json!({ "module": entry.manifest.id, "failures": n, "disabled": n >= MAX_FAILURES }),
    );
}

/// Appelée par la commande Tauri `module_invoke`.
pub fn invoke(app: &AppHandle, module: &str, command: &str, args: Value) -> Result<Value, String> {
    let registry = app.state::<Registry>();
    let entry = registry.find(module).ok_or_else(|| format!("module inconnu : {module}"))?;
    if !enabled(app, module) {
        return Err(format!("le module {module} est désactivé"));
    }
    if entry.failures.load(Ordering::Relaxed) >= MAX_FAILURES {
        return Err(format!("le module {module} a été mis à l'écart après plusieurs plantages"));
    }
    if !entry.manifest.commands.iter().any(|c| c == command) {
        return Err(format!("{module} ne déclare pas la commande « {command} »"));
    }
    let ctx = ModuleContext { app, manifest: &entry.manifest };
    match catch_unwind(AssertUnwindSafe(|| entry.module.invoke(&ctx, command, args))) {
        Ok(result) => result,
        Err(_) => {
            record_failure(app, entry, command);
            Err(format!("le module {module} a planté pendant « {command} »"))
        }
    }
}

/// Appelée par le bus pour chaque message : le donne aux modules qui l'écoutent.
pub fn dispatch_event(app: &AppHandle, msg: &BusMessage) {
    let Some(registry) = app.try_state::<Registry>() else { return };
    for entry in &registry.entries {
        let id = entry.manifest.id.as_str();
        // Le Rust d'un module n'entend pas ce qu'il vient de publier lui-même
        // (évite les boucles). Il entend en revanche son propre front.
        let own_echo = msg.origin == "rust" && msg.source == id;
        if own_echo || !entry.manifest.events.listens.iter().any(|p| bus::matches(p, &msg.topic)) {
            continue;
        }
        if !enabled(app, id) || entry.failures.load(Ordering::Relaxed) >= MAX_FAILURES {
            continue;
        }
        let ctx = ModuleContext { app, manifest: &entry.manifest };
        if catch_unwind(AssertUnwindSafe(|| entry.module.on_event(&ctx, msg))).is_err() {
            record_failure(app, entry, &msg.topic);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shelf_manifest_is_valid() {
        let m = check_manifest(shelf::Shelf::default().manifest_json()).unwrap();
        assert_eq!(m.id, "shelf");
    }

    #[test]
    fn media_manifest_is_valid() {
        let m = check_manifest(media::Media::default().manifest_json()).unwrap();
        assert_eq!(m.id, "media");
    }

    #[test]
    fn clipboard_manifest_is_valid() {
        let m = check_manifest(clipboard::Clipboard::default().manifest_json()).unwrap();
        assert_eq!(m.id, "clipboard");
    }

    #[test]
    fn capture_manifest_is_valid() {
        let m = check_manifest(capture::Capture::default().manifest_json()).unwrap();
        assert_eq!(m.id, "capture");
    }

    #[test]
    fn notes_manifest_is_valid() {
        let m = check_manifest(notes::Notes::default().manifest_json()).unwrap();
        assert_eq!(m.id, "notes");
    }

    #[test]
    fn agenda_manifest_is_valid() {
        let m = check_manifest(agenda::Agenda::default().manifest_json()).unwrap();
        assert_eq!(m.id, "agenda");
    }

    #[test]
    fn launcher_manifest_is_valid() {
        let m = check_manifest(launcher::Launcher::default().manifest_json()).unwrap();
        assert_eq!(m.id, "launcher");
    }

    #[test]
    fn askclaude_manifest_is_valid() {
        let m = check_manifest(askclaude::AskClaude::default().manifest_json()).unwrap();
        assert_eq!(m.id, "askclaude");
    }

    #[test]
    fn agents_manifest_is_valid() {
        let m = check_manifest(agents::Agents::default().manifest_json()).unwrap();
        assert_eq!(m.id, "agents");
    }

    #[test]
    fn nettools_manifest_is_valid() {
        let m = check_manifest(nettools::NetTools::default().manifest_json()).unwrap();
        assert_eq!(m.id, "nettools");
    }

    #[test]
    fn remote_manifest_is_valid() {
        let m = check_manifest(remote::Remote::default().manifest_json()).unwrap();
        assert_eq!(m.id, "remote");
    }

    #[test]
    fn system_manifest_is_valid() {
        let m = check_manifest(system::SystemInfo::default().manifest_json()).unwrap();
        assert_eq!(m.id, "system");
    }

    #[test]
    fn terminal_manifest_is_valid() {
        let m = check_manifest(terminal::Terminal.manifest_json()).unwrap();
        assert_eq!(m.id, "terminal");
    }

    #[test]
    fn rules_manifest_is_valid() {
        let m = check_manifest(rules::Rules::default().manifest_json()).unwrap();
        assert_eq!(m.id, "rules");
    }

    #[test]
    fn weekly_manifest_is_valid() {
        let m = check_manifest(weekly::Weekly::default().manifest_json()).unwrap();
        assert_eq!(m.id, "weekly");
        assert!(m.events.listens.iter().any(|t| t == "timer.work-session"));
        assert!(m.events.listens.iter().any(|t| t == "notes.todo-toggled"));
    }

    #[test]
    fn unknown_permission_is_refused() {
        let text = r#"{ "id": "x", "name": "X", "version": "1", "permissions": ["root"] }"#;
        assert!(check_manifest(text).is_err());
    }
}
