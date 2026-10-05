// Module « Presse-papiers » : l'historique des copies de texte, l'épinglage, le
// collage sans mise en forme et les snippets.
//
// Comment on voit les copies : Windows tient un compteur qui augmente à chaque
// copie (dans n'importe quelle appli). Un thread le regarde toutes les 400 ms ;
// quand il change, on lit le texte copié et on l'ajoute en haut de l'historique.
//
// Règles appliquées ici :
//   - une copie que l'appli d'origine marque « sensible » (gestionnaire de mots
//     de passe…) n'est JAMAIS lue : platform::clipboard_is_sensitive ;
//   - l'historique reste en mémoire : il disparaît quand l'île s'arrête. Seuls
//     les éléments épinglés et les snippets sont enregistrés sur le disque
//     (%APPDATA%\Island\clipboard.json), parce que tu l'as demandé en épinglant ;
//   - aucun texte copié n'est écrit dans le journal, ni envoyé sur le bus : le
//     message "clipboard.changed" ne dit que « quelque chose a changé » ;
//   - effacer (un élément, l'historique, un snippet) propose « Annuler ».
//
// Le manifeste est le même fichier que celui du front (src/modules/clipboard/manifest.json).

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::bus::{self, BusMessage};
use crate::services::{files, log};

const ID: &str = "clipboard";
/// Tous les combien on regarde le compteur de Windows.
const POLL: Duration = Duration::from_millis(400);
/// Au-delà, une copie n'est pas gardée (un fichier texte entier collé par erreur…).
const MAX_CHARS: usize = 100_000;
/// Longueur de l'aperçu envoyé au front pour la liste.
const PREVIEW_CHARS: usize = 300;
/// Limites des snippets.
const MAX_SNIPPET_NAME: usize = 80;
const MAX_SNIPPETS: usize = 200;
/// Nombre de copies gardées si le réglage manque.
const DEFAULT_MAX_ITEMS: usize = 50;

/// Une copie de l'historique.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Clip {
    id: u64,
    text: String,
    pinned: bool,
    /// Heure de la copie (millisecondes depuis 1970), pour « il y a 5 min ».
    at: u64,
}

/// Un texte enregistré sous un nom, à coller quand on veut.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Snippet {
    id: u64,
    name: String,
    text: String,
}

/// Tout ce que le module retient.
#[derive(Default)]
struct Store {
    /// La plus récente en premier.
    clips: Vec<Clip>,
    snippets: Vec<Snippet>,
    /// Le prochain numéro à donner (copie ou snippet).
    next_id: u64,
}

/// Ce qui est enregistré sur le disque : les épinglés et les snippets.
#[derive(Serialize, Deserialize, Default)]
struct Saved {
    #[serde(default)]
    pinned: Vec<Clip>,
    #[serde(default)]
    snippets: Vec<Snippet>,
}

type Shared = Arc<Mutex<Store>>;

#[derive(Default)]
pub struct Clipboard {
    store: Shared,
}

