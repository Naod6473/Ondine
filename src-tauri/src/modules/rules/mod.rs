// Module « Règles » : « Quand… (si…) alors… ».
//
//   - model.rs : la forme d'une règle, sa validation, les petites fonctions pures ;
//   - watch.rs : le thread qui surveille les dossiers et les lecteurs ;
//   - sense.rs : les déclencheurs qu'on regarde de temps en temps (heure,
//     réseau, batterie, session déverrouillée, presse-papiers) ;
//   - unzip.rs : l'action « Décompresser une archive .zip » ;
//   - ce fichier : les commandes, l'exécution des actions, les raccourcis.
//
// Garde-fous (voir docs/ARCHITECTURE.md, « Module Règles ») :
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
// timer.start, clipboard.paste-plain, notes.add, mascot.*) : aucun appel
// direct entre modules. Agents IA et Musique nous préviennent de même
// (agents.event, media.changed).

mod model;
mod sense;
mod unzip;
mod watch;

use crate::sync::LockExt;
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
use model::{Action, Gesture, Rule, Trigger};
use model::{Conditions, Subject};

const ID: &str = "rules";
/// Au-delà de ce nombre de déclenchements en une minute, la règle se met en pause.
const MAX_RUNS_PER_MINUTE: usize = 20;
/// Pendant ce temps, un fichier produit par une règle n'en redéclenche pas.
const PRODUCED_TTL: Duration = Duration::from_secs(30);
const HISTORY_LEN: usize = 40;

/// Ce qui est enregistré dans %APPDATA%\Ondine\rules.json.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    rules: Vec<Rule>,
    next_id: u64,
    /// « Tout mettre en pause ».
    paused: bool,
    /// Les heures (ms) des déclenchements des 8 derniers jours, par règle :
    /// le compteur « déclenchée N fois cette semaine ». Que des heures.
    fired: HashMap<u64, Vec<u64>>,
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
    /// Musique : quelque chose jouait au dernier media.changed.
    music_playing: bool,
    /// Calme : numéro du dernier « Calme pendant X min » (un plus récent prolonge).
    quiet_gen: u64,
}

