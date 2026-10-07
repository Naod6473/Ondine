// Module « Bilan de la semaine » : chaque semaine (vendredi 17 h par défaut),
// Ondine résume dans une notification ce qui a été fait : Pomodoros terminés,
// temps de concentration (séances de travail du Minuteur), tâches cochées dans
// Notes. Seulement s'il s'est passé quelque chose.
//
// Les compteurs restent sur le PC : %APPDATA%\Ondine\weekly.json (fichier
// temporaire renommé : jamais à moitié écrit ; un fichier abîmé est mis de
// côté). Ils viennent du bus, et ne contiennent que des nombres :
//   - "timer.work-session" {seconds, completed} : une séance de travail
//     Pomodoro s'arrête (finie, en pause, passée ou remise à zéro) ;
//   - "notes.todo-toggled" {done} : une tâche cochée (ou décochée).
// Ni le texte des tâches, ni les heures ne sont notés.
//
// Une « semaine » va d'un bilan au suivant : du vendredi 17 h au vendredi 17 h
// d'après (réglages « day » et « time », heure du PC). Le front demande
// `due` toutes les minutes : le Rust répond le bilan à montrer, une seule
// fois. PC éteint à l'heure dite : le bilan sort au démarrage suivant s'il a
// lieu dans les 2 jours ; après, la semaine est oubliée. Jamais deux bilans à
// moins de 6 jours d'écart (si l'on change le jour du bilan, la semaine trop
// courte s'ajoute à la suivante).

use crate::sync::LockExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{Datelike, NaiveDateTime, NaiveTime, TimeDelta, Weekday};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::BusMessage;
use crate::services::log;

/// Le bilan sort encore au démarrage pendant ce nombre de jours après l'heure dite.
const GRACE_DAYS: i64 = 2;
/// Deux bilans sont toujours séparés d'au moins ce nombre de jours.
const MIN_GAP_DAYS: i64 = 6;
/// Une séance de travail ne dure jamais plus que ça (le Minuteur s'arrête à 2 h).
const MAX_SESSION_SECS: u64 = 4 * 3600;
/// La forme des dates du fichier : heure locale, à la minute.
const TIME_FORMAT: &str = "%Y-%m-%dT%H:%M";

/// Ce qui a été fait pendant une semaine.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tally {
    /// Séances de travail Pomodoro menées jusqu'au bout.
    pub pomodoros: u32,
    /// Temps passé en séance de travail (finie ou non), en secondes.
    pub focus_secs: u64,
    /// Tâches cochées dans Notes (moins celles décochées).
    pub todos: u32,
}

impl Tally {
    /// Rien d'important : pas de bilan (moins d'une minute de concentration ne compte pas).
    pub fn is_empty(&self) -> bool {
        self.pomodoros == 0 && self.todos == 0 && self.focus_secs < 60
    }

    fn add(&mut self, other: &Tally) {
        self.pomodoros = self.pomodoros.saturating_add(other.pomodoros);
        self.focus_secs = self.focus_secs.saturating_add(other.focus_secs);
        self.todos = self.todos.saturating_add(other.todos);
    }

    /// Ce que reçoit le front : des nombres, la concentration en minutes.
    fn to_json(&self, until: &str) -> Value {
        json!({
            "pomodoros": self.pomodoros,
            "focusMinutes": (self.focus_secs + 30) / 60,
            "todos": self.todos,
            "until": until,
        })
    }
}

/// Une semaine : ses compteurs, et l'heure de son bilan (sa fin).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Week {
    /// « 2026-10-09T17:00 » (heure locale). Vide = pas encore calculée.
    pub until: String,
    pub tally: Tally,
}

/// Tout ce qui est enregistré dans weekly.json.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    /// La semaine en cours.
    pub current: Week,
    /// Une semaine finie dont le bilan n'est pas encore sorti.
    pub closed: Option<Week>,
    /// La fin de la dernière semaine dont le bilan est sorti ("" = aucune).
    pub last_shown: String,
}

/// Quand tombe le bilan : un jour de la semaine et une heure.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Schedule {
    pub weekday: Weekday,
    /// Minutes depuis minuit (17 h = 1020).
    pub minutes: u32,
}

impl Default for Schedule {
    fn default() -> Self {
        Self { weekday: Weekday::Fri, minutes: 17 * 60 }
    }
}

