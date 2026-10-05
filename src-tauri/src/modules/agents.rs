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
// Il lance aussi Claude Code : « cmd /k claude » dans un dossier de projet
// choisi dans les réglages (ou avec la boîte « Choisir un dossier »), validé
// par `check_path`. Seul le mot « claude » est tapé : aucun texte venu
// d'ailleurs n'est ajouté à la ligne de commande.
//
// Sécurité : ce qui arrive par le canal est du TEXTE À AFFICHER, rien de plus.
// On n'exécute rien, on ne suit aucun chemin, on n'ouvre rien. Les textes sont
// tronqués, le dossier du projet est réduit à son nom. Le texte que tu tapes
// dans Claude (« prompt ») n'est jamais lu. Le journal ne note que le type
// d'événement, jamais son contenu. L'historique reste en mémoire (perdu à la
// fermeture de l'île).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::services::bus::BusMessage;
use crate::cli::MAX_MESSAGE;
use crate::platform;
use crate::services::{files, log};

const ID: &str = "agents";
const MAX_HISTORY: usize = 30;
const MAX_TEXT: usize = 300;
/// Une session de Claude sans nouvelles depuis ce temps est considérée finie
/// (si on l'a interrompue, Claude Code n'envoie pas toujours « Stop »).
const SESSION_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Une session finie (ou muette) disparaît du tableau après ce temps.
const SESSION_FORGET: Duration = Duration::from_secs(2 * 60 * 60);
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
    /// La session (« outil:numéro ») : sert au bouton « Y aller ».
    session: String,
}

/// Une session d'agent, pour le tableau « En cours ».
#[derive(Debug, Clone, Serialize)]
struct Session {
    id: String,
    source: String,
    project: String,
    /// "working" (au travail), "waiting" (t'attend), "done" (a fini), "idle"
    /// (plus de nouvelles depuis longtemps).
    state: &'static str,
    /// Depuis quand (ms) elle est dans cet état.
    since: u64,
    #[serde(skip)]
    updated: Option<Instant>,
    /// Pour retrouver sa fenêtre : les programmes au-dessus du hook, et sa console.
    #[serde(skip)]
    pids: Vec<u32>,
    #[serde(skip)]
    hwnd: isize,
}

#[derive(Default)]
struct State {
    history: VecDeque<Event>,
    /// Les sessions connues, par identifiant.
    sessions: HashMap<String, Session>,
    /// Arrivées récentes (limite de débit).
    recent: VecDeque<Instant>,
}

