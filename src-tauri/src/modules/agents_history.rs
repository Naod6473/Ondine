// Agents IA : l'historique des agents gardé 7 jours, sur le PC.
//
// Chaque « a fini » et « vous attend » est noté dans
// %APPDATA%\Ondine\agents-history.json : le genre, l'outil, le NOM du dossier
// du projet, la date, la durée (de la tâche, ou de l'attente), le titre tel
// qu'Ondine l'a écrit (« Claude a fini ») et le bilan git s'il y en a un.
// Jamais le contenu des messages, jamais un chemin complet.
//
// Écrit au plus une fois par seconde (`save_soon` : un fil attend une seconde
// et écrit l'état du moment), via un fichier temporaire renommé. Relu au
// démarrage (l'onglet montre ses « Derniers messages ») et purgé des entrées
// de plus de 7 jours. Le Bilan de la semaine s'en sert (`week`) : tâches
// finies, attente, projets.
//
// Ce fichier ne dépend ni de Tauri ni du reste de l'appli : il se teste à part.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Les entrées de plus de 7 jours sont oubliées.
pub const KEEP_MS: u64 = 7 * 86_400_000;
/// Au plus ce nombre d'entrées (au-delà, les plus anciennes partent).
pub const MAX_ENTRIES: usize = 2000;
/// Deux écritures sont toujours séparées d'au moins ce temps.
const WRITE_GAP: Duration = Duration::from_secs(1);
/// Une durée impossible (horloge changée) est ramenée à ça.
const MAX_DURATION_MS: u64 = 24 * 3_600_000;

/// Le bilan git d'une fin de tâche, tel que gardé (sans le dossier).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Changes {
    pub files: usize,
    pub added: u64,
    pub removed: u64,
    pub names: Vec<String>,
}

/// Une entrée de l'historique.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Entry {
    /// Quand (ms depuis 1970).
    pub at: u64,
    /// "done" (a fini) ou "waiting" (vous a attendu).
    pub kind: String,
    /// L'outil (« claude-code », « codex », « gemini »).
    pub tool: String,
    /// Le nom du dossier du projet (jamais son chemin).
    pub project: String,
    /// La durée de la tâche (« done ») ou de l'attente (« waiting »), en ms ; 0 si inconnue.
    pub duration_ms: u64,
    /// Le titre écrit par Ondine (« Claude a fini »), jamais un message de l'agent.
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<Changes>,
    /// La session (pour compléter l'entrée plus tard) : jamais écrite dans le fichier.
    #[serde(skip)]
    pub session: String,
}

/// Le fichier : une version et les entrées, les plus récentes d'abord.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Store {
    pub v: u32,
    pub entries: Vec<Entry>,
    /// Une écriture est déjà prévue (voir `save_soon`).
    #[serde(skip)]
    pending: bool,
}

/// Ce que le Bilan de la semaine reçoit.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Week {
    pub done: u32,
    pub wait_minutes: u64,
    /// Les projets touchés, les plus actifs d'abord (8 au plus).
    pub projects: Vec<String>,
}

impl Week {
    pub fn is_empty(&self) -> bool {
        self.done == 0 && self.wait_minutes == 0
    }
}

impl Store {
    /// Ajoute une entrée en tête (une durée folle est ramenée à 24 h).
    pub fn push(&mut self, mut e: Entry) {
        e.duration_ms = e.duration_ms.min(MAX_DURATION_MS);
        self.entries.insert(0, e);
        self.entries.truncate(MAX_ENTRIES);
    }

    /// Complète la dernière entrée de ce genre pour cette session (la durée
    /// d'une attente quand elle finit, le bilan git quand il arrive).
    pub fn amend(&mut self, session: &str, kind: &str, f: impl FnOnce(&mut Entry)) -> bool {
        match self.entries.iter_mut().find(|e| e.session == session && e.kind == kind) {
            Some(e) => {
                f(e);
                e.duration_ms = e.duration_ms.min(MAX_DURATION_MS);
                true
            }
            None => false,
        }
    }

    /// Oublie ce qui a plus de 7 jours (et ce qui vient du futur, horloge changée).
    pub fn purge(&mut self, now_ms: u64) {
        let oldest = now_ms.saturating_sub(KEEP_MS);
        self.entries.retain(|e| e.at >= oldest && e.at <= now_ms.saturating_add(3_600_000));
        self.entries.truncate(MAX_ENTRIES);
    }

    /// Le bilan depuis `since_ms` : tâches finies, minutes d'attente, projets.
    pub fn week(&self, since_ms: u64) -> Week {
        let mut w = Week::default();
        let mut wait_ms = 0u64;
        let mut projects: Vec<(String, u32)> = Vec::new();
        for e in self.entries.iter().filter(|e| e.at >= since_ms) {
            match e.kind.as_str() {
                "done" => w.done += 1,
                "waiting" => wait_ms += e.duration_ms,
                _ => continue,
            }
            if !e.project.is_empty() && e.project != "—" {
                match projects.iter_mut().find(|(p, _)| p == &e.project) {
                    Some((_, n)) => *n += 1,
                    None => projects.push((e.project.clone(), 1)),
                }
            }
        }
        w.wait_minutes = (wait_ms + 30_000) / 60_000;
        projects.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        w.projects = projects.into_iter().take(8).map(|(p, _)| p).collect();
        w
    }
}

