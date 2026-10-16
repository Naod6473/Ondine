// « Qu'est-ce qui remplit mon disque ? » (module Système, NF16).
//
// 1. L'analyse : un fil à part parcourt un dossier (souvent la racine d'un
//    disque, « C:\ ») et additionne la place que prend chaque sous-dossier.
//    - Rapide : `read_dir` donne sous Windows la taille et les attributs de
//      chaque fichier sans l'ouvrir. On ne suit jamais un lien ni une
//      jonction (« Documents and Settings », dossiers montés…) : rien n'est
//      compté deux fois et on ne tourne jamais en rond.
//    - Taille sur le disque « raisonnable » : arrondie à la grappe de 4 Ko,
//      0 pour un fichier OneDrive resté en ligne, taille compressée pour un
//      fichier compressé (platform/diskuse.rs). Les liens physiques (WinSxS)
//      sont comptés à chaque nom : c'est ce que fait aussi l'Explorateur.
//    - Un dossier fermé (« System Volume Information ») est compté comme
//      « ignoré », sans erreur. Un dossier exclu (Confidentialité) n'est ni
//      lu ni montré.
//    - Mémoire bornée : un nœud par dossier jusqu'à KEEP_DEPTH niveaux et
//      MAX_NODES dossiers au plus ; au-delà, les octets sont ajoutés au
//      dernier dossier gardé (« autres sous-dossiers »). Au-delà de
//      MAX_DEPTH niveaux, on ne descend plus.
//    - Progressive : toutes les TICK, `system.disk-scan` {job, done, bytes,
//      files} ; le front redemande alors la vue du dossier affiché
//      (`disk_view`), qui se remplit au fur et à mesure.
//    - Annulable : un drapeau lu entre deux dossiers. Une nouvelle analyse
//      arrête la précédente. Le module coupé : l'analyse s'arrête.
//
// 2. Le nettoyage proposé, et rien d'autre (chaque ligne est confirmée côté
//    front) :
//    - vider la Corbeille (SHEmptyRecycleBinW) ;
//    - les fichiers temporaires (%TEMP%) de plus de 24 h : un fichier ouvert
//      ne se laisse pas supprimer, il est sauté ; les dossiers vides et
//      anciens sont retirés ;
//    - le cache des miniatures de l'Explorateur (thumbcache_*.db, Windows le
//      refait) : ceux que l'Explorateur tient ouverts sont sautés ;
//    - les vieux téléchargements (plus de N jours, réglage oldDownloadsDays) :
//      une liste à cocher, ENVOYÉS À LA CORBEILLE (jamais supprimés), avec
//      « Annuler » quelques secondes.
//    Les dossiers exclus (Confidentialité) ne sont jamais touchés.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::platform::diskuse;
use crate::services::{files, log, privacy};
use crate::sync::LockExt;

/// Un nœud par dossier jusqu'à cette profondeur sous le dossier analysé.
pub const KEEP_DEPTH: u16 = 12;
/// Au plus ce nombre de dossiers gardés en mémoire (≈ 150 octets chacun).
pub const MAX_NODES: usize = 80_000;
/// On ne descend pas plus bas (chemins pathologiques).
pub const MAX_DEPTH: u16 = 64;
/// Les plus gros fichiers gardés pour chaque dossier.
const BIG_FILES: usize = 6;
/// Les sous-dossiers montés dans la vue d'un dossier.
const SHOW_CHILDREN: usize = 40;
/// Un message de progression au plus toutes les TICK.
const TICK: Duration = Duration::from_millis(400);
const NONE: u32 = u32::MAX;

/// Un fichier temporaire plus récent est peut-être encore utile : on n'y touche pas.
pub const TEMP_MIN_AGE: Duration = Duration::from_secs(24 * 3600);
/// Au plus ce nombre de fichiers lus pour une estimation ou un nettoyage (temporaires, téléchargements).
const CLEAN_MAX_FILES: usize = 400_000;
/// Les vieux téléchargements montrés au plus.
const MAX_DOWNLOADS: usize = 300;

// ── L'arbre de l'analyse ─────────────────────────────────────────────────────