impl RustModule for Clipboard {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/clipboard/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        *self.store.locked() = load();
        let (app, store) = (app.clone(), self.store.clone());
        std::thread::spawn(move || watch(app, store));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        ctx.require("clipboard")?;
        match command {
            "list" => {
                let query = args.get("query").and_then(Value::as_str).unwrap_or("");
                Ok(list_json(&self.store.locked(), query))
            }
            "pin" => {
                let id = arg_id(&args, "id")?;
                let pinned = args.get("pinned").and_then(Value::as_bool).unwrap_or(true);
                {
                    let mut s = self.store.locked();
                    let clip = s.clips.iter_mut().find(|c| c.id == id).ok_or("élément introuvable")?;
                    clip.pinned = pinned;
                    let max = max_items(ctx);
                    trim(&mut s, max);
                }
                changed(ctx.app, &self.store);
                Ok(Value::Null)
            }
            "delete" => self.delete(ctx, arg_id(&args, "id")?),
            "clear" => self.clear(ctx),
            "copy" => {
                let text = self.text_of(&args)?;
                files::copy_text(&text)?;
                Ok(Value::Null)
            }
            "paste" => {
                let text = self.text_of(&args)?;
                files::copy_text(&text)?;
                platform::paste_into_previous(ctx.app)?;
                Ok(Value::Null)
            }
            "paste_plain" => {
                // Relire le texte et le remettre seul : la mise en forme (gras,
                // couleurs, liens…) était dans d'autres formats, qui disparaissent.
                let text = read_text().ok_or("le presse-papiers ne contient pas de texte")?;
                files::copy_text(&text)?;
                platform::paste_into_previous(ctx.app)?;
                Ok(Value::Null)
            }
            "snippet_save" => self.snippet_save(ctx, &args),
            "snippet_delete" => self.snippet_delete(ctx, arg_id(&args, "id")?),
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// "clipboard.paste-plain" : demandé par une règle (raccourci clavier).
    /// On attend que l'utilisateur ait relâché Ctrl/Alt/Maj, puis on colle le
    /// texte seul dans la fenêtre active. Dans un thread : le bus n'attend pas.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic != "clipboard.paste-plain" {
            return;
        }
        let app = ctx.app.clone();
        std::thread::spawn(move || {
            platform::wait_modifiers_released(Duration::from_secs(1));
            let result = read_text()
                .ok_or_else(|| "le presse-papiers ne contient pas de texte".to_string())
                .and_then(|text| files::copy_text(&text))
                .and_then(|_| platform::paste_into_previous(&app));
            if let Err(e) = result {
                log::warn(format!("coller sans mise en forme : {e}"));
            }
        });
    }
}

impl Clipboard {
    /// Le texte désigné par `args.id` (une copie) ou `args.snippet` (un snippet).
    fn text_of(&self, args: &Value) -> Result<String, String> {
        let s = self.store.locked();
        if let Some(id) = args.get("snippet").and_then(Value::as_u64) {
            return s.snippets.iter().find(|n| n.id == id).map(|n| n.text.clone()).ok_or("snippet introuvable".into());
        }
        let id = arg_id(args, "id")?;
        s.clips.iter().find(|c| c.id == id).map(|c| c.text.clone()).ok_or("élément introuvable".into())
    }

    /// Retire une copie. Annuler = la remettre à sa place.
    fn delete(&self, ctx: &ModuleContext, id: u64) -> Result<Value, String> {
        let (index, clip) = {
            let mut s = self.store.locked();
            let index = s.clips.iter().position(|c| c.id == id).ok_or("élément introuvable")?;
            (index, s.clips.remove(index))
        };
        changed(ctx.app, &self.store);
        let (store, app) = (self.store.clone(), ctx.app.clone());
        ctx.offer_undo(
            "Copie retirée de l'historique",
            DEFAULT_WINDOW,
            Box::new(move || {
                {
                    let mut s = store.locked();
                    // Le même texte a pu être recopié entre-temps : pas de doublon.
                    if !s.clips.iter().any(|c| c.text == clip.text) {
                        let at = index.min(s.clips.len());
                        s.clips.insert(at, clip);
                    }
                }
                changed(&app, &store);
                Ok(())
            }),
        );
        Ok(Value::Null)
    }

    /// Vide l'historique, sauf les éléments épinglés. Annuler = tout remettre.
    fn clear(&self, ctx: &ModuleContext) -> Result<Value, String> {
        let removed: Vec<Clip> = {
            let mut s = self.store.locked();
            let (kept, removed) = std::mem::take(&mut s.clips).into_iter().partition(|c| c.pinned);
            s.clips = kept;
            removed
        };
        if removed.is_empty() {
            return Ok(Value::Null);
        }
        changed(ctx.app, &self.store);
        let n = removed.len();
        let max = max_items(ctx);
        let (store, app) = (self.store.clone(), ctx.app.clone());
        ctx.offer_undo(
            &format!("Historique vidé ({n} copie(s))"),
            DEFAULT_WINDOW,
            Box::new(move || {
                {
                    let mut s = store.locked();
                    // Les copies faites depuis restent en haut ; les anciennes reviennent dessous.
                    for clip in removed {
                        if !s.clips.iter().any(|c| c.text == clip.text) {
                            s.clips.push(clip);
                        }
                    }
                    trim(&mut s, max);
                }
                changed(&app, &store);
                Ok(())
            }),
        );
        Ok(Value::Null)
    }

