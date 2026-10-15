// La dictée partout : ce qui reste sur le PC, dans un seul fichier,
// %APPDATA%\Ondine\dictation.json :
//   - l'historique des dictées (gardé le nombre de jours choisi, « keepDays ») ;
//   - les chiffres de chaque jour (mots, temps de parole, applis), gardés
//     même quand une dictée s'efface ;
//   - le dictionnaire (noms bien écrits, remplacements) ;
//   - les styles par appli.
// Rien ne part sur Internet. Écriture par un fichier temporaire renommé ; un
// fichier abîmé est mis de côté (dictation.broken.json), jamais effacé.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::dictation_text::{self as text, AppStyle, Replacement, Style};

/// L'historique : au plus ce nombre de dictées (les plus anciennes partent).
const MAX_HISTORY: usize = 2000;
/// Une dictée : au plus ce nombre de caractères gardés.
const MAX_TEXT: usize = 20_000;
/// Le dictionnaire : au plus ce nombre de noms et de remplacements.
pub const MAX_WORDS: usize = 500;
pub const MAX_STYLES: usize = 100;

/// Une dictée de l'historique.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    /// Millisecondes depuis 1970.
    pub at: u64,
    pub text: String,
    /// L'appli où elle a été collée (« Outlook »), si on la connaît.
    #[serde(default)]
    pub app: Option<String>,
    pub words: u64,
    /// Le temps de parole (secondes).
    pub seconds: f64,
    #[serde(default)]
    pub hands_free: bool,
}

/// Les chiffres d'un jour.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DayStats {
    pub words: u64,
    pub seconds: f64,
    pub dictations: u64,
    pub hands_free: u64,
    /// Nom de l'appli → mots dictés ce jour-là.
    pub apps: BTreeMap<String, u64>,
}

/// Le dictionnaire : les noms toujours bien écrits, et les remplacements.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Words {
    pub words: Vec<String>,
    pub replacements: Vec<Replacement>,
}

/// Le fichier entier.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Data {
    pub version: u32,
    pub history: Vec<Entry>,
    /// « 2026-10-15 » → les chiffres de ce jour.
    pub days: BTreeMap<String, DayStats>,
    pub words: Words,
    pub styles: Vec<AppStyle>,
    next_id: u64,
}

impl Default for Data {
    fn default() -> Self {
        Self { version: 1, history: Vec::new(), days: BTreeMap::new(), words: Words::default(), styles: text::default_app_styles(), next_id: 1 }
    }
}

pub struct Store {
    pub data: Data,
    /// Quand l'historique n'est pas gardé, la dernière dictée attend quand
    /// même ici (en mémoire seulement), pour « recoller ».
    last_unkept: Option<String>,
    folder: PathBuf,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

impl Store {
    pub fn load_from(folder: PathBuf) -> Store {
        let file = folder.join("dictation.json");
        let data = match std::fs::read_to_string(&file) {
            Err(_) => Data::default(),
            Ok(raw) => match serde_json::from_str::<Data>(&raw) {
                Ok(d) => d,
                Err(e) => {
                    let aside = folder.join("dictation.broken.json");
                    let _ = std::fs::rename(&file, &aside);
                    crate::services::log::warn(format!("dictée : fichier illisible ({e}), mis de côté dans {}", aside.display()));
                    Data::default()
                }
            },
        };
        let mut store = Store { data, last_unkept: None, folder };
        store.data.next_id = store.data.next_id.max(store.data.history.iter().map(|e| e.id + 1).max().unwrap_or(1));
        store
    }

    pub fn load() -> Store {
        Self::load_from(crate::platform::config_dir())
    }

    /// Écrit d'abord un fichier temporaire puis le renomme.
    pub fn save(&self) {
        let write = || -> Result<(), String> {
            std::fs::create_dir_all(&self.folder).map_err(|e| e.to_string())?;
            let json = serde_json::to_string_pretty(&self.data).map_err(|e| e.to_string())?;
            let tmp = self.folder.join("dictation.json.tmp");
            std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, self.folder.join("dictation.json")).map_err(|e| e.to_string())
        };
        if let Err(e) = write() {
            crate::services::log::warn(format!("dictée : enregistrement impossible : {e}"));
        }
    }

