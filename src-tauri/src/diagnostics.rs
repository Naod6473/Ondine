// Diagnostic : signaler un problème en un clic, et ce qu'Ondine consomme.
//
// 1. « Signaler un problème » (Réglages → Général → À propos) ouvre dans le
//    navigateur une nouvelle issue GitHub préremplie : la version d'Ondine,
//    Windows, et les 40 dernières lignes du journal, chemins personnels masqués
//    (C:\Users\simon → C:\Users\…). RIEN n'est envoyé par Ondine : c'est le
//    navigateur qui ouvre la page, et la personne relit tout sur GitHub avant de
//    cliquer sur « Submit ». Le formulaire est .github/ISSUE_TEMPLATE/bug.yml :
//    GitHub remplit ses champs à partir des paramètres de l'adresse qui portent
//    leur `id` (version, windows, journal).
//
// 2. La sobriété : la mémoire et le processeur utilisés par Ondine elle-même
//    (son processus + les processus WebView2 qu'il a lancés), lus avec sysinfo,
//    seulement quand la fenêtre de réglages les demande (toutes les 2 s, quand
//    elle est visible).

use crate::sync::LockExt;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, State, Window};

use crate::platform;
use crate::services::log;
use crate::Shared;

// ── Signaler un problème ─────────────────────────────────────────────────────

/// Le formulaire de bug du dépôt.
const ISSUE_URL: &str = "https://github.com/Naod6473/Ondine/issues/new?template=bug.yml";
/// Combien de lignes du journal on joint (les plus récentes).
const LOG_LINES: usize = 40;
/// Une ligne de journal plus longue est coupée (un message d'erreur à rallonge).
const MAX_LINE_CHARS: usize = 240;
/// Longueur maximale de l'adresse. Windows (ShellExecute, qui passe l'adresse
/// au navigateur) refuse ou coupe les adresses de plus de 2083 caractères
/// (INTERNET_MAX_URL_LENGTH) : on reste en dessous. Si les 40 lignes ne
/// tiennent pas, on garde les plus récentes et on le dit dans le champ.
const MAX_URL_LEN: usize = 2000;

/// Encode un texte pour un paramètre d'adresse : lettres, chiffres et quelques
/// signes restent tels quels, l'espace devient « + », tout le reste « %XX »
/// (octet par octet de l'UTF-8).
pub fn encode_param(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'(' | b')' | b'*' | b'!' | b',' | b':' | b'/' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Un séparateur de chemin Windows ou Unix.
fn is_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// Masque le nom d'utilisateur dans les chemins : « C:\Users\simon\Documents »
/// devient « C:\Users\…\Documents » (aussi avec des / ou des \\ doublés, et
/// « /home/simon » sous Linux). `home` (le dossier personnel, s'il est ailleurs
/// que dans Users) et `names` (nom d'utilisateur, nom du PC) sont masqués
/// partout où ils apparaissent en mot entier.
pub fn mask_personal(text: &str, home: Option<&str>, names: &[&str]) -> String {
    let mut out = text.to_string();
    // 1. Un dossier personnel hors de C:\Users (profil déplacé) : remplacé en entier.
    if let Some(home) = home.map(str::trim).filter(|h| h.len() > 3) {
        out = replace_ignore_case(&out, home, "%USERPROFILE%");
    }
    // 2. …\Users\<nom> et /home/<nom>.
    out = mask_after(&out, "users");
    out = mask_after(&out, "home");
    // 3. Le nom d'utilisateur et le nom du PC, s'ils apparaissent ailleurs.
    for name in names.iter().map(|n| n.trim()).filter(|n| n.chars().count() >= 3) {
        out = replace_word_ignore_case(&out, name, "…");
    }
    out
}

/// Remplace le segment qui suit « <sep>dir<sep> » par « … ».
fn mask_after(text: &str, dir: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_ascii_lowercase()).collect();
    let pat: Vec<char> = dir.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        // « \Users » à la racine d'un disque (« C:\Users ») ou « /home » au
        // début d'un chemin, pas « …\Documents\home ».
        let at_root = i == 1 || (i >= 2 && !chars[i - 2].is_alphanumeric());
        let starts = i > 0 && is_sep(chars[i - 1]) && at_root && lower[i..].starts_with(&pat);
        let after = i + pat.len();
        if !starts || after >= chars.len() || !is_sep(chars[after]) {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        // « Users » + les séparateurs qui suivent (\ ou \\ ou /).
        let mut j = after;
        while j < chars.len() && is_sep(chars[j]) {
            j += 1;
        }
        out.extend(&chars[i..j]);
        // Le nom : jusqu'au prochain séparateur (il peut contenir des espaces :
        // « Jean Dupont »). S'il n'y a pas de séparateur après, le chemin finit
        // là : on s'arrête au premier espace.
        let stop = |c: char| is_sep(c) || matches!(c, '"' | '\'' | '\n' | '\r' | '\t' | '<' | '>' | '|' | ';' | ',' | ')');
        let mut k = j;
        while k < chars.len() && !stop(chars[k]) && k - j < 64 {
            k += 1;
        }
        if !(k < chars.len() && is_sep(chars[k])) {
            k = j;
            while k < chars.len() && !stop(chars[k]) && !chars[k].is_whitespace() {
                k += 1;
            }
        }
        if k > j {
            out.push('…');
        }
        i = k;
    }
    out
}

