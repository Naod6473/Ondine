// Les fichiers modifiés en direct (onglet Agents IA, 1.2.4).
//
// Pendant qu'un agent travaille, chaque fichier qu'il modifie apparaît sous sa
// session, avec « +12 −3 » ; un clic montre le changement (lecture seule).
// Technique reprise de coucou (MIT, DiffEngine), réécrite.
//
// Chemin : le hook PostToolUse de Claude Code (outils Edit, MultiEdit, Write)
// ou AfterTool de Gemini CLI (replace, write_file) → « ondine.exe notify »
// (cli.rs), qui calcule ICI le changement (diff ligne à ligne) et n'envoie à
// l'île qu'un petit résumé : le chemin, +N −M et au plus quelques centaines de
// lignes du changement, coupées (le contenu entier d'un fichier ne passe
// jamais par le canal). Claude Code donne souvent `structuredPatch` dans
// `tool_response` : on le prend tel quel (il connaît le fichier d'avant).
//
// Dans l'île : le chemin repasse par `check_path` (dossiers exclus refusés :
// rien n'est gardé ni montré), le tout reste en MÉMOIRE (24 fichiers au plus),
// est oublié au message suivant de la session ou à sa fin, et n'est jamais
// écrit dans le journal. Rien n'est exécuté ni ouvert.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

/// Au-delà (les deux textes ensemble), on ne calcule pas le diff : seulement +N −M.
const MAX_BYTES: usize = 200 * 1024;
const MAX_LINES: usize = 4000;
/// Le calcul (LCS) est en m × n : on s'arrête avant.
const MAX_CELLS: usize = 1_000_000;
/// Lignes de contexte autour d'un changement.
const CONTEXT: usize = 3;
/// Ce qui part vers l'île : au plus ce nombre de lignes, chacune coupée.
pub const MAX_SENT_LINES: usize = 300;
const MAX_LINE_CHARS: usize = 240;
/// Ce que l'île garde : fichiers, lignes par fichier.
const MAX_FILES: usize = 24;
const MAX_KEPT_LINES: usize = 600;

/// Une ligne du changement : '+' ajoutée, '-' retirée, ' ' contexte, '~' saut
/// (lignes inchangées entre deux morceaux).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Line(pub char, pub String);

/// Le changement d'un fichier.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Change {
    pub added: usize,
    pub removed: usize,
    pub lines: Vec<Line>,
    /// Trop gros pour être montré : seulement les nombres.
    pub too_large: bool,
    pub is_new: bool,
}

fn split(text: &str) -> Vec<&str> {
    let mut v: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    if v.last() == Some(&"") {
        v.pop(); // un retour à la ligne final ne fait pas une ligne de plus
    }
    v
}

fn cut(s: &str) -> String {
    if s.chars().count() <= MAX_LINE_CHARS {
        return s.to_string();
    }
    let mut c: String = s.chars().take(MAX_LINE_CHARS - 1).collect();
    c.push('…');
    c
}

/// Trop gros : on compte les lignes nouvelles et disparues, sans les montrer.
fn count_only(old: &[&str], new: &[&str]) -> Change {
    use std::collections::HashSet;
    let (o, n): (HashSet<&str>, HashSet<&str>) = (old.iter().copied().collect(), new.iter().copied().collect());
    Change {
        added: new.iter().filter(|l| !l.is_empty() && !o.contains(*l)).count(),
        removed: old.iter().filter(|l| !l.is_empty() && !n.contains(*l)).count(),
        lines: vec![],
        too_large: true,
        is_new: false,
    }
}

