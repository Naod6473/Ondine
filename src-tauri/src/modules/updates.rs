// Module « Mises à jour des logiciels » : les mises à jour des applis
// installées, par winget (le gestionnaire de paquets de Windows, livré avec
// « App Installer »).
//
// Ce qui part sur Internet : rien sans un clic. « Vérifier » lance
// `winget upgrade` (liste), qui lit les sources de winget (le dépôt
// communautaire de Microsoft, le Microsoft Store) ; une vérification
// automatique (chaque jour ou chaque semaine) n'a lieu que si elle est
// allumée dans les réglages (coupée par défaut). Une mise à jour ne part
// qu'après confirmation dans l'onglet.
//
// Sécurité :
//   - winget est lancé par son chemin complet, sans shell (jamais cmd ni
//     PowerShell), chaque argument à part ; l'ID d'une appli est vérifié
//     (`valid_id` : lettres, chiffres, « . - _ + », jamais « - » au début) et
//     doit venir de la dernière liste lue ;
//   - pas de fenêtre de console (CREATE_NO_WINDOW). Un installateur qui
//     demande l'administrateur fait paraître la fenêtre de Windows (UAC) :
//     Ondine ne peut ni la cacher ni la valider à votre place, et le dit.
//
// La file : une mise à jour à la fois, dans un fil à part. Ce qui attend
// peut être retiré ; celle qui tourne ne s'arrête pas (couper un
// installateur en plein travail peut abîmer l'appli). Chaque fin donne un
// résultat (`Outcome`, updates_parse.rs) que le front écrit en clair.
//
// Bus :
//   updates.changed   {}                       l'état a changé : l'onglet redemande `status`
//   updates.progress  {id, phase, pct, index, total}  pendant une mise à jour (4 fois par seconde au plus)
//   updates.available {count, fresh, scheduled}  après une vérification : la pastille de l'île
//   updates.finished  {ok, failed, reboot}     la file est vide : la notification
//   task.started / task.finished / task.failed, mascot.emote : Ondine travaille et réagit
// Écoute `updates.check` (le Lanceur) : une vérification, comme le bouton.
//
// Fichier : %APPDATA%\Ondine\updates.json (date de la dernière vérification
// et la liste trouvée), pour retrouver la liste et la pastille au démarrage.

use std::collections::VecDeque;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::updates_parse::{self as parse, Outcome, Package, Phase};
use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::{self, BusMessage};
use crate::services::log;
use crate::sync::LockExt;

pub const ID: &str = "updates";

/// La liste : quelques secondes en général, plus quand la source se met à jour.
const LIST_TIMEOUT: Duration = Duration::from_secs(180);
/// Une mise à jour : un gros installateur peut être long.
const UPGRADE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Au plus ce que l'on garde de la sortie de winget.
const MAX_OUTPUT: usize = 1024 * 1024;
/// Les résultats gardés (les plus récents).
const MAX_DONE: usize = 40;
/// La page « App Installer » du Microsoft Store (elle apporte winget).
pub const APP_INSTALLER_URI: &str = "ms-windows-store://pdp/?productid=9NBLGGH4NNS1";

/// Ce qui est gardé sur le disque.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    /// Dernière vérification réussie (secondes Unix).
    last_check: Option<u64>,
    packages: Vec<Package>,
}

/// Une mise à jour dans la file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    name: String,
    version: String,
    available: String,
    source: String,
}

/// Celle qui tourne.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Running {
    #[serde(flatten)]
    job: Job,
    phase: Phase,
    /// 0 à 100, ou null quand winget ne donne pas d'avancement.
    pct: Option<f64>,
    started_at: u64,
}

/// Une mise à jour terminée.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    id: String,
    name: String,
    available: String,
    outcome: Outcome,
    /// Le code de winget (« 0x8A150101 »), vide si réussie.
    code: String,
    at: u64,
}

#[derive(Default)]
struct State {
    loaded: bool,
    saved: Saved,
    checking: bool,
    /// winget introuvable (dernière tentative).
    missing: bool,
    /// La dernière vérification a échoué : une phrase courte.
    error: Option<String>,
    queue: VecDeque<Job>,
    current: Option<Running>,
    done: Vec<Done>,
    /// Le fil de la file tourne.
    worker: bool,
    /// La série en cours : combien en tout, combien finies.
    batch_total: usize,
    batch_done: usize,
}

