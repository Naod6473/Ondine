// Les limites du forfait (onglet Agents IA, 1.2.4) : la fenêtre de 5 h et la
// semaine de Claude (Pro, Max) et de Codex, en % utilisé, avec l'heure de la
// remise à zéro. Technique reprise de coucou (MIT), réécrite.
//
// Claude : Claude Code donne à sa « ligne d'état » (réglage `statusLine` de
// ~/.claude/settings.json) un JSON sur l'entrée standard, avec `rate_limits`
// { five_hour: { used_percentage, resets_at }, seven_day: { … } } (forfaits
// Pro et Max ; rien avec une clé API). Sur votre clic, Ondine met
// « ondine.exe statusline » comme ligne d'état : ce petit programme passe
// SEULEMENT ces chiffres à l'île par le canal local, puis lance la ligne
// d'état que vous aviez avant (gardée dans %APPDATA%\Ondine\
// statusline-previous.json), avec la même entrée, et recopie ce qu'elle
// affiche : elle continue de marcher. Installation sûre : fusion (tout le
// reste du fichier gardé), copie .bak datée, fichier invalide jamais réécrit.
//
// Codex : ses journaux de session (~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl,
// déjà lus par le compteur de jetons) notent `rate_limits` { primary,
// secondary : { used_percent, window_minutes, resets_at | resets_in_seconds } }
// à chaque compte de jetons. On lit la fin du plus récent : rien ne part.
// Sur un clic (« Demander à Codex »), `codex app-server` répond à
// `account/rateLimits/read` (la source de son /status) : c'est Codex, avec sa
// propre connexion, qui interroge OpenAI ; Ondine ne lit aucun identifiant.
//
// Aucun appel réseau d'Ondine elle-même ; rien n'est écrit dans le journal à
// part « limites du forfait : lues ».

use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};

/// Une fenêtre de limite : % utilisé (0 à 100) et remise à zéro (ms).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub pct: f64,
    pub resets_at: u64,
}

/// Les limites lues : la fenêtre courte (5 h) et la semaine.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Limits {
    pub five_hour: Option<Window>,
    pub week: Option<Window>,
    /// Codex : le nom du forfait (« plus », « pro »), s'il est donné.
    pub plan: Option<String>,
    /// Quand ces chiffres ont été lus (ms).
    pub updated_at: u64,
}

impl Limits {
    pub fn is_empty(&self) -> bool {
        self.five_hour.is_none() && self.week.is_none()
    }

    pub fn json(&self) -> Value {
        let w = |w: &Option<Window>| w.map(|w| json!({ "pct": w.pct, "resetsAt": w.resets_at }));
        json!({ "fiveHour": w(&self.five_hour), "week": w(&self.week), "plan": self.plan, "updatedAt": self.updated_at })
    }
}

const DAY_MS: u64 = 86_400_000;

fn num(v: &Value) -> Option<f64> {
    v.as_f64().filter(|n| n.is_finite())
}

/// Un pourcentage plausible (100 à 200 : forfait dépassé, montré plein).
fn pct(v: &Value) -> Option<f64> {
    num(v).filter(|p| (0.0..=200.0).contains(p)).map(|p| p.min(100.0))
}

/// Une date de remise à zéro en secondes → ms, si elle est plausible
/// (pas plus de 400 jours dans le futur : sinon ce sont déjà des ms).
fn reset_secs(v: &Value, now: u64) -> Option<u64> {
    let s = num(v).filter(|s| *s > 0.0)?;
    let ms = (s * 1000.0) as u64;
    (ms <= now + 400 * DAY_MS).then_some(ms)
}

// ── Claude ───────────────────────────────────────────────────────────────────

/// `rate_limits` de la ligne d'état de Claude Code → les limites (None : ni
/// fenêtre de 5 h ni semaine, par exemple avec une clé API).
pub fn claude_limits(rate_limits: &Value, now: u64) -> Option<Limits> {
    let win = |w: &Value| Some(Window { pct: pct(&w["used_percentage"])?, resets_at: reset_secs(&w["resets_at"], now)? });
    let limits = Limits { five_hour: win(&rate_limits["five_hour"]), week: win(&rate_limits["seven_day"]), plan: None, updated_at: now };
    (!limits.is_empty()).then_some(limits)
}