/// Relit le fichier (vide s'il n'existe pas). Un fichier abîmé donne une
/// erreur : l'appelant le met de côté.
pub fn load(path: &Path) -> Result<Store, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Store { v: 1, ..Store::default() }),
        Err(e) => return Err(e.to_string()),
    };
    let mut store: Store = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    store.v = 1;
    store.entries.retain(|e| e.kind == "done" || e.kind == "waiting");
    Ok(store)
}

/// Écrit via un fichier temporaire renommé (jamais à moitié écrit).
pub fn save(path: &Path, store: &Store) -> Result<(), String> {
    let dir = path.parent().ok_or("dossier inconnu")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn lock(store: &Mutex<Store>) -> std::sync::MutexGuard<'_, Store> {
    store.lock().unwrap_or_else(|e| e.into_inner())
}

/// Écrit dans une seconde (au plus une écriture par seconde : les
/// changements qui arrivent entre-temps partent avec). `report` reçoit une
/// erreur d'écriture éventuelle.
pub fn save_soon(store: Arc<Mutex<Store>>, path: PathBuf, report: impl Fn(String) + Send + 'static) {
    {
        let mut st = lock(&store);
        if st.pending {
            return;
        }
        st.pending = true;
    }
    std::thread::spawn(move || {
        std::thread::sleep(WRITE_GAP);
        let snapshot = {
            let mut st = lock(&store);
            st.pending = false;
            st.clone()
        };
        if let Err(e) = save(&path, &snapshot) {
            report(e);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(at: u64, kind: &str, project: &str, duration_ms: u64) -> Entry {
        Entry { at, kind: kind.into(), tool: "claude-code".into(), project: project.into(), duration_ms, title: "Claude a fini".into(), changes: None, session: format!("s{at}") }
    }

    const DAY: u64 = 86_400_000;

    #[test]
    fn purge_forgets_after_seven_days() {
        let now = 10 * DAY;
        let mut s = Store::default();
        s.push(entry(now - 8 * DAY, "done", "Island", 0));
        s.push(entry(now - 7 * DAY, "done", "Island", 0)); // sept jours pile : gardé
        s.push(entry(now - DAY, "waiting", "site", 0));
        s.push(entry(now + 2 * 3_600_000, "done", "futur", 0)); // horloge changée : oublié
        s.purge(now);
        let ats: Vec<u64> = s.entries.iter().map(|e| e.at).collect();
        assert_eq!(ats, vec![now - DAY, now - 7 * DAY]);
    }

    #[test]
    fn newest_first_and_capped() {
        let mut s = Store::default();
        for i in 0..(MAX_ENTRIES as u64 + 5) {
            s.push(entry(i, "done", "p", 0));
        }
        assert_eq!(s.entries.len(), MAX_ENTRIES);
        assert_eq!(s.entries[0].at, MAX_ENTRIES as u64 + 4);
        // Une durée impossible est ramenée à 24 h.
        s.push(entry(1, "done", "p", 10 * DAY));
        assert_eq!(s.entries[0].duration_ms, MAX_DURATION_MS);
    }

    #[test]
    fn week_counts_tasks_waiting_and_projects() {
        let now = 20 * DAY;
        let mut s = Store::default();
        s.push(entry(now - 6 * DAY, "done", "Island", 5 * 60_000));
        s.push(entry(now - 2 * DAY, "done", "site-ondine", 0));
        s.push(entry(now - DAY, "waiting", "site-ondine", 70 * 60_000));
        s.push(entry(now - DAY, "waiting", "site-ondine", 60 * 60_000 + 29_000));
        s.push(entry(now - DAY, "waiting", "—", 0));
        s.push(entry(now - 8 * DAY, "done", "vieux", 0)); // hors semaine
        let w = s.week(now - 7 * DAY);
        assert_eq!(w.done, 2);
        assert_eq!(w.wait_minutes, 130);
        assert_eq!(w.projects, vec!["site-ondine".to_string(), "Island".to_string()]);
        assert!(!w.is_empty());
        assert!(Store::default().week(0).is_empty());
    }

    #[test]
    fn amend_completes_the_last_entry_of_a_session() {
        let mut s = Store::default();
        s.push(entry(1, "waiting", "p", 0));
        s.push(entry(2, "done", "p", 0));
        assert!(s.amend("s1", "waiting", |e| e.duration_ms = 42_000));
        assert_eq!(s.entries[1].duration_ms, 42_000);
        assert!(!s.amend("s9", "waiting", |_| {}));
        assert!(s.amend("s2", "done", |e| e.changes = Some(Changes { files: 2, added: 10, removed: 1, names: vec!["a.rs".into()] })));
        assert_eq!(s.entries[0].changes.as_ref().unwrap().files, 2);
    }

    #[test]
    fn file_round_trip_without_sessions() {
        let dir = std::env::temp_dir().join(format!("ondine-agents-history-{}", std::process::id()));
        let path = dir.join("agents-history.json");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&path).unwrap().entries.len(), 0);
        let mut s = Store { v: 1, ..Store::default() };
        s.push(entry(5, "done", "Island", 1000));
        s.push(entry(6, "info", "Island", 0)); // jamais relu : pas un genre gardé
        save(&path, &s).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("session"), "la session ne va pas dans le fichier");
        assert!(!text.contains("pending"));
        let back = load(&path).unwrap();
        assert_eq!(back.entries.len(), 1);
        assert_eq!(back.entries[0].project, "Island");
        assert_eq!(back.entries[0].session, "");
        // Un fichier abîmé : une erreur, pas une panique.
        std::fs::write(&path, "{ pas du json").unwrap();
        assert!(load(&path).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