struct Node {
    name: Box<str>,
    parent: u32,
    depth: u16,
    /// Tout ce qui est dessous (fichiers directs et sous-dossiers).
    bytes: u64,
    /// Les fichiers posés directement dans ce dossier.
    direct: u64,
    /// Les morceaux de travail pas encore finis (ce dossier et ses sous-dossiers).
    pending: u32,
    done: bool,
    children: Vec<u32>,
    /// Les plus gros fichiers directs, du plus gros au plus petit.
    big: Vec<(Box<str>, u64)>,
}

/// Une analyse : l'arbre et les compteurs.
pub struct Scan {
    pub job: u64,
    root: PathBuf,
    nodes: Vec<Node>,
    files: u64,
    dirs: u64,
    skipped: u64,
    excluded: u64,
    /// Des dossiers trop profonds ou trop nombreux ont été ajoutés à leur parent.
    folded: bool,
    finished: bool,
    cancelled: bool,
    started: Instant,
    elapsed_ms: u64,
}

impl Scan {
    pub fn new(job: u64, root: PathBuf) -> Self {
        let name: Box<str> = root.display().to_string().into();
        Scan {
            job,
            root,
            nodes: vec![Node { name, parent: NONE, depth: 0, bytes: 0, direct: 0, pending: 1, done: false, children: Vec::new(), big: Vec::new() }],
            files: 0,
            dirs: 0,
            skipped: 0,
            excluded: 0,
            folded: false,
            finished: false,
            cancelled: false,
            started: Instant::now(),
            elapsed_ms: 0,
        }
    }

    /// Ajoute des fichiers à `owner` (et la taille à tous ses parents).
    fn add_files(&mut self, owner: u32, bytes: u64, count: u64, big: Vec<(Box<str>, u64)>) {
        self.files += count;
        self.nodes[owner as usize].direct += bytes;
        let mut id = owner;
        while id != NONE {
            let n = &mut self.nodes[id as usize];
            n.bytes += bytes;
            id = n.parent;
        }
        if !big.is_empty() {
            let list = &mut self.nodes[owner as usize].big;
            for b in big {
                push_big(list, b);
            }
        }
    }

    /// Un sous-dossier de `owner`, à la profondeur `depth` : un nouveau nœud,
    /// ou `owner` lui-même quand on n'en garde plus (profondeur, mémoire).
    fn child(&mut self, owner: u32, depth: u16, name: Box<str>) -> u32 {
        if depth <= KEEP_DEPTH && self.nodes.len() < MAX_NODES {
            let id = self.nodes.len() as u32;
            self.nodes.push(Node { name, parent: owner, depth, bytes: 0, direct: 0, pending: 1, done: false, children: Vec::new(), big: Vec::new() });
            let parent = &mut self.nodes[owner as usize];
            parent.children.push(id);
            parent.pending += 1;
            id
        } else {
            self.folded = true;
            self.nodes[owner as usize].pending += 1;
            owner
        }
    }

    /// Un morceau de travail de `id` est fini ; un dossier tout fini prévient son parent.
    fn finish(&mut self, mut id: u32) {
        while id != NONE {
            let n = &mut self.nodes[id as usize];
            n.pending = n.pending.saturating_sub(1);
            if n.pending > 0 {
                return;
            }
            n.done = true;
            id = n.parent;
        }
    }

    /// Le chemin complet d'un nœud.
    fn path_of(&self, id: u32) -> PathBuf {
        let mut names = Vec::new();
        let mut at = id;
        while at != 0 && at != NONE {
            let n = &self.nodes[at as usize];
            names.push(&*n.name);
            at = n.parent;
        }
        let mut p = self.root.clone();
        for name in names.into_iter().rev() {
            p.push(name);
        }
        p
    }

    fn total(&self) -> u64 {
        self.nodes[0].bytes
    }

    /// Le petit message de progression (`system.disk-scan`).
    pub fn progress(&self) -> Value {
        json!({ "job": self.job, "done": self.finished, "cancelled": self.cancelled, "bytes": self.total(), "files": self.files })
    }

