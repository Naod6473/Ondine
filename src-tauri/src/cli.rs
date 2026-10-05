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