impl Schedule {
    /// D'après les réglages du module : `day` ("1" = lundi … "7" = dimanche) et
    /// `time` ("17:00"). Une valeur inattendue garde le réglage par défaut.
    pub fn from_settings(values: &Map<String, Value>) -> Self {
        let mut s = Self::default();
        let day = values.get("day").and_then(Value::as_str).and_then(|d| d.parse::<u8>().ok());
        if let Some(d @ 1..=7) = day {
            s.weekday = Weekday::try_from(d - 1).unwrap_or(Weekday::Fri);
        }
        let time = values.get("time").and_then(Value::as_str).unwrap_or("");
        if let Some((h, m)) = time.split_once(':') {
            if let (Ok(h @ 0..=23), Ok(m @ 0..=59)) = (h.parse::<u32>(), m.parse::<u32>()) {
                s.minutes = h * 60 + m;
            }
        }
        s
    }
}

/// Le prochain bilan, strictement après `now`.
pub fn next_slot(now: NaiveDateTime, s: Schedule) -> NaiveDateTime {
    let today = now.date();
    let ahead = (7 + s.weekday.num_days_from_monday() - today.weekday().num_days_from_monday()) % 7;
    let time = NaiveTime::from_hms_opt(s.minutes / 60, s.minutes % 60, 0).unwrap_or(NaiveTime::MIN);
    let slot = (today + TimeDelta::days(i64::from(ahead))).and_time(time);
    if slot > now {
        slot
    } else {
        slot + TimeDelta::days(7)
    }
}

fn fmt(t: NaiveDateTime) -> String {
    t.format(TIME_FORMAT).to_string()
}

fn parse_time(text: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(text, TIME_FORMAT).ok()
}

/// Fait avancer les semaines jusqu'à `now` : une semaine finie passe dans
/// `closed` (son bilan est à montrer) et une nouvelle commence. La fin de la
/// semaine en cours suit les réglages (jour ou heure changés). Vrai si quelque
/// chose a changé (à enregistrer).
pub fn roll(d: &mut Data, now: NaiveDateTime, s: Schedule) -> bool {
    let next = fmt(next_slot(now, s));
    match parse_time(&d.current.until) {
        Some(until) if until <= now => {
            // Une ancienne semaine fermée et jamais montrée a plus de 7 jours :
            // trop tard pour elle, la nouvelle la remplace.
            let finished = std::mem::replace(&mut d.current, Week { until: next, tally: Tally::default() });
            d.closed = Some(finished);
            true
        }
        _ if d.current.until == next => false,
        _ => {
            // Première fois, date illisible, ou jour / heure du bilan changés.
            d.current.until = next;
            true
        }
    }
}

/// Le bilan à montrer maintenant, s'il y en a un : rendu une seule fois.
/// Le booléen dit si `d` a changé (à enregistrer).
pub fn take_due(d: &mut Data, now: NaiveDateTime, s: Schedule) -> (Option<Week>, bool) {
    let rolled = roll(d, now, s);
    let Some(closed) = d.closed.take() else { return (None, rolled) };
    let until = parse_time(&closed.until);
    let too_late = until.is_none_or(|u| now >= u + TimeDelta::days(GRACE_DAYS));
    if too_late || closed.tally.is_empty() {
        return (None, true);
    }
    let too_soon = parse_time(&d.last_shown).zip(until).is_some_and(|(last, u)| u - last < TimeDelta::days(MIN_GAP_DAYS));
    if too_soon {
        // Un bilan vient de sortir (jour du bilan changé) : on garde tout pour le prochain.
        d.current.tally.add(&closed.tally);
        return (None, true);
    }
    d.last_shown = closed.until.clone();
    (Some(closed), true)
}

/// Ce que le bus peut apprendre au module.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Event {
    /// Une séance de travail s'arrête, après `secs` secondes ; `completed` = menée au bout.
    Work { secs: u64, completed: bool },
    /// Une tâche cochée (`done`) ou décochée.
    Todo { done: bool },
}

impl Event {
    /// Lit un message du bus ; None pour un autre sujet ou un contenu inattendu.
    pub fn from_bus(topic: &str, payload: &Value) -> Option<Self> {
        match topic {
            "timer.work-session" => {
                let secs = payload.get("seconds").and_then(Value::as_f64).filter(|s| s.is_finite() && *s >= 0.0)?;
                let completed = payload.get("completed").and_then(Value::as_bool).unwrap_or(false);
                Some(Event::Work { secs: (secs.round() as u64).min(MAX_SESSION_SECS), completed })
            }
            "notes.todo-toggled" => Some(Event::Todo { done: payload.get("done").and_then(Value::as_bool)? }),
            _ => None,
        }
    }
}

