// Module « Agenda » : les prochains rendez-vous de plusieurs calendriers,
// chacun avec un nom et une couleur choisis dans les réglages du module :
//   - un fichier .ics (export d'Outlook, Google Agenda, Thunderbird…) ;
//   - ou un lien iCal (l'« adresse secrète » d'un agenda en ligne).
// La liste des calendriers et sa migration sont dans services/ics_calendars.rs.
//
// Un thread regarde toutes les 15 secondes :
//   - si un fichier a changé (date de modification) : il est relu ;
//   - un lien iCal est retéléchargé toutes les 15 minutes (ou tout de suite
//     si son adresse a changé) : lecture seule, rien n'est envoyé ;
//   - les rendez-vous de tous les calendriers sont fusionnés et triés ; si la
//     liste a changé, "agenda.changed" est publié ;
//   - si un rendez-vous commence bientôt (réglage « rappel ») :
//     "agenda.reminder" est publié, une seule fois par rendez-vous ;
//   - si une réunion en ligne (Teams, Meet, Zoom, Webex) commence dans moins
//     de 2 min (réglage « joinMin ») : "agenda.join", une seule fois par
//     rendez-vous, à la place du rappel s'ils tombent ensemble. « Rejoindre »
//     (commande "join") ouvre le lien, publie "media.pause" et dit si le
//     micro est coupé.
//
// Comme pour les notes, les messages du bus ne contiennent pas le texte des
// rendez-vous : le front le demande avec la commande "upcoming". Rien n'est
// écrit dans le journal à part le nom du fichier ou du calendrier en cas d'erreur.
//
// Les adresses iCal restent dans le Gestionnaire d'identifiants (une clé par
// calendrier) : elles n'apparaissent jamais dans settings.json, le journal,
// les messages d'erreur ni l'interface.
//
// Un clic sur un rendez-vous ouvre son lien (commande "open") : seulement un
// lien http(s) trouvé dans le .ics (voir ics::event_link). Le front ne donne
// que le calendrier et la clé du rendez-vous ; l'adresse est reprise ici.

use crate::sync::LockExt;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use chrono::{Local, NaiveDateTime, TimeZone};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::platform::audio::{self, Device};
use crate::services::credentials::{self, ICAL_URL};
use crate::services::ics::{self, Event, Occurrence};
use crate::services::ics_calendars::{self, Calendar, Source, LEGACY_LINK_ID};
use crate::services::log;
use crate::services::perf::{self, Loop};

const ID: &str = "agenda";
/// Un .ics plus gros est refusé (un agenda de plusieurs années tient en 1 à 5 Mo).
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// Combien de jours à l'avance on regarde (réglage « horizonDays »), et combien de rendez-vous au plus.
const HORIZON_DEFAULT: i64 = 60;
const MAX_UPCOMING: usize = 30;
/// Un lien iCal est retéléchargé à cet intervalle.
const ONLINE_EVERY: Duration = Duration::from_secs(15 * 60);

/// Ce qu'on a lu d'un calendrier.
#[derive(Default)]
struct Loaded {
    /// Fichier : son chemin et sa date de modification au moment de la lecture.
    path: Option<String>,
    modified: Option<SystemTime>,
    /// Lien : une empreinte de l'adresse (pas l'adresse : si elle change, on
    /// retélécharge) et l'heure du dernier téléchargement (réussi ou non).
    url_key: u64,
    fetched_at: Option<Instant>,
    /// Les événements (dernière lecture réussie). Partagés (Arc) pour faire
    /// les calculs sans garder le verrou.
    events: Arc<Vec<Event>>,
    /// Le dernier problème (affiché dans l'onglet, sans jamais l'adresse).
    error: Option<String>,
}