impl State {
    fn ensure_loaded(&mut self) {
        if !self.loaded {
            self.saved = load();
            self.loaded = true;
        }
    }
}

#[derive(Default)]
pub struct Updates {
    state: Arc<Mutex<State>>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Publie sur le bus au nom du module (même module coupé entre-temps : la
/// mascotte ne doit pas rester « au travail » faute du `task.finished`).
fn emit(app: &AppHandle, topic: &str, payload: Value) {
    bus::emit(app, ID, topic, payload);
}

fn file() -> PathBuf {
    platform::config_dir().join("updates.json")
}

fn load() -> Saved {
    std::fs::read_to_string(file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(saved: &Saved) {
    let dir = platform::config_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(text) = serde_json::to_string(saved) {
        let tmp = dir.join("updates.json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, file());
        }
    }
}

/// Les réglages du module (lus dans les réglages partagés).
fn settings(app: &AppHandle) -> serde_json::Map<String, Value> {
    let shared = app.state::<crate::Shared>();
    let s = shared.settings.locked();
    s.modules.get(ID).map(|m| m.values.clone()).unwrap_or_default()
}

fn ignored(app: &AppHandle) -> Vec<String> {
    parse::parse_ignored(settings(app).get("ignored").and_then(Value::as_str).unwrap_or(""))
}

// ── winget ───────────────────────────────────────────────────────────────────

/// Le chemin de winget : l'alias d'App Installer dans WindowsApps (là où il
/// est toujours), sinon ce que le PATH donne. `symlink_metadata` : l'alias
/// est un point d'analyse que `is_file()` ne sait pas toujours suivre.
fn winget_path() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("Microsoft").join("WindowsApps").join("winget.exe");
        if std::fs::symlink_metadata(&p).is_ok() {
            return Some(p);
        }
    }
    platform::find_program("winget")
}

/// Ce qu'un lancement de winget a donné.
struct RunOutput {
    code: Option<i32>,
    text: String,
    timed_out: bool,
}

/// Lance winget avec `args` (chacun à part, sans shell), sans fenêtre, et lit
/// sa sortie au fil de l'eau : `on_segment` reçoit chaque morceau entre deux
/// retours (« \r » ou « \n »), pour l'avancement. Trop long : arrêté.
fn run_winget(winget: &PathBuf, args: &[&str], timeout: Duration, mut on_segment: impl FnMut(&str)) -> Result<RunOutput, String> {
    let mut cmd = Command::new(winget);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Depuis le dossier temporaire : jamais depuis un dossier de projet.
    cmd.current_dir(std::env::temp_dir());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Pas de fenêtre de console.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("winget ne se lance pas : {e}"))?;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>)].into_iter().flatten() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut pipe = pipe;
            let mut chunk = [0u8; 8 * 1024];
            while let Ok(n) = pipe.read(&mut chunk) {
                if n == 0 || tx.send(chunk[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);
    let deadline = Instant::now() + timeout;
    let mut bytes: Vec<u8> = Vec::new();
    // Le morceau pas encore fini (sans « \r » ni « \n » derrière).
    let mut pending: Vec<u8> = Vec::new();
    let mut timed_out = false;
    loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => {
                if bytes.len() < MAX_OUTPUT {
                    bytes.extend_from_slice(&chunk[..chunk.len().min(MAX_OUTPUT - bytes.len())]);
                }
                for b in chunk {
                    if b == b'\r' || b == b'\n' {
                        if !pending.is_empty() {
                            on_segment(&String::from_utf8_lossy(&pending));
                            pending.clear();
                        }
                    } else if pending.len() < 4096 {
                        pending.push(b);
                    }
                }
                // Une barre de progression se réécrit sans fin de ligne : on la lit tout de suite.
                if !pending.is_empty() {
                    on_segment(&String::from_utf8_lossy(&pending));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            // Les deux tuyaux sont fermés : winget a fini (ou va finir).
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            break;
        }
    }
    let status = child.wait().map_err(|e| format!("winget : {e}"))?;
    Ok(RunOutput { code: if timed_out { None } else { status.code() }, text: String::from_utf8_lossy(&bytes).into_owned(), timed_out })
}

/// Lance winget ; s'il est trop ancien pour `--disable-interactivity`, relance sans.
fn run_compat(winget: &PathBuf, args: &[&str], timeout: Duration, mut on_segment: impl FnMut(&str)) -> Result<RunOutput, String> {
    let out = run_winget(winget, args, timeout, &mut on_segment)?;
    if parse::rejects_arguments(out.code) && args.contains(&"--disable-interactivity") {
        let older: Vec<&str> = args.iter().copied().filter(|a| *a != "--disable-interactivity").collect();
        return run_winget(winget, &older, timeout, on_segment);
    }
    Ok(out)
}

/// La dernière ligne utile d'une sortie de winget (pour un message d'erreur court).
fn last_words(text: &str) -> String {
    let line = parse::clean_lines(text).into_iter().rev().find(|l| !l.trim().is_empty()).unwrap_or_default();
    line.trim().chars().take(160).collect()
}

// ── La vérification ──────────────────────────────────────────────────────────

/// Vérifie (dans un fil à part). `scheduled` : la vérification automatique.
/// Faux si une vérification ou des mises à jour sont déjà en cours.
fn start_check(app: &AppHandle, state: &Arc<Mutex<State>>, scheduled: bool) -> bool {
    {
        let mut st = state.locked();
        if st.checking || st.worker {
            return false;
        }
        st.checking = true;
    }
    emit(app, "updates.changed", json!({}));
    let (app, state) = (app.clone(), state.clone());
    std::thread::spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app, &state, scheduled)));
        if outcome.is_err() {
            log::error("mises à jour : la vérification a planté");
            let mut st = state.locked();
            st.error = Some("La vérification s'est arrêtée.".into());
        }
        state.locked().checking = false;
        emit(&app, "updates.changed", json!({}));
    });
    true
}

