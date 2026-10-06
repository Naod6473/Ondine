// Module « Étagère » : ce qu'on fait des fichiers glissés sur l'île.
//
//   - l'étagère elle-même : une liste TEMPORAIRE de chemins (en mémoire, vidée
//     quand l'île s'arrête). Rien n'est copié : on retient seulement où sont les
//     fichiers, pour agir dessus plus tard ;
//   - les actions : Corbeille, copier vers, déplacer vers, copier le chemin,
//     compresser, montrer dans l'Explorateur ;
//   - les outils (shelf_tools.rs) : convertir / réduire des images, renommer
//     plusieurs fichiers selon un modèle ;
//   - Téléchargements (réglage) : un fichier qui vient d'arriver dans le dossier
//     Téléchargements est posé tout seul sur l'étagère, une fois fini (taille
//     stable, plus de « .crdownload » / « .part »).
//
// Règles appliquées ici :
//   - chaque chemin reçu du front est validé (ctx.check_path : chemin absolu,
//     existant, hors des dossiers exclus) ;
//   - toute action qui touche aux fichiers propose « Annuler » (ctx.offer_undo) ;
//   - jamais de suppression définitive : défaire une copie envoie la copie à la
//     Corbeille, et une suppression passe toujours par la Corbeille.
//
// Le manifeste est le même fichier que celui du front (src/modules/shelf/manifest.json).

use crate::sync::LockExt;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::AppHandle;

use super::shelf_tools::{self, OutFormat};
use super::{ModuleContext, RustModule};
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::bus::BusMessage;
use crate::services::{bus, files, search};
use crate::services::perf::{self, Loop};
use crate::platform::drag_out;

/// Au-delà, on refuse d'ajouter : l'étagère est un endroit de passage.
const MAX_ITEMS: usize = 100;

/// La liste des chemins posés sur l'étagère. Arc : partagée avec les fonctions
/// d'annulation, qui doivent pouvoir la remettre en état.
type Items = Arc<Mutex<Vec<PathBuf>>>;

#[derive(Default)]
pub struct Shelf {
    items: Items,
}

