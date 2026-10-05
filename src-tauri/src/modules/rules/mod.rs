// Module « Règles » : « Quand… (si…) alors… ».
//
//   - model.rs : la forme d'une règle, sa validation, les petites fonctions pures ;
//   - watch.rs : le thread qui surveille les dossiers et les lecteurs ;
//   - ce fichier : les commandes, l'exécution des actions, les raccourcis.
//
// Garde-fous (voir ARCHITECTURE.md, « Module Règles ») :
//   - déplacer, renommer, Corbeille : proposent « Annuler » ; jamais de
//     suppression définitive ;
//   - tous les dossiers passent par `check_path` (dossiers exclus respectés) ;
//   - une règle ne repart pas sur les fichiers qu'elle vient de produire ;
//   - plus de 20 déclenchements en une minute : la règle se met en pause ;
//   - l'île ne lance aucun programme choisi par une règle : les actions sont
//     une liste fermée (model.rs) ;
//   - « Tester » décrit ce que la règle ferait, sans rien faire.
//
// Les autres modules sont prévenus par le bus (shelf.add, terminal.open,
// timer.start, clipboard.paste-plain) : aucun appel direct entre modules.

mod model;
mod watch;

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::{self, BusMessage};
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{files, log};
use model::{Action, Rule, Trigger};
use model::{Conditions, Subject};

const ID: &str = "rules";
/// Au-delà de ce nombre de déclenchements en une minute, la règle se met en pause.
const MAX_RUNS_PER_MINUTE: usize = 20;
/// Pendant ce temps, un fichier produit par une règle n'en redéclenche pas.
const PRODUCED_TTL: Duration = Duration::from_secs(30);
const HISTORY_LEN: usize = 40;

/// Ce qui est enregistré dans %APPDATA%\Island\rules.json.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    rules: Vec<Rule>,
    next_id: u64,
    /// « Tout mettre en pause ».
    paused: bool,
}

/// Une ligne de l'historique (en mémoire seulement : jamais écrit sur le disque).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    at: u64,
    rule: String,
    subject: String,
    ok: bool,
    message: String,
}

#[derive(Default)]
struct State {
    saved: Saved,
    history: VecDeque<HistoryEntry>,
    /// Problème actuel d'une règle (dossier introuvable, raccourci déjà pris…).
    errors: HashMap<u64, String>,
    /// Heures des derniers déclenchements, par règle (limite par minute).
    runs: HashMap<u64, VecDeque<Instant>>,
    /// Fichiers produits récemment par une règle (anti-boucle).
    produced: Vec<(PathBuf, Instant)>,
    /// Les raccourcis actuellement réservés par l'île.
    hotkeys: Vec<String>,
}

type Shared = Arc<Mutex<State>>;

/// Les messages pour le thread de surveillance.
enum Msg {
    Fs(notify::Result<notify::Event>),
    /// Les règles ont changé : refaire la surveillance des dossiers.
    Rebuild,
}

#[derive(Default)]
pub struct Rules {
    state: Shared,
    to_watcher: Mutex<Option<Sender<Msg>>>,
}

