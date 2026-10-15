// Module « Jeux » (1.2.5) : la progression de l'aquarium de gouttes.
//
// Les jeux eux-mêmes (Puissance 4, Morpion express, Course de gouttes) sont
// entièrement dans le front (src/modules/games/). Le Rust tient seulement ce
// qui doit durer : les gouttes, les objets achetés, la tenue d'Ondine dans
// l'aquarium et quelques compteurs (parties gagnées, perdues, nulles), dans
// %APPDATA%\Ondine\games.json (fichier temporaire renommé : jamais à moitié
// écrit ; un fichier abîmé est mis de côté, comme weekly.json). Que des
// nombres et des identifiants : ni texte de tâche, ni nom de projet.
//
// Les gouttes arrivent toutes seules, du bus :
//   - "agents.event" {kind: "done"} : un agent IA a fini sa tâche ;
//   - "pauses.taken" : une vraie pause (module Pauses), au plus une toutes
//     les 20 minutes ;
//   - "timer.work-session" {completed: true} : un Pomodoro mené au bout ;
// et des parties (commande `result`, barème fixé ici, pas par le front).
// Le barème et le catalogue sont dans src/modules/games/aquarium.json, lu
// aussi par le front. Au plus `dailyCap` gouttes par jour (150) : l'aquarium
// grandit avec le travail, sans course au score. Mode démo : rien n'est compté.
// Après chaque changement : "games.changed" {drops, gained, reason}, pour
// l'onglet (aucune notification ici).

use crate::sync::LockExt;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::BusMessage;
use crate::services::log;

const ID: &str = "games";

/// Le catalogue et le barème, partagés avec le front.
const CATALOG_JSON: &str = include_str!("../../../src/modules/games/aquarium.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// "decor", "head", "eyes" ou "neck".
    pub kind: String,
    pub price: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub daily_cap: u32,
    pub pause_gap_mins: u64,
    pub rewards: BTreeMap<String, u32>,
    pub items: Vec<Item>,
}

impl Catalog {
    pub fn load() -> Self {
        // Le fichier est dans le dépôt : un test vérifie qu'il se lit.
        serde_json::from_str(CATALOG_JSON).unwrap_or(Catalog { daily_cap: 0, pause_gap_mins: 20, rewards: BTreeMap::new(), items: vec![] })
    }

    fn item(&self, id: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }
}

/// Gagnées, perdues, nulles (pour la course : « draw » = 2e place).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Tally {
    pub win: u32,
    pub lose: u32,
    pub draw: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    pub connect4: Tally,
    pub ttt: Tally,
    pub race: Tally,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Wear {
    pub head: String,
    pub eyes: String,
    pub neck: String,
}

impl Default for Wear {
    fn default() -> Self {
        Self { head: "none".into(), eyes: "none".into(), neck: "none".into() }
    }
}

/// Tout ce qui est enregistré dans games.json (et rendu au front par `state`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    pub drops: u32,
    pub earned: u64,
    pub today: u32,
    /// Le jour de `today` (« 2026-10-15 », heure du PC).
    pub day: String,
    pub owned: Vec<String>,
    pub wear: Wear,
    pub stats: Stats,
    /// La dernière pause comptée (secondes depuis 1970).
    pub last_pause: u64,
}

impl Data {
    /// Écarte ce qu'un fichier ancien ou modifié à la main pourrait contenir
    /// d'inattendu (objets inconnus, tenue non achetée).
    pub fn clean(mut self, cat: &Catalog) -> Self {
        let mut owned: Vec<String> = Vec::new();
        for id in std::mem::take(&mut self.owned) {
            if cat.item(&id).is_some() && !owned.contains(&id) {
                owned.push(id);
            }
        }
        self.owned = owned;
        let fix = |id: &mut String, slot: &str, owned: &[String]| {
            let ok = id == "none" || (owned.contains(id) && cat.item(id).is_some_and(|i| i.kind == slot));
            if !ok {
                *id = "none".into();
            }
        };
        fix(&mut self.wear.head, "head", &self.owned);
        fix(&mut self.wear.eyes, "eyes", &self.owned);
        fix(&mut self.wear.neck, "neck", &self.owned);
        self
    }
}