    /// Crée (sans `id`) ou modifie (avec `id`) un snippet.
    fn snippet_save(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let name = args.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let text = args.get("text").and_then(Value::as_str).unwrap_or("").to_string();
        if name.is_empty() {
            return Err("donne un nom au snippet".into());
        }
        if name.chars().count() > MAX_SNIPPET_NAME {
            return Err(format!("nom trop long (au plus {MAX_SNIPPET_NAME} caractères)"));
        }
        if text.trim().is_empty() {
            return Err("le snippet est vide".into());
        }
        if text.chars().count() > MAX_CHARS {
            return Err(format!("texte trop long (au plus {MAX_CHARS} caractères)"));
        }
        let id = {
            let mut s = self.store.locked();
            match args.get("id").and_then(Value::as_u64) {
                Some(id) => {
                    let snippet = s.snippets.iter_mut().find(|n| n.id == id).ok_or("snippet introuvable")?;
                    snippet.name = name;
                    snippet.text = text;
                    id
                }
                None => {
                    if s.snippets.len() >= MAX_SNIPPETS {
                        return Err(format!("au plus {MAX_SNIPPETS} snippets"));
                    }
                    let id = new_id(&mut s);
                    s.snippets.push(Snippet { id, name, text });
                    id
                }
            }
        };
        changed(ctx.app, &self.store);
        Ok(json!({ "id": id }))
    }

    /// Supprime un snippet. Annuler = le remettre.
    fn snippet_delete(&self, ctx: &ModuleContext, id: u64) -> Result<Value, String> {
        let (index, snippet) = {
            let mut s = self.store.locked();
            let index = s.snippets.iter().position(|n| n.id == id).ok_or("snippet introuvable")?;
            (index, s.snippets.remove(index))
        };
        changed(ctx.app, &self.store);
        let (store, app) = (self.store.clone(), ctx.app.clone());
        ctx.offer_undo(
            &format!("Snippet « {} » supprimé", snippet.name),
            DEFAULT_WINDOW,
            Box::new(move || {
                {
                    let mut s = store.locked();
                    let at = index.min(s.snippets.len());
                    s.snippets.insert(at, snippet);
                }
                changed(&app, &store);
                Ok(())
            }),
        );
        Ok(Value::Null)
    }
}

// ── La surveillance ──────────────────────────────────────────────────────────

/// La boucle du thread : regarde le compteur de copies de Windows.
fn watch(app: AppHandle, store: Shared) {
    let mut last_seq = 0;
    loop {
        std::thread::sleep(POLL);
        if !super::is_active(&app, ID) {
            continue;
        }
        let seq = platform::clipboard_sequence();
        if seq == last_seq {
            continue;
        }
        last_seq = seq;

        // Une panique ici ne doit pas tuer le thread (ni l'île).
        let step = catch_unwind(AssertUnwindSafe(|| {
            if platform::clipboard_is_sensitive() {
                // On ne dit pas QUOI : seulement qu'une copie a été ignorée.
                log::debug("presse-papiers : copie marquée sensible, ignorée");
                return;
            }
            let Some(text) = read_text() else { return }; // une image, des fichiers…
            if text.chars().count() > MAX_CHARS {
                log::debug("presse-papiers : copie trop longue, ignorée");
                return;
            }
            let max = max_items_of(&app);
            if remember(&mut store.locked(), text, now_ms(), max) {
                changed(&app, &store);
            }
        }));
        if step.is_err() {
            log::warn("presse-papiers : panique pendant la lecture d'une copie");
        }
    }
}

/// Le texte du presse-papiers, s'il y en a (None pour une image, des fichiers…).
fn read_text() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