    /// Ce que montre l'île pour le dossier `id` (voir disk_view côté front).
    pub fn view(&self, id: u32) -> Result<Value, String> {
        let n = self.nodes.get(id as usize).ok_or("dossier inconnu dans cette analyse")?;
        let mut crumbs = Vec::new();
        let mut at = id;
        while at != NONE {
            let c = &self.nodes[at as usize];
            crumbs.push(json!({ "id": at, "name": &*c.name }));
            at = c.parent;
        }
        crumbs.reverse();
        let mut kids: Vec<&u32> = n.children.iter().collect();
        kids.sort_by_key(|k| std::cmp::Reverse(self.nodes[**k as usize].bytes));
        let shown: Vec<Value> = kids
            .iter()
            .take(SHOW_CHILDREN)
            .filter(|k| self.nodes[***k as usize].bytes > 0 || !self.nodes[***k as usize].done)
            .map(|k| {
                let c = &self.nodes[**k as usize];
                json!({ "id": **k, "name": &*c.name, "bytes": c.bytes, "done": c.done, "more": !c.children.is_empty() })
            })
            .collect();
        let shown_bytes: u64 = shown.iter().map(|c| c["bytes"].as_u64().unwrap_or(0)).sum();
        let path = self.path_of(id);
        let big: Vec<Value> = n.big.iter().map(|(name, bytes)| json!({ "name": &**name, "bytes": bytes, "path": path.join(&**name).display().to_string() })).collect();
        Ok(json!({
            "job": self.job,
            "done": self.finished,
            "cancelled": self.cancelled,
            "files": self.files,
            "dirs": self.dirs,
            "skipped": self.skipped,
            "excluded": self.excluded,
            "folded": self.folded,
            "elapsedMs": if self.finished { self.elapsed_ms } else { self.started.elapsed().as_millis() as u64 },
            "total": self.total(),
            "node": { "id": id, "name": &*n.name, "path": path.display().to_string(), "bytes": n.bytes, "done": n.done },
            "crumbs": crumbs,
            "children": shown,
            "here": n.direct,
            "big": big,
            // Ce qui n'est ni montré ni fichier direct : petits ou trop profonds.
            "rest": n.bytes.saturating_sub(shown_bytes).saturating_sub(n.direct),
        }))
    }
}

/// Garde les BIG_FILES plus gros, triés.
fn push_big(list: &mut Vec<(Box<str>, u64)>, item: (Box<str>, u64)) {
    if list.len() == BIG_FILES && list.last().is_some_and(|l| l.1 >= item.1) {
        return;
    }
    let at = list.partition_point(|l| l.1 >= item.1);
    list.insert(at, item);
    list.truncate(BIG_FILES);
}

/// Ce qu'on lit d'un dossier.
#[derive(Default)]
struct Listing {
    bytes: u64,
    count: u64,
    big: Vec<(Box<str>, u64)>,
    subdirs: Vec<(PathBuf, Box<str>)>,
}

/// Lit un dossier (sans descendre). None : fermé ou disparu.
fn list_dir(dir: &Path) -> Option<Listing> {
    let mut out = Listing::default();
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        // Liens symboliques et jonctions : jamais suivis (sous Windows, une
        // jonction est vue comme un lien ; un dossier OneDrive ne l'est pas).
        if kind.is_symlink() {
            continue;
        }
        let name: Box<str> = entry.file_name().to_string_lossy().into();
        if kind.is_dir() {
            out.subdirs.push((entry.path(), name));
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let size = diskuse::on_disk(&meta, &entry.path());
        out.bytes += size;
        out.count += 1;
        push_big(&mut out.big, (name, size));
    }
    Some(out)
}

fn is_excluded(excluded: &[PathBuf], path: &Path) -> bool {
    excluded.iter().any(|e| privacy::contains_path(e, path))
}

/// Les dossiers exclus (Confidentialité), canonisés une fois pour toutes.
pub fn excluded_folders(app: &AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;
    let list = app.state::<crate::Shared>().settings.locked().privacy.excluded_folders.clone();
    list.iter().filter_map(|f| std::fs::canonicalize(f).ok().map(privacy::simplify)).collect()
}

