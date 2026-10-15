// Ondine convertit (1.2.5) : un fichier glissé vers l'île, lâché sur une
// pilule de format (JPG, PDF, MP3, ZIP…), est converti ici.
//
// Le geste et les animations sont dans le front (src/island/convert-gesture.ts) ;
// le module du front (src/modules/convert/) reçoit le choix (« convert.request »)
// et appelle `start`. Le travail se fait dans un thread, un fichier après
// l'autre : un échec n'arrête pas les autres. Pendant ce temps,
// "convert.progress" donne la part faite ; à la fin, "convert.done" donne le
// résultat (noms, tailles avant et après, raison d'un échec en une ligne).
//
// Règles de l'île appliquées ici :
//   - chaque chemin reçu est validé (ctx.check_path : permission « files » et
//     dossiers exclus), la destination aussi ;
//   - jamais d'écrasement : le nouveau fichier prend un nom libre
//     (« photo (2).jpg ») ; un fichier à moitié écrit part à la Corbeille ;
//   - « Remplacer » : l'original part à la Corbeille SEULEMENT une fois la
//     conversion réussie ; « Annuler » (10 s) remet l'original et envoie le
//     nouveau fichier à la Corbeille. « Conserver » et « Sur le bureau » :
//     « Annuler » envoie le nouveau fichier à la Corbeille ;
//   - confidentialité : tout se fait sur ce PC (crate `image`, et ce que
//     Windows sait déjà faire : platform/convert.rs). Le journal ne note que
//     le format et des nombres, jamais un nom ni un contenu de fichier.
//
// La partie pure (types, formats, noms, PDF, ZIP) est dans convert_logic.rs.

use crate::sync::LockExt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use image::codecs::ico::IcoEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, ImageReader};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::convert_logic::{self as logic, Dest, Format, Kind, Quality, CANCELLED};
use super::{ModuleContext, RustModule};
use crate::platform;
use crate::platform::convert::{MediaQuality, MediaTarget};
use crate::services::settings::Settings;
use crate::services::{bus, files, log, privacy};

const ID: &str = "convert";
/// « Annuler » reste proposé pendant…
const UNDO_WINDOW: Duration = Duration::from_secs(10);
/// La progression part au plus toutes les…
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// Une conversion à la fois.
static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static JOB: AtomicU64 = AtomicU64::new(0);
/// Les fichiers produits par la dernière conversion : « Ouvrir » n'ouvre qu'eux.
static LAST_OUTPUTS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

pub struct Convert;

