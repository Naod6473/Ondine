// Agents IA : le compteur d'utilisation des agents (jetons), lu dans leurs
// journaux locaux, sur ce PC, quand l'onglet le demande.
//
// Claude Code : %USERPROFILE%\.claude\projects\<projet>\<session>.jsonl, et
// <session>\subagents\agent-*.jsonl pour ses sous-agents. Chaque réponse de
// Claude est une ligne {"type":"assistant","timestamp":…,"cwd":…,"message":
// {"id":…,"model":…,"usage":{"input_tokens":…,"output_tokens":…,
// "cache_read_input_tokens":…,"cache_creation_input_tokens":…}}}. Une même
// réponse est souvent écrite sur plusieurs lignes (un morceau à la fois), avec
// le même message.id et le même usage : on ne la compte qu'une fois.
//
// Codex : %USERPROFILE%\.codex\sessions\AAAA\MM\JJ\rollout-*.jsonl. Les lignes
// {"type":"event_msg","payload":{"type":"token_count","info":{
// "total_token_usage":{…},"last_token_usage":{…}}}} donnent le cumul de la
// session : on compte la différence avec le cumul précédent.
//
// Gemini CLI n'écrit pas de compte de jetons dans ses fichiers : pas compté.
//
// Rien ne sort du PC : seuls des nombres, le nom du modèle et le NOM du dossier
// du projet (jamais son chemin, jamais le moindre texte) vont à l'onglet. Un
// fichier déjà lu n'est relu que s'il a changé (date ou taille) ; une ligne
// abîmée est ignorée.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Au plus ce nombre de fichiers par lecture (au-delà : les plus récents).
const MAX_FILES: usize = 3000;
/// Au plus ce volume lu par passage (les fichiers déjà connus ne comptent pas).
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
/// Au plus ce temps par passage : au-delà, le compte est marqué partiel.
const MAX_MS: u128 = 8000;
/// Les projets montrés (les plus gros d'abord).
const MAX_PROJECTS: usize = 8;
const DAY_MS: i64 = 86_400_000;

/// Des jetons, et le nombre de réponses qu'ils représentent.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub messages: u64,
}

impl Tokens {
    fn add(&mut self, o: &Tokens) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.messages += o.messages;
    }
    fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
    fn is_zero(&self) -> bool {
        self.total() == 0
    }
    fn json(&self) -> Value {
        json!({ "input": self.input, "output": self.output, "cacheRead": self.cache_read, "cacheWrite": self.cache_write, "messages": self.messages })
    }
}

/// Ce qu'un fichier a donné, déjà regroupé par jour, modèle et projet.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Row {
    day: String,
    tool: &'static str,
    model: String,
    project: String,
    tokens: Tokens,
}

struct FileEntry {
    modified: SystemTime,
    len: u64,
    offset_min: i32,
    rows: Vec<Row>,
}

/// Ce qu'on a déjà lu, fichier par fichier (gardé tant que l'île tourne).
#[derive(Default)]
pub struct Cache {
    files: HashMap<PathBuf, FileEntry>,
}

impl Cache {
    #[cfg(test)]
    fn len(&self) -> usize {
        self.files.len()
    }
}

/// Le jour local « AAAA-MM-JJ » d'un instant. `offset_min` : celui de
/// JavaScript (`getTimezoneOffset`, +UTC − locale, 60 pour UTC−1).
pub fn day_key(ts_ms: u64, offset_min: i32) -> String {
    let local = ts_ms as i64 - offset_min as i64 * 60_000;
    match chrono::DateTime::<chrono::Utc>::from_timestamp_millis(local) {
        Some(d) => d.format("%Y-%m-%d").to_string(),
        None => "0000-00-00".into(),
    }
}

/// Le début (UTC, ms) du jour local qui contient `ts_ms`.
pub fn start_of_day(ts_ms: u64, offset_min: i32) -> u64 {
    let local = ts_ms as i64 - offset_min as i64 * 60_000;
    let start = local - local.rem_euclid(DAY_MS);
    (start + offset_min as i64 * 60_000).max(0) as u64
}

fn parse_ts(v: Option<&Value>) -> Option<u64> {
    let s = v?.as_str()?;
    let ms = chrono::DateTime::parse_from_rfc3339(s).ok()?.timestamp_millis();
    (ms >= 0).then_some(ms as u64)
}

/// Le nom du dossier d'un chemin (« C:\Projets\Island » → « Island »), sans rien d'autre.
fn folder_name(path: &str) -> String {
    let trimmed = path.trim_end_matches(['\\', '/']);
    let name = trimmed.rsplit(['\\', '/']).next().unwrap_or(trimmed);
    if name.is_empty() {
        "—".into()
    } else {
        name.chars().take(40).collect()
    }
}

