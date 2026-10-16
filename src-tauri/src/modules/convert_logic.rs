// Ondine convertit (1.2.5) : la partie pure, testée sous Linux.
//
//   - le type d'un fichier d'après son extension (image, PDF, vidéo, son,
//     archive ZIP, dossier, autre) et les formats permis pour chaque type ;
//   - les noms de sortie (« photo.heic » → « photo.jpg » ; jamais d'écrasement :
//     le nom libre est choisi au dernier moment par files::unique_dest) ;
//   - la qualité Petite / Normale / Haute traduite en chiffres ;
//   - l'écriture d'un PDF à partir d'images JPEG (Ondine l'écrit elle-même :
//     quelques objets PDF autour des images, sans bibliothèque) ;
//   - l'extraction d'un ZIP, protégée contre les noms qui sortent du dossier
//     (« ../../Windows/… ») et contre les archives démesurées.
//
// La même liste de formats existe côté front (src/modules/convert/convert-logic.ts) :
// le front choisit les pilules à montrer, le Rust revérifie tout.

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::services::files;

/// Au plus tant de fichiers par conversion.
pub const MAX_FILES: usize = 100;
/// Un PDF : au plus tant de pages dessinées en images.
pub const MAX_PDF_PAGES: u32 = 300;
/// Un ZIP : au plus tant d'éléments, et tant d'octets une fois extrait.
pub const MAX_ZIP_ENTRIES: usize = 20_000;
pub const MAX_ZIP_BYTES: u64 = 16 * 1024 * 1024 * 1024;
/// Une image plus grosse (octets) n'est pas ouverte, ni plus grande (pixels).
pub const MAX_IMAGE_BYTES: u64 = 300 * 1024 * 1024;
pub const MAX_IMAGE_PIXELS: u64 = 120_000_000;

/// L'erreur d'une conversion arrêtée en route.
pub const CANCELLED: &str = "arrêté";

// ── Types de fichiers ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Image,
    Pdf,
    Video,
    Audio,
    Zip,
    Folder,
    Other,
}

/// Les extensions reconnues, par type. HEIC, HEIF, AVIF et TIFF ne se lisent
/// que par Windows (WIC, avec l'extension du Microsoft Store pour HEIC / AVIF).
const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "jfif", "png", "webp", "bmp", "gif", "tif", "tiff", "ico", "heic", "heif", "avif"];
const VIDEO_EXT: &[&str] = &["mp4", "m4v", "mov", "wmv", "avi", "mkv", "3gp"];
const AUDIO_EXT: &[&str] = &["mp3", "m4a", "wav", "wma", "aac", "flac"];

/// L'extension en minuscules (« » s'il n'y en a pas).
pub fn ext_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

pub fn kind_of(path: &Path, is_dir: bool) -> Kind {
    if is_dir {
        return Kind::Folder;
    }
    let ext = ext_of(path);
    let e = ext.as_str();
    if IMAGE_EXT.contains(&e) {
        Kind::Image
    } else if e == "pdf" {
        Kind::Pdf
    } else if VIDEO_EXT.contains(&e) {
        Kind::Video
    } else if AUDIO_EXT.contains(&e) {
        Kind::Audio
    } else if e == "zip" {
        Kind::Zip
    } else {
        Kind::Other
    }
}

/// Une image que la crate `image` sait lire (les autres passent par Windows).
pub fn readable_by_image_crate(path: &Path) -> bool {
    matches!(ext_of(path).as_str(), "jpg" | "jpeg" | "jfif" | "png" | "webp" | "bmp" | "gif" | "ico")
}

// ── Formats ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpg,
    Png,
    Webp,
    Gif,
    Bmp,
    Tiff,
    Ico,
    /// Réduire : même format (JPEG pour ce que la crate `image` ne sait pas
    /// écrire), plus petit. Pour une vidéo : MP4 en définition plus basse.
    Shrink,
    /// Images → un seul PDF.
    Pdf,
    Mp4,
    Mp3,
    M4a,
    Wav,
    /// Tout dans un seul ZIP.
    Zip,
    /// Extraire un ZIP.
    Unzip,
}

impl Format {
    pub fn parse(s: &str) -> Option<Format> {
        Some(match s {
            "jpg" => Format::Jpg,
            "png" => Format::Png,
            "webp" => Format::Webp,
            "gif" => Format::Gif,
            "bmp" => Format::Bmp,
            "tiff" => Format::Tiff,
            "ico" => Format::Ico,
            "shrink" => Format::Shrink,
            "pdf" => Format::Pdf,
            "mp4" => Format::Mp4,
            "mp3" => Format::Mp3,
            "m4a" => Format::M4a,
            "wav" => Format::Wav,
            "zip" => Format::Zip,
            "unzip" => Format::Unzip,
            _ => return None,
        })
    }