impl RustModule for Convert {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/convert/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // { paths, format, dest } → { job, count } ; le reste arrive par le bus.
            "start" => start(ctx, &args),
            "cancel" => {
                CANCEL.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            // { path } : ouvre un fichier produit par la dernière conversion
            // (un dossier s'ouvre dans l'Explorateur).
            "open" => {
                let path = ctx.check_path(args.get("path").and_then(Value::as_str).ok_or("paramètre « path » manquant")?)?;
                if !LAST_OUTPUTS.locked().iter().any(|p| logic::same_file_name(p, &path)) {
                    return Err("ce fichier ne vient pas de la dernière conversion".into());
                }
                let revealed = super::launcher::open_checked(&path)?;
                Ok(json!({ "revealed": revealed }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// Ce qu'il faut pour faire le travail, lu une fois au départ.
struct Job {
    id: u64,
    paths: Vec<PathBuf>,
    kinds: Vec<Kind>,
    format: Format,
    dest: Dest,
    quality: Quality,
    keep_date: bool,
    strip: bool,
    /// Le dossier du Bureau (« Sur le bureau »), déjà validé.
    desk: Option<PathBuf>,
    /// Une copie des réglages, pour valider chaque chemin lu (dossiers exclus).
    settings: Settings,
}

/// Le résultat d'un fichier (ou du fichier qui réunit tout le lot).
struct Item {
    name: String,
    out: Option<PathBuf>,
    before: u64,
    after: u64,
    error: Option<String>,
}

fn start(ctx: &ModuleContext, args: &Value) -> Result<Value, String> {
    let format = Format::parse(args.get("format").and_then(Value::as_str).unwrap_or("")).ok_or("format inconnu")?;
    let list = args.get("paths").and_then(Value::as_array).ok_or("paramètre « paths » manquant")?;
    let mut paths: Vec<PathBuf> = Vec::new();
    for raw in list.iter().filter_map(Value::as_str) {
        let p = ctx.check_path(raw)?;
        if !paths.contains(&p) {
            paths.push(p);
        }
    }
    if paths.is_empty() {
        return Err("aucun fichier".into());
    }
    if paths.len() > logic::MAX_FILES {
        return Err(format!("au plus {} fichiers à la fois", logic::MAX_FILES));
    }
    let kinds: Vec<Kind> = paths.iter().map(|p| logic::kind_of(p, p.is_dir())).collect();
    // Un dossier se met dans un ZIP : tout son contenu est validé d'avance.
    for (p, k) in paths.iter().zip(&kinds) {
        if *k == Kind::Folder {
            ctx.check_tree(&p.to_string_lossy())?;
        }
    }
    let common = logic::common_kind(&kinds);
    let ok = if format.combines() { logic::allowed(common, format) || format == Format::Zip } else { kinds.iter().all(|&k| logic::allowed(k, format)) };
    if !ok {
        return Err("ce format n'est pas proposé pour ces fichiers".into());
    }
    let values = ctx.settings();
    let dest = Dest::parse(args.get("dest").and_then(Value::as_str).unwrap_or("keep"));
    let desk = if dest == Dest::Desk {
        let d = platform::desktop_dir().ok_or("Bureau introuvable")?;
        Some(ctx.check_path(&d.to_string_lossy())?)
    } else {
        None
    };
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("j'ai déjà la bouche pleine : une conversion est en cours".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let job = Job {
        id: JOB.fetch_add(1, Ordering::SeqCst) + 1,
        paths,
        kinds,
        format,
        dest,
        quality: Quality::parse(values.get("quality").and_then(Value::as_str).unwrap_or("normal")),
        keep_date: values.get("keepDate").and_then(Value::as_bool).unwrap_or(true),
        strip: values.get("stripMetadata").and_then(Value::as_bool).unwrap_or(true),
        desk,
        settings: ctx.app.state::<crate::Shared>().settings.locked().clone(),
    };
    let (id, count) = (job.id, job.paths.len());
    // Le journal : le format et le nombre, jamais les noms.
    ctx.log_info(format!("conversion {:?} de {count} élément(s)", job.format));
    let app = ctx.app.clone();
    let spawned = std::thread::Builder::new().name("ondine-conversion".into()).spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&app, &job)));
        RUNNING.store(false, Ordering::SeqCst);
        let payload = outcome.unwrap_or_else(|_| {
            log::warn("conversion : panique pendant le travail");
            json!({ "job": job.id, "ok": false, "total": job.paths.len(), "failed": job.paths.len(), "error": "erreur interne", "results": [] })
        });
        bus::emit(&app, ID, "convert.done", payload);
    });
    if let Err(e) = spawned {
        RUNNING.store(false, Ordering::SeqCst);
        return Err(format!("conversion impossible : {e}"));
    }
    Ok(json!({ "job": id, "count": count }))
}

// ── Le travail ───────────────────────────────────────────────────────────────

/// Donne la progression au front, sans le noyer (au plus 10 fois par seconde).
struct Progress<'a> {
    app: &'a AppHandle,
    job: u64,
    total: usize,
    last: Instant,
}