/// Ajoute une copie en haut de l'historique. Le même texte déjà présent remonte
/// en haut au lieu d'être en double (il garde son épingle). Renvoie true si la
/// liste a changé.
fn remember(s: &mut Store, text: String, at: u64, max: usize) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    if s.clips.first().is_some_and(|c| c.text == text) {
        return false; // déjà en haut (ex. : on vient de le recopier depuis l'île)
    }
    let clip = match s.clips.iter().position(|c| c.text == text) {
        Some(i) => {
            let mut c = s.clips.remove(i);
            c.at = at;
            c
        }
        None => Clip { id: new_id(s), text, pinned: false, at },
    };
    s.clips.insert(0, clip);
    trim(s, max);
    true
}

/// Garde au plus `max` copies non épinglées (les plus récentes).
fn trim(s: &mut Store, max: usize) {
    let mut unpinned = 0;
    s.clips.retain(|c| {
        if c.pinned {
            return true;
        }
        unpinned += 1;
        unpinned <= max
    });
}

fn new_id(s: &mut Store) -> u64 {
    s.next_id += 1;
    s.next_id
}

// ── Le front ─────────────────────────────────────────────────────────────────

/// La liste pour le front, filtrée par `query` (sans tenir compte des majuscules).
/// Les copies n'envoient qu'un aperçu ; les snippets sont envoyés en entier
/// (pour pouvoir les modifier).
fn list_json(s: &Store, query: &str) -> Value {
    let q = query.trim().to_lowercase();
    let matches = |text: &str| q.is_empty() || text.to_lowercase().contains(&q);
    // Les épinglés d'abord, puis le reste, chacun du plus récent au plus ancien.
    let mut clips: Vec<&Clip> = s.clips.iter().filter(|c| matches(&c.text)).collect();
    clips.sort_by_key(|c| !c.pinned); // tri stable : l'ordre récent est gardé
    let items: Vec<Value> = clips
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "preview": preview(&c.text),
                "chars": c.text.chars().count(),
                "pinned": c.pinned,
                "at": c.at,
            })
        })
        .collect();
    let snippets: Vec<Value> = s
        .snippets
        .iter()
        .filter(|n| matches(&n.name) || matches(&n.text))
        .map(|n| json!({ "id": n.id, "name": n.name, "text": n.text }))
        .collect();
    json!({ "items": items, "snippets": snippets, "total": s.clips.len() })
}

/// Les PREVIEW_CHARS premiers caractères (jamais coupé au milieu d'une lettre).
fn preview(text: &str) -> String {
    match text.char_indices().nth(PREVIEW_CHARS) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
}

/// Prévient le front et enregistre ce qui doit l'être. Le message ne contient
/// aucun texte copié : le front redemande la liste.
fn changed(app: &AppHandle, store: &Shared) {
    let (count, saved) = {
        let s = store.locked();
        let saved = Saved {
            pinned: s.clips.iter().filter(|c| c.pinned).cloned().collect(),
            snippets: s.snippets.clone(),
        };
        (s.clips.len(), saved)
    };
    if let Err(e) = save(&saved) {
        log::warn(format!("presse-papiers : enregistrement impossible : {e}"));
    }
    bus::emit(app, ID, "clipboard.changed", json!({ "count": count }));
}

// ── Réglages et fichier ──────────────────────────────────────────────────────

fn max_items(ctx: &ModuleContext) -> usize {
    read_max(ctx.settings().get("maxItems"))
}

/// Même chose depuis le thread (qui n'a pas de ModuleContext).
fn max_items_of(app: &AppHandle) -> usize {
    use tauri::Manager;
    let shared = app.state::<crate::Shared>();
    let s = shared.settings.locked();
    read_max(s.modules.get(ID).and_then(|m| m.values.get("maxItems")))
}

fn read_max(value: Option<&Value>) -> usize {
    value.and_then(Value::as_u64).map(|n| n.clamp(10, 500) as usize).unwrap_or(DEFAULT_MAX_ITEMS)
}

fn file() -> PathBuf {
    platform::config_dir().join("clipboard.json")
}