impl State {
    fn working(&self) -> usize {
        self.sessions.values().filter(|s| s.state == "working").count()
    }
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
        // Le fil qui range les sessions muettes depuis longtemps.
        let (a, s) = (app.clone(), self.state.clone());
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            let emptied = {
                let mut st = s.lock().unwrap();
                let before = st.working();
                for session in st.sessions.values_mut() {
                    let quiet = session.updated.map_or(true, |t| t.elapsed() >= SESSION_TIMEOUT);
                    if session.state == "working" && quiet {
                        session.state = "idle"; // interrompue sans « Stop », sans doute
                    }
                }
                st.sessions.retain(|_, s| s.updated.is_some_and(|t| t.elapsed() < SESSION_FORGET));
                before > 0 && st.working() == 0
            };
            if emptied {
                super::with_context(&a, ID, |ctx| ctx.emit("claude.done", Value::Null));
            }
        });
    }

    /// "agents.launch" `{tool?, index?}` : le lanceur demande un agent.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic != "agents.launch" {
            return;
        }
        let get = |k: &str| msg.payload.get(k).cloned().unwrap_or(Value::Null);
        if let Err(e) = self.invoke(ctx, "launch", json!({ "tool": get("tool"), "index": get("index") })) {
            ctx.log_warn(format!("agent demandé par le lanceur : {e}"));
        }
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "history" => {
                let st = self.state.lock().unwrap();
                Ok(json!({ "events": st.history, "working": st.working(), "sessions": sorted_sessions(&st) }))
            }
            // { session } : fait passer devant la fenêtre de cette session.
            "focus" => {
                let id = args.get("session").and_then(Value::as_str).ok_or("session manquante")?;
                let (hwnd, pids) = {
                    let st = self.state.lock().unwrap();
                    let s = st.sessions.get(id).ok_or("session inconnue (terminée ?)")?;
                    (s.hwnd, s.pids.clone())
                };
                platform::focus_agent_window(hwnd, &pids)?;
                Ok(Value::Null)
            }
            // La configuration à coller dans Claude Code (avec le chemin de CE programme).
            "hook_config" => Ok(json!({ "exe": exe_path() })),
            // { tool: "claude-code" | "codex" | "gemini" }
            "copy_config" => {
                ctx.require("clipboard")?;
                let tool = args.get("tool").and_then(Value::as_str).unwrap_or("claude-code");
                files::copy_text(&hook_config(tool, &exe_path())?)?;
                Ok(Value::Null)
            }
            // Les projets du réglage (ceux qui existent encore) et les agents
            // proposés, pour les boutons.
            "projects" => {
                let list = projects(ctx);
                let tools = tools(ctx);
                // Le lanceur s'en sert aussi (seulement le numéro et le nom).
                ctx.emit(
                    "agents.projects",
                    json!({ "tools": tools, "projects": list.iter().enumerate().map(|(i, p)| json!({ "index": i, "name": folder_name(p) })).collect::<Vec<_>>() }),
                );
                Ok(json!({ "tools": tools, "projects": list.iter().map(|p| json!({ "path": p.display().to_string(), "name": folder_name(p) })).collect::<Vec<_>>() }))
            }
            // { tool, path? | index? } : ouvre cet agent dans ce dossier.
            "launch" => {
                let tool = Tool::parse(args.get("tool").and_then(Value::as_str).unwrap_or("claude"))?;
                let dir = match (args.get("path").and_then(Value::as_str), args.get("index").and_then(Value::as_u64)) {
                    (Some(path), _) => folder_of(ctx.check_path(path)?),
                    (None, Some(i)) => projects(ctx).into_iter().nth(i as usize).ok_or("projet introuvable")?,
                    (None, None) => projects(ctx).into_iter().next().unwrap_or_else(platform::home_dir),
                };
                launch(ctx, tool, &dir)?;
                Ok(json!({ "dir": dir.display().to_string() }))
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

// ── Lancer un agent (Claude Code, Codex, Gemini CLI) ───────────────────────────────────────────────────────

/// Les dossiers de projets du réglage, validés (les disparus sont ignorés).
fn projects(ctx: &ModuleContext) -> Vec<PathBuf> {
    let settings = ctx.settings();
    let raw = settings.get("projects").and_then(Value::as_array).cloned().unwrap_or_default();
    raw.iter().filter_map(Value::as_str).filter_map(|p| ctx.check_path(p).ok()).filter(|p| p.is_dir()).take(8).collect()
}

/// Les agents qu'on sait lancer. Seul ce mot est tapé dans la console.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Tool {
    Claude,
    Codex,
    Gemini,
}

impl Tool {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "claude" => Ok(Self::Claude),
            "codex" => Ok(Self::Codex),
            "gemini" => Ok(Self::Gemini),
            other => Err(format!("agent inconnu : {other}")),
        }
    }

    /// La commande tapée (claude.exe / claude.cmd, codex.cmd, gemini.cmd… : cmd trouve).
    fn word(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
        }
    }
}

/// Les agents proposés (réglages « Proposer … »), dans l'ordre.
fn tools(ctx: &ModuleContext) -> Vec<&'static str> {
    let settings = ctx.settings();
    let on = |k: &str| settings.get(k).and_then(Value::as_bool).unwrap_or(true);
    [("claude", "launchClaude"), ("codex", "launchCodex"), ("gemini", "launchGemini")]
        .into_iter()
        .filter(|(_, key)| on(key))
        .map(|(t, _)| t)
        .collect()
}

fn launch(ctx: &ModuleContext, tool: Tool, dir: &Path) -> Result<(), String> {
    ctx.require("files")?;
    let in_wt = ctx.settings().get("claudeIn").and_then(Value::as_str) == Some("wt");
    let (program, args) = agent_command(tool, dir, in_wt);
    // La console doit pouvoir passer devant l'île.
    platform::forget_previous_foreground();
    platform::spawn_console(program, &args, dir)?;
    ctx.log_info(format!("ouvre {} dans {}", tool.word(), dir.display()));
    Ok(())
}

