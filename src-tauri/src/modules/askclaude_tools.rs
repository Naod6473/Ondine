// « Parler à Ondine » : ses outils de fichiers, proposés à l'IA (Claude, GPT
// ou Gemini, voir askclaude_providers.rs) quand le réglage « Ondine peut
// chercher et créer des fichiers » est activé.
//
//   - chercher_fichiers : cherche par le NOM dans Documents, Bureau,
//     Téléchargements, Images, le dossier d'Ondine et les fichiers récents.
//     Les noms trouvés partent vers l'IA sans demander (choix de Simon), jamais
//     leur contenu. Chaque fichier reçoit un numéro : l'IA ne voit ni ne donne
//     jamais un chemin, seulement ce numéro ;
//   - lire_fichier : le texte d'un fichier trouvé, APRÈS votre accord (askclaude.rs) ;
//   - creer_fichier : un fichier texte dans le dossier d'Ondine (réglable,
//     Documents\Ondine par défaut), APRÈS votre accord ; jamais écrasé, jamais
//     un programme (extensions de texte seulement) ;
//   - proposer_fichier : une carte « Ouvrir / Montrer » dans la conversation ;
//     rien ne s'ouvre sans votre clic, et un programme n'est jamais lancé.
//
// Les dossiers exclus (Réglages → Confidentialité) sont sautés pendant la
// recherche, et chaque chemin repasse par `check_path` avant d'être lu,
// montré ou ouvert.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use super::askclaude_providers::Tool;
use super::launcher;
use super::ModuleContext;
use crate::platform;
use crate::services::{files, privacy, search};

pub const SEARCH: &str = "chercher_fichiers";
pub const READ: &str = "lire_fichier";
pub const CREATE: &str = "creer_fichier";
pub const PROPOSE: &str = "proposer_fichier";

/// Résultats renvoyés à l'IA par recherche.
const MAX_RESULTS: usize = 12;
/// Garde-fous de la recherche : nombre d'entrées vues, profondeur, durée.
const MAX_VISITED: usize = 40_000;
const MAX_DEPTH: usize = 7;
const SEARCH_BUDGET: Duration = Duration::from_millis(2500);
/// Dossiers jamais parcourus (techniques, énormes, sans documents à soi).
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "appdata", "$recycle.bin", "target", "__pycache__", ".venv", "venv", ".cache", "packages"];
/// Un fichier créé par Ondine : du texte, 200 Ko au plus.
pub const MAX_CREATE_BYTES: usize = 200 * 1024;
const MAX_NAME_CHARS: usize = 80;
/// Ce qu'Ondine peut créer : des formats de texte qui ne lancent rien.
pub const CREATE_EXTENSIONS: &[&str] = &["txt", "md", "csv", "tsv", "json", "html", "htm", "xml", "yml", "yaml", "ini", "log", "css", "svg"];