    /// Note une dictée : les chiffres du jour, et l'historique si on le garde.
    /// Renvoie la dictée gardée (None : rien de dit, ou historique coupé).
    #[allow(clippy::too_many_arguments)]
    pub fn record(&mut self, said: &str, app: Option<&str>, seconds: f64, hands_free: bool, keep: Option<u64>, day: NaiveDate, now: u64) -> Option<Entry> {
        let words = text::word_count(said);
        if words == 0 {
            return None;
        }
        let d = self.data.days.entry(text::day_key(day)).or_default();
        d.words += words;
        d.seconds += seconds.max(0.0);
        d.dictations += 1;
        if hands_free {
            d.hands_free += 1;
        }
        if let Some(app) = app.filter(|a| !a.trim().is_empty()) {
            *d.apps.entry(app.to_string()).or_default() += words;
        }
        let entry = if keep == Some(0) {
            self.last_unkept = Some(said.to_string());
            None
        } else {
            let text: String = said.chars().take(MAX_TEXT).collect();
            let entry = Entry { id: self.data.next_id, at: now, text, app: app.map(String::from), words, seconds, hands_free };
            self.data.next_id += 1;
            self.data.history.insert(0, entry.clone());
            self.last_unkept = None;
            Some(entry)
        };
        self.prune(keep, now);
        self.save();
        entry
    }

    /// Retire les dictées plus vieilles que `keep` jours (None : on garde tout).
    /// Renvoie vrai si quelque chose a été retiré.
    pub fn prune(&mut self, keep: Option<u64>, now: u64) -> bool {
        let before = self.data.history.len();
        if let Some(days) = keep {
            let limit = now.saturating_sub(days * 86_400_000);
            self.data.history.retain(|e| days > 0 && e.at >= limit);
        }
        self.data.history.truncate(MAX_HISTORY);
        self.data.history.len() != before
    }

    /// La dernière dictée, pour « recoller ».
    pub fn last_text(&self) -> Option<String> {
        self.last_unkept.clone().or_else(|| self.data.history.first().map(|e| e.text.clone()))
    }

    pub fn delete(&mut self, id: u64) -> bool {
        let before = self.data.history.len();
        self.data.history.retain(|e| e.id != id);
        let changed = self.data.history.len() != before;
        if changed {
            self.save();
        }
        changed
    }

    /// Vide l'historique ; avec `stats`, les chiffres aussi.
    pub fn clear(&mut self, stats: bool) {
        self.data.history.clear();
        self.last_unkept = None;
        if stats {
            self.data.days.clear();
        }
        self.save();
    }

    pub fn find(&self, id: u64) -> Option<&Entry> {
        self.data.history.iter().find(|e| e.id == id)
    }

    /// L'historique pour la page Dictée, filtré par `query` (sans tenir compte
    /// des majuscules), au plus `limit` dictées.
    pub fn search(&self, query: &str, limit: usize) -> Vec<&Entry> {
        let q = query.trim().to_lowercase();
        self.data
            .history
            .iter()
            .filter(|e| q.is_empty() || e.text.to_lowercase().contains(&q) || e.app.as_deref().is_some_and(|a| a.to_lowercase().contains(&q)))
            .take(limit)
            .collect()
    }

    /// Le dictionnaire, nettoyé (vides, doublons, longueurs) avant d'être gardé.
    pub fn set_words(&mut self, words: Words) {
        let mut seen = HashSet::new();
        let list: Vec<String> = words
            .words
            .into_iter()
            .map(|w| w.trim().chars().take(80).collect::<String>())
            .filter(|w| !w.is_empty() && seen.insert(w.to_lowercase()))
            .take(MAX_WORDS)
            .collect();
        let mut n = 0u64;
        let replacements: Vec<Replacement> = words
            .replacements
            .into_iter()
            .map(|r| Replacement { id: String::new(), from: r.from.trim().chars().take(120).collect(), to: r.to.trim().chars().take(400).collect() })
            .filter(|r| !text::tokens(&r.from).is_empty())
            .take(MAX_WORDS)
            .map(|mut r| {
                n += 1;
                r.id = n.to_string();
                r
            })
            .collect();
        self.data.words = Words { words: list, replacements };
        self.save();
    }

    /// Les styles par appli, nettoyés.
    pub fn set_styles(&mut self, styles: Vec<AppStyle>) {
        let mut seen = HashSet::new();
        self.data.styles = styles
            .into_iter()
            .map(|s| AppStyle { id: clean_app_id(&s.id), name: s.name.trim().chars().take(60).collect(), style: s.style })
            .filter(|s| !s.id.is_empty() && seen.insert(s.id.clone()))
            .map(|mut s| {
                if s.name.is_empty() {
                    s.name = text::display_name(&s.id);
                }
                s
            })
            .take(MAX_STYLES)
            .collect();
        self.save();
    }

