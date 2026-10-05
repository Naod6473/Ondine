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

use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform::{self, ocr};
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{bus, files, log};

const ID: &str = "capture";
/// Combien de temps on attend que tu choisisses la zone.
const SNIP_TIMEOUT: Duration = Duration::from_secs(120);

/// Ce que le module retient entre deux commandes.
#[derive(Default)]
struct State {
    /// Le dernier texte lu (pour l'afficher dans l'onglet).
    text: Option<ocr::OcrText>,
    /// Le dernier fichier enregistré (pour « Montrer dans l'Explorateur »).
    saved: Option<PathBuf>,
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
}

impl Then {
    fn name(self) -> &'static str {
        match self {
            Then::Ocr => "ocr",
            Then::Save => "save",
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
                    _ => Then::Ocr,
                };
                self.snip(ctx.app, then)?;
                Ok(Value::Null)
            }
            "ocr_clipboard" => run(ctx, &self.state, Then::Ocr),
            "save_clipboard" => run(ctx, &self.state, Then::Save),
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
        Then::Save => {
            let path = save_png(ctx, width, height, &bytes)?;
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            ctx.log_info("capture enregistrée");
            state.lock().unwrap().saved = Some(path.clone());
            let undo_path = path.clone();
            let undo_id = ctx.offer_undo(
                &format!("« {name} » enregistrée"),
                DEFAULT_WINDOW,
                Box::new(move || files::to_trash(&[undo_path])),
            );
            Ok(json!({ "name": name, "path": path.display().to_string(), "undoId": undo_id }))
        }
    }
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

/// Enregistre l'image en PNG dans le dossier des captures et renvoie son chemin.
fn save_png(ctx: &ModuleContext, width: u32, height: u32, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = capture_dir(ctx)?;
    let t = platform::local_time();
    let name = format!(
        "Capture {:04}-{:02}-{:02} {:02}.{:02}.{:02}.png",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    );
    let path = files::unique_dest(&dir, name.as_ref());
    image::save_buffer(&path, bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("enregistrement impossible : {e}"))?;
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
        image::save_buffer(&path, &pixels, 3, 2, image::ExtendedColorType::Rgba8).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[1..4], b"PNG");
    }
}
