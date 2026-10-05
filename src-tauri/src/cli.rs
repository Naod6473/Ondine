// « island.exe notify » : la porte d'entrée des autres outils vers l'île.
//
//   island.exe notify --source claude-code      (le JSON du hook arrive sur l'entrée standard)
//   island.exe notify --title "Sauvegarde" --message "Terminée"
//
// Le programme ne démarre pas l'île : il emballe ce qu'il a reçu dans un
// petit JSON, l'envoie par le canal local de l'île (named pipe, réservé à
// l'utilisateur Windows courant, jamais depuis le réseau), puis s'arrête.
//
// L'ancien `notify` de Codex donne son JSON comme DERNIER PARAMÈTRE (pas
// sur l'entrée standard) : un paramètre qui est un objet JSON est donc lu
// comme le hook.
//
// Il se termine TOUJOURS avec le code 0 : un hook ne doit jamais être bloqué
// ou ralenti parce que l'île est fermée. Il n'écrit rien, sauf « {} » pour
// Codex et Gemini, qui attendent du JSON sur la sortie (« {} » = aucune
// décision : l'île observe, elle ne répond jamais à la place de l'utilisateur).

use std::io::{IsTerminal, Read};

use serde_json::{json, Value};

use crate::platform;

/// Taille maximale d'un message (le JSON d'un hook fait quelques centaines d'octets).
pub const MAX_MESSAGE: usize = 64 * 1024;

pub fn notify(args: Vec<String>) {
    let mut message = build(&args, read_stdin());
    // Pour « Y aller » : les programmes au-dessus de nous (le terminal de
    // l'agent en fait partie) et notre console, si elle est visible.
    message["pids"] = json!(platform::ancestor_pids(8));
    message["hwnd"] = json!(platform::own_console_window());
    let _ = platform::send_agents_pipe(message.to_string().as_bytes());
    if matches!(message["source"].as_str(), Some("codex") | Some("gemini")) {
        println!("{{}}");
    }
}

/// L'entrée standard, si un programme nous l'envoie (pas si on tape la
/// commande à la main dans une console : on attendrait pour rien).
fn read_stdin() -> Option<String> {
    let stdin = std::io::stdin();
    if stdin.is_terminal() {
        return None;
    }
    let mut text = String::new();
    stdin.lock().take(MAX_MESSAGE as u64).read_to_string(&mut text).ok()?;
    Some(text)
}