/// Parcourt tout l'arbre de `scan`. `tick` reçoit la progression de temps en
/// temps (hors du verrou) et répond false pour arrêter (module coupé).
pub fn walk(scan: &Mutex<Scan>, cancel: &AtomicBool, excluded: &[PathBuf], mut tick: impl FnMut(Value) -> bool) {
    let root = scan.locked().root.clone();
    let mut stack: Vec<(PathBuf, u32, u16)> = vec![(root, 0, 0)];
    let mut last = Instant::now();
    while let Some((dir, owner, depth)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) {
            scan.locked().cancelled = true;
            break;
        }
        let listing = list_dir(&dir);
        // Les dossiers exclus sont écartés avant de prendre le verrou.
        let (subdirs, excl) = match &listing {
            Some(l) => {
                let before = l.subdirs.len();
                let keep: Vec<(PathBuf, Box<str>)> = l.subdirs.iter().filter(|(p, _)| !is_excluded(excluded, p)).cloned().collect();
                let excl = (before - keep.len()) as u64;
                (keep, excl)
            }
            None => (Vec::new(), 0),
        };
        {
            let mut s = scan.locked();
            match listing {
                None => s.skipped += 1,
                Some(l) => {
                    s.dirs += 1;
                    s.excluded += excl;
                    // Les gros fichiers seulement quand on est vraiment dans le dossier du nœud.
                    let big = if s.nodes[owner as usize].depth == depth { l.big } else { Vec::new() };
                    s.add_files(owner, l.bytes, l.count, big);
                    for (path, name) in subdirs {
                        if depth + 1 > MAX_DEPTH {
                            s.skipped += 1;
                            continue;
                        }
                        let id = s.child(owner, depth + 1, name);
                        stack.push((path, id, depth + 1));
                    }
                }
            }
            s.finish(owner);
        }
        if last.elapsed() >= TICK {
            last = Instant::now();
            let p = scan.locked().progress();
            if !tick(p) {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
    let p = {
        let mut s = scan.locked();
        s.finished = true;
        s.elapsed_ms = s.started.elapsed().as_millis() as u64;
        s.progress()
    };
    tick(p);
}

// ── L'analyse en cours (une seule à la fois) ─────────────────────────────────

struct Running {
    scan: Arc<Mutex<Scan>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct DiskScans {
    current: Mutex<Option<Running>>,
    next_job: AtomicU64,
}

impl DiskScans {
    /// Lance l'analyse de `root` dans un fil à part ; arrête la précédente.
    pub fn start(&self, app: &AppHandle, root: PathBuf) -> u64 {
        let job = self.next_job.fetch_add(1, Ordering::Relaxed) + 1;
        let scan = Arc::new(Mutex::new(Scan::new(job, root)));
        let cancel = Arc::new(AtomicBool::new(false));
        if let Some(old) = self.current.locked().replace(Running { scan: scan.clone(), cancel: cancel.clone() }) {
            old.cancel.store(true, Ordering::Relaxed);
        }
        let excluded = excluded_folders(app);
        let app = app.clone();
        let spawned = std::thread::Builder::new().name("ondine-disk-scan".into()).spawn(move || {
            let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                walk(&scan, &cancel, &excluded, |p| {
                    if !super::is_active(&app, "system") {
                        return false;
                    }
                    super::with_context(&app, "system", |ctx| ctx.emit("system.disk-scan", p));
                    true
                })
            }));
            if ran.is_err() {
                log::warn("système : erreur inattendue pendant l'analyse du disque");
                let mut s = scan.locked();
                s.finished = true;
                s.cancelled = true;
            }
        });
        if spawned.is_err() {
            log::warn("système : impossible de lancer l'analyse du disque");
        }
        job
    }

    fn with_job<R>(&self, job: u64, f: impl FnOnce(&Running) -> R) -> Result<R, String> {
        let cur = self.current.locked();
        match cur.as_ref() {
            Some(r) if r.scan.locked().job == job => Ok(f(r)),
            _ => Err("cette analyse n'existe plus : relancez-la".into()),
        }
    }

    /// Arrête l'analyse ; `forget` : libère aussi sa mémoire.
    pub fn cancel(&self, job: u64, forget: bool) {
        let _ = self.with_job(job, |r| r.cancel.store(true, Ordering::Relaxed));
        if forget {
            let mut cur = self.current.locked();
            if cur.as_ref().is_some_and(|r| r.scan.locked().job == job) {
                *cur = None;
            }
        }
    }

    pub fn view(&self, job: u64, node: u32) -> Result<Value, String> {
        self.with_job(job, |r| r.scan.locked().view(node))?
    }

    /// Le chemin d'un dossier de l'analyse (pour l'ouvrir dans l'Explorateur).
    pub fn path(&self, job: u64, node: u32) -> Result<PathBuf, String> {
        self.with_job(job, |r| {
            let s = r.scan.locked();
            if (node as usize) < s.nodes.len() {
                Ok(s.path_of(node))
            } else {
                Err("dossier inconnu dans cette analyse".to_string())
            }
        })?
    }
}