/// Le diff ligne à ligne de deux textes (plus longue sous-suite commune), en
/// morceaux avec 3 lignes de contexte.
pub fn diff(old_text: &str, new_text: &str) -> Change {
    let (old, new) = (split(old_text), split(new_text));
    if old_text.len() + new_text.len() > MAX_BYTES || old.len() + new.len() > MAX_LINES || old.len() * new.len() > MAX_CELLS {
        return count_only(&old, &new);
    }
    let (m, n) = (old.len(), new.len());
    let w = n + 1;
    let mut dp = vec![0u16; (m + 1) * w];
    for i in 1..=m {
        for j in 1..=n {
            dp[i * w + j] = if old[i - 1] == new[j - 1] { dp[(i - 1) * w + j - 1] + 1 } else { dp[(i - 1) * w + j].max(dp[i * w + j - 1]) };
        }
    }
    // On remonte : la suite des lignes, de la fin vers le début.
    let mut flat: Vec<Line> = Vec::new();
    let (mut i, mut j) = (m, n);
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old[i - 1] == new[j - 1] {
            flat.push(Line(' ', old[i - 1].to_string()));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i * w + j - 1] >= dp[(i - 1) * w + j]) {
            flat.push(Line('+', new[j - 1].to_string()));
            j -= 1;
        } else {
            flat.push(Line('-', old[i - 1].to_string()));
            i -= 1;
        }
    }
    flat.reverse();
    // Les retirées avant les ajoutées dans chaque bloc, comme un diff habituel.
    let mut k = 0;
    while k < flat.len() {
        if flat[k].0 == ' ' {
            k += 1;
            continue;
        }
        let start = k;
        while k < flat.len() && flat[k].0 != ' ' {
            k += 1;
        }
        flat[start..k].sort_by_key(|l| if l.0 == '-' { 0 } else { 1 });
    }
    let added = flat.iter().filter(|l| l.0 == '+').count();
    let removed = flat.iter().filter(|l| l.0 == '-').count();
    Change { added, removed, lines: hunks(&flat), too_large: false, is_new: false }
}

/// Garde les changements et 3 lignes autour ; un « ~ » entre deux morceaux.
fn hunks(flat: &[Line]) -> Vec<Line> {
    let keep: Vec<bool> = (0..flat.len()).map(|i| (i.saturating_sub(CONTEXT)..=(i + CONTEXT).min(flat.len().saturating_sub(1))).any(|k| flat[k].0 != ' ')).collect();
    let mut out = Vec::new();
    let mut skipped = false;
    for (i, l) in flat.iter().enumerate() {
        if keep[i] {
            if skipped && !out.is_empty() {
                out.push(Line('~', String::new()));
            }
            skipped = false;
            out.push(l.clone());
        } else {
            skipped = true;
        }
    }
    out
}

/// Un fichier écrit d'un coup (Write) sans savoir ce qu'il y avait : tout est ajouté.
pub fn whole(content: &str) -> Change {
    let lines = split(content);
    if content.len() > MAX_BYTES || lines.len() > MAX_LINES {
        return Change { added: lines.len(), too_large: true, is_new: true, ..Change::default() };
    }
    Change { added: lines.len(), removed: 0, lines: lines.iter().map(|l| Line('+', l.to_string())).collect(), too_large: false, is_new: true }
}

/// `structuredPatch` de Claude Code : [{ lines: ["-a", "+b", " c"] }, …].
fn from_patch(patch: &[Value]) -> Option<Change> {
    let mut c = Change::default();
    for (h, hunk) in patch.iter().enumerate() {
        let lines = hunk.get("lines")?.as_array()?;
        if h > 0 {
            c.lines.push(Line('~', String::new()));
        }
        for l in lines {
            let s = l.as_str()?;
            let mut chars = s.chars();
            let kind = match chars.next() {
                Some('+') => '+',
                Some('-') => '-',
                Some(' ') => ' ',
                _ => continue, // « \ No newline at end of file »…
            };
            match kind {
                '+' => c.added += 1,
                '-' => c.removed += 1,
                _ => {}
            }
            c.lines.push(Line(kind, chars.as_str().to_string()));
        }
    }
    Some(c)
}

