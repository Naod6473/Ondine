// Agents IA : les outils en plus de Claude Code, Codex et Gemini CLI, et
// « Autre outil » (un mot de commande choisi dans les réglages).
//
// Chaque outil est décrit une fois (`TOOLS`) : son mot de commande, le nom
// affiché, les mots fixes de sa reprise de session, et, pour ceux dont la
// documentation officielle décrit un format de hooks vérifié, le fichier et
// le texte de ses hooks. Les autres sont seulement lancés.
//
//   - GitHub Copilot CLI (`copilot`) : %USERPROFILE%\.copilot\hooks\ondine.json
//     (`{version: 1, hooks: {événement: [{type: "command", exec, args}]}}`,
//     lancé directement sans shell), événements userPromptSubmitted, agentStop,
//     sessionEnd, notification ; reprise `copilot --continue`.
//   - Cursor CLI (`agent`) : %USERPROFILE%\.cursor\hooks.json (`{version: 1,
//     hooks: {stop: [{command}]}}`), événements beforeSubmitPrompt, stop,
//     sessionEnd ; le JSON arrive sur l'entrée standard avec `hook_event_name`,
//     `conversation_id`, `workspace_roots` ; reprise `agent --continue`.
//   - Qwen Code (`qwen`) : %USERPROFILE%\.qwen\settings.json, même forme que
//     Claude Code (`hooks.Stop[].hooks[]`, champ `shell: "powershell"`),
//     événements UserPromptSubmit, Stop, Notification, SessionEnd ; reprise
//     `qwen --continue`.
//   - Goose (`goose`) : un petit « plugin » à nous,
//     %USERPROFILE%\.agents\plugins\ondine\hooks\hooks.json (+ plugin.json),
//     événements UserPromptSubmit, Stop, SessionEnd (le JSON reçu a `event`,
//     `session_id`, `working_dir`) ; reprise `goose session --resume`.
//   - OpenCode (`opencode`, reprise `--continue`), Kiro CLI (`kiro-cli`,
//     reprise `chat --resume`), Hermes (`hermes`, reprise `--continue`),
//     Aider (`aider`), Amp (`amp`) : lancement seulement (pas de hooks
//     shell, ou un format qu'on n'a pas pu vérifier).
//
// Comme pour les trois premiers : seul le mot de commande, trouvé dans le
// PATH par son chemin complet, est tapé ; les hooks sont du texte à afficher.

use serde_json::{json, Value};

/// Un outil en plus.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToolInfo {
    /// L'identifiant (réglage « launch… », source des hooks, bouton) : « copilot ».
    pub id: &'static str,
    /// Le nom affiché (« GitHub Copilot CLI ») et le prénom des notifications (« Copilot »).
    pub name: &'static str,
    pub who: &'static str,
    /// Le mot tapé dans la console (cmd trouve copilot.cmd, agent.exe…).
    pub word: &'static str,
    /// La clé du réglage « Proposer … ».
    pub setting: &'static str,
    /// Les mots fixes pour reprendre la dernière session (None : pas proposé).
    pub resume: Option<&'static [&'static str]>,
    /// Les hooks sont décrits (fichier + format vérifiés) : installation proposée.
    pub hooks: bool,
}