fn num(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_u64).unwrap_or(0)
}

// ── Claude Code ──────────────────────────────────────────────────────────────

/// Une ligne de session de Claude Code : (date, modèle, dossier, jetons) si
/// c'est une réponse de Claude qu'on n'a pas encore comptée.
pub fn claude_line(line: &str, seen: &mut HashSet<String>) -> Option<(u64, String, String, Tokens)> {
    // Un tri rapide avant de lire le JSON : les lignes sans usage (vos
    // messages, les résultats d'outils, souvent très longs) ne nous intéressent pas.
    if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let id = msg.get("id").and_then(Value::as_str).unwrap_or("");
    if !id.is_empty() {
        let req = v.get("requestId").and_then(Value::as_str).unwrap_or("");
        if !seen.insert(format!("{id}/{req}")) {
            return None;
        }
    }
    let tokens = Tokens {
        input: num(usage.get("input_tokens")),
        output: num(usage.get("output_tokens")),
        cache_read: num(usage.get("cache_read_input_tokens")),
        cache_write: num(usage.get("cache_creation_input_tokens")),
        messages: 1,
    };
    if tokens.is_zero() {
        return None; // une réponse « synthétique » de Claude Code, sans appel au modèle
    }
    let ts = parse_ts(v.get("timestamp"))?;
    let model = msg.get("model").and_then(Value::as_str).unwrap_or("?").chars().take(60).collect();
    let project = folder_name(v.get("cwd").and_then(Value::as_str).unwrap_or(""));
    Some((ts, model, project, tokens))
}

// ── Codex ────────────────────────────────────────────────────────────────────

/// Ce qu'on retient d'une session Codex en la lisant.
#[derive(Default)]
pub struct CodexState {
    project: String,
    model: String,
    last_total: Option<Tokens>,
}

/// Le cumul d'une session Codex, dans notre forme : `input_tokens` y contient
/// les jetons lus en cache, on les sépare.
fn codex_tokens(v: &Value) -> Tokens {
    let cached = num(v.get("cached_input_tokens"));
    Tokens {
        input: num(v.get("input_tokens")).saturating_sub(cached),
        output: num(v.get("output_tokens")),
        cache_read: cached,
        cache_write: 0,
        messages: 0,
    }
}

/// Une ligne de session Codex : (date, modèle, dossier, jetons) à chaque
/// nouveau compte ; les autres lignes mettent à jour le dossier et le modèle.
pub fn codex_line(line: &str, st: &mut CodexState) -> Option<(u64, String, String, Tokens)> {
    if !line.contains("token_count") && !line.contains("session_meta") && !line.contains("turn_context") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let payload = v.get("payload")?;
    match v.get("type").and_then(Value::as_str) {
        Some("session_meta") | Some("turn_context") => {
            if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                st.project = folder_name(cwd);
            }
            if let Some(model) = payload.get("model").and_then(Value::as_str) {
                st.model = model.chars().take(60).collect();
            }
            None
        }
        Some("event_msg") if payload.get("type").and_then(Value::as_str) == Some("token_count") => {
            let info = payload.get("info")?;
            let total = codex_tokens(info.get("total_token_usage")?);
            let mut delta = match st.last_total {
                Some(prev) if total.input >= prev.input && total.output >= prev.output && total.cache_read >= prev.cache_read => Tokens {
                    input: total.input - prev.input,
                    output: total.output - prev.output,
                    cache_read: total.cache_read - prev.cache_read,
                    cache_write: 0,
                    messages: 0,
                },
                // Le cumul a baissé (session reprise, compactée) : on prend le dernier tour.
                Some(_) => info.get("last_token_usage").map(codex_tokens).unwrap_or_default(),
                None => total,
            };
            st.last_total = Some(total);
            if delta.is_zero() {
                return None; // le même compte répété
            }
            delta.messages = 1;
            let ts = parse_ts(v.get("timestamp"))?;
            let model = if st.model.is_empty() { "?".to_string() } else { st.model.clone() };
            let project = if st.project.is_empty() { "—".to_string() } else { st.project.clone() };
            Some((ts, model, project, delta))
        }
        _ => None,
    }
}

// ── Les fichiers ─────────────────────────────────────────────────────────────

struct Found {
    path: PathBuf,
    tool: &'static str,
    modified: SystemTime,
    len: u64,
}

