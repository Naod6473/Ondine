// Installer soi-même les hooks d'Ondine dans la configuration d'un agent
// (module Agents IA, bouton « Installer automatiquement »).
//
//   Claude Code : %USERPROFILE%\.claude\settings.json  (JSON)
//   Codex       : %USERPROFILE%\.codex\config.toml     (TOML)
//   Gemini CLI  : %USERPROFILE%\.gemini\settings.json  (JSON)
//
// Règles, pour ne jamais abîmer le fichier de l'utilisateur :
//   - on lit le fichier existant et on garde TOUT le reste (autres réglages,
//     hooks d'autres programmes, même dans la même liste d'événements) ;
//   - on retire seulement les anciennes entrées d'Ondine : toute commande dont
//     le programme s'appelle « ondine.exe », quel que soit son dossier (un
//     ancien chemin « target\debug » compris), puis on ajoute les entrées
//     actuelles ;
//   - un fichier illisible (JSON ou TOML invalide) n'est JAMAIS réécrit : on
//     refuse avec un message clair ;
//   - avant d'écrire : une copie « .bak » datée à côté, puis écriture dans un
//     fichier temporaire renommé ensuite (pas de fichier à moitié écrit).
//
// Codex (TOML) : on modifie le TEXTE (les commentaires et l'ordre du fichier
// restent), section par section, puis on relit le résultat et on vérifie
// qu'en dehors des entrées d'Ondine il dit exactement la même chose
// qu'avant. Sinon : refus, et il reste le bouton « Copier ».
//
// Ce fichier ne contient que de la logique « texte → texte » (testée plus
// bas) et l'écriture sur disque ; le module (agents.rs) choisit le fichier et
// fabrique les entrées d'Ondine.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

/// Le format du fichier de configuration.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Format {
    Json,
    Toml,
}

/// Au-delà, on ne touche pas au fichier (une configuration fait quelques ko).
const MAX_FILE: u64 = 2 * 1024 * 1024;

/// Le résultat d'une fusion : le nouveau texte, et ce qui a changé.
#[derive(Debug)]
pub struct Merge {
    pub text: String,
    /// Le nombre d'anciennes entrées d'Ondine retirées.
    pub removed: usize,
    /// Faux : le fichier resterait identique (rien à écrire).
    pub changed: bool,
}

/// Ce que contient le fichier, pour l'affichage.
#[derive(Debug, PartialEq)]
pub struct Status {
    /// "installed" (hooks d'Ondine, tous vers cet exe), "stale" (au moins un
    /// vers un autre ondine.exe), "absent" (aucun), "unreadable" (fichier invalide).
    pub state: &'static str,
    /// Le hook « Autoriser depuis l'île » (ondine.exe permission) est là.
    pub permission: bool,
    /// Un AUTRE programme a un hook PermissionRequest (Claude Code : deux
    /// réponses concurrentes à la même demande).
    pub other_permission: bool,
}

// ── Reconnaître une commande d'Ondine ────────────────────────────────────────

/// Le programme lancé par une commande de hook. Formes connues :
///   `C:\Program Files\Ondine\ondine.exe` (Claude Code, avec `args` à part),
///   `"C:\…\ondine.exe" notify --source codex` (Codex, par cmd.exe),
///   `$input | & 'C:\…\ondine.exe' notify --source gemini` (Gemini, PowerShell).
fn program_of(command: &str) -> String {
    let mut s = command.trim();
    // Le chemin seul, même avec des espaces et sans guillemets (forme Claude Code).
    if is_ondine_exe(s) {
        return s.to_string();
    }
    if let Some(rest) = s.strip_prefix("$input") {
        let rest = rest.trim_start();
        s = rest.strip_prefix('|').unwrap_or(rest).trim_start();
    }
    if let Some(rest) = s.strip_prefix('&') {
        s = rest.trim_start();
    }
    match s.chars().next() {
        // Entre guillemets doubles (cmd.exe) : jusqu'au guillemet suivant.
        Some('"') => s[1..].split('"').next().unwrap_or("").to_string(),
        // Entre apostrophes (PowerShell) : « '' » est une apostrophe du chemin.
        Some('\'') => {
            let mut out = String::new();
            let mut chars = s[1..].chars().peekable();
            while let Some(c) = chars.next() {
                if c == '\'' {
                    if chars.peek() != Some(&'\'') {
                        break;
                    }
                    chars.next();
                }
                out.push(c);
            }
            out
        }
        _ => s.split_whitespace().next().unwrap_or("").to_string(),
    }
}