/// Compte un événement dans la semaine en cours (après avoir fait avancer les semaines).
pub fn record(d: &mut Data, now: NaiveDateTime, s: Schedule, event: Event) {
    roll(d, now, s);
    let t = &mut d.current.tally;
    match event {
        Event::Work { secs, completed } => {
            t.focus_secs = t.focus_secs.saturating_add(secs);
            if completed {
                t.pomodoros = t.pomodoros.saturating_add(1);
            }
        }
        Event::Todo { done: true } => t.todos = t.todos.saturating_add(1),
        Event::Todo { done: false } => t.todos = t.todos.saturating_sub(1),
    }
}

// ── Le module ────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Weekly {
    data: Arc<Mutex<Data>>,
}

impl RustModule for Weekly {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/weekly/manifest.json")
    }

    fn start(&self, _app: &AppHandle) {
        *self.data.locked() = load();
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, _args: Value) -> Result<Value, String> {
        let schedule = Schedule::from_settings(&ctx.settings());
        let now = platform_now();
        let mut d = self.data.locked();
        match command {
            // Le bilan à montrer maintenant (une seule fois), ou null.
            "due" => {
                let (due, changed) = take_due(&mut d, now, schedule);
                if changed {
                    store(&d);
                }
                if due.is_some() {
                    ctx.log_info("bilan de la semaine à montrer");
                }
                Ok(due.map_or(Value::Null, |w| w.tally.to_json(&w.until)))
            }
            // La semaine en cours, sans rien consommer (bouton « Voir le bilan maintenant »).
            "peek" => {
                if roll(&mut d, now, schedule) {
                    store(&d);
                }
                Ok(d.current.tally.to_json(&d.current.until))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        let Some(event) = Event::from_bus(&msg.topic, &msg.payload) else { return };
        // Mode démo : rien n'est fait pour de vrai, rien n'est compté.
        if ctx.app.state::<crate::Shared>().settings.locked().general.demo {
            return;
        }
        let schedule = Schedule::from_settings(&ctx.settings());
        let now = platform_now();
        // Le bus arrive sur le thread de l'interface : l'écriture du fichier se fait à côté.
        let data = Arc::clone(&self.data);
        std::thread::spawn(move || {
            let mut d = data.locked();
            record(&mut d, now, schedule, event);
            store(&d);
        });
    }
}

/// L'heure du PC (heure locale, sans fuseau : les bilans suivent l'horloge de Windows).
fn platform_now() -> NaiveDateTime {
    chrono::Local::now().naive_local()
}

fn file() -> PathBuf {
    platform::config_dir().join("weekly.json")
}

/// Relit le fichier. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Data {
    let Ok(text) = std::fs::read_to_string(file()) else { return Data::default() };
    match serde_json::from_str::<Data>(&text) {
        Ok(d) => d,
        Err(e) => {
            let aside = platform::config_dir().join(format!("weekly.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("bilan de la semaine : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Data::default()
        }
    }
}

/// Enregistre via un fichier temporaire renommé (jamais de fichier à moitié écrit).
fn save(d: &Data) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    let tmp = dir.join("weekly.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

fn store(d: &Data) {
    if let Err(e) = save(d) {
        log::warn(format!("bilan de la semaine : enregistrement impossible : {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// « 2026-10-09 17:00 » → une date (le 9 octobre 2026 est un vendredi).
    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap()
    }

    fn work(secs: u64, completed: bool) -> Event {
        Event::Work { secs, completed }
    }

    const FRIDAY_5PM: Schedule = Schedule { weekday: Weekday::Fri, minutes: 17 * 60 };

    #[test]
    fn next_summary_date() {
        // Mercredi → ce vendredi ; vendredi 16 h → le jour même ; vendredi 17 h pile → la semaine d'après.
        assert_eq!(next_slot(at("2026-10-07 10:00"), FRIDAY_5PM), at("2026-10-09 17:00"));
        assert_eq!(next_slot(at("2026-10-09 16:59"), FRIDAY_5PM), at("2026-10-09 17:00"));
        assert_eq!(next_slot(at("2026-10-09 17:00"), FRIDAY_5PM), at("2026-10-16 17:00"));
        assert_eq!(next_slot(at("2026-10-10 09:00"), FRIDAY_5PM), at("2026-10-16 17:00"));
        // Lundi 8 h 30, vu un dimanche soir ; et en fin d'année.
        let monday = Schedule { weekday: Weekday::Mon, minutes: 8 * 60 + 30 };
        assert_eq!(next_slot(at("2026-10-11 22:00"), monday), at("2026-10-12 08:30"));
        assert_eq!(next_slot(at("2026-12-29 12:00"), FRIDAY_5PM), at("2027-01-01 17:00"));
    }

    #[test]
    fn schedule_from_settings() {
        assert_eq!(Schedule::from_settings(&Map::new()), FRIDAY_5PM);
        let v = json!({ "day": "1", "time": "08:30" });
        assert_eq!(Schedule::from_settings(v.as_object().unwrap()), Schedule { weekday: Weekday::Mon, minutes: 510 });
        let v = json!({ "day": "7", "time": "23:30" });
        assert_eq!(Schedule::from_settings(v.as_object().unwrap()).weekday, Weekday::Sun);
        // Valeurs inattendues : le défaut.
        let v = json!({ "day": "9", "time": "25:00" });
        assert_eq!(Schedule::from_settings(v.as_object().unwrap()), FRIDAY_5PM);
        let v = json!({ "day": 3, "time": "midi" });
        assert_eq!(Schedule::from_settings(v.as_object().unwrap()), FRIDAY_5PM);
    }

    #[test]
    fn counters_add_up_within_the_week() {
        let mut d = Data::default();
        record(&mut d, at("2026-10-05 09:00"), FRIDAY_5PM, work(25 * 60, true));
        record(&mut d, at("2026-10-05 10:00"), FRIDAY_5PM, work(10 * 60, false));
        record(&mut d, at("2026-10-06 11:00"), FRIDAY_5PM, Event::Todo { done: true });
        record(&mut d, at("2026-10-06 11:01"), FRIDAY_5PM, Event::Todo { done: true });
        record(&mut d, at("2026-10-06 11:02"), FRIDAY_5PM, Event::Todo { done: false });
        assert_eq!(d.current.until, "2026-10-09T17:00");
        assert_eq!(d.current.tally, Tally { pomodoros: 1, focus_secs: 35 * 60, todos: 1 });
        // Décocher plus qu'on n'a coché ne descend pas sous zéro.
        record(&mut d, at("2026-10-06 11:03"), FRIDAY_5PM, Event::Todo { done: false });
        record(&mut d, at("2026-10-06 11:04"), FRIDAY_5PM, Event::Todo { done: false });
        assert_eq!(d.current.tally.todos, 0);
    }

    #[test]
    fn summary_comes_once_at_the_set_time() {
        let mut d = Data::default();
        record(&mut d, at("2026-10-07 09:00"), FRIDAY_5PM, work(25 * 60, true));
        // Avant l'heure : rien.
        assert_eq!(take_due(&mut d, at("2026-10-09 16:59"), FRIDAY_5PM).0, None);
        // À l'heure : le bilan, une fois.
        let due = take_due(&mut d, at("2026-10-09 17:00"), FRIDAY_5PM).0.unwrap();
        assert_eq!(due.tally.pomodoros, 1);
        assert_eq!(due.until, "2026-10-09T17:00");
        assert_eq!(take_due(&mut d, at("2026-10-09 17:01"), FRIDAY_5PM).0, None);
        // Ce qui suit compte pour la semaine d'après.
        record(&mut d, at("2026-10-09 18:00"), FRIDAY_5PM, Event::Todo { done: true });
        assert_eq!(d.current.until, "2026-10-16T17:00");
        assert_eq!(d.current.tally.todos, 1);
        assert_eq!(d.last_shown, "2026-10-09T17:00");
    }

    #[test]
    fn nothing_happened_no_summary() {
        let mut d = Data::default();
        // Moins d'une minute de concentration : rien d'important.
        record(&mut d, at("2026-10-07 09:00"), FRIDAY_5PM, work(40, false));
        assert_eq!(take_due(&mut d, at("2026-10-09 17:05"), FRIDAY_5PM).0, None);
        assert_eq!(d.closed, None);
        // Une semaine vide n'empêche pas le bilan suivant.
        record(&mut d, at("2026-10-12 09:00"), FRIDAY_5PM, Event::Todo { done: true });
        assert!(take_due(&mut d, at("2026-10-16 17:00"), FRIDAY_5PM).0.is_some());
    }

    #[test]
    fn pc_off_at_the_set_time() {
        // Éteint vendredi 16 h, rallumé samedi 10 h : le bilan sort au démarrage.
        let mut d = Data::default();
        record(&mut d, at("2026-10-09 15:00"), FRIDAY_5PM, Event::Todo { done: true });
        let due = take_due(&mut d, at("2026-10-10 10:00"), FRIDAY_5PM).0.unwrap();
        assert_eq!(due.tally.todos, 1);
        // Rallumé 3 jours après : trop tard, la semaine est oubliée.
        let mut d = Data::default();
        record(&mut d, at("2026-10-09 15:00"), FRIDAY_5PM, Event::Todo { done: true });
        assert_eq!(take_due(&mut d, at("2026-10-11 17:00"), FRIDAY_5PM).0, None);
        assert_eq!(d.closed, None);
        assert_eq!(d.current.tally, Tally::default());
        assert_eq!(d.current.until, "2026-10-16T17:00");
        // Éteint trois semaines : rien de vieux ne ressort.
        let mut d = Data::default();
        record(&mut d, at("2026-10-07 09:00"), FRIDAY_5PM, work(1500, true));
        assert_eq!(take_due(&mut d, at("2026-10-28 09:00"), FRIDAY_5PM).0, None);
        assert_eq!(d.current.until, "2026-10-30T17:00");
    }

    #[test]
    fn once_a_week_even_if_the_day_changes() {
        let mut d = Data::default();
        record(&mut d, at("2026-10-07 09:00"), FRIDAY_5PM, work(1500, true));
        assert!(take_due(&mut d, at("2026-10-09 17:00"), FRIDAY_5PM).0.is_some());
        // Le bilan passe au samedi juste après celui du vendredi : pas de second
        // bilan le lendemain, ce qui a été fait s'ajoute à la semaine suivante.
        let saturday = Schedule { weekday: Weekday::Sat, minutes: 17 * 60 };
        record(&mut d, at("2026-10-10 09:00"), saturday, Event::Todo { done: true });
        assert_eq!(d.current.until, "2026-10-10T17:00");
        assert_eq!(take_due(&mut d, at("2026-10-10 17:00"), saturday).0, None);
        assert_eq!(d.current.until, "2026-10-17T17:00");
        assert_eq!(d.current.tally.todos, 1);
        record(&mut d, at("2026-10-12 09:00"), saturday, Event::Todo { done: true });
        let due = take_due(&mut d, at("2026-10-17 17:00"), saturday).0.unwrap();
        assert_eq!(due.tally.todos, 2);
    }

    #[test]
    fn bus_messages_are_read_carefully() {
        assert_eq!(
            Event::from_bus("timer.work-session", &json!({ "seconds": 1500, "completed": true })),
            Some(work(1500, true))
        );
        assert_eq!(Event::from_bus("timer.work-session", &json!({ "seconds": 12.6 })), Some(work(13, false)));
        // Une séance impossible est ramenée à 4 h ; un nombre négatif ou absent est ignoré.
        assert_eq!(Event::from_bus("timer.work-session", &json!({ "seconds": 1e12 })), Some(work(MAX_SESSION_SECS, false)));
        assert_eq!(Event::from_bus("timer.work-session", &json!({ "seconds": -5 })), None);
        assert_eq!(Event::from_bus("timer.work-session", &json!({})), None);
        assert_eq!(Event::from_bus("notes.todo-toggled", &json!({ "done": true })), Some(Event::Todo { done: true }));
        assert_eq!(Event::from_bus("notes.todo-toggled", &json!({ "done": "oui" })), None);
        assert_eq!(Event::from_bus("weekly.show", &Value::Null), None);
    }

    #[test]
    fn front_receives_minutes() {
        let t = Tally { pomodoros: 3, focus_secs: 75 * 60 + 40, todos: 7 };
        assert_eq!(t.to_json("2026-10-09T17:00"), json!({ "pomodoros": 3, "focusMinutes": 76, "todos": 7, "until": "2026-10-09T17:00" }));
    }

    #[test]
    fn file_survives_a_round_trip() {
        let mut d = Data::default();
        record(&mut d, at("2026-10-07 09:00"), FRIDAY_5PM, work(1500, true));
        let text = serde_json::to_string(&d).unwrap();
        assert_eq!(serde_json::from_str::<Data>(&text).unwrap(), d);
        // Un fichier d'une autre version, incomplet : les champs manquants valent zéro.
        let old: Data = serde_json::from_str(r#"{ "current": { "until": "2026-10-09T17:00" } }"#).unwrap();
        assert_eq!(old.current.tally, Tally::default());
        assert_eq!(old.closed, None);
    }
}