/// Les fichiers d'un dossier (et de ses sous-dossiers, `depth` niveaux au
/// plus) dont le nom convient et modifiés depuis `since`.
fn walk(dir: &Path, depth: u8, tool: &'static str, since: SystemTime, keep: &dyn Fn(&str) -> bool, out: &mut Vec<Found>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.filter_map(Result::ok) {
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            if depth > 0 {
                walk(&e.path(), depth - 1, tool, since, keep, out);
            }
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if !meta.is_file() || !keep(&name) {
            continue;
        }
        let Ok(modified) = meta.modified() else { continue };
        if modified < since {
            continue;
        }
        out.push(Found { path: e.path(), tool, modified, len: meta.len() });
    }
}

/// Lit un fichier ligne à ligne et regroupe ce qu'il donne par jour, modèle et projet.
fn read_file(f: &Found, offset_min: i32) -> (Vec<Row>, u64) {
    let Ok(file) = std::fs::File::open(&f.path) else { return (Vec::new(), 0) };
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut line = String::new();
    let mut read = 0u64;
    let mut seen = HashSet::new();
    let mut codex = CodexState::default();
    let mut groups: HashMap<(String, String, String), Tokens> = HashMap::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(n) => read += n as u64,
        }
        let hit = match f.tool {
            "codex" => codex_line(&line, &mut codex),
            _ => claude_line(&line, &mut seen),
        };
        if let Some((ts, model, project, tokens)) = hit {
            groups.entry((day_key(ts, offset_min), model, project)).or_default().add(&tokens);
        }
    }
    let mut rows: Vec<Row> = groups
        .into_iter()
        .map(|((day, model, project), tokens)| Row { day, tool: f.tool, model, project, tokens })
        .collect();
    rows.sort_by(|a, b| (&a.day, &a.model, &a.project).cmp(&(&b.day, &b.model, &b.project)));
    (rows, read)
}