/// Les outils, tels que l'IA les voit.
pub fn tools() -> Vec<Tool> {
    vec![
        Tool {
            name: SEARCH,
            description: "Cherche des fichiers sur le PC de la personne, par leur nom (Documents, Bureau, Téléchargements, Images, dossier d'Ondine, fichiers récents). Renvoie au plus 12 fichiers avec un numéro, leur dossier, leur taille et leur âge. Ne lit pas leur contenu.",
            schema: json!({
                "type": "object",
                "properties": { "requete": { "type": "string", "description": "Un ou quelques mots du nom du fichier, par exemple « facture edf » ou « cv »." } },
                "required": ["requete"],
            }),
        },
        Tool {
            name: READ,
            description: "Lit le texte d'un fichier trouvé par chercher_fichiers (fichiers texte et code, 100 Ko au plus). La personne doit accepter : elle peut refuser.",
            schema: json!({
                "type": "object",
                "properties": { "numero": { "type": "integer", "description": "Le numéro du fichier donné par chercher_fichiers." } },
                "required": ["numero"],
            }),
        },
        Tool {
            name: CREATE,
            description: "Crée un fichier texte (txt, md, csv, json, html…) dans le dossier d'Ondine de la personne, seulement quand elle veut un fichier (pour une note de l'île, utiliser creer_note). Un fichier du même nom n'est jamais écrasé. La personne voit le contenu et doit accepter.",
            schema: json!({
                "type": "object",
                "properties": {
                    "nom": { "type": "string", "description": "Le nom du fichier avec son extension, sans dossier, par exemple « liste-de-courses.md »." },
                    "contenu": { "type": "string", "description": "Le texte complet du fichier." },
                },
                "required": ["nom", "contenu"],
            }),
        },
        Tool {
            name: PROPOSE,
            description: "Montre à la personne un fichier trouvé (ou créé), avec des boutons pour l'ouvrir ou le voir dans l'Explorateur. Rien ne s'ouvre sans son clic.",
            schema: json!({
                "type": "object",
                "properties": { "numero": { "type": "integer", "description": "Le numéro du fichier." } },
                "required": ["numero"],
            }),
        },
    ]
}

/// Les fichiers déjà donnés à l'IA, pour toute la conversation : le numéro
/// d'un fichier est son rang + 1.
#[derive(Default)]
pub struct Found {
    paths: Vec<PathBuf>,
}

impl Found {
    /// Le numéro de `path` (le même s'il a déjà été donné).
    pub fn add(&mut self, path: PathBuf) -> u64 {
        if let Some(i) = self.paths.iter().position(|p| *p == path) {
            return i as u64 + 1;
        }
        self.paths.push(path);
        self.paths.len() as u64
    }

    pub fn get(&self, id: u64) -> Option<&PathBuf> {
        usize::try_from(id).ok().and_then(|i| i.checked_sub(1)).and_then(|i| self.paths.get(i))
    }

    pub fn clear(&mut self) {
        self.paths.clear();
    }
}

/// Le dossier où Ondine crée ses fichiers : le réglage, sinon Documents\Ondine.
pub fn folder(ctx: &ModuleContext) -> Option<PathBuf> {
    let custom = ctx.settings().get("filesFolder").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if !custom.is_empty() && Path::new(&custom).is_absolute() {
        return Some(PathBuf::from(custom));
    }
    platform::documents_dir().map(|d| d.join("Ondine"))
}

/// Où l'on cherche : les dossiers personnels, et celui d'Ondine.
fn roots(ctx: &ModuleContext) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let candidates = [platform::documents_dir(), platform::desktop_dir(), platform::downloads_dir(), platform::pictures_dir(), folder(ctx)];
    for dir in candidates.into_iter().flatten() {
        let Ok(real) = std::fs::canonicalize(&dir) else { continue };
        let real = privacy::simplify(real);
        // Un dossier déjà dans un autre (Ondine dans Documents) n'est pas refait.
        if !out.iter().any(|o| real.starts_with(o)) {
            out.retain(|o| !o.starts_with(&real));
            out.push(real);
        }
    }
    out
}

/// Ce que l'IA reçoit d'un fichier : son numéro, son nom, son dossier
/// (le dossier personnel abrégé en « ~ »), sa taille et son âge.
pub fn describe(id: u64, path: &Path) -> Value {
    let meta = std::fs::metadata(path).ok();
    let days = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| SystemTime::now().duration_since(t).ok()).map(|d| d.as_secs() / 86_400);
    json!({
        "numero": id,
        "nom": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "dossier": short_dir(path),
        "taille": meta.as_ref().map(|m| size_text(m.len())),
        "modifie_il_y_a_jours": days,
    })
}

/// Le dossier d'un fichier, avec le dossier personnel abrégé en « ~ ».
pub fn short_dir(path: &Path) -> String {
    let dir = path.parent().map(|p| p.display().to_string()).unwrap_or_default();
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    if !home.is_empty() && dir.to_lowercase().starts_with(&home.to_lowercase()) {
        format!("~{}", &dir[home.len()..])
    } else {
        dir
    }
}

