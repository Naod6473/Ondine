// Capture → « Enregistrer un GIF », côté fichier : assembler les images
// prises à l'écran en un GIF animé.
//
// Pour garder le fichier léger :
//   - la zone est réduite si elle dépasse 960 pixels (côté le plus long) ;
//   - seule la partie de l'image qui a changé depuis la précédente est écrite
//     (un rectangle, posé par-dessus l'image d'avant, qui reste affichée :
//     « DisposalMethod::Keep ») ; une image identique n'est pas écrite du
//     tout, la précédente reste simplement affichée plus longtemps ;
//   - chaque morceau a sa propre palette de 256 couleurs (NeuQuant, celle de
//     la crate gif, « speed » 10 : le bon compromis selon ses auteurs).
//
// La durée de chaque image vient de l'heure à laquelle elle a été prise : si
// l'ordinateur a pris du retard (des images sautées), le GIF garde le bon
// rythme. Le GIF tourne en boucle ; la dernière image reste une seconde au
// moins avant de recommencer.
//
// Rien ici ne touche à Windows : vérifié par les tests en bas du fichier
// (cargo test, même sous Linux). La prise des images est dans platform/record.rs.

use std::io::Write;
use std::time::Duration;

use gif::{DisposalMethod, Encoder, Frame, Repeat};

/// Au-delà (côté le plus long, en pixels), la zone est réduite.
pub const MAX_SIDE: u32 = 960;
/// Qualité des couleurs : de 1 (lent, fidèle) à 30 (rapide). 10 = le conseil de la crate.
const SPEED: i32 = 10;
/// La dernière image reste au moins autant (centièmes de seconde) avant que le GIF reboucle.
const END_HOLD_CS: u64 = 100;
/// En dessous de 2 centièmes, les navigateurs ralentissent l'image (à 10) : jamais moins.
const MIN_DELAY_CS: u64 = 2;

/// La taille du GIF pour une zone de `width` × `height` : la même, ou réduite
/// pour que le côté le plus long fasse `max` pixels (proportions gardées).
pub fn fit_size(width: u32, height: u32, max: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max || longest == 0 {
        return (width.max(1), height.max(1));
    }
    let scale = max as f64 / longest as f64;
    let w = ((width as f64 * scale).round() as u32).clamp(1, max);
    let h = ((height as f64 * scale).round() as u32).clamp(1, max);
    (w, h)
}

/// Un rectangle de pixels dans l'image : gauche, haut, largeur, hauteur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Patch {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Le plus petit rectangle qui contient tous les pixels différents entre
/// `before` et `after` (images RGB de `width` pixels de large). None : identiques.
pub fn changed_rect(before: &[u8], after: &[u8], width: u32) -> Option<Patch> {
    let row = width as usize * 3;
    // (Une image de largeur 0 n'a rien à comparer.)
    let height = after.len().checked_div(row)?;
    if before.len() != after.len() || !before.len().is_multiple_of(row) {
        // Tailles incohérentes : tout a changé.
        return (height > 0).then_some(Patch { x: 0, y: 0, w: width, h: height as u32 });
    }
    let rows_before = before.chunks_exact(row);
    let rows_after = after.chunks_exact(row);
    let changed: Vec<usize> = rows_before.zip(rows_after).enumerate().filter(|(_, (a, b))| a != b).map(|(i, _)| i).collect();
    let (&top, &bottom) = (changed.first()?, changed.last()?);
    // La colonne la plus à gauche et la plus à droite qui ont changé, sur les lignes concernées.
    let (mut left, mut right) = (width as usize, 0usize);
    for &y in &changed {
        let a = &before[y * row..(y + 1) * row];
        let b = &after[y * row..(y + 1) * row];
        let differs = |x: usize| a[x * 3..x * 3 + 3] != b[x * 3..x * 3 + 3];
        if let Some(x) = (0..left).find(|&x| differs(x)) {
            left = x;
        }
        if let Some(x) = (right..width as usize).rev().find(|&x| differs(x)) {
            right = x;
        }
    }
    if left > right {
        // (Ne devrait pas arriver : une ligne différente a au moins un pixel différent.)
        return Some(Patch { x: 0, y: top as u32, w: width, h: (bottom - top + 1) as u32 });
    }
    Some(Patch { x: left as u32, y: top as u32, w: (right - left + 1) as u32, h: (bottom - top + 1) as u32 })
}

/// Le moment `at` en centièmes de seconde (arrondi).
fn centis(at: Duration) -> u64 {
    (at.as_millis() as u64 + 5) / 10
}

/// Une image prête, qui attend de savoir combien de temps elle reste affichée
/// (on le sait quand la suivante arrive).
struct Pending {
    frame: Frame<'static>,
    at_cs: u64,
}

/// Écrit un GIF animé image par image dans `W` (un fichier).
pub struct GifWriter<W: Write> {
    encoder: Encoder<W>,
    width: u32,
    height: u32,
    /// La dernière image reçue (RGB), pour voir ce qui a changé.
    previous: Vec<u8>,
    pending: Option<Pending>,
    /// Images écrites (ou en attente d'écriture).
    frames: u32,
}