/// « cmd /k claude » (ou codex, gemini) : cmd trouve le programme dans le
/// PATH (.exe ou .cmd d'une installation npm), et la fenêtre reste ouverte
/// s'il n'est pas installé (on lit alors le message d'erreur de Windows).
fn agent_command(tool: Tool, dir: &Path, in_wt: bool) -> (&'static str, Vec<String>) {
    let cmd = ["cmd.exe".to_string(), "/k".into(), tool.word().into()];
    // Windows Terminal lit « ; » comme un séparateur de commandes : un dossier
    // qui en contient s'ouvre dans une console classique.
    if in_wt && !dir.display().to_string().contains(';') {
        let mut args = vec!["-d".to_string(), dir.display().to_string()];
        args.extend(cmd);
        ("wt.exe", args)
    } else {
        ("cmd.exe", cmd[1..].to_vec())
    }
}

fn folder_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.display().to_string())
}

/// Un dossier reste lui-même ; un fichier donne le dossier qui le contient.
fn folder_of(path: PathBuf) -> PathBuf {
    if path.is_dir() {
        return path;
    }
    path.parent().map(Path::to_path_buf).unwrap_or(path)
}

/// Le tableau : d'abord celles qui t'attendent, puis au travail, puis le reste ;
/// les plus récentes d'abord.
fn sorted_sessions(st: &State) -> Vec<Session> {
    let rank = |s: &Session| match s.state {
        "waiting" => 0,
        "working" => 1,
        "done" => 2,
        _ => 3,
    };
    let mut list: Vec<Session> = st.sessions.values().cloned().collect();
    list.sort_by(|a, b| rank(a).cmp(&rank(b)).then(b.since.cmp(&a.since)));
    list
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
    // Où est sa fenêtre ? (de simples numéros ; rien n'est lancé avec)
    let pids: Vec<u32> = msg["pids"].as_array().into_iter().flatten().filter_map(Value::as_u64).filter_map(|p| u32::try_from(p).ok()).take(8).collect();
    let hwnd = msg["hwnd"].as_i64().unwrap_or(0) as isize;

    // Qui est au travail ? (la mascotte réfléchit tant qu'au moins une session travaille)
    let (started, finished) = {
        let mut st = state.lock().unwrap();
        let was_busy = st.working() > 0;
        if event.kind == "ended" {
            st.sessions.remove(&event.session);
        } else if event.kind != "info" {
            let state_name = match event.kind {
                "working" => "working",
                "waiting" => "waiting",
                _ => "done",
            };
            let entry = st.sessions.entry(event.session.clone()).or_insert_with(|| Session {
                id: event.session.clone(),
                source: event.source.clone(),
                project: event.project.clone(),
                state: state_name,
                since: event.at,
                updated: None,
                pids: vec![],
                hwnd: 0,
            });
            if entry.state != state_name {
                entry.state = state_name;
                entry.since = event.at;
            }
            if !event.project.is_empty() {
                entry.project = event.project.clone();
            }
            if !pids.is_empty() || hwnd != 0 {
                entry.pids = pids;
                entry.hwnd = hwnd;
            }
            entry.updated = Some(Instant::now());
        }
        let busy = st.working() > 0;
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
                ctx.emit("task.finished", json!({ "label": event.title }));
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
        // Le tableau des sessions a peut-être changé.
        ctx.emit("agents.changed", Value::Null);
    });
}