/// Le chemin et le changement d'un événement d'outil (PostToolUse de Claude
/// Code, AfterTool de Gemini CLI). None : pas une modification de fichier, ou
/// rien de changé.
pub fn change_of(hook: &Value) -> Option<(String, Change)> {
    let event = hook["hook_event_name"].as_str().unwrap_or("");
    if !matches!(event, "PostToolUse" | "AfterTool") {
        return None;
    }
    let tool = hook["tool_name"].as_str().unwrap_or("");
    let input = &hook["tool_input"];
    let path = input["file_path"].as_str().or_else(|| input["absolute_path"].as_str()).or_else(|| input["path"].as_str())?.trim().to_string();
    if path.is_empty() {
        return None;
    }
    let s = |v: &Value| v.as_str().map(str::to_string);
    let response = &hook["tool_response"];
    let mut change = match tool {
        "Edit" | "MultiEdit" | "Write" | "replace" | "write_file" => {
            // Claude Code connaît le fichier d'avant : son patch est le plus juste.
            match response["structuredPatch"].as_array().filter(|p| !p.is_empty()).and_then(|p| from_patch(p)) {
                Some(c) => c,
                None => match tool {
                    "Edit" | "replace" => diff(&s(&input["old_string"])?, &s(&input["new_string"])?),
                    "MultiEdit" => {
                        let mut total = Change::default();
                        for e in input["edits"].as_array()? {
                            let c = diff(e["old_string"].as_str().unwrap_or(""), e["new_string"].as_str().unwrap_or(""));
                            if !total.lines.is_empty() && !c.lines.is_empty() {
                                total.lines.push(Line('~', String::new()));
                            }
                            total.added += c.added;
                            total.removed += c.removed;
                            total.too_large |= c.too_large;
                            total.lines.extend(c.lines);
                        }
                        total
                    }
                    _ => whole(&s(&input["content"])?),
                },
            }
        }
        _ => return None,
    };
    if tool == "Write" || tool == "write_file" {
        change.is_new = response["type"] == "create" || (response.get("type").is_none() && change.removed == 0);
    }
    (change.added + change.removed > 0).then_some((path, change))
}

/// Ce que « ondine.exe notify » envoie à l'île à la place du hook complet :
/// petit (le canal accepte 64 Ko), sans le contenu entier du fichier.
pub fn compact(source: &str, hook: &Value) -> Option<Value> {
    let (path, change) = change_of(hook)?;
    let lines: Vec<Value> = change.lines.iter().take(MAX_SENT_LINES).map(|l| json!([l.0.to_string(), cut(&l.1)])).collect();
    let mut out = json!({
        "v": 1,
        "source": source,
        "hook": { "hook_event_name": hook["hook_event_name"], "session_id": hook["session_id"], "cwd": hook["cwd"] },
        "live": {
            "path": path,
            "added": change.added,
            "removed": change.removed,
            "tooLarge": change.too_large,
            "isNew": change.is_new,
            "cut": change.lines.len() > MAX_SENT_LINES,
            "lines": lines,
        },
    });
    // Toujours sous la limite du canal : on enlève des lignes s'il le faut.
    while out.to_string().len() > crate::cli::MAX_MESSAGE - 1024 {
        let arr = out["live"]["lines"].as_array_mut()?;
        let n = arr.len();
        if n == 0 {
            break;
        }
        arr.truncate(n * 3 / 4);
        out["live"]["cut"] = json!(true);
    }
    Some(out)
}

// ── Dans l'île ───────────────────────────────────────────────────────────────

/// Un fichier modifié, gardé en mémoire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: u64,
    pub session: String,
    pub source: String,
    /// Le nom du fichier, et celui de son dossier (jamais le chemin complet à l'écran).
    pub name: String,
    pub folder: String,
    pub added: usize,
    pub removed: usize,
    pub at: u64,
    pub is_new: bool,
    pub too_large: bool,
    #[serde(skip)]
    pub path: String,
    #[serde(skip)]
    pub lines: Vec<Line>,
    #[serde(skip)]
    pub cut: bool,
}

#[derive(Default)]
pub struct Store {
    files: VecDeque<Entry>,
    next: u64,
    recent: VecDeque<Instant>,
}

/// Le nom d'un fichier et de son dossier, depuis un chemin Windows ou non.
pub fn names(path: &str) -> (String, String) {
    let mut parts = path.trim_end_matches(['\\', '/']).rsplit(['\\', '/']);
    let name = parts.next().unwrap_or("").chars().take(120).collect();
    let folder = parts.next().unwrap_or("").chars().take(60).collect();
    (name, folder)
}

impl Store {
    /// Au plus 20 modifications par seconde (au-delà : ignorées).
    pub fn allow(&mut self) -> bool {
        self.recent.retain(|t| t.elapsed() < Duration::from_secs(1));
        if self.recent.len() >= 20 {
            return false;
        }
        self.recent.push_back(Instant::now());
        true
    }