// ── Le nettoyage ─────────────────────────────────────────────────────────────

/// L'âge d'un élément : depuis sa dernière écriture OU sa création (la plus
/// récente des deux : un fichier téléchargé hier garde parfois une vieille date).
fn age(meta: &std::fs::Metadata, now: SystemTime) -> Duration {
    let newest = [meta.modified().ok(), meta.created().ok()].into_iter().flatten().max();
    newest.and_then(|t| now.duration_since(t).ok()).unwrap_or_default()
}

/// Ce qu'a donné un passage dans les temporaires.
#[derive(Default, Debug, PartialEq)]
pub struct Sweep {
    pub bytes: u64,
    pub files: u64,
    /// Ouverts, en lecture seule ou fermés : laissés.
    pub skipped: u64,
    /// Trop de fichiers : on s'est arrêté avant la fin.
    pub partial: bool,
}

/// Les fichiers temporaires de `dir` de plus de `min_age` (tous les niveaux).
/// `delete` : on les supprime (un fichier ouvert refuse : il est sauté), puis
/// les dossiers vides et anciens. Sinon on compte seulement.
pub fn sweep_temp(dir: &Path, min_age: Duration, delete: bool, excluded: &[PathBuf]) -> Sweep {
    let now = SystemTime::now();
    let mut out = Sweep::default();
    let mut stack = vec![(dir.to_path_buf(), 0u16)];
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut seen = 0usize;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else {
            out.skipped += 1;
            continue;
        };
        for entry in rd.flatten() {
            seen += 1;
            if seen > CLEAN_MAX_FILES {
                out.partial = true;
                break;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue; // un lien : ni suivi ni supprimé
            }
            let path = entry.path();
            if is_excluded(excluded, &path) {
                continue;
            }
            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    dirs.push(path.clone());
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if age(&meta, now) < min_age {
                continue;
            }
            let size = diskuse::on_disk(&meta, &path);
            // Un fichier ouvert (ou en lecture seule) refuse : il est sauté.
            if delete && std::fs::remove_file(&path).is_err() {
                out.skipped += 1;
                continue;
            }
            out.bytes += size;
            out.files += 1;
        }
        if out.partial {
            break;
        }
    }
    if delete {
        // Les plus profonds d'abord : un dossier vidé laisse son parent vide.
        dirs.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
        for d in dirs {
            let old = std::fs::metadata(&d).map(|m| age(&m, now) >= min_age).unwrap_or(false);
            if old {
                let _ = std::fs::remove_dir(&d); // échoue s'il n'est pas vide : tant mieux
            }
        }
    }
    out
}

/// Le cache des miniatures : les fichiers thumbcache_*.db de `dir`.
pub fn sweep_thumbs(dir: &Path, delete: bool) -> Sweep {
    let mut out = Sweep::default();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if !(name.starts_with("thumbcache_") && name.ends_with(".db")) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let size = diskuse::on_disk(&meta, &entry.path());
        if delete && std::fs::remove_file(entry.path()).is_err() {
            out.skipped += 1; // l'Explorateur le tient ouvert
            continue;
        }
        out.bytes += size;
        out.files += 1;
    }
    out
}

/// Un vieux téléchargement proposé.
#[derive(Debug, Clone, PartialEq)]
pub struct OldDownload {
    pub path: PathBuf,
    pub name: String,
    pub bytes: u64,
    pub days: u64,
    pub dir: bool,
}

/// La taille et l'âge (le plus récent de son contenu) d'un dossier.
fn dir_size_age(dir: &Path, now: SystemTime, budget: &mut usize) -> (u64, Duration) {
    let mut bytes = 0;
    let mut youngest = std::fs::metadata(dir).map(|m| age(&m, now)).unwrap_or_default();
    let mut stack = vec![(dir.to_path_buf(), 0u16)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            if *budget == 0 {
                return (bytes, youngest);
            }
            *budget -= 1;
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            youngest = youngest.min(age(&meta, now));
            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
            } else {
                bytes += diskuse::on_disk(&meta, &entry.path());
            }
        }
    }
    (bytes, youngest)
}

