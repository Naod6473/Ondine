// Module « Capture » : capturer une zone de l'écran, en lire le texte (OCR) ou
// l'enregistrer en PNG.
//
// On ne dessine pas notre propre sélection de zone : on ouvre l'outil de
// capture de Windows (celui de Win+Maj+S). Quand tu as choisi la zone, l'image
// arrive dans le presse-papiers ; un petit thread l'attend (2 minutes au plus)
// puis fait la suite : lire le texte, ou enregistrer le fichier.
//
// Les mêmes actions marchent sur une image que tu as déjà copiée.
//
// Règles appliquées ici :
//   - l'OCR est celui de Windows, hors ligne : l'image ne quitte pas l'ordinateur ;
//   - aucun texte lu n'est écrit dans le journal ni envoyé sur le bus ; le front
//     le demande avec la commande "last" ;
//   - le dossier des captures est validé (dossiers exclus) et un fichier
//     enregistré peut être annulé (il part à la Corbeille).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::{ModuleContext, RustModule};
use crate::platform::{self, ocr};
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{bus, files, log};

const ID: &str = "capture";
/// La fenêtre d'annotation (créée cachée au démarrage, voir lib.rs).
const ANNOTATE_WINDOW: &str = "annotate";
/// Taille maximale d'une image annotée qui revient du front (en base64, ~60 Mo).
const MAX_EXPORT_BASE64: usize = 80 * 1024 * 1024;
/// Combien de temps on attend que tu choisisses la zone.
const SNIP_TIMEOUT: Duration = Duration::from_secs(120);

/// Ce que le module retient entre deux commandes.
#[derive(Default)]
struct State {
    /// Le dernier texte lu (pour l'afficher dans l'onglet).
    text: Option<ocr::OcrText>,
    /// Le dernier fichier enregistré (pour « Montrer dans l'Explorateur »).
    saved: Option<PathBuf>,
    /// L'image ouverte dans la fenêtre d'annotation (en PNG).
    to_annotate: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct Capture {
    state: Arc<Mutex<State>>,
    /// Une capture est-elle déjà en attente ? (une seule à la fois)
    waiting: Arc<AtomicBool>,
}

/// Que faire de l'image une fois capturée.
#[derive(Clone, Copy)]
enum Then {
    Ocr,
    Save,
    /// Enregistrer, puis poser le fichier sur l'étagère.
    Shelf,
    /// Ouvrir l'image dans la fenêtre d'annotation.
    Annotate,
}

impl Then {
    fn name(self) -> &'static str {
        match self {
            Then::Ocr => "ocr",
            Then::Save => "save",
            Then::Shelf => "shelf",
            Then::Annotate => "annotate",
        }
    }
}