/// Le message envoyé à l'île : les options, plus le JSON reçu (s'il en est un).
fn build(args: &[String], stdin: Option<String>) -> Value {
    let mut out = json!({ "v": 1 });
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let key = match arg.as_str() {
            "--source" => "source",
            "--title" => "title",
            "--message" => "message",
            // Un objet JSON en paramètre : le hook (ancien `notify` de Codex).
            other if other.starts_with('{') => {
                if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(other) {
                    out["hook"] = v;
                }
                continue;
            }
            _ => continue, // option inconnue : ignorée
        };
        if let Some(value) = it.next() {
            out[key] = json!(value);
        }
    }
    if let Some(text) = stdin.filter(|t| !t.trim().is_empty()) {
        // Du JSON (un hook) → tel quel ; sinon, du texte → le message.
        match serde_json::from_str::<Value>(&text) {
            Ok(v) if v.is_object() && out.get("hook").is_none() => out["hook"] = v,
            _ if out.get("message").is_none() => out["message"] = json!(text.trim()),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn options_and_hook_json() {
        let m = build(&args(&["--source", "claude-code"]), Some(r#"{"hook_event_name":"Stop","cwd":"C:\\x"}"#.into()));
        assert_eq!(m["source"], "claude-code");
        assert_eq!(m["hook"]["hook_event_name"], "Stop");
    }

    #[test]
    fn codex_json_as_last_argument() {
        let m = build(&args(&["--source", "codex", r#"{"type":"agent-turn-complete","turn-id":"1"}"#]), None);
        assert_eq!(m["hook"]["type"], "agent-turn-complete");
    }

    #[test]
    fn plain_text_becomes_the_message() {
        let m = build(&args(&["--title", "Sauvegarde"]), Some("Terminée\n".into()));
        assert_eq!(m["title"], "Sauvegarde");
        assert_eq!(m["message"], "Terminée");
        let m = build(&args(&["--message", "ok", "--bizarre"]), None);
        assert_eq!(m["message"], "ok");
    }
}

// ── « island.exe permission » : Autoriser / Refuser depuis l'île ─────────────
//
//   island.exe permission --source claude-code   (hook PermissionRequest)
//   island.exe permission --source codex
//
// Claude Code ou Codex va te demander la permission d'utiliser un outil
// (« Bash : npm test »). Ce hook la montre dans l'île et attend ta réponse :
//   - « Autoriser » (confirmé une 2e fois) → la décision « allow » ;
//   - « Refuser » → « deny » ;
//   - pas de réponse à temps, réglage désactivé, île fermée → AUCUNE décision
//     (« {} ») : la question habituelle s'affiche dans le terminal.
// Seuls le nom de l'outil et un court résumé de ce qu'il va faire (la
// commande, le fichier) partent vers l'île : pas le contenu des fichiers.
// Rien n'est journalisé. Code de sortie toujours 0.

/// Longueur maximale du résumé envoyé à l'île.
const MAX_DETAIL: usize = 500;

pub fn permission(args: Vec<String>) {
    let message = build(&args, read_stdin());
    let decision = permission_request(&message).unwrap_or(None);
    println!("{}", decision_json(decision.as_deref()));
}

/// Envoie la demande à l'île et lit sa réponse : Some("allow" | "deny") ou None.
fn permission_request(message: &Value) -> Result<Option<String>, String> {
    let hook = &message["hook"];
    if hook["hook_event_name"] != "PermissionRequest" {
        return Ok(None);
    }
    let request = json!({
        "v": 1,
        "source": "permission",
        "client": message["source"],
        "tool": hook["tool_name"],
        "detail": permission_detail(hook),
        "session": hook["session_id"],
        "cwd": hook["cwd"],
        "pids": platform::ancestor_pids(8),
        "hwnd": platform::own_console_window(),
    });
    let reply = platform::request_agents_pipe(request.to_string().as_bytes())?;
    let reply: Value = serde_json::from_slice(&reply).map_err(|e| e.to_string())?;
    Ok(match reply["answer"].as_str() {
        Some(a @ ("allow" | "deny")) => Some(a.to_string()),
        _ => None,
    })
}

/// Ce que l'outil va faire, en une ligne : la commande, le fichier, l'adresse…
/// (jamais le contenu d'un fichier à écrire).
fn permission_detail(hook: &Value) -> String {
    let input = &hook["tool_input"];
    let first = ["command", "file_path", "notebook_path", "path", "url", "pattern", "description"]
        .iter()
        .find_map(|k| input[k].as_str().filter(|v| !v.trim().is_empty()));
    let text = match first {
        Some(t) => t.to_string(),
        None => {
            // Un autre outil (MCP…) : ses paramètres, sans les longs textes.
            let short: serde_json::Map<String, Value> = input
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, v)| !v.as_str().is_some_and(|s| s.len() > 120))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            if short.is_empty() { String::new() } else { Value::Object(short).to_string() }
        }
    };
    let mut cut: String = text.chars().take(MAX_DETAIL).collect();
    if text.chars().count() > MAX_DETAIL {
        cut.push('…');
    }
    cut
}

/// La sortie attendue par Claude Code et Codex (même format) ; « {} » = pas de décision.
fn decision_json(decision: Option<&str>) -> Value {
    match decision {
        Some("allow") => json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }),
        Some("deny") => json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny", "message": "Refusé par l'utilisateur depuis l'île." } } }),
        _ => json!({}),
    }
}

#[cfg(test)]
mod permission_tests {
    use super::*;

    #[test]
    fn details_never_carry_file_contents() {
        assert_eq!(permission_detail(&json!({ "tool_input": { "command": "npm test" } })), "npm test");
        let d = permission_detail(&json!({ "tool_input": { "file_path": "C:\\x\\a.rs", "content": "secret" } }));
        assert_eq!(d, "C:\\x\\a.rs");
        let d = permission_detail(&json!({ "tool_input": { "query": "rust", "body": "x".repeat(500) } }));
        assert_eq!(d, r#"{"query":"rust"}"#);
        assert_eq!(permission_detail(&json!({ "tool_input": { "command": "a".repeat(900) } })).chars().count(), MAX_DETAIL + 1);
    }

    #[test]
    fn decisions() {
        assert_eq!(decision_json(Some("allow"))["hookSpecificOutput"]["decision"]["behavior"], "allow");
        assert_eq!(decision_json(Some("deny"))["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert_eq!(decision_json(None), json!({}));
        assert_eq!(decision_json(Some("bizarre")), json!({}));
    }
}

// ── « island.exe mcp » : l'île comme serveur MCP ─────────────────────────────
//
// Claude Code, Codex ou Gemini CLI lancent « island.exe mcp » et lui parlent
// en JSON-RPC (le protocole MCP), une ligne par message, sur l'entrée et la
// sortie standard. On propose quatre outils à l'agent :
//   - island_notify   : afficher une notification ;
//   - island_ask      : poser une question avec 2 à 4 boutons, et attendre ton choix ;
//   - island_progress : montrer une progression (« étape 3/7 ») ;
//   - island_timer    : lancer le minuteur de l'île.
// Chaque appel est transmis à l'île par le même canal local que « notify ».
// La sortie standard ne sert QU'AU protocole : aucun autre texte n'y est écrit.

/// Les versions du protocole MCP qu'on sait parler (la plus récente en dernier).
const MCP_VERSIONS: &[&str] = &["2024-11-05", "2025-03-26", "2025-06-18"];

pub fn mcp() {
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    // Le nom de l'agent qui nous parle (donné à l'ouverture), pour l'affichage.
    let mut client = String::from("agent");
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(reply) = mcp_handle(&msg, &mut client, &|request| {
            let mut m = json!({ "v": 1, "source": "mcp", "client": client_label(&request.1), "request": request.0 });
            m["pids"] = json!(platform::ancestor_pids(8));
            m["hwnd"] = json!(platform::own_console_window());
            m
        }) {
            let _ = writeln!(out, "{reply}");
            let _ = out.flush();
        }
    }
}

/// Le nom d'un client MCP → « claude », « codex », « gemini » ou « agent ».
fn client_label(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if n.contains("claude") {
        "claude-code"
    } else if n.contains("codex") {
        "codex"
    } else if n.contains("gemini") {
        "gemini"
    } else {
        "agent"
    }
}

/// Un message JSON-RPC → la réponse à écrire (None pour une simple notification).
/// `wrap` emballe une demande pour l'île (séparé pour pouvoir tester).
fn mcp_handle(msg: &Value, client: &mut String, wrap: &dyn Fn((Value, String)) -> Value) -> Option<Value> {
    let id = msg.get("id").cloned()?; // pas d'id = notification : pas de réponse
    let method = msg["method"].as_str().unwrap_or("");
    let ok = |result: Value| json!({ "jsonrpc": "2.0", "id": id, "result": result });
    let err = |code: i32, message: &str| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } });
    Some(match method {
        "initialize" => {
            *client = msg["params"]["clientInfo"]["name"].as_str().unwrap_or("agent").chars().take(40).collect();
            let asked = msg["params"]["protocolVersion"].as_str().unwrap_or("");
            let version = if MCP_VERSIONS.contains(&asked) { asked } else { MCP_VERSIONS[MCP_VERSIONS.len() - 1] };
            ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "island", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "L'île est une barre en haut de l'écran Windows de l'utilisateur. Utilise island_ask pour lui poser une question courte à choix, island_progress pour montrer l'avancement d'une longue tâche, island_notify pour un message bref.",
            }))
        }
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": mcp_tools() })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let args = msg["params"]["arguments"].clone();
            match mcp_call(name, &args, &*client, wrap) {
                Ok(text) => ok(json!({ "content": [{ "type": "text", "text": text }], "isError": false })),
                Err(text) => ok(json!({ "content": [{ "type": "text", "text": text }], "isError": true })),
            }
        }
        _ => err(-32601, "méthode inconnue"),
    })
}

