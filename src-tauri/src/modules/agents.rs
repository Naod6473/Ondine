// Module « Agents IA » : les outils (Claude Code pour commencer) préviennent
// l'île, et l'île te prévient.
//
// Chemin d'un message :
//   hook de Claude Code → « ondine.exe notify --source claude-code » (cli.rs)
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

use crate::sync::LockExt;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::agents_hooks as hooks;
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
/// Au plus ce nombre de sessions dans le tableau (au-delà, la plus ancienne part).
const MAX_SESSIONS: usize = 30;
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
    /// Les questions posées par un agent (outil MCP « ondine_ask »), en
    /// attente de ton clic, par numéro.
    asks: HashMap<u64, Ask>,
    next_ask: u64,
    /// Mode concentration : jusqu'à quand (ms ; u64::MAX = jusqu'à ce que tu
    /// l'arrêtes). Pendant ce temps, les notifications attendent dans `held`.
    quiet_until: Option<u64>,
    held: Vec<Event>,
}

impl State {
    fn quiet(&self) -> bool {
        self.quiet_until.is_some_and(|until| now_ms() < until)
    }
}

/// Une question en attente : le canal pour répondre à l'agent, et les choix.
struct Ask {
    reply: std::fs::File,
    /// "question" (outil MCP ondine_ask) ou "permission" (Autoriser / Refuser).
    kind: &'static str,
    who: String,
    question: String,
    /// Permission : ce que l'outil va faire (la commande, le fichier).
    detail: String,
    /// Les boutons affichés…
    options: Vec<String>,
    /// … et ce qui est renvoyé à l'agent pour chacun.
    answers: Vec<String>,
    /// La session de l'agent (pour « Y aller »), si connue.
    session: String,
    /// Jusqu'à quand (ms) : ensuite, l'agent reçoit « pas de réponse ».
    until: u64,
    /// Quand l'écran « Vraiment autoriser ? » a été montré (commande "arm").
    /// « Autoriser » n'est accepté qu'après, voir `allow_is_confirmed`.
    armed: Option<Instant>,
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
            let (pa, ps) = (a.clone(), s.clone());
            let result = platform::serve_agents_pipe(MAX_MESSAGE, move |bytes, reply| {
                let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| route(&pa, &ps, &bytes, reply)));
                if handled.is_err() {
                    log::warn("agents : message illisible ignoré");
                }
            });
            if let Err(e) = result {
                log::warn(format!("agents : {e}"));
                // Visible aussi dans l'île : les hooks et le serveur MCP ne
                // marcheront pas (le nom du canal est peut-être pris par un
                // autre programme). On laisse l'île finir de démarrer d'abord.
                std::thread::sleep(Duration::from_secs(3));
                let event = Event {
                    at: now_ms(),
                    source: "island".into(),
                    kind: "info",
                    title: "Agents IA : canal indisponible".into(),
                    body: "Les hooks et le serveur MCP ne peuvent pas joindre l'île. Redémarrez l'île ; si ça continue, un autre programme occupe peut-être le canal.".into(),
                    project: String::new(),
                    session: String::new(),
                };
                publish_info(&a, &s, event);
            }
        });
        // Un seul fil d'entretien : toutes les 5 s il regarde si la
        // concentration est finie, et chaque minute il range les sessions
        // muettes depuis longtemps.
        let (a, s) = (app.clone(), self.state.clone());
        let mut tick = 0u32;
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(5));
            let quiet_over = s.locked().quiet_until.is_some_and(|until| now_ms() >= until);
            if quiet_over {
                quiet_stop(&a, &s);
            }
            tick += 1;
            if !tick.is_multiple_of(12) {
                continue;
            }
            let emptied = {
                let mut st = s.locked();
                let before = st.working();
                for session in st.sessions.values_mut() {
                    let quiet = session.updated.is_none_or(|t| t.elapsed() >= SESSION_TIMEOUT);
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
                let st = self.state.locked();
                let mut asks: Vec<Value> = st
                    .asks
                    .iter()
                    .map(|(id, a)| ask_json(*id, a))
                    .collect();
                asks.sort_by_key(|a| a["id"].as_u64());
                let quiet = if st.quiet() { json!({ "until": st.quiet_until.filter(|u| *u != u64::MAX), "held": st.held.len() }) } else { Value::Null };
                Ok(json!({ "events": st.history, "working": st.working(), "sessions": sorted_sessions(&st), "asks": asks, "quiet": quiet }))
            }
            // { minutes: 0 | 25 | 60 | 120 } : la concentration (0 = jusqu'à l'arrêt).
            "quiet_start" => {
                let minutes = args.get("minutes").and_then(Value::as_u64).unwrap_or(0).min(8 * 60);
                quiet_start(&self.state, minutes);
                ctx.emit("agents.quiet", json!({ "on": true }));
                ctx.emit("agents.changed", Value::Null);
                Ok(Value::Null)
            }
            "quiet_stop" => {
                quiet_stop(ctx.app, &self.state);
                Ok(Value::Null)
            }
            // { id, choice } : ta réponse à une question d'un agent (le numéro du choix).
            "answer" => {
                let id = args.get("id").and_then(Value::as_u64).ok_or("question manquante")?;
                let choice = args.get("choice").and_then(Value::as_u64).ok_or("choix manquant")? as usize;
                let confirmed = args.get("confirmed") == Some(&Value::Bool(true));
                // « Oui, autoriser » : il faut un vrai geste (clic sur l'île, ou
                // Entrée) depuis l'écran de confirmation. Attendu hors du verrou :
                // le clic peut n'être noté qu'un tour de boucle plus tard.
                let armed = if confirmed { self.state.locked().asks.get(&id).and_then(|a| a.armed) } else { None };
                let gesture = armed.is_some_and(|at| gesture_since(ctx.app, at));
                let mut ask = {
                    let mut st = self.state.locked();
                    let ask = st.asks.get(&id).ok_or("cette question n'attend plus (délai dépassé ?)")?;
                    if choice >= ask.options.len() {
                        return Err("choix inconnu".into());
                    }
                    // Autoriser une action d'un agent : seulement après la confirmation,
                    // vérifiée ici (et pas seulement dans l'interface).
                    if ask.answers[choice] == "allow" {
                        allow_is_confirmed(confirmed, ask.armed, Instant::now())?;
                        // `armed` relu plus haut doit être le même : un nouvel « arm »
                        // entre-temps demande un nouveau geste.
                        if !gesture || ask.armed != armed {
                            ctx.log_warn("autorisation refusée : aucun clic ni Entrée dans l'île depuis la confirmation");
                            return Err("autorisation non confirmée".into());
                        }
                    }
                    st.asks.remove(&id).unwrap()
                };
                let answer = Some(ask.answers[choice].as_str()).filter(|a| !a.is_empty());
                answer_line(&mut ask.reply, answer, None);
                ctx.log_info("réponse envoyée à un agent");
                ctx.emit("agents.ask.closed", json!({ "id": id, "expired": false }));
                ctx.emit("agents.changed", Value::Null);
                Ok(Value::Null)
            }
            // { id } : l'écran « Vraiment autoriser ? » vient de s'afficher.
            // On note l'heure : « Oui, autoriser » ne sera accepté qu'ensuite.
            "arm" => {
                let id = args.get("id").and_then(Value::as_u64).ok_or("question manquante")?;
                let mut st = self.state.locked();
                let ask = st.asks.get_mut(&id).ok_or("cette question n'attend plus (délai dépassé ?)")?;
                if ask.kind != "permission" {
                    return Err("rien à autoriser".into());
                }
                ask.armed = Some(Instant::now());
                Ok(Value::Null)
            }
            // { session } : fait passer devant la fenêtre de cette session.
            "focus" => {
                let id = args.get("session").and_then(Value::as_str).ok_or("session manquante")?;
                let (hwnd, pids) = {
                    let st = self.state.locked();
                    let s = st.sessions.get(id).ok_or("session inconnue (terminée ?)")?;
                    (s.hwnd, s.pids.clone())
                };
                platform::focus_agent_window(hwnd, &pids)?;
                Ok(Value::Null)
            }
            // La configuration à coller dans Claude Code (avec le chemin de CE programme).
            "hook_config" => Ok(json!({ "exe": exe_path() })),
            // { tool: "claude-code" | "codex" | "gemini" }
            // { tool, permission? } : la configuration des hooks (ou du hook « Autoriser / Refuser »).
            "copy_config" => {
                ctx.require("clipboard")?;
                let tool = args.get("tool").and_then(Value::as_str).unwrap_or("claude-code");
                let text = if args.get("permission") == Some(&Value::Bool(true)) { permission_config(tool, &exe_path())? } else { hook_config(tool, &exe_path())? };
                files::copy_text(&text)?;
                Ok(Value::Null)
            }
            // { tool } : la configuration MCP de cet outil, dans le presse-papiers.
            "copy_mcp" => {
                ctx.require("clipboard")?;
                let tool = args.get("tool").and_then(Value::as_str).unwrap_or("claude-code");
                files::copy_text(&mcp_config(tool, &exe_path())?)?;
                Ok(Value::Null)
            }
            // L'état des hooks d'Ondine dans le fichier de chaque outil (rien n'est écrit).
            "hook_status" => {
                let exe = exe_path();
                let mut tools = serde_json::Map::new();
                for tool in ["claude-code", "codex", "gemini"] {
                    let (file, format) = config_file(tool)?;
                    let status = match hooks::read(&file) {
                        Ok(text) => hooks::status(format, text.as_deref(), &exe),
                        Err(_) => hooks::Status { state: "unreadable", permission: false, other_permission: false },
                    };
                    tools.insert(
                        tool.into(),
                        json!({ "file": file.display().to_string(), "state": status.state, "permission": status.permission, "otherPermission": status.other_permission }),
                    );
                }
                Ok(json!({ "exe": exe, "tools": tools }))
            }
            // { tool } : écrit les hooks d'Ondine dans le fichier de l'outil (fusion, copie .bak).
            "hook_install" => {
                ctx.require("files")?;
                let tool = args.get("tool").and_then(Value::as_str).unwrap_or("");
                let (file, format) = config_file(tool)?;
                let exe = exe_path();
                if exe.is_empty() {
                    return Err("chemin d'Ondine introuvable".into());
                }
                // Le hook « Autoriser depuis l'île » : seulement si le réglage est actif.
                let permission = tool != "gemini" && ctx.settings().get("permissions").and_then(Value::as_bool) == Some(true);
                let existing = hooks::read(&file)?;
                let merged = hooks::install_text(format, existing.as_deref(), &our_hooks(tool, &exe, permission)?).map_err(|e| format!("{} : {e}", file.display()))?;
                let backup = if merged.changed { hooks::write_with_backup(&file, &merged.text, &platform::local_time().file_stamp())? } else { None };
                // Claude Code : un autre programme répond aussi aux demandes de permission ?
                let other = permission && tool == "claude-code" && hooks::status(format, Some(&merged.text), &exe).other_permission;
                ctx.log_info(format!("hooks d'Ondine installés pour {tool} ({} ancien(s) retiré(s))", merged.removed));
                Ok(json!({ "file": file.display().to_string(), "backup": backup.map(|b| b.display().to_string()), "removed": merged.removed, "changed": merged.changed, "permission": permission, "otherPermission": other }))
            }
            // { tool } : retire seulement les entrées d'Ondine du fichier de l'outil.
            "hook_remove" => {
                ctx.require("files")?;
                let tool = args.get("tool").and_then(Value::as_str).unwrap_or("");
                let (file, format) = config_file(tool)?;
                let existing = hooks::read(&file)?;
                let merged = hooks::remove_text(format, existing.as_deref()).map_err(|e| format!("{} : {e}", file.display()))?;
                let backup = if merged.changed { hooks::write_with_backup(&file, &merged.text, &platform::local_time().file_stamp())? } else { None };
                ctx.log_info(format!("hooks d'Ondine retirés pour {tool} ({})", merged.removed));
                Ok(json!({ "file": file.display().to_string(), "backup": backup.map(|b| b.display().to_string()), "removed": merged.removed }))
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
    // Le chemin complet du programme, trouvé dans le PATH (jamais dans le
    // projet). Jamais le mot seul : la console ouverte cherche les programmes
    // d'abord dans le dossier courant (comportement normal de cmd.exe, que
    // l'utilisateur garde dans sa console), et un « claude.cmd » piégé dans un
    // projet serait alors lancé à sa place.
    let word = platform::find_program(tool.word())
        .map(|p| p.display().to_string())
        .ok_or_else(|| format!("{} n'est pas installé sur ce PC", tool.word()))?;
    let (program, args) = agent_command(&word, dir, in_wt);
    // La console doit pouvoir passer devant l'île.
    platform::forget_previous_foreground();
    platform::spawn_console(program, &args, dir)?;
    ctx.log_info(format!("ouvre {} dans {}", tool.word(), dir.display()));
    Ok(())
}

/// « cmd /k <chemin complet de claude> » (ou codex, gemini) : la fenêtre
/// reste ouverte quand l'agent se termine.
fn agent_command(word: &str, dir: &Path, in_wt: bool) -> (&'static str, Vec<String>) {
    // Dans Windows Terminal, « cmd.exe » est cherché par Windows Terminal, qui
    // démarre dans le dossier du projet : on lui donne le chemin complet.
    let cmd = [system_cmd(std::env::var("SystemRoot").ok()), "/k".into(), word.into()];
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

/// Le cmd.exe de Windows (« C:\Windows\System32\cmd.exe »), d'après le
/// dossier de Windows ; « cmd.exe » seul si on ne le connaît pas.
fn system_cmd(system_root: Option<String>) -> String {
    match system_root.filter(|r| Path::new(r).is_absolute() || r.contains(":\\")) {
        Some(root) => format!("{}\\System32\\cmd.exe", root.trim_end_matches('\\')),
        None => "cmd.exe".into(),
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

/// Pas plus de MAX_PER_SECOND messages par seconde (au-delà : ignorés).
fn allow(state: &Shared) -> bool {
    let mut st = state.locked();
    st.recent.retain(|t| t.elapsed() < Duration::from_secs(1));
    if st.recent.len() >= MAX_PER_SECOND {
        return false;
    }
    st.recent.push_back(Instant::now());
    true
}

/// Un message du canal : une demande MCP (« ondine.exe mcp ») ou un hook
/// (« ondine.exe notify »). `reply` sert seulement à répondre à une question.
fn route(app: &AppHandle, state: &Shared, bytes: &[u8], reply: std::fs::File) {
    let msg = serde_json::from_slice::<Value>(bytes).unwrap_or(Value::Null);
    if msg["source"] == "mcp" && msg["request"].is_object() {
        mcp_request(app, state, &msg, reply);
    } else if msg["source"] == "permission" {
        permission_request(app, state, &msg, reply);
    } else {
        drop(reply); // un hook n'attend pas de réponse
        receive(app, state, bytes);
    }
}

// ── Les outils MCP (« ondine.exe mcp ») ──────────────────────────────────────
//
// Un agent (Claude Code, Codex, Gemini) qui a branché l'île comme serveur MCP
// peut l'appeler de lui-même :
//   - ondine_notify   : un message (« Les tests passent ») ;
//   - ondine_progress : « étape 3 sur 7 » ;
//   - ondine_timer    : lance le minuteur de l'île ;
//   - ondine_ask      : te pose une question à choix, et attend ton clic.
// Comme pour les hooks, ce sont des TEXTES À AFFICHER : rien n'est exécuté.
// La réponse renvoyée à l'agent est seulement le texte du choix cliqué.

/// Au plus ce nombre de questions en attente en même temps.
const MAX_ASKS: usize = 5;
const MAX_OPTION: usize = 60;

fn mcp_request(app: &AppHandle, state: &Shared, msg: &Value, reply: std::fs::File) {
    let req = &msg["request"];
    let tool = req["tool"].as_str().unwrap_or("");
    // Refus poli (seule une question attend une réponse ; sinon on ferme).
    let refuse = |mut reply: std::fs::File, reason: &str| {
        if tool == "ask" {
            answer_line(&mut reply, None, Some(reason));
        }
    };
    if !super::is_active(app, ID) {
        return refuse(reply, "Le module Agents IA de l'île est désactivé.");
    }
    let enabled = super::with_context(app, ID, |ctx| ctx.settings().get("mcp").and_then(Value::as_bool).unwrap_or(true)).unwrap_or(false);
    if !enabled {
        return refuse(reply, "L'utilisateur a désactivé les outils MCP de l'île.");
    }
    if !allow(state) {
        return refuse(reply, "Trop de demandes en même temps.");
    }
    let source = client_source(msg["client"].as_str().unwrap_or(""));
    let who = who(&source).to_string();
    let text = |k: &str, max: usize| clean(req[k].as_str().unwrap_or(""), max);
    log::debug(format!("agents : outil MCP {tool} ({source})"));

    match tool {
        "notify" => {
            let title = text("title", MAX_TEXT);
            if title.is_empty() {
                return;
            }
            let event = Event { at: now_ms(), source, kind: "info", title, body: text("message", MAX_TEXT), project: String::new(), session: String::new() };
            publish_info(app, state, event);
        }
        "progress" => {
            let (step, total) = (req["step"].as_u64().unwrap_or(0), req["total"].as_u64().unwrap_or(0));
            if total == 0 || step > total || total > 1000 {
                return;
            }
            super::with_context(app, ID, |ctx| {
                ctx.emit("agents.progress", json!({ "source": source, "who": who, "title": text("title", 120), "step": step, "total": total }))
            });
        }
        "timer" => {
            let Some(minutes) = req["minutes"].as_u64().filter(|m| (1..=180).contains(m)) else { return };
            super::with_context(app, ID, |ctx| ctx.emit("timer.start", json!({ "minutes": minutes })));
            let title = format!("{who} a lancé un minuteur de {minutes} min");
            publish_info(app, state, Event { at: now_ms(), source, kind: "info", title, body: String::new(), project: String::new(), session: String::new() });
        }
        "ask" => {
            let question = text("question", MAX_TEXT);
            let options: Vec<String> = req["options"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|o| clean(o, MAX_OPTION)).filter(|o| !o.is_empty()).take(4).collect();
            if question.is_empty() || options.len() < 2 {
                return refuse(reply, "Il faut une question et 2 à 4 options.");
            }
            let secs = req["timeoutSecs"].as_u64().unwrap_or(600).clamp(60, 1500);
            let ask = Ask { reply, kind: "question", who, question, detail: String::new(), answers: options.clone(), options, session: String::new(), until: 0, armed: None };
            if let Err(reply) = open_ask(app, state, ask, secs) {
                refuse(reply, "Trop de questions en attente dans l'île.");
            }
        }
        _ => {}
    }
}

// ── Autoriser / Refuser depuis l'île (« ondine.exe permission ») ─────────────
//
// Désactivé par défaut. Une fois activé, quand Claude Code ou Codex va te
// demander la permission d'utiliser un outil, l'île affiche l'outil et ce
// qu'il va faire, avec « Autoriser » (à confirmer une 2e fois) et
// « Refuser ». Sans réponse dans le délai choisi, l'agent n'a AUCUNE
// décision : sa question habituelle s'affiche dans le terminal.

fn permission_request(app: &AppHandle, state: &Shared, msg: &Value, mut reply: std::fs::File) {
    // « Pas de décision » : l'agent pose sa question habituelle.
    let pass = |reply: &mut std::fs::File| answer_line(reply, None, None);
    if !super::is_active(app, ID) || !allow(state) {
        return pass(&mut reply);
    }
    let settings = super::with_context(app, ID, |ctx| ctx.settings()).unwrap_or_default();
    // Réglage coupé, ou concentration : la question passe tout de suite au terminal.
    if settings.get("permissions").and_then(Value::as_bool) != Some(true) || state.locked().quiet() {
        return pass(&mut reply);
    }
    let secs = settings.get("permissionWait").and_then(Value::as_str).and_then(|s| s.parse::<u64>().ok()).unwrap_or(60).clamp(15, 300);
    let source = client_source(msg["client"].as_str().unwrap_or(""));
    let who = who(&source);
    let tool = clean(msg["tool"].as_str().unwrap_or(""), 60);
    let session = msg["session"].as_str().map(|id| format!("{source}:{}", clean(id, 80))).unwrap_or_default();
    // Pour « Y aller » : on note où est sa fenêtre (comme pour un hook).
    if !session.is_empty() {
        let pids: Vec<u32> = msg["pids"].as_array().into_iter().flatten().filter_map(Value::as_u64).filter_map(|p| u32::try_from(p).ok()).take(8).collect();
        let hwnd = msg["hwnd"].as_i64().unwrap_or(0) as isize;
        let mut st = state.locked();
        if let Some(sess) = st.sessions.get_mut(&session) {
            if !pids.is_empty() || hwnd != 0 {
                sess.pids = pids;
                sess.hwnd = hwnd;
            }
        }
    }
    log::debug(format!("agents : demande de permission ({source})"));
    let project = project_name(msg["cwd"].as_str().unwrap_or(""));
    let question = match (tool.is_empty(), project.is_empty()) {
        (false, false) => format!("{who} veut utiliser {tool} · {project}"),
        (false, true) => format!("{who} veut utiliser {tool}"),
        _ => format!("{who} demande une permission"),
    };
    let ask = Ask {
        reply,
        kind: "permission",
        who: who.to_string(),
        question,
        detail: clean(msg["detail"].as_str().unwrap_or(""), 500),
        options: vec!["Autoriser".into(), "Refuser".into(), "Au terminal".into()],
        // « Au terminal » : pas de décision, la question s'affiche là-bas.
        answers: vec!["allow".into(), "deny".into(), String::new()],
        session,
        until: 0,
        armed: None,
    };
    if let Err(mut reply) = open_ask(app, state, ask, secs) {
        pass(&mut reply);
    }
}

/// Met une question en attente et la montre ; un fil la surveille : si l'agent
/// part (il a eu sa réponse ailleurs) on la retire, et au bout de `secs`
/// secondes sans clic l'agent reçoit « pas de réponse ».
/// Erreur (le canal rendu) : trop de questions en attente.
fn open_ask(app: &AppHandle, state: &Shared, mut ask: Ask, secs: u64) -> Result<(), std::fs::File> {
    let (id, shown) = {
        let mut st = state.locked();
        if st.asks.len() >= MAX_ASKS {
            return Err(ask.reply);
        }
        st.next_ask += 1;
        ask.until = now_ms() + secs * 1000;
        let id = st.next_ask;
        // Pendant la concentration, la question attend dans l'onglet sans s'ouvrir en grand.
        let shown = (!st.quiet()).then(|| ask_json(id, &ask));
        st.asks.insert(id, ask);
        (id, shown)
    };
    // On publie après avoir rendu le verrou (un abonné pourrait vouloir le reprendre).
    super::with_context(app, ID, |ctx| {
        if let Some(payload) = shown {
            ctx.emit("agents.ask", payload);
        }
        ctx.emit("agents.changed", Value::Null);
    });
    let (a, s) = (app.clone(), state.clone());
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(secs);
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let mut st = s.locked();
            let Some(ask) = st.asks.get(&id) else { return }; // déjà répondu
            let gone = !platform::pipe_client_alive(&ask.reply);
            let expired = Instant::now() >= deadline;
            if !gone && !expired {
                continue;
            }
            let mut ask = st.asks.remove(&id).unwrap();
            drop(st);
            if expired && !gone {
                let reason = match ask.kind {
                    "permission" => "pas de réponse dans l'île",
                    _ => "Pas de réponse de l'utilisateur à temps : continue sans, ou repose la question plus tard.",
                };
                answer_line(&mut ask.reply, None, Some(reason));
            }
            super::with_context(&a, ID, |ctx| {
                ctx.emit("agents.ask.closed", json!({ "id": id, "expired": expired, "gone": gone }));
                ctx.emit("agents.changed", Value::Null);
            });
            return;
        }
    });
    Ok(())
}

/// Une question en attente, telle que le front la reçoit.
fn ask_json(id: u64, a: &Ask) -> Value {
    json!({ "id": id, "kind": a.kind, "who": a.who, "question": a.question, "detail": a.detail, "options": a.options, "session": a.session, "until": a.until })
}

/// Ajoute un message libre à l'historique et le montre.
fn publish_info(app: &AppHandle, state: &Shared, event: Event) {
    {
        let mut st = state.locked();
        st.history.push_front(event.clone());
        st.history.truncate(MAX_HISTORY);
    }
    super::with_context(app, ID, |ctx| {
        show_or_hold(ctx, state, &event);
        ctx.emit("agents.changed", Value::Null);
    });
}

/// Montre la notification, ou la garde pour le résumé pendant la concentration.
fn show_or_hold(ctx: &ModuleContext, state: &Shared, event: &Event) {
    {
        let mut st = state.locked();
        if st.quiet() {
            if st.held.len() < 100 {
                st.held.push(event.clone());
            }
            return;
        }
    }
    ctx.emit("agents.event", serde_json::to_value(event).unwrap_or(Value::Null));
}

// ── Mode concentration ───────────────────────────────────────────────────────
//
// Pendant la concentration, les notifications des agents attendent (elles
// restent visibles dans l'onglet) ; les questions ne s'ouvrent pas en grand
// (elles attendent dans l'onglet) et les demandes de permission passent
// directement au terminal. À la fin : un seul résumé.

/// Démarre la concentration pour `minutes` (0 = jusqu'à ce que tu l'arrêtes).
/// La fin est surveillée par le fil d'entretien (voir `start`).
fn quiet_start(state: &Shared, minutes: u64) {
    let mut st = state.locked();
    st.quiet_until = Some(if minutes == 0 { u64::MAX } else { now_ms().saturating_add(minutes.saturating_mul(60_000)) });
}

/// Arrête la concentration et montre le résumé de ce qui s'est passé.
fn quiet_stop(app: &AppHandle, state: &Shared) {
    let text = {
        let mut st = state.locked();
        if st.quiet_until.take().is_none() {
            return;
        }
        let held = std::mem::take(&mut st.held);
        let waiting: Vec<&'static str> = st.sessions.values().filter(|s| s.state == "waiting").map(|s| who(&s.source)).collect();
        summary(&held, &waiting, st.asks.len())
    };
    super::with_context(app, ID, |ctx| {
        ctx.emit("agents.quiet", json!({ "on": false, "summary": text }));
        ctx.emit("agents.changed", Value::Null);
    });
}

/// « Claude a fini 2 tâches · Codex vous attend · 1 question » (None : rien à dire).
fn summary(held: &[Event], waiting: &[&str], asks: usize) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    // Les fins de tâche, par agent, dans l'ordre d'arrivée.
    let mut done: Vec<(&str, usize)> = Vec::new();
    for e in held.iter().filter(|e| e.kind == "done") {
        let name = who(&e.source);
        match done.iter_mut().find(|(n, _)| *n == name) {
            Some((_, count)) => *count += 1,
            None => done.push((name, 1)),
        }
    }
    for (name, count) in done {
        parts.push(if count == 1 { format!("{name} a fini une tâche") } else { format!("{name} a fini {count} tâches") });
    }
    // Ceux qui t'attendent encore maintenant.
    let mut names: Vec<&str> = Vec::new();
    for w in waiting {
        if !names.contains(w) {
            names.push(w);
        }
    }
    if !names.is_empty() {
        let verb = if names.len() > 1 { "vous attendent" } else { "vous attend" };
        // Plusieurs sessions du même agent : on le précise.
        let extra = if waiting.len() > names.len() { format!(" ({} sessions)", waiting.len()) } else { String::new() };
        parts.push(format!("{} {verb}{extra}", names.join(" et ")));
    }
    if asks > 0 {
        parts.push(if asks == 1 { "1 question en attente".into() } else { format!("{asks} questions en attente") });
    }
    let infos = held.iter().filter(|e| e.kind == "info").count();
    if infos > 0 {
        parts.push(if infos == 1 { "1 message".into() } else { format!("{infos} messages") });
    }
    if parts.is_empty() { None } else { Some(parts.join(" · ")) }
}