impl RustModule for Capture {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/capture/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        ctx.require("clipboard")?;
        match command {
            "snip" => {
                let then = match args.get("then").and_then(Value::as_str) {
                    Some("save") => Then::Save,
                    Some("shelf") => Then::Shelf,
                    Some("annotate") => Then::Annotate,
                    _ => Then::Ocr,
                };
                self.snip(ctx.app, then)?;
                Ok(Value::Null)
            }
            "ocr_clipboard" => run(ctx, &self.state, Then::Ocr),
            "save_clipboard" => run(ctx, &self.state, Then::Save),
            "shelf_clipboard" => run(ctx, &self.state, Then::Shelf),
            "annotate_clipboard" => run(ctx, &self.state, Then::Annotate),
            "annotate_image" => {
                let png = self.state.lock().unwrap().to_annotate.clone().ok_or("aucune image à annoter")?;
                Ok(json!({ "url": format!("data:image/png;base64,{}", BASE64.encode(png)) }))
            }
            "annotate_export" => self.annotate_export(ctx, &args),
            "last" => Ok(json!({ "result": self.state.lock().unwrap().text })),
            "copy_last" => {
                let text = self.state.lock().unwrap().text.as_ref().map(|t| t.text.clone()).ok_or("aucun texte lu")?;
                files::copy_text(&text)?;
                Ok(Value::Null)
            }
            "reveal" => {
                let saved = self.state.lock().unwrap().saved.clone().ok_or("aucune capture enregistrée")?;
                let path = ctx.check_path(&saved.display().to_string())?;
                files::reveal(&path)?;
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

impl Capture {
    /// L'image annotée revient de la fenêtre d'annotation, en PNG : on la
    /// copie, l'enregistre, ou l'enregistre et la pose sur l'étagère.
    fn annotate_export(&self, ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
        let encoded = args.get("png").and_then(Value::as_str).ok_or("image manquante")?;
        if encoded.len() > MAX_EXPORT_BASE64 {
            return Err("image trop grande".into());
        }
        let png = BASE64.decode(encoded).map_err(|_| "image illisible".to_string())?;
        // On vérifie que c'est bien une image PNG, et on la décode (ce qui la valide).
        let rgba = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
            .map_err(|e| format!("image illisible : {e}"))?
            .to_rgba8();
        let (action, result) = match args.get("then").and_then(Value::as_str) {
            Some("copy") => {
                let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
                clipboard
                    .set_image(arboard::ImageData {
                        width: rgba.width() as usize,
                        height: rgba.height() as usize,
                        bytes: rgba.as_raw().into(),
                    })
                    .map_err(|e| format!("presse-papiers : {e}"))?;
                ("copy", json!({}))
            }
            Some("shelf") => ("shelf", saved_json(ctx, &self.state, &png, true)?),
            _ => ("save", saved_json(ctx, &self.state, &png, false)?),
        };
        bus::emit(ctx.app, ID, "capture.done", json!({ "action": action, "ok": true, "result": result }));
        Ok(result)
    }

    /// Ouvre l'outil de capture de Windows, puis attend l'image dans un thread.
    fn snip(&self, app: &AppHandle, then: Then) -> Result<(), String> {
        if self.waiting.swap(true, Ordering::SeqCst) {
            return Err("une capture est déjà en cours".into());
        }
        let (app, state, waiting) = (app.clone(), self.state.clone(), self.waiting.clone());
        std::thread::spawn(move || {
            platform::media::init_thread(); // COM, pour ouvrir l'outil et pour l'OCR
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| wait_and_run(&app, &state, then)));
            waiting.store(false, Ordering::SeqCst);
            let payload = match outcome {
                Ok(Some(Ok(result))) => json!({ "action": then.name(), "ok": true, "result": result }),
                Ok(Some(Err(error))) => json!({ "action": then.name(), "ok": false, "error": error }),
                Ok(None) => return, // capture abandonnée : rien à dire
                Err(_) => {
                    log::warn("capture : panique pendant la capture");
                    json!({ "action": then.name(), "ok": false, "error": "erreur interne" })
                }
            };
            bus::emit(&app, ID, "capture.done", payload);
        });
        Ok(())
    }
}

/// Le travail du thread de capture. None = abandonnée (Échap, ou autre chose copié).
fn wait_and_run(app: &AppHandle, state: &Arc<Mutex<State>>, then: Then) -> Option<Result<Value, String>> {
    // Le temps que l'île se replie : elle ne doit pas apparaître sur la capture.
    std::thread::sleep(Duration::from_millis(400));
    let before = platform::clipboard_sequence();
    if let Err(e) = platform::launch_screen_snip() {
        return Some(Err(e));
    }
    let start = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(250));
        if start.elapsed() > SNIP_TIMEOUT {
            log::info("capture : abandonnée (aucune image après 2 minutes)");
            return None;
        }
        if platform::clipboard_sequence() == before {
            continue;
        }
        // Le presse-papiers a changé : on laisse l'outil finir d'écrire.
        std::thread::sleep(Duration::from_millis(200));
        if read_image().is_err() {
            log::info("capture : abandonnée (autre chose a été copié)");
            return None;
        }
        return super::with_context(app, ID, |ctx| run(ctx, state, then));
    }
}