pub const TOOLS: &[ToolInfo] = &[
    ToolInfo { id: "copilot", name: "GitHub Copilot CLI", who: "Copilot", word: "copilot", setting: "launchCopilot", resume: Some(&["--continue"]), hooks: true },
    ToolInfo { id: "cursor", name: "Cursor CLI", who: "Cursor", word: "agent", setting: "launchCursor", resume: Some(&["--continue"]), hooks: true },
    ToolInfo { id: "qwen", name: "Qwen Code", who: "Qwen", word: "qwen", setting: "launchQwen", resume: Some(&["--continue"]), hooks: true },
    ToolInfo { id: "goose", name: "Goose", who: "Goose", word: "goose", setting: "launchGoose", resume: Some(&["session", "--resume"]), hooks: true },
    ToolInfo { id: "opencode", name: "OpenCode", who: "OpenCode", word: "opencode", setting: "launchOpencode", resume: Some(&["--continue"]), hooks: false },
    ToolInfo { id: "kiro", name: "Kiro CLI", who: "Kiro", word: "kiro-cli", setting: "launchKiro", resume: Some(&["chat", "--resume"]), hooks: false },
    ToolInfo { id: "hermes", name: "Hermes", who: "Hermes", word: "hermes", setting: "launchHermes", resume: Some(&["--continue"]), hooks: false },
    ToolInfo { id: "aider", name: "Aider", who: "Aider", word: "aider", setting: "launchAider", resume: None, hooks: false },
    ToolInfo { id: "amp", name: "Amp", who: "Amp", word: "amp", setting: "launchAmp", resume: None, hooks: false },
];

/// L'outil d'identifiant `id` (« copilot »), s'il est connu ici.
pub fn find(id: &str) -> Option<&'static ToolInfo> {
    TOOLS.iter().find(|t| t.id == id)
}

/// Le prénom affiché pour une source de hooks (« copilot » → « Copilot »).
pub fn who(source: &str) -> Option<&'static str> {
    if source == "other" {
        return Some("L'outil");
    }
    find(source).map(|t| t.who)
}

// ── « Autre outil » ──────────────────────────────────────────────────────────

/// Le mot de commande du réglage « Autre outil », s'il est acceptable :
/// lettres, chiffres, tirets, points et soulignés, 32 caractères au plus,
/// sans commencer par un tiret ni un point (pas une option, pas un chemin).
/// Ce mot est ensuite cherché dans le PATH comme « claude » : jamais tapé tel quel.
pub fn valid_word(raw: &str) -> Option<String> {
    let word = raw.trim();
    let ok = !word.is_empty()
        && word.chars().count() <= 32
        && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
        && !word.starts_with(['-', '.'])
        && !word.ends_with('.');
    ok.then(|| word.to_string())
}

// ── Les hooks reçus : mêmes événements, noms différents ──────────────────────

/// Le nom d'événement d'un hook, ramené à ceux que `understand` connaît
/// (UserPromptSubmit, Stop, Notification, PermissionRequest, SessionEnd).
/// Copilot CLI et Cursor écrivent en camelCase ; Goose met le nom dans `event`.
pub fn canonical_event(name: &str) -> Option<&'static str> {
    Some(match name {
        "UserPromptSubmit" | "userPromptSubmitted" | "beforeSubmitPrompt" | "BeforeAgent" => "UserPromptSubmit",
        "Stop" | "agentStop" | "stop" | "AfterAgent" => "Stop",
        "SessionEnd" | "sessionEnd" => "SessionEnd",
        "Notification" | "notification" => "Notification",
        "PermissionRequest" | "permissionRequest" => "PermissionRequest",
        _ => return None,
    })
}

/// Le nom de l'événement d'un hook, où qu'il soit écrit.
pub fn event_name(hook: &Value) -> Option<&str> {
    hook["hook_event_name"].as_str().or(hook["event"].as_str())
}

/// Le dossier de la session, où que le hook le mette (`cwd`, `working_dir`,
/// ou le premier dossier de `workspace_roots` pour Cursor).
pub fn hook_cwd(hook: &Value) -> &str {
    hook["cwd"].as_str().or(hook["working_dir"].as_str()).or(hook["workspace_roots"][0].as_str()).unwrap_or("")
}

/// Le numéro de session, où que le hook le mette.
pub fn hook_session(hook: &Value) -> Option<&str> {
    hook["session_id"].as_str().or(hook["thread-id"].as_str()).or(hook["conversation_id"].as_str()).or(hook["sessionId"].as_str())
}

/// Le type d'une notification (`notification_type`, ou `notificationType`).
pub fn notification_type(hook: &Value) -> &str {
    hook["notification_type"].as_str().or(hook["notificationType"].as_str()).unwrap_or("")
}