fn replace_ignore_case(text: &str, needle: &str, with: &str) -> String {
    let lower = text.to_lowercase();
    let needle = needle.to_lowercase();
    // to_lowercase peut changer la longueur de certains caractères : dans ce
    // cas (rare), on ne touche à rien plutôt que de couper au mauvais endroit.
    if lower.len() != text.len() || needle.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = 0;
    while let Some(pos) = lower[rest..].find(&needle) {
        out.push_str(&text[rest..rest + pos]);
        out.push_str(with);
        rest += pos + needle.len();
    }
    out.push_str(&text[rest..]);
    out
}

fn replace_word_ignore_case(text: &str, word: &str, with: &str) -> String {
    let lower = text.to_lowercase();
    let word = word.to_lowercase();
    if lower.len() != text.len() || word.is_empty() {
        return text.to_string();
    }
    let is_word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-');
    let mut out = String::with_capacity(text.len());
    let mut rest = 0;
    let mut from = 0;
    while let Some(pos) = lower[from..].find(&word) {
        let start = from + pos;
        let end = start + word.len();
        let before = text[..start].chars().next_back();
        let after = text[end..].chars().next();
        if !is_word(before) && !is_word(after) {
            out.push_str(&text[rest..start]);
            out.push_str(with);
            rest = end;
        }
        from = end;
    }
    out.push_str(&text[rest..]);
    out
}

/// Les `n` dernières lignes non vides d'un texte, coupées si trop longues.
pub fn last_lines(text: &str, n: usize) -> Vec<String> {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..]
        .iter()
        .map(|l| {
            if l.chars().count() > MAX_LINE_CHARS {
                format!("{}…", l.chars().take(MAX_LINE_CHARS).collect::<String>())
            } else {
                l.to_string()
            }
        })
        .collect()
}

/// L'adresse de la nouvelle issue. `lines` : le journal déjà masqué, du plus
/// ancien au plus récent. Si tout ne tient pas dans `max_len`, on enlève les
/// lignes les plus anciennes et on le signale en tête du champ.
pub fn issue_url(version: &str, windows: &str, lines: &[String], max_len: usize) -> String {
    let base = format!("{ISSUE_URL}&version={}&windows={}", encode_param(version), encode_param(windows));
    let mut skip = 0;
    loop {
        let kept = &lines[skip..];
        let mut journal = String::new();
        if skip > 0 {
            journal.push_str(&format!("[… {skip} ligne(s) plus ancienne(s) retirée(s) pour la longueur de l'adresse]\n"));
        }
        journal.push_str(&kept.join("\n"));
        let url = if journal.is_empty() { base.clone() } else { format!("{base}&journal={}", encode_param(&journal)) };
        if url.len() <= max_len || kept.is_empty() {
            // Même sans journal, l'adresse de base est courte (version, Windows).
            return if url.len() <= max_len { url } else { base };
        }
        skip += 1;
    }
}

/// Le texte du journal : le fichier courant, complété par le précédent
/// (ondine.log.1) s'il vient d'être renouvelé.
fn read_log_tail() -> Vec<String> {
    let dir = log::dir();
    let current = std::fs::read_to_string(dir.join("ondine.log")).unwrap_or_default();
    let mut lines = last_lines(&current, LOG_LINES);
    if lines.len() < LOG_LINES {
        let older = std::fs::read_to_string(dir.join("ondine.log.1")).unwrap_or_default();
        let mut before = last_lines(&older, LOG_LINES - lines.len());
        before.append(&mut lines);
        lines = before;
    }
    lines
}