/// Relit les épinglés et les snippets. Un fichier abîmé est mis de côté, jamais effacé.
fn load() -> Store {
    let saved: Saved = match std::fs::read_to_string(file()) {
        Err(_) => Saved::default(), // pas encore de fichier
        Ok(text) => match serde_json::from_str(&text) {
            Ok(saved) => saved,
            Err(e) => {
                let aside = platform::config_dir().join("clipboard.broken.json");
                let _ = std::fs::rename(file(), &aside);
                log::warn(format!("presse-papiers : fichier illisible ({e}), mis de côté dans {}", aside.display()));
                Saved::default()
            }
        },
    };
    let next_id = saved.pinned.iter().map(|c| c.id).chain(saved.snippets.iter().map(|n| n.id)).max().unwrap_or(0);
    Store { clips: saved.pinned, snippets: saved.snippets, next_id }
}

/// Écrit d'abord un fichier temporaire puis le renomme : jamais de fichier à moitié écrit.
fn save(saved: &Saved) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(saved).map_err(|e| e.to_string())?;
    let tmp = dir.join("clipboard.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file()).map_err(|e| e.to_string())
}

// ── Petits outils ────────────────────────────────────────────────────────────

fn arg_id(args: &Value, key: &str) -> Result<u64, String> {
    args.get(key).and_then(Value::as_u64).ok_or_else(|| format!("paramètre « {key} » manquant"))
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

    fn texts(s: &Store) -> Vec<&str> {
        s.clips.iter().map(|c| c.text.as_str()).collect()
    }

    #[test]
    fn newest_first_without_duplicates() {
        let mut s = Store::default();
        assert!(remember(&mut s, "a".into(), 1, 50));
        assert!(remember(&mut s, "b".into(), 2, 50));
        assert!(remember(&mut s, "a".into(), 3, 50)); // « a » remonte
        assert!(!remember(&mut s, "a".into(), 4, 50)); // déjà en haut
        assert!(!remember(&mut s, "   ".into(), 5, 50)); // vide
        assert_eq!(texts(&s), ["a", "b"]);
    }

    #[test]
    fn pinned_items_survive_the_limit() {
        let mut s = Store::default();
        remember(&mut s, "épinglé".into(), 0, 10);
        s.clips[0].pinned = true;
        for i in 0..20 {
            remember(&mut s, format!("copie {i}"), i, 10);
        }
        assert_eq!(s.clips.iter().filter(|c| !c.pinned).count(), 10);
        assert!(s.clips.iter().any(|c| c.pinned && c.text == "épinglé"));
    }

    #[test]
    fn search_ignores_case_and_lists_pinned_first() {
        let mut s = Store::default();
        remember(&mut s, "Bonjour Simon".into(), 1, 50);
        remember(&mut s, "autre chose".into(), 2, 50);
        remember(&mut s, "bonjour encore".into(), 3, 50);
        s.clips[2].pinned = true; // « Bonjour Simon »
        let list = list_json(&s, "BONJOUR");
        let previews: Vec<&str> = list["items"].as_array().unwrap().iter().map(|i| i["preview"].as_str().unwrap()).collect();
        assert_eq!(previews, ["Bonjour Simon", "bonjour encore"]);
    }

    #[test]
    fn preview_cuts_on_a_letter() {
        let long = "é".repeat(PREVIEW_CHARS + 5);
        let p = preview(&long);
        assert_eq!(p.chars().count(), PREVIEW_CHARS + 1); // + « … »
        assert_eq!(preview("court"), "court");
    }

    #[test]
    fn saved_file_round_trip() {
        let saved = Saved {
            pinned: vec![Clip { id: 7, text: "x".into(), pinned: true, at: 1 }],
            snippets: vec![Snippet { id: 9, name: "Adresse".into(), text: "1 rue…".into() }],
        };
        let text = serde_json::to_string(&saved).unwrap();
        let back: Saved = serde_json::from_str(&text).unwrap();
        assert_eq!(back.pinned[0].text, "x");
        assert_eq!(back.snippets[0].name, "Adresse");
        // Un fichier sans une des deux listes reste lisible.
        let partial: Saved = serde_json::from_str(r#"{ "snippets": [] }"#).unwrap();
        assert!(partial.pinned.is_empty());
    }
}