impl RustModule for Shelf {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/shelf/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, items) = (app.clone(), self.items.clone());
        std::thread::spawn(move || watch_downloads(app, items));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "list" => Ok(list_json(&self.items)),
            // { query, limit } → { items } : la recherche du Lanceur (noms de fichiers).
            "search" => Ok(search_json(ctx, &self.items, &args)),
            // { path } : ouvre un élément de l'étagère (un programme est montré
            // dans l'Explorateur au lieu d'être lancé).
            "open" => {
                let path = args.get("path").and_then(Value::as_str).ok_or("paramètre « path » manquant")?;
                let path = ctx.check_path(path)?;
                if !self.items.locked().contains(&path) {
                    return Err("cet élément n'est plus sur l'étagère".into());
                }
                let revealed = super::launcher::open_checked(&path)?;
                Ok(json!({ "revealed": revealed }))
            }
            "add" => {
                let added = self.add(ctx, &args)?;
                Ok(json!({ "added": added }))
            }
            "remove" => {
                // Retirer de l'étagère ne touche pas au fichier : pas de check_path
                // (le fichier a pu disparaître entre-temps).
                let paths = raw_paths(&args)?;
                self.items.locked().retain(|p| !paths.contains(p));
                changed(ctx.app, &self.items);
                Ok(Value::Null)
            }
            "clear" => {
                let before = std::mem::take(&mut *self.items.locked());
                changed(ctx.app, &self.items);
                if !before.is_empty() {
                    let (items, app) = (self.items.clone(), ctx.app.clone());
                    let n = before.len();
                    ctx.offer_undo(
                        &format!("Étagère vidée ({n} élément(s))"),
                        DEFAULT_WINDOW,
                        Box::new(move || {
                            *items.locked() = before;
                            changed(&app, &items);
                            Ok(())
                        }),
                    );
                }
                Ok(Value::Null)
            }
            "copy_paths" => {
                ctx.require("clipboard")?;
                let paths = checked_paths(ctx, &args)?;
                let text: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();
                files::copy_text(&text.join("\r\n"))?;
                ctx.log_info(format!("{} chemin(s) copié(s)", paths.len()));
                Ok(json!({ "count": paths.len() }))
            }
            "reveal" => {
                let paths = checked_paths(ctx, &args)?;
                files::reveal(&paths[0])?;
                Ok(Value::Null)
            }
            "trash" => self.trash(ctx, &args),
            // { paths } : glisser vers l'Explorateur / le Bureau (Windows).
            "drag_out" => self.drag_out(ctx, &args),
            "copy_to" => self.copy_to(ctx, &args),
            "move_to" => self.move_to(ctx, &args),
            "compress" => self.compress(ctx, &args),
            // { paths, format: "same"|"png"|"jpeg", maxWidth: 0 (= garder) | px, quality: 30..100 }
            "images" => images(ctx, &args),
            // { paths, pattern, start } → [{ from, to }] : l'aperçu, rien n'est renommé.
            "rename_preview" => {
                let paths = tool_paths(ctx, &args)?;
                let plan = shelf_tools::rename_plan(&paths, arg_str(&args, "pattern"), arg_start(&args))?;
                Ok(json!(plan
                    .iter()
                    .map(|(a, b)| json!({ "from": shelf_tools::file_name(a), "to": shelf_tools::file_name(b) }))
                    .collect::<Vec<_>>()))
            }
            // Pareil, mais pour de vrai (après le bouton de confirmation du front).
            "rename" => self.rename(ctx, &args),
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// "shelf.add" `{paths}` : un autre module (ex. Capture) pose des fichiers
    /// sur l'étagère. Les chemins sont validés comme ceux du glisser-déposer.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic == "shelf.add" {
            if let Err(e) = self.add(ctx, &msg.payload) {
                ctx.log_warn(format!("ajout à l'étagère refusé : {e}"));
            }
        }
    }
}

impl Shelf {
    /// Renomme selon le modèle. Annuler = chacun reprend son ancien nom.
    fn rename(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let paths = tool_paths(ctx, args)?;
        let plan = shelf_tools::rename_plan(&paths, arg_str(args, "pattern"), arg_start(args))?;
        let done = shelf_tools::apply_renames(&plan)?;
        // L'étagère suit les fichiers renommés.
        {
            let mut items = self.items.locked();
            for (old, new) in &done {
                if let Some(slot) = items.iter_mut().find(|p| *p == old) {
                    *slot = new.clone();
                }
            }
        }
        changed(ctx.app, &self.items);
        ctx.log_info(format!("{} fichier(s) renommé(s)", done.len()));
        let count = done.len();
        let (items, app) = (self.items.clone(), ctx.app.clone());
        let undo_id = ctx.offer_undo(
            &format!("{count} fichier(s) renommé(s)"),
            DEFAULT_WINDOW,
            Box::new(move || {
                shelf_tools::undo_renames(&done)?;
                let mut list = items.locked();
                for (old, new) in &done {
                    if let Some(slot) = list.iter_mut().find(|p| *p == new) {
                        *slot = old.clone();
                    }
                }
                drop(list);
                changed(&app, &items);
                Ok(())
            }),
        );
        Ok(json!({ "count": count, "undoId": undo_id }))
    }

    /// Pose des chemins sur l'étagère (chacun validé) et renvoie combien sont nouveaux.
    fn add(&self, ctx: &ModuleContext, args: &Value) -> Result<usize, String> {
        let paths = checked_paths(ctx, args)?;
        let added = {
            let mut items = self.items.locked();
            let mut added = 0;
            for p in paths {
                if items.len() >= MAX_ITEMS {
                    break;
                }
                if !items.contains(&p) {
                    items.push(p);
                    added += 1;
                }
            }
            added
        };
        changed(ctx.app, &self.items);
        Ok(added)
    }