fn check(app: &AppHandle, state: &Arc<Mutex<State>>, scheduled: bool) {
    let Some(winget) = winget_path() else {
        let mut st = state.locked();
        st.missing = true;
        st.error = None;
        return;
    };
    let args = ["upgrade", "--accept-source-agreements", "--disable-interactivity"];
    let out = match run_compat(&winget, &args, LIST_TIMEOUT, |_| {}) {
        Ok(o) => o,
        Err(e) => {
            log::warn(format!("mises à jour : {e}"));
            let mut st = state.locked();
            st.missing = false;
            st.error = Some(e);
            return;
        }
    };
    let list = parse::parse_upgrade_list(&out.text);
    let code = out.code.map(|c| c as u32);
    // Sans tableau : « aucune mise à jour » (code 0, ou « aucune appli trouvée »), sinon une erreur.
    let empty_ok = matches!(code, Some(0) | Some(0x8A15_0014) | Some(0x8A15_002B));
    if !list.found_table && !empty_ok {
        let why = if out.timed_out { "winget n'a pas répondu à temps.".to_string() } else { last_words(&out.text) };
        log::warn(format!("mises à jour : vérification en échec ({})", parse::code_hex(out.code)));
        let mut st = state.locked();
        st.missing = false;
        st.error = Some(if why.is_empty() { format!("winget a répondu par une erreur ({}).", parse::code_hex(out.code)) } else { why });
        return;
    }
    let ignored = ignored(app);
    let (count, fresh) = {
        let mut st = state.locked();
        st.ensure_loaded();
        let before = std::mem::take(&mut st.saved.packages);
        let fresh = list
            .packages
            .iter()
            .filter(|p| !parse::is_ignored(&ignored, &p.id))
            .filter(|p| !before.iter().any(|b| b.id.eq_ignore_ascii_case(&p.id) && b.available == p.available))
            .count();
        st.saved.packages = list.packages;
        st.saved.last_check = Some(now());
        st.missing = false;
        st.error = None;
        save(&st.saved);
        (st.saved.packages.iter().filter(|p| !parse::is_ignored(&ignored, &p.id)).count(), fresh)
    };
    log::info(format!("mises à jour : {count} appli(s) à mettre à jour{}", if list.skipped > 0 { format!(", {} ligne(s) illisible(s)", list.skipped) } else { String::new() }));
    emit(app, "updates.available", json!({ "count": count, "fresh": fresh, "scheduled": scheduled }));
}