pub fn size_text(bytes: u64) -> String {
    match bytes {
        b if b < 1024 => format!("{b} o"),
        b if b < 1024 * 1024 => format!("{} Ko", b / 1024),
        b => format!("{:.1} Mo", b as f64 / (1024.0 * 1024.0)),
    }
}

/// chercher_fichiers : les meilleurs noms, numérotés dans `found`.
pub fn search_files(ctx: &ModuleContext, found: &mut Found, raw: &str) -> Value {
    let query = search::normalize(&raw.chars().take(100).collect::<String>());
    if query.chars().count() < 2 {
        return json!({ "erreur": "recherche trop courte (2 lettres au moins)" });
    }
    let settings = {
        use crate::sync::LockExt;
        use tauri::Manager;
        ctx.app.state::<crate::Shared>().settings.locked().clone()
    };
    let excluded = |p: &Path| privacy::is_excluded(&settings, p);
    let mut hits = walk(&roots(ctx), &query, Instant::now() + SEARCH_BUDGET, &excluded);
    // Les fichiers récents (raccourcis du dossier « Récent ») : un petit bonus.
    if let Some(dir) = launcher::recent_dir() {
        for path in launcher::recent_files(&dir) {
            let score = name_score(&path, &query);
            if score > 0 && path.is_file() && !excluded(&path) && !launcher::is_executable(&path) {
                hits.push((score + 5, modified(&path), path));
            }
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let mut seen = Vec::new();
    let mut items = Vec::new();
    for (_, _, path) in hits {
        if items.len() >= MAX_RESULTS {
            break;
        }
        if seen.contains(&path) {
            continue;
        }
        // Dernière vérification (dossiers exclus, chemin réel).
        let Ok(real) = ctx.check_path(&path.display().to_string()) else { continue };
        seen.push(path);
        let id = found.add(real.clone());
        items.push(describe(id, &real));
    }
    if items.is_empty() {
        json!({ "fichiers": [], "note": "aucun fichier trouvé avec ce nom" })
    } else {
        json!({ "fichiers": items })
    }
}

fn name_score(path: &Path, query: &str) -> u32 {
    path.file_name().map(|n| search::score(&n.to_string_lossy(), query)).unwrap_or(0)
}

fn modified(path: &Path) -> SystemTime {
    std::fs::metadata(path).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH)
}

/// Parcourt `roots` (en largeur, sans suivre les liens) et note les fichiers
/// dont le nom correspond. S'arrête à `deadline` ou après MAX_VISITED entrées.
fn walk(roots: &[PathBuf], query: &str, deadline: Instant, excluded: &dyn Fn(&Path) -> bool) -> Vec<(u32, SystemTime, PathBuf)> {
    let mut hits = Vec::new();
    let mut queue: std::collections::VecDeque<(PathBuf, usize)> = roots.iter().map(|r| (r.clone(), 0)).collect();
    let mut visited = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        if excluded(&dir) {
            continue;
        }
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        for entry in read.flatten() {
            visited += 1;
            if visited > MAX_VISITED || Instant::now() > deadline {
                return hits;
            }
            let Ok(kind) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            if kind.is_symlink() || name.starts_with('.') || name.starts_with('~') {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth + 1 < MAX_DEPTH && !SKIP_DIRS.contains(&name.to_lowercase().as_str()) {
                    queue.push_back((path, depth + 1));
                }
                continue;
            }
            if launcher::is_executable(&path) {
                continue;
            }
            let score = search::score(&name, query);
            if score > 0 {
                hits.push((score, modified(&path), path));
            }
        }
    }
    hits
}

