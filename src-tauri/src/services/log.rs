// Le journal : %LOCALAPPDATA%\Island\logs\island.log
//
// - Quatre niveaux (error, warn, info, debug). Le niveau minimum vient des réglages.
// - Rotation : au-delà de 1 Mo, island.log devient island.log.1 (on garde 3 anciens).
// - Jamais de contenu sensible : chaque ligne passe par `redact`, qui masque ce qui
//   ressemble à une clé ou à un jeton. C'est un filet de sécurité, pas une excuse :
//   n'écris jamais une clé, un mot de passe ou le contenu d'un fichier dans le journal.
// - Rien ne quitte la machine.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

use crate::platform;

const MAX_BYTES: u64 = 1_000_000;
const KEEP_OLD: u32 = 3;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
}

impl Level {
    pub fn parse(s: &str) -> Level {
        match s {
            "error" => Level::Error,
            "warn" => Level::Warn,
            "debug" => Level::Debug,
            _ => Level::Info,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Warn => "WARN ",
            Level::Info => "INFO ",
            Level::Debug => "DEBUG",
        }
    }
}

/// Niveau minimum écrit dans le fichier (Info par défaut).
static MIN_LEVEL: AtomicU8 = AtomicU8::new(Level::Info as u8);
/// Un seul thread écrit à la fois, sinon la rotation pourrait se croiser.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn set_min_level(level: Level) {
    MIN_LEVEL.store(level as u8, Ordering::Relaxed);
}

pub fn dir() -> PathBuf {
    platform::local_dir().join("logs")
}

fn file() -> PathBuf {
    dir().join("island.log")
}

pub fn error(message: impl AsRef<str>) {
    write(Level::Error, "app", message.as_ref());
}
pub fn warn(message: impl AsRef<str>) {
    write(Level::Warn, "app", message.as_ref());
}
pub fn info(message: impl AsRef<str>) {
    write(Level::Info, "app", message.as_ref());
}
pub fn debug(message: impl AsRef<str>) {
    write(Level::Debug, "app", message.as_ref());
}

/// Écrit une ligne. `source` dit qui parle : "app", "ui", ou l'id d'un module.
pub fn write(level: Level, source: &str, message: &str) {
    if level as u8 > MIN_LEVEL.load(Ordering::Relaxed) {
        return;
    }
    let line = format!(
        "{} {} [{}] {}",
        platform::local_time().stamp(),
        level.label(),
        source,
        redact(message).replace(['\r', '\n'], " ⏎ ")
    );
    // En développement, on voit aussi les lignes dans le terminal.
    #[cfg(debug_assertions)]
    eprintln!("{line}");

    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if std::fs::create_dir_all(dir()).is_err() {
        return;
    }
    rotate_if_needed();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file()) {
        let _ = writeln!(f, "{line}");
    }
}

fn rotate_if_needed() {
    let path = file();
    let too_big = std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false);
    if !too_big {
        return;
    }
    // island.log.2 → .3, .1 → .2, island.log → .1 (l'ancien .3 est écrasé).
    for i in (1..KEEP_OLD).rev() {
        let from = dir().join(format!("island.log.{i}"));
        let to = dir().join(format!("island.log.{}", i + 1));
        let _ = std::fs::rename(from, to);
    }
    let _ = std::fs::rename(&path, dir().join("island.log.1"));
}

/// Masque ce qui ressemble à un secret : toute « mot » de 32 caractères ou plus
/// fait de lettres, chiffres, `-` ou `_` (clés API, jetons), et tout ce qui
/// commence par `sk-`.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        if word.len() >= 32 || word.starts_with("sk-") {
            out.push_str("[masqué]");
        } else {
            out.push_str(word);
        }
        word.clear();
    };
    for c in text.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            word.push(c);
        } else {
            flush(&mut word, &mut out);
            out.push(c);
        }
    }
    flush(&mut word, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn masks_keys_and_long_tokens() {
        assert_eq!(redact("clé sk-ant-abc123 ok"), "clé [masqué] ok");
        let token = "a".repeat(40);
        assert_eq!(redact(&format!("jeton={token}")), "jeton=[masqué]");
        assert_eq!(redact("rien de secret ici"), "rien de secret ici");
    }
}