    /// Un seul fichier produit pour tout le lot (PDF, ZIP).
    pub fn combines(self) -> bool {
        matches!(self, Format::Pdf | Format::Zip)
    }

    /// L'extension du fichier produit (None : elle dépend de l'original, ou c'est un dossier).
    pub fn ext(self) -> Option<&'static str> {
        Some(match self {
            Format::Jpg => "jpg",
            Format::Png => "png",
            Format::Webp => "webp",
            Format::Gif => "gif",
            Format::Bmp => "bmp",
            Format::Tiff => "tiff",
            Format::Ico => "ico",
            Format::Pdf => "pdf",
            Format::Mp4 => "mp4",
            Format::Mp3 => "mp3",
            Format::M4a => "m4a",
            Format::Wav => "wav",
            Format::Zip => "zip",
            Format::Shrink | Format::Unzip => return None,
        })
    }
}

/// Ce format est-il proposé pour ce type ? (Le front montre les mêmes pilules.)
pub fn allowed(kind: Kind, format: Format) -> bool {
    use Format::*;
    match kind {
        Kind::Image => matches!(format, Jpg | Png | Webp | Gif | Bmp | Tiff | Ico | Shrink | Pdf | Zip),
        Kind::Pdf => matches!(format, Png | Jpg | Zip),
        Kind::Video => matches!(format, Mp4 | Shrink | Mp3 | M4a | Wav | Zip),
        Kind::Audio => matches!(format, Mp3 | M4a | Wav | Zip),
        Kind::Zip => matches!(format, Unzip),
        Kind::Folder | Kind::Other => matches!(format, Zip),
    }
}

/// Le type commun d'un lot : un seul type, sinon Other (seul « Un seul ZIP » reste).
pub fn common_kind(kinds: &[Kind]) -> Kind {
    match kinds.first() {
        Some(&k) if kinds.iter().all(|&x| x == k) => k,
        _ => Kind::Other,
    }
}

// ── Qualité ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Small,
    Normal,
    High,
}

impl Quality {
    pub fn parse(s: &str) -> Quality {
        match s {
            "small" => Quality::Small,
            "high" => Quality::High,
            _ => Quality::Normal,
        }
    }

    /// Qualité JPEG (0-100).
    pub fn jpeg(self) -> u8 {
        match self {
            Quality::Small => 70,
            Quality::Normal => 85,
            Quality::High => 94,
        }
    }

    /// « Réduire » une image : son plus grand côté, au plus (pixels).
    pub fn shrink_side(self) -> u32 {
        match self {
            Quality::Small => 1280,
            Quality::Normal => 1920,
            Quality::High => 2560,
        }
    }

    /// Une image mise dans un PDF : son plus grand côté, au plus (pixels).
    pub fn pdf_side(self) -> u32 {
        match self {
            Quality::Small => 1600,
            Quality::Normal => 2400,
            Quality::High => 4000,
        }
    }

    /// Les pages d'un PDF dessinées en images : points par pouce.
    pub fn pdf_dpi(self) -> f64 {
        match self {
            Quality::Small => 96.0,
            Quality::Normal => 150.0,
            Quality::High => 220.0,
        }
    }
}

// ── Où va le résultat ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dest {
    /// À côté de l'original (jamais d'écrasement : « photo (2).jpg »).
    Keep,
    /// À côté, puis l'original part à la Corbeille (« Annuler » le remet).
    Replace,
    /// Sur le Bureau.
    Desk,
}

impl Dest {
    pub fn parse(s: &str) -> Dest {
        match s {
            "replace" => Dest::Replace,
            "desk" => Dest::Desk,
            _ => Dest::Keep,
        }
    }
}

// ── Noms ─────────────────────────────────────────────────────────────────────

fn stem_of(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "fichier".into())
}

/// L'extension écrite par « Réduire » une image : la même, sauf pour ce que
/// la crate `image` ne sait pas écrire (HEIC, AVIF, TIFF passent en JPEG ;
/// « .jpeg » et « .jfif » gardent leur nom).
pub fn shrink_ext(src: &Path) -> String {
    let ext = ext_of(src);
    match ext.as_str() {
        "jpg" | "jpeg" | "jfif" | "png" | "webp" | "bmp" | "gif" => ext,
        _ => "jpg".into(),
    }
}