/// Le message que « ondine.exe statusline » envoie à l'île : seulement les
/// chiffres (pas le dossier, le modèle, la transcription…). None : rien à envoyer.
pub fn statusline_message(input: &Value) -> Option<Value> {
    let rl = input.get("rate_limits").filter(|v| v.is_object())?;
    let keep = |w: &Value| {
        let (p, r) = (num(&w["used_percentage"])?, num(&w["resets_at"])?);
        Some(json!({ "used_percentage": p, "resets_at": r }))
    };
    let (five, week) = (keep(&rl["five_hour"]), keep(&rl["seven_day"]));
    if five.is_none() && week.is_none() {
        return None;
    }
    Some(json!({ "v": 1, "source": "plan", "tool": "claude-code", "rate_limits": { "five_hour": five, "seven_day": week } }))
}

// ── Codex ────────────────────────────────────────────────────────────────────

/// Une fenêtre de Codex (journal : `used_percent`, `resets_at` en secondes
/// ou `resets_in_seconds` depuis l'heure de la ligne) et sa durée en minutes.
fn codex_window(w: &Value, line_ms: u64, now: u64) -> Option<(Window, Option<u64>)> {
    let p = pct(w.get("used_percent").or_else(|| w.get("usedPercent"))?)?;
    let at = match w.get("resets_at").or_else(|| w.get("resetsAt")) {
        Some(v) if !v.is_null() => reset_secs(v, now)?,
        _ => line_ms + (num(&w["resets_in_seconds"])?.max(0.0) * 1000.0) as u64,
    };
    let minutes = w.get("window_minutes").or_else(|| w.get("windowDurationMins")).and_then(Value::as_u64);
    Some((Window { pct: p, resets_at: at }, minutes))
}

/// `primary` et `secondary` ne disent pas laquelle est la semaine : on range
/// par durée (un jour ou moins : la fenêtre courte) ; sans durée, primary =
/// fenêtre courte, secondary = semaine.
fn codex_limits(rl: &Value, line_ms: u64, now: u64) -> Option<Limits> {
    let mut out = Limits { updated_at: line_ms.min(now), ..Limits::default() };
    for (key, short_default) in [("primary", true), ("secondary", false)] {
        let Some((w, minutes)) = rl.get(key).and_then(|w| codex_window(w, line_ms, now)) else { continue };
        let short = minutes.map(|m| m <= 24 * 60).unwrap_or(short_default);
        if short { out.five_hour = Some(w) } else { out.week = Some(w) }
    }
    out.plan = rl.get("planType").or_else(|| rl.get("plan_type")).and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| s.chars().take(20).collect());
    (!out.is_empty()).then_some(out)
}

/// Une ligne d'un journal de Codex → ses limites, si c'est un compte de
/// jetons qui en porte.
pub fn codex_line(line: &str, now: u64) -> Option<Limits> {
    if !line.contains("rate_limits") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let payload = &v["payload"];
    if payload["type"] != "token_count" {
        return None;
    }
    let line_ms = v["timestamp"].as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp_millis().max(0) as u64).unwrap_or(now);
    codex_limits(payload.get("rate_limits").filter(|r| r.is_object())?, line_ms, now)
}

/// La réponse de `codex app-server` à `account/rateLimits/read`.
pub fn codex_app_answer(result: &Value, now: u64) -> Option<Limits> {
    codex_limits(result.get("rateLimits").filter(|r| r.is_object())?, now, now)
}

/// Les journaux de Codex des 8 derniers jours, les plus récents d'abord.
fn recent_rollouts(sessions: &Path) -> Vec<(SystemTime, PathBuf)> {
    let since = SystemTime::now() - Duration::from_secs(8 * 86_400);
    let mut out = Vec::new();
    // AAAA/MM/JJ/rollout-*.jsonl : trois niveaux, on ne descend pas plus.
    let dirs = |p: &Path| -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(p).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).collect();
        v.sort();
        v.reverse();
        v.truncate(3); // les plus récents (noms numériques)
        v
    };
    for year in dirs(sessions) {
        for month in dirs(&year) {
            for day in std::fs::read_dir(&month).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())) {
                for f in std::fs::read_dir(day.path()).into_iter().flatten().flatten() {
                    let name = f.file_name().to_string_lossy().to_string();
                    if !(name.starts_with("rollout-") && name.ends_with(".jsonl")) {
                        continue;
                    }
                    let Ok(meta) = f.metadata() else { continue };
                    let Ok(modified) = meta.modified() else { continue };
                    if meta.is_file() && modified >= since {
                        out.push((modified, f.path()));
                    }
                }
            }
        }
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    out
}

