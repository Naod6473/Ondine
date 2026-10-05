// Le thread de surveillance des règles :
//   - les dossiers surveillés (crate `notify`, qui utilise ReadDirectoryChangesW
//     sous Windows) : un nouveau fichier est mis « en attente » ;
//   - un fichier en attente n'est traité que quand il ne bouge plus (même
//     taille pendant 1,5 s) : un téléchargement ou une copie en cours ne
//     déclenche rien avant d'être fini ;
//   - les lecteurs (toutes les 2 s) : une nouvelle lettre = lecteur branché,
//     une lettre disparue = lecteur débranché.
//
// Tout passe par `modules::with_context` : module désactivé = rien ne se passe.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::AppHandle;

use super::{model, Msg, Shared, ID};
use crate::platform::{self, DriveInfo};
use crate::services::log;

/// Un fichier qui ne change plus pendant ce temps est considéré comme fini.
const STABLE_FOR: Duration = Duration::from_millis(1500);
const DRIVES_EVERY: Duration = Duration::from_secs(2);
/// Garde-fou : pas plus de fichiers en attente que ça (un dossier énorme copié d'un coup).
const MAX_PENDING: usize = 500;

/// Un fichier arrivé, en attente qu'il ne bouge plus.
struct Pending {
    size: u64,
    since: Instant,
}

pub fn run(app: AppHandle, state: Shared, tx: Sender<Msg>, rx: Receiver<Msg>) {
    let mut watchers: Vec<RecommendedWatcher> = Vec::new();
    let mut pending: HashMap<PathBuf, Pending> = HashMap::new();
    let mut drives: Option<Vec<DriveInfo>> = None;
    let mut last_drives = Instant::now() - DRIVES_EVERY;
    let mut was_active = false;
    // On démarre en construisant la surveillance.
    let _ = tx.send(Msg::Rebuild);

    loop {
        let msg = rx.recv_timeout(Duration::from_millis(500));
        // Une panique ici ne doit tuer ni le thread ni l'île.
        let step = catch_unwind(AssertUnwindSafe(|| {
            let active = crate::modules::is_active(&app, ID);
            if active != was_active {
                was_active = active;
                // Activé ou désactivé dans les réglages : on refait tout.
                watchers = if active { build(&state, &tx) } else { Vec::new() };
                pending.clear();
                drives = None;
                super::apply_hotkeys(&app, &state);
            }
            match msg {
                Ok(Msg::Rebuild) if active => watchers = build(&state, &tx),
                Ok(Msg::Fs(Ok(event))) if active => collect(&state, event, &mut pending),
                Ok(Msg::Fs(Err(e))) => log::warn(format!("règles : surveillance : {e}")),
                Err(RecvTimeoutError::Disconnected) => return false,
                _ => {}
            }
            if !active {
                return true;
            }
            process_pending(&app, &state, &mut pending);
            if last_drives.elapsed() >= DRIVES_EVERY {
                last_drives = Instant::now();
                check_drives(&app, &state, &mut drives);
            }
            true
        }));
        match step {
            Ok(true) => {}
            Ok(false) => return,
            Err(_) => log::warn("règles : erreur inattendue dans la surveillance, on continue"),
        }
    }
}