impl Progress<'_> {
    fn send(&mut self, index: usize, part: f64, name: &str, force: bool) {
        if !force && self.last.elapsed() < PROGRESS_EVERY {
            return;
        }
        self.last = Instant::now();
        let fraction = ((index as f64 + part.clamp(0.0, 1.0)) / self.total.max(1) as f64).clamp(0.0, 1.0);
        bus::emit(self.app, ID, "convert.progress", json!({ "job": self.job, "index": index, "total": self.total, "fraction": fraction, "name": name }));
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// La taille d'un fichier, ou de tout un dossier (ses fichiers).
fn size_of(p: &Path) -> u64 {
    match fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => fs::read_dir(p).map(|r| r.flatten().map(|e| size_of(&e.path())).sum()).unwrap_or(0),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

fn run(app: &AppHandle, job: &Job) -> Value {
    let mut progress = Progress { app, job: job.id, total: job.paths.len(), last: Instant::now() - PROGRESS_EVERY };
    let validate = |p: &Path| privacy::check_path(&job.settings, &p.to_string_lossy()).map(|_| ());
    let mut items: Vec<Item> = Vec::new();
    // (original, nouveau fichier) : ce qui a vraiment été produit.
    let mut made: Vec<(PathBuf, PathBuf)> = Vec::new();

    if job.format.combines() {
        // Un seul fichier pour tout le lot : un PDF ou un ZIP.
        let first = &job.paths[0];
        let name = logic::combined_name(&job.paths, job.format);
        let before: u64 = job.paths.iter().map(|p| size_of(p)).sum();
        let result = out_dir(job, first).and_then(|dir| {
            if job.format == Format::Pdf {
                images_to_pdf(job, &dir, &name, &mut progress)
            } else {
                let base = name.trim_end_matches(".zip").to_string();
                progress.send(0, 0.0, &file_name(first), true);
                files::zip_into(&job.paths, &dir, &base, &validate)
            }
        });
        match result {
            Ok(out) => {
                for p in &job.paths {
                    made.push((p.clone(), out.clone()));
                }
                items.push(Item { name: file_name(&out), after: size_of(&out), out: Some(out), before, error: None });
            }
            Err(e) => items.push(Item { name, out: None, before, after: 0, error: Some(e) }),
        }
    } else {
        for (i, (src, kind)) in job.paths.iter().zip(&job.kinds).enumerate() {
            if CANCEL.load(Ordering::SeqCst) {
                items.push(Item { name: file_name(src), out: None, before: size_of(src), after: 0, error: Some(CANCELLED.into()) });
                continue;
            }
            let name = file_name(src);
            progress.send(i, 0.0, &name, true);
            let before = size_of(src);
            let result = out_dir(job, src).and_then(|dir| {
                let mut part = |f: f64| progress.send(i, f, &name, false);
                convert_one(job, src, *kind, &dir, &mut part)
            });
            match result {
                Ok(out) => {
                    made.push((src.clone(), out.clone()));
                    items.push(Item { name, after: size_of(&out), out: Some(out), before, error: None });
                }
                Err(e) => items.push(Item { name, out: None, before, after: 0, error: Some(e) }),
            }
        }
    }

    // Les dates d'origine (fichiers seulement : un dossier prend la date du jour).
    if job.keep_date {
        for (src, out) in &made {
            if out.is_file() {
                copy_dates(src, out);
            }
        }
    }

    // « Remplacer » : les originaux convertis partent à la Corbeille, maintenant
    // que le nouveau fichier existe. Même nom qu'avant (« Réduire » une photo) :
    // le nouveau fichier prend la place libérée.
    let mut replaced: Vec<PathBuf> = Vec::new();
    let mut renamed: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut kept_note: Option<String> = None;
    if job.dest == Dest::Replace && !made.is_empty() {
        let originals: Vec<PathBuf> = made.iter().map(|(s, _)| s.clone()).fold(Vec::new(), |mut v, p| {
            if !v.contains(&p) {
                v.push(p);
            }
            v
        });
        match files::to_trash(&originals) {
            Ok(()) => {
                replaced = originals;
                for (src, out) in made.iter_mut() {
                    let wanted = src.with_file_name(logic::out_name(src, logic::kind_of(src, false), job.format));
                    if out.is_file() && logic::same_file_name(&wanted, src) && !src.exists() && fs::rename(&*out, &*src).is_ok() {
                        renamed.push((out.clone(), src.clone()));
                        *out = src.clone();
                    }
                }
                for it in items.iter_mut() {
                    if let Some(out) = it.out.as_mut() {
                        if let Some((_, to)) = renamed.iter().find(|(from, _)| from == out) {
                            *out = to.clone();
                            it.name = file_name(to);
                        }
                    }
                }
            }
            // Un lecteur sans Corbeille (clé USB, réseau) : l'original reste.
            Err(_) => kept_note = Some("l'original est resté à sa place (ce lecteur n'a pas de Corbeille)".into()),
        }
    }

    let outputs: Vec<PathBuf> = items.iter().filter_map(|it| it.out.clone()).collect();
    *LAST_OUTPUTS.locked() = outputs.clone();
    let failed = items.iter().filter(|it| it.error.is_some()).count();
    let undo_id = if outputs.is_empty() { None } else { offer_undo(app, job, outputs.clone(), replaced.clone()) };
    if let Some(first) = outputs.first() {
        platform::convert::select_if_open(first);
    }
    log::write(log::Level::Info, ID, &format!("conversion {:?} finie : {}/{} réussie(s)", job.format, items.len() - failed, items.len()));

    let results: Vec<Value> = items
        .iter()
        .map(|it| {
            json!({
                "name": it.name,
                "out": it.out.as_ref().map(|p| p.to_string_lossy().to_string()),
                "outName": it.out.as_ref().map(|p| file_name(p)),
                "before": it.before,
                "after": it.after,
                "error": it.error,
            })
        })
        .collect();
    json!({
        "job": job.id,
        "ok": failed == 0,
        "format": format!("{:?}", job.format).to_lowercase(),
        "dest": match job.dest { Dest::Keep => "keep", Dest::Replace => "replace", Dest::Desk => "desk" },
        "total": items.len(),
        "failed": failed,
        "cancelled": CANCEL.load(Ordering::SeqCst),
        "replaced": replaced.len(),
        "note": kept_note,
        "undoId": undo_id,
        "results": results,
    })
}

/// Où écrire le résultat de `src` : à côté, ou sur le Bureau.
fn out_dir(job: &Job, src: &Path) -> Result<PathBuf, String> {
    match (&job.desk, job.dest) {
        (Some(desk), Dest::Desk) => Ok(desk.clone()),
        _ => src.parent().map(Path::to_path_buf).ok_or_else(|| "dossier introuvable".to_string()),
    }
}

/// « Annuler » : les nouveaux fichiers à la Corbeille, les originaux remplacés reviennent.
fn offer_undo(app: &AppHandle, job: &Job, outputs: Vec<PathBuf>, replaced: Vec<PathBuf>) -> Option<u64> {
    let label = match job.dest {
        Dest::Replace if !replaced.is_empty() => "Conversion faite, l'original est dans la Corbeille",
        Dest::Desk => "Conversion posée sur le Bureau",
        _ => "Conversion faite à côté de l'original",
    };
    super::with_context(app, ID, |ctx| {
        ctx.offer_undo(
            label,
            UNDO_WINDOW,
            Box::new(move || {
                let mut trash = Vec::new();
                for out in &outputs {
                    // Le nouveau fichier a pris le nom de l'original (« Réduire »
                    // avec « Remplacer ») : il libère ce nom d'abord, sinon la
                    // Corbeille rendrait le nouveau fichier au lieu de l'original.
                    if replaced.iter().any(|r| logic::same_file_name(r, out)) {
                        let dir = out.parent().ok_or("dossier introuvable")?;
                        let free = logic::free_path(dir, &file_name(out));
                        fs::rename(out, &free).map_err(|e| logic::io_reason(&e))?;
                        trash.push(free);
                    } else {
                        trash.push(out.clone());
                    }
                }
                files::to_trash(&trash)?;
                for p in &replaced {
                    files::restore_from_trash(p)?;
                }
                Ok(())
            }),
        )
    })
}

/// Recopie les dates de l'original (modification, et création sous Windows).
fn copy_dates(src: &Path, out: &Path) {
    let Ok(meta) = fs::metadata(src) else { return };
    let mut times = fs::FileTimes::new();
    if let Ok(m) = meta.modified() {
        times = times.set_modified(m);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTimesExt;
        if let Ok(c) = meta.created() {
            times = times.set_created(c);
        }
    }
    if let Ok(f) = fs::OpenOptions::new().write(true).open(out) {
        let _ = f.set_times(times);
    }
}

/// Convertit un fichier. Renvoie le chemin produit (un fichier, ou un dossier).
fn convert_one(job: &Job, src: &Path, kind: Kind, dir: &Path, part: &mut dyn FnMut(f64)) -> Result<PathBuf, String> {
    if !src.exists() {
        return Err("le fichier a disparu".into());
    }
    let name = logic::out_name(src, kind, job.format);
    match (kind, job.format) {
        (Kind::Image, _) => {
            let out = logic::free_path(dir, &name);
            convert_image(src, &out, job.format, job.quality, job.strip)?;
            Ok(out)
        }
        (Kind::Pdf, Format::Png | Format::Jpg) => pdf_to_images(job, src, dir, part),
        (Kind::Video | Kind::Audio, _) => {
            let target = match job.format {
                Format::Mp4 => MediaTarget::Mp4 { smaller: false },
                Format::Shrink => MediaTarget::Mp4 { smaller: true },
                Format::M4a => MediaTarget::M4a,
                Format::Mp3 => MediaTarget::Mp3,
                Format::Wav => MediaTarget::Wav,
                _ => return Err("format non pris en charge".into()),
            };
            let quality = match job.quality {
                Quality::Small => MediaQuality::Small,
                Quality::Normal => MediaQuality::Normal,
                Quality::High => MediaQuality::High,
            };
            let out = logic::free_path(dir, &name);
            let free = file_name(&out);
            platform::convert::transcode(src, dir, &free, target, quality, &CANCEL, part)
        }
        (Kind::Zip, Format::Unzip) => {
            let out = logic::free_path(dir, &name);
            match logic::extract_zip(src, &out, &CANCEL, part) {
                Ok(_) => Ok(out),
                Err(e) => {
                    // Un dossier à moitié extrait : à la Corbeille.
                    if out.exists() {
                        let _ = files::to_trash(std::slice::from_ref(&out));
                    }
                    Err(e)
                }
            }
        }
        _ => Err("format non pris en charge".into()),
    }
}

// ── Images ───────────────────────────────────────────────────────────────────

/// Ouvre une image : la crate `image` pour les formats courants (orientation
/// de l'appareil photo appliquée, métadonnées gardées si demandé), sinon le
/// décodeur de Windows (HEIC, AVIF, TIFF…, sans métadonnées).
fn load_image(src: &Path, keep_meta: bool) -> Result<(DynamicImage, Option<Vec<u8>>), String> {
    let size = fs::metadata(src).map_err(|e| logic::io_reason(&e))?.len();
    if size > logic::MAX_IMAGE_BYTES {
        return Err("image trop lourde".into());
    }
    if !logic::readable_by_image_crate(src) {
        return platform::convert::decode_image(src).map(|rgba| (DynamicImage::ImageRgba8(rgba), None));
    }
    let broken = |_| "cette image semble abîmée".to_string();
    let reader = ImageReader::open(src).map_err(|e| logic::io_reason(&e))?.with_guessed_format().map_err(|e| logic::io_reason(&e))?;
    let mut decoder = reader.into_decoder().map_err(broken)?;
    let (w, h) = decoder.dimensions();
    if (w as u64) * (h as u64) > logic::MAX_IMAGE_PIXELS {
        return Err("image trop grande".into());
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut exif = if keep_meta { decoder.exif_metadata().ok().flatten() } else { None };
    let mut img = DynamicImage::from_decoder(decoder).map_err(broken)?;
    img.apply_orientation(orientation);
    // L'image est déjà tournée : l'orientation notée dans les métadonnées
    // repasse à « normale », sinon les visionneuses la tourneraient deux fois.
    if let Some(e) = exif.as_mut() {
        let _ = Orientation::remove_from_exif_chunk(e);
    }
    Ok((img, exif))
}

/// Réduit pour que le plus grand côté fasse au plus `max` pixels (jamais agrandie).
fn fit(img: DynamicImage, max: u32) -> DynamicImage {
    if img.width().max(img.height()) <= max {
        return img;
    }
    img.resize(max, max, FilterType::Lanczos3)
}

/// Le JPEG n'a pas de transparence : on la pose sur du blanc.
fn flatten_on_white(img: &DynamicImage) -> image::RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    let rgba = img.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        rgb.put_pixel(x, y, image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])]));
    }
    rgb
}