    /// Corbeille. Annuler = ressortir chaque élément de la Corbeille.
    fn trash(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let paths = checked_paths(ctx, args)?;
        files::to_trash(&paths)?;
        ctx.log_info(format!("{} élément(s) envoyé(s) à la Corbeille", paths.len()));
        // Ce qui était sur l'étagère en part, et y revient si on annule.
        let was_on_shelf = take_from_shelf(&self.items, &paths);
        changed(ctx.app, &self.items);

        let (items, app) = (self.items.clone(), ctx.app.clone());
        let count = paths.len();
        let undo_id = ctx.offer_undo(
            &format!("{} à la Corbeille", label(&paths)),
            DEFAULT_WINDOW,
            Box::new(move || {
                let mut errors = Vec::new();
                for p in &paths {
                    if let Err(e) = files::restore_from_trash(p) {
                        errors.push(e);
                    }
                }
                items.locked().extend(was_on_shelf);
                changed(&app, &items);
                if errors.is_empty() { Ok(()) } else { Err(errors.join(" ; ")) }
            }),
        );
        Ok(json!({ "count": count, "undoId": undo_id }))
    }

    /// Copie dans un dossier. Annuler = envoyer les copies à la Corbeille.
    fn copy_to(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let paths = checked_paths(ctx, args)?;
        let dest = checked_dest(ctx, args)?;
        ctx.emit("task.started", json!({ "label": "Copie" }));
        let mut created = Vec::new();
        let mut error = None;
        for p in &paths {
            match files::copy_into(p, &dest) {
                Ok(c) => created.push(c),
                Err(e) => {
                    error = Some(e);
                    break;
                }
            }
        }
        finish_task(ctx, "Copie", &error);
        if created.is_empty() {
            return Err(error.unwrap_or_else(|| "rien n'a été copié".into()));
        }
        ctx.log_info(format!("{} élément(s) copié(s)", created.len()));
        let undo_id = ctx.offer_undo(
            &format!("{} copié(s) dans {}", label(&paths), folder_name(&dest)),
            DEFAULT_WINDOW,
            Box::new(move || files::to_trash(&created)),
        );
        Ok(json!({ "count": paths.len(), "error": error, "undoId": undo_id }))
    }

    /// Déplace dans un dossier. Annuler = remettre chaque élément à sa place.
    fn move_to(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let paths = checked_paths(ctx, args)?;
        let dest = checked_dest(ctx, args)?;
        ctx.emit("task.started", json!({ "label": "Déplacement" }));
        // (ancien chemin, nouveau chemin) pour pouvoir revenir en arrière.
        let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
        let mut error = None;
        for p in &paths {
            match files::move_into(p, &dest) {
                Ok(new) => moves.push((p.clone(), new)),
                Err(e) => {
                    error = Some(e);
                    break;
                }
            }
        }
        finish_task(ctx, "Déplacement", &error);
        if moves.is_empty() {
            return Err(error.unwrap_or_else(|| "rien n'a été déplacé".into()));
        }
        ctx.log_info(format!("{} élément(s) déplacé(s)", moves.len()));
        // Sur l'étagère, les éléments suivent leur nouveau chemin.
        rename_on_shelf(&self.items, moves.iter().map(|(a, b)| (a, b)));
        changed(ctx.app, &self.items);

        let (items, app) = (self.items.clone(), ctx.app.clone());
        let undo_id = ctx.offer_undo(
            &format!("{} déplacé(s) dans {}", label(&paths), folder_name(&dest)),
            DEFAULT_WINDOW,
            Box::new(move || {
                let mut errors = Vec::new();
                for (old, new) in &moves {
                    // move_to refuse d'écraser : si quelque chose a pris la place
                    // entre-temps, on le signale au lieu de remplacer.
                    if let Err(e) = files::move_to(new, old) {
                        errors.push(e);
                    }
                }
                rename_on_shelf(&items, moves.iter().map(|(a, b)| (b, a)));
                changed(&app, &items);
                if errors.is_empty() { Ok(()) } else { Err(errors.join(" ; ")) }
            }),
        );
        Ok(json!({ "count": paths.len(), "error": error, "undoId": undo_id }))
    }