type Shared = Arc<Mutex<State>>;
/// « Ce message déclenche-t-il ce déclencheur ? »
type TriggerFilter = Box<dyn Fn(&Trigger) -> bool>;

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
        {
            let mut s = self.state.locked();
            s.saved = load();
            // rules.json peut avoir été modifié à la main : chaque règle repasse
            // les mêmes vérifications qu'à l'enregistrement. Une règle invalide
            // est désactivée (pas effacée) et l'onglet dit pourquoi.
            let mut bad = Vec::new();
            for r in s.saved.rules.iter_mut() {
                if let Err(e) = model::validate(r) {
                    r.enabled = false;
                    bad.push((r.id, format!("désactivée : {e}")));
                }
            }
            for (id, e) in bad {
                log::warn(format!("règles : règle n°{id} invalide dans rules.json, désactivée"));
                s.errors.insert(id, e);
            }
        }
        let (tx, rx) = std::sync::mpsc::channel();
        *self.to_watcher.locked() = Some(tx.clone());
        let (app2, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || watch::run(app2, state, tx, rx));
        apply_hotkeys(app, &self.state);
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "list" => Ok(listing(&self.state.locked())),
            "save" => {
                let mut rule: Rule = serde_json::from_value(args.get("rule").cloned().unwrap_or(Value::Null))
                    .map_err(|e| format!("règle illisible : {e}"))?;
                check_rule(ctx, &rule)?;
                let id = {
                    let mut s = self.state.locked();
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
                    let mut s = self.state.locked();
                    let i = s.saved.rules.iter().position(|r| r.id == id).ok_or("règle introuvable")?;
                    (i, s.saved.rules.remove(i))
                };
                self.changed(ctx.app);
                let (state, app, tx) = (self.state.clone(), ctx.app.clone(), self.to_watcher.locked().clone());
                ctx.offer_undo(
                    &format!("Règle « {} » supprimée", rule.name),
                    DEFAULT_WINDOW,
                    Box::new(move || {
                        {
                            let mut s = state.locked();
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
                    let mut s = self.state.locked();
                    let r = s.saved.rules.iter_mut().find(|r| r.id == id).ok_or("règle introuvable")?;
                    r.enabled = enabled;
                    s.runs.remove(&id);
                }
                self.changed(ctx.app);
                Ok(Value::Null)
            }
            "pause" => {
                let paused = args.get("paused").and_then(Value::as_bool).ok_or("paramètre « paused » manquant")?;
                self.state.locked().saved.paused = paused;
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
        // Ce que le message déclenche : (filtre sur le déclencheur, nom pour {nom}).
        let p = &msg.payload;
        let (wanted, label): (TriggerFilter, String) = match msg.topic.as_str() {
            // Agents IA : « a fini » ou « attend ta réponse ».
            "agents.event" => {
                let waiting = match p.get("kind").and_then(Value::as_str) {
                    Some("done") => false,
                    Some("waiting") => true,
                    _ => return,
                };
                let who = p.get("project").and_then(Value::as_str).filter(|x| !x.is_empty());
                let label = who.or_else(|| p.get("title").and_then(Value::as_str)).unwrap_or("").chars().take(80).collect();
                (Box::new(move |t| *t == Trigger::Agent { waiting }), label)
            }
            // Musique : seulement le passage à « en lecture ».
            "media.changed" => {
                let playing = p.get("playing").and_then(|x| x.get("status")).and_then(Value::as_str) == Some("playing");
                let was = std::mem::replace(&mut self.state.locked().music_playing, playing);
                if !playing || was {
                    return;
                }
                let title = p.get("playing").and_then(|x| x.get("title")).and_then(Value::as_str).unwrap_or("");
                (Box::new(|t| *t == Trigger::Music), title.chars().take(80).collect())
            }
            topic => {
                let topic = topic.to_string();
                (Box::new(move |t| matches!(t, Trigger::Event { topic: x } if *x == topic)), String::new())
            }
        };
        let rules: Vec<Rule> = active_rules(&self.state).into_iter().filter(|r| wanted(&r.trigger)).collect();
        for rule in rules {
            fire(ctx, &self.state, &rule, None, &label);
        }
    }
}

impl Rules {
    fn changed(&self, app: &AppHandle) {
        changed(app, &self.state, self.to_watcher.locked().as_ref());
    }
}

/// Après une modification : enregistre, refait raccourcis et surveillance,
/// prévient le front.
fn changed(app: &AppHandle, state: &Shared, watcher: Option<&Sender<Msg>>) {
    if let Err(e) = save(&state.locked().saved) {
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
    let since = Now::local().week_start_ms;
    let counts: HashMap<String, usize> =
        s.saved.fired.iter().map(|(id, times)| (id.to_string(), times.iter().filter(|t| **t >= since).count())).collect();
    json!({
        "counts": counts,
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
        Trigger::Schedule { folder, .. } if !folder.trim().is_empty() => {
            let f = ctx.check_path(folder)?;
            if !f.is_dir() {
                return Err("le dossier choisi n'est pas un dossier".into());
            }
            None // passage à heure fixe : pas de boucle possible
        }
        _ => None,
    };
    for a in &rule.actions {
        if let Action::Unzip { to, .. } = a {
            let dest = ctx.check_path(to)?;
            if !dest.is_dir() {
                return Err(format!("{} n'est pas un dossier", dest.display()));
            }
            if let Some((folder, true)) = &watched {
                if dest.starts_with(folder) {
                    return Err("l'archive serait décompressée dans le dossier surveillé : la règle tournerait en boucle".into());
                }
            }
        }
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
        let mut s = state.locked();
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
    let mut s = state.locked();
    s.hotkeys = registered;
    for (id, e) in errors {
        s.errors.insert(id, e);
    }
}

fn on_hotkey(app: &AppHandle, state: &Shared, pressed: &Shortcut) {
    super::with_context(app, ID, |ctx| {
        let rules: Vec<Rule> = {
            let s = state.locked();
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
    // « Seulement certains jours / certaines heures » : en dehors, rien.
    let now = Now::local();
    if !model::in_time_window(&rule.conditions, now.weekday, now.minutes) {
        return;
    }
    // Trop de déclenchements : la règle se met en pause, et on prévient.
    let too_many = {
        let mut s = state.locked();
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
        let _ = save(&state.locked().saved);
        ctx.emit("rules.notify", json!({ "title": format!("Règle « {} » mise en pause", rule.name), "body": "Elle s'est déclenchée plus de 20 fois en une minute." }));
        record(ctx.app, state, rule, label, false, "mise en pause (trop de déclenchements)".into());
        return;
    }

    count(state, rule.id);
    let mut undo = Vec::new();
    let result = execute(ctx, state, rule, subject, label, &mut undo);
    offer(ctx, rule, label, undo);
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

/// Une règle horaire sur un dossier : les mêmes actions sur chaque fichier
/// trouvé, comptées comme UN déclenchement, avec un seul « Annuler » pour tout.
fn fire_batch(ctx: &ModuleContext, state: &Shared, rule: &Rule, found: Vec<PathBuf>) {
    let now = Now::local();
    if found.is_empty() || !model::in_time_window(&rule.conditions, now.weekday, now.minutes) {
        return;
    }
    count(state, rule.id);
    let mut undo = Vec::new();
    let (mut done, mut failed) = (0usize, Vec::new());
    for path in &found {
        let label = file_name(path);
        match execute(ctx, state, rule, Some(path.clone()), &label, &mut undo) {
            Ok(_) => done += 1,
            Err(e) => failed.push(format!("{label} : {e}")),
        }
    }
    let label = format!("{} fichier(s)", found.len());
    offer(ctx, rule, &label, undo);
    let ok = failed.is_empty();
    let message = if ok { format!("{done} fichier(s) traité(s)") } else { format!("{done} traité(s), {} erreur(s) : {}", failed.len(), failed.join(" ; ")) };
    if ok {
        ctx.log_info(format!("règle « {} » : {message}", rule.name));
    } else {
        ctx.log_warn(format!("règle « {} » : {message}", rule.name));
    }
    record(ctx.app, state, rule, &label, ok, message);
}

/// Note un déclenchement pour le compteur de la semaine (on garde 8 jours).
fn count(state: &Shared, id: u64) {
    let now = now_ms();
    let mut s = state.locked();
    let times = s.saved.fired.entry(id).or_default();
    times.retain(|t| now.saturating_sub(*t) < 8 * 86_400_000);
    times.push(now);
    // Garde-fou : une règle très active ne fait pas grossir rules.json sans fin.
    let extra = times.len().saturating_sub(2000);
    times.drain(..extra);
    let ids: Vec<u64> = s.saved.rules.iter().map(|r| r.id).collect();
    s.saved.fired.retain(|k, _| ids.contains(k));
    let _ = save(&s.saved);
}

fn record(app: &AppHandle, state: &Shared, rule: &Rule, subject: &str, ok: bool, message: String) {
    // Presse-papiers : ce qui a été copié ne s'affiche pas dans l'historique.
    let subject = if matches!(rule.trigger, Trigger::Clipboard { .. }) { "presse-papiers" } else { subject };
    {
        let mut s = state.locked();
        s.history.push_front(HistoryEntry { at: now_ms(), rule: rule.name.clone(), subject: subject.into(), ok, message });
        s.history.truncate(HISTORY_LEN);
    }
    notify_front(app);
}

/// Fait les actions dans l'ordre. Un fichier déplacé ou renommé est suivi :
/// l'action suivante agit sur son nouveau chemin. À la première erreur, on
/// s'arrête (ce qui est déjà fait reste annulable).
fn execute(
    ctx: &ModuleContext,
    state: &Shared,
    rule: &Rule,
    subject: Option<PathBuf>,
    label: &str,
    undo: &mut Vec<UndoStep>,
) -> Result<Vec<String>, String> {
    let mut current = subject;
    let mut steps: Vec<String> = Vec::new();
    let mut error = None;

    for action in &rule.actions {
        match run_action(ctx, state, action, &mut current, label, undo) {
            Ok(step) => steps.push(step),
            Err(e) => {
                error = Some(e);
                break;
            }
        }
    }
    match error {
        Some(e) if steps.is_empty() => Err(e),
        Some(e) => Err(format!("{} puis erreur : {e}", steps.join(", "))),
        None => Ok(steps),
    }
}

/// Propose « Annuler » pour tout ce qui a été déplacé, copié, renommé,
/// décompressé ou mis à la Corbeille.
fn offer(ctx: &ModuleContext, rule: &Rule, label: &str, undo: Vec<UndoStep>) {
    if !undo.is_empty() {
        let what = if label.is_empty() || matches!(rule.trigger, Trigger::Clipboard { .. }) { rule.name.clone() } else { format!("{label} ({})", rule.name) };
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
            let now = Now::local();
            let new_name = model::rename(pattern, &src, &now.date, &now.time);
            let dir = src.parent().ok_or("dossier introuvable")?;
            // Le nouveau nom reste dans le même dossier : pas de séparateur, pas de « .. ».
            if new_name.contains(['/', '\\', ':']) || new_name == ".." || new_name == "." {
                return Err("nom de fichier invalide".into());
            }
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
            let now = Now::local();
            ctx.emit("rules.notify", json!({ "title": model::fill_all(text, &name, &now.date, &now.time), "body": "" }));
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
        Action::AddNote { text, todo } => {
            let now = Now::local();
            let text = model::fill_all(text, &name, &now.date, &now.time);
            ctx.emit("notes.add", json!({ "text": text, "kind": if *todo { "todo" } else { "note" } }));
            Ok(if *todo { "to-do ajoutée".into() } else { "note ajoutée".into() })
        }
        Action::Unzip { to, shelf } => {
            let dest_dir = ctx.check_path(to)?;
            let out = unzip::extract(&path()?, &dest_dir)?;
            mark_produced(state, &out);
            undo.push(UndoStep::TrashCopy(out.clone()));
            if *shelf {
                ctx.emit("shelf.add", json!({ "paths": [out.display().to_string()] }));
            }
            Ok(format!("décompressé dans {}", file_name(&out)))
        }
        Action::CopyPath { name_only } => {
            let p = path()?;
            let text = if *name_only { file_name(&p) } else { p.display().to_string() };
            files::copy_text(&text)?;
            Ok(if *name_only { "nom copié".into() } else { "chemin copié".into() })
        }
        Action::Mascot { gesture, emotion, text } => match gesture {
            Gesture::Dance => {
                ctx.emit("mascot.dance", json!({ "on": true }));
                // Quelques secondes de danse, puis elle reprend sa vie.
                let app = ctx.app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(8));
                    super::with_context(&app, ID, |c| c.emit("mascot.dance", json!({ "on": false })));
                });
                Ok("la mascotte danse".into())
            }
            Gesture::Emote => {
                ctx.emit("mascot.emote", json!({ "emotion": emotion }));
                Ok(format!("expression « {emotion} »"))
            }
            Gesture::Sign => {
                let shown: String = model::fill(text, &name).chars().take(40).collect();
                ctx.emit("mascot.sign", json!({ "text": shown, "secs": 8 }));
                Ok("pancarte".into())
            }
        },
        Action::Quiet { minutes } => {
            let generation = {
                let mut s = state.locked();
                s.quiet_gen += 1;
                s.quiet_gen
            };
            ctx.emit("rules.quiet", json!({ "on": true, "minutes": minutes }));
            ctx.emit("mascot.emote", json!({ "emotion": "calm" }));
            let (app, state) = (ctx.app.clone(), state.clone());
            let minutes = *minutes;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(u64::from(minutes) * 60));
                // Un « Calme » plus récent a pris le relais : c'est lui qui finira.
                if state.locked().quiet_gen == generation {
                    // Même module coupé entre-temps : l'île doit retrouver ses notifications.
                    bus::emit(&app, ID, "rules.quiet", json!({ "on": false }));
                }
            });
            Ok(format!("Calme pendant {minutes} min"))
        }
    }
}

/// « Tester » : la description de ce que ferait la règle (rien n'est fait).
fn preview(rule: &Rule, path: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = path.map(Path::to_path_buf);
    if let (Some(p), true) = (path, rule.trigger.gives_file()) {
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let meta = std::fs::metadata(p).ok();
        let size = meta.as_ref().map(|m| m.len());
        let age = file_age_days(meta.as_ref());
        let name = file_name(p);
        if !model::matches(&rule.conditions, &Subject { name: &name, ext: &ext, size, age_days: age }) {
            out.push(format!("{name} ne remplit pas les conditions : la règle ne ferait rien."));
            return out;
        }
        out.push(format!("{name} remplit les conditions."));
    }
    let label = current.as_deref().map(file_name).unwrap_or_else(|| match rule.trigger {
        Trigger::Drive { .. } => "le lecteur".into(),
        _ => "…".into(),
    });
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
            Action::AddNote { text, todo: false } => format!("Ajouter la note « {} »", model::fill(text, &label)),
            Action::AddNote { text, todo: true } => format!("Ajouter la to-do « {} »", model::fill(text, &label)),
            Action::Unzip { to, shelf } => {
                format!("Décompresser l'archive .zip dans {to}{}", if *shelf { ", puis la poser sur l'étagère" } else { "" })
            }
            Action::CopyPath { name_only: true } => "Copier le nom du fichier".into(),
            Action::CopyPath { name_only: false } => "Copier le chemin du fichier".into(),
            Action::Mascot { gesture: Gesture::Dance, .. } => "La mascotte danse".into(),
            Action::Mascot { gesture: Gesture::Emote, emotion, .. } => format!("La mascotte montre l'expression « {emotion} »"),
            Action::Mascot { gesture: Gesture::Sign, text, .. } => format!("La mascotte tient une pancarte « {} »", model::fill(text, &label)),
            Action::Quiet { minutes } => format!("Calme et Ne pas déranger pendant {minutes} min"),
        };
        out.push(line);
    }
    out
}

// ── Petites aides ────────────────────────────────────────────────────────────

/// Les règles « fichier » qui s'appliquent à `path` (dossier + conditions).
fn file_rules_for(state: &Shared, path: &Path) -> Vec<Rule> {
    let s = state.locked();
    if s.saved.paused {
        return Vec::new();
    }
    let name = file_name(path);
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len());
    let age = file_age_days(meta.as_ref());
    s.saved
        .rules
        .iter()
        .filter(|r| r.enabled)
        .filter(|r| match &r.trigger {
            Trigger::File { folder, subfolders } => in_folder(path, Path::new(folder), *subfolders),
            _ => false,
        })
        .filter(|r| model::matches(&r.conditions, &Subject { name: &name, ext: &ext, size, age_days: age }))
        .cloned()
        .collect()
}