/// Lit le texte de l'image copiée, ou l'enregistre.
fn run(ctx: &ModuleContext, state: &Arc<Mutex<State>>, then: Then) -> Result<Value, String> {
    let (width, height, bytes) = read_image()?;
    match then {
        Then::Ocr => {
            let result = ocr::recognize(ocr::Rgba { width, height, bytes: &bytes })?;
            if result.text.trim().is_empty() {
                return Err("aucun texte trouvé dans l'image".into());
            }
            let copied = ctx.settings().get("copyText").and_then(Value::as_bool).unwrap_or(true);
            if copied {
                files::copy_text(&result.text)?;
            }
            // Le journal dit qu'on a lu, jamais ce qu'on a lu.
            ctx.log_info(format!("texte lu dans une image ({} caractères)", result.text.chars().count()));
            let out = json!({ "chars": result.text.chars().count(), "language": result.language, "copied": copied });
            state.lock().unwrap().text = Some(result);
            Ok(out)
        }
        Then::Save | Then::Shelf => {
            let png = encode_png(width, height, &bytes)?;
            saved_json(ctx, state, &png, matches!(then, Then::Shelf))
        }
        Then::Annotate => {
            state.lock().unwrap().to_annotate = Some(encode_png(width, height, &bytes)?);
            // La fenêtre d'annotation relit l'image quand elle reçoit "annotate-load".
            crate::show_window(ctx.app, ANNOTATE_WINDOW);
            let _ = ctx.app.emit_to(ANNOTATE_WINDOW, "annotate-load", ());
            Ok(json!({ "width": width, "height": height }))
        }
    }
}

/// Enregistre le PNG, le pose sur l'étagère si demandé, propose « Annuler ».
fn saved_json(ctx: &ModuleContext, state: &Arc<Mutex<State>>, png: &[u8], to_shelf: bool) -> Result<Value, String> {
    let path = save_png(ctx, png)?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    ctx.log_info("capture enregistrée");
    if to_shelf {
        // Les modules ne s'appellent pas : on passe par le bus.
        ctx.emit("shelf.add", json!({ "paths": [path.display().to_string()] }));
    }
    state.lock().unwrap().saved = Some(path.clone());
    let undo_path = path.clone();
    let undo_id = ctx.offer_undo(
        &format!("« {name} » enregistrée"),
        DEFAULT_WINDOW,
        Box::new(move || files::to_trash(&[undo_path])),
    );
    Ok(json!({ "name": name, "path": path.display().to_string(), "undoId": undo_id }))
}

/// Pixels RGBA → fichier PNG en mémoire.
fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::write_buffer_with_format(&mut out, rgba, width, height, image::ExtendedColorType::Rgba8, image::ImageFormat::Png)
        .map_err(|e| format!("encodage PNG impossible : {e}"))?;
    Ok(out.into_inner())
}

/// L'image du presse-papiers : (largeur, hauteur, pixels RGBA).
fn read_image() -> Result<(u32, u32, Vec<u8>), String> {
    if platform::clipboard_is_sensitive() {
        return Err("le contenu copié est marqué sensible : on n'y touche pas".into());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
    let image = clipboard.get_image().map_err(|_| "le presse-papiers ne contient pas d'image".to_string())?;
    Ok((image.width as u32, image.height as u32, image.bytes.into_owned()))
}

/// Écrit le PNG dans le dossier des captures et renvoie son chemin.
fn save_png(ctx: &ModuleContext, png: &[u8]) -> Result<PathBuf, String> {
    let dir = capture_dir(ctx)?;
    let t = platform::local_time();
    let name = format!(
        "Capture {:04}-{:02}-{:02} {:02}.{:02}.{:02}.png",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    );
    let path = files::unique_dest(&dir, name.as_ref());
    std::fs::write(&path, png).map_err(|e| format!("enregistrement impossible : {e}"))?;
    Ok(path)
}

/// Le dossier choisi dans les réglages, sinon Images\Island (créé si besoin).
/// Validé comme tout autre chemin : un dossier exclu est refusé.
fn capture_dir(ctx: &ModuleContext) -> Result<PathBuf, String> {
    let chosen = ctx
        .settings()
        .get("folder")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let dir = match chosen {
        Some(dir) => dir,
        None => {
            let dir = platform::pictures_dir().ok_or("dossier Images introuvable")?.join("Island");
            std::fs::create_dir_all(&dir).map_err(|e| format!("impossible de créer {} : {e}", dir.display()))?;
            dir
        }
    };
    let dir = ctx.check_path(&dir.display().to_string())?;
    if !dir.is_dir() {
        return Err(format!("{} n'est pas un dossier", dir.display()));
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    #[test]
    fn png_round_trip() {
        // Ce que save_png écrit doit être une image PNG lisible, de la bonne taille.
        let dir = std::env::temp_dir().join("island-capture-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.png");
        let pixels = vec![200u8; 3 * 2 * 4];
        std::fs::write(&path, super::encode_png(3, 2, &pixels).unwrap()).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[1..4], b"PNG");
        let back = image::open(&path).unwrap().to_rgba8();
        assert_eq!((back.width(), back.height()), (3, 2));
    }
}