    pub fn style_for(&self, app: Option<&str>, default: Style) -> Style {
        text::style_for(&self.data.styles, app, default)
    }

    /// Les jours d'affilée avec au moins un mot dicté.
    pub fn streak(&self, today: NaiveDate) -> u32 {
        let days: HashSet<String> = self.data.days.iter().filter(|(_, d)| d.words > 0).map(|(k, _)| k.clone()).collect();
        text::streak(&days, today)
    }

    /// Les chiffres depuis `from` (None : depuis toujours).
    pub fn totals(&self, from: Option<NaiveDate>) -> Value {
        let from = from.map(text::day_key);
        let (mut words, mut seconds, mut dictations, mut hands_free) = (0u64, 0.0f64, 0u64, 0u64);
        let mut apps: BTreeMap<&str, u64> = BTreeMap::new();
        for (key, d) in &self.data.days {
            if from.as_ref().is_some_and(|f| key < f) {
                continue;
            }
            words += d.words;
            seconds += d.seconds;
            dictations += d.dictations;
            hands_free += d.hands_free;
            for (app, n) in &d.apps {
                *apps.entry(app).or_default() += n;
            }
        }
        let mut apps: Vec<(&str, u64)> = apps.into_iter().collect();
        apps.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        json!({
            "words": words,
            "seconds": seconds,
            "dictations": dictations,
            "handsFree": hands_free,
            "wordsPerMinute": text::words_per_minute(words, seconds),
            "minutesSaved": text::minutes_saved(words, seconds),
            "apps": apps.iter().take(8).map(|(a, n)| json!([a, n])).collect::<Vec<_>>(),
        })
    }

    /// Tout ce que montrent les Statistiques (et les tuiles de la page Dictée).
    pub fn stats(&self, today: NaiveDate) -> Value {
        let back = |n: u64| today.checked_sub_days(chrono::Days::new(n)).unwrap_or(today);
        let daily: Vec<Value> = (0..30u64)
            .rev()
            .map(|n| {
                let key = text::day_key(back(n));
                json!([key, self.data.days.get(&key).map(|d| d.words).unwrap_or(0)])
            })
            .collect();
        json!({
            "week": self.totals(Some(back(6))),
            "month": self.totals(Some(back(29))),
            "all": self.totals(None),
            "daily": daily,
            "streak": self.streak(today),
            "typingWpm": text::TYPING_WORDS_PER_MINUTE,
        })
    }
}