/// La fin d'un fichier (au plus `max` octets), en lignes entières.
fn tail_lines(path: &Path, max: u64) -> Vec<String> {
    let Ok(mut f) = std::fs::File::open(path) else { return vec![] };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(max);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return vec![];
    }
    let mut lines: Vec<String> = std::io::BufReader::new(f.take(max)).lines().map_while(Result::ok).collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0); // la première ligne est coupée
    }
    lines
}

/// Ce que l'on a déjà lu des journaux de Codex (relus seulement s'ils changent).
#[derive(Default)]
pub struct CodexCache {
    key: Option<(PathBuf, SystemTime, u64)>,
    found: Option<Limits>,
}

/// Les limites les plus récentes notées par Codex sur ce PC (4 journaux au plus).
pub fn latest_codex(cache: &mut CodexCache, sessions: &Path, now: u64) -> Option<Limits> {
    let files = recent_rollouts(sessions);
    let first = files.first()?;
    let len = std::fs::metadata(&first.1).map(|m| m.len()).unwrap_or(0);
    let key = (first.1.clone(), first.0, len);
    if cache.key.as_ref() == Some(&key) {
        return cache.found.clone();
    }
    let found = files.iter().take(4).find_map(|(_, path)| tail_lines(path, 512 * 1024).iter().rev().find_map(|l| codex_line(l, now)));
    cache.key = Some(key);
    cache.found = found.clone();
    found
}

/// « Demander à Codex » : lance `codex app-server` (par son chemin complet),
/// lui pose `account/rateLimits/read`, 15 s au plus, puis l'arrête. C'est
/// Codex qui interroge OpenAI avec sa propre connexion.
pub fn ask_codex(exe: &Path) -> Result<Limits, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    const REQUESTS: &str = concat!(
        r#"{"id":1,"method":"initialize","params":{"clientInfo":{"name":"ondine","version":"1"}}}"#,
        "\n",
        r#"{"method":"initialized"}"#,
        "\n",
        r#"{"id":2,"method":"account/rateLimits/read"}"#,
        "\n",
    );
    let mut cmd = Command::new(exe);
    cmd.arg("app-server").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    // Une installation npm (codex.cmd) trouve son Node à côté d'elle.
    if let Some(dir) = exe.parent() {
        let mut dirs = vec![dir.to_path_buf()];
        if let Some(path) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&path));
        }
        if let Ok(joined) = std::env::join_paths(dirs) {
            cmd.env("PATH", joined);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // pas de console
    }
    let mut child = cmd.spawn().map_err(|e| format!("Codex ne se lance pas : {e}"))?;
    let answer = (|| {
        let mut stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(first_answer(std::io::BufReader::new(stdout)));
        });
        stdin.write_all(REQUESTS.as_bytes()).ok()?;
        stdin.flush().ok()?;
        let answer = rx.recv_timeout(Duration::from_secs(15)).ok().flatten();
        drop(stdin);
        answer
    })();
    // codex.cmd lance node : on arrête tout l'arbre.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let system = std::env::var("SystemRoot").map(|r| PathBuf::from(r).join("System32").join("taskkill.exe")).unwrap_or_else(|_| PathBuf::from("taskkill.exe"));
        let _ = Command::new(system).args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).status();
    }
    let _ = child.kill();
    let _ = child.wait();
    let result = answer.ok_or("Codex n'a pas répondu (pas connecté, ou trop long)")?;
    codex_app_answer(&result, now_ms()).ok_or_else(|| "Codex n'a pas donné de limites (forfait sans limites, ou connexion par clé API)".into())
}