/// Les règles « lecteur » (branché ou débranché) dont les conditions acceptent ce nom.
fn drive_rules_for(state: &Shared, removed: bool, label: &str) -> Vec<Rule> {
    let s = state.locked();
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
            model::matches(&c, &Subject { name: label, ext: "", size: None, age_days: None })
        })
        .cloned()
        .collect()
}

/// Les règles actives (rien si tout est en pause).
fn active_rules(state: &Shared) -> Vec<Rule> {
    let s = state.locked();
    if s.saved.paused {
        return Vec::new();
    }
    s.saved.rules.iter().filter(|r| r.enabled).cloned().collect()
}

/// L'heure locale, sous les formes dont les règles ont besoin.
struct Now {
    /// 0 = lundi … 6 = dimanche.
    weekday: u8,
    /// Minutes depuis minuit.
    minutes: u32,
    /// "2026-10-05"
    date: String,
    /// "14h30"
    time: String,
    /// Le lundi 00:00 de cette semaine (ms depuis 1970).
    week_start_ms: u64,
}

impl Now {
    fn local() -> Now {
        use chrono::{Datelike, Timelike};
        let now = chrono::Local::now();
        let weekday = now.weekday().num_days_from_monday() as u8;
        let since_midnight = u64::from(now.num_seconds_from_midnight()) * 1000;
        Now {
            weekday,
            minutes: now.hour() * 60 + now.minute(),
            date: format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day()),
            time: format!("{:02}h{:02}", now.hour(), now.minute()),
            week_start_ms: model::week_start(now_ms(), weekday, since_midnight),
        }
    }
}