/// Le nom voulu pour la conversion d'un fichier (avant le choix d'un nom
/// libre) : « vacances.heic » + JPG → « vacances.jpg ». Pour une vidéo
/// réduite : « réunion.mp4 ». Extraire un ZIP : le nom du dossier.
pub fn out_name(src: &Path, kind: Kind, format: Format) -> String {
    let stem = stem_of(src);
    match format {
        Format::Unzip => stem,
        Format::Shrink if kind == Kind::Video => format!("{stem}.mp4"),
        Format::Shrink => format!("{stem}.{}", shrink_ext(src)),
        f => format!("{stem}.{}", f.ext().unwrap_or("bin")),
    }
}

/// Le nom d'un fichier qui réunit tout le lot (un PDF, un ZIP) : le nom du
/// fichier s'il est seul, sinon celui de son dossier (« Vacances.pdf »).
pub fn combined_name(paths: &[PathBuf], format: Format) -> String {
    let ext = format.ext().unwrap_or("bin");
    let base = match paths {
        [one] => stem_of(one),
        many => many
            .first()
            .and_then(|p| p.parent())
            .and_then(|d| d.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty() && !n.ends_with(':'))
            .unwrap_or_else(|| if ext == "pdf" { "Images".into() } else { "Archive".into() }),
    };
    format!("{base}.{ext}")
}

/// Les pages d'un PDF : « page 01.png » (assez de zéros pour que l'ordre
/// alphabétique soit le bon).
pub fn page_name(index: u32, count: u32, ext: &str) -> String {
    let width = count.max(1).to_string().len().max(2);
    format!("page {:0width$}.{ext}", index + 1)
}

/// Deux chemins pour le même fichier ? (Windows ne distingue pas les majuscules.)
pub fn same_file_name(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Un nom libre dans `dir` pour `name` (« photo (2).jpg »).
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    files::unique_dest(dir, std::ffi::OsStr::new(name))
}

// ── Les erreurs, en une ligne ────────────────────────────────────────────────

/// Une erreur d'entrée-sortie dite simplement (jamais de chemin complet).
pub fn io_reason(e: &io::Error) -> String {
    match e.kind() {
        io::ErrorKind::NotFound => "le fichier a disparu".into(),
        io::ErrorKind::PermissionDenied => "Windows refuse l'accès à ce fichier".into(),
        io::ErrorKind::StorageFull => "le disque est plein".into(),
        _ => format!("erreur de lecture ou d'écriture ({e})"),
    }
}

// ── Un PDF à partir d'images JPEG ────────────────────────────────────────────

/// Écrit un PDF page par page : chaque page est une image JPEG, posée telle
/// quelle (filtre DCTDecode : le lecteur PDF décode le JPEG lui-même). La page
/// a les proportions de l'image, son grand côté mesure celui d'une page A4
/// (842 points). Objets : 1 catalogue, 2 liste des pages, puis 3 par page
/// (page, contenu, image). La table « xref » donne la position de chacun.
pub struct PdfWriter<W: Write> {
    out: W,
    pos: u64,
    offsets: Vec<u64>,
    pages: u32,
}

/// Le grand côté d'une page (points, 1/72 de pouce) : celui d'une page A4.
const PAGE_LONG_SIDE: f64 = 842.0;