/// (Re)crée un observateur par dossier surveillé. Un dossier introuvable est
/// signalé sur sa règle (et réessayé au prochain changement de règles).
fn build(state: &Shared, tx: &Sender<Msg>) -> Vec<RecommendedWatcher> {
    let mut out = Vec::new();
    for (id, folder, subfolders) in super::watched_folders(state) {
        let tx = tx.clone();
        let result = notify::recommended_watcher(move |res| {
            let _ = tx.send(Msg::Fs(res));
        })
        .and_then(|mut w| {
            let mode = if subfolders { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
            w.watch(&folder, mode).map(|_| w)
        });
        match result {
            Ok(w) => {
                super::set_error(state, id, None);
                out.push(w);
            }
            Err(e) => {
                log::warn(format!("règles : impossible de surveiller {} : {e}", folder.display()));
                super::set_error(state, id, Some(format!("dossier introuvable ou inaccessible : {}", folder.display())));
            }
        }
    }
    out
}

/// Note les fichiers créés ou arrivés par renommage (un téléchargement qui
/// finit : « film.mkv.crdownload » devient « film.mkv »).
fn collect(state: &Shared, event: notify::Event, pending: &mut HashMap<PathBuf, Pending>) {
    let path = match event.kind {
        EventKind::Create(_) => event.paths.first(),
        EventKind::Modify(ModifyKind::Name(RenameMode::To | RenameMode::Any)) => event.paths.first(),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => event.paths.get(1),
        // Un fichier qui grossit : on remet son compteur à zéro s'il est déjà en attente.
        EventKind::Modify(_) => {
            for p in &event.paths {
                if let Some(entry) = pending.get_mut(p) {
                    entry.since = Instant::now();
                }
            }
            None
        }
        _ => None,
    };
    let Some(path) = path else { return };
    if model::is_temporary(path) || super::recently_produced(state, path) || pending.len() >= MAX_PENDING {
        return;
    }
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    pending.insert(path.clone(), Pending { size, since: Instant::now() });
}

/// Traite les fichiers qui ne bougent plus.
fn process_pending(app: &AppHandle, state: &Shared, pending: &mut HashMap<PathBuf, Pending>) {
    let mut ready = Vec::new();
    pending.retain(|path, p| {
        let Ok(meta) = std::fs::metadata(path) else { return false }; // disparu
        if !meta.is_file() {
            return false; // un dossier : les règles ne traitent que des fichiers
        }
        if meta.len() != p.size {
            p.size = meta.len();
            p.since = Instant::now();
            return true;
        }
        if p.since.elapsed() < STABLE_FOR {
            return true;
        }
        ready.push(path.clone());
        false
    });

    for path in ready {
        if super::recently_produced(state, &path) {
            continue;
        }
        let rules = super::file_rules_for(state, &path);
        if rules.is_empty() {
            continue;
        }
        crate::modules::with_context(app, ID, |ctx| {
            // Un sous-dossier exclu dans les réglages de confidentialité : on n'y touche pas.
            let Ok(checked) = ctx.check_path(&path.display().to_string()) else { return };
            let label = super::file_name(&checked);
            for rule in rules {
                // Une règle précédente a pu déplacer le fichier : on s'arrête là.
                if !checked.exists() {
                    break;
                }
                super::fire(ctx, state, &rule, Some(checked.clone()), &label);
            }
        });
    }
}

/// Compare les lecteurs présents avec ceux vus la dernière fois.
fn check_drives(app: &AppHandle, state: &Shared, known: &mut Option<Vec<DriveInfo>>) {
    let previous = known.clone().unwrap_or_default();
    let now = platform::drives(&previous);
    // Premier passage : on note ce qui est déjà branché, sans rien déclencher.
    let Some(before) = known.replace(now.clone()) else { return };

    let added: Vec<&DriveInfo> = now.iter().filter(|d| !before.iter().any(|b| b.root == d.root)).collect();
    let removed: Vec<&DriveInfo> = before.iter().filter(|b| !now.iter().any(|d| d.root == b.root)).collect();
    for (drive, gone) in added.into_iter().map(|d| (d, false)).chain(removed.into_iter().map(|d| (d, true))) {
        // « KINGSTON (E:) », ou « Lecteur (E:) » sans nom de volume.
        let letter = drive.root.trim_end_matches('\\');
        let label = if drive.label.is_empty() { format!("Lecteur ({letter})") } else { format!("{} ({letter})", drive.label) };
        let rules = super::drive_rules_for(state, gone, &label);
        if rules.is_empty() {
            continue;
        }
        crate::modules::with_context(app, ID, |ctx| {
            // Un lecteur exclu dans les réglages de confidentialité : on n'y touche pas.
            let subject = if gone {
                None
            } else {
                match ctx.check_path(&drive.root) {
                    Ok(p) => Some(p),
                    Err(_) => return,
                }
            };
            for rule in rules {
                let subject = subject.clone();
                super::fire(ctx, state, &rule, subject, &label);
            }
        });
    }
}