impl RustModule for Rules {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../../src/modules/rules/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        self.state.lock().unwrap().saved = load();
        let (tx, rx) = std::sync::mpsc::channel();
        *self.to_watcher.lock().unwrap() = Some(tx.clone());
        let (app2, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || watch::run(app2, state, tx, rx));
        apply_hotkeys(app, &self.state);
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "list" => Ok(listing(&self.state.lock().unwrap())),
            "save" => {
                let mut rule: Rule = serde_json::from_value(args.get("rule").cloned().unwrap_or(Value::Null))
                    .map_err(|e| format!("règle illisible : {e}"))?;
                check_rule(ctx, &rule)?;
                let id = {
                    let mut s = self.state.lock().unwrap();
                    if rule.id == 0 {
                        if s.saved.rules.len() >= model::MAX_RULES {
                            return Err(format!("au plus {} règles", model::MAX_RULES));
                        }
                        s.saved.next_id += 1;
                        rule.id = s.saved.next_id;
                        s.saved.rules.push(rule.clone());
                    } else {
                        let slot = s.saved.rules.iter_mut().find(|r| r.id == rule.id).ok_or("règle introuvable")?;
                        *slot = rule.clone();
                    }
                    s.errors.remove(&rule.id);
                    rule.id
                };
                ctx.log_info(format!("règle enregistrée : {}", rule.name));
                self.changed(ctx.app);
                Ok(json!({ "id": id }))
            }
            "delete" => {
                let id = arg_id(&args)?;
                let (index, rule) = {
                    let mut s = self.state.lock().unwrap();
                    let i = s.saved.rules.iter().position(|r| r.id == id).ok_or("règle introuvable")?;
                    (i, s.saved.rules.remove(i))
                };
                self.changed(ctx.app);
                let (state, app, tx) = (self.state.clone(), ctx.app.clone(), self.to_watcher.lock().unwrap().clone());
                ctx.offer_undo(
                    &format!("Règle « {} » supprimée", rule.name),
                    DEFAULT_WINDOW,
                    Box::new(move || {
                        {
                            let mut s = state.lock().unwrap();
                            let at = index.min(s.saved.rules.len());
                            s.saved.rules.insert(at, rule);
                        }
                        changed(&app, &state, tx.as_ref());
                        Ok(())
                    }),
                );
                Ok(Value::Null)
            }
            "toggle" => {
                let id = arg_id(&args)?;
                let enabled = args.get("enabled").and_then(Value::as_bool).ok_or("paramètre « enabled » manquant")?;
                {
                    let mut s = self.state.lock().unwrap();
                    let r = s.saved.rules.iter_mut().find(|r| r.id == id).ok_or("règle introuvable")?;
                    r.enabled = enabled;
                    s.runs.remove(&id);
                }
                self.changed(ctx.app);
                Ok(Value::Null)
            }
            "pause" => {
                let paused = args.get("paused").and_then(Value::as_bool).ok_or("paramètre « paused » manquant")?;
                self.state.lock().unwrap().saved.paused = paused;
                self.changed(ctx.app);
                Ok(Value::Null)
            }
            // « Tester » : ce que ferait la règle, sans rien faire.
            // { rule, path? } : la règle telle qu'elle est dans l'éditeur.
            "preview" => {
                let rule: Rule = serde_json::from_value(args.get("rule").cloned().unwrap_or(Value::Null))
                    .map_err(|e| format!("règle illisible : {e}"))?;
                model::validate(&rule)?;
                let path = match args.get("path").and_then(Value::as_str) {
                    Some(p) => Some(ctx.check_path(p)?),
                    None => None,
                };
                Ok(json!({ "steps": preview(&rule, path.as_deref()) }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        let rules: Vec<Rule> = {
            let s = self.state.lock().unwrap();
            if s.saved.paused {
                return;
            }
            s.saved
                .rules
                .iter()
                .filter(|r| r.enabled && matches!(&r.trigger, Trigger::Event { topic } if *topic == msg.topic))
                .cloned()
                .collect()
        };
        for rule in rules {
            fire(ctx, &self.state, &rule, None, "");
        }
    }
}

impl Rules {
    fn changed(&self, app: &AppHandle) {
        changed(app, &self.state, self.to_watcher.lock().unwrap().as_ref());
    }
}

/// Après une modification : enregistre, refait raccourcis et surveillance,
/// prévient le front.
fn changed(app: &AppHandle, state: &Shared, watcher: Option<&Sender<Msg>>) {
    if let Err(e) = save(&state.lock().unwrap().saved) {
        log::warn(format!("règles : enregistrement impossible : {e}"));
    }
    apply_hotkeys(app, state);
    if let Some(tx) = watcher {
        let _ = tx.send(Msg::Rebuild);
    }
    notify_front(app);
}

fn notify_front(app: &AppHandle) {
    bus::emit(app, ID, "rules.changed", json!({}));
}

fn listing(s: &State) -> Value {
    let topics: Vec<Value> = model::EVENT_TOPICS.iter().map(|(t, l)| json!({ "topic": t, "label": l })).collect();
    let errors: HashMap<String, &String> = s.errors.iter().map(|(k, v)| (k.to_string(), v)).collect();
    json!({
        "rules": s.saved.rules,
        "paused": s.saved.paused,
        "history": s.history,
        "errors": errors,
        "topics": topics,
    })
}

/// Vérifications qui touchent au disque : les dossiers existent, ne sont pas
/// exclus, et une règle ne peut pas se nourrir d'elle-même.
fn check_rule(ctx: &ModuleContext, rule: &Rule) -> Result<(), String> {
    model::validate(rule)?;
    let watched = match &rule.trigger {
        Trigger::File { folder, subfolders } => {
            let f = ctx.check_path(folder)?;
            if !f.is_dir() {
                return Err("le dossier surveillé n'est pas un dossier".into());
            }
            Some((f, *subfolders))
        }
        _ => None,
    };
    for a in &rule.actions {
        if let Action::Move { to } | Action::Copy { to } = a {
            let dest = ctx.check_path(to)?;
            if !dest.is_dir() {
                return Err(format!("{} n'est pas un dossier", dest.display()));
            }
            if let Some((folder, sub)) = &watched {
                let loops = same_path(&dest, folder) || (*sub && dest.starts_with(folder));
                if loops {
                    return Err("la destination est dans le dossier surveillé : la règle tournerait en boucle".into());
                }
            }
        }
    }
    Ok(())
}

// ── Raccourcis clavier globaux ───────────────────────────────────────────────

/// Réserve auprès de Windows les raccourcis des règles actives (et libère les
/// anciens). Un raccourci déjà pris par un autre logiciel est signalé sur la règle.
fn apply_hotkeys(app: &AppHandle, state: &Shared) {
    let gs = app.global_shortcut();
    let (old, wanted): (Vec<String>, Vec<(u64, String)>) = {
        let mut s = state.lock().unwrap();
        let old = std::mem::take(&mut s.hotkeys);
        let active = super::is_active(app, ID) && !s.saved.paused;
        let wanted = s
            .saved
            .rules
            .iter()
            .filter(|r| r.enabled && active)
            .filter_map(|r| match &r.trigger {
                Trigger::Hotkey { keys } => Some((r.id, keys.clone())),
                _ => None,
            })
            .collect();
        (old, wanted)
    };
    for k in &old {
        let _ = gs.unregister(k.as_str());
    }

    let mut registered: Vec<String> = Vec::new();
    let mut errors: Vec<(u64, String)> = Vec::new();
    for (id, keys) in wanted {
        let norm = keys.to_ascii_lowercase().replace(' ', "");
        if registered.iter().any(|k| k.to_ascii_lowercase().replace(' ', "") == norm) {
            continue; // même raccourci pour deux règles : une seule réservation, les deux tournent
        }
        let (app2, state2) = (app.clone(), state.clone());
        let result = gs.on_shortcut(keys.as_str(), move |_app, shortcut, event| {
            // Au relâchement : pas de répétition si on garde la touche enfoncée.
            if event.state == ShortcutState::Released {
                let (app3, state3, pressed) = (app2.clone(), state2.clone(), *shortcut);
                // Le gestionnaire tourne sur le thread principal : on ne le bloque pas.
                std::thread::spawn(move || on_hotkey(&app3, &state3, &pressed));
            }
        });
        match result {
            Ok(()) => registered.push(keys),
            Err(e) => {
                let text = e.to_string();
                let friendly = if text.contains("already registered") {
                    format!("{keys} est déjà utilisé par un autre logiciel")
                } else {
                    format!("raccourci {keys} refusé : {text}")
                };
                errors.push((id, friendly));
            }
        }
    }
    let mut s = state.lock().unwrap();
    s.hotkeys = registered;
    for (id, e) in errors {
        s.errors.insert(id, e);
    }
}

fn on_hotkey(app: &AppHandle, state: &Shared, pressed: &Shortcut) {
    super::with_context(app, ID, |ctx| {
        let rules: Vec<Rule> = {
            let s = state.lock().unwrap();
            if s.saved.paused {
                return;
            }
            s.saved
                .rules
                .iter()
                .filter(|r| r.enabled)
                .filter(|r| match &r.trigger {
                    Trigger::Hotkey { keys } => keys.parse::<Shortcut>().is_ok_and(|k| k.id() == pressed.id()),
                    _ => false,
                })
                .cloned()
                .collect()
        };
        for rule in rules {
            fire(ctx, state, &rule, None, "");
        }
    });
}

// ── Exécution ────────────────────────────────────────────────────────────────

/// Ce qu'il faut défaire si on clique « Annuler ».
enum UndoStep {
    /// Remettre `from` à `to` (après un déplacement ou un renommage).
    MoveBack { from: PathBuf, to: PathBuf },
    /// Une copie créée : à la Corbeille.
    TrashCopy(PathBuf),
    /// Un fichier mis à la Corbeille : le ressortir.
    Restore(PathBuf),
}

/// Déclenche une règle (avec la limite par minute) et note le résultat.
/// `subject` : le fichier, ou la racine du lecteur. `label` : son nom affiché.
fn fire(ctx: &ModuleContext, state: &Shared, rule: &Rule, subject: Option<PathBuf>, label: &str) {
    // Trop de déclenchements : la règle se met en pause, et on prévient.
    let too_many = {
        let mut s = state.lock().unwrap();
        let now = Instant::now();
        let runs = s.runs.entry(rule.id).or_default();
        runs.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
        runs.push_back(now);
        let too_many = runs.len() > MAX_RUNS_PER_MINUTE;
        if too_many {
            if let Some(r) = s.saved.rules.iter_mut().find(|r| r.id == rule.id) {
                r.enabled = false;
            }
            s.errors.insert(rule.id, "mise en pause : plus de 20 déclenchements en une minute".into());
        }
        too_many
    };
    if too_many {
        let _ = save(&state.lock().unwrap().saved);
        ctx.emit("rules.notify", json!({ "title": format!("Règle « {} » mise en pause", rule.name), "body": "Elle s'est déclenchée plus de 20 fois en une minute." }));
        record(ctx.app, state, rule, label, false, "mise en pause (trop de déclenchements)".into());
        return;
    }

    let result = execute(ctx, state, rule, subject, label);
    let (ok, message) = match result {
        Ok(steps) => (true, steps.join(", ")),
        Err(e) => (false, e),
    };
    // Le journal : quelle règle, si ça a marché ; pas le contenu des fichiers.
    if ok {
        ctx.log_info(format!("règle « {} » : {message}", rule.name));
    } else {
        ctx.log_warn(format!("règle « {} » : {message}", rule.name));
    }
    record(ctx.app, state, rule, label, ok, message);
}

fn record(app: &AppHandle, state: &Shared, rule: &Rule, subject: &str, ok: bool, message: String) {
    {
        let mut s = state.lock().unwrap();
        s.history.push_front(HistoryEntry { at: now_ms(), rule: rule.name.clone(), subject: subject.into(), ok, message });
        s.history.truncate(HISTORY_LEN);
    }
    notify_front(app);
}

/// Fait les actions dans l'ordre. Un fichier déplacé ou renommé est suivi :
/// l'action suivante agit sur son nouveau chemin. À la première erreur, on
/// s'arrête (ce qui est déjà fait reste annulable).
fn execute(ctx: &ModuleContext, state: &Shared, rule: &Rule, subject: Option<PathBuf>, label: &str) -> Result<Vec<String>, String> {
    let mut current = subject;
    let mut undo: Vec<UndoStep> = Vec::new();
    let mut steps: Vec<String> = Vec::new();
    let mut error = None;

    for action in &rule.actions {
        match run_action(ctx, state, action, &mut current, label, &mut undo) {
            Ok(step) => steps.push(step),
            Err(e) => {
                error = Some(e);
                break;
            }
        }
    }

    if !undo.is_empty() {
        let what = if label.is_empty() { rule.name.clone() } else { format!("{label} ({})", rule.name) };
        ctx.offer_undo(
            &format!("Règle : {what}"),
            DEFAULT_WINDOW,
            Box::new(move || {
                let mut errors = Vec::new();
                for step in undo.into_iter().rev() {
                    let r = match step {
                        UndoStep::MoveBack { from, to } => files::move_to(&from, &to),
                        UndoStep::TrashCopy(p) => files::to_trash(&[p]),
                        UndoStep::Restore(p) => files::restore_from_trash(&p),
                    };
                    if let Err(e) = r {
                        errors.push(e);
                    }
                }
                if errors.is_empty() { Ok(()) } else { Err(errors.join(" ; ")) }
            }),
        );
    }
    match error {
        Some(e) if steps.is_empty() => Err(e),
        Some(e) => Err(format!("{} puis erreur : {e}", steps.join(", "))),
        None => Ok(steps),
    }
}

fn run_action(
    ctx: &ModuleContext,
    state: &Shared,
    action: &Action,
    current: &mut Option<PathBuf>,
    label: &str,
    undo: &mut Vec<UndoStep>,
) -> Result<String, String> {
    let path = || current.clone().ok_or_else(|| "aucun fichier".to_string());
    let name = if label.is_empty() { current.as_deref().map(file_name).unwrap_or_default() } else { label.to_string() };
    match action {
        Action::Move { to } => {
            let dest_dir = ctx.check_path(to)?;
            let src = path()?;
            let new = files::move_into(&src, &dest_dir)?;
            mark_produced(state, &new);
            undo.push(UndoStep::MoveBack { from: new.clone(), to: src });
            *current = Some(new);
            Ok(format!("déplacé dans {}", file_name(&dest_dir)))
        }
        Action::Copy { to } => {
            let dest_dir = ctx.check_path(to)?;
            let copy = files::copy_into(&path()?, &dest_dir)?;
            mark_produced(state, &copy);
            undo.push(UndoStep::TrashCopy(copy));
            Ok(format!("copié dans {}", file_name(&dest_dir)))
        }
        Action::Rename { pattern } => {
            let src = path()?;
            let now = platform::local_time();
            let new_name = model::rename(
                pattern,
                &src,
                &format!("{:04}-{:02}-{:02}", now.year, now.month, now.day),
                &format!("{:02}h{:02}", now.hour, now.minute),
            );
            let dir = src.parent().ok_or("dossier introuvable")?;
            if file_name(&src) == new_name {
                return Ok("nom inchangé".into());
            }
            let dest = files::unique_dest(dir, std::ffi::OsStr::new(&new_name));
            files::move_to(&src, &dest)?;
            mark_produced(state, &dest);
            undo.push(UndoStep::MoveBack { from: dest.clone(), to: src });
            let shown = file_name(&dest);
            *current = Some(dest);
            Ok(format!("renommé en {shown}"))
        }
        Action::Trash => {
            let src = path()?;
            files::to_trash(std::slice::from_ref(&src))?;
            undo.push(UndoStep::Restore(src));
            *current = None;
            Ok("mis à la Corbeille".into())
        }
        Action::Shelf => {
            ctx.emit("shelf.add", json!({ "paths": [path()?.display().to_string()] }));
            Ok("posé sur l'étagère".into())
        }
        Action::Reveal => {
            let p = path()?;
            if p.parent().is_none() {
                files::open_folder(&p)?; // la racine d'un lecteur : on l'ouvre
            } else {
                files::reveal(&p)?;
            }
            Ok("montré dans l'Explorateur".into())
        }
        Action::Terminal => {
            let payload = match current.as_deref() {
                Some(p) => json!({ "path": p.display().to_string() }),
                None => json!({}),
            };
            ctx.emit("terminal.open", payload);
            Ok("terminal ouvert".into())
        }
        Action::Notify { text } => {
            ctx.emit("rules.notify", json!({ "title": model::fill(text, &name), "body": "" }));
            Ok("notification".into())
        }
        Action::OpenIsland { tab } => {
            ctx.emit("rules.open-island", json!({ "tab": tab }));
            Ok("île ouverte".into())
        }
        Action::Timer { minutes } => {
            ctx.emit("timer.start", json!({ "minutes": minutes }));
            Ok(format!("minuteur de {minutes} min"))
        }
        Action::PastePlain => {
            ctx.emit("clipboard.paste-plain", json!({}));
            Ok("collé sans mise en forme".into())
        }
    }
}

/// « Tester » : la description de ce que ferait la règle (rien n'est fait).
fn preview(rule: &Rule, path: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = path.map(Path::to_path_buf);
    if let (Some(p), Trigger::File { .. }) = (path, &rule.trigger) {
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let size = std::fs::metadata(p).ok().map(|m| m.len());
        let name = file_name(p);
        if !model::matches(&rule.conditions, &Subject { name: &name, ext: &ext, size }) {
            out.push(format!("{name} ne remplit pas les conditions : la règle ne ferait rien."));
            return out;
        }
        out.push(format!("{name} remplit les conditions."));
    }
    let label = current.as_deref().map(file_name).unwrap_or_else(|| "le lecteur".into());
    for a in &rule.actions {
        let line = match a {
            Action::Move { to } => {
                let line = format!("Déplacer dans {to}");
                current = current.as_ref().and_then(|c| c.file_name()).map(|n| Path::new(to).join(n));
                line
            }
            Action::Copy { to } => format!("Copier dans {to}"),
            Action::Rename { pattern } => match &current {
                Some(c) => {
                    let new = model::rename(pattern, c, "2026-10-05", "14h30");
                    let line = format!("Renommer en « {new} » (exemple de date)");
                    current = Some(c.with_file_name(new));
                    line
                }
                None => format!("Renommer avec « {pattern} »"),
            },
            Action::Trash => "Envoyer à la Corbeille (récupérable)".into(),
            Action::Shelf => "Poser sur l'étagère".into(),
            Action::Reveal => "Montrer dans l'Explorateur".into(),
            Action::Terminal => "Ouvrir un terminal".into(),
            Action::Notify { text } => format!("Notification : « {} »", model::fill(text, &label)),
            Action::OpenIsland { tab } if tab.is_empty() => "Ouvrir l'île".into(),
            Action::OpenIsland { tab } => format!("Ouvrir l'île sur l'onglet {tab}"),
            Action::Timer { minutes } => format!("Lancer un minuteur de {minutes} min"),
            Action::PastePlain => "Coller le presse-papiers sans mise en forme".into(),
        };
        out.push(line);
    }
    out
}

// ── Petites aides ────────────────────────────────────────────────────────────

/// Les règles « fichier » qui s'appliquent à `path` (dossier + conditions).
fn file_rules_for(state: &Shared, path: &Path) -> Vec<Rule> {
    let s = state.lock().unwrap();
    if s.saved.paused {
        return Vec::new();
    }
    let name = file_name(path);
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let size = std::fs::metadata(path).ok().map(|m| m.len());
    s.saved
        .rules
        .iter()
        .filter(|r| r.enabled)
        .filter(|r| match &r.trigger {
            Trigger::File { folder, subfolders } => in_folder(path, Path::new(folder), *subfolders),
            _ => false,
        })
        .filter(|r| model::matches(&r.conditions, &Subject { name: &name, ext: &ext, size }))
        .cloned()
        .collect()
}

/// Les règles « lecteur » (branché ou débranché) dont les conditions acceptent ce nom.
fn drive_rules_for(state: &Shared, removed: bool, label: &str) -> Vec<Rule> {
    let s = state.lock().unwrap();
    if s.saved.paused {
        return Vec::new();
    }
    s.saved
        .rules
        .iter()
        .filter(|r| r.enabled && r.trigger == Trigger::Drive { removed })
        .filter(|r| {
            // Pour un lecteur, seule la condition « le nom contient » a un sens.
            let c = Conditions { name_contains: r.conditions.name_contains.clone(), ..Default::default() };
            model::matches(&c, &Subject { name: label, ext: "", size: None })
        })
        .cloned()
        .collect()
}

/// Les dossiers à surveiller : (dossier, avec sous-dossiers ?).
fn watched_folders(state: &Shared) -> Vec<(u64, PathBuf, bool)> {
    let s = state.lock().unwrap();
    if s.saved.paused {
        return Vec::new();
    }
    s.saved
        .rules
        .iter()
        .filter(|r| r.enabled)
        .filter_map(|r| match &r.trigger {
            Trigger::File { folder, subfolders } => Some((r.id, PathBuf::from(folder), *subfolders)),
            _ => None,
        })
        .collect()
}

fn set_error(state: &Shared, id: u64, error: Option<String>) {
    let mut s = state.lock().unwrap();
    match error {
        Some(e) => s.errors.insert(id, e),
        None => s.errors.remove(&id),
    };
}

/// Ce fichier vient-il d'être produit par une règle ? (anti-boucle)
fn recently_produced(state: &Shared, path: &Path) -> bool {
    let mut s = state.lock().unwrap();
    let now = Instant::now();
    s.produced.retain(|(_, t)| now.duration_since(*t) < PRODUCED_TTL);
    s.produced.iter().any(|(p, _)| same_path(p, path))
}

fn mark_produced(state: &Shared, path: &Path) {
    state.lock().unwrap().produced.push((path.to_path_buf(), Instant::now()));
}

/// `path` est-il dans `folder` (directement, ou plus bas si `sub`) ?
fn in_folder(path: &Path, folder: &Path, sub: bool) -> bool {
    let Some(parent) = path.parent() else { return false };
    if sub {
        let (p, f) = (lower(parent), lower(folder));
        p == f || p.starts_with(&format!("{}{}", f.trim_end_matches(['\\', '/']), std::path::MAIN_SEPARATOR))
    } else {
        same_path(parent, folder)
    }
}

/// Sous Windows, la casse ne compte pas dans les chemins.
fn lower(p: &Path) -> String {
    let s = p.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
    if cfg!(windows) { s.to_lowercase() } else { s }
}

fn same_path(a: &Path, b: &Path) -> bool {
    lower(a) == lower(b)
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.display().to_string())
}

fn arg_id(args: &Value) -> Result<u64, String> {
    args.get("id").and_then(Value::as_u64).ok_or_else(|| "paramètre « id » manquant".into())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file() -> PathBuf {
    platform::config_dir().join("rules.json")
}

/// Relit les règles. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Saved {
    let Ok(text) = std::fs::read_to_string(file()) else { return Saved::default() };
    match serde_json::from_str::<Saved>(&text) {
        Ok(mut s) => {
            let max = s.rules.iter().map(|r| r.id).max().unwrap_or(0);
            s.next_id = s.next_id.max(max);
            s
        }
        Err(e) => {
            let aside = platform::config_dir().join(format!("rules.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("règles : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Saved::default()
        }
    }
}

fn save(s: &Saved) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    let tmp = dir.join("rules.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_membership() {
        let folder = Path::new("/home/x/Downloads");
        assert!(in_folder(Path::new("/home/x/Downloads/a.pdf"), folder, false));
        assert!(!in_folder(Path::new("/home/x/Downloads/sub/a.pdf"), folder, false));
        assert!(in_folder(Path::new("/home/x/Downloads/sub/a.pdf"), folder, true));
        assert!(!in_folder(Path::new("/home/x/Downloads2/a.pdf"), folder, true));
    }

    #[test]
    fn preview_follows_the_file() {
        let rule = Rule {
            id: 1,
            name: "PDF".into(),
            enabled: true,
            trigger: Trigger::File { folder: "/tmp".into(), subfolders: false },
            conditions: Conditions { extensions: vec!["pdf".into()], ..Default::default() },
            actions: vec![
                Action::Move { to: "/docs".into() },
                Action::Rename { pattern: "{date} {nom}".into() },
                Action::Notify { text: "{nom} rangé".into() },
            ],
        };
        let steps = preview(&rule, Some(Path::new("/tmp/facture.pdf")));
        assert_eq!(steps[0], "facture.pdf remplit les conditions.");
        assert_eq!(steps[2], "Renommer en « 2026-10-05 facture.pdf » (exemple de date)");
        assert_eq!(steps[3], "Notification : « facture.pdf rangé »");
        let steps = preview(&rule, Some(Path::new("/tmp/photo.jpg")));
        assert_eq!(steps.len(), 1);
    }
}