impl<W: Write> PdfWriter<W> {
    pub fn new(out: W) -> io::Result<Self> {
        let mut w = PdfWriter { out, pos: 0, offsets: Vec::new(), pages: 0 };
        // L'en-tête, puis une ligne d'octets > 127 : les outils savent que le fichier est binaire.
        w.raw(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")?;
        Ok(w)
    }

    fn raw(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.out.write_all(bytes)?;
        self.pos += bytes.len() as u64;
        Ok(())
    }

    /// Commence l'objet numéro `n` (les numéros sont donnés dans l'ordre).
    fn begin(&mut self, n: usize) -> io::Result<()> {
        // Les objets 1 et 2 (catalogue, pages) sont écrits à la fin : on garde leur place.
        while self.offsets.len() < n {
            self.offsets.push(0);
        }
        self.offsets[n - 1] = self.pos;
        self.raw(format!("{n} 0 obj\n").as_bytes())
    }

    /// Ajoute une page : une image JPEG en couleurs (RVB) de `width` × `height` pixels.
    pub fn add_jpeg(&mut self, width: u32, height: u32, jpeg: &[u8]) -> io::Result<()> {
        let (w, h) = page_size(width, height);
        let first = 3 + 3 * self.pages as usize;
        let (page, content, image) = (first, first + 1, first + 2);
        self.begin(page)?;
        self.raw(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.2} {h:.2}] /Resources << /XObject << /Im0 {image} 0 R >> >> /Contents {content} 0 R >>\nendobj\n"
            )
            .as_bytes(),
        )?;
        let draw = format!("q {w:.2} 0 0 {h:.2} 0 0 cm /Im0 Do Q");
        self.begin(content)?;
        self.raw(format!("<< /Length {} >>\nstream\n{draw}\nendstream\nendobj\n", draw.len()).as_bytes())?;
        self.begin(image)?;
        self.raw(
            format!(
                "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
                jpeg.len()
            )
            .as_bytes(),
        )?;
        self.raw(jpeg)?;
        self.raw(b"\nendstream\nendobj\n")?;
        self.pages += 1;
        Ok(())
    }

    #[cfg(test)]
    pub fn pages(&self) -> u32 {
        self.pages
    }

    /// Écrit le catalogue, la liste des pages et la table des positions. Renvoie la sortie.
    pub fn finish(mut self) -> io::Result<W> {
        if self.pages == 0 {
            return Err(io::Error::other("aucune page"));
        }
        let kids: Vec<String> = (0..self.pages).map(|i| format!("{} 0 R", 3 + 3 * i)).collect();
        self.begin(1)?;
        self.raw(b"<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")?;
        self.begin(2)?;
        self.raw(format!("<< /Type /Pages /Kids [{}] /Count {} >>\nendobj\n", kids.join(" "), self.pages).as_bytes())?;
        let xref = self.pos;
        let count = self.offsets.len() + 1;
        let mut table = format!("xref\n0 {count}\n0000000000 65535 f \n");
        for off in &self.offsets {
            table.push_str(&format!("{off:010} 00000 n \n"));
        }
        table.push_str(&format!("trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"));
        self.raw(table.as_bytes())?;
        self.out.flush()?;
        Ok(self.out)
    }
}

/// La taille d'une page pour une image (points) : mêmes proportions, grand côté A4.
pub fn page_size(width: u32, height: u32) -> (f64, f64) {
    let (w, h) = (width.max(1) as f64, height.max(1) as f64);
    let k = PAGE_LONG_SIDE / w.max(h);
    (w * k, h * k)
}

// ── Extraire un ZIP ──────────────────────────────────────────────────────────