/// Un nom de programme : « Outlook.EXE » → « outlook ».
pub fn clean_app_id(id: &str) -> String {
    let id = id.trim().to_lowercase();
    let id = id.strip_suffix(".exe").unwrap_or(&id);
    id.chars().filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.')).take(64).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ondine-dictee-{}-{}", std::process::id(), now_ms()));
        (Store::load_from(dir.clone()), dir)
    }

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    #[test]
    fn a_dictation_counts_and_is_kept_for_the_chosen_days() {
        let (mut s, dir) = temp();
        let now = 1_800_000_000_000;
        let e = s.record("bonjour à tous", Some("Slack"), 2.0, false, Some(30), day(15), now).unwrap();
        assert_eq!(e.words, 3);
        assert!(s.record("?", None, 1.0, false, Some(30), day(15), now).is_none());
        assert_eq!(s.data.history.len(), 1);
        assert_eq!(s.data.days["2026-10-15"].words, 3);
        assert_eq!(s.data.days["2026-10-15"].apps["Slack"], 3);
        assert_eq!(s.streak(day(15)), 1);
        // Plus vieille que 30 jours : partie de l'historique, encore dans les chiffres.
        assert!(s.prune(Some(30), now + 31 * 86_400_000));
        assert!(s.data.history.is_empty());
        assert_eq!(s.totals(None)["words"], 3);
        // Historique coupé : la dernière dictée attend quand même pour « recoller ».
        assert!(s.record("encore un mot", None, 1.0, true, Some(0), day(15), now).is_none());
        assert_eq!(s.last_text().as_deref(), Some("encore un mot"));
        assert_eq!(s.data.days["2026-10-15"].hands_free, 1);
        // Toujours : rien ne part.
        s.record("une autre dictée", None, 1.0, false, None, day(15), now);
        assert!(!s.prune(None, now + 1000 * 86_400_000));
        // Enregistré sur le disque et relu.
        let again = Store::load_from(dir.clone());
        assert_eq!(again.data.days["2026-10-15"].dictations, 3);
        assert_eq!(again.data.history.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn search_delete_and_clear() {
        let (mut s, dir) = temp();
        let now = now_ms();
        let a = s.record("Penser au certificat du serveur", Some("Notes"), 3.0, false, Some(30), day(14), now).unwrap();
        s.record("Bonjour Marc", Some("Outlook"), 1.0, false, Some(30), day(15), now);
        assert_eq!(s.search("CERTIF", 10).len(), 1);
        assert_eq!(s.search("outlook", 10).len(), 1);
        assert_eq!(s.search("", 1).len(), 1);
        assert!(s.delete(a.id));
        assert!(!s.delete(a.id));
        assert_eq!(s.data.history.len(), 1);
        s.clear(false);
        assert!(s.data.history.is_empty());
        assert_eq!(s.totals(None)["words"], 7);
        s.clear(true);
        assert_eq!(s.totals(None)["words"], 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_statistics_add_up_per_period() {
        let (mut s, dir) = temp();
        let now = now_ms();
        // 120 mots en 1 min aujourd'hui (Outlook), 40 il y a dix jours (Slack), 10 il y a deux mois.
        s.record(&"mot ".repeat(120), Some("Outlook"), 60.0, false, Some(30), day(15), now);
        s.record(&"mot ".repeat(40), Some("Slack"), 30.0, true, Some(30), day(5), now);
        s.record(&"mot ".repeat(10), None, 10.0, false, Some(30), NaiveDate::from_ymd_opt(2026, 8, 15).unwrap(), now);
        let v = s.stats(day(15));
        assert_eq!(v["week"]["words"], 120);
        assert_eq!(v["week"]["wordsPerMinute"], 120);
        assert_eq!(v["month"]["words"], 160);
        assert_eq!(v["month"]["handsFree"], 1);
        assert_eq!(v["all"]["words"], 170);
        assert_eq!(v["all"]["dictations"], 3);
        assert_eq!(v["month"]["apps"][0], json!(["Outlook", 120]));
        assert_eq!(v["daily"].as_array().unwrap().len(), 30);
        assert_eq!(v["daily"][29], json!(["2026-10-15", 120]));
        assert_eq!(v["streak"], 1);
        // 120 mots en 1 min : 3 min au clavier, 2 de gagnées.
        assert!((v["week"]["minutesSaved"].as_f64().unwrap() - 2.0).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_dictionary_and_styles_are_cleaned_before_being_kept() {
        let (mut s, dir) = temp();
        s.set_words(Words {
            words: vec![" Supabase ".into(), "supabase".into(), "".into(), "Ondine".into()],
            replacements: vec![
                Replacement { id: "x".into(), from: "cloud code".into(), to: "Claude Code".into() },
                Replacement { id: "y".into(), from: " !! ".into(), to: "rien".into() },
            ],
        });
        assert_eq!(s.data.words.words, vec!["Supabase", "Ondine"]);
        assert_eq!(s.data.words.replacements.len(), 1);
        assert_eq!(s.data.words.replacements[0].id, "1");
        s.set_styles(vec![
            AppStyle { id: "Notepad.EXE".into(), name: "".into(), style: Style::Polished },
            AppStyle { id: "notepad".into(), name: "x".into(), style: Style::Verbatim },
            AppStyle { id: "  ".into(), name: "x".into(), style: Style::Verbatim },
        ]);
        assert_eq!(s.data.styles.len(), 1);
        assert_eq!(s.data.styles[0].id, "notepad");
        assert_eq!(s.data.styles[0].name, "Bloc-notes");
        assert_eq!(s.style_for(Some("notepad"), Style::Natural), Style::Polished);
        assert_eq!(s.style_for(Some("outlook"), Style::Natural), Style::Natural);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_broken_file_is_set_aside() {
        let dir = std::env::temp_dir().join(format!("ondine-dictee-broken-{}-{}", std::process::id(), now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("dictation.json"), "{ pas du json").unwrap();
        let s = Store::load_from(dir.clone());
        assert!(s.data.history.is_empty());
        assert!(!s.data.styles.is_empty());
        assert!(dir.join("dictation.broken.json").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