/// Les éléments posés directement dans `dir` (Téléchargements) qui n'ont pas
/// bougé depuis `days` jours, du plus gros au plus petit. Jamais : un fichier
/// caché ou système (desktop.ini), un lien, un dossier exclu.
pub fn old_downloads(dir: &Path, days: u64, excluded: &[PathBuf]) -> Vec<OldDownload> {
    let now = SystemTime::now();
    let limit = Duration::from_secs(days * 86_400);
    let mut budget = CLEAN_MAX_FILES;
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for entry in rd.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if is_excluded(excluded, &path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if diskuse::is_hidden(&meta) {
            continue;
        }
        let (bytes, a) = if kind.is_dir() { dir_size_age(&path, now, &mut budget) } else { (diskuse::on_disk(&meta, &path), age(&meta, now)) };
        if a < limit {
            continue;
        }
        out.push(OldDownload { name: entry.file_name().to_string_lossy().into_owned(), path, bytes, days: a.as_secs() / 86_400, dir: kind.is_dir() });
    }
    out.sort_by_key(|d| std::cmp::Reverse(d.bytes));
    out.truncate(MAX_DOWNLOADS);
    out
}

/// Les éléments cochés, revérifiés un par un : dans Téléchargements même (pas
/// plus bas), toujours assez vieux, pas exclus. Les autres sont écartés.
pub fn checked_downloads(dir: &Path, paths: &[String], days: u64, excluded: &[PathBuf]) -> Vec<OldDownload> {
    let Ok(dir) = std::fs::canonicalize(dir).map(privacy::simplify) else { return Vec::new() };
    let reals: Vec<PathBuf> = paths.iter().filter_map(|raw| std::fs::canonicalize(raw).ok().map(privacy::simplify)).collect();
    // On part de la liste permise : un chemin coché deux fois ne compte qu'une fois.
    old_downloads(&dir, days, excluded).into_iter().filter(|d| reals.iter().any(|r| same(&d.path, r))).collect()
}

