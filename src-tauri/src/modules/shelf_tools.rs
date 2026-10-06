// Outils de l'Étagère pour les fichiers glissés sur l'île :
//   - images : convertir (PNG ou JPEG) et/ou réduire à une largeur maximale ;
//   - renommer plusieurs fichiers d'un coup selon un modèle (« vacances-{n} »).
//
// Règles de l'île appliquées ici :
//   - les chemins arrivent déjà validés (ctx.check_path dans shelf.rs) ;
//   - jamais d'écrasement : les nouvelles images prennent un nom libre à côté de
//     l'original, l'original n'est pas touché ;
//   - le renommage est d'abord MONTRÉ (aperçu « ancien → nouveau ») ; c'est le
//     bouton de confirmation du front qui lance le vrai renommage ;
//   - « Annuler » : les images créées vont à la Corbeille ; les fichiers
//     renommés reprennent leur ancien nom.

use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

use crate::services::files;

/// Au plus tant de fichiers par opération.
pub const MAX_FILES: usize = 100;
/// Une image plus grosse que ça (octets) n'est pas ouverte.
const MAX_IMAGE_BYTES: u64 = 200 * 1024 * 1024;

// ── Images ───────────────────────────────────────────────────────────────────

/// Le format de sortie choisi.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutFormat {
    /// Garder le format d'origine (PNG reste PNG ; JPEG reste JPEG ; le reste devient PNG).
    Same,
    Png,
    Jpeg,
}

impl OutFormat {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "same" => Some(Self::Same),
            "png" => Some(Self::Png),
            "jpeg" | "jpg" => Some(Self::Jpeg),
            _ => None,
        }
    }
}

/// Le nom de la nouvelle image : « photo.png » → « photo-1280.jpg ».
pub fn image_name(original: &Path, max_width: Option<u32>, jpeg: bool) -> String {
    let stem = original.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "image".into());
    let suffix = max_width.map(|w| format!("-{w}")).unwrap_or_else(|| "-converti".into());
    format!("{stem}{suffix}.{}", if jpeg { "jpg" } else { "png" })
}

/// Crée la nouvelle version d'une image, à côté de l'originale. Renvoie son chemin.
pub fn convert_image(src: &Path, format: OutFormat, max_width: Option<u32>, quality: u8) -> Result<PathBuf, String> {
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let size = std::fs::metadata(src).map_err(|e| format!("{name} : {e}"))?.len();
    if size > MAX_IMAGE_BYTES {
        return Err(format!("{name} : image trop lourde"));
    }
    let source_format = ImageFormat::from_path(src).ok();
    let img = image::open(src).map_err(|_| format!("{name} : pas une image lisible (PNG, JPEG, WebP, BMP ou GIF)"))?;
    let jpeg = match format {
        OutFormat::Jpeg => true,
        OutFormat::Png => false,
        OutFormat::Same => source_format == Some(ImageFormat::Jpeg),
    };
    // Plus étroite que la largeur voulue : on ne l'agrandit pas.
    let img = match max_width {
        Some(w) if img.width() > w => {
            let h = ((img.height() as f64) * (w as f64) / (img.width() as f64)).round().max(1.0) as u32;
            img.resize_exact(w, h, FilterType::Lanczos3)
        }
        _ => img,
    };
    let dir = src.parent().ok_or("dossier introuvable")?;
    let dest = files::unique_dest(dir, std::ffi::OsStr::new(&image_name(src, max_width, jpeg)));
    let file = std::fs::File::create(&dest).map_err(|e| format!("{name} : {e}"))?;
    let mut out = std::io::BufWriter::new(file);
    let written = if jpeg {
        // Le JPEG n'a pas de transparence : on la pose sur du blanc.
        let rgb = flatten_on_white(&img);
        rgb.write_with_encoder(JpegEncoder::new_with_quality(&mut out, quality.clamp(30, 100)))
    } else {
        img.write_to(&mut out, ImageFormat::Png)
    };
    drop(out);
    if let Err(e) = written {
        // Le fichier à moitié écrit part à la Corbeille (jamais de suppression définitive).
        let _ = files::to_trash(std::slice::from_ref(&dest));
        return Err(format!("{name} : {e}"));
    }
    Ok(dest)
}

fn flatten_on_white(img: &DynamicImage) -> DynamicImage {
    let rgba = img.to_rgba8();
    let mut rgb = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        rgb.put_pixel(x, y, image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])]));
    }
    DynamicImage::ImageRgb8(rgb)
}

// ── Renommer ─────────────────────────────────────────────────────────────────

/// Les caractères interdits dans un nom de fichier Windows.
const FORBIDDEN: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
/// Les noms réservés par Windows (même avec une extension).
const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3",
    "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Les nouveaux noms : `{n}` = numéro (avec des zéros devant si besoin),