/// Le compte : `days` (par jour, outil et modèle), `projects` (sur la période,
/// les plus gros d'abord), et ce qui a été lu. `since_ms` : le début de la
/// période ; `offset_min` : le décalage horaire de JavaScript.
pub fn scan(cache: &mut Cache, claude_projects: &Path, codex_sessions: &Path, since_ms: u64, offset_min: i32) -> Value {
    let started = Instant::now();
    let since = UNIX_EPOCH + std::time::Duration::from_millis(since_ms);
    let since_day = day_key(since_ms, offset_min);

    let mut found = Vec::new();
    walk(claude_projects, 3, "claude-code", since, &|n| n.ends_with(".jsonl"), &mut found);
    walk(codex_sessions, 4, "codex", since, &|n| n.starts_with("rollout-") && n.ends_with(".jsonl"), &mut found);
    // Les plus récents d'abord : si on doit s'arrêter, ce sont les anciens qui manquent.
    found.sort_by_key(|f| std::cmp::Reverse(f.modified));
    let mut partial = found.len() > MAX_FILES;
    found.truncate(MAX_FILES);

    let mut bytes = 0u64;
    let mut listed: HashSet<PathBuf> = HashSet::new();
    let mut tools: HashSet<&'static str> = HashSet::new();
    let mut by_day: HashMap<(String, &'static str, String), Tokens> = HashMap::new();
    let mut by_project: HashMap<(String, &'static str), Tokens> = HashMap::new();
    for f in &found {
        listed.insert(f.path.clone());
        let fresh = match cache.files.get(&f.path) {
            Some(e) => e.modified == f.modified && e.len == f.len && e.offset_min == offset_min,
            None => false,
        };
        if !fresh {
            if bytes > MAX_BYTES || started.elapsed().as_millis() > MAX_MS {
                partial = true;
                continue;
            }
            let (rows, read) = read_file(f, offset_min);
            bytes += read;
            cache.files.insert(f.path.clone(), FileEntry { modified: f.modified, len: f.len, offset_min, rows });
        }
        let Some(entry) = cache.files.get(&f.path) else { continue };
        for r in &entry.rows {
            if r.day < since_day {
                continue;
            }
            tools.insert(r.tool);
            by_day.entry((r.day.clone(), r.tool, r.model.clone())).or_default().add(&r.tokens);
            by_project.entry((r.project.clone(), r.tool)).or_default().add(&r.tokens);
        }
    }
    // Les fichiers disparus (ou trop vieux pour la période) ne sont plus gardés.
    cache.files.retain(|p, _| listed.contains(p));

    let mut days: Vec<_> = by_day.into_iter().collect();
    days.sort_by(|a, b| a.0.cmp(&b.0));
    let mut projects: Vec<_> = by_project.into_iter().collect();
    projects.sort_by(|a, b| b.1.total().cmp(&a.1.total()).then_with(|| a.0.cmp(&b.0)));
    projects.truncate(MAX_PROJECTS);
    let mut tools: Vec<&str> = tools.into_iter().collect();
    tools.sort();

    json!({
        "days": days.into_iter().map(|((day, tool, model), t)| {
            let mut v = t.json();
            v["day"] = json!(day);
            v["tool"] = json!(tool);
            v["model"] = json!(model);
            v
        }).collect::<Vec<_>>(),
        "projects": projects.into_iter().map(|((name, tool), t)| {
            let mut v = t.json();
            v["name"] = json!(name);
            v["tool"] = json!(tool);
            v
        }).collect::<Vec<_>>(),
        "tools": tools,
        "files": found.len(),
        "partial": partial,
        "readBytes": bytes,
        "elapsedMs": started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude(id: &str, ts: &str, input: u64, output: u64) -> String {
        json!({
            "type": "assistant", "timestamp": ts, "cwd": "C:\\Projets\\Island", "requestId": "req_1",
            "message": { "id": id, "model": "claude-opus-5-5", "usage": { "input_tokens": input, "output_tokens": output, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 50 } }
        })
        .to_string()
    }

    #[test]
    fn a_claude_reply_is_counted_once_even_when_written_on_several_lines() {
        let mut seen = HashSet::new();
        let line = claude("msg_1", "2026-10-08T13:18:23.598Z", 2, 237);
        let (ts, model, project, t) = claude_line(&line, &mut seen).unwrap();
        assert_eq!(ts, 1_791_465_503_598);
        assert_eq!(model, "claude-opus-5-5");
        assert_eq!(project, "Island");
        assert_eq!(t, Tokens { input: 2, output: 237, cache_read: 1000, cache_write: 50, messages: 1 });
        assert!(claude_line(&line, &mut seen).is_none(), "la même réponse, deux fois");
        assert!(claude_line(&claude("msg_2", "2026-10-08T13:18:30Z", 1, 1), &mut seen).is_some());
    }

    #[test]
    fn other_lines_are_ignored() {
        let mut seen = HashSet::new();
        assert!(claude_line(r#"{"type":"user","message":{"content":"usage assistant"}}"#, &mut seen).is_none());
        assert!(claude_line("pas du json", &mut seen).is_none());
        // Une réponse « synthétique » (sans appel au modèle) : usage à zéro.
        let zero = json!({ "type": "assistant", "timestamp": "2026-10-08T13:18:23Z", "message": { "id": "s", "model": "<synthetic>", "usage": { "input_tokens": 0, "output_tokens": 0 } } }).to_string();
        assert!(claude_line(&zero, &mut seen).is_none());
    }

    fn codex_count(ts: &str, input: u64, cached: u64, output: u64) -> String {
        json!({ "timestamp": ts, "type": "event_msg", "payload": { "type": "token_count", "info": {
            "total_token_usage": { "input_tokens": input, "cached_input_tokens": cached, "output_tokens": output, "reasoning_output_tokens": 0, "total_tokens": input + output },
            "last_token_usage": { "input_tokens": 100, "cached_input_tokens": 0, "output_tokens": 10, "reasoning_output_tokens": 0, "total_tokens": 110 }
        } } })
        .to_string()
    }

    #[test]
    fn codex_counts_the_difference_between_two_totals() {
        let mut st = CodexState::default();
        let meta = json!({ "timestamp": "2026-10-08T10:00:00Z", "type": "session_meta", "payload": { "id": "x", "cwd": "/home/simon/site" } }).to_string();
        assert!(codex_line(&meta, &mut st).is_none());
        let ctx = json!({ "timestamp": "2026-10-08T10:00:01Z", "type": "turn_context", "payload": { "cwd": "/home/simon/site", "model": "gpt-5-codex" } }).to_string();
        assert!(codex_line(&ctx, &mut st).is_none());
        let (_, model, project, first) = codex_line(&codex_count("2026-10-08T10:00:05Z", 1000, 400, 50), &mut st).unwrap();
        assert_eq!((model.as_str(), project.as_str()), ("gpt-5-codex", "site"));
        assert_eq!(first, Tokens { input: 600, output: 50, cache_read: 400, cache_write: 0, messages: 1 });
        // Le même compte répété : rien de plus.
        assert!(codex_line(&codex_count("2026-10-08T10:00:06Z", 1000, 400, 50), &mut st).is_none());
        let (_, _, _, second) = codex_line(&codex_count("2026-10-08T10:01:00Z", 1600, 900, 80), &mut st).unwrap();
        assert_eq!(second, Tokens { input: 100, output: 30, cache_read: 500, cache_write: 0, messages: 1 });
        // Le cumul retombe (session reprise) : on prend le dernier tour.
        let (_, _, _, third) = codex_line(&codex_count("2026-10-08T11:00:00Z", 300, 0, 20), &mut st).unwrap();
        assert_eq!(third, Tokens { input: 100, output: 10, cache_read: 0, cache_write: 0, messages: 1 });
    }

    #[test]
    fn days_follow_the_local_clock() {
        let ts = 1_791_465_503_598; // 2026-10-08 13:18 UTC
        assert_eq!(day_key(ts, 0), "2026-10-08");
        assert_eq!(day_key(ts, -120), "2026-10-08"); // Paris, heure d'été
        assert_eq!(day_key(ts, 660), "2026-10-08"); // UTC−11 : encore le 8 à 2 h
        assert_eq!(day_key(ts, 840), "2026-10-07"); // UTC−14 : la veille, 23 h
        let start = start_of_day(ts, -120);
        assert_eq!(day_key(start, -120), "2026-10-08");
        assert_eq!(start % 3_600_000, 0);
        assert!(start <= ts && ts - start < DAY_MS as u64);
    }

    #[test]
    fn folder_names_only() {
        assert_eq!(folder_name(r"C:\Projets\Island"), "Island");
        assert_eq!(folder_name("/home/simon/site/"), "site");
        assert_eq!(folder_name(""), "—");
    }

    #[test]
    fn scan_reads_files_once_and_groups_them() {
        let root = std::env::temp_dir().join(format!("ondine-usage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let claude_dir = root.join("projects").join("C--Projets-Island");
        let sub = claude_dir.join("s1").join("subagents");
        let codex = root.join("sessions").join("2026").join("10").join("08");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::write(claude_dir.join("s1.jsonl"), [claude("a", "2026-10-08T09:00:00Z", 10, 20), claude("a", "2026-10-08T09:00:00Z", 10, 20), claude("b", "2026-10-07T09:00:00Z", 5, 5)].join("\n")).unwrap();
        std::fs::write(sub.join("agent-x.jsonl"), claude("c", "2026-10-08T09:30:00Z", 1, 2)).unwrap();
        std::fs::write(codex.join("rollout-2026-10-08T10-00-00-x.jsonl"), [
            json!({ "timestamp": "2026-10-08T10:00:00Z", "type": "session_meta", "payload": { "cwd": "D:\\Site", "model": "gpt-5-codex" } }).to_string(),
            codex_count("2026-10-08T10:00:05Z", 1000, 400, 50),
        ].join("\n")).unwrap();
        std::fs::write(codex.join("notes.txt"), "rien").unwrap();

        let mut cache = Cache::default();
        let since = start_of_day(1_791_400_000_000 - 2 * DAY_MS as u64, 0); // trois jours
        let v = scan(&mut cache, &root.join("projects"), &root.join("sessions"), since, 0);
        assert_eq!(v["files"], 3);
        assert_eq!(v["partial"], false);
        assert_eq!(v["tools"], json!(["claude-code", "codex"]));
        let days = v["days"].as_array().unwrap();
        assert_eq!(days.len(), 3, "{days:?}");
        assert_eq!(days[0]["day"], "2026-10-07");
        assert_eq!(days[0]["output"], 5);
        let today: Vec<_> = days.iter().filter(|d| d["day"] == "2026-10-08").collect();
        let claude_today = today.iter().find(|d| d["tool"] == "claude-code").unwrap();
        assert_eq!(claude_today["input"], 11); // 10 (une fois) + 1 (sous-agent)
        assert_eq!(claude_today["messages"], 2);
        assert_eq!(claude_today["model"], "claude-opus-5-5");
        let codex_today = today.iter().find(|d| d["tool"] == "codex").unwrap();
        assert_eq!(codex_today["cacheRead"], 400);
        let projects = v["projects"].as_array().unwrap();
        assert_eq!(projects[0]["name"], "Island");
        assert_eq!(projects[1]["name"], "Site");
        assert!(v["readBytes"].as_u64().unwrap() > 0);

        // Deuxième passage : rien n'est relu, le résultat est le même.
        let again = scan(&mut cache, &root.join("projects"), &root.join("sessions"), since, 0);
        assert_eq!(again["readBytes"], 0);
        assert_eq!(again["days"], v["days"]);
        assert_eq!(cache.len(), 3);

        // Une période qui commence aujourd'hui : hier disparaît.
        let today_only = scan(&mut cache, &root.join("projects"), &root.join("sessions"), start_of_day(1_791_460_000_000, 0), 0);
        assert!(today_only["days"].as_array().unwrap().iter().all(|d| d["day"] == "2026-10-08"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