#[derive(Default)]
struct State {
    /// Les calendriers des réglages, dans leur ordre.
    calendars: Vec<Calendar>,
    /// Ce qu'on a lu de chacun (clé : identifiant du calendrier).
    loaded: HashMap<String, Loaded>,
    /// La dernière liste publiée (pour ne publier que les changements).
    upcoming: Vec<Value>,
    /// Les liens des rendez-vous affichés : « calendrier/clé » → adresse.
    /// Gardés ici : le front sait seulement qu'il y a un lien.
    links: HashMap<String, String>,
    /// Les rendez-vous déjà rappelés (leur clé).
    reminded: HashSet<String>,
    /// Les réunions pour lesquelles « Rejoindre » a déjà été proposé (leur clé).
    joined: HashSet<String>,
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

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "upcoming" => Ok(listing(&self.state.locked())),
            // Bouton « Relire » : on relit tout (fichiers et liens) tout de suite.
            // Réglages changés ({ force: false }) : seulement ce qui a changé
            // (un nouveau calendrier est lu, un retiré oublié), sans retélécharger
            // tous les liens pour un changement de couleur.
            "reload" => {
                if args.get("force").and_then(Value::as_bool).unwrap_or(true) {
                    self.state.locked().loaded.clear();
                }
                refresh(ctx, &self.state);
                Ok(listing(&self.state.locked()))
            }
            // Clic sur un rendez-vous : on ouvre son lien (navigateur, Teams, Zoom…).
            "open" => {
                open_link(&self.state, &args)?;
                Ok(Value::Null)
            }
            // « Rejoindre » une réunion : on ouvre son lien comme un clic, puis
            // on demande au module Musique de mettre en pause ce qui joue.
            // Réponse : { micMuted } (le micro par défaut de Windows est-il
            // coupé ? seulement si le module Contrôles, qui sait le rétablir,
            // est actif).
            "join" => {
                open_link(&self.state, &args)?;
                ctx.emit("media.pause", Value::Null);
                let mic_muted = super::is_active(ctx.app, "controls") && audio::get(Device::Microphone).is_ok_and(|l| l.muted);
                Ok(json!({ "micMuted": mic_muted }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// Ouvre le lien d'un rendez-vous affiché (`{calendar, key}` : le front ne
/// connaît pas l'adresse, elle est reprise ici).
fn open_link(state: &Shared, args: &Value) -> Result<(), String> {
    let text = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let url = state.locked().links.get(&link_id(&text("calendar"), &text("key"))).cloned();
    let url = url.ok_or("ce rendez-vous n'a pas de lien")?;
    // Vérifié encore une fois juste avant d'ouvrir : jamais autre chose que http(s).
    if !ics::is_web_url(&url) {
        return Err("lien refusé : seuls les liens http(s) s'ouvrent".into());
    }
    platform::shell_open(&url).map_err(|e| format!("lien non ouvert : {e}"))
}

/// Ce que renvoie la commande "upcoming".
fn listing(state: &State) -> Value {
    let loaded = |c: &Calendar| state.loaded.get(&c.id);
    let errors: Vec<String> = state.calendars.iter().filter_map(|c| Some(format!("{} : {}", c.name, loaded(c)?.error.as_ref()?))).collect();
    // Pour comprendre un agenda « vide » : combien d'événements ont été lus,
    // et la date du plus récent (un export ancien s'arrête dans le passé).
    let events = || state.calendars.iter().filter_map(loaded).flat_map(|l| l.events.iter());
    let latest = events().filter_map(|e| e.start).max().map(|t| t.format("%d/%m/%Y").to_string());
    let calendars: Vec<Value> = state
        .calendars
        .iter()
        .map(|c| {
            let kind = if matches!(c.source, Source::Link) { "link" } else { "file" };
            json!({ "id": c.id, "name": c.name, "color": c.color, "kind": kind })
        })
        .collect();
    json!({
        "events": state.upcoming,
        "errors": errors,
        "calendars": calendars,
        "read": events().count(),
        "latest": latest,
    })
}

/// La boucle du thread de fond.
fn watch(app: AppHandle, state: Shared) {
    // Un premier passage rapide, le temps que les réglages soient chargés.
    std::thread::sleep(Duration::from_secs(2));
    loop {
        // Une panique ici ne doit tuer ni le thread ni l'île.
        let step = catch_unwind(AssertUnwindSafe(|| {
            // Même module désactivé : les anciens réglages sont convertis.
            migrate_settings(&app);
            super::with_context(&app, ID, |ctx| refresh(ctx, &state))
        }));
        if step.is_err() {
            log::warn("agenda : erreur inattendue pendant la lecture, on réessaie plus tard");
        }
        // Toutes les 15 s (30 s en éco : services/perf.rs).
        std::thread::sleep(perf::every(Loop::AgendaFiles));
    }
}

// ── Migration des anciens réglages (avant 1.2) ───────────────────────────────

/// Un lien iCal des anciens réglages existe-t-il ? (sous l'ancienne clé, ou
/// déjà recopié sous celle de son calendrier)
fn legacy_link_exists() -> bool {
    credentials::get(ICAL_URL).is_some() || credentials::get(&credentials::calendar_key(LEGACY_LINK_ID)).is_some()
}

/// Anciens réglages (des fichiers "icsFiles" et UN lien iCal) → liste
/// "calendars", enregistrée une fois pour toutes. Le lien est recopié sous la
/// clé de son calendrier ; l'ancienne clé n'est effacée qu'une fois la copie
/// relue. Rien ne se perd : tant que ce n'est pas fait, `effective` lit les
/// anciens réglages comme s'ils étaient déjà convertis.
fn migrate_settings(app: &AppHandle) {
    let shared = app.state::<crate::Shared>();
    let values = shared.settings.locked().modules.get(ID).map(|m| m.values.clone()).unwrap_or_default();
    if !ics_calendars::needs_migration(&values) {
        return;
    }
    let list = ics_calendars::legacy_list(&values, legacy_link_exists());
    if list.is_empty() {
        return; // rien à convertir (premier lancement) : la liste sera créée dans les réglages
    }
    // Le lien : recopié sous sa nouvelle clé, puis l'ancienne effacée.
    if let Some(url) = credentials::get(ICAL_URL) {
        let new_key = credentials::calendar_key(LEGACY_LINK_ID);
        let copied = credentials::get(&new_key).is_some() || (credentials::set(&new_key, &url).is_ok() && credentials::get(&new_key).as_deref() == Some(url.as_str()));
        if !copied {
            // On garde l'ancienne clé (lue en secours par `link_url`) et on réessaiera.
            log::warn("agenda : le lien iCal n'a pas pu être recopié, nouvel essai plus tard");
            return;
        }
        let _ = credentials::delete(ICAL_URL);
    }
    let mut settings = shared.settings.locked().clone();
    let module = settings.modules.entry(ID.to_string()).or_default();
    // Revérifié : la liste a pu être créée entre-temps (fenêtre de réglages).
    if !ics_calendars::needs_migration(&module.values) {
        return;
    }
    module.values.insert("calendars".into(), Value::Array(list));
    module.values.remove("icsFiles");
    match crate::apply_settings(app, &shared, settings) {
        Ok(()) => log::info("agenda : anciens réglages convertis en liste de calendriers"),
        Err(e) => log::warn(format!("agenda : conversion des anciens réglages non enregistrée : {e}")),
    }
}

// ── Lecture des calendriers ──────────────────────────────────────────────────

/// Relit ce qui a changé, recalcule la liste, publie et rappelle.
fn refresh(ctx: &ModuleContext, state: &Shared) {
    let settings = ctx.settings();
    let reminder_min = settings.get("reminderMin").and_then(Value::as_i64).unwrap_or(10).clamp(0, 240);
    let join_min = settings.get("joinMin").and_then(Value::as_i64).unwrap_or(2).clamp(0, 30);
    let horizon = settings.get("horizonDays").and_then(Value::as_i64).unwrap_or(HORIZON_DEFAULT).clamp(1, 365);
    let legacy_link = ics_calendars::needs_migration(&settings) && ctx.require("credentials").is_ok() && legacy_link_exists();
    let calendars = ics_calendars::effective(&settings, legacy_link);

    // On oublie les calendriers retirés (ou dont le fichier / la sorte a changé).
    {
        let mut s = state.locked();
        s.loaded.retain(|id, l| calendars.iter().any(|c| c.id == *id && same_source(c, l)));
        s.calendars = calendars.clone();
    }
    // Lire un fichier ou télécharger peut être lent : fait sans tenir le verrou.
    for cal in &calendars {
        match &cal.source {
            Source::File(path) => refresh_file(ctx, state, cal, path),
            Source::Link => refresh_link(ctx, state, cal),
        }
    }

    // Les prochains rendez-vous de chaque calendrier, de maintenant à dans
    // `horizon` jours, fusionnés et triés (calcul hors verrou aussi).
    let events: Vec<Arc<Vec<Event>>> = {
        let s = state.locked();
        calendars.iter().map(|c| s.loaded.get(&c.id).map(|l| l.events.clone()).unwrap_or_default()).collect()
    };
    let now = Local::now().naive_local();
    let to = now + chrono::Duration::days(horizon);
    let merged = ics_calendars::merge(events.iter().map(|e| ics::occurrences(e, now, to)).collect());
    let shown = &merged[..merged.len().min(MAX_UPCOMING)];
    let upcoming: Vec<Value> = shown.iter().map(|(i, o)| to_json(&calendars[*i], o)).collect();
    let links: HashMap<String, String> =
        shown.iter().filter_map(|(i, o)| Some((link_id(&calendars[*i].id, &key_of(o)), o.link.clone()?))).collect();

    let mut s = state.locked();

    // Rappels (« Dans 10 min ») et propositions de rejoindre une réunion (« Réunion dans 2 min »).
    let st = &mut *s;
    let (reminders, joins) = due(&merged, now, reminder_min, join_min, &mut st.reminded, &mut st.joined);

    s.upcoming = upcoming;
    s.links = links;
    let errors: Vec<&String> = calendars.iter().filter_map(|c| s.loaded.get(&c.id)?.error.as_ref()).collect();
    let payload = json!({
        "count": s.upcoming.len(),
        "next": s.upcoming.first().and_then(|e| e.get("start").cloned()),
        "errors": errors.len(),
        // Change avec la liste (et les calendriers) : le front sait qu'il doit la redemander.
        "version": version_of(&s.upcoming, &errors, &calendars),
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
    for key in joins {
        ctx.emit("agenda.join", json!({ "key": key, "minutes": join_min }));
    }
}

/// Une réunion en ligne (Teams, Meet, Zoom, Webex), pas un simple lien web.
fn is_meeting(o: &Occurrence) -> bool {
    o.link.as_deref().is_some_and(|l| ics::link_kind(l) != "web")
}

/// Ce qu'il faut annoncer maintenant : (rappels, propositions de rejoindre),
/// par clé de rendez-vous. Seulement les rendez-vous à venir, pas les
/// journées entières ; le même rendez-vous dans deux calendriers compte une fois.
///   - rappel : commence dans moins de `reminder_min` minutes (0 = jamais) ;
///   - rejoindre : une réunion en ligne qui commence dans moins de `join_min`
///     minutes (0 = jamais), proposée une seule fois. Elle remplace le rappel
///     s'ils tombent ensemble, et il n'y a plus de rappel après elle.
fn due(
    merged: &[(usize, Occurrence)],
    now: NaiveDateTime,
    reminder_min: i64,
    join_min: i64,
    reminded: &mut HashSet<String>,
    joined: &mut HashSet<String>,
) -> (Vec<String>, Vec<String>) {
    let within = |o: &Occurrence, min: i64| min > 0 && o.start - now <= chrono::Duration::minutes(min);
    let (mut reminders, mut joins) = (Vec::new(), Vec::new());
    for (_, o) in merged.iter().filter(|(_, o)| !o.all_day && o.start >= now) {
        let key = key_of(o);
        if is_meeting(o) && within(o, join_min) && joined.insert(key.clone()) {
            // La proposition vaut rappel : pas de « Dans 2 min » en plus.
            reminded.insert(key.clone());
            joins.push(key);
        } else if within(o, reminder_min) && reminded.insert(key.clone()) {
            reminders.push(key);
        }
    }
    (reminders, joins)
}

/// Ce qu'on a lu correspond-il encore à ce calendrier ?
fn same_source(cal: &Calendar, loaded: &Loaded) -> bool {
    match &cal.source {
        Source::File(path) => loaded.path.as_deref() == Some(path.as_str()),
        Source::Link => loaded.path.is_none(),
    }
}

/// Un fichier .ics : relu s'il est nouveau ou si sa date de modification a changé.
fn refresh_file(ctx: &ModuleContext, state: &Shared, cal: &Calendar, path: &str) {
    let now_modified = modified(path);
    if state.locked().loaded.get(&cal.id).is_some_and(|l| l.modified == now_modified) {
        return;
    }
    let loaded = match read_file(ctx, path) {
        Ok((events, modified)) => Loaded { path: Some(path.to_string()), modified, events: Arc::new(events), ..Default::default() },
        Err(e) => {
            let name = PathBuf::from(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            ctx.log_warn(format!("agenda : {name} illisible : {e}"));
            Loaded { path: Some(path.to_string()), modified: now_modified, error: Some(e), ..Default::default() }
        }
    };
    state.locked().loaded.insert(cal.id.clone(), loaded);
}

/// L'adresse d'un lien iCal, lue dans le Gestionnaire d'identifiants. Pour le
/// calendrier issu des anciens réglages, l'ancienne clé sert de secours.
fn link_url(ctx: &ModuleContext, id: &str) -> Option<String> {
    let url = ctx.credential(&credentials::calendar_key(id)).ok().flatten();
    if url.is_none() && id == LEGACY_LINK_ID {
        return ctx.credential(ICAL_URL).ok().flatten();
    }
    url
}

/// Un lien iCal : téléchargé si c'est l'heure (ou si l'adresse a changé). Un
/// échec garde les rendez-vous déjà connus et affiche un message dans l'onglet.
fn refresh_link(ctx: &ModuleContext, state: &Shared, cal: &Calendar) {
    let Some(url) = link_url(ctx, &cal.id) else {
        // Pas (ou plus) d'adresse : on oublie ce qu'on avait téléchargé.
        let error = Some("aucun lien enregistré : ajoutez-le dans les réglages du module Agenda".to_string());
        state.locked().loaded.insert(cal.id.clone(), Loaded { error, ..Default::default() });
        return;
    };
    let key = fingerprint(&url);
    {
        let mut s = state.locked();
        let l = s.loaded.entry(cal.id.clone()).or_default();
        let due = l.url_key != key || l.fetched_at.is_none_or(|t| t.elapsed() >= ONLINE_EVERY);
        if !due {
            return;
        }
        if l.url_key != key {
            // Une autre adresse : les anciens rendez-vous ne valent plus.
            l.events = Arc::default();
            l.error = None;
        }
        // Noté AVANT de télécharger : un échec n'entraîne pas un nouvel essai toutes les 15 s.
        l.url_key = key;
        l.fetched_at = Some(Instant::now());
    }
    // Le téléchargement se fait sans tenir le verrou.
    let result = download(&url).map(|text| ics::parse(&text));
    let mut s = state.locked();
    let Some(l) = s.loaded.get_mut(&cal.id).filter(|l| l.url_key == key) else { return };
    match result {
        Ok(events) => {
            l.events = Arc::new(events);
            l.error = None;
        }
        Err(e) => {
            ctx.log_warn(format!("agenda : lien iCal « {} » non téléchargé : {e}", cal.name));
            l.error = Some(e);
        }
    }
}

/// Une empreinte de l'adresse, pour savoir si elle a changé sans la garder en mémoire.
/// Jamais 0 (0 veut dire « pas encore téléchargé »).
fn fingerprint(url: &str) -> u64 {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    h.finish().max(1)
}

/// Télécharge un agenda (https seulement, 20 Mo au plus, 30 s au plus).
/// Les messages d'erreur ne contiennent JAMAIS l'adresse.
fn download(url: &str) -> Result<String, String> {
    credentials::check_ical_url(url)?;
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
            401 | 403 | 404 => format!("le serveur refuse cette adresse (code {status}) : recopiez l'adresse secrète iCal"),
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
        return Err("ce lien ne renvoie pas un agenda iCal (.ics) : prenez l'« adresse secrète au format iCal »".into());
    }
    Ok(text)
}

/// Lit un fichier .ics : (ses événements, sa date de modification).
fn read_file(ctx: &ModuleContext, raw: &str) -> Result<(Vec<Event>, Option<SystemTime>), String> {
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
    Ok((ics::parse(&text), meta.modified().ok()))
}

fn modified(path: &str) -> Option<SystemTime> {
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

/// Comment on retrouve le lien d'un rendez-vous affiché (commande "open").
fn link_id(calendar: &str, key: &str) -> String {
    format!("{calendar}/{key}")
}

fn version_of(upcoming: &[Value], errors: &[&String], calendars: &[Calendar]) -> String {
    let mut h = DefaultHasher::new();
    serde_json::to_string(upcoming).unwrap_or_default().hash(&mut h);
    errors.hash(&mut h);
    for c in calendars {
        (&c.id, &c.name, &c.color).hash(&mut h);
    }
    format!("{:x}", h.finish())
}

fn to_json(cal: &Calendar, o: &Occurrence) -> Value {
    json!({
        "key": key_of(o),
        "title": o.summary,
        "location": o.location,
        "start": to_ms(o.start),
        "end": to_ms(o.end),
        "allDay": o.all_day,
        "calendar": cal.id,
        "calendarName": cal.name,
        "color": cal.color,
        // Seulement la SORTE de lien (« teams », « web »…) : l'adresse reste ici.
        "link": o.link.as_deref().map(ics::link_kind),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(h: u32, m: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 7).unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    fn meeting(title: &str, start: NaiveDateTime, link: Option<&str>) -> (usize, Occurrence) {
        let o = Occurrence { summary: title.into(), location: String::new(), start, end: start + chrono::Duration::minutes(30), all_day: false, link: link.map(String::from) };
        (0, o)
    }

    const TEAMS: Option<&str> = Some("https://teams.microsoft.com/l/meetup-join/abc");

    #[test]
    fn join_is_offered_once_two_minutes_before() {
        let list = [meeting("Point hebdo", at(10, 0), TEAMS)];
        let (mut reminded, mut joined) = (HashSet::new(), HashSet::new());
        // 10 min avant : le rappel habituel seulement.
        assert_eq!(due(&list, at(9, 50), 10, 2, &mut reminded, &mut joined), (vec![key_of(&list[0].1)], vec![]));
        // 5 min avant : rien de nouveau.
        assert_eq!(due(&list, at(9, 55), 10, 2, &mut reminded, &mut joined), (vec![], vec![]));
        // 2 min avant : la proposition de rejoindre, une seule fois.
        assert_eq!(due(&list, at(9, 58), 10, 2, &mut reminded, &mut joined), (vec![], vec![key_of(&list[0].1)]));
        assert_eq!(due(&list, at(9, 59), 10, 2, &mut reminded, &mut joined), (vec![], vec![]));
        // Commencé : plus rien.
        assert_eq!(due(&list, at(10, 1), 10, 2, &mut HashSet::new(), &mut HashSet::new()), (vec![], vec![]));
    }

    #[test]
    fn join_replaces_a_reminder_at_the_same_time() {
        let list = [meeting("Démo", at(10, 0), TEAMS)];
        // L'île démarre 1 min avant : une seule notification, la proposition.
        let (mut reminded, mut joined) = (HashSet::new(), HashSet::new());
        assert_eq!(due(&list, at(9, 59), 10, 2, &mut reminded, &mut joined), (vec![], vec![key_of(&list[0].1)]));
        // Rappel réglé plus court que la proposition : pas de rappel après elle.
        let (mut reminded, mut joined) = (HashSet::new(), HashSet::new());
        assert_eq!(due(&list, at(9, 58), 1, 2, &mut reminded, &mut joined).1.len(), 1);
        assert_eq!(due(&list, at(9, 59), 1, 2, &mut reminded, &mut joined), (vec![], vec![]));
    }

    #[test]
    fn only_online_meetings_and_never_at_zero() {
        let web = meeting("Lire la doc", at(10, 0), Some("https://example.com/doc"));
        let none = meeting("Café", at(10, 0), None);
        let zoom = meeting("Client", at(10, 0), Some("https://us02web.zoom.us/j/123"));
        let list = [web, none, zoom];
        let (reminders, joins) = due(&list, at(9, 59), 10, 2, &mut HashSet::new(), &mut HashSet::new());
        assert_eq!(reminders.len(), 2); // le lien web et le café : rappel normal
        assert_eq!(joins, vec![key_of(&list[2].1)]);
        // 0 = jamais : seulement les rappels.
        let (reminders, joins) = due(&list, at(9, 59), 10, 0, &mut HashSet::new(), &mut HashSet::new());
        assert_eq!((reminders.len(), joins.len()), (3, 0));
        // Une journée entière n'est jamais proposée.
        let mut all_day = meeting("Séminaire", at(10, 0), TEAMS);
        all_day.1.all_day = true;
        assert_eq!(due(&[all_day], at(9, 59), 10, 2, &mut HashSet::new(), &mut HashSet::new()), (vec![], vec![]));
    }
}