/// `{nom}` = l'ancien nom sans extension. L'extension est gardée.
/// Sans `{n}` ni `{nom}`, on ajoute « -{n} » pour que les noms restent différents.
pub fn rename_plan(paths: &[PathBuf], pattern: &str, start: u32) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err("écris un modèle de nom, par exemple « vacances-{n} »".into());
    }
    if pattern.chars().any(|c| FORBIDDEN.contains(&c) || c.is_control()) {
        return Err("le modèle contient un caractère interdit (\\ / : * ? \" < > |)".into());
    }
    let pattern = if pattern.contains("{n}") || pattern.contains("{nom}") { pattern.to_string() } else { format!("{pattern}-{{n}}") };
    let last = start as usize + paths.len().saturating_sub(1);
    let width = last.to_string().len().max(2);
    let mut plan = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let n = format!("{:0width$}", start as usize + i);
        let base = pattern.replace("{n}", &n).replace("{nom}", &stem);
        let base = base.trim_end_matches(['.', ' ']).to_string();
        if base.is_empty() || base.chars().count() > 200 {
            return Err("le nom obtenu est vide ou trop long".into());
        }
        if RESERVED.contains(&base.to_lowercase().as_str()) {
            return Err(format!("« {base} » est un nom réservé par Windows"));
        }
        let dir = p.parent().ok_or("dossier introuvable")?;
        plan.push((p.clone(), dir.join(format!("{base}{ext}"))));
    }
    // Deux fichiers ne peuvent pas finir avec le même nom…
    for (i, (_, a)) in plan.iter().enumerate() {
        if plan[..i].iter().any(|(_, b)| same_name(a, b)) {
            return Err(format!("deux fichiers s'appelleraient « {} »", file_name(a)));
        }
        // …ni prendre le nom d'un fichier qui existe déjà et qui ne fait pas partie du lot.
        if a.exists() && !paths.iter().any(|p| same_name(p, a)) {
            return Err(format!("« {} » existe déjà dans ce dossier", file_name(a)));
        }
    }
    Ok(plan)
}

/// Windows ne distingue pas majuscules et minuscules dans les noms.
fn same_name(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// Applique un plan de renommage. En deux temps (d'abord un nom provisoire)
/// pour que « a → b » et « b → a » marchent. Renvoie les paires faites (pour
/// annuler). En cas d'erreur, ce qui a été fait est défait.
pub fn apply_renames(plan: &[(PathBuf, PathBuf)]) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let mut temps: Vec<(PathBuf, PathBuf, PathBuf)> = Vec::new(); // (ancien, provisoire, nouveau)
    let undo_temps = |temps: &[(PathBuf, PathBuf, PathBuf)]| {
        for (old, tmp, _) in temps.iter().rev() {
            let _ = std::fs::rename(tmp, old);
        }
    };
    for (i, (old, new)) in plan.iter().enumerate() {
        if old == new {
            continue;
        }
        let dir = old.parent().ok_or("dossier introuvable")?;
        let tmp = files::unique_dest(dir, std::ffi::OsStr::new(&format!(".ondine-renommage-{i}.tmp")));
        if let Err(e) = std::fs::rename(old, &tmp) {
            undo_temps(&temps);
            return Err(format!("{} : {e}", file_name(old)));
        }
        temps.push((old.clone(), tmp, new.clone()));
    }
    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (k, (old, tmp, new)) in temps.iter().enumerate() {
        if new.exists() || std::fs::rename(tmp, new).is_err() {
            // On remet tout comme avant : ceux déjà renommés, puis les provisoires.
            for (o, n) in done.iter().rev() {
                let _ = std::fs::rename(n, o);
            }
            undo_temps(&temps[k..]);
            return Err(format!("impossible de renommer {} : rien n'a changé", file_name(old)));
        }
        done.push((old.clone(), new.clone()));
    }
    Ok(done)
}

/// Annuler un renommage : chaque fichier reprend son ancien nom (s'il est libre).
pub fn undo_renames(done: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let plan: Vec<(PathBuf, PathBuf)> = done.iter().map(|(old, new)| (new.clone(), old.clone())).collect();
    apply_renames(&plan).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ondine-tools-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn image_names() {
        assert_eq!(image_name(Path::new("C:/a/photo.PNG"), Some(1280), true), "photo-1280.jpg");
        assert_eq!(image_name(Path::new("C:/a/photo.webp"), None, false), "photo-converti.png");
    }

    #[test]
    fn rename_plan_and_swap() {
        let dir = temp("rename");
        let a = dir.join("b.txt");
        let b = dir.join("a.txt");
        std::fs::write(&a, "1").unwrap();
        std::fs::write(&b, "2").unwrap();
        // « b.txt » → « a.txt » et « a.txt » → « b.txt » : un échange.
        // « {nom} » seul : chaque fichier garde son nom (rien à faire, pas d'erreur).
        let plan = rename_plan(&[a.clone(), b.clone()], "{nom}", 1).unwrap();
        assert!(plan.iter().all(|(o, n)| o == n));
        let plan = vec![(a.clone(), dir.join("a.txt")), (b.clone(), dir.join("b.txt"))];
        let done = apply_renames(&plan).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "1");
        assert_eq!(std::fs::read_to_string(dir.join("b.txt")).unwrap(), "2");
        undo_renames(&done).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("b.txt")).unwrap(), "1");

        let plan = rename_plan(&[a.clone(), b.clone()], "vacances", 1).unwrap();
        assert_eq!(file_name(&plan[0].1), "vacances-01.txt");
        assert_eq!(file_name(&plan[1].1), "vacances-02.txt");
        assert!(rename_plan(&[a.clone()], "a:b", 1).is_err());
        assert!(rename_plan(&[a.clone()], "con", 1).is_ok()); // « con-01 » : pas réservé
        assert!(rename_plan(&[a], "{n}x", 1).is_ok());
    }

    #[test]
    fn rename_refuses_to_overwrite() {
        let dir = temp("rename-exists");
        let a = dir.join("x.txt");
        std::fs::write(&a, "1").unwrap();
        std::fs::write(dir.join("photo-01.txt"), "autre").unwrap();
        assert!(rename_plan(&[a], "photo-{n}", 1).is_err());
    }
}
