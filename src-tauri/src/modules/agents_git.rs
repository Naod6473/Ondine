// Agents IA : le bilan de fin de tâche. Quand un agent a fini, l'île regarde
// ce qui a changé dans le dossier de sa session, si ce dossier est dans un
// dépôt git : « 3 fichiers modifiés, +120 −14 » et le nom des fichiers.
//
// « Ce qui a changé » = ce que `git status` montre : les changements pas
// encore validés (commit), fichiers nouveaux compris.
//
// git.exe est lancé par son chemin complet, en lecture seule, en 3 s au plus
// pour les deux commandes (platform::devtools) :
//   git status --porcelain=v1 -z -uall     → la liste des fichiers changés ;
//   git diff --numstat -z HEAD --          → les lignes ajoutées / retirées.
// Les lignes des fichiers nouveaux (pas encore suivis par git) sont comptées
// ici, pour les petits fichiers texte seulement. Rien n'est écrit dans le
// dépôt (--no-optional-locks), aucun programme réglé dans le dépôt n'est lancé
// par ces commandes (core.fsmonitor coupé, --no-ext-diff, --no-textconv), et
// rien de ce qu'on lit ne va dans le journal.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::platform::devtools;

/// Le délai maximum pour tout le bilan (les deux commandes git et le comptage).
pub const TIMEOUT: Duration = Duration::from_secs(3);
/// Combien de noms de fichiers on montre.
const MAX_NAMES: usize = 3;
/// Les lignes des fichiers nouveaux : au plus ce nombre de fichiers lus…
const MAX_NEW_FILES: usize = 200;
/// … et seulement s'ils font moins de 1 Mo.
const MAX_NEW_BYTES: u64 = 1024 * 1024;

/// Ce qui a changé dans un dépôt.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Changes {
    /// Combien de fichiers ont changé (nouveaux et supprimés compris).
    pub files: usize,
    /// Lignes ajoutées et retirées (0 pour un fichier binaire).
    pub added: u64,
    pub removed: u64,
    /// Les noms (sans le dossier) des fichiers les plus changés, 3 au plus.
    pub names: Vec<String>,
}

/// Une ligne de `git status` : le chemin (depuis la racine du dépôt) et
/// « nouveau, pas encore suivi par git » (`??`).
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub path: String,
    pub untracked: bool,
}

/// Le dossier racine du dépôt qui contient `dir` (celui qui a un « .git »),
/// en remontant. None : pas de dépôt ; ou un « dépôt » qui serait tout le
/// dossier utilisateur ou tout un disque (des réglages sauvegardés avec git,
/// pas un projet, et bien trop gros à parcourir).
pub fn repo_root(dir: &Path, home: &Path) -> Option<PathBuf> {
    let root = dir.ancestors().find(|d| d.join(".git").exists())?;
    if root.parent().is_none() || same_dir(root, home) {
        return None;
    }
    Some(root.to_path_buf())
}