    /// Glisser des éléments de l'étagère vers l'Explorateur, le Bureau ou une
    /// autre appli (vrai glisser-déposer de Windows, voir platform/drag_out.rs).
    /// C'est la cible qui copie ou déplace ; ensuite, ce qui a quitté sa place
    /// quitte aussi l'étagère (on ne sait pas où la cible l'a mis).
    fn drag_out(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let paths = checked_paths(ctx, args)?;
        let effect = drag_out::effect_name(crate::platform::drag_out::drag_files(ctx.app, &paths)?);
        ctx.log_info(format!("{} élément(s) glissé(s) hors de l'île ({effect})", paths.len()));
        let removed = forget_gone(&self.items, &paths, |p| p.exists());
        if removed > 0 {
            changed(ctx.app, &self.items);
        }
        // L'Explorateur peut finir le déplacement APRÈS le lâcher (gros fichiers,
        // autre disque) : on regarde encore un peu. Une copie ne fait rien partir.
        if effect != "copy" && effect != "link" && removed < paths.len() {
            let (items, app) = (self.items.clone(), ctx.app.clone());
            std::thread::spawn(move || {
                for wait in AFTER_DRAG_CHECKS {
                    std::thread::sleep(std::time::Duration::from_millis(*wait));
                    if forget_gone(&items, &paths, |p| p.exists()) > 0 {
                        changed(&app, &items);
                    }
                    if paths.iter().all(|p| !p.exists()) {
                        break;
                    }
                }
            });
        }
        Ok(json!({ "effect": effect, "removed": removed }))
    }

    /// Crée une archive .zip à côté du premier élément. Annuler = archive à la Corbeille.
    fn compress(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let paths = checked_paths(ctx, args)?;
        ctx.emit("task.started", json!({ "label": "Compression" }));
        let result = files::zip(&paths);
        finish_task(ctx, "Compression", &result.as_ref().err().cloned());
        let archive = result?;
        let name = archive.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let undo_archive = archive.clone();
        let undo_id = ctx.offer_undo(
            &format!("{name} créé"),
            DEFAULT_WINDOW,
            Box::new(move || files::to_trash(&[undo_archive])),
        );
        Ok(json!({ "archive": archive.display().to_string(), "name": name, "undoId": undo_id }))
    }
}

// ── Petits outils ────────────────────────────────────────────────────────────

/// Les chemins de `args.paths`, sans validation (pour « retirer de l'étagère »).
fn raw_paths(args: &Value) -> Result<Vec<PathBuf>, String> {
    let list = args.get("paths").and_then(Value::as_array).ok_or("paramètre « paths » manquant")?;
    Ok(list.iter().filter_map(Value::as_str).map(PathBuf::from).collect())
}

/// Les chemins de `args.paths`, chacun validé. Un seul chemin refusé = tout refusé :
/// on préfère ne rien faire que faire la moitié d'une action.
fn checked_paths(ctx: &ModuleContext, args: &Value) -> Result<Vec<PathBuf>, String> {
    let list = args.get("paths").and_then(Value::as_array).ok_or("paramètre « paths » manquant")?;
    let mut out = Vec::new();
    for raw in list.iter().filter_map(Value::as_str) {
        let p = ctx.check_path(raw)?;
        if !out.contains(&p) {
            out.push(p);
        }
    }
    if out.is_empty() {
        return Err("aucun fichier".into());
    }
    Ok(out)
}