/// Extrait `zip` dans le dossier `dest` (créé ; il ne doit pas exister).
/// Les éléments dont le nom sortirait du dossier (« ../ », chemin absolu) sont
/// ignorés, comme les liens. Au-delà de MAX_ZIP_ENTRIES éléments ou de
/// MAX_ZIP_BYTES octets, rien n'est extrait. `progress` reçoit la part faite (0 à 1).
/// Renvoie le nombre de fichiers extraits.
pub fn extract_zip(zip: &Path, dest: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(f64)) -> Result<usize, String> {
    let file = std::fs::File::open(zip).map_err(|e| io_reason(&e))?;
    let mut archive = zip::ZipArchive::new(io::BufReader::new(file)).map_err(|_| "cette archive ZIP semble abîmée".to_string())?;
    let n = archive.len();
    if n > MAX_ZIP_ENTRIES {
        return Err(format!("trop d'éléments dans l'archive (plus de {MAX_ZIP_ENTRIES})"));
    }
    // La taille annoncée une fois extrait : vérifiée avant, puis pendant (un
    // en-tête peut mentir : on compte aussi ce qu'on écrit vraiment).
    let mut announced = 0u64;
    for i in 0..n {
        let entry = archive.by_index_raw(i).map_err(|_| "cette archive ZIP semble abîmée".to_string())?;
        announced = announced.saturating_add(entry.size());
    }
    if announced > MAX_ZIP_BYTES {
        return Err("cette archive est trop grosse une fois extraite".into());
    }
    std::fs::create_dir(dest).map_err(|e| io_reason(&e))?;
    let mut written = 0u64;
    let mut count = 0usize;
    for i in 0..n {
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        let mut entry = archive.by_index(i).map_err(|_| "cette archive ZIP semble abîmée".to_string())?;
        // Les noms qui sortent du dossier sont ignorés (protection « zip slip »).
        let Some(rel) = entry.enclosed_name() else { continue };
        if entry.is_symlink() {
            continue;
        }
        let target = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| io_reason(&e))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| io_reason(&e))?;
        }
        // Deux éléments au même nom : le second prend un nom libre.
        let target = match (target.parent(), target.file_name()) {
            (Some(dir), Some(name)) => files::unique_dest(dir, name),
            _ => continue,
        };
        let mut out = std::fs::File::create(&target).map_err(|e| io_reason(&e))?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buf).map_err(|_| "cette archive ZIP semble abîmée".to_string())?;
            if read == 0 {
                break;
            }
            written += read as u64;
            if written > MAX_ZIP_BYTES {
                return Err("cette archive est trop grosse une fois extraite".into());
            }
            out.write_all(&buf[..read]).map_err(|e| io_reason(&e))?;
        }
        count += 1;
        progress((i + 1) as f64 / n.max(1) as f64);
    }
    progress(1.0);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ondine-convert-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn kinds_and_formats() {
        assert_eq!(kind_of(Path::new("C:/a/Vacances.HEIC"), false), Kind::Image);
        assert_eq!(kind_of(Path::new("doc.pdf"), false), Kind::Pdf);
        assert_eq!(kind_of(Path::new("réunion.mov"), false), Kind::Video);
        assert_eq!(kind_of(Path::new("podcast.mp3"), false), Kind::Audio);
        assert_eq!(kind_of(Path::new("photos.zip"), false), Kind::Zip);
        assert_eq!(kind_of(Path::new("notes.txt"), false), Kind::Other);
        assert_eq!(kind_of(Path::new("Dossier"), true), Kind::Folder);
        assert!(allowed(Kind::Image, Format::Pdf));
        assert!(allowed(Kind::Video, Format::Mp3));
        assert!(!allowed(Kind::Audio, Format::Mp4));
        assert!(!allowed(Kind::Other, Format::Jpg));
        assert!(allowed(Kind::Folder, Format::Zip));
        assert!(allowed(Kind::Zip, Format::Unzip));
        assert!(!allowed(Kind::Zip, Format::Zip));
        assert_eq!(common_kind(&[Kind::Image, Kind::Image]), Kind::Image);
        assert_eq!(common_kind(&[Kind::Image, Kind::Pdf]), Kind::Other);
        assert_eq!(Format::parse("webp"), Some(Format::Webp));
        assert_eq!(Format::parse("exe"), None);
        assert!(Format::Pdf.combines() && Format::Zip.combines() && !Format::Jpg.combines());
    }

    #[test]
    fn names() {
        assert_eq!(out_name(Path::new("C:/a/vacances.heic"), Kind::Image, Format::Jpg), "vacances.jpg");
        assert_eq!(out_name(Path::new("photo.jpeg"), Kind::Image, Format::Shrink), "photo.jpeg");
        assert_eq!(out_name(Path::new("scan.tiff"), Kind::Image, Format::Shrink), "scan.jpg");
        assert_eq!(out_name(Path::new("réunion.mov"), Kind::Video, Format::Shrink), "réunion.mp4");
        assert_eq!(out_name(Path::new("réunion.mov"), Kind::Video, Format::Mp3), "réunion.mp3");
        assert_eq!(out_name(Path::new("photos.zip"), Kind::Zip, Format::Unzip), "photos");
        assert_eq!(combined_name(&[PathBuf::from("C:/Vacances/a.jpg")], Format::Pdf), "a.pdf");
        assert_eq!(combined_name(&[PathBuf::from("C:/Vacances/a.jpg"), PathBuf::from("C:/Vacances/b.jpg")], Format::Pdf), "Vacances.pdf");
        assert_eq!(combined_name(&[PathBuf::from("a.jpg"), PathBuf::from("b.jpg")], Format::Zip), "Archive.zip");
        assert_eq!(page_name(0, 3, "png"), "page 01.png");
        assert_eq!(page_name(99, 120, "jpg"), "page 100.jpg");
    }

    #[test]
    fn never_overwrites() {
        // « Conserver » : un fichier du même nom existe déjà → « photo (2).jpg ».
        let dir = temp("names");
        assert_eq!(free_path(&dir, "photo.jpg"), dir.join("photo.jpg"));
        std::fs::write(dir.join("photo.jpg"), "1").unwrap();
        assert_eq!(free_path(&dir, "photo.jpg"), dir.join("photo (2).jpg"));
        std::fs::write(dir.join("photo (2).jpg"), "2").unwrap();
        assert_eq!(free_path(&dir, "photo.jpg"), dir.join("photo (3).jpg"));
    }

    #[test]
    fn quality_and_dest() {
        assert_eq!(Quality::parse("small"), Quality::Small);
        assert_eq!(Quality::parse("n'importe"), Quality::Normal);
        assert!(Quality::Small.jpeg() < Quality::Normal.jpeg() && Quality::Normal.jpeg() < Quality::High.jpeg());
        assert!(Quality::Small.shrink_side() < Quality::High.shrink_side());
        assert_eq!(Dest::parse("desk"), Dest::Desk);
        assert_eq!(Dest::parse("replace"), Dest::Replace);
        assert_eq!(Dest::parse(""), Dest::Keep);
    }

    #[test]
    fn pdf_is_well_formed() {
        // Deux pages (une image en largeur, une en hauteur) : la table des
        // positions doit tomber exactement sur « n 0 obj ».
        let jpeg = |w: u32, h: u32| {
            let img = image::RgbImage::from_pixel(w, h, image::Rgb([200, 30, 30]));
            let mut buf = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80).encode_image(&img).unwrap();
            buf
        };
        let mut pdf = PdfWriter::new(Vec::new()).unwrap();
        pdf.add_jpeg(40, 20, &jpeg(40, 20)).unwrap();
        pdf.add_jpeg(20, 40, &jpeg(20, 40)).unwrap();
        assert_eq!(pdf.pages(), 2);
        let bytes = pdf.finish().unwrap();
        assert!(bytes.starts_with(b"%PDF-1.4\n"));
        assert!(bytes.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("/Count 2"));
        assert!(text.contains("/MediaBox [0 0 842.00 421.00]"));
        assert!(text.contains("/MediaBox [0 0 421.00 842.00]"));
        // startxref → la table ; chaque entrée « n » → le début de son objet.
        let start: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        let table = String::from_utf8(bytes[start..].to_vec()).unwrap();
        assert!(table.starts_with("xref\n0 9\n"));
        let entries: Vec<usize> = table.lines().skip(3).take(8).map(|l| l[..10].parse().unwrap()).collect();
        for (i, off) in entries.iter().enumerate() {
            let head = format!("{} 0 obj", i + 1);
            assert_eq!(&bytes[*off..*off + head.len()], head.as_bytes(), "objet {}", i + 1);
        }
        assert!(PdfWriter::new(Vec::new()).unwrap().finish().is_err());
    }

    #[test]
    fn page_sizes() {
        assert_eq!(page_size(4000, 3000), (842.0, 631.5));
        assert_eq!(page_size(0, 0), (842.0, 842.0));
    }

    #[test]
    fn zip_extraction_is_safe() {
        use zip::write::SimpleFileOptions;
        let dir = temp("unzip");
        let zip_path = dir.join("photos.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            let o = SimpleFileOptions::default();
            w.start_file("a.txt", o).unwrap();
            w.write_all(b"un").unwrap();
            w.add_directory("sous/", o).unwrap();
            w.start_file("sous/b.txt", o).unwrap();
            w.write_all(b"deux").unwrap();
            // Un nom qui voudrait sortir du dossier : ignoré.
            w.start_file("../evade.txt", o).unwrap();
            w.write_all(b"non").unwrap();
            w.finish().unwrap();
        }
        let dest = dir.join("photos");
        let mut last = 0.0;
        let n = extract_zip(&zip_path, &dest, &AtomicBool::new(false), &mut |p| last = p).unwrap();
        assert_eq!(n, 2);
        assert_eq!(last, 1.0);
        assert_eq!(std::fs::read_to_string(dest.join("a.txt")).unwrap(), "un");
        assert_eq!(std::fs::read_to_string(dest.join("sous").join("b.txt")).unwrap(), "deux");
        assert!(!dir.join("evade.txt").exists());
        // Le dossier existe déjà : refusé (le module choisit un nom libre avant).
        assert!(extract_zip(&zip_path, &dest, &AtomicBool::new(false), &mut |_| {}).is_err());
        // Arrêté en route.
        let err = extract_zip(&zip_path, &dir.join("stop"), &AtomicBool::new(true), &mut |_| {}).unwrap_err();
        assert_eq!(err, CANCELLED);
        // Pas un ZIP.
        std::fs::write(dir.join("faux.zip"), "pas un zip").unwrap();
        assert!(extract_zip(&dir.join("faux.zip"), &dir.join("faux"), &AtomicBool::new(false), &mut |_| {}).is_err());
    }
}