// ── La file ──────────────────────────────────────────────────────────────────

/// Ajoute ces applis à la file (celles de la dernière liste, pas déjà en
/// attente ni en cours) et lance le fil si besoin. Rend combien ont été ajoutées.
fn enqueue(app: &AppHandle, state: &Arc<Mutex<State>>, ids: &[String]) -> Result<usize, String> {
    let added = {
        let mut st = state.locked();
        st.ensure_loaded();
        if st.checking {
            return Err("Une vérification est en cours : réessayez dans un instant.".into());
        }
        let mut added = 0;
        for id in ids {
            if !parse::valid_id(id) {
                return Err(format!("ID refusé : {id}"));
            }
            let Some(p) = st.saved.packages.iter().find(|p| p.id.eq_ignore_ascii_case(id)).cloned() else {
                return Err(format!("{id} n'est pas dans la liste : vérifiez de nouveau."));
            };
            let busy = st.queue.iter().any(|j| j.id.eq_ignore_ascii_case(id)) || st.current.as_ref().is_some_and(|r| r.job.id.eq_ignore_ascii_case(id));
            if busy {
                continue;
            }
            st.done.retain(|d| !d.id.eq_ignore_ascii_case(id));
            st.queue.push_back(Job { id: p.id, name: p.name, version: p.version, available: p.available, source: p.source });
            added += 1;
        }
        if !st.worker {
            st.batch_total = 0;
            st.batch_done = 0;
        }
        st.batch_total += added;
        added
    };
    emit(app, "updates.changed", json!({}));
    start_worker(app, state);
    Ok(added)
}

fn start_worker(app: &AppHandle, state: &Arc<Mutex<State>>) {
    {
        let mut st = state.locked();
        if st.worker || st.queue.is_empty() {
            return;
        }
        st.worker = true;
    }
    let (app, state) = (app.clone(), state.clone());
    std::thread::spawn(move || {
        emit(&app, "task.started", json!({ "module": ID }));
        let tally = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&app, &state))).unwrap_or_else(|_| {
            log::error("mises à jour : la file a planté");
            Tally::default()
        });
        {
            let mut st = state.locked();
            st.worker = false;
            st.current = None;
            st.queue.clear();
        }
        // Une tâche commencée finit toujours, réussie ou non (la mascotte reprend sa vie).
        if tally.ok == 0 && tally.failed > 0 {
            emit(&app, "task.failed", json!({ "module": ID }));
        } else {
            emit(&app, "task.finished", json!({ "module": ID }));
        }
        emit(&app, "updates.finished", json!({ "ok": tally.ok, "failed": tally.failed, "reboot": tally.reboot }));
        let ignored = ignored(&app);
        let count = state.locked().saved.packages.iter().filter(|p| !parse::is_ignored(&ignored, &p.id)).count();
        emit(&app, "updates.available", json!({ "count": count, "fresh": 0, "scheduled": false }));
        emit(&app, "updates.changed", json!({}));
    });
}

#[derive(Default)]
struct Tally {
    ok: usize,
    failed: usize,
    reboot: usize,
}

