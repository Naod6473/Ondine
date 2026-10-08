// Agents IA : « Reprendre » la dernière session de Claude Code dans un projet.
//
// Claude Code range chaque session dans un fichier JSONL (une ligne JSON par
// message) : %USERPROFILE%\.claude\projects\<dossier encodé>\<session>.jsonl
// (ou CLAUDE_CONFIG_DIR\projects\…). Le « dossier encodé » est le chemin du
// projet où chaque caractère qui n'est ni une lettre ASCII ni un chiffre
// devient « - » : « C:\Projets\Island » → « C--Projets-Island ».
//
// Pour montrer, à côté du bouton « Reprendre », la dernière phrase échangée,
// on lit seulement la FIN du fichier le plus récent (256 Ko, puis 2 Mo au
// plus si rien n'y est trouvé), et on garde le dernier texte de vous ou de
// Claude, coupé à 120 caractères, avec sa date. Les lignes abîmées sont
// ignorées. Ce texte reste sur le PC : il n'est jamais écrit dans le journal
// ni envoyé ailleurs qu'à l'onglet.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

/// Claude Code coupe les noms de dossier trop longs à 200 caractères et ajoute
/// une empreinte (« -abc123 ») : on retrouve alors le dossier par son début.
const MAX_ENCODED: usize = 200;
/// Les fins de fichier lues, l'une après l'autre si la première ne suffit pas.
const TAILS: [u64; 2] = [256 * 1024, 2 * 1024 * 1024];
/// La longueur de la phrase montrée.
const MAX_TEXT: usize = 120;

/// La dernière session d'un projet.
#[derive(Debug, Clone, PartialEq)]
pub struct LastSession {
    /// Le dernier texte échangé (None si on ne l'a pas lu, ou pas trouvé).
    pub text: Option<String>,
    /// "user" (vous) ou "assistant" (Claude).
    pub who: Option<&'static str>,
    /// Quand (ms depuis 1970) : la date du message, sinon celle du fichier.
    pub at: u64,
}

/// Un message trouvé dans le fichier.
#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub who: &'static str,
    pub text: String,
    pub at: Option<u64>,
}

/// Le nom du dossier de Claude Code pour un projet. Comme Claude Code (en
/// JavaScript, qui compte en UTF-16) : un caractère hors ASCII devient « - »,
/// un emoji « -- ».
pub fn encode_project(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else {
            out.extend(std::iter::repeat_n('-', c.len_utf16()));
        }
    }
    out
}

/// Le dossier des sessions d'un projet dans `projects` (…\.claude\projects).
/// Le nom exact, sinon le même à la casse près (« c:\ » tapé en minuscules),
/// sinon, pour un très long chemin, le début du nom suivi d'une empreinte.
pub fn find_project_dir(projects: &Path, encoded: &str) -> Option<PathBuf> {
    if encoded.is_empty() {
        return None;
    }
    let exact = projects.join(encoded);
    if exact.is_dir() {
        return Some(exact);
    }
    // `encoded` n'a que des caractères ASCII : on peut le couper n'importe où.
    let prefix = (encoded.len() > MAX_ENCODED).then(|| format!("{}-", &encoded[..MAX_ENCODED]).to_ascii_lowercase());
    std::fs::read_dir(projects)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.eq_ignore_ascii_case(encoded) || prefix.as_ref().is_some_and(|p| name.to_ascii_lowercase().starts_with(p.as_str()))
        })
        .map(|e| e.path())
}

/// Le fichier de session le plus récent d'un dossier, et sa date. Les
/// fichiers « agent-… » (sous-agents des anciennes versions) sont ignorés.
pub fn latest_transcript(dir: &Path) -> Option<(PathBuf, SystemTime)> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".jsonl") && !name.starts_with("agent-")
        })
        .filter_map(|e| {
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            Some((e.path(), meta.modified().ok()?))
        })
        .max_by_key(|(_, modified)| *modified)
}