/// Le fichier s'appelle-t-il « ondine.exe » (quel que soit son dossier) ?
fn is_ondine_exe(path: &str) -> bool {
    path.trim().rsplit(['\\', '/']).next().is_some_and(|name| name.eq_ignore_ascii_case("ondine.exe"))
}

/// Une entrée de hook (`{ "type": "command", "command": … }`) qui lance
/// Ondine : le chemin de son ondine.exe. Sinon None.
fn ondine_program(hook: &Value) -> Option<String> {
    let program = program_of(hook.get("command")?.as_str()?);
    is_ondine_exe(&program).then_some(program)
}

/// C'est le hook « Autoriser depuis l'île » (« ondine.exe permission ») ?
fn is_permission_hook(hook: &Value) -> bool {
    let in_args = hook.get("args").and_then(Value::as_array).and_then(|a| a.first()).and_then(Value::as_str) == Some("permission");
    let in_command = hook.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(" permission "));
    in_args || in_command
}

// ── Sur la forme commune (JSON, ou TOML relu en JSON) ────────────────────────
//
// { "hooks": { "Stop": [ { "matcher"?: …, "hooks": [ {…}, {…} ] } ], … } }

/// Retire les entrées d'Ondine ; un groupe (ou un événement, ou « hooks »)
/// vidé par ce retrait disparaît aussi. Rend le nombre d'entrées retirées.
fn strip(root: &mut Value) -> usize {
    let mut removed = 0;
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else { return 0 };
    for groups in hooks.values_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        groups.retain_mut(|group| {
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let before = list.len();
            list.retain(|h| ondine_program(h).is_none());
            removed += before - list.len();
            // Un groupe qui ne contenait QUE de l'Ondine part avec ses réglages (matcher…).
            !(list.is_empty() && before > 0)
        });
    }
    hooks.retain(|_, groups| groups.as_array().is_none_or(|g| !g.is_empty()));
    if hooks.is_empty() {
        if let Some(obj) = root.as_object_mut() {
            obj.shift_remove("hooks"); // (sans changer l'ordre des autres clés)
        }
    }
    removed
}

/// Seulement les entrées d'Ondine (même forme), pour vérifier une fusion.
fn ondine_part(root: &Value) -> Value {
    let mut out = Map::new();
    for (event, groups) in root.get("hooks").and_then(Value::as_object).into_iter().flatten() {
        let mine: Vec<Value> = groups
            .as_array()
            .into_iter()
            .flatten()
            .filter(|g| g.get("hooks").and_then(Value::as_array).is_some_and(|l| l.iter().any(|h| ondine_program(h).is_some())))
            .cloned()
            .collect();
        if !mine.is_empty() {
            out.insert(event.clone(), Value::Array(mine));
        }
    }
    if out.is_empty() { Value::Object(Map::new()) } else { serde_json::json!({ "hooks": out }) }
}

/// L'état, d'après le fichier relu.
fn status_of(root: &Value, exe: &str) -> Status {
    let mut found = false;
    let mut stale = false;
    let mut permission = false;
    let mut other_permission = false;
    for (event, groups) in root.get("hooks").and_then(Value::as_object).into_iter().flatten() {
        for group in groups.as_array().into_iter().flatten() {
            for hook in group.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                match ondine_program(hook) {
                    Some(program) => {
                        found = true;
                        stale |= !crate::platform::same_exe_path(&program, exe);
                        permission |= event == "PermissionRequest" && is_permission_hook(hook);
                    }
                    None => other_permission |= event == "PermissionRequest",
                }
            }
        }
    }
    let state = match (found, stale) {
        (false, _) => "absent",
        (true, true) => "stale",
        (true, false) => "installed",
    };
    Status { state, permission, other_permission }
}

/// Le fichier existant, relu (vide ou absent = rien). Erreur claire s'il est invalide.
fn parse(format: Format, existing: Option<&str>) -> Result<Value, String> {
    let text = existing.unwrap_or("").trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    let root = match format {
        Format::Json => serde_json::from_str::<Value>(text).map_err(|e| format!("JSON invalide ({e})"))?,
        Format::Toml => {
            let table = text.parse::<toml::Table>().map_err(|e| format!("TOML invalide ({})", e.message()))?;
            serde_json::to_value(table).map_err(|e| e.to_string())?
        }
    };
    if !root.is_object() {
        return Err("le fichier ne contient pas un objet de réglages".into());
    }
    if root.get("hooks").is_some_and(|h| !h.is_object()) {
        return Err("« hooks » n'a pas la forme attendue".into());
    }
    Ok(root)
}

