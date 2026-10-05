// Module « Agents IA » : les outils (Claude Code pour commencer) préviennent
// l'île, et l'île te prévient.
//
// Chemin d'un message :
//   hook de Claude Code → « island.exe notify --source claude-code » (cli.rs)
//   → canal local de l'île (named pipe, réservé à ton compte Windows)
//   → ce module, qui comprend l'événement et publie sur le bus :
//       agents.event      → le front affiche une notification et l'historique ;
//       claude.thinking   → la mascotte réfléchit pendant que Claude travaille ;
//       claude.done / task.finished → elle revient, contente, quand il a fini.
//
// Sécurité : ce qui arrive par le canal est du TEXTE À AFFICHER, rien de plus.
// On n'exécute rien, on ne suit aucun chemin, on n'ouvre rien. Les textes sont
// tronqués, le dossier du projet est réduit à son nom. Le texte que tu tapes
// dans Claude (« prompt ») n'est jamais lu. Le journal ne note que le type
// d'événement, jamais son contenu. L'historique reste en mémoire (perdu à la
// fermeture de l'île).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::cli::MAX_MESSAGE;
use crate::platform;
use crate::services::{files, log};

const ID: &str = "agents";
const MAX_HISTORY: usize = 30;
const MAX_TEXT: usize = 300;
/// Une session de Claude sans nouvelles depuis ce temps est considérée finie
/// (si on l'a interrompue, Claude Code n'envoie pas toujours « Stop »).
const SESSION_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Au plus ce nombre de messages par seconde (au-delà : ignorés).
const MAX_PER_SECOND: usize = 10;

/// Un événement compris, tel qu'affiché.
#[derive(Debug, Clone, Serialize, PartialEq)]
struct Event {
    at: u64,
    source: String,
    /// "waiting" (attend ta réponse), "done" (a fini), "working" (au travail,
    /// pas de notification), "info" (message libre).
    kind: &'static str,
    title: String,
    body: String,
    project: String,
    #[serde(skip)]
    session: String,
}

#[derive(Default)]
struct State {
    history: VecDeque<Event>,
    /// Sessions de Claude au travail → dernière nouvelle.
    working: HashMap<String, Instant>,
    /// Arrivées récentes (limite de débit).
    recent: VecDeque<Instant>,
}

type Shared = Arc<Mutex<State>>;

#[derive(Default)]
pub struct Agents {
    state: Shared,
}