/// Le dossier de destination `args.dest`, validé comme les autres chemins.
fn checked_dest(ctx: &ModuleContext, args: &Value) -> Result<PathBuf, String> {
    let raw = args.get("dest").and_then(Value::as_str).ok_or("dossier de destination manquant")?;
    let dest = ctx.check_path(raw)?;
    if !dest.is_dir() {
        return Err(format!("{} n'est pas un dossier", dest.display()));
    }
    Ok(dest)
}

/// Prévient la mascotte que la tâche est finie (ou ratée).
fn finish_task(ctx: &ModuleContext, what: &str, error: &Option<String>) {
    match error {
        None => ctx.emit("task.finished", json!({ "label": what })),
        Some(_) => ctx.emit("task.failed", json!({ "label": what })),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

fn arg_start(args: &Value) -> u32 {
    args.get("start").and_then(Value::as_u64).unwrap_or(1).min(99_999) as u32
}

/// Les chemins d'un outil : validés, des fichiers (pas des dossiers), 100 au plus.
fn tool_paths(ctx: &ModuleContext, args: &Value) -> Result<Vec<PathBuf>, String> {
    let paths: Vec<PathBuf> = checked_paths(ctx, args)?.into_iter().filter(|p| p.is_file()).collect();
    if paths.is_empty() {
        return Err("aucun fichier (les dossiers sont ignorés)".into());
    }
    if paths.len() > shelf_tools::MAX_FILES {
        return Err(format!("au plus {} fichiers à la fois", shelf_tools::MAX_FILES));
    }
    Ok(paths)
}

/// Convertit / réduit les images. Annuler = les nouvelles images vont à la Corbeille.
fn images(ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
    let paths = tool_paths(ctx, args)?;
    let format = OutFormat::parse(arg_str(args, "format")).ok_or("format inconnu")?;
    let max_width = args.get("maxWidth").and_then(Value::as_u64).filter(|w| *w > 0).map(|w| w.clamp(16, 16_384) as u32);
    let quality = args.get("quality").and_then(Value::as_u64).unwrap_or(85).clamp(30, 100) as u8;
    if format == OutFormat::Same && max_width.is_none() {
        return Err("choisissez un format ou une taille : sinon l'image ne change pas".into());
    }
    ctx.emit("task.started", json!({ "label": "Images" }));
    let mut created = Vec::new();
    let mut errors = Vec::new();
    for p in &paths {
        match shelf_tools::convert_image(p, format, max_width, quality) {
            Ok(c) => created.push(c),
            Err(e) => errors.push(e),
        }
    }
    let error = errors.first().cloned();
    finish_task(ctx, "Images", &error);
    if created.is_empty() {
        return Err(error.unwrap_or_else(|| "aucune image créée".into()));
    }
    ctx.log_info(format!("{} image(s) créée(s)", created.len()));
    let count = created.len();
    let undo_id = ctx.offer_undo(
        &format!("{count} image(s) créée(s) à côté des originales"),
        DEFAULT_WINDOW,
        Box::new(move || files::to_trash(&created)),
    );
    Ok(json!({ "count": count, "failed": errors.len(), "error": error, "undoId": undo_id }))
}

/// « rapport.pdf » ou « 3 éléments ».
fn label(paths: &[PathBuf]) -> String {
    match paths {
        [one] => one.file_name().map(|n| format!("« {} »", n.to_string_lossy())).unwrap_or_else(|| "1 élément".into()),
        many => format!("{} éléments", many.len()),
    }
}

fn folder_name(dir: &std::path::Path) -> String {
    dir.file_name().map(|n| format!("« {} »", n.to_string_lossy())).unwrap_or_else(|| dir.display().to_string())
}

/// Retire `paths` de l'étagère et renvoie ceux qui y étaient.
fn take_from_shelf(items: &Items, paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut items = items.locked();
    let taken: Vec<PathBuf> = items.iter().filter(|p| paths.contains(p)).cloned().collect();
    items.retain(|p| !paths.contains(p));
    taken
}

/// Après un glisser vers l'extérieur : on regarde encore si les fichiers sont
/// partis au bout de… (ms, cumulés : jusqu'à ~1 min 50 s).
const AFTER_DRAG_CHECKS: &[u64] = &[500, 1_500, 3_000, 6_000, 12_000, 30_000, 60_000];

/// Retire de l'étagère ceux de `paths` qui n'existent plus (déplacés par la
/// cible d'un glisser) et dit combien sont partis. `exists` est passé en
/// paramètre pour les tests.
fn forget_gone(items: &Items, paths: &[PathBuf], exists: impl Fn(&std::path::Path) -> bool) -> usize {
    let gone: Vec<PathBuf> = paths.iter().filter(|p| !exists(p)).cloned().collect();
    if gone.is_empty() {
        return 0;
    }
    take_from_shelf(items, &gone).len()
}

/// Remplace sur l'étagère chaque ancien chemin par le nouveau.
fn rename_on_shelf<'a>(items: &Items, renames: impl Iterator<Item = (&'a PathBuf, &'a PathBuf)>) {
    let mut items = items.locked();
    for (from, to) in renames {
        for p in items.iter_mut().filter(|p| *p == from) {
            *p = to.clone();
        }
    }
}

/// Les éléments de l'étagère dont le nom correspond à la recherche. Ceux qui
/// sont maintenant dans un dossier exclu (ou qui ont disparu) ne sont pas montrés.
fn search_json(ctx: &ModuleContext, items: &Items, args: &Value) -> Value {
    let (query, limit) = search::args(args);
    if query.is_empty() {
        return json!({ "items": [] });
    }
    let list = items.locked().clone();
    let mut hits = Vec::new();
    // Le dernier posé sur l'étagère passe devant, à note égale.
    for (index, p) in list.iter().enumerate() {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let score = search::score(&name, &query);
        if score == 0 || ctx.check_path(&p.display().to_string()).is_err() {
            continue;
        }
        let value = json!({
            "kind": if p.is_dir() { "dir" } else { "file" },
            "path": p.display().to_string(),
            "title": name,
            "detail": p.parent().map(|d| d.display().to_string()).unwrap_or_default(),
        });
        hits.push(search::Hit { score, at: index as u64, value });
    }
    json!({ "items": search::best(hits, limit) })
}

/// La liste telle que le front l'affiche.
fn list_json(items: &Items) -> Value {
    let items = items.locked();
    let list: Vec<Value> = items
        .iter()
        .map(|p| {
            json!({
                "path": p.display().to_string(),
                "name": p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                "isDir": p.is_dir(),
                "exists": p.exists(),
            })
        })
        .collect();
    json!({ "items": list })
}

// ── Téléchargements → étagère ───────────────────────────────────────────────

/// Les fichiers en cours de téléchargement (navigateurs, gestionnaires).
fn is_partial(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with('.') || n.starts_with("~$") || [".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload"].iter().any(|e| n.ends_with(e))
}

/// Regarde le dossier Téléchargements toutes les 3 s (selon le mode de
/// performance : services/perf.rs). Un nouveau fichier est posé sur l'étagère
/// quand sa taille n'a pas bougé entre deux tours.
fn watch_downloads(app: AppHandle, items: Items) {
    // Ce qui était déjà là (nom → taille) ; et les nouveaux en attente (nom → taille vue).
    let mut known: Option<HashMap<String, u64>> = None;
    let mut waiting: HashMap<String, u64> = HashMap::new();
    loop {
        std::thread::sleep(perf::every(Loop::ShelfDownloads));
        let wanted = super::with_context(&app, "shelf", |ctx| ctx.settings().get("watchDownloads").and_then(Value::as_bool).unwrap_or(true));
        if wanted != Some(true) {
            known = None;
            waiting.clear();
            continue;
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            let Some(dir) = crate::platform::downloads_dir() else { return };
            let Ok(entries) = std::fs::read_dir(&dir) else { return };
            let mut now = HashMap::new();
            for e in entries.flatten() {
                let Ok(meta) = e.metadata() else { continue };
                if meta.is_file() {
                    now.insert(e.file_name().to_string_lossy().to_string(), meta.len());
                }
            }
            let Some(before) = known.replace(now.clone()) else { return }; // premier tour : on note
            for (name, size) in &now {
                if before.contains_key(name) && !waiting.contains_key(name) || is_partial(name) {
                    continue;
                }
                match waiting.get(name) {
                    // Même taille qu'au tour d'avant : fini.
                    Some(prev) if prev == size && *size > 0 => {
                        waiting.remove(name);
                        let path = dir.join(name);
                        super::with_context(&app, "shelf", |ctx| {
                            let args = json!({ "paths": [path.display().to_string()] });
                            if let Ok(paths) = checked_paths(ctx, &args) {
                                let mut list = items.locked();
                                if list.len() < MAX_ITEMS && !list.contains(&paths[0]) {
                                    list.push(paths[0].clone());
                                    drop(list);
                                    changed(&app, &items);
                                    ctx.emit("shelf.downloaded", json!({ "name": name }));
                                }
                            }
                        });
                    }
                    _ => {
                        waiting.insert(name.clone(), *size);
                    }
                }
            }
            // Les fichiers disparus ne sont plus attendus.
            waiting.retain(|n, _| now.contains_key(n));
        }));
        if step.is_err() {
            crate::services::log::warn("étagère : erreur pendant la surveillance des Téléchargements, on continue");
        }
    }
}