/// « Windows 11 Pro (26100) · écran à 125 % ».
fn windows_text(app: &AppHandle, screen_pref: &str) -> String {
    let os = System::long_os_version().unwrap_or_else(|| "Windows".into());
    let build = System::kernel_version().map(|b| format!(" (build {b})")).unwrap_or_default();
    let scale = crate::island::screen_info(app, screen_pref).scale;
    format!("{os}{build} · écran à {} %", (scale * 100.0).round())
}

/// Bouton « Signaler un problème » : ouvre l'issue préremplie dans le navigateur.
#[tauri::command]
pub fn bug_report_open(app: AppHandle, shared: State<Shared>) -> Result<(), String> {
    let pref = shared.settings.locked().general.screen.clone();
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok();
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    let host = std::env::var("COMPUTERNAME").unwrap_or_default();
    let names = [user.as_str(), host.as_str()];
    let mask = |s: &str| mask_personal(s, home.as_deref(), &names);

    let lines: Vec<String> = read_log_tail().iter().map(|l| mask(l)).collect();
    let windows = mask(&windows_text(&app, &pref));
    let url = issue_url(env!("CARGO_PKG_VERSION"), &windows, &lines, MAX_URL_LEN);
    // Rien du contenu dans le journal : seulement le fait.
    log::info(format!("rapport de bug : page GitHub ouverte dans le navigateur ({} caractères)", url.len()));
    platform::shell_open(&url)
}

// ── Ce qu'Ondine consomme ─────────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelfUsage {
    /// Mémoire de travail additionnée (octets). Un peu surestimée : les
    /// processus WebView2 partagent une partie de leur mémoire.
    pub memory_bytes: u64,
    /// Part du processeur de tout le PC (0-100), ou None à la première mesure
    /// (il faut deux mesures espacées pour un pourcentage).
    pub cpu_percent: Option<f32>,
    /// Combien de processus comptés (Ondine + WebView2).
    pub processes: usize,
}

/// La mesure précédente : sysinfo calcule le processeur entre deux lectures.
static SAMPLER: Mutex<Option<(System, Instant)>> = Mutex::new(None);

/// `root` et tous ses descendants, d'après la liste (pid, parent).
pub fn process_tree(root: Pid, links: &[(Pid, Option<Pid>)]) -> HashSet<Pid> {
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, parent) in links {
        if let Some(parent) = parent {
            if parent != pid {
                children.entry(*parent).or_default().push(*pid);
            }
        }
    }
    let mut tree = HashSet::from([root]);
    let mut todo = vec![root];
    while let Some(p) = todo.pop() {
        for c in children.get(&p).map(Vec::as_slice).unwrap_or(&[]) {
            if tree.insert(*c) {
                todo.push(*c);
            }
        }
    }
    tree
}