/// La dernière session de Claude Code dans `project`. `read_text` : lire
/// aussi la dernière phrase (sinon, seulement savoir qu'il y en a une).
pub fn last_session(projects: &Path, project: &Path, read_text: bool) -> Option<LastSession> {
    let dir = find_project_dir(projects, &encode_project(&project.to_string_lossy()))?;
    let (file, modified) = latest_transcript(&dir)?;
    let file_ms = modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let message = if read_text { last_message(&file) } else { None };
    Some(LastSession {
        at: message.as_ref().and_then(|m| m.at).unwrap_or(file_ms),
        who: message.as_ref().map(|m| m.who),
        text: message.map(|m| m.text),
    })
}

/// Le dernier message d'un fichier de session, en ne lisant que sa fin.
pub fn last_message(file: &Path) -> Option<Message> {
    last_message_cut(file, MAX_TEXT)
}

/// Le chemin de transcription reçu dans un hook de Claude Code
/// (`transcript_path`), accepté seulement s'il est un fichier `.jsonl`
/// existant sous `root` (…\.claude\projects). Tout autre chemin est ignoré :
/// un hook ne fait jamais lire un fichier quelconque.
pub fn transcript_path(raw: &str, root: &Path) -> Option<PathBuf> {
    let path = Path::new(raw);
    if !path.is_absolute() || !raw.to_ascii_lowercase().ends_with(".jsonl") {
        return None;
    }
    let real = std::fs::canonicalize(path).ok()?;
    let root = std::fs::canonicalize(root).ok()?;
    if !real.starts_with(&root) || !real.is_file() {
        return None;
    }
    Some(real)
}

/// Comme `last_message`, avec la longueur voulue (la notification « a fini »
/// montre jusqu'à 200 caractères).
pub fn last_message_cut(file: &Path, max: usize) -> Option<Message> {
    let mut f = std::fs::File::open(file).ok()?;
    let len = f.metadata().ok()?.len();
    for tail in TAILS {
        let start = len.saturating_sub(tail);
        f.seek(SeekFrom::Start(start)).ok()?;
        let mut bytes = Vec::new();
        (&mut f).take(tail).read_to_end(&mut bytes).ok()?;
        // On est sans doute arrivé au milieu d'une ligne : on la saute.
        if start > 0 {
            let first = bytes.iter().position(|b| *b == b'\n').map(|i| i + 1).unwrap_or(bytes.len());
            bytes.drain(..first);
        }
        if let Some(m) = last_in_cut(&String::from_utf8_lossy(&bytes), max) {
            return Some(m);
        }
        if start == 0 {
            break; // tout le fichier est lu
        }
    }
    None
}

/// Le dernier texte de vous ou de Claude dans des lignes JSONL (la plus
/// récente en dernier). Les lignes abîmées et ce qui n'est pas une phrase
/// (résultats d'outils, commandes internes, sous-agents) sont ignorés.
#[cfg(test)]
pub fn last_in(lines: &str) -> Option<Message> {
    last_in_cut(lines, MAX_TEXT)
}

/// `last_in`, avec la longueur voulue.
pub fn last_in_cut(lines: &str, max: usize) -> Option<Message> {
    lines.lines().rev().find_map(|line| {
        let v: Value = serde_json::from_str(line.trim()).ok()?;
        let who = match v["type"].as_str()? {
            "user" => "user",
            "assistant" => "assistant",
            _ => return None,
        };
        let flag = |k: &str| v[k].as_bool() == Some(true);
        if flag("isSidechain") || flag("isMeta") || flag("isCompactSummary") || flag("isVisibleInTranscriptOnly") {
            return None;
        }
        let text = message_text(&v["message"]["content"], max)?;
        let at = v["timestamp"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp_millis().max(0) as u64);
        Some(Message { who, text, at })
    })
}

/// Le texte d'un message : une chaîne, ou les morceaux « text » d'une liste.
/// None pour un résultat d'outil, un message interne (« <command-name>… »,
/// « [Request interrupted by user] ») ou un texte vide.
fn message_text(content: &Value, max: usize) -> Option<String> {
    let raw = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => {
            if blocks.iter().any(|b| b["type"] == "tool_result") {
                return None;
            }
            blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join(" ")
        }
        _ => return None,
    };
    let text = one_line(&raw);
    if text.is_empty() || internal(&text) {
        return None;
    }
    Some(cut(&text, max))
}