/// Prévient le front (sujet "shelf.changed") avec la nouvelle liste. Passe par
/// bus::emit directement : les fonctions d'annulation n'ont pas de ModuleContext.
fn changed(app: &AppHandle, items: &Items) {
    bus::emit(app, "shelf", "shelf.changed", list_json(items));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shelf(paths: &[&str]) -> Items {
        Arc::new(Mutex::new(paths.iter().map(PathBuf::from).collect()))
    }

    #[test]
    fn dragged_out_and_moved_leaves_the_shelf() {
        let items = shelf(&["C:/a.txt", "C:/b.txt", "C:/c.txt"]);
        let dragged = vec![PathBuf::from("C:/a.txt"), PathBuf::from("C:/b.txt")];
        // a.txt a été déplacé par l'Explorateur, b.txt copié (toujours là).
        let removed = forget_gone(&items, &dragged, |p| p != std::path::Path::new("C:/a.txt"));
        assert_eq!(removed, 1);
        assert_eq!(*items.locked(), vec![PathBuf::from("C:/b.txt"), PathBuf::from("C:/c.txt")]);
    }

    #[test]
    fn copy_or_cancel_keeps_everything() {
        let items = shelf(&["C:/a.txt", "C:/b.txt"]);
        let dragged = vec![PathBuf::from("C:/a.txt")];
        assert_eq!(forget_gone(&items, &dragged, |_| true), 0);
        assert_eq!(items.locked().len(), 2);
    }

    #[test]
    fn only_dragged_items_are_forgotten() {
        // c.txt a disparu aussi, mais il ne faisait pas partie du glisser : on
        // le laisse (l'étagère le montre « introuvable »).
        let items = shelf(&["C:/a.txt", "C:/c.txt"]);
        let dragged = vec![PathBuf::from("C:/a.txt")];
        assert_eq!(forget_gone(&items, &dragged, |_| false), 1);
        assert_eq!(*items.locked(), vec![PathBuf::from("C:/c.txt")]);
        // Un deuxième passage (vérification plus tard) ne retire rien de plus.
        assert_eq!(forget_gone(&items, &dragged, |_| false), 0);
    }
}
