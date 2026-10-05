// Module « Agenda » : le prochain rendez-vous, lu dans un ou plusieurs
// fichiers .ics choisis dans les réglages (export d'Outlook, Google Agenda…).
//
// Un thread regarde toutes les 15 secondes :
//   - si un fichier a changé (date de modification) : il est relu ;
//   - la liste des prochains rendez-vous (30 jours, au plus 30) : si elle a
//     changé, "agenda.changed" est publié ;
//   - si un rendez-vous commence bientôt (réglage « rappel ») :
//     "agenda.reminder" est publié, une seule fois par rendez-vous.
//
// Comme pour les notes, les messages du bus ne contiennent pas le texte des
// rendez-vous : le front le demande avec la commande "upcoming". Rien n'est
// écrit dans le journal à part le nom du fichier en cas d'erreur.
//
// Rien n'est téléchargé : pour un agenda en ligne, il faut l'exporter en .ics
// (un abonnement par adresse internet viendra peut-être plus tard).

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use chrono::{Local, NaiveDateTime, TimeZone};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::services::ics::{self, Event, Occurrence};
use crate::services::log;

const ID: &str = "agenda";
/// Au plus ce nombre de fichiers .ics.
const MAX_FILES: usize = 5;
/// Un .ics plus gros est refusé (un agenda de plusieurs années tient en 1 à 5 Mo).
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// Combien de jours à l'avance on regarde, et combien de rendez-vous au plus.
const HORIZON_DAYS: i64 = 30;
const MAX_UPCOMING: usize = 30;
const TICK: Duration = Duration::from_secs(15);

/// Un fichier .ics déjà lu (ses événements sont rangés dans `State::events`).
struct Loaded {
    path: PathBuf,
    modified: Option<SystemTime>,
    events: Vec<Event>,
}

#[derive(Default)]
struct State {
    files: Vec<Loaded>,
    /// Les événements de tous les fichiers réunis.
    events: Vec<Event>,
    /// Un message par fichier qui n'a pas pu être lu (affiché dans l'onglet).
    errors: Vec<String>,
    /// La dernière liste publiée (pour ne publier que les changements).
    upcoming: Vec<Value>,
    /// Les rendez-vous déjà rappelés (leur clé).
    reminded: HashSet<String>,
    /// Le dernier message publié, pour ne pas répéter le même.
    last_payload: Value,
}

type Shared = Arc<Mutex<State>>;

#[derive(Default)]
pub struct Agenda {
    state: Shared,
}