/// Le message reçu → un événement à afficher (None : rien à faire).
///
/// Trois outils compris (`source`) :
///   - claude-code : hooks UserPromptSubmit, Notification, Stop, SessionEnd ;
///   - codex : hooks UserPromptSubmit, PermissionRequest, Stop, SessionEnd,
///     et l'ancien réglage `notify` (JSON « agent-turn-complete ») ;
///   - gemini : hooks BeforeAgent, Notification (ToolPermission), AfterAgent,
///     SessionEnd.
/// Les textes de l'utilisateur (prompt) et les réponses de l'IA ne sont
/// jamais lus.
fn understand(msg: &Value, at: u64) -> Option<Event> {
    let text = |v: &Value| clean(v.as_str().unwrap_or(""), MAX_TEXT);
    let source = {
        let s: String = msg["source"].as_str().unwrap_or("outil").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(30).collect();
        if s.is_empty() { "outil".to_string() } else { s.to_lowercase() }
    };
    let hook = &msg["hook"];
    let session = hook["session_id"].as_str().or(hook["thread-id"].as_str()).unwrap_or(&source);
    let mut ev = Event {
        at,
        source: source.clone(),
        kind: "info",
        title: text(&msg["title"]),
        body: text(&msg["message"]),
        project: project_name(hook["cwd"].as_str().unwrap_or("")),
        session: format!("{source}:{}", clean(session, 80)),
    };
    let who = match source.as_str() {
        "claude-code" => "Claude",
        "codex" => "Codex",
        "gemini" => "Gemini",
        _ => "L'agent",
    };
    let done = |ev: &mut Event| {
        ev.kind = "done";
        ev.title = format!("{who} a fini");
    };

    // L'ancien `notify` de Codex : pas de hook_event_name, mais un « type ».
    let event = hook["hook_event_name"].as_str().or(match hook["type"].as_str() {
        Some("agent-turn-complete") => Some("Stop"),
        _ => None,
    });

    match event {
        // Pas de hook : un message libre (« island.exe notify --title … --message … »).
        None => {
            if hook.is_object() {
                return None; // un JSON inconnu : ignoré
            }
            if ev.title.is_empty() && ev.body.is_empty() {
                return None;
            }
            if ev.title.is_empty() {
                ev.title = std::mem::take(&mut ev.body);
            }
        }
        // Au travail (le texte tapé n'est PAS lu).
        Some("UserPromptSubmit") | Some("BeforeAgent") => ev.kind = "working",
        // A fini (la réponse de l'IA n'est PAS lue).
        Some("Stop") | Some("AfterAgent") => done(&mut ev),
        Some("SessionEnd") => ev.kind = "ended",
        // Codex demande une autorisation : on affiche quel outil, sans décider à ta place.
        Some("PermissionRequest") => {
            ev.kind = "waiting";
            ev.title = format!("{who} attend ta permission");
            let tool = text(&hook["tool_name"]);
            ev.body = if tool.is_empty() { String::new() } else { format!("pour {tool}") };
        }
        Some("Notification") => {
            ev.kind = "waiting";
            let message = text(&hook["message"]);
            let ntype = hook["notification_type"].as_str().unwrap_or("");
            let lower = message.to_lowercase();
            ev.title = match ntype {
                "permission_prompt" | "ToolPermission" => format!("{who} attend ta permission"),
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

/// La configuration à coller, pour chaque outil.
fn hook_config(tool: &str, exe: &str) -> Result<String, String> {
    match tool {
        "claude-code" => Ok(claude_config(exe)),
        "codex" => Ok(codex_config(exe)),
        "gemini" => Ok(gemini_config(exe)),
        other => Err(format!("outil inconnu : {other}")),
    }
}

/// Claude Code (settings.json). Forme « programme + paramètres » (`command` +
/// `args`) : Claude Code lance directement island.exe, sans Git Bash ni
/// PowerShell, donc rien à échapper dans le chemin (même avec des espaces).
fn claude_config(exe: &str) -> String {
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

/// Codex (config.toml). Ses hooks sont lancés par cmd.exe (`cmd /C …`) : le
/// chemin entre guillemets doubles. En TOML, la chaîne est écrite avec ses
/// « \ » et « " » échappés.
fn codex_config(exe: &str) -> String {
    let command = format!("\"{exe}\" notify --source codex");
    let toml = format!("\"{}\"", command.replace('\\', "\\\\").replace('"', "\\\""));
    let mut out = String::from("# Island : Codex prévient l'île (à coller dans %USERPROFILE%\\.codex\\config.toml)\n");
    for event in ["UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"] {
        out.push_str(&format!("\n[[hooks.{event}]]\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {toml}\n"));
    }
    out
}

/// Gemini CLI (settings.json). Ses hooks sont lancés par PowerShell : `&` pour
/// lancer un programme dont le chemin est entre apostrophes (une apostrophe
/// dans le chemin se double), et `$input |` pour lui passer le JSON reçu.
fn gemini_config(exe: &str) -> String {
    let command = format!("$input | & '{}' notify --source gemini", exe.replace('\'', "''"));
    let entry = json!([{ "matcher": "*", "hooks": [{ "name": "island", "type": "command", "command": command, "timeout": 5000 }] }]);
    let config = json!({
        "hooks": {
            "BeforeAgent": entry,
            "AfterAgent": entry,
            "Notification": entry,
            "SessionEnd": entry,
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
        assert_eq!((e.kind, e.title.as_str(), e.project.as_str(), e.session.as_str()), ("waiting", "Claude attend ta permission", "Island", "claude-code:s1"));
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
    fn agent_command_lines() {
        let dir = Path::new(r"C:\Projets\Mon appli");
        assert_eq!(agent_command(Tool::Claude, dir, false), ("cmd.exe", vec!["/k".to_string(), "claude".to_string()]));
        let (p, a) = agent_command(Tool::Codex, dir, true);
        assert_eq!((p, a[1].as_str(), a[2].as_str(), a[4].as_str()), ("wt.exe", r"C:\Projets\Mon appli", "cmd.exe", "codex"));
        assert_eq!(agent_command(Tool::Gemini, Path::new(r"C:\a;b"), true).0, "cmd.exe");
        assert!(Tool::parse("calc").is_err());
    }

    #[test]
    fn other_tools_are_understood() {
        let codex = |v: Value| understand(&json!({ "source": "codex", "hook": v }), 0);
        let e = codex(json!({ "type": "agent-turn-complete", "thread-id": "t1", "cwd": "C:\\p\\api", "last-assistant-message": "secret" })).unwrap();
        assert_eq!((e.kind, e.title.as_str(), e.session.as_str()), ("done", "Codex a fini", "codex:t1"));
        assert!(!e.body.contains("secret"));
        let e = codex(json!({ "hook_event_name": "PermissionRequest", "tool_name": "Bash", "tool_input": { "command": "rm -rf /" } })).unwrap();
        assert_eq!((e.title.as_str(), e.body.as_str()), ("Codex attend ta permission", "pour Bash"));
        let gem = |v: Value| understand(&json!({ "source": "gemini", "hook": v }), 0);
        assert_eq!(gem(json!({ "hook_event_name": "AfterAgent", "prompt_response": "x" })).unwrap().title, "Gemini a fini");
        assert_eq!(gem(json!({ "hook_event_name": "Notification", "notification_type": "ToolPermission", "message": "Allow?" })).unwrap().title, "Gemini attend ta permission");
        assert_eq!(gem(json!({ "hook_event_name": "BeforeAgent", "prompt": "x" })).unwrap().kind, "working");
        assert!(gem(json!({ "type": "inconnu" })).is_none());
    }

    #[test]
    fn codex_and_gemini_configs() {
        let exe = r"C:\Program Files\Island\island.exe";
        let c = codex_config(exe);
        assert!(c.contains(r#"command = "\"C:\\Program Files\\Island\\island.exe\" notify --source codex""#), "{c}");
        assert!(c.contains("[[hooks.PermissionRequest.hooks]]"));
        let g: Value = serde_json::from_str(&gemini_config(r"C:\Users\O'Neil\island.exe")).unwrap();
        assert_eq!(g["hooks"]["AfterAgent"][0]["hooks"][0]["command"], r"$input | & 'C:\Users\O''Neil\island.exe' notify --source gemini");
        assert!(hook_config("chatgpt-web", exe).is_err());
    }

    #[test]
    fn config_runs_the_exe_with_args() {
        let c: Value = serde_json::from_str(&claude_config(r"C:\Program Files\Island\island.exe")).unwrap();
        let h = &c["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(h["command"], r"C:\Program Files\Island\island.exe");
        assert_eq!(h["args"], json!(["notify", "--source", "claude-code"]));
    }
}