/// L'état des hooks d'Ondine dans ce fichier (`existing` None : fichier absent).
pub fn status(format: Format, existing: Option<&str>, exe: &str) -> Status {
    match parse(format, existing) {
        Ok(root) => status_of(&root, exe),
        Err(_) => Status { state: "unreadable", permission: false, other_permission: false },
    }
}

/// Le fichier après installation : sans les anciennes entrées d'Ondine, avec
/// `ours` (JSON : `{"hooks": …}` ; TOML : les sections à ajouter à la fin).
pub fn install_text(format: Format, existing: Option<&str>, ours: &str) -> Result<Merge, String> {
    let old = parse(format, existing)?;
    match format {
        Format::Json => {
            let mut root = old.clone();
            let removed = strip(&mut root);
            let ours: Value = serde_json::from_str(ours).map_err(|e| e.to_string())?;
            let hooks = root.as_object_mut().ok_or("format inattendu")?.entry("hooks").or_insert_with(|| Value::Object(Map::new()));
            let hooks = hooks.as_object_mut().ok_or("« hooks » n'a pas la forme attendue")?;
            for (event, groups) in ours["hooks"].as_object().into_iter().flatten() {
                let list = hooks.entry(event.clone()).or_insert_with(|| Value::Array(vec![]));
                let list = list.as_array_mut().ok_or_else(|| format!("« hooks.{event} » n'a pas la forme attendue"))?;
                list.extend(groups.as_array().cloned().unwrap_or_default());
            }
            let text = json_text(&root);
            Ok(Merge { changed: root != old, text, removed })
        }
        Format::Toml => {
            let base = toml_strip_text(existing.unwrap_or(""));
            let mut text = base.trim_end().to_string();
            if !text.is_empty() {
                text.push_str(&eol(existing.unwrap_or("")).repeat(2));
            }
            text.push_str(&ours.replace('\n', eol(existing.unwrap_or(""))));
            let removed = toml_check(&old, &text, Some(ours))?;
            Ok(Merge { changed: text != existing.unwrap_or(""), text, removed })
        }
    }
}

/// Le fichier sans les entrées d'Ondine.
pub fn remove_text(format: Format, existing: Option<&str>) -> Result<Merge, String> {
    let old = parse(format, existing)?;
    match format {
        Format::Json => {
            let mut root = old.clone();
            let removed = strip(&mut root);
            Ok(Merge { text: json_text(&root), removed, changed: removed > 0 })
        }
        Format::Toml => {
            let text = toml_strip_text(existing.unwrap_or(""));
            let removed = toml_check(&old, &text, None)?;
            Ok(Merge { changed: removed > 0, text, removed })
        }
    }
}

fn json_text(root: &Value) -> String {
    let mut text = serde_json::to_string_pretty(root).unwrap_or_default();
    text.push('\n');
    text
}

/// La fin de ligne du fichier (Windows ou non).
fn eol(text: &str) -> &'static str {
    if text.contains("\r\n") { "\r\n" } else { "\n" }
}

// ── TOML : retirer les sections d'Ondine du texte ────────────────────────────

/// Le nom d'une ligne d'en-tête « [[a.b]] » (`Some((true, "a.b"))`) ou
/// « [a.b] » (`Some((false, "a.b"))`), espaces retirés.
fn header(line: &str) -> Option<(bool, String)> {
    let t = line.trim();
    let t = t.split_once('#').map(|(before, _)| before.trim_end()).unwrap_or(t);
    let norm = |s: &str| s.split('.').map(str::trim).collect::<Vec<_>>().join(".");
    if let Some(inner) = t.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) {
        return Some((true, norm(inner)));
    }
    t.strip_prefix('[').and_then(|r| r.strip_suffix(']')).map(|inner| (false, norm(inner)))
}

