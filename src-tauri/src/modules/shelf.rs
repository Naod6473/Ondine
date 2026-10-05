// Module « Étagère » : ce qu'on fait des fichiers glissés sur l'île.
//
//   - l'étagère elle-même : une liste TEMPORAIRE de chemins (en mémoire, vidée
//     quand l'île s'arrête). Rien n'est copié : on retient seulement où sont les
//     fichiers, pour agir dessus plus tard ;
//   - les actions : Corbeille, copier vers, déplacer vers, copier le chemin,
//     compresser, montrer dans l'Explorateur.
//
// Règles appliquées ici :
//   - chaque chemin reçu du front est validé (ctx.check_path : chemin absolu,
//     existant, hors des dossiers exclus) ;
//   - toute action qui touche aux fichiers propose « Annuler » (ctx.offer_undo) ;
//   - jamais de suppression définitive : défaire une copie envoie la copie à la
//     Corbeille, et une suppression passe toujours par la Corbeille.
//
// Le manifeste est le même fichier que celui du front (src/modules/shelf/manifest.json).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{bus, files};

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

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "list" => Ok(list_json(&self.items)),
            "add" => {
                let paths = checked_paths(ctx, &args)?;
                let added = {
                    let mut items = self.items.lock().unwrap();
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
                Ok(json!({ "added": added }))
            }
            "remove" => {
                // Retirer de l'étagère ne touche pas au fichier : pas de check_path
                // (le fichier a pu disparaître entre-temps).
                let paths = raw_paths(&args)?;
                self.items.lock().unwrap().retain(|p| !paths.contains(p));
                changed(ctx.app, &self.items);
                Ok(Value::Null)
            }
            "clear" => {
                let before = std::mem::take(&mut *self.items.lock().unwrap());
                changed(ctx.app, &self.items);
                if !before.is_empty() {
                    let (items, app) = (self.items.clone(), ctx.app.clone());
                    let n = before.len();
                    ctx.offer_undo(
                        &format!("Étagère vidée ({n} élément(s))"),
                        DEFAULT_WINDOW,
                        Box::new(move || {
                            *items.lock().unwrap() = before;
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
            "copy_to" => self.copy_to(ctx, &args),
            "move_to" => self.move_to(ctx, &args),
            "compress" => self.compress(ctx, &args),
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

impl Shelf {
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
                items.lock().unwrap().extend(was_on_shelf);
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
    let mut items = items.lock().unwrap();
    let taken: Vec<PathBuf> = items.iter().filter(|p| paths.contains(p)).cloned().collect();
    items.retain(|p| !paths.contains(p));
    taken
}

/// Remplace sur l'étagère chaque ancien chemin par le nouveau.
fn rename_on_shelf<'a>(items: &Items, renames: impl Iterator<Item = (&'a PathBuf, &'a PathBuf)>) {
    let mut items = items.lock().unwrap();
    for (from, to) in renames {
        for p in items.iter_mut().filter(|p| *p == from) {
            *p = to.clone();
        }
    }
}

/// La liste telle que le front l'affiche.
fn list_json(items: &Items) -> Value {
    let items = items.lock().unwrap();
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

/// Prévient le front (sujet "shelf.changed") avec la nouvelle liste. Passe par
/// bus::emit directement : les fonctions d'annulation n'ont pas de ModuleContext.
fn changed(app: &AppHandle, items: &Items) {
    bus::emit(app, "shelf", "shelf.changed", list_json(items));
}
