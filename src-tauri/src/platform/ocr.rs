// Lire le texte d'une image : la reconnaissance de caractères (OCR) de Windows,
// `Windows.Media.Ocr`. Elle tourne entièrement sur l'ordinateur, hors ligne :
// l'image n'est envoyée nulle part.
//
// Elle reconnaît les langues dont Windows a le « pack OCR » (en général installé
// avec la langue d'affichage : le français chez toi). On demande celle de ton
// profil utilisateur.
//
// Sous Linux (vérifications), tout renvoie une erreur « seulement sous Windows ».

use serde::Serialize;

/// Le résultat d'une lecture.
#[derive(Debug, Clone, Serialize)]
pub struct OcrText {
    /// Le texte, une ligne de l'image par ligne.
    pub text: String,
    /// La langue utilisée (ex. « français (France) »).
    pub language: String,
}

/// Une image en mémoire : 4 octets par pixel, rouge-vert-bleu-alpha.
pub struct Rgba<'a> {
    pub width: u32,
    pub height: u32,
    pub bytes: &'a [u8],
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{OcrText, Rgba};
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    /// Lit le texte de l'image. À appeler sur un thread secondaire (`.get()` attend).
    pub fn recognize(image: Rgba) -> Result<OcrText, String> {
        super::super::media::init_thread();
        let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
            "aucune langue OCR installée. Paramètres > Heure et langue > Langue et région > \
             Français > Options de langue > installer « Reconnaissance optique de caractères »"
                .to_string()
        })?;
        let language = engine
            .RecognizerLanguage()
            .and_then(|l| l.DisplayName())
            .map(|n| n.to_string())
            .unwrap_or_default();

        // Windows refuse les images plus grandes qu'une certaine taille : on réduit.
        let max = OcrEngine::MaxImageDimension().unwrap_or(2600).max(1);
        let resized;
        let image = if image.width > max || image.height > max {
            resized = super::shrink(&image, max)?;
            Rgba { width: resized.width(), height: resized.height(), bytes: resized.as_raw() }
        } else {
            image
        };

        let read = || -> windows::core::Result<String> {
            // L'OCR veut les octets dans l'ordre bleu-vert-rouge-alpha.
            let writer = DataWriter::new()?;
            writer.WriteBytes(&super::rgba_to_bgra(image.bytes))?;
            let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
                &writer.DetachBuffer()?,
                BitmapPixelFormat::Bgra8,
                image.width as i32,
                image.height as i32,
            )?;
            let result = engine.RecognizeAsync(&bitmap)?.get()?;
            let lines = result.Lines()?;
            let mut text = Vec::new();
            for i in 0..lines.Size()? {
                text.push(lines.GetAt(i)?.Text()?.to_string());
            }
            Ok(text.join("\r\n"))
        };
        let text = read().map_err(|e| format!("lecture du texte impossible : {e}"))?;
        Ok(OcrText { text, language })
    }
}

#[cfg(not(windows))]
mod stub {
    use super::{OcrText, Rgba};

    pub fn recognize(_: Rgba) -> Result<OcrText, String> {
        Err("disponible seulement sous Windows".into())
    }
}

/// Réduit l'image pour que son plus grand côté fasse au plus `max` pixels.
#[cfg_attr(not(windows), allow(dead_code))]
fn shrink(image: &Rgba, max: u32) -> Result<image::RgbaImage, String> {
    let buf = image::RgbaImage::from_raw(image.width, image.height, image.bytes.to_vec()).ok_or("image abîmée")?;
    let scale = max as f64 / image.width.max(image.height) as f64;
    let w = ((image.width as f64 * scale) as u32).max(1);
    let h = ((image.height as f64 * scale) as u32).max(1);
    Ok(image::imageops::resize(&buf, w, h, image::imageops::FilterType::Triangle))
}

/// RGBA → BGRA : on échange le rouge et le bleu de chaque pixel.
#[cfg_attr(not(windows), allow(dead_code))]
fn rgba_to_bgra(bytes: &[u8]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    for px in out.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn red_and_blue_are_swapped() {
        assert_eq!(rgba_to_bgra(&[1, 2, 3, 4, 5, 6, 7, 8]), [3, 2, 1, 4, 7, 6, 5, 8]);
    }

    #[test]
    fn big_images_are_shrunk() {
        let bytes = vec![255u8; 4000 * 100 * 4];
        let small = shrink(&Rgba { width: 4000, height: 100, bytes: &bytes }, 2000).unwrap();
        assert_eq!((small.width(), small.height()), (2000, 50));
    }
}
