// QR code d'une copie du Presse-papiers : pour passer un lien ou un texte du PC
// au téléphone (l'appareil photo du téléphone lit le code).
//
// Tout est calculé ici, sur le PC, avec le crate `qrcode` (sans ses options
// d'image : on ne lui demande que la grille de carrés noirs et blancs). Aucun
// service en ligne. Deux dessins de la même grille :
//   - un SVG (vectoriel, net à toute taille) pour l'afficher dans l'île ;
//   - une image RGBA (pixels) pour « Copier l'image » dans le presse-papiers.
//
// Limite : au-delà de MAX_QR_CHARS caractères, on refuse. Un QR code peut en
// contenir un peu plus (environ 2 300 octets au niveau de correction choisi),
// mais il devient alors si serré qu'un téléphone a du mal à le lire sur un écran.

use qrcode::{Color, EcLevel, QrCode};

/// Au plus tant de caractères dans un QR code (au-delà : message clair).
pub const MAX_QR_CHARS: usize = 1000;
/// La marge blanche autour du code, en carrés (la norme en demande 4).
const QUIET: usize = 4;
/// Taille visée de l'image copiée, en pixels (à peu près).
const COPY_PIXELS: usize = 512;

/// Une grille de QR code prête à dessiner, marge blanche comprise.
pub struct Qr {
    /// Nombre de carrés par côté (marge comprise).
    pub width: usize,
    /// `true` = carré noir, ligne par ligne.
    dark: Vec<bool>,
}

impl Qr {
    fn is_dark(&self, x: usize, y: usize) -> bool {
        self.dark[y * self.width + x]
    }
}

/// Calcule la grille du QR code de `text`.
pub fn make(text: &str) -> Result<Qr, String> {
    let chars = text.chars().count();
    if text.trim().is_empty() {
        return Err("rien à mettre dans le QR code".into());
    }
    if chars > MAX_QR_CHARS {
        return Err(too_long(chars));
    }
    // Niveau M : le code reste lisible même un peu abîmé ou flou (15 %).
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M).map_err(|_| too_long(chars))?;
    let inner = code.width();
    let colors = code.to_colors();
    let width = inner + 2 * QUIET;
    let mut dark = vec![false; width * width];
    for y in 0..inner {
        for x in 0..inner {
            dark[(y + QUIET) * width + x + QUIET] = colors[y * inner + x] == Color::Dark;
        }
    }
    Ok(Qr { width, dark })
}

fn too_long(chars: usize) -> String {
    format!("texte trop long pour un QR code ({chars} caractères, {MAX_QR_CHARS} au plus)")
}

/// Le dessin SVG : un fond blanc et un seul chemin noir. Les carrés voisins
/// d'une même ligne sont regroupés en un rectangle (fichier plus petit).
pub fn svg(qr: &Qr) -> String {
    let w = qr.width;
    let mut d = String::new();
    for y in 0..w {
        let mut x = 0;
        while x < w {
            if !qr.is_dark(x, y) {
                x += 1;
                continue;
            }
            let start = x;
            while x < w && qr.is_dark(x, y) {
                x += 1;
            }
            let run = x - start;
            d.push_str(&format!("M{start} {y}h{run}v1h-{run}z"));
        }
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {w}\" shape-rendering=\"crispEdges\">\
         <rect width=\"{w}\" height=\"{w}\" fill=\"#fff\"/><path fill=\"#000\" d=\"{d}\"/></svg>"
    )
}

/// L'image en pixels (RGBA, noir sur blanc) pour le presse-papiers : chaque
/// carré fait `scale` pixels, pour une image d'environ COPY_PIXELS de côté.
/// Renvoie (côté en pixels, octets).
pub fn rgba(qr: &Qr) -> (usize, Vec<u8>) {
    let scale = (COPY_PIXELS / qr.width).max(4);
    let side = qr.width * scale;
    let mut bytes = Vec::with_capacity(side * side * 4);
    for py in 0..side {
        for px in 0..side {
            let v = if qr.is_dark(px / scale, py / scale) { 0 } else { 255 };
            bytes.extend_from_slice(&[v, v, v, 255]);
        }
    }
    (side, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_link_gives_small_code_with_margin() {
        let qr = make("https://exemple.fr").unwrap();
        // Version 2 (25 carrés) + 4 de marge de chaque côté.
        assert_eq!(qr.width, 25 + 2 * QUIET);
        // La marge est blanche, le coin du repère (en haut à gauche) est noir.
        assert!(!qr.is_dark(0, 0));
        assert!(!qr.is_dark(QUIET - 1, QUIET));
        assert!(qr.is_dark(QUIET, QUIET));
    }

    #[test]
    fn refuses_empty_and_too_long() {
        assert!(make("").is_err());
        assert!(make("   ").is_err());
        assert!(make(&"a".repeat(MAX_QR_CHARS)).is_ok());
        let err = make(&"a".repeat(MAX_QR_CHARS + 1)).err().unwrap();
        assert!(err.contains("trop long") && err.contains("1001"));
        // Des émojis (4 octets chacun) : sous la limite de caractères mais trop
        // lourds pour un QR code → le même message clair.
        let err = make(&"🙂".repeat(MAX_QR_CHARS)).err().unwrap();
        assert!(err.contains("trop long"));
    }

    #[test]
    fn accents_fit() {
        assert!(make(&"é".repeat(MAX_QR_CHARS)).is_ok());
    }

    #[test]
    fn svg_draws_the_grid() {
        let qr = make("Bonjour").unwrap();
        let s = svg(&qr);
        assert!(s.starts_with("<svg"));
        assert!(s.contains(&format!("viewBox=\"0 0 {0} {0}\"", qr.width)));
        // Le repère en haut à gauche commence par une ligne de 7 carrés noirs.
        assert!(s.contains(&format!("M{QUIET} {QUIET}h7v1h-7z")));
        // Le texte lui-même n'apparaît jamais dans le SVG.
        assert!(!s.contains("Bonjour"));
    }

    #[test]
    fn pixels_match_the_grid() {
        let qr = make("Bonjour").unwrap();
        let (side, bytes) = rgba(&qr);
        assert_eq!(bytes.len(), side * side * 4);
        assert!(side >= 256);
        let scale = side / qr.width;
        let pixel = |x: usize, y: usize| bytes[(y * side + x) * 4];
        assert_eq!(pixel(0, 0), 255);
        assert_eq!(pixel(QUIET * scale, QUIET * scale), 0);
        assert_eq!(pixel(side - 1, side - 1), 255);
    }
}