/// Le délai minimum entre l'écran de confirmation et « Oui, autoriser » :
/// un vrai second clic, pas deux appels collés.
const ARM_MIN: Duration = Duration::from_millis(300);
/// Au-delà, la confirmation est trop vieille : il faut la redemander.
const ARM_MAX: Duration = Duration::from_secs(60);

/// « Autoriser » passe en deux temps, vérifiés côté Rust : la commande "arm"
/// (écran « Vraiment autoriser ? »), puis "answer" avec `confirmed`, entre
/// 300 ms et 60 s plus tard.
fn allow_is_confirmed(confirmed: bool, armed: Option<Instant>, now: Instant) -> Result<(), String> {
    let Some(at) = armed else {
        return Err("autorisation non confirmée".into());
    };
    let waited = now.saturating_duration_since(at);
    if !confirmed || waited < ARM_MIN {
        return Err("autorisation non confirmée".into());
    }
    if waited > ARM_MAX {
        return Err("confirmation trop ancienne : cliquez de nouveau sur « Autoriser… »".into());
    }
    Ok(())
}

/// Le clic peut être noté par la boucle de la souris un peu après l'arrivée
/// de la commande (elle tourne toutes les 16 à 33 ms) : on l'attend jusque-là.
const GESTURE_GRACE: Duration = Duration::from_millis(120);