/// Un message que Claude Code écrit lui-même : « <command-name>/clear… »,
/// « <local-command-stdout>… », « [Request interrupted by user] ». Ses
/// balises ont toujours un tiret (une balise HTML tapée, comme « <div> », non).
fn internal(text: &str) -> bool {
    if text.starts_with("[Request interrupted") {
        return true;
    }
    let Some(rest) = text.strip_prefix('<') else { return false };
    let tag: String = rest.chars().take_while(|c| *c != '>').collect();
    tag.contains('-') && tag.len() < 40 && rest.len() > tag.len() && tag.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c == '_')
}

/// Sur une seule ligne : espaces et retours regroupés, sans « # » ni « > »
/// de mise en forme au début.
fn one_line(raw: &str) -> String {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.trim_start_matches(['#', '>', ' ']).to_string()
}

fn cut(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max - 1).collect::<String>().trim_end().to_string();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_path_must_be_a_jsonl_under_the_root() {
        let base = std::env::temp_dir().join(format!("ondine-transcript-{}", std::process::id()));
        let root = base.join("projects");
        let dir = root.join("C--Projets-Island");
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("s1.jsonl");
        std::fs::write(&ok, "{}\n").unwrap();
        let outside = base.join("ailleurs.jsonl");
        std::fs::write(&outside, "{}\n").unwrap();
        let txt = dir.join("notes.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(transcript_path(&ok.display().to_string(), &root).is_some());
        assert_eq!(transcript_path(&outside.display().to_string(), &root), None);
        assert_eq!(transcript_path(&txt.display().to_string(), &root), None);
        assert_eq!(transcript_path(&dir.display().to_string(), &root), None); // un dossier
        assert_eq!(transcript_path("relatif.jsonl", &root), None);
        assert_eq!(transcript_path(&root.join("absent.jsonl").display().to_string(), &root), None);
        // La dernière phrase, coupée à la longueur voulue.
        std::fs::write(&ok, "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Les tests passent, tout est en ordre.\"}]}}\n").unwrap();
        assert_eq!(last_message_cut(&ok, 10).unwrap().text, "Les tests…");
        let _ = std::fs::remove_dir_all(&base);
    }
    use serde_json::json;

    #[test]
    fn paths_are_encoded_like_claude_code() {
        assert_eq!(encode_project(r"C:\Users\Simon\Projets\Island"), "C--Users-Simon-Projets-Island");
        assert_eq!(encode_project("/home/claude/Ondine"), "-home-claude-Ondine");
        // Espace, point, tiret, accent : tous en « - ».
        assert_eq!(encode_project(r"D:\Mes projets\île-v1.2"), "D--Mes-projets--le-v1-2");
        // Un emoji compte double (UTF-16), comme en JavaScript.
        assert_eq!(encode_project("C:\\a😀b"), "C--a--b");
    }

    #[test]
    fn project_dir_found_exactly_ignoring_case_or_by_prefix() {
        let root = std::env::temp_dir().join(format!("ondine-claude-projects-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("C--Projets-Island")).unwrap();
        let long = "x".repeat(250);
        std::fs::create_dir_all(root.join(format!("{}-k3j2h1", &long[..200]))).unwrap();
        assert_eq!(find_project_dir(&root, "C--Projets-Island"), Some(root.join("C--Projets-Island")));
        assert!(find_project_dir(&root, "c--projets-island").is_some());
        assert!(find_project_dir(&root, &long).is_some());
        assert!(find_project_dir(&root, "C--Ailleurs").is_none());
        assert!(find_project_dir(&root, "").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn line(v: Value) -> String {
        v.to_string()
    }

    #[test]
    fn the_last_sentence_is_found() {
        let lines = [
            line(json!({ "type": "user", "message": { "role": "user", "content": "Ajoute un bouton Reprendre" }, "timestamp": "2026-10-07T10:00:00.000Z" })),
            line(json!({ "type": "assistant", "message": { "content": [{ "type": "thinking", "thinking": "…" }, { "type": "text", "text": "## Fait\n\nLe bouton   est là." }] }, "timestamp": "2026-10-07T10:05:00.000Z" })),
            // Après : rien qui soit une phrase.
            line(json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Bash" }] } })),
            line(json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "secret" }] } })),
            line(json!({ "type": "user", "isMeta": true, "message": { "content": "Caveat: …" } })),
            line(json!({ "type": "user", "message": { "content": "<command-name>/clear</command-name>" } })),
            line(json!({ "type": "user", "message": { "content": "[Request interrupted by user]" } })),
            line(json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "sous-agent" }] } })),
            line(json!({ "type": "summary", "summary": "Résumé" })),
            "{ ligne abîmée".to_string(),
            String::new(),
        ]
        .join("\n");
        let m = last_in(&lines).unwrap();
        assert_eq!((m.who, m.text.as_str()), ("assistant", "Fait Le bouton est là."));
        assert_eq!(m.at, Some(1_791_367_500_000));
        // Seulement des lignes abîmées : rien.
        assert!(last_in("pas du json\n{\"type\":").is_none());
    }

    #[test]
    fn long_texts_are_cut() {
        let long = format!("{} fin", "mot ".repeat(60));
        let lines = line(json!({ "type": "user", "message": { "content": long } }));
        let m = last_in(&lines).unwrap();
        assert!(m.text.chars().count() <= MAX_TEXT && m.text.ends_with('…'), "{}", m.text);
        assert_eq!(m.at, None);
        assert!(internal("<local-command-stdout>ok</local-command-stdout>"));
        assert!(!internal("<div> en HTML, est-ce correct ?"));
        assert!(!internal("Bonjour"));
    }

    #[test]
    fn only_the_end_of_a_big_file_is_read() {
        let dir = std::env::temp_dir().join(format!("ondine-claude-session-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let project = dir.join("projects").join(encode_project(r"C:\Projets\Island"));
        std::fs::create_dir_all(&project).unwrap();
        // Un vieux fichier, puis un récent de plus de 256 Ko dont seule la fin compte.
        std::fs::write(project.join("vieux.jsonl"), line(json!({ "type": "user", "message": { "content": "ancienne" } }))).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        let filler = line(json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "x".repeat(1000) }] } }));
        let mut text = vec![line(json!({ "type": "user", "message": { "content": "tout au début" } }))];
        text.extend(std::iter::repeat_n(filler, 400));
        text.push(line(json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Terminé." }] }, "timestamp": "2026-10-07T10:05:00Z" })));
        std::fs::write(project.join("recent.jsonl"), text.join("\n") + "\n").unwrap();
        std::fs::write(project.join("agent-123.jsonl"), "{}").unwrap();

        let last = last_session(&dir.join("projects"), Path::new(r"C:\Projets\Island"), true).unwrap();
        assert_eq!((last.who, last.text.as_deref()), (Some("assistant"), Some("Terminé.")));
        assert_eq!(last.at, 1_791_367_500_000);
        // La dernière phrase plus loin que 256 Ko de la fin : la 2e lecture (2 Mo) la trouve.
        let filler = line(json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "y".repeat(1000) }] } }));
        let mut more = std::fs::OpenOptions::new().append(true).open(project.join("recent.jsonl")).unwrap();
        std::io::Write::write_all(&mut more, (vec![filler; 300].join("\n") + "\n").as_bytes()).unwrap();
        drop(more);
        let file = latest_transcript(&project).unwrap().0;
        assert_eq!(last_message(&file).map(|m| m.text).as_deref(), Some("Terminé."));
        // Sans lire le texte : on sait seulement qu'il y a une session.
        let quiet = last_session(&dir.join("projects"), Path::new(r"C:\Projets\Island"), false).unwrap();
        assert_eq!((quiet.text, quiet.who), (None, None));
        assert!(quiet.at > 0);
        // Un projet sans session : rien.
        assert!(last_session(&dir.join("projects"), Path::new(r"C:\Autre"), true).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