impl<W: Write> GifWriter<W> {
    pub fn new(out: W, width: u32, height: u32) -> Result<Self, String> {
        let (w, h) = (to_u16(width)?, to_u16(height)?);
        // Pas de palette commune : chaque image a la sienne.
        let mut encoder = Encoder::new(out, w, h, &[]).map_err(gif_error)?;
        encoder.set_repeat(Repeat::Infinite).map_err(gif_error)?;
        Ok(GifWriter { encoder, width, height, previous: Vec::new(), pending: None, frames: 0 })
    }

    /// Le nombre d'images du GIF (celles qui n'ont rien changé ne comptent pas).
    pub fn frames(&self) -> u32 {
        self.frames
    }

    /// Ajoute l'image `rgb` (largeur × hauteur × 3 octets), prise au moment
    /// `at` (depuis le début de l'enregistrement).
    pub fn push(&mut self, rgb: &[u8], at: Duration) -> Result<(), String> {
        if rgb.len() != self.width as usize * self.height as usize * 3 {
            return Err("image de la mauvaise taille".into());
        }
        let patch = if self.previous.is_empty() {
            Patch { x: 0, y: 0, w: self.width, h: self.height }
        } else {
            match changed_rect(&self.previous, rgb, self.width) {
                Some(p) => p,
                None => return Ok(()), // rien n'a bougé : l'image d'avant reste affichée
            }
        };
        let at_cs = centis(at);
        self.write_pending(at_cs)?;
        let frame = self.patch_frame(rgb, patch)?;
        self.pending = Some(Pending { frame, at_cs });
        self.frames += 1;
        self.previous.clear();
        self.previous.extend_from_slice(rgb);
        Ok(())
    }

    /// Termine le GIF (l'enregistrement s'est arrêté au moment `end`) et rend le fichier.
    pub fn finish(mut self, end: Duration) -> Result<W, String> {
        let last = self.pending.as_ref().map(|p| p.at_cs).unwrap_or(0);
        // La dernière image : jusqu'à la fin, et au moins une seconde avant de reboucler.
        let end_cs = centis(end).max(last + END_HOLD_CS);
        self.write_pending(end_cs)?;
        self.encoder.into_inner().map_err(gif_error)
    }

    /// Écrit l'image en attente, qui reste affichée jusqu'au moment `until_cs`.
    fn write_pending(&mut self, until_cs: u64) -> Result<(), String> {
        let Some(mut p) = self.pending.take() else { return Ok(()) };
        p.frame.delay = until_cs.saturating_sub(p.at_cs).clamp(MIN_DELAY_CS, u16::MAX as u64) as u16;
        self.encoder.write_frame(&p.frame).map_err(gif_error)
    }

    /// Le morceau `patch` de l'image, avec sa palette, prêt à écrire.
    fn patch_frame(&self, rgb: &[u8], patch: Patch) -> Result<Frame<'static>, String> {
        let row = self.width as usize * 3;
        let mut rgba = Vec::with_capacity(patch.w as usize * patch.h as usize * 4);
        for y in patch.y..patch.y + patch.h {
            let start = y as usize * row + patch.x as usize * 3;
            for px in rgb[start..start + patch.w as usize * 3].as_chunks::<3>().0 {
                rgba.extend_from_slice(&[px[0], px[1], px[2], 0xFF]);
            }
        }
        let mut frame = Frame::from_rgba_speed(to_u16(patch.w)?, to_u16(patch.h)?, &mut rgba, SPEED);
        frame.left = to_u16(patch.x)?;
        frame.top = to_u16(patch.y)?;
        frame.dispose = DisposalMethod::Keep;
        Ok(frame)
    }
}

fn to_u16(v: u32) -> Result<u16, String> {
    u16::try_from(v).map_err(|_| "image trop grande pour un GIF".to_string())
}