fn convert_image(src: &Path, out: &Path, format: Format, quality: Quality, strip: bool) -> Result<(), String> {
    let (img, exif) = load_image(src, !strip)?;
    let (img, ext) = match format {
        Format::Shrink => (fit(img, quality.shrink_side()), logic::shrink_ext(src)),
        f => (img, f.ext().unwrap_or("png").to_string()),
    };
    let written = write_image(&img, &ext, out, quality, exif);
    if written.is_err() && out.exists() {
        // Le fichier à moitié écrit part à la Corbeille (jamais de suppression définitive).
        let _ = files::to_trash(&[out.to_path_buf()]);
    }
    written
}

fn write_image(img: &DynamicImage, ext: &str, out: &Path, quality: Quality, exif: Option<Vec<u8>>) -> Result<(), String> {
    if ext == "tiff" {
        return platform::convert::encode_tiff(&img.to_rgba8(), out);
    }
    let file = fs::File::create(out).map_err(|e| logic::io_reason(&e))?;
    let mut w = std::io::BufWriter::new(file);
    let failed = |e: image::ImageError| format!("écriture impossible ({e})");
    match ext {
        "jpg" | "jpeg" | "jfif" => {
            let rgb = flatten_on_white(img);
            let mut enc = JpegEncoder::new_with_quality(&mut w, quality.jpeg());
            if let Some(e) = exif {
                let _ = enc.set_exif_metadata(e);
            }
            enc.write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).map_err(failed)?;
        }
        "png" => {
            let rgba = img.to_rgba8();
            let mut enc = PngEncoder::new(&mut w);
            if let Some(e) = exif {
                let _ = enc.set_exif_metadata(e);
            }
            enc.write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8).map_err(failed)?;
        }
        "webp" => {
            // L'encodeur WebP de `image` est sans perte : fidèle, mais pas toujours plus léger.
            let rgba = img.to_rgba8();
            let mut enc = WebPEncoder::new_lossless(&mut w);
            if let Some(e) = exif {
                let _ = enc.set_exif_metadata(e);
            }
            enc.write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8).map_err(failed)?;
        }
        "ico" => {
            // Une icône fait au plus 256 × 256.
            let small = fit(img.clone(), 256).to_rgba8();
            IcoEncoder::new(&mut w).write_image(small.as_raw(), small.width(), small.height(), image::ExtendedColorType::Rgba8).map_err(failed)?;
        }
        "gif" => img.to_rgba8().write_to(&mut w, ImageFormat::Gif).map_err(failed)?,
        "bmp" => {
            if img.color().has_alpha() {
                img.to_rgba8().write_to(&mut w, ImageFormat::Bmp).map_err(failed)?
            } else {
                img.to_rgb8().write_to(&mut w, ImageFormat::Bmp).map_err(failed)?
            }
        }
        _ => return Err("format non pris en charge".into()),
    }
    use std::io::Write;
    w.flush().map_err(|e| logic::io_reason(&e))
}