/// Lit les lignes JSON-RPC jusqu'à la réponse n° 2 et rend son `result`.
/// Abandonne sur une ligne ou un flot bien trop longs.
pub fn first_answer(reader: impl BufRead) -> Option<Value> {
    const MAX_LINE: u64 = 256 * 1024;
    const MAX_TOTAL: usize = 2 * 1024 * 1024;
    let mut reader = reader;
    let mut total = 0usize;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = (&mut reader).take(MAX_LINE + 1).read_until(b'\n', &mut line).ok()?;
        if n == 0 {
            return None;
        }
        total += n;
        if total > MAX_TOTAL || line.len() as u64 > MAX_LINE {
            return None;
        }
        let Ok(message) = serde_json::from_slice::<Value>(&line) else { continue };
        if message.get("id").and_then(Value::as_i64) == Some(2) {
            return message.get("result").filter(|r| r.is_object()).cloned();
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ── La ligne d'état de Claude Code (settings.json → statusLine) ──────────────

/// La commande écrite dans `statusLine.command`. Claude Code la lance par Git
/// Bash sous Windows : chemin entre guillemets, avec des « / » (Bash lirait
/// les « \ » comme des échappements).
pub fn statusline_command(exe: &str) -> String {
    format!("\"{}\" statusline", exe.replace('\\', "/"))
}

/// Cette ligne d'état est-elle celle d'Ondine ? Et vers quel programme ?
fn ours(v: &Value) -> Option<String> {
    let c = v.get("command")?.as_str()?.trim();
    let lower = c.to_lowercase();
    if !lower.ends_with(" statusline") {
        return None;
    }
    let program = c[..c.len() - " statusline".len()].trim().trim_matches('"').to_string();
    program.replace('/', "\\").to_lowercase().ends_with("ondine.exe").then_some(program)
}

fn parse_settings(existing: Option<&str>) -> Result<Value, String> {
    let text = existing.unwrap_or("").trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    let v: Value = serde_json::from_str(text).map_err(|e| format!("JSON invalide ({e}) : fichier laissé tel quel"))?;
    if !v.is_object() {
        return Err("le fichier ne contient pas un objet de réglages : laissé tel quel".into());
    }
    Ok(v)
}

/// « installed » (celle d'Ondine, ce programme), « stale » (un autre
/// ondine.exe), « other » (une ligne d'état à vous), « absent », « unreadable ».
pub fn statusline_state(existing: Option<&str>, exe: &str) -> &'static str {
    let Ok(root) = parse_settings(existing) else { return "unreadable" };
    match root.get("statusLine") {
        None | Some(Value::Null) => "absent",
        Some(v) => match ours(v) {
            Some(p) if crate::platform::same_exe_path(&p, exe) => "installed",
            Some(_) => "stale",
            None => "other",
        },
    }
}

/// Le fichier après installation, et la ligne d'état qu'il avait (à garder
/// pour la relancer et la remettre au retrait). On ne change QUE `command`
/// (et `type` s'il manque) : `padding` et le reste restent.
pub fn statusline_install(existing: Option<&str>, exe: &str) -> Result<(String, Option<Value>), String> {
    let mut root = parse_settings(existing)?;
    let obj = root.as_object_mut().ok_or("format inattendu")?;
    let current = obj.get("statusLine").cloned().filter(|v| !v.is_null());
    if current.as_ref().is_some_and(|v| !v.is_object()) {
        return Err("« statusLine » n'a pas la forme attendue : laissé tel quel".into());
    }
    let previous = current.clone().filter(|v| ours(v).is_none());
    let mut line = current.unwrap_or_else(|| json!({}));
    let l = line.as_object_mut().ok_or("format inattendu")?;
    l.entry("type").or_insert_with(|| json!("command"));
    l.insert("command".into(), json!(statusline_command(exe)));
    obj.insert("statusLine".into(), line);
    Ok((pretty(&root), previous))
}

/// Le fichier après retrait : la ligne d'état d'avant revient (ou la clé
/// part). None : la ligne d'état n'est pas (plus) celle d'Ondine, rien à faire.
pub fn statusline_remove(existing: Option<&str>, previous: Option<Value>) -> Result<Option<String>, String> {
    let mut root = parse_settings(existing)?;
    let obj = root.as_object_mut().ok_or("format inattendu")?;
    if !obj.get("statusLine").is_some_and(|v| ours(v).is_some()) {
        return Ok(None);
    }
    match previous.filter(Value::is_object) {
        Some(p) => obj.insert("statusLine".into(), p),
        None => obj.shift_remove("statusLine"),
    };
    Ok(Some(pretty(&root)))
}

fn pretty(v: &Value) -> String {
    let mut text = serde_json::to_string_pretty(v).unwrap_or_default();
    text.push('\n');
    text
}

/// Où la ligne d'état d'avant attend (à côté des réglages d'Ondine).
pub fn previous_file() -> PathBuf {
    crate::platform::config_dir().join("statusline-previous.json")
}

pub fn read_previous() -> Option<Value> {
    let bytes = std::fs::read(previous_file()).ok()?;
    serde_json::from_slice::<Value>(&bytes).ok().filter(Value::is_object)
}

// ── « ondine.exe statusline » : relancer la ligne d'état d'avant ─────────────

/// Le temps laissé à votre ligne d'état (ensuite elle est arrêtée).
pub const PREVIOUS_BUDGET: Duration = Duration::from_secs(10);
/// Ce que l'on garde de ce qu'elle affiche.
const MAX_OUTPUT: usize = 64 * 1024;

/// Où peut être Git Bash (Claude Code y lance les lignes d'état sous
/// Windows), le meilleur d'abord, en gardant ceux qu'accepte `exists` : la
/// variable de Claude Code (`CLAUDE_CODE_GIT_BASH_PATH`), le Git du `git.exe`
/// du PATH, les dossiers d'installation habituels, puis un `bash.exe` du PATH
/// (jamais celui de WSL dans System32 ou WindowsApps).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn git_bash_candidates(var: impl Fn(&str) -> Option<std::ffi::OsString>, exists: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(p) = var("CLAUDE_CODE_GIT_BASH_PATH").filter(|p| !p.is_empty()) {
        out.push(PathBuf::from(p));
    }
    let path_dirs: Vec<PathBuf> = var("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for dir in path_dirs.iter().filter(|d| exists(&d.join("git.exe"))) {
        if let Some(root) = dir.parent() {
            out.push(root.join("bin").join("bash.exe"));
            if let Some(up) = root.parent() {
                out.push(up.join("bin").join("bash.exe"));
            }
        }
    }
    for base in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = var(base).filter(|p| !p.is_empty()) {
            out.push(PathBuf::from(dir).join("Git").join("bin").join("bash.exe"));
        }
    }
    if let Some(dir) = var("LOCALAPPDATA").filter(|p| !p.is_empty()) {
        out.push(PathBuf::from(dir).join("Programs").join("Git").join("bin").join("bash.exe"));
    }
    for dir in &path_dirs {
        let windows_own = dir.components().any(|c| {
            let c = c.as_os_str().to_string_lossy();
            c.eq_ignore_ascii_case("system32") || c.eq_ignore_ascii_case("windowsapps")
        });
        if !windows_own {
            out.push(dir.join("bash.exe"));
        }
    }
    let mut seen = Vec::new();
    out.retain(|p| {
        let fresh = !seen.contains(p) && exists(p);
        seen.push(p.clone());
        fresh
    });
    out
}

