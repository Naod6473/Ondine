// Le bus d'événements, côté Rust.
//
// Il n'y a qu'UN bus logique, partagé par la fenêtre de l'île, la fenêtre de
// réglages et le Rust :
//
//   front (île) ──bus_publish──▶ Rust ──▶ modules Rust qui écoutent ce sujet
//                                    └──▶ événement Tauri "bus" vers toutes les fenêtres
//   Rust (module) ──bus::emit──────────▶ événement Tauri "bus" vers toutes les fenêtres
//
// Chaque message dit d'où il vient (`origin` = étiquette de la fenêtre, ou "rust"),
// pour qu'une fenêtre ignore l'écho de ses propres messages.
//
// Les modules ne s'appellent jamais directement : ils publient et écoutent des sujets
// (ex. "hello.greeted", "task.finished"). Voir ARCHITECTURE.md pour la liste.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::services::log;

/// Nom de l'événement Tauri qui transporte les messages du bus.
pub const TAURI_EVENT: &str = "bus";
/// Taille maximale d'un message (le bus transporte des signaux, pas des fichiers).
const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusMessage {
    /// Sujet, ex. "hello.greeted". Lettres minuscules, chiffres, `.`, `-`, `_`.
    pub topic: String,
    /// Données libres (JSON).
    pub payload: Value,
    /// Qui publie : "island", "settings", ou l'id d'un module.
    pub source: String,
    /// D'où vient le message : étiquette de fenêtre, ou "rust".
    pub origin: String,
}

/// Vérifie la forme d'un sujet. Un sujet invalide est refusé, pas corrigé.
pub fn check_topic(topic: &str) -> Result<(), String> {
    let ok = !topic.is_empty()
        && topic.len() <= 64
        && topic
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'));
    if ok {
        Ok(())
    } else {
        Err(format!("sujet de bus invalide : {topic:?}"))
    }
}

/// Est-ce que `pattern` couvre `topic` ? "*" = tout, "hello.*" = tout ce qui commence par "hello.".
pub fn matches(pattern: &str, topic: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    match pattern.strip_suffix('*') {
        Some(prefix) => topic.starts_with(prefix),
        None => pattern == topic,
    }
}

/// Publie un message depuis le Rust (un module, ou l'île elle-même).
pub fn emit(app: &AppHandle, source: &str, topic: &str, payload: Value) {
    let msg = BusMessage { topic: topic.into(), payload, source: source.into(), origin: "rust".into() };
    deliver(app, msg);
}

/// Point d'entrée commun : distribue aux modules Rust, puis à toutes les fenêtres.
pub fn deliver(app: &AppHandle, msg: BusMessage) {
    if let Err(err) = check_topic(&msg.topic) {
        log::warn(err);
        return;
    }
    if serde_json::to_vec(&msg.payload).map(|b| b.len()).unwrap_or(0) > MAX_PAYLOAD_BYTES {
        log::warn(format!("message de bus trop gros ignoré : {}", msg.topic));
        return;
    }
    log::debug(format!("bus {} (de {})", msg.topic, msg.source));
    crate::modules::dispatch_event(app, &msg);
    let _ = app.emit(TAURI_EVENT, msg);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns() {
        assert!(matches("*", "a.b"));
        assert!(matches("hello.*", "hello.ping"));
        assert!(!matches("hello.*", "task.finished"));
        assert!(matches("task.finished", "task.finished"));
    }

    #[test]
    fn topics() {
        assert!(check_topic("hello.greeted").is_ok());
        assert!(check_topic("Hello").is_err());
        assert!(check_topic("").is_err());
    }
}