/// Images → un seul PDF : chaque image (réduite selon la qualité) devient une
/// page JPEG. Une image illisible fait échouer le PDF entier (sinon il
/// manquerait une page sans qu'on le voie).
fn images_to_pdf(job: &Job, dir: &Path, name: &str, progress: &mut Progress) -> Result<PathBuf, String> {
    let out = logic::free_path(dir, name);
    let result = (|| -> Result<(), String> {
        let file = fs::File::create(&out).map_err(|e| logic::io_reason(&e))?;
        let mut pdf = logic::PdfWriter::new(std::io::BufWriter::new(file)).map_err(|e| logic::io_reason(&e))?;
        for (i, src) in job.paths.iter().enumerate() {
            if CANCEL.load(Ordering::SeqCst) {
                return Err(CANCELLED.into());
            }
            progress.send(i, 0.0, &file_name(src), true);
            let (img, _) = load_image(src, false).map_err(|e| format!("{} : {e}", file_name(src)))?;
            let rgb = flatten_on_white(&fit(img, job.quality.pdf_side()));
            let mut jpeg = Vec::new();
            JpegEncoder::new_with_quality(&mut jpeg, job.quality.jpeg())
                .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("écriture impossible ({e})"))?;
            pdf.add_jpeg(rgb.width(), rgb.height(), &jpeg).map_err(|e| logic::io_reason(&e))?;
        }
        pdf.finish().map_err(|e| logic::io_reason(&e))?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(out),
        Err(e) => {
            if out.exists() {
                let _ = files::to_trash(std::slice::from_ref(&out));
            }
            Err(e)
        }
    }
}