    /// Ajoute (ou complète) le fichier `path` de la session.
    pub fn note(&mut self, session: &str, source: &str, path: &str, live: &Value, at: u64) -> u64 {
        let lines: Vec<Line> = live["lines"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|l| {
                let kind = l[0].as_str()?.chars().next().filter(|c| matches!(c, '+' | '-' | ' ' | '~'))?;
                Some(Line(kind, cut(l[1].as_str().unwrap_or(""))))
            })
            .take(MAX_SENT_LINES)
            .collect();
        let n = |k: &str| live[k].as_u64().unwrap_or(0) as usize;
        let flag = |k: &str| live[k].as_bool().unwrap_or(false);
        if let Some(pos) = self.files.iter().position(|e| e.session == session && e.path == path) {
            let mut e = self.files.remove(pos).expect("position trouvée");
            e.added += n("added");
            e.removed += n("removed");
            e.at = at;
            e.too_large |= flag("tooLarge");
            e.cut |= flag("cut");
            if !e.lines.is_empty() && !lines.is_empty() {
                e.lines.push(Line('~', String::new()));
            }
            e.lines.extend(lines);
            if e.lines.len() > MAX_KEPT_LINES {
                let drop = e.lines.len() - MAX_KEPT_LINES;
                e.lines.drain(..drop); // les plus récentes d'abord
                e.cut = true;
            }
            let id = e.id;
            self.files.push_front(e);
            return id;
        }
        self.next += 1;
        let (name, folder) = names(path);
        self.files.push_front(Entry {
            id: self.next,
            session: session.into(),
            source: source.into(),
            name,
            folder,
            added: n("added"),
            removed: n("removed"),
            at,
            is_new: flag("isNew"),
            too_large: flag("tooLarge"),
            path: path.into(),
            lines,
            cut: flag("cut"),
        });
        self.files.truncate(MAX_FILES);
        self.next
    }

    /// Un nouveau message (ou la fin) de la session : ses fichiers sont oubliés.
    pub fn forget(&mut self, session: &str) -> bool {
        let before = self.files.len();
        self.files.retain(|e| e.session != session);
        before != self.files.len()
    }

    pub fn list(&self) -> Vec<Entry> {
        self.files.iter().cloned().collect()
    }