/// Mémoire et processeur d'Ondine. Ne mesure rien si la fenêtre qui demande
/// n'est pas visible (réglages fermés ou réduits).
#[tauri::command]
pub fn self_usage(window: Window) -> Option<SelfUsage> {
    let visible = window.is_visible().unwrap_or(true) && !window.is_minimized().unwrap_or(false);
    if !visible {
        return None;
    }
    let me = sysinfo::get_current_pid().ok()?;
    let mut guard = SAMPLER.locked();
    let (sys, last) = guard.get_or_insert_with(|| (System::new(), Instant::now()));
    // Une mesure vieille de plus de 5 s ne donne qu'une moyenne trompeuse.
    let fresh = last.elapsed().as_secs_f32() <= 5.0 && !sys.processes().is_empty();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_memory().with_cpu());
    *last = Instant::now();

    let links: Vec<(Pid, Option<Pid>)> = sys.processes().iter().map(|(pid, p)| (*pid, p.parent())).collect();
    let tree = process_tree(me, &links);
    let mut memory = 0;
    let mut cpu = 0.0;
    for pid in &tree {
        if let Some(p) = sys.process(*pid) {
            memory += p.memory();
            cpu += p.cpu_usage();
        }
    }
    // sysinfo compte 100 % par cœur : on ramène à la part de tout le PC.
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
    Some(SelfUsage { memory_bytes: memory, cpu_percent: fresh.then_some((cpu / cores).clamp(0.0, 100.0)), processes: tree.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_windows_user_folder() {
        let m = |s: &str| mask_personal(s, None, &[]);
        assert_eq!(m(r"ouvre C:\Users\simon\Documents\a.txt"), r"ouvre C:\Users\…\Documents\a.txt");
        assert_eq!(m(r"C:\\Users\\simon\\AppData"), r"C:\\Users\\…\\AppData");
        assert_eq!(m("c:/users/Simon/Desktop"), "c:/users/…/Desktop");
        assert_eq!(m(r"dans C:\Users\Jean Dupont\Images ok"), r"dans C:\Users\…\Images ok");
        // Fin du chemin juste après le nom : on s'arrête au premier espace.
        assert_eq!(m(r"profil C:\Users\simon trouvé"), r"profil C:\Users\… trouvé");
        assert_eq!(m("/home/simon/.config"), "/home/…/.config");
        // Rien à masquer.
        assert_eq!(m("les Users sont contents"), "les Users sont contents");
        assert_eq!(m(r"C:\Program Files\Ondine"), r"C:\Program Files\Ondine");
        assert_eq!(m(r"D:\Projets\home\site"), r"D:\Projets\home\site");
    }

    #[test]
    fn masks_home_and_names() {
        let out = mask_personal(r"D:\Profils\simon\x et PC-SIMON connecté (simon)", Some(r"D:\Profils\simon"), &["simon", "PC-SIMON"]);
        assert_eq!(out, r"%USERPROFILE%\x et … connecté (…)");
        // Un nom trop court n'est pas masqué (il couperait des mots au hasard).
        assert_eq!(mask_personal("al va bien", None, &["al"]), "al va bien");
        // Mot entier seulement.
        assert_eq!(mask_personal("simonette", None, &["simon"]), "simonette");
    }

    #[test]
    fn encodes_url_params() {
        assert_eq!(encode_param("a b&c=d#e"), "a+b%26c%3Dd%23e");
        assert_eq!(encode_param("é\n\\"), "%C3%A9%0A%5C");
        assert_eq!(encode_param("1.0.0"), "1.0.0");
    }

    #[test]
    fn keeps_last_lines() {
        let text = (1..=50).map(|i| format!("ligne {i}")).collect::<Vec<_>>().join("\n");
        let lines = last_lines(&text, 40);
        assert_eq!(lines.len(), 40);
        assert_eq!(lines[0], "ligne 11");
        assert_eq!(lines[39], "ligne 50");
        let long = "x".repeat(1000);
        assert_eq!(last_lines(&long, 5)[0].chars().count(), MAX_LINE_CHARS + 1);
    }

    #[test]
    fn issue_url_is_bounded() {
        let lines: Vec<String> = (1..=40).map(|i| format!("12:00:{i:02} INFO  [app] message numéro {i} un peu long pour remplir")).collect();
        let url = issue_url("1.2.3", "Windows 11", &lines, MAX_URL_LEN);
        assert!(url.len() <= MAX_URL_LEN, "{}", url.len());
        assert!(url.starts_with("https://github.com/Naod6473/Ondine/issues/new?template=bug.yml&version=1.2.3&windows=Windows+11&journal="));
        // Les plus récentes sont gardées, et on dit combien manquent.
        assert!(url.contains("num%C3%A9ro+40"));
        assert!(url.contains("plus+ancienne"));
        // Tout tient : rien n'est retiré.
        let short = issue_url("1.2.3", "W", &lines[..3], 10_000);
        assert!(!short.contains("ancienne"));
        assert!(short.contains("num%C3%A9ro+1+"));
        // Journal vide : pas de champ journal.
        assert!(!issue_url("1", "W", &[], 10_000).contains("journal"));
    }

    #[test]
    fn finds_process_tree() {
        let p = Pid::from_u32;
        let links = vec![
            (p(1), None),
            (p(10), Some(p(1))),   // Ondine
            (p(11), Some(p(10))),  // WebView2 (navigateur)
            (p(12), Some(p(11))),  // WebView2 (rendu)
            (p(13), Some(p(11))),  // WebView2 (GPU)
            (p(20), Some(p(1))),   // un autre programme
            (p(21), Some(p(20))),
        ];
        let tree = process_tree(p(10), &links);
        assert_eq!(tree, HashSet::from([p(10), p(11), p(12), p(13)]));
    }
}