/// Lance votre ligne d'état d'avant (par Git Bash sous Windows, `sh` ailleurs)
/// avec la même entrée, et rend ce qu'elle a affiché (64 Ko au plus). Rien si
/// elle ne démarre pas ou dépasse `budget` (elle est alors arrêtée).
pub fn run_previous(command: &str, input: &[u8], budget: Duration) -> Option<Vec<u8>> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::time::Instant;
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let bash = git_bash_candidates(|k| std::env::var_os(k), |p| p.is_file()).into_iter().next()?;
        let mut c = Command::new(bash);
        c.args(["-c", command]).creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", command]);
        c
    };
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let data = input.to_vec();
    std::thread::spawn(move || {
        let _ = stdin.write_all(&data);
    });
    let mut stdout = child.stdout.take()?;
    let kept = Arc::new(Mutex::new(Vec::new()));
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
    {
        let kept = Arc::clone(&kept);
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            while let Ok(n) = stdout.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                let mut buf = kept.lock().unwrap_or_else(|e| e.into_inner());
                let room = MAX_OUTPUT.saturating_sub(buf.len());
                buf.extend_from_slice(&chunk[..n.min(room)]);
            }
            let _ = done_tx.send(());
        });
    }
    let deadline = Instant::now() + budget;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let _ = done_rx.recv_timeout(Duration::from_millis(200));
    let out = std::mem::take(&mut *kept.lock().unwrap_or_else(|e| e.into_inner()));
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_900_000_000_000;

    #[test]
    fn claude_limits_from_the_status_line() {
        let rl = json!({ "five_hour": { "used_percentage": 42.5, "resets_at": 1_900_003_600 }, "seven_day": { "used_percentage": 130, "resets_at": 1_900_300_000 } });
        let l = claude_limits(&rl, NOW).unwrap();
        assert_eq!(l.five_hour, Some(Window { pct: 42.5, resets_at: 1_900_003_600_000 }));
        assert_eq!(l.week.unwrap().pct, 100.0); // forfait dépassé : plein
        // Pas un pourcentage, ou une date déjà en ms : ignorés.
        assert!(claude_limits(&json!({ "five_hour": { "used_percentage": 900, "resets_at": 1 } }), NOW).is_none());
        assert!(claude_limits(&json!({ "five_hour": { "used_percentage": 5, "resets_at": 1_900_003_600_000u64 } }), NOW).is_none());
        assert!(claude_limits(&json!({}), NOW).is_none());
    }

    #[test]
    fn only_the_numbers_go_to_the_island() {
        let input = json!({ "session_id": "s", "cwd": "C:\\secret", "transcript_path": "x.jsonl", "model": { "id": "m" },
            "rate_limits": { "five_hour": { "used_percentage": 12, "resets_at": 1_900_003_600, "extra": "x" } } });
        let m = statusline_message(&input).unwrap();
        assert_eq!(m["source"], "plan");
        assert_eq!(m["rate_limits"]["five_hour"], json!({ "used_percentage": 12.0, "resets_at": 1_900_003_600.0 }));
        assert!(m.get("cwd").is_none() && m.get("session_id").is_none());
        assert!(!m.to_string().contains("secret"));
        assert!(statusline_message(&json!({ "session_id": "s" })).is_none());
        assert!(statusline_message(&json!({ "rate_limits": { "five_hour": { "used_percentage": "x" } } })).is_none());
    }

    #[test]
    fn codex_limits_from_its_logs() {
        let line = json!({ "timestamp": "2030-03-17T17:46:40Z", "type": "event_msg", "payload": { "type": "token_count", "info": null,
            "rate_limits": { "primary": { "used_percent": 20.0, "window_minutes": 10080, "resets_in_seconds": 3600 },
                             "secondary": { "used_percent": 75.0, "window_minutes": 300, "resets_at": 1_900_001_000 } } } }).to_string();
        let l = codex_line(&line, NOW).unwrap();
        // Rangées par durée : 300 min = la fenêtre courte, 10080 = la semaine.
        assert_eq!(l.five_hour, Some(Window { pct: 75.0, resets_at: 1_900_001_000_000 }));
        let line_ms = chrono::DateTime::parse_from_rfc3339("2030-03-17T17:46:40Z").unwrap().timestamp_millis() as u64;
        assert_eq!(l.week, Some(Window { pct: 20.0, resets_at: line_ms + 3_600_000 }));
        assert!(codex_line(r#"{"payload":{"type":"agent_message","rate_limits":{}}}"#, NOW).is_none());
        assert!(codex_line("pas du json rate_limits", NOW).is_none());
    }

    #[test]
    fn codex_app_server_answer() {
        let r = json!({ "rateLimits": { "planType": "plus", "primary": { "usedPercent": 12.5, "resetsAt": 1_900_000_500, "windowDurationMins": 300 }, "secondary": { "usedPercent": 3, "resetsAt": 1_900_400_000 } } });
        let l = codex_app_answer(&r, NOW).unwrap();
        assert_eq!((l.five_hour.unwrap().pct, l.week.unwrap().pct, l.plan.as_deref()), (12.5, 3.0, Some("plus")));
        let stream = concat!(r#"{"id":1,"result":{}}"#, "\n", "bruit\n", r#"{"id":2,"result":{"rateLimits":{}}}"#, "\n");
        assert!(first_answer(stream.as_bytes()).unwrap()["rateLimits"].is_object());
        assert!(first_answer(r#"{"id":2,"error":{"message":"x"}}"#.as_bytes()).is_none());
    }

    #[test]
    fn latest_codex_reads_the_newest_log_once() {
        let root = std::env::temp_dir().join(format!("ondine-plan-{}", std::process::id()));
        let day = root.join("2030").join("03").join("17");
        std::fs::create_dir_all(&day).unwrap();
        let line = json!({ "timestamp": "2030-03-17T17:46:40Z", "type": "event_msg", "payload": { "type": "token_count", "rate_limits": { "primary": { "used_percent": 33.0, "resets_at": 1_900_001_000 } } } }).to_string();
        std::fs::write(day.join("rollout-a.jsonl"), format!("{{\"type\":\"session_meta\"}}\n{line}\n{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"agent_message\"}}}}\n")).unwrap();
        let mut cache = CodexCache::default();
        assert_eq!(latest_codex(&mut cache, &root, NOW).unwrap().five_hour.unwrap().pct, 33.0);
        assert_eq!(latest_codex(&mut cache, &root, NOW).unwrap().five_hour.unwrap().pct, 33.0);
        std::fs::remove_dir_all(&root).unwrap();
        assert!(latest_codex(&mut CodexCache::default(), &root, NOW).is_none());
    }

    #[test]
    fn status_line_install_and_remove_keep_the_rest() {
        let exe = r"C:\Program Files\Ondine\ondine.exe";
        assert_eq!(statusline_command(exe), "\"C:/Program Files/Ondine/ondine.exe\" statusline");
        // Rien avant : la clé arrive, le reste du fichier reste.
        let (text, prev) = statusline_install(Some(r#"{"model":"opus","hooks":{"Stop":[]}}"#), exe).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["model"], "opus");
        assert_eq!(v["statusLine"]["type"], "command");
        assert!(prev.is_none());
        assert_eq!(statusline_state(Some(&text), exe), "installed");
        assert_eq!(statusline_state(Some(&text), r"D:\autre\ondine.exe"), "stale");
        // Retrait : la clé part.
        let back: Value = serde_json::from_str(&statusline_remove(Some(&text), None).unwrap().unwrap()).unwrap();
        assert!(back.get("statusLine").is_none() && back["model"] == "opus");
        // Une ligne d'état à vous : gardée de côté, son padding reste, et elle revient au retrait.
        let mine = r#"{"statusLine":{"type":"command","command":"~/bin/line.sh","padding":2}}"#;
        assert_eq!(statusline_state(Some(mine), exe), "other");
        let (text, prev) = statusline_install(Some(mine), exe).unwrap();
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!((v["statusLine"]["padding"].as_u64(), prev.as_ref().unwrap()["command"].as_str()), (Some(2), Some("~/bin/line.sh")));
        let back: Value = serde_json::from_str(&statusline_remove(Some(&text), prev).unwrap().unwrap()).unwrap();
        assert_eq!(back["statusLine"]["command"], "~/bin/line.sh");
        // Réinstaller par-dessus la nôtre ne garde pas la nôtre comme « d'avant ».
        let (_, again) = statusline_install(Some(&text), exe).unwrap();
        assert!(again.is_none());
        // Pas la nôtre : rien à retirer. Fichier invalide : jamais réécrit.
        assert!(statusline_remove(Some(mine), None).unwrap().is_none());
        assert!(statusline_install(Some("{ pas du json"), exe).is_err());
        assert_eq!(statusline_state(Some("{ pas du json"), exe), "unreadable");
        assert!(statusline_install(Some(r#"{"statusLine":"texte"}"#), exe).is_err());
        assert_eq!(statusline_state(None, exe), "absent");
    }

    #[test]
    fn git_bash_is_found_like_claude_code_does() {
        let files = ["/override/bash.exe", "/git/cmd/git.exe", "/git/bin/bash.exe", "/pf/Git/bin/bash.exe", "/wsl/System32/bash.exe"];
        let exists = |p: &Path| files.iter().any(|f| Path::new(f) == p);
        let path = std::env::join_paths(["/wsl/System32", "/git/cmd"].iter().map(PathBuf::from)).unwrap();
        let env = move |k: &str| match k {
            "CLAUDE_CODE_GIT_BASH_PATH" => Some("/override/bash.exe".into()),
            "PATH" => Some(path.clone()),
            "ProgramFiles" => Some("/pf".into()),
            _ => None,
        };
        let found = git_bash_candidates(env, exists);
        assert_eq!(found, vec![PathBuf::from("/override/bash.exe"), PathBuf::from("/git/bin/bash.exe"), PathBuf::from("/pf/Git/bin/bash.exe")]);
    }

    #[cfg(unix)]
    #[test]
    fn the_previous_status_line_gets_the_same_input() {
        let out = run_previous("cat; echo ' fin'", b"{\"a\":1}", Duration::from_secs(5)).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "{\"a\":1} fin\n");
        assert!(run_previous("sleep 5", b"", Duration::from_millis(200)).is_none());
    }
}