/// Ajoute la récompense `key` : le compte du jour repart à zéro un nouveau
/// jour et ne dépasse jamais le plafond ; une pause trop proche de la
/// précédente ne compte pas. Renvoie le gain (0 : rien n'a changé).
pub fn reward(d: &mut Data, cat: &Catalog, key: &str, day: &str, now_secs: u64) -> u32 {
    if d.day != day {
        d.day = day.to_string();
        d.today = 0;
    }
    let want = cat.rewards.get(key).copied().unwrap_or(0);
    if key == "pause" {
        if now_secs.saturating_sub(d.last_pause) < cat.pause_gap_mins * 60 {
            return 0;
        }
        d.last_pause = now_secs;
    }
    let gained = want.min(cat.daily_cap.saturating_sub(d.today));
    d.drops = d.drops.saturating_add(gained);
    d.earned = d.earned.saturating_add(u64::from(gained));
    d.today = d.today.saturating_add(gained);
    gained
}

/// Le nom de la récompense d'une partie (comme `rewardKey` du front).
pub fn reward_key(cat: &Catalog, game: &str, outcome: &str, level: &str) -> Option<String> {
    if game == "race" {
        return matches!(outcome, "win" | "second").then(|| format!("race-{outcome}"));
    }
    if !matches!(game, "connect4" | "ttt") || !matches!(outcome, "win" | "draw") {
        return None;
    }
    let key = format!("{game}-{outcome}-{level}");
    cat.rewards.contains_key(&key).then_some(key)
}

/// Note le résultat d'une partie (compteurs) et sa récompense. Erreur pour un jeu inconnu.
pub fn record_result(d: &mut Data, cat: &Catalog, game: &str, outcome: &str, level: &str, day: &str, now_secs: u64) -> Result<u32, String> {
    let tally = match game {
        "connect4" => &mut d.stats.connect4,
        "ttt" => &mut d.stats.ttt,
        "race" => &mut d.stats.race,
        other => return Err(format!("jeu inconnu : {other}")),
    };
    match outcome {
        "win" => tally.win = tally.win.saturating_add(1),
        "draw" | "second" => tally.draw = tally.draw.saturating_add(1),
        "lose" => tally.lose = tally.lose.saturating_add(1),
        other => return Err(format!("résultat inconnu : {other}")),
    }
    Ok(reward_key(cat, game, outcome, level).map_or(0, |k| reward(d, cat, &k, day, now_secs)))
}

/// Achète un objet. Un accessoire acheté est porté tout de suite.
pub fn buy(d: &mut Data, cat: &Catalog, id: &str) -> Result<(), String> {
    let item = cat.item(id).ok_or("Objet inconnu")?;
    if d.owned.iter().any(|o| o == id) {
        return Err("Déjà à vous".into());
    }
    if d.drops < item.price {
        return Err("Pas assez de gouttes".into());
    }
    d.drops -= item.price;
    d.owned.push(id.to_string());
    match item.kind.as_str() {
        "head" => d.wear.head = id.to_string(),
        "eyes" => d.wear.eyes = id.to_string(),
        "neck" => d.wear.neck = id.to_string(),
        _ => {}
    }
    Ok(())
}

/// Ondine met (ou retire, « none ») un accessoire qu'elle a.
pub fn wear(d: &mut Data, cat: &Catalog, slot: &str, id: &str) -> Result<(), String> {
    if id != "none" {
        let ok = d.owned.iter().any(|o| o == id) && cat.item(id).is_some_and(|i| i.kind == slot);
        if !ok {
            return Err("Accessoire pas encore acheté".into());
        }
    }
    let target = match slot {
        "head" => &mut d.wear.head,
        "eyes" => &mut d.wear.eyes,
        "neck" => &mut d.wear.neck,
        other => return Err(format!("emplacement inconnu : {other}")),
    };
    *target = id.to_string();
    Ok(())
}

/// La récompense apportée par un message du bus (None : rien à compter).
pub fn bus_reward(topic: &str, payload: &Value) -> Option<&'static str> {
    match topic {
        "agents.event" => (payload.get("kind").and_then(Value::as_str) == Some("done")).then_some("agent-done"),
        "pauses.taken" => Some("pause"),
        "timer.work-session" => (payload.get("completed").and_then(Value::as_bool) == Some(true)).then_some("pomodoro"),
        _ => None,
    }
}

// ── Le module ────────────────────────────────────────────────────────────────

pub struct Games {
    data: Arc<Mutex<Data>>,
    catalog: Catalog,
}

impl Default for Games {
    fn default() -> Self {
        Self { data: Arc::new(Mutex::new(Data::default())), catalog: Catalog::load() }
    }
}