/// Jours depuis la dernière modification d'un fichier.
fn file_age_days(meta: Option<&std::fs::Metadata>) -> Option<u64> {
    let modified = meta?.modified().ok()?;
    std::time::SystemTime::now().duration_since(modified).ok().map(|d| d.as_secs() / 86_400)
}

/// Les dossiers à surveiller : (dossier, avec sous-dossiers ?).
fn watched_folders(state: &Shared) -> Vec<(u64, PathBuf, bool)> {
    let s = state.locked();
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
    let mut s = state.locked();
    match error {
        Some(e) => s.errors.insert(id, e),
        None => s.errors.remove(&id),
    };
}

/// Ce fichier vient-il d'être produit par une règle ? (anti-boucle)
fn recently_produced(state: &Shared, path: &Path) -> bool {
    let mut s = state.locked();
    let now = Instant::now();
    s.produced.retain(|(_, t)| now.duration_since(*t) < PRODUCED_TTL);
    s.produced.iter().any(|(p, _)| same_path(p, path))
}

fn mark_produced(state: &Shared, path: &Path) {
    state.locked().produced.push((path.to_path_buf(), Instant::now()));
}

/// `path` est-il dans `folder` (directement, ou plus bas si `sub`) ?
fn in_folder(path: &Path, folder: &Path, sub: bool) -> bool {
    let Some(parent) = path.parent() else { return false };
    if sub {
        // On compare morceau par morceau (C:, Users, x, Downloads…) : ainsi
        // « / » et « \ » se valent, et « Downloads2 » n'est pas dans « Downloads ».
        parts(parent).starts_with(&parts(folder))
    } else {
        same_path(parent, folder)
    }
}

/// Les morceaux d'un chemin. Sous Windows, la casse ne compte pas.
fn parts(p: &Path) -> Vec<String> {
    p.components()
        .map(|c| {
            let s = c.as_os_str().to_string_lossy().to_string();
            if cfg!(windows) { s.to_lowercase() } else { s }
        })
        .collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    parts(a) == parts(b)
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

    #[cfg(windows)]
    #[test]
    fn folder_membership_ignores_case_and_slashes() {
        let folder = Path::new("c:/users/x/downloads");
        assert!(in_folder(Path::new(r"C:\Users\X\Downloads\a.pdf"), folder, false));
        assert!(in_folder(Path::new(r"C:\Users\X\Downloads\sub\a.pdf"), folder, true));
        assert!(!in_folder(Path::new(r"C:\Users\X\Downloads2\a.pdf"), folder, true));
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