/// Le nom de l'outil demandé (`tool_name`, ou `toolName`).
pub fn tool_name(hook: &Value) -> &str {
    hook["tool_name"].as_str().or(hook["toolName"].as_str()).unwrap_or("")
}

// ── Les hooks à écrire ───────────────────────────────────────────────────────

/// Le texte des hooks d'un outil (JSON `{"hooks": …}`, plus `version` quand
/// le fichier en veut une), ou None si l'outil n'a pas de hooks décrits.
pub fn hook_config(id: &str, exe: &str) -> Option<String> {
    let text = match id {
        "copilot" => copilot_config(exe),
        "cursor" => cursor_config(exe),
        "qwen" => qwen_config(exe),
        "goose" => goose_config(exe),
        _ => return None,
    };
    Some(text)
}

/// Copilot CLI : `exec` + `args`, lancé directement (« Arguments are passed
/// directly to the executable without shell interpretation »). Le JSON de
/// l'événement arrive sur l'entrée standard. `permissionRequest` n'est pas
/// branché : ce hook attend une décision, que l'île ne donne pas.
fn copilot_config(exe: &str) -> String {
    let entry = json!([{ "type": "command", "exec": exe, "args": ["notify", "--source", "copilot"], "timeoutSec": 5 }]);
    let config = json!({
        "version": 1,
        "hooks": {
            "userPromptSubmitted": entry,
            "agentStop": entry,
            "notification": entry,
            "sessionEnd": entry,
        }
    });
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

/// Cursor : une commande shell (le chemin entre guillemets doubles, forme
/// cmd.exe), le JSON sur l'entrée standard.
fn cursor_config(exe: &str) -> String {
    let entry = json!([{ "command": format!("\"{exe}\" notify --source cursor") }]);
    let config = json!({
        "version": 1,
        "hooks": {
            "beforeSubmitPrompt": entry,
            "stop": entry,
            "sessionEnd": entry,
        }
    });
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

/// Qwen Code : la forme de Claude Code, avec `shell: "powershell"` et la
/// même commande que pour Gemini CLI (`$input |` passe le JSON reçu).
fn qwen_config(exe: &str) -> String {
    let command = format!("$input | & '{}' notify --source qwen", exe.replace('\'', "''"));
    let entry = json!([{ "hooks": [{ "type": "command", "name": "ondine", "command": command, "shell": "powershell", "timeout": 5 }] }]);
    let config = json!({
        "hooks": {
            "UserPromptSubmit": entry,
            "Stop": entry,
            "Notification": entry,
            "SessionEnd": entry,
        }
    });
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

/// Goose : `hooks/hooks.json` de notre plugin. Goose lance la commande avec
/// `sh -c` : le chemin entre apostrophes (une apostrophe du chemin devient
/// `'\''`).
fn goose_config(exe: &str) -> String {
    let command = format!("'{}' notify --source goose", exe.replace('\'', "'\\''"));
    let entry = json!([{ "hooks": [{ "type": "command", "command": command, "timeout": 5 }] }]);
    let config = json!({
        "hooks": {
            "UserPromptSubmit": entry,
            "Stop": entry,
            "SessionEnd": entry,
        }
    });
    serde_json::to_string_pretty(&config).unwrap_or_default()
}

/// Le `plugin.json` du plugin Goose d'Ondine (écrit à côté de hooks/hooks.json).
pub fn goose_plugin_json() -> String {
    let manifest = json!({ "name": "ondine", "version": env!("CARGO_PKG_VERSION"), "description": "Goose prévient l'île Ondine (hooks)" });
    serde_json::to_string_pretty(&manifest).unwrap_or_default()
}

/// Le texte « ondine.exe notify » à mettre en fin de tâche d'un autre outil
/// (guide de l'onglet).
pub fn other_tool_line(exe: &str) -> String {
    format!("\"{exe}\" notify --source other --event done")
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Program Files\Ondine\ondine.exe";

    #[test]
    fn other_tool_word_is_strict() {
        assert_eq!(valid_word(" kiro-cli ").as_deref(), Some("kiro-cli"));
        assert_eq!(valid_word("my_tool.cmd").as_deref(), Some("my_tool.cmd"));
        for bad in ["", "-c", ".hidden", "tool.", "cmd /c calc", "C:\\x\\y.exe", "a;b", "é", &"a".repeat(33)] {
            assert_eq!(valid_word(bad), None, "{bad:?}");
        }
        assert!(valid_word(&"a".repeat(32)).is_some());
    }

    #[test]
    fn events_are_normalized() {
        assert_eq!(canonical_event("agentStop"), Some("Stop"));
        assert_eq!(canonical_event("beforeSubmitPrompt"), Some("UserPromptSubmit"));
        assert_eq!(canonical_event("sessionEnd"), Some("SessionEnd"));
        assert_eq!(canonical_event("Stop"), Some("Stop"));
        assert_eq!(canonical_event("preToolUse"), None);
        let goose = json!({ "event": "Stop", "session_id": "g1", "working_dir": "C:\\p\\api" });
        assert_eq!((event_name(&goose), hook_session(&goose), hook_cwd(&goose)), (Some("Stop"), Some("g1"), "C:\\p\\api"));
        let cursor = json!({ "hook_event_name": "stop", "conversation_id": "c1", "workspace_roots": ["C:\\p\\web"] });
        assert_eq!((hook_session(&cursor), hook_cwd(&cursor)), (Some("c1"), "C:\\p\\web"));
        let copilot = json!({ "hook_event_name": "agentStop", "sessionId": "s1", "cwd": "C:\\p" });
        assert_eq!(hook_session(&copilot), Some("s1"));
        assert_eq!(tool_name(&json!({ "toolName": "shell" })), "shell");
        assert_eq!(notification_type(&json!({ "notificationType": "x" })), "x");
    }

    #[test]
    fn hook_configs_run_the_exe() {
        let copilot: Value = serde_json::from_str(&hook_config("copilot", EXE).unwrap()).unwrap();
        assert_eq!(copilot["version"], 1);
        let h = &copilot["hooks"]["agentStop"][0];
        assert_eq!((h["exec"].as_str(), h["args"][0].as_str()), (Some(EXE), Some("notify")));
        assert!(copilot["hooks"].get("permissionRequest").is_none());
        let cursor: Value = serde_json::from_str(&hook_config("cursor", EXE).unwrap()).unwrap();
        assert_eq!(cursor["hooks"]["stop"][0]["command"], format!("\"{EXE}\" notify --source cursor"));
        let qwen: Value = serde_json::from_str(&hook_config("qwen", EXE).unwrap()).unwrap();
        assert_eq!(qwen["hooks"]["Stop"][0]["hooks"][0]["shell"], "powershell");
        let goose: Value = serde_json::from_str(&hook_config("goose", r"C:\O'Neil\ondine.exe").unwrap()).unwrap();
        assert_eq!(goose["hooks"]["Stop"][0]["hooks"][0]["command"], r"'C:\O'\''Neil\ondine.exe' notify --source goose");
        assert!(hook_config("aider", EXE).is_none());
        assert!(serde_json::from_str::<Value>(&goose_plugin_json()).unwrap()["name"] == "ondine");
    }

    #[test]
    fn catalog_is_consistent() {
        for t in TOOLS {
            assert!(valid_word(t.word).is_some(), "{}", t.id);
            assert!(t.setting.starts_with("launch"));
            assert_eq!(hook_config(t.id, EXE).is_some(), t.hooks, "{}", t.id);
        }
        assert_eq!(who("copilot"), Some("Copilot"));
        assert_eq!(who("other"), Some("L'outil"));
        assert_eq!(who("x"), None);
        assert_eq!(other_tool_line(EXE), format!("\"{EXE}\" notify --source other --event done"));
    }
}
