// Module « Notes » : notes rapides et liste de choses à faire.
//
// Les données vivent ici, côté Rust, et sont enregistrées dans
// %APPDATA%\Ondine\notes.json (écriture via un fichier temporaire renommé :
// jamais de fichier à moitié écrit). Le Rust les garde pour pouvoir proposer
// « Annuler » quand on supprime quelque chose.
//
// Le texte des notes n'est jamais écrit dans le journal ni envoyé sur le bus :
// le message "notes.changed" ne contient que des nombres ; le front redemande
// la liste.

use crate::sync::LockExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{bus, log, search};

const ID: &str = "notes";
/// Limites : une note est faite pour être courte, mais on laisse de la marge.
const MAX_NOTE_CHARS: usize = 20_000;
const MAX_TODO_CHARS: usize = 300;
const MAX_NOTES: usize = 200;
const MAX_TODOS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Note {
    id: u64,
    text: String,
    /// Dernière modification (ms depuis 1970).
    updated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Todo {
    id: u64,
    text: String,
    done: bool,
    created: u64,
}

/// Tout ce qui est enregistré. `next_id` : le prochain numéro à donner.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    #[serde(default)]
    notes: Vec<Note>,
    #[serde(default)]
    todos: Vec<Todo>,
    #[serde(default)]
    next_id: u64,
}

impl Data {
    fn new_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }
}

type Shared = Arc<Mutex<Data>>;

#[derive(Default)]
pub struct Notes {
    data: Shared,
}