/// Le texte sans les sections « [[hooks.X.hooks]] » qui lancent ondine.exe
/// (et leur « [[hooks.X]] » s'il ne lui reste rien), ni le commentaire
/// « # Ondine… » juste au-dessus. Les commentaires et l'ordre du reste sont gardés.
fn toml_strip_text(text: &str) -> String {
    let nl = eol(text);
    // Des morceaux : ce qui précède le premier en-tête, puis un par en-tête.
    let mut chunks: Vec<(Option<(bool, String)>, Vec<&str>)> = vec![(None, vec![])];
    for line in text.lines() {
        match header(line) {
            Some(h) => chunks.push((Some(h), vec![line])),
            None => chunks.last_mut().unwrap().1.push(line),
        }
    }
    let mut keep = vec![true; chunks.len()];
    let mut i = 0;
    while i < chunks.len() {
        let event = match &chunks[i].0 {
            Some((true, name)) => name.strip_prefix("hooks.").filter(|e| !e.contains('.')).map(str::to_string),
            _ => None,
        };
        let Some(event) = event else {
            i += 1;
            continue;
        };
        let child = format!("hooks.{event}.hooks");
        let mut j = i + 1;
        let (mut total, mut mine) = (0, 0);
        while j < chunks.len() && chunks[j].0 == Some((true, child.clone())) {
            total += 1;
            let section = chunks[j].1.join("\n");
            let ondine = section.parse::<toml::Table>().ok().and_then(|t| serde_json::to_value(t).ok()).is_some_and(|v| ondine_program(&v["hooks"][&event]["hooks"][0]).is_some());
            if ondine {
                keep[j] = false;
                mine += 1;
            }
            j += 1;
        }
        if total > 0 && mine == total {
            keep[i] = false;
        }
        i = j;
    }
    // On recolle, en retirant le commentaire « # Ondine… » posé avant un bloc retiré.
    let mut out: Vec<&str> = Vec::new();
    for (k, (_, lines)) in chunks.iter().enumerate() {
        if keep[k] {
            out.extend(lines);
        } else {
            while out.last().is_some_and(|l| l.trim().is_empty() || l.trim_start().starts_with("# Ondine")) {
                out.pop();
            }
        }
    }
    let mut result = out.join(nl);
    if !result.is_empty() && (text.ends_with('\n') || keep.iter().any(|k| !k)) {
        result.push_str(nl);
    }
    result
}

/// Vérifie le texte TOML produit : il se relit, il dit la même chose
/// qu'avant en dehors d'Ondine, et ses entrées d'Ondine sont exactement
/// `ours` (ou aucune). Rend le nombre d'anciennes entrées retirées.
fn toml_check(old: &Value, new_text: &str, ours: Option<&str>) -> Result<usize, String> {
    const RISKY: &str = "fusion risquée (forme inhabituelle du fichier) : rien n'a été modifié, la copie manuelle reste possible";
    let new = parse(Format::Toml, Some(new_text)).map_err(|_| RISKY.to_string())?;
    let (mut a, mut b) = (old.clone(), new.clone());
    let removed = strip(&mut a);
    strip(&mut b);
    let expected = match ours {
        Some(o) => ondine_part(&parse(Format::Toml, Some(o))?),
        None => Value::Object(Map::new()),
    };
    if a != b || ondine_part(&new) != expected {
        return Err(RISKY.into());
    }
    Ok(removed)
}

// ── Sur le disque ────────────────────────────────────────────────────────────

/// Lit le fichier (None : il n'existe pas). Erreur s'il est trop gros ou illisible.
pub fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{} : {e}", path.display())),
        Ok(m) if m.len() > MAX_FILE => return Err(format!("{} : fichier trop gros, laissé tel quel", path.display())),
        Ok(_) => {}
    }
    std::fs::read_to_string(path).map(Some).map_err(|e| format!("{} : {e}", path.display()))
}

