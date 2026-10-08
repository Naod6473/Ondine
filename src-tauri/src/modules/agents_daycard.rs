// Agents IA : le « Bilan du jour » en image.
//
// La carte est dessinée par le front (src/modules/agents/day-card.ts), en PNG.
// Elle revient ici pour être copiée (presse-papiers, prête à coller dans
// LinkedIn ou Teams) ou enregistrée dans Téléchargements
// (« bilan-du-jour-AAAA-MM-JJ.png »). On vérifie que c'est bien une image PNG
// de taille raisonnable ; rien n'est envoyé nulle part.
//
// Ce fichier ne dépend ni de Tauri ni du reste de l'appli : il se teste à part.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// Une carte fait 1200 × 675 (2400 × 1350 au plus, écran à 200 %) : quelques Mo.
const MAX_BASE64: usize = 24 * 1024 * 1024;
/// Côté le plus long accepté.
const MAX_SIDE: u32 = 4096;

/// Une image décodée : le PNG tel quel (pour le fichier) et ses pixels (pour le presse-papiers).
pub struct Card {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Décode et vérifie le PNG envoyé par le front (base64, sans « data:… »).
pub fn decode(encoded: &str) -> Result<Card, String> {
    if encoded.is_empty() || encoded.len() > MAX_BASE64 {
        return Err("image manquante ou trop grande".into());
    }
    let png = BASE64.decode(encoded).map_err(|_| "image illisible".to_string())?;
    let img = image::load_from_memory_with_format(&png, image::ImageFormat::Png).map_err(|e| format!("image illisible : {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err("image de taille inattendue".into());
    }
    Ok(Card { png, width, height, rgba: rgba.into_raw() })
}

/// Le nom du fichier du jour : « bilan-du-jour-2026-10-08.png ».
pub fn file_name(day: &str) -> String {
    format!("bilan-du-jour-{day}.png")
}

/// Écrit le PNG dans `dir` sous un nom libre (« … (2).png » si le premier est pris).
pub fn save(dir: &Path, day: &str, png: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("dossier Téléchargements : {e}"))?;
    let mut path = dir.join(file_name(day));
    let mut i = 2;
    while path.exists() {
        path = dir.join(format!("bilan-du-jour-{day} ({i}).png"));
        i += 1;
    }
    std::fs::write(&path, png).map_err(|e| format!("écriture impossible : {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png() -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(3, 2, image::Rgba([10, 20, 30, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn decode_checks_the_image() {
        let card = decode(&BASE64.encode(tiny_png())).unwrap();
        assert_eq!((card.width, card.height), (3, 2));
        assert_eq!(card.rgba.len(), 3 * 2 * 4);
        assert!(decode("").is_err());
        assert!(decode("pas du base64 !").is_err());
        assert!(decode(&BASE64.encode(b"GIF89a pas un png")).is_err());
    }

    #[test]
    fn save_finds_a_free_name() {
        let dir = std::env::temp_dir().join(format!("ondine-daycard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let png = tiny_png();
        let a = save(&dir, "2026-10-08", &png).unwrap();
        let b = save(&dir, "2026-10-08", &png).unwrap();
        assert_eq!(a.file_name().unwrap(), "bilan-du-jour-2026-10-08.png");
        assert_eq!(b.file_name().unwrap(), "bilan-du-jour-2026-10-08 (2).png");
        assert_eq!(std::fs::read(&b).unwrap(), png);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