impl RustModule for Games {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/games/manifest.json")
    }

    fn start(&self, _app: &AppHandle) {
        *self.data.locked() = load().clean(&self.catalog);
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("").to_string();
        let (state, changed) = {
            let mut d = self.data.locked();
            let changed = match command {
                "state" => None,
                "result" => {
                    let game = text("game");
                    let gained = record_result(&mut d, &self.catalog, &game, &text("outcome"), &text("level"), &today(), now_secs())?;
                    Some(json!({ "drops": d.drops, "gained": gained, "reason": game }))
                }
                "buy" => {
                    buy(&mut d, &self.catalog, &text("id"))?;
                    Some(json!({ "drops": d.drops, "gained": 0, "reason": "buy" }))
                }
                "wear" => {
                    wear(&mut d, &self.catalog, &text("slot"), &text("id"))?;
                    Some(json!({ "drops": d.drops, "gained": 0, "reason": "wear" }))
                }
                other => return Err(format!("commande inconnue : {other}")),
            };
            // Un petit fichier : enregistré tout de suite (comme weekly.rs).
            if changed.is_some() {
                store(&d);
            }
            (json!(*d), changed)
        };
        // Le verrou est rendu avant de publier.
        if let Some(payload) = changed {
            ctx.emit("games.changed", payload);
        }
        Ok(state)
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        let Some(key) = bus_reward(&msg.topic, &msg.payload) else { return };
        // Mode démo : rien n'est fait pour de vrai, rien n'est compté.
        if ctx.app.state::<crate::Shared>().settings.locked().general.demo {
            return;
        }
        let (gained, drops) = {
            let mut d = self.data.locked();
            (reward(&mut d, &self.catalog, key, &today(), now_secs()), d.drops)
        };
        if gained == 0 {
            return;
        }
        ctx.emit("games.changed", json!({ "drops": drops, "gained": gained, "reason": key }));
        // Le bus arrive sur le thread de l'interface : l'écriture se fait à
        // côté, avec les données du moment (toujours les plus récentes).
        let data = Arc::clone(&self.data);
        std::thread::spawn(move || store(&data.locked()));
    }
}

/// « 2026-10-15 » : le jour du PC (heure locale).
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn file() -> PathBuf {
    platform::config_dir().join("games.json")
}