/// Le fil de la file : une mise à jour après l'autre, jusqu'à ce qu'elle soit vide.
fn work(app: &AppHandle, state: &Arc<Mutex<State>>) -> Tally {
    let mut tally = Tally::default();
    let Some(winget) = winget_path() else {
        let mut st = state.locked();
        st.missing = true;
        let left: Vec<Job> = st.queue.drain(..).collect();
        for job in left {
            push_done(&mut st, &job, Outcome::Failed, String::new());
            tally.failed += 1;
        }
        return tally;
    };
    loop {
        // Le module coupé entre-temps : ce qui attend est abandonné.
        if !super::is_active(app, ID) {
            state.locked().queue.clear();
            break;
        }
        let (job, index, total) = {
            let mut st = state.locked();
            let Some(job) = st.queue.pop_front() else { break };
            st.current = Some(Running { job: job.clone(), phase: Phase::Prepare, pct: None, started_at: now() });
            (job, st.batch_done + 1, st.batch_total)
        };
        emit(app, "updates.changed", json!({}));
        log::info(format!("mises à jour : {} ({} → {})", job.id, job.version, job.available));

        let mut args: Vec<&str> = vec!["upgrade", "--id", &job.id, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
        if parse::valid_source(&job.source) {
            args.push("--source");
            args.push(&job.source);
        }
        let mut phase = Phase::Prepare;
        let mut pct: Option<f64> = None;
        let mut last_sent = Instant::now() - Duration::from_secs(1);
        let out = run_compat(&winget, &args, UPGRADE_TIMEOUT, |segment| {
            let mut changed = false;
            if let Some(p) = parse::phase_of(segment) {
                if p != phase {
                    phase = p;
                    // Une nouvelle phase repart de zéro (le téléchargement n'est pas l'installation).
                    pct = None;
                    changed = true;
                }
            }
            if let Some(p) = parse::progress_pct(segment) {
                pct = Some(p);
                changed = true;
            }
            if changed && last_sent.elapsed() >= Duration::from_millis(250) {
                last_sent = Instant::now();
                if let Some(r) = state.locked().current.as_mut() {
                    r.phase = phase;
                    r.pct = pct;
                }
                emit(app, "updates.progress", json!({ "id": job.id, "phase": phase, "pct": pct, "index": index, "total": total }));
            }
        });
        let (result, code) = match out {
            Ok(o) if o.timed_out => (Outcome::Timeout, String::new()),
            Ok(o) => (parse::outcome(o.code, &o.text), if o.code == Some(0) { String::new() } else { parse::code_hex(o.code) }),
            Err(e) => {
                log::warn(format!("mises à jour : {e}"));
                (Outcome::Failed, String::new())
            }
        };
        log::info(format!("mises à jour : {} → {result:?} {code}", job.id));
        match result {
            Outcome::Reboot => {
                tally.ok += 1;
                tally.reboot += 1;
            }
            r if r.success() => tally.ok += 1,
            _ => tally.failed += 1,
        }
        {
            let mut st = state.locked();
            st.current = None;
            st.batch_done += 1;
            if result.success() {
                st.saved.packages.retain(|p| !p.id.eq_ignore_ascii_case(&job.id));
                save(&st.saved);
            }
            push_done(&mut st, &job, result, code);
        }
        // Ondine réagit un peu, pas plus : contente, songeuse, ou qui bâille (redémarrage).
        let emotion = match result {
            Outcome::Ok | Outcome::UpToDate => "cheer",
            Outcome::Reboot => "yawn",
            Outcome::Cancelled => "shy",
            _ => "pensive",
        };
        emit(app, "mascot.emote", json!({ "emotion": emotion, "intensity": 0.6 }));
        emit(app, "updates.changed", json!({}));
    }
    tally
}

fn push_done(st: &mut State, job: &Job, outcome: Outcome, code: String) {
    st.done.retain(|d| !d.id.eq_ignore_ascii_case(&job.id));
    st.done.push(Done { id: job.id.clone(), name: job.name.clone(), available: job.available.clone(), outcome, code, at: now() });
    if st.done.len() > MAX_DONE {
        let extra = st.done.len() - MAX_DONE;
        st.done.drain(..extra);
    }
}

// ── Le module ────────────────────────────────────────────────────────────────

fn arg_id(args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if parse::valid_id(&id) {
        Ok(id)
    } else {
        Err("ID d'appli invalide".into())
    }
}

impl Updates {
    fn status(&self, app: &AppHandle) -> Value {
        let ignored = ignored(app);
        let mut st = self.state.locked();
        st.ensure_loaded();
        let packages: Vec<Value> = st
            .saved
            .packages
            .iter()
            .map(|p| {
                let mut v = serde_json::to_value(p).unwrap_or(Value::Null);
                if let Some(o) = v.as_object_mut() {
                    o.insert("ignored".into(), Value::Bool(parse::is_ignored(&ignored, &p.id)));
                }
                v
            })
            .collect();
        json!({
            "missing": st.missing,
            "checking": st.checking,
            "lastCheck": st.saved.last_check,
            "error": st.error,
            "packages": packages,
            "ignored": ignored,
            "queue": st.queue.iter().collect::<Vec<_>>(),
            "current": st.current,
            "done": st.done,
            "batch": { "total": st.batch_total, "done": st.batch_done },
        })
    }
}

impl RustModule for Updates {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/updates/manifest.json")
    }

    /// La vérification automatique (réglage `checkEvery`, coupée par défaut) :
    /// un coup d'œil chaque minute, la première fois 3 minutes après le démarrage.
    fn start(&self, app: &AppHandle) {
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(180));
            loop {
                let tick = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if !super::is_active(&app, ID) {
                        return;
                    }
                    let every = settings(&app).get("checkEvery").and_then(Value::as_str).unwrap_or("off").to_string();
                    let last = {
                        let mut st = state.locked();
                        st.ensure_loaded();
                        st.saved.last_check
                    };
                    if parse::check_due(&every, last, now()) {
                        start_check(&app, &state, true);
                    }
                }));
                if tick.is_err() {
                    log::error("mises à jour : la vérification automatique a planté");
                }
                std::thread::sleep(Duration::from_secs(60));
            }
        });
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let app = ctx.app;
        match command {
            // {} → l'état complet (liste, file, résultats, erreurs)
            "status" => Ok(self.status(app)),
            // {} → { started } ; la suite arrive par « updates.changed » et « updates.available »
            "check" => {
                ctx.require("network")?;
                Ok(json!({ "started": start_check(app, &self.state, false) }))
            }
            // { ids: [..] } → { added }
            "upgrade" => {
                ctx.require("network")?;
                let ids: Vec<String> = args.get("ids").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
                if ids.is_empty() || ids.len() > 200 {
                    return Err("aucune appli choisie".into());
                }
                Ok(json!({ "added": enqueue(app, &self.state, &ids)? }))
            }
            // {} → { added } : toutes celles de la liste, sauf les ignorées
            "upgrade_all" => {
                ctx.require("network")?;
                let ignored = ignored(app);
                let ids: Vec<String> = {
                    let mut st = self.state.locked();
                    st.ensure_loaded();
                    st.saved.packages.iter().filter(|p| !parse::is_ignored(&ignored, &p.id)).map(|p| p.id.clone()).collect()
                };
                if ids.is_empty() {
                    return Ok(json!({ "added": 0 }));
                }
                Ok(json!({ "added": enqueue(app, &self.state, &ids)? }))
            }
            // { id } : retire de la file une mise à jour qui n'a pas commencé
            "cancel" => {
                let id = arg_id(&args)?;
                let removed = {
                    let mut st = self.state.locked();
                    let before = st.queue.len();
                    st.queue.retain(|j| !j.id.eq_ignore_ascii_case(&id));
                    let removed = before - st.queue.len();
                    st.batch_total = st.batch_total.saturating_sub(removed);
                    removed > 0
                };
                emit(app, "updates.changed", json!({}));
                Ok(json!({ "removed": removed }))
            }
            // {} : vide la file (celle qui tourne continue)
            "cancel_all" => {
                {
                    let mut st = self.state.locked();
                    let n = st.queue.len();
                    st.queue.clear();
                    st.batch_total = st.batch_total.saturating_sub(n);
                }
                emit(app, "updates.changed", json!({}));
                Ok(Value::Null)
            }
            // {} : oublie les résultats affichés
            "clear_done" => {
                self.state.locked().done.clear();
                emit(app, "updates.changed", json!({}));
                Ok(Value::Null)
            }
            // { id, ignore } : « Ne plus proposer » (ou le contraire), dans le réglage `ignored`
            "ignore" => {
                let id = arg_id(&args)?;
                let on = args.get("ignore").and_then(Value::as_bool).unwrap_or(true);
                let shared = app.state::<crate::Shared>();
                crate::update_settings(app, &shared, |current| {
                    let mut next = current.clone();
                    let enabled = current.module_enabled(ID);
                    let entry = next.modules.entry(ID.to_string()).or_insert_with(|| crate::services::settings::ModuleSettings { enabled, values: Default::default() });
                    let text = entry.values.get("ignored").and_then(Value::as_str).unwrap_or("").to_string();
                    entry.values.insert("ignored".into(), Value::String(parse::with_ignored(&text, &id, on)));
                    Ok(next)
                })?;
                emit(app, "updates.changed", json!({}));
                let ignored = ignored(app);
                let count = {
                    let st = self.state.locked();
                    st.saved.packages.iter().filter(|p| !parse::is_ignored(&ignored, &p.id)).count()
                };
                emit(app, "updates.available", json!({ "count": count, "fresh": 0, "scheduled": false }));
                Ok(Value::Null)
            }
            // { id } : la même mise à jour dans une console en administrateur
            // (Windows demande la permission ; la console attend une touche à la fin).
            "upgrade_admin" => {
                ctx.require("network")?;
                let id = arg_id(&args)?;
                let known = {
                    let mut st = self.state.locked();
                    st.ensure_loaded();
                    st.saved.packages.iter().any(|p| p.id.eq_ignore_ascii_case(&id))
                };
                if !known {
                    return Err(format!("{id} n'est pas dans la liste : vérifiez de nouveau."));
                }
                let winget = winget_path().ok_or("winget n'est pas installé")?;
                // L'ID est vérifié (valid_id) : pas d'espace ni de guillemet, il ne peut rien ajouter à la ligne.
                let params = format!("upgrade --id {id} -e --accept-package-agreements --accept-source-agreements --wait");
                platform::run_as_admin(&winget.display().to_string(), &params)?;
                ctx.log_info(format!("mises à jour : {id} lancé en administrateur"));
                Ok(Value::Null)
            }
            // {} : la page d'App Installer dans le Microsoft Store
            "get_winget" => {
                platform::shell_open(APP_INSTALLER_URI)?;
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// « updates.check » (le Lanceur) : une vérification, comme le bouton.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic == "updates.check" && ctx.require("network").is_ok() {
            start_check(ctx.app, &self.state, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manifest_declares_what_the_module_uses() {
        let m: serde_json::Value = serde_json::from_str(include_str!("../../../src/modules/updates/manifest.json")).unwrap();
        let commands: Vec<&str> = m["commands"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        for c in ["status", "check", "upgrade", "upgrade_all", "cancel", "cancel_all", "clear_done", "ignore", "upgrade_admin", "get_winget"] {
            assert!(commands.contains(&c), "{c}");
        }
        let emits: Vec<&str> = m["events"]["emits"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        for t in ["updates.changed", "updates.progress", "updates.available", "updates.finished", "task.started", "task.finished", "task.failed", "mascot.emote"] {
            assert!(emits.contains(&t), "{t}");
        }
        // Coupée par défaut : la vérification automatique.
        let every = m["settings"]["fields"].as_array().unwrap().iter().find(|f| f["key"] == "checkEvery").unwrap();
        assert_eq!(every["default"], "off");
    }

    #[test]
    fn saved_state_round_trips() {
        let saved = Saved {
            last_check: Some(42),
            packages: vec![Package { name: "Git".into(), id: "Git.Git".into(), version: "1".into(), available: "2".into(), source: "winget".into(), truncated: false, explicit: false }],
        };
        let text = serde_json::to_string(&saved).unwrap();
        let back: Saved = serde_json::from_str(&text).unwrap();
        assert_eq!(back.last_check, Some(42));
        assert_eq!(back.packages, saved.packages);
        // Un fichier abîmé ou ancien : des valeurs par défaut.
        let partial: Saved = serde_json::from_str("{\"lastCheck\": 7}").unwrap();
        assert!(partial.packages.is_empty());
    }

    #[test]
    fn queue_bookkeeping() {
        let mut st = State::default();
        let job = Job { id: "Git.Git".into(), name: "Git".into(), version: "1".into(), available: "2".into(), source: "winget".into() };
        for _ in 0..(MAX_DONE + 5) {
            push_done(&mut st, &job, Outcome::Ok, String::new());
        }
        // Un seul résultat par appli.
        assert_eq!(st.done.len(), 1);
        for i in 0..(MAX_DONE + 5) {
            let j = Job { id: format!("A.B{i}"), ..job.clone() };
            push_done(&mut st, &j, Outcome::Failed, "0x1".into());
        }
        assert_eq!(st.done.len(), MAX_DONE);
        assert_eq!(st.done.last().unwrap().id, format!("A.B{}", MAX_DONE + 4));
    }

    #[test]
    fn ids_from_the_front_are_checked() {
        assert_eq!(arg_id(&json!({ "id": " Git.Git " })).unwrap(), "Git.Git");
        assert!(arg_id(&json!({ "id": "--all" })).is_err());
        assert!(arg_id(&json!({ "id": "a b" })).is_err());
        assert!(arg_id(&json!({})).is_err());
    }
}