/// Un geste réel a-t-il eu lieu depuis `armed` ? Un clic du bouton gauche sur
/// l'île (vu par la boucle de la souris, island/mod.rs : un script de la page
/// ne peut pas le simuler), ou la touche Entrée enfoncée dans l'île.
fn real_gesture(armed: Instant, last_click: Option<Instant>, enter_held: bool) -> bool {
    enter_held || last_click.is_some_and(|c| c > armed)
}

/// `real_gesture` avec les vraies sources, en laissant à la boucle de la
/// souris le temps de noter le clic (`GESTURE_GRACE`).
fn gesture_since(app: &AppHandle, armed: Instant) -> bool {
    use tauri::Manager;
    let gate = app.try_state::<crate::Shared>().map(|s| s.gate.clone());
    let island = crate::island::window(app);
    let deadline = Instant::now() + GESTURE_GRACE;
    loop {
        let click = gate.as_ref().and_then(|g| g.last_click());
        let enter = island.as_ref().is_some_and(platform::enter_held_in);
        if real_gesture(armed, click, enter) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// La ligne renvoyée à « ondine.exe mcp » : `{"answer": "…" | null, "reason"?: "…"}`.
/// Si l'agent est parti entre-temps, l'écriture échoue sans bruit.
fn answer_line(reply: &mut std::fs::File, answer: Option<&str>, reason: Option<&str>) {
    use std::io::Write;
    let mut line = json!({ "answer": answer });
    if let Some(r) = reason {
        line["reason"] = json!(r);
    }
    let _ = reply.write_all(format!("{line}\n").as_bytes());
}

/// Le nom de l'outil donné par « ondine.exe mcp » (claude-code, codex…),
/// réduit aux caractères sûrs.
fn client_source(raw: &str) -> String {
    let s: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(30).collect::<String>().to_lowercase();
    if s.is_empty() { "agent".into() } else { s }
}

fn who(source: &str) -> &'static str {
    match source {
        "claude-code" => "Claude",
        "codex" => "Codex",
        "gemini" => "Gemini",
        _ => "L'agent",
    }
}

fn receive(app: &AppHandle, state: &Shared, bytes: &[u8]) {
    if !super::is_active(app, ID) || !allow(state) {
        return; // module désactivé, ou trop de messages : on ignore
    }
    let Ok(msg) = serde_json::from_slice::<Value>(bytes) else { return };
    let Some(event) = understand(&msg, now_ms()) else { return };
    log::debug(format!("agents : {} ({})", event.kind, event.source));
    // Où est sa fenêtre ? (de simples numéros ; rien n'est lancé avec)
    let pids: Vec<u32> = msg["pids"].as_array().into_iter().flatten().filter_map(Value::as_u64).filter_map(|p| u32::try_from(p).ok()).take(8).collect();
    let hwnd = msg["hwnd"].as_i64().unwrap_or(0) as isize;

    // Qui est au travail ? (la mascotte réfléchit tant qu'au moins une session travaille)
    let (started, finished, already_shown) = {
        let mut st = state.locked();
        let was_busy = st.working() > 0;
        if event.kind == "ended" {
            st.sessions.remove(&event.session);
        } else if event.kind != "info" {
            let state_name = match event.kind {
                "working" => "working",
                "waiting" => "waiting",
                _ => "done",
            };
            // Une nouvelle session alors que le tableau est plein : la plus
            // ancienne (dernier signe de vie) laisse sa place.
            if !st.sessions.contains_key(&event.session) && st.sessions.len() >= MAX_SESSIONS {
                let oldest = st.sessions.iter().min_by_key(|(_, s)| s.updated).map(|(k, _)| k.clone());
                if let Some(k) = oldest {
                    st.sessions.remove(&k);
                }
            }
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
        // Une demande de permission déjà affichée dans l'île pour cette session :
        // pas besoin d'une 2e notification « attend ta permission ».
        let shown = event.kind == "waiting" && st.asks.values().any(|a| a.kind == "permission" && a.session == event.session);
        if matches!(event.kind, "waiting" | "done" | "info") {
            st.history.push_front(event.clone());
            st.history.truncate(MAX_HISTORY);
        }
        (!was_busy && busy, was_busy && !busy, shown)
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
            // (pas de fête pendant la concentration)
            if event.kind == "done" && !state.locked().quiet() {
                ctx.emit("task.finished", json!({ "label": event.title }));
            }
        }
        let wanted = match event.kind {
            "waiting" => on("notifyWaiting") && !already_shown,
            "done" => on("notifyDone"),
            "info" => true,
            _ => false,
        };
        if wanted {
            show_or_hold(ctx, state, &event);
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
///
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
    let who = who(&source);
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
        // Pas de hook : un message libre (« ondine.exe notify --title … --message … »).
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
            ev.title = format!("{who} attend votre permission");
            let tool = text(&hook["tool_name"]);
            ev.body = if tool.is_empty() { String::new() } else { format!("pour {tool}") };
        }
        Some("Notification") => {
            ev.kind = "waiting";
            let message = text(&hook["message"]);
            let ntype = hook["notification_type"].as_str().unwrap_or("");
            let lower = message.to_lowercase();
            ev.title = match ntype {
                "permission_prompt" | "ToolPermission" => format!("{who} attend votre permission"),
                "idle_prompt" | "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" => format!("{who} attend votre réponse"),
                // Connexion réussie, quotas, réponses déjà données… : rien à signaler.
                "" => {
                    // Anciennes versions sans « notification_type » : on devine d'après le texte.
                    if lower.contains("permission") {
                        format!("{who} attend votre permission")
                    } else {
                        format!("{who} attend votre réponse")
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
/// `args`) : Claude Code lance directement ondine.exe, sans Git Bash ni
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
    format!("# Ondine : Codex prévient l'île (à coller dans %USERPROFILE%\\.codex\\config.toml)\n{}", codex_blocks(exe))
}

/// Les sections TOML des hooks de Codex (sans commentaire).
fn codex_blocks(exe: &str) -> String {
    let command = format!("\"{exe}\" notify --source codex");
    let toml = format!("\"{}\"", command.replace('\\', "\\\\").replace('"', "\\\""));
    let mut out = String::new();
    for event in ["UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"] {
        out.push_str(&format!("\n[[hooks.{event}]]\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {toml}\n"));
    }
    out
}

// ── Installer les hooks soi-même (agents_hooks.rs) ───────────────────────────

/// Le fichier de configuration de l'outil, et son format. Claude Code et
/// Codex acceptent un autre dossier (CLAUDE_CONFIG_DIR, CODEX_HOME) : on le suit.
fn config_file(tool: &str) -> Result<(PathBuf, hooks::Format), String> {
    let dir = |var: &str, default: &str| {
        std::env::var_os(var).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| platform::home_dir().join(default))
    };
    match tool {
        "claude-code" => Ok((dir("CLAUDE_CONFIG_DIR", ".claude").join("settings.json"), hooks::Format::Json)),
        "codex" => Ok((dir("CODEX_HOME", ".codex").join("config.toml"), hooks::Format::Toml)),
        "gemini" => Ok((platform::home_dir().join(".gemini").join("settings.json"), hooks::Format::Json)),
        other => Err(format!("outil inconnu : {other}")),
    }
}

/// Les entrées d'Ondine à écrire (les mêmes que « Copier la configuration »),
/// avec le hook « Autoriser depuis l'île » si `permission`.
/// JSON `{"hooks": …}` pour Claude Code et Gemini ; sections TOML pour Codex.
fn our_hooks(tool: &str, exe: &str, permission: bool) -> Result<String, String> {
    match tool {
        "codex" => {
            let mut text = format!("# Ondine : hooks ajoutés par Ondine (onglet Agents IA)\n{}", codex_blocks(exe));
            if permission {
                let perm = permission_config("codex", exe)?;
                // Sans sa ligne de commentaire : seulement la section.
                text.push('\n');
                text.push_str(perm.split_once("\n\n").map(|(_, rest)| rest).unwrap_or(&perm));
            }
            Ok(text)
        }
        _ => {
            let mut ours: Value = serde_json::from_str(&hook_config(tool, exe)?).map_err(|e| e.to_string())?;
            if permission {
                let perm: Value = serde_json::from_str(&permission_config(tool, exe)?).map_err(|e| e.to_string())?;
                ours["hooks"]["PermissionRequest"] = perm["hooks"]["PermissionRequest"].clone();
            }
            Ok(ours.to_string())
        }
    }
}

/// Gemini CLI (settings.json). Ses hooks sont lancés par PowerShell : `&` pour
/// lancer un programme dont le chemin est entre apostrophes (une apostrophe
/// dans le chemin se double), et `$input |` pour lui passer le JSON reçu.
fn gemini_config(exe: &str) -> String {
    let command = format!("$input | & '{}' notify --source gemini", exe.replace('\'', "''"));
    let entry = json!([{ "matcher": "*", "hooks": [{ "name": "ondine", "type": "command", "command": command, "timeout": 5000 }] }]);
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

/// Le hook « Autoriser / Refuser depuis l'île » (PermissionRequest), à part :
/// on ne l'ajoute que si on le veut. Délai du hook : 330 s, un peu plus que
/// la plus longue attente de l'île (5 min), pour qu'elle ait le dernier mot.
fn permission_config(tool: &str, exe: &str) -> Result<String, String> {
    match tool {
        "claude-code" => {
            let entry = json!([{ "hooks": [{ "type": "command", "command": exe, "args": ["permission", "--source", "claude-code"], "timeout": 330 }] }]);
            Ok(serde_json::to_string_pretty(&json!({ "hooks": { "PermissionRequest": entry } })).unwrap_or_default())
        }
        "codex" => {
            let command = format!("\"{exe}\" permission --source codex");
            let toml = format!("\"{}\"", command.replace('\\', "\\\\").replace('"', "\\\""));
            Ok(format!("# Ondine : Autoriser / Refuser depuis l'île (à coller dans %USERPROFILE%\\.codex\\config.toml)\n\n[[hooks.PermissionRequest]]\n[[hooks.PermissionRequest.hooks]]\ntype = \"command\"\ncommand = {toml}\ntimeout = 330\n"))
        }
        // Gemini CLI : un hook peut refuser ou laisser demander, mais pas autoriser.
        "gemini" => Err("Gemini CLI ne laisse pas un hook autoriser un outil : répondez dans son terminal.".into()),
        other => Err(format!("outil inconnu : {other}")),
    }
}

/// Brancher l'île comme serveur MCP (« ondine.exe mcp »), pour chaque outil.
/// La question (`ondine_ask`) peut attendre ton clic jusqu'à 30 min : on
/// relève le délai que l'outil accorde à un appel quand il le permet.
fn mcp_config(tool: &str, exe: &str) -> Result<String, String> {
    match tool {
        // Une commande à taper une fois (le chemin entre guillemets : cmd ou PowerShell).
        "claude-code" => Ok(format!("claude mcp add --scope user ondine -- \"{exe}\" mcp")),
        "codex" => {
            let path = format!("\"{}\"", exe.replace('\\', "\\\\").replace('"', "\\\""));
            Ok(format!("# Ondine comme serveur MCP (à coller dans %USERPROFILE%\\.codex\\config.toml)\n\n[mcp_servers.ondine]\ncommand = {path}\nargs = [\"mcp\"]\ntool_timeout_sec = 1800\n"))
        }
        "gemini" => {
            let config = json!({ "mcpServers": { "ondine": { "command": exe, "args": ["mcp"], "timeout": 1_800_000 } } });
            Ok(serde_json::to_string_pretty(&config).unwrap_or_default())
        }
        other => Err(format!("outil inconnu : {other}")),
    }
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
        assert_eq!((e.kind, e.title.as_str(), e.project.as_str(), e.session.as_str()), ("waiting", "Claude attend votre permission", "Island", "claude-code:s1"));
        let e = hook(json!({ "hook_event_name": "Notification", "notification_type": "idle_prompt", "message": "Claude is waiting for your input" })).unwrap();
        assert_eq!(e.title, "Claude attend votre réponse");
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
    fn quiet_summary() {
        let ev = |source: &str, kind: &'static str| Event { at: 0, source: source.into(), kind, title: String::new(), body: String::new(), project: String::new(), session: String::new() };
        let held = vec![ev("claude-code", "done"), ev("codex", "done"), ev("claude-code", "done"), ev("mcp", "info")];
        assert_eq!(summary(&held, &["Codex"], 1).unwrap(), "Claude a fini 2 tâches · Codex a fini une tâche · Codex vous attend · 1 question en attente · 1 message");
        assert_eq!(summary(&[], &["Claude", "Claude"], 0).unwrap(), "Claude vous attend (2 sessions)");
        assert_eq!(summary(&[], &["Claude", "Gemini"], 0).unwrap(), "Claude et Gemini vous attendent");
        assert!(summary(&[], &[], 0).is_none());
    }

    #[test]
    fn permission_configs() {
        let exe = r"C:\Program Files\Ondine\ondine.exe";
        let claude: Value = serde_json::from_str(&permission_config("claude-code", exe).unwrap()).unwrap();
        let hook = &claude["hooks"]["PermissionRequest"][0]["hooks"][0];
        assert_eq!((hook["command"].as_str(), hook["args"][0].as_str(), hook["timeout"].as_u64()), (Some(exe), Some("permission"), Some(330)));
        let codex = permission_config("codex", exe).unwrap();
        assert!(codex.contains(r#"command = "\"C:\\Program Files\\Ondine\\ondine.exe\" permission --source codex""#), "{codex}");
        assert!(permission_config("gemini", exe).is_err());
    }

    #[test]
    fn mcp_configs() {
        let exe = r"C:\Program Files\Ondine\ondine.exe";
        assert_eq!(mcp_config("claude-code", exe).unwrap(), r#"claude mcp add --scope user ondine -- "C:\Program Files\Ondine\ondine.exe" mcp"#);
        let codex = mcp_config("codex", exe).unwrap();
        assert!(codex.contains(r#"command = "C:\\Program Files\\Ondine\\ondine.exe""#), "{codex}");
        let gemini: Value = serde_json::from_str(&mcp_config("gemini", exe).unwrap()).unwrap();
        assert_eq!(gemini["mcpServers"]["ondine"]["command"], exe);
        assert!(mcp_config("x", exe).is_err());
    }

    #[test]
    fn mcp_answers_and_clients() {
        assert_eq!(client_source("Claude-Code"), "claude-code");
        assert_eq!(client_source("$(rm)"), "rm");
        assert_eq!(client_source(""), "agent");
        assert_eq!(who("codex"), "Codex");
        // La ligne renvoyée à « ondine.exe mcp » : du JSON sur une ligne.
        let path = std::env::temp_dir().join(format!("island-answer-{}.txt", std::process::id()));
        let mut f = std::fs::File::create(&path).unwrap();
        answer_line(&mut f, Some("Oui \"vraiment\"\nfin"), None);
        answer_line(&mut f, None, Some("trop tard"));
        drop(f);
        let text = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines[0]["answer"], "Oui \"vraiment\"\nfin");
        assert_eq!((lines[1]["answer"].clone(), lines[1]["reason"].clone()), (Value::Null, json!("trop tard")));
    }

    #[test]
    fn allow_needs_two_steps() {
        let t = Instant::now();
        let later = |ms| t + Duration::from_millis(ms);
        assert!(allow_is_confirmed(true, None, later(1000)).is_err()); // jamais armé
        assert!(allow_is_confirmed(false, Some(t), later(1000)).is_err()); // pas confirmé
        assert!(allow_is_confirmed(true, Some(t), later(50)).is_err()); // trop rapide
        assert!(allow_is_confirmed(true, Some(t), later(1000)).is_ok());
        assert!(allow_is_confirmed(true, Some(t), later(61_000)).is_err()); // trop vieux
    }

    #[test]
    fn allow_needs_a_real_gesture_after_arm() {
        let t = Instant::now();
        let later = |ms| t + Duration::from_millis(ms);
        // Aucun clic, ou seulement celui d'avant l'écran de confirmation : refusé.
        assert!(!real_gesture(t, None, false));
        assert!(!real_gesture(later(500), Some(later(100)), false));
        assert!(!real_gesture(t, Some(t), false));
        // Un clic sur l'île après « Autoriser… » : accepté.
        assert!(real_gesture(t, Some(later(400)), false));
        // Entrée enfoncée dans l'île : accepté.
        assert!(real_gesture(t, None, true));
    }

    #[test]
    fn agent_command_lines() {
        let dir = Path::new(r"C:\Projets\Mon appli");
        assert_eq!(agent_command("claude", dir, false), ("cmd.exe", vec!["/k".to_string(), "claude".to_string()]));
        assert_eq!(system_cmd(Some(r"C:\WINDOWS".into())), r"C:\WINDOWS\System32\cmd.exe");
        assert_eq!(system_cmd(Some(r"C:\Windows\".into())), r"C:\Windows\System32\cmd.exe");
        assert_eq!(system_cmd(Some("Windows".into())), "cmd.exe");
        assert_eq!(system_cmd(None), "cmd.exe");
        let (p, a) = agent_command(r"C:\npm\codex.cmd", dir, true);
        assert_eq!((p, a[1].as_str(), a[4].as_str()), ("wt.exe", r"C:\Projets\Mon appli", r"C:\npm\codex.cmd"));
        assert!(a[2].ends_with("cmd.exe"));
        assert_eq!(agent_command("gemini", Path::new(r"C:\a;b"), true).0, "cmd.exe");
        assert!(Tool::parse("calc").is_err());
    }

    #[test]
    fn other_tools_are_understood() {
        let codex = |v: Value| understand(&json!({ "source": "codex", "hook": v }), 0);
        let e = codex(json!({ "type": "agent-turn-complete", "thread-id": "t1", "cwd": "C:\\p\\api", "last-assistant-message": "secret" })).unwrap();
        assert_eq!((e.kind, e.title.as_str(), e.session.as_str()), ("done", "Codex a fini", "codex:t1"));
        assert!(!e.body.contains("secret"));
        let e = codex(json!({ "hook_event_name": "PermissionRequest", "tool_name": "Bash", "tool_input": { "command": "rm -rf /" } })).unwrap();
        assert_eq!((e.title.as_str(), e.body.as_str()), ("Codex attend votre permission", "pour Bash"));
        let gem = |v: Value| understand(&json!({ "source": "gemini", "hook": v }), 0);
        assert_eq!(gem(json!({ "hook_event_name": "AfterAgent", "prompt_response": "x" })).unwrap().title, "Gemini a fini");
        assert_eq!(gem(json!({ "hook_event_name": "Notification", "notification_type": "ToolPermission", "message": "Allow?" })).unwrap().title, "Gemini attend votre permission");
        assert_eq!(gem(json!({ "hook_event_name": "BeforeAgent", "prompt": "x" })).unwrap().kind, "working");
        assert!(gem(json!({ "type": "inconnu" })).is_none());
    }

    #[test]
    fn codex_and_gemini_configs() {
        let exe = r"C:\Program Files\Ondine\ondine.exe";
        let c = codex_config(exe);
        assert!(c.contains(r#"command = "\"C:\\Program Files\\Ondine\\ondine.exe\" notify --source codex""#), "{c}");
        assert!(c.contains("[[hooks.PermissionRequest.hooks]]"));
        let g: Value = serde_json::from_str(&gemini_config(r"C:\Users\O'Neil\ondine.exe")).unwrap();
        assert_eq!(g["hooks"]["AfterAgent"][0]["hooks"][0]["command"], r"$input | & 'C:\Users\O''Neil\ondine.exe' notify --source gemini");
        assert!(hook_config("chatgpt-web", exe).is_err());
    }

    #[test]
    fn auto_install_writes_the_copied_config() {
        let exe = r"C:\Program Files\Ondine\ondine.exe";
        for (tool, format) in [("claude-code", hooks::Format::Json), ("codex", hooks::Format::Toml), ("gemini", hooks::Format::Json)] {
            for permission in [false, true] {
                let ours = our_hooks(tool, exe, permission && tool != "gemini").unwrap();
                let merged = hooks::install_text(format, None, &ours).unwrap_or_else(|e| panic!("{tool} : {e}"));
                let status = hooks::status(format, Some(&merged.text), exe);
                assert_eq!(status.state, "installed", "{tool}");
                assert_eq!(status.permission, permission && tool != "gemini", "{tool}");
                // Retirer vide le fichier de toute trace d'Ondine.
                let removed = hooks::remove_text(format, Some(&merged.text)).unwrap();
                assert_eq!(hooks::status(format, Some(&removed.text), exe).state, "absent", "{tool}");
            }
        }
        assert!(config_file("chatgpt").is_err());
        assert!(config_file("codex").unwrap().0.ends_with("config.toml"));
    }

    #[test]
    fn config_runs_the_exe_with_args() {
        let c: Value = serde_json::from_str(&claude_config(r"C:\Program Files\Ondine\ondine.exe")).unwrap();
        let h = &c["hooks"]["Stop"][0]["hooks"][0];
        assert_eq!(h["command"], r"C:\Program Files\Ondine\ondine.exe");
        assert_eq!(h["args"], json!(["notify", "--source", "claude-code"]));
    }
}
