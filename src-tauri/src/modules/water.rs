// Module « Eau » (1.2.5, coupé par défaut) : les verres d'eau bus dans la
// journée. Le front (src/modules/water/) fait la vue, les calculs (total du
// jour, semaine, prochain rappel) et le rappel ; ici, seulement le carnet.
//
// Le carnet reste sur le PC : %APPDATA%\Ondine\water.json (fichier temporaire
// renommé : jamais à moitié écrit ; un fichier abîmé est mis de côté). Par
// jour (heure du PC), la liste des verres : l'heure (« 09:42 ») et la taille
// en ml. Rien d'autre, et 30 jours au plus : les plus vieux sont oubliés à
// chaque verre ajouté.
//
// Commandes : "read" (le carnet), "add" {ml} (un verre maintenant), "undo"
// (retire le dernier verre du jour). Chacune renvoie le carnet à jour
// {today, days}.

use crate::sync::LockExt;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{NaiveDate, NaiveDateTime, TimeDelta};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::log;

/// Les jours gardés (aujourd'hui compris).
const KEEP_DAYS: i64 = 30;
/// Un verre : entre 5 cl et 2 L.
const MIN_ML: u32 = 50;
const MAX_ML: u32 = 2_000;
/// Au plus ce nombre de verres par jour (un carnet ne grossit jamais sans fin).
const MAX_PER_DAY: usize = 100;
const DATE_FORMAT: &str = "%Y-%m-%d";

/// Un verre bu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Glass {
    /// L'heure, « 09:42 » (heure du PC).
    pub at: String,
    pub ml: u32,
}

/// Le carnet : « 2026-10-18 » → les verres de ce jour.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Data {
    pub days: BTreeMap<String, Vec<Glass>>,
}

/// Ajoute un verre à `now`, puis oublie les jours trop vieux.
pub fn add(d: &mut Data, now: NaiveDateTime, ml: u32) {
    let glasses = d.days.entry(now.date().format(DATE_FORMAT).to_string()).or_default();
    if glasses.len() < MAX_PER_DAY {
        glasses.push(Glass { at: now.format("%H:%M").to_string(), ml });
    }
    prune(d, now.date());
}

/// Retire le dernier verre du jour ; faux s'il n'y en avait pas.
pub fn undo(d: &mut Data, today: NaiveDate) -> bool {
    let key = today.format(DATE_FORMAT).to_string();
    let Some(glasses) = d.days.get_mut(&key) else { return false };
    let removed = glasses.pop().is_some();
    if glasses.is_empty() {
        d.days.remove(&key);
    }
    removed
}

/// Garde les `KEEP_DAYS` derniers jours (et rien de daté après aujourd'hui, ni d'illisible).
pub fn prune(d: &mut Data, today: NaiveDate) {
    let oldest = today - TimeDelta::days(KEEP_DAYS - 1);
    d.days.retain(|k, v| NaiveDate::parse_from_str(k, DATE_FORMAT).is_ok_and(|day| day >= oldest && day <= today) && !v.is_empty());
}

/// Le volume demandé par le front, vérifié.
fn glass_ml(args: &Value) -> Result<u32, String> {
    match args.get("ml").and_then(Value::as_u64) {
        Some(ml) if (MIN_ML as u64..=MAX_ML as u64).contains(&ml) => Ok(ml as u32),
        _ => Err("taille de verre invalide".into()),
    }
}

/// Ce que reçoit le front.
fn to_json(d: &Data, today: NaiveDate) -> Value {
    json!({ "today": today.format(DATE_FORMAT).to_string(), "days": d.days })
}

// ── Le module ────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Water {
    data: Mutex<Option<Data>>,
}

impl RustModule for Water {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/water/manifest.json")
    }

    fn invoke(&self, _ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let now = chrono::Local::now().naive_local();
        let today = now.date();
        let mut slot = self.data.locked();
        // Lu au premier appel seulement (module coupé : le fichier n'est jamais ouvert).
        let d = slot.get_or_insert_with(load);
        match command {
            "read" => {}
            "add" => {
                add(d, now, glass_ml(&args)?);
                store(d);
            }
            "undo" => {
                if undo(d, today) {
                    store(d);
                }
            }
            other => return Err(format!("commande inconnue : {other}")),
        }
        Ok(to_json(d, today))
    }
}

