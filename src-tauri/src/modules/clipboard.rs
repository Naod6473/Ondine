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
//     (%APPDATA%\Ondine\clipboard.json), parce que tu l'as demandé en épinglant ;
//   - aucun texte copié n'est écrit dans le journal, ni envoyé sur le bus : le
//     message "clipboard.changed" ne dit que « quelque chose a changé » ;
//   - effacer (un élément, l'historique, un snippet) propose « Annuler » ;
//   - « liens propres » (réglage, activé par défaut) : quand on copie un lien
//     plein de traqueurs (utm_source, fbclid, gclid…), on remet dans le
//     presse-papiers le même lien sans eux. La notification propose « Remettre »
//     (le lien d'origine, qu'on ne nettoie plus ensuite) ;
//   - changer la casse d'une copie (MAJUSCULES, minuscules, Titre, Phrase) ;
//   - générer un mot de passe (hasard du système) : copié marqué « secret »
//     (ni historique Windows, ni le nôtre, ni cloud), puis effacé du
//     presse-papiers au bout de 30 s si rien d'autre n'a été copié entre-temps.
//     Il n'est jamais enregistré ni écrit dans le journal ;
//   - montrer une copie en QR code (calculé sur le PC, clipboard_qr.rs), pour
//     l'ouvrir sur un téléphone ; « Copier l'image » le met dans le presse-papiers.
//
// Le manifeste est le même fichier que celui du front (src/modules/clipboard/manifest.json).

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::clipboard_qr;
use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::bus::{self, BusMessage};
use crate::services::{files, log, search};

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
    /// Le dernier lien nettoyé, tel qu'il était (pour « Remettre »).
    original_link: Option<String>,
    /// Un lien remis exprès avec ses traqueurs : on ne le renettoie pas.
    keep_as_is: Option<String>,
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
            // { query, limit } → { items } : la recherche du Lanceur. Les copies
            // sensibles n'y sont jamais : elles n'ont pas été lues.
            "search" => Ok(search_json(&self.store.locked(), &args)),
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
            // { id, mode: "upper" | "lower" | "title" | "sentence" } : copie le texte dans cette casse.
            "transform" => {
                let text = self.text_of(&args)?;
                let mode = args.get("mode").and_then(Value::as_str).ok_or("casse inconnue")?;
                files::copy_text(&change_case(&text, mode)?)?;
                Ok(Value::Null)
            }
            // {} : remet le lien d'avant nettoyage dans le presse-papiers.
            "restore_link" => {
                let original = {
                    let mut s = self.store.locked();
                    let original = s.original_link.take().ok_or("plus de lien à remettre")?;
                    s.keep_as_is = Some(original.clone());
                    original
                };
                files::copy_text(&original)?;
                Ok(Value::Null)
            }
            // { length, upper, lower, digits, symbols, ambiguous } → { password }
            "password_generate" => Ok(json!({ "password": generate_password(&PasswordRules::from_args(&args))? })),
            // { password } : copié en secret, effacé dans 30 s.
            "password_copy" => {
                let text = args.get("password").and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 256).ok_or("mot de passe manquant")?;
                let seq = platform::copy_secret(text)?;
                std::thread::spawn(move || {
                    std::thread::sleep(SECRET_LIFETIME);
                    platform::clear_clipboard_if(seq);
                });
                Ok(json!({ "clearsInSecs": SECRET_LIFETIME.as_secs() }))
            }
            // { id } → { image, size } : le QR code de la copie, en SVG (data URL).
            "qr" => {
                let qr = clipboard_qr::make(&self.text_of(&args)?)?;
                let image = format!("data:image/svg+xml;base64,{}", BASE64.encode(clipboard_qr::svg(&qr)));
                Ok(json!({ "image": image, "size": qr.width }))
            }
            // { id } : copie le QR code en image (noir sur blanc, ~512 px).
            "qr_copy" => {
                let qr = clipboard_qr::make(&self.text_of(&args)?)?;
                let (side, bytes) = clipboard_qr::rgba(&qr);
                let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
                clipboard
                    .set_image(arboard::ImageData { width: side, height: side, bytes: bytes.into() })
                    .map_err(|e| format!("presse-papiers : {e}"))?;
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
            // Un lien plein de traqueurs : on remet le lien propre dans le
            // presse-papiers. Cette nouvelle copie sera vue au tour suivant.
            if clean_links_on(&app) && store.locked().keep_as_is.as_deref() != Some(text.as_str()) {
                if let Some((clean, removed)) = clean_link(&text) {
                    if files::copy_text(&clean).is_ok() {
                        store.locked().original_link = Some(text);
                        // Le message ne contient pas le lien : seulement combien de traqueurs.
                        bus::emit(&app, ID, "clipboard.link-cleaned", json!({ "removed": removed }));
                        return;
                    }
                }
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

/// Un mot de passe copié est effacé du presse-papiers au bout de…
const SECRET_LIFETIME: Duration = Duration::from_secs(30);

/// Les familles de caractères d'un mot de passe.
struct PasswordRules {
    length: usize,
    upper: bool,
    lower: bool,
    digits: bool,
    symbols: bool,
    /// Garder les caractères qui se ressemblent (0 O o, 1 l I |…).
    ambiguous: bool,
}

impl PasswordRules {
    fn from_args(args: &Value) -> Self {
        let flag = |k: &str| args.get(k).and_then(Value::as_bool).unwrap_or(true);
        Self {
            length: args.get("length").and_then(Value::as_u64).unwrap_or(20).clamp(8, 128) as usize,
            upper: flag("upper"),
            lower: flag("lower"),
            digits: flag("digits"),
            symbols: flag("symbols"),
            ambiguous: args.get("ambiguous").and_then(Value::as_bool).unwrap_or(false),
        }
    }
}

/// Un nombre au hasard dans 0..n, sans biais (on rejette le haut de l'intervalle).
fn random_below(n: u32) -> Result<u32, String> {
    let limit = u32::MAX - (u32::MAX % n);
    loop {
        let mut b = [0u8; 4];
        getrandom::fill(&mut b).map_err(|_| "le hasard du système est indisponible".to_string())?;
        let v = u32::from_le_bytes(b);
        if v < limit {
            return Ok(v % n);
        }
    }
}

/// Un mot de passe avec au moins un caractère de chaque famille choisie.
fn generate_password(r: &PasswordRules) -> Result<String, String> {
    const AMBIGUOUS: &str = "0Oo1lI|`'\"";
    let keep = |set: &str| -> Vec<char> { set.chars().filter(|c| r.ambiguous || !AMBIGUOUS.contains(*c)).collect() };
    let mut families: Vec<Vec<char>> = Vec::new();
    if r.upper {
        families.push(keep("ABCDEFGHIJKLMNOPQRSTUVWXYZ"));
    }
    if r.lower {
        families.push(keep("abcdefghijklmnopqrstuvwxyz"));
    }
    if r.digits {
        families.push(keep("0123456789"));
    }
    if r.symbols {
        families.push(keep("!#$%&*+-=?@^_~.:;,()[]{}"));
    }
    if families.is_empty() {
        return Err("choisis au moins une sorte de caractères".into());
    }
    let all: Vec<char> = families.concat();
    // Un de chaque famille, puis le reste au hasard, puis on mélange.
    let mut out: Vec<char> = Vec::with_capacity(r.length);
    for f in &families {
        out.push(f[random_below(f.len() as u32)? as usize]);
    }
    while out.len() < r.length {
        out.push(all[random_below(all.len() as u32)? as usize]);
    }
    for i in (1..out.len()).rev() {
        let j = random_below(i as u32 + 1)? as usize;
        out.swap(i, j);
    }
    Ok(out.into_iter().collect())
}

/// Le réglage « liens propres » (activé si absent).
fn clean_links_on(app: &AppHandle) -> bool {
    super::with_context(app, ID, |ctx| ctx.settings().get("cleanLinks").and_then(Value::as_bool).unwrap_or(true)).unwrap_or(false)
}

/// Les paramètres de suivi publicitaire connus (comparés sans tenir compte des majuscules).
const TRACKERS: &[&str] = &[
    "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid", "igshid", "mc_cid", "mc_eid", "_hsenc",
    "_hsmi", "mkt_tok", "oly_anon_id", "oly_enc_id", "vero_id", "rb_clickid", "s_cid", "__s", "srsltid",
];

fn is_tracker(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.starts_with("utm_") || TRACKERS.contains(&k.as_str())
}

/// Un lien seul (http ou https, sans espace) débarrassé de ses traqueurs, et
/// combien on en a retiré. None : pas un lien, ou rien à retirer.
fn clean_link(text: &str) -> Option<(String, usize)> {
    let url = text.trim();
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) || url.chars().any(char::is_whitespace) {
        return None;
    }
    // [adresse]?[paramètres]#[ancre] : on ne touche qu'aux paramètres.
    let (before_hash, hash) = match url.split_once('#') {
        Some((a, h)) => (a, Some(h)),
        None => (url, None),
    };
    let (base, query) = before_hash.split_once('?')?;
    let params: Vec<&str> = query.split('&').filter(|p| !p.is_empty()).collect();
    let kept: Vec<&str> = params.iter().copied().filter(|p| !is_tracker(p.split('=').next().unwrap_or(p))).collect();
    let removed = params.len() - kept.len();
    if removed == 0 {
        return None;
    }
    let mut clean = base.to_string();
    if !kept.is_empty() {
        clean.push('?');
        clean.push_str(&kept.join("&"));
    }
    if let Some(h) = hash {
        clean.push('#');
        clean.push_str(h);
    }
    Some((clean, removed))
}

/// Change la casse : "upper" (MAJUSCULES), "lower", "title" (Chaque Mot),
/// "sentence" (une majuscule au début de chaque phrase).
fn change_case(text: &str, mode: &str) -> Result<String, String> {
    Ok(match mode {
        "upper" => text.to_uppercase(),
        "lower" => text.to_lowercase(),
        "title" | "sentence" => {
            let mut out = String::with_capacity(text.len());
            // Faut-il une majuscule à la prochaine lettre ?
            let mut cap = true;
            for c in text.to_lowercase().chars() {
                if c.is_alphabetic() {
                    if cap {
                        out.extend(c.to_uppercase());
                    } else {
                        out.push(c);
                    }
                    cap = false;
                } else {
                    out.push(c);
                    if mode == "title" {
                        // Après une espace ou un tiret : nouveau mot (pas après « ' » : « L'île »).
                        cap = cap || c.is_whitespace() || c == '-';
                    } else if matches!(c, '.' | '!' | '?' | '\n') {
                        cap = true;
                    }
                }
            }
            out
        }
        _ => return Err("casse inconnue".into()),
    })
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

/// Les copies et les snippets qui correspondent à la recherche (les meilleurs
/// d'abord, `limit` au plus), avec un court extrait plutôt que tout le texte.
fn search_json(s: &Store, args: &Value) -> Value {
    let (query, limit) = search::args(args);
    if query.is_empty() {
        return json!({ "items": [] });
    }
    let mut hits = Vec::new();
    for c in &s.clips {
        // Un élément épinglé passe devant une copie aussi bien trouvée.
        let found = search::score(&c.text, &query);
        if found > 0 {
            let score = found + u32::from(c.pinned);
            let value = json!({ "kind": "clip", "id": c.id, "title": search::excerpt(&c.text, &query, 90), "pinned": c.pinned, "at": c.at });
            hits.push(search::Hit { score, at: c.at, value });
        }
    }
    for n in &s.snippets {
        let score = search::score_titled(&n.name, &n.text, &query);
        if score > 0 {
            let value = json!({ "kind": "snippet", "id": n.id, "title": n.name, "detail": search::excerpt(&n.text, &query, 90) });
            hits.push(search::Hit { score, at: 0, value });
        }
    }
    json!({ "items": search::best(hits, limit) })
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
    Store { clips: saved.pinned, snippets: saved.snippets, next_id, ..Default::default() }
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

    #[test]
    fn links_lose_their_trackers() {
        let (clean, n) = clean_link("https://ex.com/a?utm_source=x&id=4&fbclid=abc#top").unwrap();
        assert_eq!((clean.as_str(), n), ("https://ex.com/a?id=4#top", 2));
        let (clean, _) = clean_link(" https://ex.com/?UTM_medium=mail ").unwrap();
        assert_eq!(clean, "https://ex.com/");
        assert_eq!(clean_link("https://ex.com/?id=4"), None);
        assert_eq!(clean_link("voir https://ex.com/?utm_source=x"), None);
        assert_eq!(clean_link("ftp://ex.com/?utm_source=x"), None);
    }

    #[test]
    fn passwords_follow_the_rules() {
        let rules = |length, symbols| PasswordRules { length, upper: true, lower: true, digits: true, symbols, ambiguous: false };
        let p = generate_password(&rules(24, true)).unwrap();
        assert_eq!(p.chars().count(), 24);
        assert!(p.chars().any(|c| c.is_ascii_uppercase()) && p.chars().any(|c| c.is_ascii_lowercase()) && p.chars().any(|c| c.is_ascii_digit()));
        assert!(p.chars().any(|c| !c.is_ascii_alphanumeric()));
        assert!(!p.contains(['0', 'O', 'l', '1', 'I']));
        let p = generate_password(&rules(12, false)).unwrap();
        assert!(p.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(generate_password(&rules(20, true)).unwrap(), generate_password(&rules(20, true)).unwrap());
        let none = PasswordRules { length: 10, upper: false, lower: false, digits: false, symbols: false, ambiguous: false };
        assert!(generate_password(&none).is_err());
    }

    #[test]
    fn case_changes() {
        assert_eq!(change_case("bonjour l'île", "upper").unwrap(), "BONJOUR L'ÎLE");
        assert_eq!(change_case("BONJOUR", "lower").unwrap(), "bonjour");
        assert_eq!(change_case("jean-pierre va à l'île", "title").unwrap(), "Jean-Pierre Va À L'île");
        assert_eq!(change_case("SALUT. ÇA VA ? oui", "sentence").unwrap(), "Salut. Ça va ? Oui");
        assert!(change_case("x", "bidule").is_err());
    }

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
    fn search_finds_clips_and_snippets() {
        let s = Store {
            clips: vec![
                Clip { id: 1, text: "Rendez-vous chez le médecin".into(), pinned: false, at: 5 },
                Clip { id: 2, text: "medecin@exemple.fr".into(), pinned: true, at: 1 },
                Clip { id: 3, text: "autre chose".into(), pinned: false, at: 9 },
            ],
            snippets: vec![Snippet { id: 4, name: "Adresse".into(), text: "12 rue du Médecin".into() }],
            ..Store::default()
        };
        let found = search_json(&s, &json!({ "query": "MEDECIN", "limit": 2 }));
        let items = found["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        // L'épinglé qui commence par « medecin » d'abord, puis la copie.
        assert_eq!((items[0]["id"].as_u64(), items[1]["id"].as_u64()), (Some(2), Some(1)));
        let all = search_json(&s, &json!({ "query": "medecin" }));
        assert_eq!(all["items"].as_array().unwrap().len(), 3);
        assert_eq!(all["items"][2]["kind"], "snippet");
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
