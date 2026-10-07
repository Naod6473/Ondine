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
//
// La pipette (choisir une couleur à l'écran) vit aussi ici : la fenêtre est
// dans platform/picker.rs, les calculs (HEX, RGB, HSL, historique) dans
// capture/color.rs.
//
// « Enregistrer un GIF » aussi : on choisit une zone de l'écran (fenêtre de
// sélection et prise des images dans platform/record.rs), elle est copiée dix
// fois par seconde pendant 10 s au plus (réglable, 30 s maximum) ou jusqu'à
// « Arrêter », et les images deviennent un GIF animé (capture/gif.rs) dans un
// deuxième fil, pour que la prise des images garde son rythme. Le GIF va dans
// le dossier des captures, sur l'étagère, et peut être annulé (Corbeille).
// Pas de vidéo MP4 : il faudrait un encodeur vidéo (Media Foundation ou une
// grosse crate) pour un usage plus rare.

mod color;
mod gif;

use crate::sync::LockExt;
use std::io::{BufWriter, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use self::color::{Format, Rgb};
use self::gif::GifWriter;
use super::{ModuleContext, RustModule};
use crate::platform::record::{self, Area};
use crate::platform::{self, ocr, picker};
use crate::services::bus::BusMessage;
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{bus, files, log, search};

const ID: &str = "capture";
/// La fenêtre d'annotation (créée cachée au démarrage, voir lib.rs).
const ANNOTATE_WINDOW: &str = "annotate";
/// Taille maximale d'une image annotée qui revient du front (en base64, ~60 Mo).
const MAX_EXPORT_BASE64: usize = 80 * 1024 * 1024;
/// Combien de temps on attend que tu choisisses la zone.
const SNIP_TIMEOUT: Duration = Duration::from_secs(120);
/// Le temps que l'île se replie avant la photo de l'écran de la pipette.
const PICK_DELAY: Duration = Duration::from_millis(450);
/// GIF : durée maximale par défaut, et bornes du réglage « gifSeconds » (secondes).
const GIF_DEFAULT_SECONDS: u64 = 10;
const GIF_MIN_SECONDS: u64 = 2;
const GIF_MAX_SECONDS: u64 = 30;
/// GIF : une image toutes les… (10 par seconde).
const GIF_FRAME_EVERY: Duration = Duration::from_millis(100);
/// GIF : images en attente d'écriture, au plus (environ 1,5 Mo chacune en
/// 960 × 540). Si l'écriture prend du retard, les images en trop sont sautées
/// (le GIF garde le bon rythme : la précédente reste affichée plus longtemps).
const GIF_QUEUE: usize = 20;

/// Ce que le module retient entre deux commandes.
#[derive(Default)]
struct State {
    /// Le dernier texte lu (pour l'afficher dans l'onglet).
    text: Option<ocr::OcrText>,
    /// Le dernier fichier enregistré (pour « Montrer dans l'Explorateur »).
    saved: Option<PathBuf>,
    /// L'image ouverte dans la fenêtre d'annotation (en PNG).
    to_annotate: Option<Vec<u8>>,
    /// Les dernières couleurs prises à la pipette (la plus récente en tête),
    /// relues depuis colors.json au premier usage.
    colors: Option<Vec<Rgb>>,
}

#[derive(Default)]
pub struct Capture {
    state: Arc<Mutex<State>>,
    /// Une capture est-elle déjà en attente ? (une seule à la fois)
    waiting: Arc<AtomicBool>,
    /// La pipette est-elle ouverte ? (une seule à la fois)
    picking: Arc<AtomicBool>,
    /// Un GIF est-il en cours (choix de la zone, enregistrement, écriture) ? (un seul à la fois)
    gif_busy: Arc<AtomicBool>,
    /// « Arrêter » a été demandé pour le GIF en cours.
    gif_stop: Arc<AtomicBool>,
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
                let png = self.state.locked().to_annotate.clone().ok_or("aucune image à annoter")?;
                Ok(json!({ "url": format!("data:image/png;base64,{}", BASE64.encode(png)) }))
            }
            "annotate_export" => self.annotate_export(ctx, &args),
            "last" => Ok(json!({ "result": self.state.locked().text })),
            "copy_last" => {
                let text = self.state.locked().text.as_ref().map(|t| t.text.clone()).ok_or("aucun texte lu")?;
                files::copy_text(&text)?;
                Ok(Value::Null)
            }
            // { query, limit } → { items } : la recherche du Lanceur (captures
            // enregistrées : nom et date ; dernier texte lu).
            "search" => Ok(search_json(ctx, &self.state, &args)),
            // { name } : ouvre une capture du dossier des captures.
            "open" => {
                let name = args.get("name").and_then(Value::as_str).ok_or("paramètre « name » manquant")?;
                let path = ctx.check_path(&capture_file(ctx, name)?.display().to_string())?;
                super::launcher::open_checked(&path)?;
                Ok(Value::Null)
            }
            "pick_color" => {
                self.pick_color(ctx.app)?;
                Ok(Value::Null)
            }
            "colors" => Ok(colors_json(ctx, &self.state)),
            // { hint } : choisir une zone de l'écran, puis l'enregistrer en GIF.
            // Répond tout de suite ; la suite arrive par "capture.gif".
            "gif_start" => {
                self.gif_start(ctx, &args)?;
                Ok(Value::Null)
            }
            // « Arrêter » : le GIF en cours s'arrête à la prochaine image et s'écrit.
            "gif_stop" => {
                self.gif_stop.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            "copy_color" => {
                // Le front n'envoie qu'une couleur « #RRGGBB » : rien d'autre n'est copié.
                let hex = args.get("hex").and_then(Value::as_str).unwrap_or_default();
                let rgb = Rgb::from_hex(hex).ok_or("couleur invalide")?;
                let text = rgb.text(color_format(ctx));
                files::copy_text(&text)?;
                // Reprendre une couleur la remonte en tête de l'historique.
                remember_color(&self.state, rgb);
                Ok(json!({ "text": text }))
            }
            "reveal" => {
                let saved = self.state.locked().saved.clone().ok_or("aucune capture enregistrée")?;
                let path = ctx.check_path(&saved.display().to_string())?;
                files::reveal(&path)?;
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// « capture.pick » : le Lanceur demande la pipette.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic != "capture.pick" {
            return;
        }
        if let Err(e) = self.pick_color(ctx.app) {
            ctx.emit("capture.color", json!({ "ok": false, "error": e }));
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

impl Capture {
    /// Ouvre la pipette dans un fil à part ; la couleur choisie arrive par
    /// « capture.color » (rien si on annule).
    fn pick_color(&self, app: &AppHandle) -> Result<(), String> {
        if self.picking.swap(true, Ordering::SeqCst) {
            return Err("la pipette est déjà ouverte".into());
        }
        let (app, state, picking) = (app.clone(), self.state.clone(), self.picking.clone());
        std::thread::spawn(move || {
            // Le temps que l'île se replie : elle ne doit pas être sur la photo.
            std::thread::sleep(PICK_DELAY);
            let outcome = std::panic::catch_unwind(picker::pick);
            picking.store(false, Ordering::SeqCst);
            let payload = match outcome {
                Ok(Ok(Some((r, g, b)))) => {
                    let rgb = Rgb { r, g, b };
                    let done = super::with_context(&app, ID, |ctx| -> Result<String, String> {
                        let text = rgb.text(color_format(ctx));
                        files::copy_text(&text)?;
                        Ok(text)
                    });
                    match done {
                        None => return, // module coupé entre-temps
                        Some(Ok(text)) => {
                            remember_color(&state, rgb);
                            json!({ "ok": true, "hex": rgb.hex(), "text": text })
                        }
                        Some(Err(error)) => json!({ "ok": false, "error": error }),
                    }
                }
                Ok(Ok(None)) => return, // annulée (Échap) : rien à dire
                Ok(Err(error)) => json!({ "ok": false, "error": error }),
                Err(_) => {
                    log::warn("capture : panique dans la pipette");
                    json!({ "ok": false, "error": "erreur interne" })
                }
            };
            bus::emit(&app, ID, "capture.color", payload);
        });
        Ok(())
    }
}

// ── GIF animé ────────────────────────────────────────────────────────────────

/// Ce dont le fil du GIF a besoin.
struct GifJob {
    app: AppHandle,
    state: Arc<Mutex<State>>,
    /// Le dossier des captures (déjà vérifié).
    dir: PathBuf,
    /// Durée maximale de l'enregistrement.
    seconds: u64,
    /// Dessiner la souris sur les images.
    cursor: bool,
    /// L'aide affichée pendant le choix de la zone (traduite par le front).
    hint: String,
    stop: Arc<AtomicBool>,
}

/// Ce que le fil de prise des images envoie au fil d'écriture.
enum GifMsg {
    /// Une image (RGB) et le moment où elle a été prise.
    Frame(Vec<u8>, Duration),
    /// Fin de l'enregistrement, à ce moment-là.
    End(Duration),
}

impl Capture {
    /// Lance le GIF dans un fil à part : choix de la zone, enregistrement,
    /// écriture. Chaque étape est annoncée par "capture.gif" { state } :
    /// "recording", "encoding", puis "done", "cancelled" ou "error".
    fn gif_start(&self, ctx: &ModuleContext, args: &Value) -> Result<(), String> {
        let hint: String = args.get("hint").and_then(Value::as_str).unwrap_or_default().chars().take(200).collect();
        let settings = ctx.settings();
        let seconds = settings
            .get("gifSeconds")
            .and_then(Value::as_f64)
            .map(|v| v.round().max(0.0) as u64)
            .unwrap_or(GIF_DEFAULT_SECONDS)
            .clamp(GIF_MIN_SECONDS, GIF_MAX_SECONDS);
        let cursor = settings.get("gifCursor").and_then(Value::as_bool).unwrap_or(true);
        // Le dossier est vérifié tout de suite : un dossier exclu ou absent est
        // signalé avant même de choisir la zone.
        let dir = capture_dir(ctx, true)?;
        if self.gif_busy.swap(true, Ordering::SeqCst) {
            return Err("un GIF est déjà en cours".into());
        }
        self.gif_stop.store(false, Ordering::SeqCst);
        let job = GifJob { app: ctx.app.clone(), state: self.state.clone(), dir, seconds, cursor, hint, stop: self.gif_stop.clone() };
        let busy = self.gif_busy.clone();
        let spawned = std::thread::Builder::new().name("ondine-gif".into()).spawn(move || {
            let outcome = catch_unwind(AssertUnwindSafe(|| record_gif(&job)));
            busy.store(false, Ordering::SeqCst);
            let payload = outcome.unwrap_or_else(|_| {
                log::warn("capture : panique pendant le GIF");
                json!({ "state": "error", "error": "erreur interne" })
            });
            bus::emit(&job.app, ID, "capture.gif", payload);
        });
        if let Err(e) = spawned {
            self.gif_busy.store(false, Ordering::SeqCst);
            return Err(format!("enregistrement impossible : {e}"));
        }
        Ok(())
    }
}

/// Le travail du fil du GIF. Renvoie le dernier message "capture.gif".
fn record_gif(job: &GifJob) -> Value {
    // Le temps que l'île se replie : elle ne doit pas être sur la photo du bureau.
    std::thread::sleep(Duration::from_millis(400));
    let area = match record::select_area(&job.hint) {
        Ok(Some(area)) => area,
        Ok(None) => return json!({ "state": "cancelled" }),
        Err(e) => return json!({ "state": "error", "error": e }),
    };
    record_area(job, area).unwrap_or_else(|e| json!({ "state": "error", "error": e }))
}

/// Tant qu'il existe, l'île est absente des captures d'écran (et du GIF).
struct IslandHidden<'a> {
    app: &'a AppHandle,
    hidden: bool,
}

impl<'a> IslandHidden<'a> {
    fn new(app: &'a AppHandle) -> Self {
        let hidden = record::hide_from_capture(app, true);
        if !hidden {
            log::info("capture : l'île ne peut pas être retirée du GIF (Windows 10 version 2004 ou plus requis)");
        }
        IslandHidden { app, hidden }
    }
}

impl Drop for IslandHidden<'_> {
    fn drop(&mut self) {
        if self.hidden {
            record::hide_from_capture(self.app, false);
        }
    }
}

/// Enregistre la zone choisie, puis écrit le GIF. Ok = le message "done".
fn record_area(job: &GifJob, area: Area) -> Result<Value, String> {
    let (width, height) = gif::fit_size(area.width, area.height, gif::MAX_SIDE);
    // Pendant l'enregistrement, l'île est absente du GIF (vous la voyez quand même).
    let hidden = IslandHidden::new(&job.app);
    // Le temps que la fenêtre de sélection disparaisse de l'écran, et que
    // Windows retire l'île des captures, avant la première image.
    std::thread::sleep(Duration::from_millis(250));
    let grabber = record::Grabber::new(area, width, height, job.cursor)?;
    let path = files::unique_dest(&job.dir, capture_name("gif").as_ref());
    let file = std::fs::File::create(&path).map_err(|e| format!("enregistrement impossible : {e}"))?;

    // L'écriture du GIF, dans un deuxième fil : la prise des images garde son rythme.
    let (tx, rx) = mpsc::sync_channel::<GifMsg>(GIF_QUEUE);
    let writer = std::thread::Builder::new()
        .name("ondine-gif-ecriture".into())
        .spawn(move || catch_unwind(AssertUnwindSafe(|| write_gif(file, width, height, rx))).unwrap_or_else(|_| Err("erreur interne".into())));
    let writer = match writer {
        Ok(w) => w,
        Err(e) => {
            let _ = files::to_trash(std::slice::from_ref(&path));
            return Err(format!("enregistrement impossible : {e}"));
        }
    };

    let mut first_error = None;
    let mut skipped = 0u32;
    let end = {
        // Pendant l'enregistrement : un cadre rouge autour de la zone (à l'extérieur).
        // Le cadre et la copie de l'écran sont lâchés à la fin de ce bloc.
        let outline = record::Outline::show(area);
        let mut grabber = grabber;
        bus::emit(&job.app, ID, "capture.gif", json!({ "state": "recording", "seconds": job.seconds, "width": width, "height": height }));
        let limit = Duration::from_secs(job.seconds);
        let mut grabbed = 0u32;
        let start = Instant::now();
        loop {
            let at = start.elapsed();
            if at >= limit || job.stop.load(Ordering::SeqCst) {
                break;
            }
            outline.pump();
            match grabber.grab() {
                Ok(rgb) => {
                    grabbed += 1;
                    match tx.try_send(GifMsg::Frame(rgb, at)) {
                        Ok(()) => {}
                        // L'écriture a du retard : on saute cette image.
                        Err(TrySendError::Full(_)) => skipped += 1,
                        // L'écriture s'est arrêtée (une erreur, lue plus bas).
                        Err(TrySendError::Disconnected(_)) => break,
                    }
                }
                // Dès la première image : on abandonne. En route (écran verrouillé
                // un instant…) : on saute l'image.
                Err(e) if grabbed == 0 => {
                    first_error = Some(e);
                    break;
                }
                Err(_) => skipped += 1,
            }
            // La prochaine image, au prochain dixième de seconde (sans rattraper
            // les images manquées : l'image d'avant reste affichée plus longtemps).
            let now = start.elapsed();
            let ticks = now.as_millis() / GIF_FRAME_EVERY.as_millis() + 1;
            let next = GIF_FRAME_EVERY * ticks as u32;
            std::thread::sleep(next.saturating_sub(now).min(limit.saturating_sub(now)));
        }
        start.elapsed().min(limit)
    };
    drop(hidden);
    // L'île et le cadre sont rendus : reste l'écriture des dernières images.
    let _ = tx.send(GifMsg::End(end));
    drop(tx);
    bus::emit(&job.app, ID, "capture.gif", json!({ "state": "encoding" }));
    let written = writer.join().unwrap_or_else(|_| Err("erreur interne".into()));
    let frames = match (first_error, written) {
        (None, Ok(frames)) => frames,
        (error, written) => {
            // Le fichier commencé part à la Corbeille (jamais supprimé pour de bon).
            if let Err(e) = files::to_trash(std::slice::from_ref(&path)) {
                log::warn(format!("capture : GIF inachevé laissé dans le dossier des captures ({e})"));
            }
            return Err(error.or(written.err()).unwrap_or_else(|| "erreur interne".into()));
        }
    };

    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let tenths = end.as_millis() / 100;
    let undo_id = super::with_context(&job.app, ID, |ctx| {
        // Le journal dit ce qui a été fait, jamais ce qu'il y avait à l'écran.
        ctx.log_info(format!("GIF enregistré ({frames} images, {}.{} s, {} Ko, {skipped} sautées)", tenths / 10, tenths % 10, bytes / 1024));
        // Les modules ne s'appellent pas : on passe par le bus.
        ctx.emit("shelf.add", json!({ "paths": [path.display().to_string()] }));
        job.state.locked().saved = Some(path.clone());
        let undo_path = path.clone();
        ctx.offer_undo(&format!("« {name} » enregistrée"), DEFAULT_WINDOW, Box::new(move || files::to_trash(&[undo_path])))
    });
    Ok(json!({
        "state": "done",
        "name": name,
        "path": path.display().to_string(),
        "frames": frames,
        "seconds": tenths as f64 / 10.0,
        "bytes": bytes,
        "undoId": undo_id,
    }))
}

/// Le fil d'écriture : reçoit les images et les ajoute au GIF. Ok = le nombre d'images.
fn write_gif(file: std::fs::File, width: u32, height: u32, rx: mpsc::Receiver<GifMsg>) -> Result<u32, String> {
    let mut gif = GifWriter::new(BufWriter::new(file), width, height)?;
    let mut end = Duration::ZERO;
    for msg in rx {
        match msg {
            GifMsg::Frame(rgb, at) => {
                gif.push(&rgb, at)?;
                end = at;
            }
            GifMsg::End(at) => {
                end = at;
                break;
            }
        }
    }
    let frames = gif.frames();
    if frames == 0 {
        return Err("aucune image enregistrée".into());
    }
    let mut out = gif.finish(end)?;
    out.flush().map_err(|e| format!("écriture du GIF impossible : {e}"))?;
    Ok(frames)
}

/// Le format choisi dans les réglages (HEX par défaut).
fn color_format(ctx: &ModuleContext) -> Format {
    Format::parse(ctx.settings().get("colorFormat").and_then(Value::as_str))
}

/// L'historique des couleurs (relu depuis le fichier la première fois).
fn colors_of(state: &mut State) -> &mut Vec<Rgb> {
    state.colors.get_or_insert_with(load_colors)
}

/// Ajoute une couleur à l'historique et l'enregistre.
fn remember_color(state: &Arc<Mutex<State>>, rgb: Rgb) {
    let mut s = state.locked();
    let colors = colors_of(&mut s);
    color::push_history(colors, rgb);
    if let Err(e) = save_colors(colors) {
        log::warn(format!("capture : historique des couleurs non enregistré : {e}"));
    }
}

/// L'historique pour l'onglet : chaque couleur en HEX (la pastille) et dans le
/// format choisi (ce qui sera copié).
fn colors_json(ctx: &ModuleContext, state: &Arc<Mutex<State>>) -> Value {
    let format = color_format(ctx);
    let mut s = state.locked();
    let list: Vec<Value> = colors_of(&mut s).iter().map(|c| json!({ "hex": c.hex(), "text": c.text(format) })).collect();
    json!({ "colors": list })
}

fn colors_file() -> PathBuf {
    platform::config_dir().join("colors.json")
}

/// Relit colors.json (une liste de « #RRGGBB »). Un fichier abîmé est mis de
/// côté, jamais effacé ; une valeur qui n'est pas une couleur est ignorée.
fn load_colors() -> Vec<Rgb> {
    let Ok(text) = std::fs::read_to_string(colors_file()) else { return Vec::new() };
    match serde_json::from_str::<Vec<String>>(&text) {
        Ok(list) => list.iter().filter_map(|h| Rgb::from_hex(h)).take(color::HISTORY_MAX).collect(),
        Err(e) => {
            let aside = platform::config_dir().join(format!("colors.broken-{}.json", platform::local_time().file_stamp()));
            let _ = std::fs::rename(colors_file(), &aside);
            log::warn(format!("capture : couleurs illisibles ({e}), mises de côté dans {}", aside.display()));
            Vec::new()
        }
    }
}

/// Écrit colors.json (via un fichier temporaire renommé).
fn save_colors(colors: &[Rgb]) -> Result<(), String> {
    let dir = platform::config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let list: Vec<String> = colors.iter().map(|c| c.hex()).collect();
    let json = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    let tmp = dir.join("colors.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, colors_file()).map_err(|e| e.to_string())
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
            state.locked().text = Some(result);
            Ok(out)
        }
        Then::Save | Then::Shelf => {
            let png = encode_png(width, height, &bytes)?;
            saved_json(ctx, state, &png, matches!(then, Then::Shelf))
        }
        Then::Annotate => {
            state.locked().to_annotate = Some(encode_png(width, height, &bytes)?);
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
    state.locked().saved = Some(path.clone());
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
    let dir = capture_dir(ctx, true)?;
    let path = files::unique_dest(&dir, capture_name("png").as_ref());
    std::fs::write(&path, png).map_err(|e| format!("enregistrement impossible : {e}"))?;
    Ok(path)
}

/// « Capture 2026-10-06 14.03.22.png » (ou .gif) : le nom d'une capture prise maintenant.
fn capture_name(extension: &str) -> String {
    let t = platform::local_time();
    format!("Capture {:04}-{:02}-{:02} {:02}.{:02}.{:02}.{extension}", t.year, t.month, t.day, t.hour, t.minute, t.second)
}

/// Le dossier choisi dans les réglages, sinon Images\Ondine (créé si besoin,
/// quand `create` est vrai). Validé comme tout autre chemin : un dossier exclu
/// est refusé.
fn capture_dir(ctx: &ModuleContext, create: bool) -> Result<PathBuf, String> {
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
            let dir = platform::pictures_dir().ok_or("dossier Images introuvable")?.join("Ondine");
            if !create {
                return ctx.check_path(&dir.display().to_string());
            }
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

// ── Recherche dans l'île ─────────────────────────────────────────────────────

/// Au plus autant de fichiers regardés dans le dossier des captures.
const MAX_SCAN: usize = 3000;

/// Les captures enregistrées (nom, date) et le dernier texte lu qui
/// correspondent à la recherche. Le texte lu n'est gardé qu'en mémoire : seul
/// le dernier est cherchable.
fn search_json(ctx: &ModuleContext, state: &Arc<Mutex<State>>, args: &Value) -> Value {
    let (query, limit) = search::args(args);
    if query.is_empty() {
        return json!({ "items": [] });
    }
    let mut hits = Vec::new();
    if let Some(t) = state.locked().text.as_ref() {
        let score = search::score_titled("texte lu", &t.text, &query);
        if score > 0 {
            let value = json!({ "kind": "text", "title": "Dernier texte lu", "detail": search::excerpt(&t.text, &query, 90) });
            hits.push(search::Hit { score, at: u64::MAX, value });
        }
    }
    // Un dossier exclu (Confidentialité) ou absent : aucune capture montrée.
    if let Ok(dir) = capture_dir(ctx, false) {
        if let Ok(read) = std::fs::read_dir(&dir) {
            for item in read.flatten().take(MAX_SCAN) {
                let path = item.path();
                if !is_image(&path) {
                    continue;
                }
                let name = item.file_name().to_string_lossy().to_string();
                let modified = item.metadata().ok().and_then(|m| m.modified().ok());
                let (date, at) = modified.map(date_of).unwrap_or_default();
                let score = search::score_titled(&name, &date, &query);
                if score > 0 {
                    let value = json!({ "kind": "file", "name": name, "title": name, "detail": date, "at": at });
                    hits.push(search::Hit { score, at, value });
                }
            }
        }
    }
    json!({ "items": search::best(hits, limit) })
}

/// Une date de fichier → (« 6 octobre 2026 à 14:03 », millisecondes depuis 1970).
fn date_of(time: std::time::SystemTime) -> (String, u64) {
    use chrono::{Datelike, Timelike};
    let local = chrono::DateTime::<chrono::Local>::from(time);
    let text = format!(
        "{} à {:02}:{:02}",
        search::french_date(local.year(), local.month(), local.day()),
        local.hour(),
        local.minute()
    );
    let ms = time.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    (text, ms)
}

/// Les images que l'île sait enregistrer (et qu'on peut proposer d'ouvrir).
fn is_image(path: &std::path::Path) -> bool {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif")
}

/// Le chemin d'une capture d'après son nom : un simple nom de fichier image,
/// dans le dossier des captures (jamais un chemin venu du front).
fn capture_file(ctx: &ModuleContext, name: &str) -> Result<PathBuf, String> {
    if !is_plain_name(name) {
        return Err("nom de capture invalide".into());
    }
    let path = capture_dir(ctx, false)?.join(name);
    if !is_image(&path) || !path.is_file() {
        return Err("cette capture n'existe plus".into());
    }
    Ok(path)
}

/// Un nom de fichier seul : pas de dossier, pas de « .. », pas de lecteur.
fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':']) && name.len() <= 255
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_plain_file_names_are_opened() {
        assert!(super::is_plain_name("Capture 2026-10-06 14.03.22.png"));
        assert!(!super::is_plain_name("..\\secret.png"));
        assert!(!super::is_plain_name("C:capture.png"));
        assert!(!super::is_plain_name("sous/dossier.png"));
        assert!(!super::is_plain_name(".."));
        assert!(super::is_image(std::path::Path::new("a.PNG")));
        assert!(super::is_image(std::path::Path::new("Capture 2026-10-07 10.00.00.gif")));
        assert!(!super::is_image(std::path::Path::new("a.exe")));
    }

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