fn same(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Pour l'estimation affichée : la Corbeille, les temporaires, les miniatures,
/// les vieux téléchargements.
pub fn estimate(days: u64, excluded: &[PathBuf]) -> Value {
    let trash = diskuse::recycle_bin().map(|(bytes, items)| json!({ "bytes": bytes, "items": items }));
    let temp = sweep_temp(&std::env::temp_dir(), TEMP_MIN_AGE, false, excluded);
    let thumbs = diskuse::thumbnail_dir().map(|d| sweep_thumbs(&d, false));
    let downloads = crate::platform::downloads_dir().map(|d| old_downloads(&d, days, excluded)).unwrap_or_default();
    json!({
        "trash": trash,
        "temp": { "bytes": temp.bytes, "files": temp.files, "partial": temp.partial },
        "thumbs": thumbs.map(|t| json!({ "bytes": t.bytes, "files": t.files })),
        "downloads": {
            "days": days,
            "bytes": downloads.iter().map(|d| d.bytes).sum::<u64>(),
            "items": downloads.iter().map(|d| json!({ "path": d.path.display().to_string(), "name": d.name, "bytes": d.bytes, "days": d.days, "dir": d.dir })).collect::<Vec<_>>(),
        },
    })
}

/// Fait un nettoyage confirmé côté front. `paths` : les téléchargements cochés.
/// Renvoie { freed, files, skipped, trashed? }.
pub fn clean(kind: &str, days: u64, paths: &[String], excluded: &[PathBuf]) -> Result<(Value, Option<Vec<PathBuf>>), String> {
    match kind {
        "trash" => {
            let before = diskuse::recycle_bin().map(|(b, _)| b).unwrap_or(0);
            diskuse::empty_recycle_bin()?;
            log::info("système : Corbeille vidée");
            Ok((json!({ "freed": before, "files": 0, "skipped": 0 }), None))
        }
        "temp" => {
            let s = sweep_temp(&std::env::temp_dir(), TEMP_MIN_AGE, true, excluded);
            log::info(format!("système : {} fichiers temporaires supprimés, {} laissés", s.files, s.skipped));
            Ok((json!({ "freed": s.bytes, "files": s.files, "skipped": s.skipped }), None))
        }
        "thumbs" => {
            let dir = diskuse::thumbnail_dir().ok_or("pas de cache de miniatures ici")?;
            let s = sweep_thumbs(&dir, true);
            log::info(format!("système : cache des miniatures, {} fichiers supprimés, {} laissés", s.files, s.skipped));
            Ok((json!({ "freed": s.bytes, "files": s.files, "skipped": s.skipped }), None))
        }
        "downloads" => {
            let dir = crate::platform::downloads_dir().ok_or("dossier Téléchargements introuvable")?;
            let list = checked_downloads(&dir, paths, days, excluded);
            if list.is_empty() {
                return Err("rien à envoyer à la Corbeille".into());
            }
            let bytes: u64 = list.iter().map(|d| d.bytes).sum();
            let list: Vec<PathBuf> = list.into_iter().map(|d| d.path).collect();
            files::to_trash(&list)?;
            log::info(format!("système : {} vieux téléchargements envoyés à la Corbeille", list.len()));
            Ok((json!({ "freed": 0, "trashed": bytes, "files": list.len(), "skipped": paths.len().saturating_sub(list.len()) }), Some(list)))
        }
        other => Err(format!("nettoyage inconnu : {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ondine-disk-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn sizes_go_up_to_every_parent() {
        let mut s = Scan::new(1, PathBuf::from("/r"));
        let a = s.child(0, 1, "a".into());
        let b = s.child(a, 2, "b".into());
        s.add_files(b, 100, 2, vec![("x".into(), 60), ("y".into(), 40)]);
        s.add_files(0, 5, 1, vec![]);
        assert_eq!(s.nodes[0].bytes, 105);
        assert_eq!(s.nodes[a as usize].bytes, 100);
        assert_eq!(s.nodes[b as usize].direct, 100);
        assert_eq!(s.files, 3);
        assert_eq!(s.path_of(b), PathBuf::from("/r/a/b"));
    }

    #[test]
    fn folders_are_done_when_all_their_children_are() {
        let mut s = Scan::new(1, PathBuf::from("/r"));
        let a = s.child(0, 1, "a".into());
        let b = s.child(0, 1, "b".into());
        s.finish(0); // la racine elle-même est lue
        assert!(!s.nodes[0].done);
        s.finish(a);
        assert!(s.nodes[a as usize].done && !s.nodes[0].done);
        s.finish(b);
        assert!(s.nodes[0].done);
    }

    #[test]
    fn too_deep_folders_fold_into_their_parent() {
        let mut s = Scan::new(1, PathBuf::from("/r"));
        let mut at = 0;
        for d in 1..=KEEP_DEPTH {
            at = s.child(at, d, format!("d{d}").into());
        }
        let deep = s.child(at, KEEP_DEPTH + 1, "trop".into());
        assert_eq!(deep, at);
        assert!(s.folded);
        assert_eq!(s.nodes.len(), KEEP_DEPTH as usize + 1);
    }

    #[test]
    fn biggest_files_are_kept_in_order() {
        let mut list = Vec::new();
        for (i, size) in [5u64, 50, 1, 70, 20, 90, 3, 60].iter().enumerate() {
            push_big(&mut list, (format!("f{i}").into(), *size));
        }
        let sizes: Vec<u64> = list.iter().map(|x| x.1).collect();
        assert_eq!(sizes, vec![90, 70, 60, 50, 20, 5]);
    }

    #[test]
    fn view_lists_children_biggest_first_with_the_rest() {
        let mut s = Scan::new(7, PathBuf::from("/r"));
        let small = s.child(0, 1, "petit".into());
        let big = s.child(0, 1, "gros".into());
        s.add_files(small, 10, 1, vec![]);
        s.add_files(big, 1000, 1, vec![]);
        s.add_files(0, 4, 1, vec![("ici.txt".into(), 4)]);
        let v = s.view(0).unwrap();
        assert_eq!(v["children"][0]["name"], "gros");
        assert_eq!(v["children"][1]["name"], "petit");
        assert_eq!(v["here"], 4);
        assert_eq!(v["rest"], 0);
        assert_eq!(v["total"], 1014);
        assert_eq!(v["big"][0]["name"], "ici.txt");
        let crumbs = s.view(big).unwrap()["crumbs"].clone();
        assert_eq!(crumbs.as_array().unwrap().len(), 2);
        assert!(s.view(99).is_err());
    }

    #[test]
    fn a_real_walk_counts_and_skips_links_and_excluded() {
        let root = tmp("walk");
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::create_dir_all(root.join("secret")).unwrap();
        std::fs::write(root.join("a/b/f.bin"), vec![1u8; 10_000]).unwrap();
        std::fs::write(root.join("top.txt"), b"x").unwrap();
        std::fs::write(root.join("secret/s.bin"), vec![1u8; 50_000]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("a"), root.join("lien")).unwrap();
        let scan = Mutex::new(Scan::new(1, root.clone()));
        let cancel = AtomicBool::new(false);
        let mut ticks = 0;
        walk(&scan, &cancel, &[root.join("secret")], |_| {
            ticks += 1;
            true
        });
        let s = scan.locked();
        assert!(s.finished && !s.cancelled && s.nodes[0].done);
        assert_eq!(s.files, 2); // le lien n'est pas suivi, le dossier exclu pas lu
        assert_eq!(s.excluded, 1);
        assert!(s.total() >= 10_000 && s.total() < 50_000);
        assert!(ticks >= 1);
        drop(s);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_cancelled_walk_stops() {
        let root = tmp("cancel");
        std::fs::create_dir_all(root.join("a")).unwrap();
        let scan = Mutex::new(Scan::new(1, root.clone()));
        let cancel = AtomicBool::new(true);
        walk(&scan, &cancel, &[], |_| true);
        let s = scan.locked();
        assert!(s.cancelled && s.finished);
        assert_eq!(s.dirs, 0);
        drop(s);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn temp_sweep_only_touches_old_files() {
        let root = tmp("temp");
        std::fs::create_dir_all(root.join("sous")).unwrap();
        std::fs::write(root.join("neuf.tmp"), b"abc").unwrap();
        std::fs::write(root.join("sous/neuf2.tmp"), b"abc").unwrap();
        // Tout est neuf : rien n'est compté ni supprimé avec 24 h.
        let s = sweep_temp(&root, TEMP_MIN_AGE, true, &[]);
        assert_eq!(s.files, 0);
        assert!(root.join("neuf.tmp").exists() && root.join("sous").exists());
        // Avec un âge minimum nul : on compte d'abord, puis on supprime (dossier vide compris).
        let dry = sweep_temp(&root, Duration::ZERO, false, &[]);
        assert_eq!(dry.files, 2);
        assert!(root.join("neuf.tmp").exists());
        let wet = sweep_temp(&root, Duration::ZERO, true, &[]);
        assert_eq!(wet.files, 2);
        assert!(!root.join("neuf.tmp").exists());
        assert!(!root.join("sous").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn excluded_temp_folders_are_left_alone() {
        let root = tmp("temp-excl");
        std::fs::create_dir_all(root.join("garde")).unwrap();
        std::fs::write(root.join("garde/a.tmp"), b"abc").unwrap();
        let s = sweep_temp(&root, Duration::ZERO, true, &[root.join("garde")]);
        assert_eq!(s.files, 0);
        assert!(root.join("garde/a.tmp").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn thumbnail_sweep_only_counts_thumbcache_files() {
        let root = tmp("thumbs");
        std::fs::write(root.join("thumbcache_256.db"), vec![0u8; 5000]).unwrap();
        std::fs::write(root.join("iconcache_16.db"), b"x").unwrap();
        let s = sweep_thumbs(&root, false);
        assert_eq!(s.files, 1);
        assert!(s.bytes >= 5000);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_old_listed_downloads_can_be_checked() {
        let root = tmp("dl");
        std::fs::write(root.join("vieux.zip"), b"abc").unwrap();
        std::fs::create_dir_all(root.join("dossier/sous")).unwrap();
        std::fs::write(root.join("dossier/sous/x.bin"), b"abc").unwrap();
        // 0 jour : tout est « vieux » ; 30 jours : rien (tout vient d'être créé).
        assert_eq!(old_downloads(&root, 0, &[]).len(), 2);
        assert!(old_downloads(&root, 30, &[]).is_empty());
        let dir = old_downloads(&root, 0, &[]).into_iter().find(|d| d.dir).unwrap();
        assert!(dir.bytes > 0);
        // Un chemin plus bas que Téléchargements, ou ailleurs : refusé.
        let inside = root.join("dossier/sous/x.bin").display().to_string();
        let ok = root.join("vieux.zip").display().to_string();
        let got = checked_downloads(&root, &[inside, ok, "/etc/passwd".into()], 0, &[]);
        assert_eq!(got.len(), 1);
        assert!(got[0].path.ends_with("vieux.zip"));
        // Trop récent pour 30 jours : refusé même s'il est coché.
        assert!(checked_downloads(&root, &[root.join("vieux.zip").display().to_string()], 30, &[]).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