/// Relit le fichier. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Data {
    let Ok(text) = std::fs::read_to_string(file()) else { return Data::default() };
    match serde_json::from_str::<Data>(&text) {
        Ok(d) => d,
        Err(e) => {
            let aside = platform::config_dir().join(format!("games.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("{ID} : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Data::default()
        }
    }
}

/// Enregistre via un fichier temporaire renommé (jamais de fichier à moitié écrit).
fn save(d: &Data) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    let tmp = dir.join("games.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

fn store(d: &Data) {
    if let Err(e) = save(d) {
        log::warn(format!("{ID} : enregistrement impossible : {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: &str = "2026-10-15";

    #[test]
    fn catalog_reads_and_matches_the_wardrobe() {
        let cat = Catalog::load();
        assert!(cat.daily_cap > 0 && !cat.items.is_empty() && !cat.rewards.is_empty());
        // Les accessoires sont ceux que la goutte gomme sait dessiner (gum-draw.ts).
        for i in &cat.items {
            let known: &[&str] = match i.kind.as_str() {
                "decor" => continue,
                "head" => &["cap", "straw", "tophat", "beanie", "crown", "bow"],
                "eyes" => &["round", "sun", "heart"],
                "neck" => &["pearls", "bowtie", "scarf"],
                other => panic!("type inconnu : {other}"),
            };
            assert!(known.contains(&i.id.as_str()), "{} : accessoire inconnu", i.id);
            assert!(i.price > 0);
        }
    }

    #[test]
    fn agents_pauses_and_pomodoros_bring_drops() {
        let cat = Catalog::load();
        let mut d = Data::default();
        assert_eq!(bus_reward("agents.event", &json!({ "kind": "done" })), Some("agent-done"));
        assert_eq!(bus_reward("agents.event", &json!({ "kind": "waiting" })), None);
        assert_eq!(bus_reward("timer.work-session", &json!({ "seconds": 1500, "completed": true })), Some("pomodoro"));
        assert_eq!(bus_reward("timer.work-session", &json!({ "seconds": 200, "completed": false })), None);
        assert_eq!(bus_reward("notes.changed", &json!({})), None);
        assert_eq!(reward(&mut d, &cat, "agent-done", DAY, 1000), cat.rewards["agent-done"]);
        assert_eq!(d.drops, d.today);
        assert_eq!(d.earned, u64::from(d.drops));
    }

    #[test]
    fn pauses_count_once_per_gap() {
        let cat = Catalog::load();
        let mut d = Data::default();
        let t = 1_000_000;
        assert!(reward(&mut d, &cat, "pause", DAY, t) > 0);
        assert_eq!(reward(&mut d, &cat, "pause", DAY, t + 60), 0);
        assert!(reward(&mut d, &cat, "pause", DAY, t + cat.pause_gap_mins * 60) > 0);
    }

    #[test]
    fn daily_cap_then_a_new_day() {
        let cat = Catalog::load();
        let mut d = Data::default();
        for _ in 0..200 {
            reward(&mut d, &cat, "agent-done", DAY, 0);
        }
        assert_eq!(d.today, cat.daily_cap);
        assert_eq!(d.drops, cat.daily_cap);
        assert_eq!(reward(&mut d, &cat, "agent-done", DAY, 0), 0);
        // Le lendemain, ça repart.
        assert!(reward(&mut d, &cat, "agent-done", "2026-10-16", 0) > 0);
        assert_eq!(d.day, "2026-10-16");
    }

    #[test]
    fn game_results_follow_the_table() {
        let cat = Catalog::load();
        let mut d = Data::default();
        assert_eq!(record_result(&mut d, &cat, "connect4", "win", "hard", DAY, 0), Ok(cat.rewards["connect4-win-hard"]));
        assert_eq!(record_result(&mut d, &cat, "connect4", "lose", "hard", DAY, 0), Ok(0));
        assert_eq!(record_result(&mut d, &cat, "ttt", "draw", "hard", DAY, 0), Ok(cat.rewards["ttt-draw-hard"]));
        assert_eq!(record_result(&mut d, &cat, "ttt", "draw", "easy", DAY, 0), Ok(0));
        assert_eq!(record_result(&mut d, &cat, "race", "second", "", DAY, 0), Ok(cat.rewards["race-second"]));
        // Le front ne choisit pas le montant : un niveau inventé ne rapporte rien.
        assert_eq!(record_result(&mut d, &cat, "connect4", "win", "dieu", DAY, 0), Ok(0));
        assert!(record_result(&mut d, &cat, "echecs", "win", "hard", DAY, 0).is_err());
        assert_eq!(d.stats.connect4, Tally { win: 2, lose: 1, draw: 0 });
        assert_eq!(d.stats.ttt.draw, 2);
        assert_eq!(d.stats.race.draw, 1);
    }

    #[test]
    fn buying_and_wearing() {
        let cat = Catalog::load();
        let mut d = Data { drops: 30, ..Data::default() };
        assert_eq!(buy(&mut d, &cat, "inconnu"), Err("Objet inconnu".into()));
        assert_eq!(buy(&mut d, &cat, "crown"), Err("Pas assez de gouttes".into()));
        buy(&mut d, &cat, "cap").unwrap();
        assert_eq!(d.wear.head, "cap");
        assert_eq!(buy(&mut d, &cat, "cap"), Err("Déjà à vous".into()));
        assert_eq!(d.drops, 30 - cat.item("cap").unwrap().price);
        buy(&mut d, &cat, "algues").unwrap();
        assert!(wear(&mut d, &cat, "head", "crown").is_err());
        assert!(wear(&mut d, &cat, "eyes", "cap").is_err());
        wear(&mut d, &cat, "head", "none").unwrap();
        assert_eq!(d.wear.head, "none");
    }

    #[test]
    fn a_strange_file_is_cleaned() {
        let cat = Catalog::load();
        let raw = r#"{"drops":12,"owned":["cap","cap","licorne"],"wear":{"head":"cap","eyes":"sun","neck":"x"},"bizarre":true}"#;
        let d: Data = serde_json::from_str::<Data>(raw).unwrap().clean(&cat);
        assert_eq!(d.owned, vec!["cap".to_string()]);
        assert_eq!(d.wear, Wear { head: "cap".into(), eyes: "none".into(), neck: "none".into() });
        assert_eq!(d.drops, 12);
    }

    #[test]
    fn file_round_trip() {
        let d = Data { drops: 7, earned: 40, day: DAY.into(), owned: vec!["cap".into()], ..Data::default() };
        let text = serde_json::to_string(&d).unwrap();
        assert!(text.contains("\"lastPause\""));
        assert_eq!(serde_json::from_str::<Data>(&text).unwrap(), d);
    }
}