fn gif_error(e: gif::EncodingError) -> String {
    format!("écriture du GIF impossible : {e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une image unie de w × h pixels.
    fn plain(w: u32, h: u32, c: [u8; 3]) -> Vec<u8> {
        c.iter().copied().cycle().take(w as usize * h as usize * 3).collect()
    }

    fn set(img: &mut [u8], w: u32, x: u32, y: u32, c: [u8; 3]) {
        let i = (y * w + x) as usize * 3;
        img[i..i + 3].copy_from_slice(&c);
    }

    #[test]
    fn big_areas_are_scaled_down_keeping_proportions() {
        assert_eq!(fit_size(800, 600, 960), (800, 600));
        assert_eq!(fit_size(1920, 1080, 960), (960, 540));
        assert_eq!(fit_size(1080, 1920, 960), (540, 960));
        assert_eq!(fit_size(3840, 2160, 960), (960, 540));
        // Une bande très fine ne tombe jamais à 0 pixel.
        assert_eq!(fit_size(5000, 2, 960), (960, 1));
        assert_eq!(fit_size(0, 0, 960), (1, 1));
    }

    #[test]
    fn only_the_changed_rectangle_is_kept() {
        let (w, h) = (20, 10);
        let a = plain(w, h, [10, 20, 30]);
        assert_eq!(changed_rect(&a, &a, w), None);
        let mut b = a.clone();
        set(&mut b, w, 3, 2, [255, 0, 0]);
        set(&mut b, w, 7, 5, [0, 255, 0]);
        assert_eq!(changed_rect(&a, &b, w), Some(Patch { x: 3, y: 2, w: 5, h: 4 }));
        // Un seul pixel, dans un coin.
        let mut c = a.clone();
        set(&mut c, w, 19, 9, [1, 1, 1]);
        assert_eq!(changed_rect(&a, &c, w), Some(Patch { x: 19, y: 9, w: 1, h: 1 }));
        // Tailles différentes : tout est à réécrire.
        assert_eq!(changed_rect(&a, &plain(w, 5, [0, 0, 0]), w), Some(Patch { x: 0, y: 0, w, h: 5 }));
    }

    /// Une image relue : (gauche, haut, largeur, hauteur, délai).
    type Placed = (u16, u16, u16, u16, u16);

    /// Relit un GIF : (taille, images).
    fn read_back(bytes: &[u8]) -> ((u16, u16), Vec<Placed>) {
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::Indexed);
        let mut decoder = options.read_info(bytes).expect("GIF lisible");
        let size = (decoder.width(), decoder.height());
        let mut frames = Vec::new();
        while let Some(f) = decoder.read_next_frame().expect("image lisible") {
            assert_eq!(f.dispose, DisposalMethod::Keep);
            frames.push((f.left, f.top, f.width, f.height, f.delay));
        }
        (size, frames)
    }

    #[test]
    fn a_recording_becomes_a_light_looping_gif() {
        let (w, h) = (40, 30);
        let mut gif = GifWriter::new(Vec::new(), w, h).unwrap();
        let a = plain(w, h, [240, 240, 240]);
        let mut b = a.clone();
        for x in 10..14 {
            set(&mut b, w, x, 20, [0, 0, 200]);
        }
        gif.push(&a, Duration::ZERO).unwrap();
        // 100 ms plus tard, rien n'a changé : pas d'image en plus.
        gif.push(&a, Duration::from_millis(100)).unwrap();
        gif.push(&b, Duration::from_millis(200)).unwrap();
        assert_eq!(gif.frames(), 2);
        let bytes = gif.finish(Duration::from_millis(500)).unwrap();
        assert_eq!(&bytes[..6], b"GIF89a");
        // Le GIF tourne en boucle (extension NETSCAPE2.0).
        assert!(bytes.windows(11).any(|x| x == b"NETSCAPE2.0"));
        let (size, frames) = read_back(&bytes);
        assert_eq!(size, (40, 30));
        // 1re image entière, affichée 20 centièmes (jusqu'au changement) ; puis
        // seulement la bande qui a changé, affichée jusqu'à la fin (au moins 1 s).
        assert_eq!(frames, vec![(0, 0, 40, 30, 20), (10, 20, 4, 1, 100)]);
    }

    #[test]
    fn delays_follow_the_real_time_and_never_drop_below_two_hundredths() {
        let (w, h) = (8, 8);
        let mut gif = GifWriter::new(Vec::new(), w, h).unwrap();
        let mut img = plain(w, h, [0, 0, 0]);
        // Des images prises à 0, 104, 196 (retard rattrapé), 210 ms (trop près), puis fin à 3 s.
        for (i, ms) in [0u64, 104, 196, 210].iter().enumerate() {
            set(&mut img, w, i as u32, 0, [255, 255, 255]);
            gif.push(&img, Duration::from_millis(*ms)).unwrap();
        }
        let bytes = gif.finish(Duration::from_secs(3)).unwrap();
        let delays: Vec<u16> = read_back(&bytes).1.iter().map(|f| f.4).collect();
        // 0 → 10 cs, 10 → 20, 20 → 21 (1 cs : relevé à 2), 21 → 300.
        assert_eq!(delays, vec![10, 10, 2, 279]);
    }

    #[test]
    fn many_colors_are_reduced_to_a_palette() {
        // Un dégradé de plus de 256 couleurs : NeuQuant choisit la palette.
        let (w, h) = (64, 64);
        let mut img = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                img.extend_from_slice(&[(x * 4) as u8, (y * 4) as u8, ((x + y) * 2) as u8]);
            }
        }
        let mut gif = GifWriter::new(Vec::new(), w, h).unwrap();
        gif.push(&img, Duration::ZERO).unwrap();
        let bytes = gif.finish(Duration::from_secs(1)).unwrap();
        let (size, frames) = read_back(&bytes);
        assert_eq!(size, (64, 64));
        assert_eq!(frames.len(), 1);
    }

    #[test]
    fn wrong_sizes_are_refused() {
        let mut gif = GifWriter::new(Vec::new(), 4, 4).unwrap();
        assert!(gif.push(&[0u8; 10], Duration::ZERO).is_err());
        assert!(GifWriter::new(Vec::new(), 70_000, 4).is_err());
    }
}