    pub fn get(&self, id: u64) -> Option<&Entry> {
        self.files.iter().find(|e| e.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(c: &Change) -> String {
        c.lines.iter().map(|l| l.0).collect()
    }

    #[test]
    fn counts_added_and_removed_lines() {
        let c = diff("a\nb\nc\n", "a\nB\nc\nd\n");
        assert_eq!((c.added, c.removed), (2, 1));
        assert_eq!(kinds(&c), " -+ +");
        assert_eq!(c.lines[1], Line('-', "b".into()));
        // Rien de changé : 0 et 0. Retours chariot de Windows : pareil.
        let same = diff("x\r\ny\r\n", "x\ny\n");
        assert_eq!((same.added, same.removed), (0, 0));
        // Tout nouveau / tout retiré.
        assert_eq!((diff("", "a\nb").added, diff("a\nb", "").removed), (2, 2));
    }

    #[test]
    fn far_apart_changes_become_two_pieces() {
        let old: Vec<String> = (1..=30).map(|i| format!("l{i}")).collect();
        let mut new = old.clone();
        new[1] = "x".into();
        new[25] = "y".into();
        let c = diff(&old.join("\n"), &new.join("\n"));
        assert_eq!((c.added, c.removed), (2, 2));
        assert_eq!(c.lines.iter().filter(|l| l.0 == '~').count(), 1);
        // 3 lignes de contexte de chaque côté, pas plus.
        assert!(c.lines.len() < 20);
    }

    #[test]
    fn too_big_gives_only_the_numbers() {
        let old = "a\n".repeat(3000);
        let new = format!("{old}{}", "b\n".repeat(1500));
        let c = diff(&old, &new);
        assert!(c.too_large && c.lines.is_empty());
        assert_eq!(c.added, 1500);
    }

    #[test]
    fn claude_and_gemini_events() {
        let edit = json!({ "hook_event_name": "PostToolUse", "tool_name": "Edit", "session_id": "s", "cwd": "C:\\p",
            "tool_input": { "file_path": "C:\\p\\a.rs", "old_string": "x\n", "new_string": "y\nz\n" } });
        let (path, c) = change_of(&edit).unwrap();
        assert_eq!((path.as_str(), c.added, c.removed), ("C:\\p\\a.rs", 2, 1));
        // structuredPatch de Claude Code : pris tel quel.
        let mut patched = edit.clone();
        patched["tool_response"] = json!({ "structuredPatch": [{ "lines": [" a", "-b", "+c", "+d"] }, { "lines": ["-e"] }] });
        let (_, c) = change_of(&patched).unwrap();
        assert_eq!((c.added, c.removed, kinds(&c)), (2, 2, " -++~-".into()));
        let multi = json!({ "hook_event_name": "PostToolUse", "tool_name": "MultiEdit", "tool_input": { "file_path": "/p/b.ts", "edits": [{ "old_string": "a", "new_string": "b" }, { "old_string": "c", "new_string": "" }] } });
        assert_eq!(change_of(&multi).map(|(_, c)| (c.added, c.removed)), Some((1, 2)));
        let write = json!({ "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": "/p/n.md", "content": "# T\n\nfin\n" }, "tool_response": { "type": "create" } });
        let (_, c) = change_of(&write).unwrap();
        assert!(c.is_new && c.added == 3);
        let gemini = json!({ "hook_event_name": "AfterTool", "tool_name": "replace", "tool_input": { "file_path": "/p/g.py", "old_string": "1", "new_string": "2" } });
        assert!(change_of(&gemini).is_some());
        // Pas une modification de fichier, ou rien de changé : rien.
        assert!(change_of(&json!({ "hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_input": { "command": "ls" } })).is_none());
        assert!(change_of(&json!({ "hook_event_name": "PostToolUse", "tool_name": "Edit", "tool_input": { "file_path": "/a", "old_string": "x", "new_string": "x" } })).is_none());
        assert!(change_of(&json!({ "hook_event_name": "Stop" })).is_none());
    }

    #[test]
    fn the_message_stays_small() {
        let content: String = (0..3000).map(|i| format!("ligne {i} {}\n", "x".repeat(300))).collect();
        let write = json!({ "hook_event_name": "PostToolUse", "tool_name": "Write", "session_id": "s", "tool_input": { "file_path": "/p/big.txt", "content": content } });
        let m = compact("claude-code", &write).unwrap();
        assert!(m.to_string().len() < crate::cli::MAX_MESSAGE);
        assert_eq!(m["live"]["added"], 3000);
        assert!(m["hook"].get("tool_input").is_none());
        let small = json!({ "hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": { "file_path": "/p/s.txt", "content": "a\n".repeat(1000) } });
        let m = compact("claude-code", &small).unwrap();
        assert_eq!((m["live"]["lines"].as_array().unwrap().len(), m["live"]["cut"].as_bool()), (MAX_SENT_LINES, Some(true)));
    }

    #[test]
    fn the_store_merges_and_forgets() {
        let mut s = Store::default();
        let live = json!({ "added": 2, "removed": 1, "lines": [["+", "a"], ["-", "b"], ["?", "x"]] });
        let id = s.note("claude-code:s", "claude-code", "C:\\p\\src\\a.rs", &live, 1);
        let again = s.note("claude-code:s", "claude-code", "C:\\p\\src\\a.rs", &live, 2);
        assert_eq!(id, again);
        let e = s.get(id).unwrap();
        assert_eq!((e.added, e.removed, e.name.as_str(), e.folder.as_str()), (4, 2, "a.rs", "src"));
        assert_eq!(e.lines.iter().map(|l| l.0).collect::<String>(), "+-~+-");
        s.note("codex:t", "codex", "/x/b.rs", &live, 3);
        assert_eq!(s.list().len(), 2);
        assert!(s.forget("claude-code:s"));
        assert_eq!(s.list().len(), 1);
        for i in 0..40 {
            s.note("codex:t", "codex", &format!("/x/{i}.rs"), &live, 4);
        }
        assert_eq!(s.list().len(), MAX_FILES);
        // Jamais le chemin complet vers le front.
        let shown = serde_json::to_value(s.list()).unwrap();
        assert!(shown[0].get("path").is_none() && shown[0]["name"] == "39.rs");
    }
}