/// PDF → images : une page = « doc.png » ; plusieurs = un dossier « doc »
/// avec « page 01.png », « page 02.png »…
fn pdf_to_images(job: &Job, src: &Path, dir: &Path, part: &mut dyn FnMut(f64)) -> Result<PathBuf, String> {
    let ext = if job.format == Format::Jpg { "jpg" } else { "png" };
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "pages".into());
    // Le dossier n'est créé qu'à la deuxième page.
    let mut folder: Option<PathBuf> = None;
    let mut first: Option<PathBuf> = None;
    let quality = job.quality;
    let result = platform::convert::pdf_pages(src, quality.pdf_dpi(), logic::MAX_PDF_PAGES, &CANCEL, &mut |i, count, png| {
        let img = image::load_from_memory_with_format(&png, ImageFormat::Png).map_err(|_| "page illisible".to_string())?;
        let out = if count == 1 {
            logic::free_path(dir, &format!("{stem}.{ext}"))
        } else {
            let f = match &folder {
                Some(f) => f.clone(),
                None => {
                    let f = logic::free_path(dir, &stem);
                    fs::create_dir(&f).map_err(|e| logic::io_reason(&e))?;
                    folder = Some(f.clone());
                    f
                }
            };
            f.join(logic::page_name(i, count, ext))
        };
        write_image(&img, ext, &out, quality, None)?;
        first.get_or_insert(out);
        part((i + 1) as f64 / count.max(1) as f64);
        Ok(())
    });
    match result {
        Ok(_) => folder.or(first).ok_or_else(|| "ce PDF n'a aucune page".to_string()),
        Err(e) => {
            // Ce qui a été écrit avant l'erreur part à la Corbeille.
            if let Some(partial) = folder.or(first) {
                let _ = files::to_trash(&[partial]);
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ondine-convert-mod-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn photo(path: &Path, w: u32, h: u32) {
        let img = image::RgbaImage::from_fn(w, h, |x, y| image::Rgba([(x * 7) as u8, (y * 5) as u8, 90, if x < 2 { 0 } else { 255 }]));
        DynamicImage::ImageRgba8(img).to_rgb8().save(path).unwrap();
    }

    #[test]
    fn images_convert_and_shrink() {
        let dir = temp("images");
        let src = dir.join("photo.jpg");
        photo(&src, 64, 48);
        for (format, name) in [(Format::Png, "photo.png"), (Format::Webp, "photo.webp"), (Format::Gif, "photo.gif"), (Format::Bmp, "photo.bmp"), (Format::Ico, "photo.ico")] {
            let out = logic::free_path(&dir, name);
            convert_image(&src, &out, format, Quality::Normal, true).unwrap();
            let back = image::open(&out).unwrap();
            assert_eq!((back.width(), back.height()), (64, 48), "{name}");
        }
        // Réduire : même format, nom libre (« photo (2).jpg »), plus petit côté.
        let big = dir.join("grande.png");
        DynamicImage::ImageRgb8(image::RgbImage::new(3000, 1000)).save(&big).unwrap();
        let out = logic::free_path(&dir, &logic::out_name(&big, Kind::Image, Format::Shrink));
        assert_eq!(out, dir.join("grande (2).png"));
        convert_image(&big, &out, Format::Shrink, Quality::Small, true).unwrap();
        let back = image::open(&out).unwrap();
        assert_eq!((back.width(), back.height()), (1280, 427));
        // TIFF : seulement sous Windows (encodeur de Windows).
        #[cfg(not(windows))]
        assert!(convert_image(&src, &dir.join("photo.tiff"), Format::Tiff, Quality::Normal, true).is_err());
    }

    #[test]
    fn broken_image_says_why() {
        let dir = temp("broken");
        let src = dir.join("scan.jpg");
        fs::write(&src, b"pas une image").unwrap();
        let err = convert_image(&src, &dir.join("scan.png"), Format::Png, Quality::Normal, true).unwrap_err();
        assert_eq!(err, "cette image semble abîmée");
        // L'original n'a pas bougé.
        assert_eq!(fs::read(&src).unwrap(), b"pas une image");
    }

    #[test]
    fn exif_orientation_is_reset() {
        // Un morceau EXIF minimal (TIFF petit-boutiste) avec l'orientation 6 (tournée).
        let mut exif: Vec<u8> = vec![b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(Orientation::from_exif_chunk(&exif), Some(Orientation::Rotate90));
        let _ = Orientation::remove_from_exif_chunk(&mut exif);
        assert_eq!(Orientation::from_exif_chunk(&exif), Some(Orientation::NoTransforms));
    }

    #[test]
    fn dates_are_kept() {
        let dir = temp("dates");
        let (a, b) = (dir.join("a.txt"), dir.join("b.txt"));
        fs::write(&a, "1").unwrap();
        fs::write(&b, "2").unwrap();
        let old = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_600_000_000);
        fs::OpenOptions::new().write(true).open(&a).unwrap().set_modified(old).unwrap();
        copy_dates(&a, &b);
        assert_eq!(fs::metadata(&b).unwrap().modified().unwrap(), old);
    }
}