impl RustModule for Agenda {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/agenda/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || watch(app, state));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, _args: Value) -> Result<Value, String> {
        match command {
            "upcoming" => Ok(listing(&self.state.lock().unwrap())),
            // Réglages changés ou bouton « Relire » : on relit tout de suite.
            "reload" => {
                self.state.lock().unwrap().files.clear();
                refresh(ctx, &self.state);
                Ok(listing(&self.state.lock().unwrap()))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// Ce que renvoie la commande "upcoming".
fn listing(state: &State) -> Value {
    json!({ "events": state.upcoming, "errors": state.errors, "files": state.files.len() })
}

/// La boucle du thread de fond.
fn watch(app: AppHandle, state: Shared) {
    // Un premier passage rapide, le temps que les réglages soient chargés.
    std::thread::sleep(Duration::from_secs(2));
    loop {
        // Une panique ici ne doit tuer ni le thread ni l'île.
        let step = catch_unwind(AssertUnwindSafe(|| super::with_context(&app, ID, |ctx| refresh(ctx, &state))));
        if step.is_err() {
            log::warn("agenda : erreur inattendue pendant la lecture, on réessaie plus tard");
        }
        std::thread::sleep(TICK);
    }
}

/// Relit les fichiers qui ont changé, recalcule la liste, publie et rappelle.
fn refresh(ctx: &ModuleContext, state: &Shared) {
    let settings = ctx.settings();
    let paths: Vec<String> = settings
        .get("icsFiles")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).take(MAX_FILES).map(String::from).collect())
        .unwrap_or_default();
    let reminder_min = settings.get("reminderMin").and_then(Value::as_i64).unwrap_or(10).clamp(0, 240);

    let mut s = state.lock().unwrap();
    load_files(ctx, &mut s, &paths);

    // Les prochains rendez-vous, de maintenant à dans 30 jours.
    let now = Local::now().naive_local();
    let occ = ics::occurrences(&s.events, now, now + chrono::Duration::days(HORIZON_DAYS));
    let upcoming: Vec<Value> = occ.iter().take(MAX_UPCOMING).map(to_json).collect();

    // Rappels : un rendez-vous (pas une journée entière) qui commence dans
    // moins de `reminder_min` minutes, et pas encore rappelé.
    let mut reminders = Vec::new();
    if reminder_min > 0 {
        for o in occ.iter().filter(|o| !o.all_day && o.start >= now) {
            let key = key_of(o);
            if o.start - now <= chrono::Duration::minutes(reminder_min) && s.reminded.insert(key.clone()) {
                reminders.push(key);
            }
        }
    }

    s.upcoming = upcoming;
    let payload = json!({
        "count": s.upcoming.len(),
        "next": s.upcoming.first().and_then(|e| e.get("start").cloned()),
        "errors": s.errors.len(),
        // Change avec la liste : le front sait qu'il doit la redemander.
        "version": version_of(&s.upcoming, &s.errors),
    });
    let changed = payload != s.last_payload;
    s.last_payload = payload.clone();
    drop(s); // on ne garde pas le verrou pendant qu'on publie

    if changed {
        ctx.emit("agenda.changed", payload);
    }
    for key in reminders {
        ctx.emit("agenda.reminder", json!({ "key": key, "minutes": reminder_min }));
    }
}

/// (Re)lit les fichiers dont la liste ou la date de modification a changé.
fn load_files(ctx: &ModuleContext, s: &mut State, paths: &[String]) {
    let same_list = s.files.len() == paths.len() && s.files.iter().zip(paths).all(|(f, p)| f.path == PathBuf::from(p));
    let unchanged = same_list && s.files.iter().all(|f| modified(&f.path) == f.modified);
    if unchanged {
        return;
    }

    let mut files = Vec::new();
    let mut errors = Vec::new();
    for raw in paths {
        let name = PathBuf::from(raw).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        match read_file(ctx, raw) {
            Ok(loaded) => files.push(loaded),
            Err(e) => {
                ctx.log_warn(format!("agenda : {name} illisible : {e}"));
                errors.push(format!("{name} : {e}"));
            }
        }
    }
    s.events = files.iter_mut().flat_map(|f| std::mem::take(&mut f.events)).collect();
    s.files = files;
    s.errors = errors;
}

fn read_file(ctx: &ModuleContext, raw: &str) -> Result<Loaded, String> {
    // Validation du chemin (permission "files", dossiers exclus, chemin absolu…).
    let path = ctx.check_path(raw)?;
    let is_ics = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("ics"));
    if !is_ics {
        return Err("ce n'est pas un fichier .ics".into());
    }
    let meta = std::fs::metadata(&path).map_err(|_| "fichier introuvable".to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("fichier trop gros (plus de 20 Mo)".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Les .ics sont en UTF-8 ; un caractère abîmé ne doit pas tout empêcher.
    let text = String::from_utf8_lossy(&bytes);
    let events = ics::parse(&text);
    Ok(Loaded { modified: meta.modified().ok(), path: PathBuf::from(raw), events })
}

fn modified(path: &PathBuf) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

/// Une heure locale → millisecondes depuis 1970 (ce que `new Date()` comprend).
fn to_ms(t: NaiveDateTime) -> i64 {
    Local.from_local_datetime(&t).earliest().map(|d| d.timestamp_millis()).unwrap_or(0)
}

/// Une clé stable pour un rendez-vous précis (titre + heure), sans le texte.
fn key_of(o: &Occurrence) -> String {
    let mut h = DefaultHasher::new();
    (&o.summary, o.start).hash(&mut h);
    format!("{:x}", h.finish())
}

fn version_of(upcoming: &[Value], errors: &[String]) -> String {
    let mut h = DefaultHasher::new();
    serde_json::to_string(upcoming).unwrap_or_default().hash(&mut h);
    errors.hash(&mut h);
    format!("{:x}", h.finish())
}

fn to_json(o: &Occurrence) -> Value {
    json!({
        "key": key_of(o),
        "title": o.summary,
        "location": o.location,
        "start": to_ms(o.start),
        "end": to_ms(o.end),
        "allDay": o.all_day,
    })
}