/// Deux dossiers identiques ? Sans tenir compte des majuscules (Windows non
/// plus) ni d'un « \ » final.
fn same_dir(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

/// Le bilan du dépôt `root`, vu depuis `dir` (dossier de la session).
/// None : git a échoué ou a été trop long.
pub fn changes(git: &Path, dir: &Path, root: &Path) -> Option<Changes> {
    let deadline = Instant::now() + TIMEOUT;
    let run = |args: &[&str]| -> Option<Vec<u8>> {
        let left = deadline.checked_duration_since(Instant::now())?;
        // Options communes : aucune écriture dans le dépôt, pas de « fsmonitor »
        // (un programme que le dépôt pourrait demander de lancer).
        let mut all = vec!["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false"];
        all.extend_from_slice(args);
        devtools::run_with_timeout(git, &all, dir, &[("GIT_TERMINAL_PROMPT", "0"), ("GIT_OPTIONAL_LOCKS", "0")], left).ok()
    };
    let entries = parse_status(&run(&["status", "--porcelain=v1", "-z", "-uall"])?);
    if entries.is_empty() {
        return Some(Changes::default());
    }
    // Un dépôt sans aucun commit n'a pas de HEAD : les lignes ne sont alors pas comptées.
    let numstat = run(&["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "--no-color", "HEAD", "--"]).map(|o| parse_numstat(&o)).unwrap_or_default();
    let new_lines = |path: &str| if Instant::now() < deadline { count_lines(&root.join(path)) } else { 0 };
    Some(summarize(&entries, &numstat, new_lines))
}

/// La sortie de `git status --porcelain=v1 -z` : une entrée par fichier,
/// « XY chemin » terminée par un caractère nul ; un renommage (R) ou une
/// copie (C) est suivi de l'ancien chemin, qu'on saute.
pub fn parse_status(out: &[u8]) -> Vec<Entry> {
    let mut entries = Vec::new();
    let mut fields = out.split(|b| *b == 0);
    while let Some(field) = fields.next() {
        // Au moins « XY » + espace + un caractère.
        if field.len() < 4 || field[2] != b' ' {
            continue;
        }
        let (code, path) = (&field[..2], String::from_utf8_lossy(&field[3..]).to_string());
        if code.iter().any(|c| *c == b'R' || *c == b'C') {
            fields.next(); // l'ancien chemin
        }
        entries.push(Entry { path, untracked: code == b"??" });
    }
    entries
}

/// La sortie de `git diff --numstat -z` : « ajoutées \t retirées \t chemin »
/// terminé par un nul ; « - » pour un fichier binaire ; pour un renommage, le
/// chemin est vide et suivi de l'ancien puis du nouveau chemin.
/// Chemin (le nouveau) → (ajoutées, retirées).
pub fn parse_numstat(out: &[u8]) -> HashMap<String, (u64, u64)> {
    let mut map = HashMap::new();
    let mut fields = out.split(|b| *b == 0);
    while let Some(field) = fields.next() {
        let text = String::from_utf8_lossy(field);
        let mut parts = text.splitn(3, '\t');
        let (Some(a), Some(d), Some(p)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let path = if p.is_empty() {
            fields.next(); // l'ancien chemin
            match fields.next() {
                Some(new) => String::from_utf8_lossy(new).to_string(),
                None => continue,
            }
        } else {
            p.to_string()
        };
        let n = |x: &str| x.trim().parse::<u64>().unwrap_or(0);
        map.insert(path, (n(a), n(d)));
    }
    map
}

/// Le bilan à partir des deux sorties. `new_lines` compte les lignes d'un
/// fichier nouveau (pas dans le diff de git).
pub fn summarize(entries: &[Entry], numstat: &HashMap<String, (u64, u64)>, mut new_lines: impl FnMut(&str) -> u64) -> Changes {
    let mut read_new = 0;
    let mut rows: Vec<(&str, u64, u64)> = entries
        .iter()
        .map(|e| {
            if e.untracked {
                read_new += 1;
                let lines = if read_new <= MAX_NEW_FILES { new_lines(&e.path) } else { 0 };
                (e.path.as_str(), lines, 0)
            } else {
                let (a, d) = numstat.get(&e.path).copied().unwrap_or((0, 0));
                (e.path.as_str(), a, d)
            }
        })
        .collect();
    let added = rows.iter().map(|r| r.1).sum();
    let removed = rows.iter().map(|r| r.2).sum();
    // Les noms montrés : les fichiers les plus changés d'abord.
    rows.sort_by(|x, y| (y.1 + y.2).cmp(&(x.1 + x.2)).then(x.0.cmp(y.0)));
    let names = rows.iter().take(MAX_NAMES).map(|r| file_name(r.0)).collect();
    Changes { files: entries.len(), added, removed, names }
}

/// « src/modules/agents.rs » → « agents.rs » (un dossier nouveau finit par « / »).
fn file_name(path: &str) -> String {
    let name = path.trim_end_matches('/').rsplit('/').next().unwrap_or(path);
    let clean: String = name.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    if clean.chars().count() <= 60 {
        return clean;
    }
    let mut cut: String = clean.chars().take(59).collect();
    cut.push('…');
    cut
}

/// Le nombre de lignes d'un petit fichier texte (0 : trop gros, binaire,
/// lien, illisible). Comme git : une dernière ligne sans retour compte.
fn count_lines(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_file() || meta.len() > MAX_NEW_BYTES {
        return 0;
    }
    let mut bytes = Vec::new();
    let Ok(file) = std::fs::File::open(path) else { return 0 };
    if file.take(MAX_NEW_BYTES).read_to_end(&mut bytes).is_err() {
        return 0;
    }
    lines_in(&bytes)
}

/// Les lignes d'un contenu (0 s'il a l'air binaire : un caractère nul au début).
fn lines_in(bytes: &[u8]) -> u64 {
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return 0;
    }
    let newlines = bytes.iter().filter(|b| **b == b'\n').count() as u64;
    newlines + u64::from(bytes.last().is_some_and(|b| *b != b'\n'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_lines_are_understood() {
        // Modifié, ajouté, renommé (suivi de l'ancien nom), nouveau, supprimé.
        let out = b" M src/main.rs\0A  docs/new.md\0R  src/b.rs\0src/a.rs\0?? notes/idee.txt\0 D old.txt\0";
        let e = parse_status(out);
        let paths: Vec<&str> = e.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(paths, ["src/main.rs", "docs/new.md", "src/b.rs", "notes/idee.txt", "old.txt"]);
        assert_eq!(e.iter().filter(|x| x.untracked).count(), 1);
        // Des espaces et des accents dans un nom : rien n'est échappé avec -z.
        assert_eq!(parse_status(" M Mes docs/été.md\0".as_bytes())[0].path, "Mes docs/été.md");
        // Sortie vide ou abîmée : rien, sans paniquer.
        assert!(parse_status(b"").is_empty());
        assert!(parse_status(b"XY\0\0\0R").is_empty());
    }

    #[test]
    fn numstat_lines_are_understood() {
        let out = b"10\t2\tsrc/main.rs\0-\t-\timg/logo.png\0" as &[u8];
        let rename = b"3\t1\t\0src/a.rs\0src/b.rs\0" as &[u8];
        let map = parse_numstat(&[out, rename].concat());
        assert_eq!(map["src/main.rs"], (10, 2));
        assert_eq!(map["img/logo.png"], (0, 0)); // binaire
        assert_eq!(map["src/b.rs"], (3, 1)); // le nouveau nom
        assert!(!map.contains_key("src/a.rs"));
        assert!(parse_numstat(b"n'importe quoi\0\t\0").is_empty());
    }

    #[test]
    fn summary_counts_and_names_the_biggest() {
        let entries = parse_status(b" M src/main.rs\0 M README.md\0?? src/neuf.rs\0 M docs/a.md\0");
        let numstat = parse_numstat(b"100\t10\tsrc/main.rs\x001\t1\tREADME.md\x005\t0\tdocs/a.md\x00");
        let c = summarize(&entries, &numstat, |p| if p == "src/neuf.rs" { 40 } else { 0 });
        assert_eq!((c.files, c.added, c.removed), (4, 146, 11));
        assert_eq!(c.names, ["main.rs", "neuf.rs", "a.md"]);
        assert_eq!(summarize(&[], &HashMap::new(), |_| 0), Changes::default());
    }

    #[test]
    fn new_files_lines() {
        assert_eq!(lines_in(b"a\nb\nc"), 3);
        assert_eq!(lines_in(b"a\nb\n"), 2);
        assert_eq!(lines_in(b""), 0);
        assert_eq!(lines_in(b"PNG\0\0data\n"), 0); // binaire
        assert_eq!(file_name("src/agents.rs"), "agents.rs");
        assert_eq!(file_name("nouveau-dossier/"), "nouveau-dossier");
    }

    #[test]
    fn repo_root_is_found_but_never_the_home_folder() {
        let base = std::env::temp_dir().join(format!("ondine-git-root-{}", std::process::id()));
        let sub = base.join("projet").join("src");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::create_dir_all(base.join("projet").join(".git")).unwrap();
        assert_eq!(repo_root(&sub, Path::new("/nulle-part")), Some(base.join("projet")));
        // Le dossier utilisateur lui-même versionné : pas de bilan.
        assert_eq!(repo_root(&sub, &base.join("projet")), None);
        assert_eq!(repo_root(&base, Path::new("/nulle-part")), None);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// De bout en bout avec le vrai git (si la machine en a un).
    #[test]
    fn real_git_repository() {
        let Some(git) = std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join(if cfg!(windows) { "git.exe" } else { "git" })).find(|p| p.is_file())) else {
            return;
        };
        let dir = std::env::temp_dir().join(format!("ondine-git-bilan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |args: &[&str]| {
            let mut all = vec!["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];
            all.extend_from_slice(args);
            devtools::run_with_timeout(&git, &all, &dir, &[], Duration::from_secs(20))
        };
        if g(&["init", "-q"]).is_err() {
            return;
        }
        std::fs::write(dir.join("a.txt"), "un\ndeux\ntrois\n").unwrap();
        // Dépôt sans commit : les fichiers sont là, sans lignes retirées.
        let c = changes(&git, &dir, &dir).unwrap();
        assert_eq!((c.files, c.added, c.removed), (1, 3, 0));
        g(&["add", "a.txt"]).unwrap();
        g(&["commit", "-q", "-m", "départ"]).unwrap();
        assert_eq!(changes(&git, &dir, &dir).unwrap(), Changes::default());
        // Une ligne changée, un fichier nouveau de 2 lignes.
        std::fs::write(dir.join("a.txt"), "un\nDEUX\ntrois\n").unwrap();
        std::fs::write(dir.join("b.txt"), "x\ny\n").unwrap();
        let c = changes(&git, &dir, &dir).unwrap();
        assert_eq!((c.files, c.added, c.removed), (2, 3, 1));
        assert_eq!(c.names, ["a.txt", "b.txt"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