impl RustModule for Notes {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/notes/manifest.json")
    }

    fn start(&self, _app: &AppHandle) {
        *self.data.locked() = load();
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "list" => {
                let d = self.data.locked();
                Ok(json!({ "notes": d.notes, "todos": d.todos }))
            }
            // { query, limit } → { items } : la recherche du Lanceur.
            "search" => Ok(search_json(&self.data.locked(), &args)),
            "note_save" => {
                let text = arg_text(&args, MAX_NOTE_CHARS)?;
                let id = {
                    let mut d = self.data.locked();
                    match args.get("id").and_then(Value::as_u64) {
                        Some(id) => {
                            let note = d.notes.iter_mut().find(|n| n.id == id).ok_or("note introuvable")?;
                            note.text = text;
                            note.updated = now_ms();
                            id
                        }
                        None => {
                            if d.notes.len() >= MAX_NOTES {
                                return Err(format!("au plus {MAX_NOTES} notes"));
                            }
                            let id = d.new_id();
                            // La plus récente en haut.
                            d.notes.insert(0, Note { id, text, updated: now_ms() });
                            id
                        }
                    }
                };
                changed(ctx.app, &self.data);
                Ok(json!({ "id": id }))
            }
            "note_delete" => {
                let id = arg_id(&args)?;
                let (index, note) = {
                    let mut d = self.data.locked();
                    let index = d.notes.iter().position(|n| n.id == id).ok_or("note introuvable")?;
                    (index, d.notes.remove(index))
                };
                changed(ctx.app, &self.data);
                let (data, app) = (self.data.clone(), ctx.app.clone());
                ctx.offer_undo(
                    "Note supprimée",
                    DEFAULT_WINDOW,
                    Box::new(move || {
                        {
                            let mut d = data.locked();
                            let at = index.min(d.notes.len());
                            d.notes.insert(at, note);
                        }
                        changed(&app, &data);
                        Ok(())
                    }),
                );
                Ok(Value::Null)
            }
            "todo_add" => {
                let text = arg_text(&args, MAX_TODO_CHARS)?;
                let id = {
                    let mut d = self.data.locked();
                    if d.todos.len() >= MAX_TODOS {
                        return Err(format!("au plus {MAX_TODOS} tâches"));
                    }
                    let id = d.new_id();
                    d.todos.push(Todo { id, text, done: false, created: now_ms() });
                    id
                };
                changed(ctx.app, &self.data);
                Ok(json!({ "id": id }))
            }
            "todo_toggle" => {
                let id = arg_id(&args)?;
                let done = {
                    let mut d = self.data.locked();
                    let todo = d.todos.iter_mut().find(|t| t.id == id).ok_or("tâche introuvable")?;
                    todo.done = !todo.done;
                    todo.done
                };
                // Une tâche cochée : la mascotte est contente.
                if done {
                    ctx.emit("task.finished", json!({ "label": "tâche cochée" }));
                }
                // Pour le bilan de la semaine : cochée ou décochée, jamais son texte.
                ctx.emit("notes.todo-toggled", json!({ "done": done }));
                changed(ctx.app, &self.data);
                Ok(json!({ "done": done }))
            }
            "todo_edit" => {
                let id = arg_id(&args)?;
                let text = arg_text(&args, MAX_TODO_CHARS)?;
                {
                    let mut d = self.data.locked();
                    let todo = d.todos.iter_mut().find(|t| t.id == id).ok_or("tâche introuvable")?;
                    todo.text = text;
                }
                changed(ctx.app, &self.data);
                Ok(Value::Null)
            }
            "todo_delete" => {
                let id = arg_id(&args)?;
                let removed = {
                    let mut d = self.data.locked();
                    let index = d.todos.iter().position(|t| t.id == id).ok_or("tâche introuvable")?;
                    vec![(index, d.todos.remove(index))]
                };
                self.offer_restore(ctx, "Tâche supprimée", removed);
                Ok(Value::Null)
            }
            "todo_clear_done" => {
                let removed: Vec<(usize, Todo)> = {
                    let mut d = self.data.locked();
                    let all = std::mem::take(&mut d.todos);
                    let mut removed = Vec::new();
                    for (i, t) in all.into_iter().enumerate() {
                        if t.done {
                            removed.push((i, t));
                        } else {
                            d.todos.push(t);
                        }
                    }
                    removed
                };
                if removed.is_empty() {
                    return Ok(Value::Null);
                }
                let label = format!("{} tâche(s) terminée(s) retirée(s)", removed.len());
                self.offer_restore(ctx, &label, removed);
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

impl Notes {
    /// Prévient le front et propose « Annuler » : les tâches retirées
    /// reviennent à leur place (index d'origine).
    fn offer_restore(&self, ctx: &ModuleContext, label: &str, removed: Vec<(usize, Todo)>) {
        changed(ctx.app, &self.data);
        let (data, app) = (self.data.clone(), ctx.app.clone());
        ctx.offer_undo(
            label,
            DEFAULT_WINDOW,
            Box::new(move || {
                {
                    let mut d = data.locked();
                    restore(&mut d.todos, removed);
                }
                changed(&app, &data);
                Ok(())
            }),
        );
    }
}

/// Remet des éléments retirés à leur place d'origine (dans l'ordre des index).
fn restore<T>(list: &mut Vec<T>, mut removed: Vec<(usize, T)>) {
    removed.sort_by_key(|(i, _)| *i);
    for (i, item) in removed {
        let at = i.min(list.len());
        list.insert(at, item);
    }
}

/// Enregistre, puis prévient le front (sans aucun texte dans le message).
fn changed(app: &AppHandle, data: &Shared) {
    let (notes, todos, open) = {
        let d = data.locked();
        if let Err(e) = save(&d) {
            log::warn(format!("notes : enregistrement impossible : {e}"));
        }
        (d.notes.len(), d.todos.len(), d.todos.iter().filter(|t| !t.done).count())
    };
    bus::emit(app, ID, "notes.changed", json!({ "notes": notes, "todos": todos, "open": open }));
}

/// Les notes et les tâches qui correspondent à la recherche (les meilleures
/// d'abord, `limit` au plus). Une note renvoie sa première ligne et un extrait.
fn search_json(d: &Data, args: &Value) -> Value {
    let (query, limit) = search::args(args);
    if query.is_empty() {
        return json!({ "items": [] });
    }
    let mut hits = Vec::new();
    for n in &d.notes {
        let title = n.text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        let rest = n.text.trim_start().split_once('\n').map_or("", |(_, r)| r);
        let score = search::score_titled(title, rest, &query);
        if score > 0 {
            let value = json!({
                "kind": "note",
                "id": n.id,
                "title": title.chars().take(80).collect::<String>(),
                "detail": search::excerpt(rest, &query, 90),
                "at": n.updated,
            });
            hits.push(search::Hit { score, at: n.updated, value });
        }
    }
    for t in &d.todos {
        // Une tâche déjà faite passe après une tâche à faire aussi bien trouvée.
        let score = search::score(&t.text, &query).saturating_sub(if t.done { 5 } else { 0 });
        if score > 0 {
            let value = json!({ "kind": "todo", "id": t.id, "title": t.text, "done": t.done, "at": t.created });
            hits.push(search::Hit { score, at: t.created, value });
        }
    }
    json!({ "items": search::best(hits, limit) })
}

fn file() -> PathBuf {
    platform::config_dir().join("notes.json")
}

/// Relit le fichier. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Data {
    let Ok(text) = std::fs::read_to_string(file()) else { return Data::default() };
    match serde_json::from_str::<Data>(&text) {
        Ok(mut d) => {
            // Au cas où le fichier aurait été modifié à la main : les numéros restent uniques.
            let max = d.notes.iter().map(|n| n.id).chain(d.todos.iter().map(|t| t.id)).max().unwrap_or(0);
            d.next_id = d.next_id.max(max);
            d
        }
        Err(e) => {
            let aside = platform::config_dir().join(format!("notes.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(file(), &aside);
            log::warn(format!("notes : fichier illisible ({e}), mis de côté dans {}", aside.display()));
            Data::default()
        }
    }
}

fn save(d: &Data) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(d).map_err(|e| e.to_string())?;
    let tmp = dir.join("notes.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

fn arg_id(args: &Value) -> Result<u64, String> {
    args.get("id").and_then(Value::as_u64).ok_or_else(|| "paramètre « id » manquant".into())
}

/// Le texte de `args.text`, non vide et pas trop long.
fn arg_text(args: &Value, max: usize) -> Result<String, String> {
    let text = args.get("text").and_then(Value::as_str).unwrap_or("").trim_end().to_string();
    if text.trim().is_empty() {
        return Err("le texte est vide".into());
    }
    if text.chars().count() > max {
        return Err(format!("texte trop long (au plus {max} caractères)"));
    }
    Ok(text)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removed_items_go_back_in_place() {
        let mut list = vec!['a', 'c', 'e'];
        restore(&mut list, vec![(3, 'd'), (1, 'b')]);
        assert_eq!(list, ['a', 'b', 'c', 'd', 'e']);
    }

    #[test]
    fn empty_or_long_text_is_refused() {
        assert!(arg_text(&json!({ "text": "   " }), 10).is_err());
        assert!(arg_text(&json!({ "text": "x".repeat(11) }), 10).is_err());
        assert_eq!(arg_text(&json!({ "text": "Acheter du pain  " }), 50).unwrap(), "Acheter du pain");
    }

    #[test]
    fn search_finds_notes_and_todos_without_accents() {
        let d = Data {
            notes: vec![
                Note { id: 1, text: "Idées cadeaux\nUn livre pour Léa".into(), updated: 10 },
                Note { id: 2, text: "Courses\npain, café".into(), updated: 20 },
            ],
            todos: vec![
                Todo { id: 3, text: "Appeler Léa".into(), done: true, created: 30 },
                Todo { id: 4, text: "Réserver le resto".into(), done: false, created: 40 },
            ],
            next_id: 4,
        };
        let found = search_json(&d, &json!({ "query": "LEA" }));
        let items = found["items"].as_array().unwrap();
        // « Appeler Léa » (mot entier, tâche) avant la note où Léa est dans le texte.
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["kind"], "todo");
        assert_eq!(items[1]["title"], "Idées cadeaux");
        assert!(items[1]["detail"].as_str().unwrap().contains("Léa"));
        let found = search_json(&d, &json!({ "query": "idees" }));
        assert_eq!(found["items"][0]["id"], 1);
        assert_eq!(search_json(&d, &json!({ "query": " " }))["items"], json!([]));
    }

    #[test]
    fn old_files_without_next_id_still_load() {
        let d: Data = serde_json::from_str(r#"{ "todos": [{ "id": 4, "text": "x", "done": false, "created": 0 }] }"#).unwrap();
        assert_eq!(d.todos.len(), 1);
        assert_eq!(d.next_id, 0); // load() le recale sur le plus grand numéro
    }
}
