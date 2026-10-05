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
// Agenda en ligne (Google Agenda…) : si tu as enregistré son adresse secrète
// iCal dans Réglages → Identifiants, il est téléchargé au démarrage puis toutes
// les 15 minutes (lecture seule, rien n'est envoyé). L'adresse reste dans le
// Gestionnaire d'identifiants : elle n'apparaît jamais dans le journal, dans
// les messages d'erreur ni dans l'interface.

use crate::sync::LockExt;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use chrono::{Local, NaiveDateTime, TimeZone};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::services::credentials::ICAL_URL;
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
/// L'agenda en ligne est retéléchargé à cet intervalle.
const ONLINE_EVERY: Duration = Duration::from_secs(15 * 60);

/// Un fichier .ics déjà lu (ses événements sont rangés dans `State::events`).
struct Loaded {
    path: PathBuf,
    modified: Option<SystemTime>,
    events: Vec<Event>,
}

#[derive(Default)]
struct State {
    files: Vec<Loaded>,
    /// Les événements de tous les fichiers réunis. Partagés (Arc) pour faire
    /// les calculs sans garder le verrou.
    events: Arc<Vec<Event>>,
    /// Un message par fichier qui n'a pas pu être lu (affiché dans l'onglet).
    errors: Vec<String>,
    /// Les événements de l'agenda en ligne (dernier téléchargement réussi).
    online: Arc<Vec<Event>>,
    /// Le dernier échec de téléchargement (sans l'adresse, qui est secrète).
    online_error: Option<String>,
    /// Une empreinte de l'adresse (pas l'adresse) : si elle change, on retélécharge.
    online_key: u64,
    /// Quand on a téléchargé pour la dernière fois (réussi ou non).
    online_at: Option<Instant>,
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
            "upcoming" => Ok(listing(&self.state.locked())),
            // Réglages changés ou bouton « Relire » : on relit tout de suite.
            "reload" => {
                {
                    let mut s = self.state.locked();
                    s.files.clear();
                    s.events = Arc::default();
                    s.online_at = None; // l'agenda en ligne aussi
                }
                refresh(ctx, &self.state);
                Ok(listing(&self.state.locked()))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// Ce que renvoie la commande "upcoming".
fn listing(state: &State) -> Value {
    let mut errors = state.errors.clone();
    errors.extend(state.online_error.clone());
    // « files » : combien de sources sont branchées (fichiers + agenda en ligne).
    let sources = state.files.len() + usize::from(state.online_key != 0);
    json!({ "events": state.upcoming, "errors": errors, "files": sources })
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

    // Lire les fichiers peut être lent (gros .ics, disque réseau) : on le fait
    // sans tenir le verrou, pour que l'onglet reste fluide pendant ce temps.
    let known: Vec<(PathBuf, Option<SystemTime>)> = state.locked().files.iter().map(|f| (f.path.clone(), f.modified)).collect();
    if needs_reload(&known, &paths) {
        let (files, events, errors) = load_files(ctx, &paths);
        let mut s = state.locked();
        s.files = files;
        s.events = Arc::new(events);
        s.errors = errors;
    }

    refresh_online(ctx, state);

    // Les prochains rendez-vous, de maintenant à dans 30 jours (calcul hors verrou aussi).
    let (events, online) = {
        let s = state.locked();
        (s.events.clone(), s.online.clone())
    };
    let now = Local::now().naive_local();
    let to = now + chrono::Duration::days(HORIZON_DAYS);
    let mut occ = ics::occurrences(&events, now, to);
    occ.extend(ics::occurrences(&online, now, to));
    occ.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.summary.cmp(&b.summary)));
    let upcoming: Vec<Value> = occ.iter().take(MAX_UPCOMING).map(to_json).collect();