/// La description des outils, telle que l'agent la lit.
fn mcp_tools() -> Value {
    json!([
        {
            "name": "island_notify",
            "description": "Affiche une notification courte dans l'île (en haut de l'écran de l'utilisateur).",
            "inputSchema": { "type": "object", "properties": {
                "title": { "type": "string", "description": "Titre, quelques mots" },
                "message": { "type": "string", "description": "Détail facultatif, une phrase" }
            }, "required": ["title"] }
        },
        {
            "name": "island_ask",
            "description": "Pose une question à l'utilisateur dans l'île, avec 2 à 4 boutons de réponse, et attend son choix. Renvoie le texte du bouton choisi, ou indique qu'il n'a pas répondu à temps.",
            "inputSchema": { "type": "object", "properties": {
                "question": { "type": "string", "description": "La question, courte" },
                "options": { "type": "array", "items": { "type": "string" }, "minItems": 2, "maxItems": 4, "description": "Les réponses possibles (quelques mots chacune)" },
                "timeout_minutes": { "type": "number", "description": "Attente maximale, 1 à 25 minutes (10 par défaut)" }
            }, "required": ["question", "options"] }
        },
        {
            "name": "island_progress",
            "description": "Montre l'avancement d'une longue tâche dans l'île (par exemple étape 3 sur 7).",
            "inputSchema": { "type": "object", "properties": {
                "title": { "type": "string", "description": "Ce qui est en cours" },
                "step": { "type": "integer", "minimum": 0 },
                "total": { "type": "integer", "minimum": 1 }
            }, "required": ["title", "step", "total"] }
        },
        {
            "name": "island_timer",
            "description": "Lance le minuteur de l'île (par exemple pour une pause ou un rappel).",
            "inputSchema": { "type": "object", "properties": {
                "minutes": { "type": "integer", "minimum": 1, "maximum": 180 }
            }, "required": ["minutes"] }
        }
    ])
}