impl RustModule for Agents {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/agents/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        // Le fil qui écoute le canal.
        let (a, s) = (app.clone(), self.state.clone());
        std::thread::spawn(move || {
            let result = platform::serve_agents_pipe(MAX_MESSAGE, |bytes| {
                let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| receive(&a, &s, &bytes)));
                if handled.is_err() {
                    log::warn("agents : message illisible ignoré");
                }
            });
            if let Err(e) = result {
                log::warn(format!("agents : {e}"));
            }
        });
        // Le fil qui oublie les sessions muettes depuis longtemps.
        let (a, s) = (app.clone(), self.state.clone());
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            let emptied = {
                let mut st = s.lock().unwrap();
                let before = st.working.len();
                st.working.retain(|_, t| t.elapsed() < SESSION_TIMEOUT);
                before > 0 && st.working.is_empty()
            };
            if emptied {
                super::with_context(&a, ID, |ctx| ctx.emit("claude.done", Value::Null));
            }
        });
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, _args: Value) -> Result<Value, String> {
        match command {
            "history" => {
                let st = self.state.lock().unwrap();
                Ok(json!({ "events": st.history, "working": st.working.len() }))
            }
            // La configuration à coller dans Claude Code (avec le chemin de CE programme).
            "hook_config" => Ok(json!({ "exe": exe_path(), "json": hook_config(&exe_path()) })),
            "copy_config" => {
                ctx.require("clipboard")?;
                files::copy_text(&hook_config(&exe_path()))?;
                Ok(Value::Null)
            }
            // « Essayer » : comme si Claude venait de finir.
            "test" => {
                let msg = json!({ "v": 1, "source": "claude-code", "hook": { "hook_event_name": "Stop", "session_id": "essai", "cwd": "C:\\Projets\\Island" } });
                receive(ctx.app, &self.state, msg.to_string().as_bytes());
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Recevoir un message ──────────────────────────────────────────────────────

fn receive(app: &AppHandle, state: &Shared, bytes: &[u8]) {
    if !super::is_active(app, ID) {
        return; // module désactivé : on ignore
    }
    {
        let mut st = state.lock().unwrap();
        st.recent.retain(|t| t.elapsed() < Duration::from_secs(1));
        if st.recent.len() >= MAX_PER_SECOND {
            return;
        }
        st.recent.push_back(Instant::now());
    }
    let Ok(msg) = serde_json::from_slice::<Value>(bytes) else { return };
    let Some(event) = understand(&msg, now_ms()) else { return };
    log::debug(format!("agents : {} ({})", event.kind, event.source));

    // Qui est au travail ? (la mascotte réfléchit tant qu'au moins une session travaille)
    let (started, finished) = {
        let mut st = state.lock().unwrap();
        let was_busy = !st.working.is_empty();
        match event.kind {
            "working" => {
                st.working.insert(event.session.clone(), Instant::now());
            }
            "done" | "ended" => {
                st.working.remove(&event.session);
            }
            "waiting" => {
                st.working.remove(&event.session); // il attend : il ne travaille plus
            }
            _ => {}
        }
        let busy = !st.working.is_empty();
        if matches!(event.kind, "waiting" | "done" | "info") {
            st.history.push_front(event.clone());
            st.history.truncate(MAX_HISTORY);
        }
        (!was_busy && busy, was_busy && !busy)
    };

    super::with_context(app, ID, |ctx| {
        let settings = ctx.settings();
        let on = |key: &str| settings.get(key).and_then(Value::as_bool).unwrap_or(true);
        if on("mascot") {
            if started {
                ctx.emit("claude.thinking", Value::Null);
            }
            if finished {
                ctx.emit("claude.done", Value::Null);
            }
            if event.kind == "done" {
                ctx.emit("task.finished", json!({ "label": "Claude a fini" }));
            }
        }
        let wanted = match event.kind {
            "waiting" => on("notifyWaiting"),
            "done" => on("notifyDone"),
            "info" => true,
            _ => false,
        };
        if wanted {
            ctx.emit("agents.event", serde_json::to_value(&event).unwrap_or(Value::Null));
        }
    });
}

/// Le message reçu → un événement à afficher (None : rien à faire).
fn understand(msg: &Value, at: u64) -> Option<Event> {
    let text = |v: &Value| clean(v.as_str().unwrap_or(""), MAX_TEXT);
    let source = {
        let s: String = msg["source"].as_str().unwrap_or("outil").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(30).collect();
        if s.is_empty() { "outil".to_string() } else { s.to_lowercase() }
    };
    let hook = &msg["hook"];
    let mut ev = Event {
        at,
        source: source.clone(),
        kind: "info",
        title: text(&msg["title"]),
        body: text(&msg["message"]),
        project: project_name(hook["cwd"].as_str().unwrap_or("")),
        session: clean(hook["session_id"].as_str().unwrap_or(&source), 80),
    };
    let who = if source == "claude-code" { "Claude" } else { "L'agent" };

    match hook["hook_event_name"].as_str() {
        // Pas de hook : un message libre (« island.exe notify --title … --message … »).
        None => {
            if ev.title.is_empty() && ev.body.is_empty() {
                return None;
            }
            if ev.title.is_empty() {
                ev.title = std::mem::take(&mut ev.body);
            }
        }
        Some("UserPromptSubmit") => ev.kind = "working", // le texte tapé n'est PAS lu
        Some("Stop") => {
            ev.kind = "done";
            ev.title = format!("{who} a fini");
        }
        Some("SessionEnd") => ev.kind = "ended",
        Some("Notification") => {
            ev.kind = "waiting";
            let message = text(&hook["message"]);
            let ntype = hook["notification_type"].as_str().unwrap_or("");
            let lower = message.to_lowercase();
            ev.title = match ntype {
                "permission_prompt" => format!("{who} attend ta permission"),
                "idle_prompt" | "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => format!("{who} attend ta réponse"),
                // Connexion réussie, quotas, réponses déjà données… : rien à signaler.
                "" => {
                    // Anciennes versions sans « notification_type » : on devine d'après le texte.
                    if lower.contains("permission") {
                        format!("{who} attend ta permission")
                    } else {
                        format!("{who} attend ta réponse")
                    }
                }
                _ => return None,
            };
            ev.body = message;
        }
        Some(_) => return None, // autres événements : ignorés pour l'instant
    }
    Some(ev)
}

/// « C:\Projets\Island » → « Island » (on n'affiche que le nom du dossier).
fn project_name(cwd: &str) -> String {
    clean(cwd.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or(""), 60)
}

/// Une ligne de texte propre : sans caractères de contrôle, pas trop longue.
fn clean(s: &str, max: usize) -> String {
    let one_line: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let trimmed = one_line.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut cut: String = trimmed.chars().take(max - 1).collect();
    cut.push('…');
    cut
}

// ── La configuration pour Claude Code ────────────────────────────────────────

fn exe_path() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

/// Le bloc « hooks » à mettre dans le settings.json de Claude Code.
///
/// Forme « programme + paramètres » (`command` + `args`) : Claude Code lance
/// directement island.exe, sans passer par Git Bash ou PowerShell, donc rien à
/// échapper dans le chemin (même avec des espaces).
fn hook_config(exe: &str) -> String {
    let entry = json!([{ "hooks": [{ "type": "command", "command": exe, "args": ["notify", "--source", "claude-code"] }] }]);
    let config = json!({
        "hooks": {
            "Notification": entry,
            "Stop": entry,
            "UserPromptSubmit": entry,
        }
    });
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hook(v: Value) -> Option<Event> {
        understand(&json!({ "v": 1, "source": "claude-code", "hook": v }), 0)
    }

    #[test]
    fn claude_events_are_understood() {
        let e = hook(json!({ "hook_event_name": "Notification", "message": "Claude needs your permission to use Bash", "session_id": "s1", "cwd": "C:\\Projets\\Island\\" })).unwrap();
        assert_eq!((e.kind, e.title.as_str(), e.project.as_str(), e.session.as_str()), ("waiting", "Claude attend ta permission", "Island", "s1"));
        let e = hook(json!({ "hook_event_name": "Notification", "notification_type": "idle_prompt", "message": "Claude is waiting for your input" })).unwrap();
        assert_eq!(e.title, "Claude attend ta réponse");
        assert!(hook(json!({ "hook_event_name": "Notification", "notification_type": "auth_success", "message": "ok" })).is_none());
        let e = hook(json!({ "hook_event_name": "Stop", "cwd": "/home/x/api" })).unwrap();
        assert_eq!((e.kind, e.title.as_str(), e.project.as_str()), ("done", "Claude a fini", "api"));
        assert!(hook(json!({ "hook_event_name": "PreToolUse" })).is_none());
    }

    #[test]
    fn the_prompt_is_never_read() {
        let e = hook(json!({ "hook_event_name": "UserPromptSubmit", "prompt": "mon mot de passe est 1234" })).unwrap();
        assert_eq!(e.kind, "working");
        assert!(!e.title.contains("1234") && !e.body.contains("1234"));
    }

    #[test]
    fn free_messages_and_cleaning() {
        let e = understand(&json!({ "source": "Ma Sauvegarde!", "message": "Terminée\nsans\terreur" }), 0).unwrap();
        assert_eq!((e.source.as_str(), e.title.as_str()), ("masauvegarde", "Terminée sans erreur"));
        assert!(understand(&json!({ "source": "x" }), 0).is_none());
        assert_eq!(clean(&"a".repeat(400), 10).chars().count(), 10);
    }

    #[test]
    fn config_runs_the_exe_with_args() {
        let c: Value = serde_json::from_str(&hook_config(r"C:\Program Files\Island\island.exe")).unwrap();
        let h = &c["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(h["command"], r"C:\Program Files\Island\island.exe");
        assert_eq!(h["args"], json!(["notify", "--source", "claude-code"]));
    }
}