    let mut s = state.locked();

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
        "errors": s.errors.len() + usize::from(s.online_error.is_some()),
        // Change avec la liste : le front sait qu'il doit la redemander.
        "version": version_of(&s.upcoming, &s.errors, &s.online_error),
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

/// L'agenda en ligne : téléchargé si une adresse est enregistrée et que c'est
/// l'heure (ou que l'adresse a changé). Un échec garde les rendez-vous déjà
/// connus et affiche un message dans l'onglet.
fn refresh_online(ctx: &ModuleContext, state: &Shared) {
    let url = ctx.credential(ICAL_URL).ok().flatten();
    let Some(url) = url else {
        // Plus d'adresse (supprimée dans les réglages) : on oublie tout.
        let mut s = state.locked();
        if s.online_key != 0 {
            s.online = Arc::default();
            s.online_error = None;
            s.online_key = 0;
            s.online_at = None;
        }
        return;
    };
    let key = fingerprint(&url);
    {
        let mut s = state.locked();
        let due = s.online_key != key || s.online_at.is_none_or(|t| t.elapsed() >= ONLINE_EVERY);
        if !due {
            return;
        }
        if s.online_key != key {
            s.online = Arc::default(); // une autre adresse : les anciens rendez-vous ne valent plus
        }
        // Noté AVANT de télécharger : un échec n'entraîne pas un nouvel essai toutes les 15 s.
        s.online_key = key;
        s.online_at = Some(Instant::now());
    }
    // Le téléchargement se fait sans tenir le verrou.
    let result = download(&url).map(|text| ics::parse(&text));
    let mut s = state.locked();
    match result {
        Ok(events) => {
            s.online = Arc::new(events);
            s.online_error = None;
        }
        Err(e) => {
            ctx.log_warn(format!("agenda : agenda en ligne non téléchargé : {e}"));
            s.online_error = Some(format!("Agenda en ligne : {e}"));
        }
    }
}

/// Une empreinte de l'adresse, pour savoir si elle a changé sans la garder en mémoire.
/// Jamais 0 (0 veut dire « pas d'agenda en ligne »).
fn fingerprint(url: &str) -> u64 {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    h.finish().max(1)
}

/// Télécharge l'agenda (https seulement, 20 Mo au plus, 30 s au plus).
/// Les messages d'erreur ne contiennent JAMAIS l'adresse.
fn download(url: &str) -> Result<String, String> {
    crate::services::credentials::check_ical_url(url)?;
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let agent: ureq::Agent = ureq::Agent::config_builder()
        // Le TLS de Windows et ses certificats (comme « Demander à Claude »).
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .https_only(true) // une redirection vers http:// est refusée
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into();
    // On ne recopie pas le message de ureq : il pourrait contenir l'adresse.
    let mut resp = agent.get(url).call().map_err(|_| "injoignable (pas de connexion Internet ?)".to_string())?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(match status {
            401 | 403 | 404 => format!("le serveur refuse cette adresse (code {status}) : recopie l'adresse secrète iCal"),
            _ => format!("le serveur a répondu {status}, nouvel essai dans 15 minutes"),
        });
    }
    let text = resp
        .body_mut()
        .with_config()
        .limit(MAX_FILE_BYTES)
        .read_to_string()
        .map_err(|_| "réponse illisible ou trop grosse (plus de 20 Mo)".to_string())?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("ce lien ne renvoie pas un agenda iCal (.ics) : prends l'« adresse secrète au format iCal »".into());
    }
    Ok(text)
}

/// Faut-il relire ? Oui si la liste des fichiers ou une date de modification a changé.
fn needs_reload(known: &[(PathBuf, Option<SystemTime>)], paths: &[String]) -> bool {
    let same_list = known.len() == paths.len() && known.iter().zip(paths).all(|((p, _), raw)| p.as_path() == std::path::Path::new(raw));
    !(same_list && known.iter().all(|(p, m)| modified(p) == *m))
}

/// Lit tous les fichiers : (fichiers lus, leurs événements réunis, erreurs).
fn load_files(ctx: &ModuleContext, paths: &[String]) -> (Vec<Loaded>, Vec<Event>, Vec<String>) {
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
    let events = files.iter_mut().flat_map(|f| std::mem::take(&mut f.events)).collect();
    (files, events, errors)
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

fn version_of(upcoming: &[Value], errors: &[String], online_error: &Option<String>) -> String {
    let mut h = DefaultHasher::new();
    serde_json::to_string(upcoming).unwrap_or_default().hash(&mut h);
    errors.hash(&mut h);
    online_error.hash(&mut h);
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