/// Écrit `text` dans `path` : copie de sécurité datée « nom.ondine-<date>.bak »
/// si le fichier existe, dossier créé si besoin, puis fichier temporaire
/// renommé (un lien symbolique est suivi : c'est sa cible qui est écrite).
/// Rend le chemin de la copie de sécurité.
pub fn write_with_backup(path: &Path, text: &str, stamp: &str) -> Result<Option<PathBuf>, String> {
    let target = match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => std::fs::canonicalize(path).map_err(|e| format!("{} : {e}", path.display()))?,
        _ => path.to_path_buf(),
    };
    let dir = target.parent().ok_or("dossier introuvable")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{} : {e}", dir.display()))?;
    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let backup = if target.exists() {
        let bak = dir.join(format!("{name}.ondine-{stamp}.bak"));
        std::fs::copy(&target, &bak).map_err(|e| format!("copie de sécurité impossible ({e}) : rien n'a été modifié"))?;
        Some(bak)
    } else {
        None
    };
    let tmp = dir.join(format!("{name}.ondine-tmp"));
    std::fs::write(&tmp, text).map_err(|e| format!("{} : {e}", tmp.display()))?;
    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{} : {e}", target.display()));
    }
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const EXE: &str = r"C:\Program Files\Ondine\ondine.exe";
    const DEBUG: &str = r"C:\Users\Simon\ondine\src-tauri\target\debug\ondine.exe";

    /// Les entrées d'Ondine pour Claude Code (comme agents.rs les fabrique).
    fn claude_ours(exe: &str) -> String {
        let entry = json!([{ "hooks": [{ "type": "command", "command": exe, "args": ["notify", "--source", "claude-code"] }] }]);
        json!({ "hooks": { "Stop": entry, "Notification": entry } }).to_string()
    }

    fn codex_ours(exe: &str) -> String {
        let cmd = format!("\"{exe}\" notify --source codex").replace('\\', "\\\\").replace('"', "\\\"");
        format!("# Ondine : hooks\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = \"{cmd}\"\n")
    }

    const COUCOU: &str = r#"{
  "model": "opus",
  "permissions": { "allow": ["Bash(ls)"] },
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "C:\\Tools\\coucou.exe ping" } ] } ],
    "PermissionRequest": [ { "hooks": [ { "type": "command", "command": "\"C:\\Tools\\coucou.exe\" ask" } ] } ]
  }
}"#;

    #[test]
    fn programs_are_recognized() {
        assert_eq!(program_of(EXE), EXE);
        assert_eq!(program_of(r#""C:\a b\ondine.exe" notify --source codex"#), r"C:\a b\ondine.exe");
        assert_eq!(program_of(r"$input | & 'C:\O''Neil\ondine.exe' notify"), r"C:\O'Neil\ondine.exe");
        assert_eq!(program_of(r"$input | & 'C:\Ondine\ondine.exe' notify --source gemini"), r"C:\Ondine\ondine.exe");
        assert!(ondine_program(&json!({ "command": r"C:\Tools\coucou.exe --watch ondine.exe" })).is_none());
        assert!(ondine_program(&json!({ "command": "D:/x/Ondine.EXE notify" })).is_some());
    }

    #[test]
    fn empty_file_gets_our_hooks() {
        for existing in [None, Some(""), Some("  \n")] {
            let m = install_text(Format::Json, existing, &claude_ours(EXE)).unwrap();
            let v: Value = serde_json::from_str(&m.text).unwrap();
            assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], EXE);
            assert!(m.changed && m.removed == 0);
            assert_eq!(status(Format::Json, Some(&m.text), EXE).state, "installed");
        }
        assert_eq!(status(Format::Json, None, EXE).state, "absent");
    }

    #[test]
    fn coucou_hooks_are_kept() {
        let m = install_text(Format::Json, Some(COUCOU), &claude_ours(EXE)).unwrap();
        let v: Value = serde_json::from_str(&m.text).unwrap();
        assert_eq!(v["model"], "opus");
        assert_eq!(v["permissions"]["allow"][0], "Bash(ls)");
        // Coucou garde sa place, Ondine s'ajoute après lui dans la même liste.
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], r"C:\Tools\coucou.exe ping");
        assert_eq!(v["hooks"]["Stop"][1]["hooks"][0]["command"], EXE);
        // L'ordre des clés du fichier est gardé.
        assert!(m.text.find("\"model\"").unwrap() < m.text.find("\"permissions\"").unwrap());
        let s = status(Format::Json, Some(&m.text), EXE);
        assert_eq!((s.state, s.permission, s.other_permission), ("installed", false, true));
        // Réinstaller ne double rien.
        let again = install_text(Format::Json, Some(&m.text), &claude_ours(EXE)).unwrap();
        assert_eq!(again.text, m.text);
        assert!(!again.changed && again.removed == 2);
    }

    #[test]
    fn old_debug_path_is_replaced() {
        let old = install_text(Format::Json, Some(COUCOU), &claude_ours(DEBUG)).unwrap().text;
        assert_eq!(status(Format::Json, Some(&old), EXE).state, "stale");
        let m = install_text(Format::Json, Some(&old), &claude_ours(EXE)).unwrap();
        assert_eq!(m.removed, 2);
        assert!(!m.text.contains("debug"));
        assert_eq!(status(Format::Json, Some(&m.text), EXE).state, "installed");
        // Un groupe partagé : seule l'entrée d'Ondine part.
        let shared = json!({ "hooks": { "Stop": [{ "matcher": "*", "hooks": [{ "command": DEBUG }, { "command": "coucou.exe" }] }] } }).to_string();
        let r = remove_text(Format::Json, Some(&shared)).unwrap();
        let v: Value = serde_json::from_str(&r.text).unwrap();
        assert_eq!(v["hooks"]["Stop"][0], json!({ "matcher": "*", "hooks": [{ "command": "coucou.exe" }] }));
    }

    #[test]
    fn remove_keeps_everything_else() {
        let installed = install_text(Format::Json, Some(COUCOU), &claude_ours(EXE)).unwrap().text;
        let r = remove_text(Format::Json, Some(&installed)).unwrap();
        assert_eq!((r.removed, r.changed), (2, true));
        let (a, b): (Value, Value) = (serde_json::from_str(&r.text).unwrap(), serde_json::from_str(COUCOU).unwrap());
        assert_eq!(a, b);
        // Seulement Ondine dans le fichier : « hooks » disparaît.
        let alone = install_text(Format::Json, Some("{\"model\":\"x\"}"), &claude_ours(EXE)).unwrap().text;
        let v: Value = serde_json::from_str(&remove_text(Format::Json, Some(&alone)).unwrap().text).unwrap();
        assert_eq!(v, json!({ "model": "x" }));
        assert!(!remove_text(Format::Json, None).unwrap().changed);
    }

    #[test]
    fn invalid_files_are_refused() {
        for bad in ["{ \"model\": ", "// commentaire\n{}", "[1, 2]", "{\"hooks\": 3}"] {
            assert!(install_text(Format::Json, Some(bad), &claude_ours(EXE)).is_err(), "{bad}");
            assert!(remove_text(Format::Json, Some(bad)).is_err(), "{bad}");
            assert_eq!(status(Format::Json, Some(bad), EXE).state, "unreadable");
        }
        assert!(install_text(Format::Toml, Some("model = "), &codex_ours(EXE)).is_err());
    }

    #[test]
    fn codex_toml_merge_keeps_comments() {
        let existing = "# Mon Codex\nmodel = \"o4\"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = \"command\"\ncommand = \"coucou.exe ping\"\n\n[mcp_servers.x]\ncommand = \"x.exe\"\n";
        let m = install_text(Format::Toml, Some(existing), &codex_ours(DEBUG)).unwrap();
        assert!(m.text.starts_with("# Mon Codex\n") && m.text.contains("coucou.exe ping"));
        assert_eq!(status(Format::Toml, Some(&m.text), EXE).state, "stale");
        // Nouveau chemin : l'ancien bloc (et son commentaire) part.
        let m2 = install_text(Format::Toml, Some(&m.text), &codex_ours(EXE)).unwrap();
        assert_eq!(m2.removed, 1);
        assert!(!m2.text.contains("debug") && m2.text.matches("# Ondine").count() == 1, "{}", m2.text);
        assert_eq!(status(Format::Toml, Some(&m2.text), EXE).state, "installed");
        // Retirer : on retrouve le fichier d'origine.
        let r = remove_text(Format::Toml, Some(&m2.text)).unwrap();
        assert_eq!(r.text, existing);
        // Fichier vide.
        let fresh = install_text(Format::Toml, None, &codex_ours(EXE)).unwrap();
        assert_eq!(fresh.text, codex_ours(EXE));
    }

    #[test]
    fn codex_unusual_form_is_refused() {
        // Hooks écrits en tableau en ligne : on ne sait pas les fusionner sans risque.
        let inline = format!("[hooks]\nStop = [{{ hooks = [{{ type = \"command\", command = '{DEBUG} notify' }}] }}]\n");
        assert!(install_text(Format::Toml, Some(&inline), &codex_ours(EXE)).is_err());
        assert!(remove_text(Format::Toml, Some(&inline)).is_err());
    }

    #[test]
    fn writes_with_backup() {
        let dir = std::env::temp_dir().join(format!("ondine-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("sub").join("settings.json");
        assert_eq!(read(&file).unwrap(), None);
        assert_eq!(write_with_backup(&file, "{}\n", "1").unwrap(), None);
        let bak = write_with_backup(&file, "{\"a\":1}\n", "2").unwrap().unwrap();
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), "{}\n");
        assert_eq!(read(&file).unwrap().unwrap(), "{\"a\":1}\n");
        assert!(!dir.join("sub").join("settings.json.ondine-tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