fn file() -> PathBuf {
    platform::config_dir().join("water.json")
}

/// Relit le fichier. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Data {
    let Ok(text) = std::fs::read_to_string(file()) else { return Data::default() };
    match serde_json::from_str::<Data>(&text) {
        Ok(d) => d,
        Err(e) => {
            let aside = platform::config_dir().join(format!("water.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("eau : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Data::default()
        }
    }
}

/// Enregistre via un fichier temporaire renommé (jamais de fichier à moitié écrit).
fn save(d: &Data) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    let tmp = dir.join("water.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

fn store(d: &Data) {
    if let Err(e) = save(d) {
        log::warn(format!("eau : enregistrement impossible : {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn glasses_are_noted_by_day() {
        let mut d = Data::default();
        add(&mut d, at("2026-10-18 09:42"), 250);
        add(&mut d, at("2026-10-18 11:05"), 330);
        add(&mut d, at("2026-10-19 08:00"), 250);
        assert_eq!(d.days["2026-10-18"], vec![Glass { at: "09:42".into(), ml: 250 }, Glass { at: "11:05".into(), ml: 330 }]);
        assert_eq!(d.days["2026-10-19"].len(), 1);
    }

    #[test]
    fn undo_removes_the_last_glass_of_today_only() {
        let mut d = Data::default();
        add(&mut d, at("2026-10-17 10:00"), 250);
        add(&mut d, at("2026-10-18 09:00"), 250);
        add(&mut d, at("2026-10-18 10:00"), 500);
        let today = at("2026-10-18 12:00").date();
        assert!(undo(&mut d, today));
        assert_eq!(d.days["2026-10-18"], vec![Glass { at: "09:00".into(), ml: 250 }]);
        assert!(undo(&mut d, today));
        assert!(!d.days.contains_key("2026-10-18"));
        assert!(!undo(&mut d, today));
        // La veille ne bouge pas.
        assert_eq!(d.days["2026-10-17"].len(), 1);
    }

    #[test]
    fn only_thirty_days_are_kept() {
        let mut d = Data::default();
        d.days.insert("2026-09-18".into(), vec![Glass { at: "09:00".into(), ml: 250 }]);
        d.days.insert("2026-09-19".into(), vec![Glass { at: "09:00".into(), ml: 250 }]);
        d.days.insert("pas une date".into(), vec![Glass { at: "09:00".into(), ml: 250 }]);
        d.days.insert("2026-12-01".into(), vec![Glass { at: "09:00".into(), ml: 250 }]);
        add(&mut d, at("2026-10-18 09:00"), 250);
        assert_eq!(d.days.keys().collect::<Vec<_>>(), vec!["2026-09-19", "2026-10-18"]);
    }

    #[test]
    fn glass_size_is_checked() {
        assert_eq!(glass_ml(&json!({ "ml": 250 })), Ok(250));
        assert!(glass_ml(&json!({ "ml": 10 })).is_err());
        assert!(glass_ml(&json!({ "ml": 5000 })).is_err());
        assert!(glass_ml(&json!({ "ml": "250" })).is_err());
        assert!(glass_ml(&json!({})).is_err());
    }

    #[test]
    fn a_day_never_grows_forever() {
        let mut d = Data::default();
        for _ in 0..(MAX_PER_DAY + 5) {
            add(&mut d, at("2026-10-18 09:00"), 250);
        }
        assert_eq!(d.days["2026-10-18"].len(), MAX_PER_DAY);
    }

    #[test]
    fn file_survives_a_round_trip() {
        let mut d = Data::default();
        add(&mut d, at("2026-10-18 09:00"), 250);
        let text = serde_json::to_string(&d).unwrap();
        assert_eq!(serde_json::from_str::<Data>(&text).unwrap(), d);
        assert_eq!(serde_json::from_str::<Data>("{}").unwrap(), Data::default());
        let front = to_json(&d, at("2026-10-18 09:00").date());
        assert_eq!(front["today"], "2026-10-18");
        assert_eq!(front["days"]["2026-10-18"][0]["ml"], 250);
    }
}