/// Vérifie le nom et le contenu d'un fichier à créer ; renvoie le nom nettoyé.
pub fn check_new_file(name: &str, content: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err("nom de fichier vide ou trop long".into());
    }
    if name.starts_with('.') || name.ends_with('.') || name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) {
        return Err(format!("nom de fichier refusé : « {name} »"));
    }
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_uppercase()).unwrap_or_default();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str()) || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4);
    if reserved {
        return Err(format!("nom réservé par Windows : « {name} »"));
    }
    let ext = Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !CREATE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Ondine ne crée que des fichiers texte ({}) : « .{ext} » refusé", CREATE_EXTENSIONS.join(", ")));
    }
    if content.len() > MAX_CREATE_BYTES {
        return Err("contenu trop long (200 Ko au plus)".into());
    }
    Ok(name.to_string())
}

/// creer_fichier, une fois accepté : écrit dans le dossier d'Ondine, sans
/// jamais écraser (« nom (2).md »). Renvoie le chemin créé.
pub fn create_file(ctx: &ModuleContext, name: &str, content: &str) -> Result<PathBuf, String> {
    let name = check_new_file(name, content)?;
    let dir = folder(ctx).ok_or("dossier Documents introuvable")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("impossible de créer le dossier d'Ondine : {e}"))?;
    let dir = ctx.check_path(&dir.display().to_string())?; // dossier exclu ?
    let dest = files::unique_dest(&dir, std::ffi::OsStr::new(&name));
    // create_new : si un fichier est apparu entre-temps, on n'écrase toujours pas.
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| format!("impossible de créer le fichier : {e}"))?;
    f.write_all(content.as_bytes()).map_err(|e| format!("impossible d'écrire le fichier : {e}"))?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn found_numbers_are_stable() {
        let mut f = Found::default();
        assert_eq!(f.add(PathBuf::from("/a")), 1);
        assert_eq!(f.add(PathBuf::from("/b")), 2);
        assert_eq!(f.add(PathBuf::from("/a")), 1);
        assert_eq!(f.get(2), Some(&PathBuf::from("/b")));
        assert_eq!(f.get(0), None);
        assert_eq!(f.get(3), None);
    }

    #[test]
    fn new_file_names() {
        assert_eq!(check_new_file(" courses.md ", "x"), Ok("courses.md".into()));
        assert!(check_new_file("rapport.csv", "a;b").is_ok());
        for bad in ["", "../x.md", "a/b.txt", "c:\\x.txt", "x.exe", "x.bat", "x.js", "x.ps1", "sans-extension", ".cache.txt", "x.txt.", "CON.txt", "com1.md", "a?b.txt"] {
            assert!(check_new_file(bad, "x").is_err(), "{bad}");
        }
        assert!(check_new_file("gros.txt", &"a".repeat(MAX_CREATE_BYTES + 1)).is_err());
    }

    #[test]
    fn search_walks_names_only() {
        let root = std::env::temp_dir().join(format!("ondine-tools-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Factures/2026")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::create_dir_all(root.join("Secret")).unwrap();
        std::fs::write(root.join("Factures/2026/Facture EDF octobre.pdf"), "x").unwrap();
        std::fs::write(root.join("Factures/devis.txt"), "facture dedans, mais pas dans le nom").unwrap();
        std::fs::write(root.join("node_modules/x/facture.js"), "x").unwrap();
        std::fs::write(root.join("Secret/facture-secrete.txt"), "x").unwrap();
        std::fs::write(root.join("facture.exe"), "x").unwrap();
        let secret = root.join("Secret");
        let hits = walk(std::slice::from_ref(&root), "facture", Instant::now() + Duration::from_secs(5), &|p: &Path| p == secret);
        let names: Vec<String> = hits.iter().map(|h| h.2.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["Facture EDF octobre.pdf".to_string()]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn sizes() {
        assert_eq!(size_text(500), "500 o");
        assert_eq!(size_text(2048), "2 Ko");
        assert_eq!(size_text(3 * 1024 * 1024), "3.0 Mo");
    }
}