/// Un appel d'outil → le texte rendu à l'agent.
fn mcp_call(name: &str, args: &Value, client: &str, wrap: &dyn Fn((Value, String)) -> Value) -> Result<String, String> {
    let text = |k: &str| args[k].as_str().unwrap_or("").trim().to_string();
    let request = match name {
        "island_notify" => {
            if text("title").is_empty() {
                return Err("« title » est obligatoire".into());
            }
            json!({ "tool": "notify", "title": text("title"), "message": text("message") })
        }
        "island_ask" => {
            let options: Vec<String> = args["options"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            if text("question").is_empty() || !(2..=4).contains(&options.len()) {
                return Err("il faut une question et 2 à 4 options".into());
            }
            let minutes = args["timeout_minutes"].as_f64().unwrap_or(10.0).clamp(1.0, 25.0); // Claude Code coupe un outil muet après 30 min
            json!({ "tool": "ask", "question": text("question"), "options": options, "timeoutSecs": (minutes * 60.0) as u64 })
        }
        "island_progress" => {
            let (step, total) = (args["step"].as_u64().unwrap_or(0), args["total"].as_u64().unwrap_or(0));
            if total == 0 || step > total {
                return Err("« step » doit être entre 0 et « total »".into());
            }
            json!({ "tool": "progress", "title": text("title"), "step": step, "total": total })
        }
        "island_timer" => {
            let minutes = args["minutes"].as_u64().filter(|m| (1..=180).contains(m)).ok_or("« minutes » doit être entre 1 et 180")?;
            json!({ "tool": "timer", "minutes": minutes })
        }
        other => return Err(format!("outil inconnu : {other}")),
    };
    let is_ask = name == "island_ask";
    let message = wrap((request, client.to_string())).to_string();
    if !is_ask {
        platform::send_agents_pipe(message.as_bytes())?;
        return Ok("Affiché dans l'île.".into());
    }
    // La question : on attend la réponse de l'île (ton clic, ou le délai dépassé).
    let reply = platform::request_agents_pipe(message.as_bytes())?;
    let reply: Value = serde_json::from_slice(&reply).map_err(|_| "l'île n'a pas répondu".to_string())?;
    match reply["answer"].as_str() {
        Some(answer) => Ok(format!("L'utilisateur a choisi : {answer}")),
        None => Ok(reply["reason"].as_str().unwrap_or("Pas de réponse de l'utilisateur à temps.").to_string()),
    }
}

#[cfg(test)]
mod mcp_tests {
    use super::*;

    fn call(msg: Value) -> Option<Value> {
        let mut client = String::new();
        mcp_handle(&msg, &mut client, &|r| json!({ "request": r.0 }))
    }

    #[test]
    fn initialize_and_list() {
        let r = call(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26", "clientInfo": { "name": "claude-code" } } })).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], "island");
        let r = call(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": { "protocolVersion": "2099-01-01" } })).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
        let r = call(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" })).unwrap();
        assert_eq!(r["result"]["tools"].as_array().unwrap().len(), 4);
        assert!(call(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        assert_eq!(call(json!({ "jsonrpc": "2.0", "id": 4, "method": "bizarre" })).unwrap()["error"]["code"], -32601);
    }

    #[test]
    fn bad_arguments_are_tool_errors() {
        let r = call(json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "island_ask", "arguments": { "question": "?", "options": ["un"] } } })).unwrap();
        assert_eq!(r["result"]["isError"], true);
        let r = call(json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": { "name": "island_timer", "arguments": { "minutes": 999 } } })).unwrap();
        assert_eq!(r["result"]["isError"], true);
        assert_eq!(client_label("gemini-cli-mcp-client"), "gemini");
    }
}
