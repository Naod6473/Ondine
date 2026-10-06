// La pipette, côté calcul : écrire une couleur en HEX, RGB ou HSL, relire un
// « #3A7BD5 » envoyé par le front, et garder les 8 dernières couleurs.
//
// Rien ici ne touche à Windows : ce sont de petites fonctions « pures »,
// vérifiées par les tests en bas du fichier (cargo test, même sous Linux).

/// Une couleur : rouge, vert, bleu, de 0 à 255 chacun.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Comment écrire la couleur copiée (réglage « colorFormat » du module).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// #3A7BD5
    Hex,
    /// rgb(58, 123, 213)
    Rgb,
    /// hsl(215, 65%, 53%)
    Hsl,
}

impl Format {
    /// Le réglage tel qu'enregistré ("hex", "rgb", "hsl") ; HEX par défaut.
    pub fn parse(value: Option<&str>) -> Format {
        match value {
            Some("rgb") => Format::Rgb,
            Some("hsl") => Format::Hsl,
            _ => Format::Hex,
        }
    }
}

/// Combien de couleurs l'historique garde.
pub const HISTORY_MAX: usize = 8;

impl Rgb {
    /// "#3A7BD5" (majuscules, toujours 7 caractères).
    pub fn hex(self) -> String {
        format!("#{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }

    /// Relit "#3A7BD5" ou "3a7bd5". Tout le reste est refusé (None) : le
    /// front ne peut envoyer qu'une vraie couleur.
    pub fn from_hex(text: &str) -> Option<Rgb> {
        let digits = text.trim().strip_prefix('#').unwrap_or(text.trim());
        if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).ok();
        Some(Rgb { r: byte(0)?, g: byte(2)?, b: byte(4)? })
    }

    /// Teinte (0-359°), saturation et luminosité (0-100 %), arrondies.
    pub fn hsl(self) -> (u32, u32, u32) {
        let r = self.r as f64 / 255.0;
        let g = self.g as f64 / 255.0;
        let b = self.b as f64 / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let delta = max - min;
        let l = (max + min) / 2.0;
        // Un gris (delta nul) n'a ni teinte ni saturation.
        if delta == 0.0 {
            return (0, 0, (l * 100.0).round() as u32);
        }
        let s = delta / (1.0 - (2.0 * l - 1.0).abs());
        let h = if max == r {
            60.0 * ((g - b) / delta).rem_euclid(6.0)
        } else if max == g {
            60.0 * ((b - r) / delta + 2.0)
        } else {
            60.0 * ((r - g) / delta + 4.0)
        };
        // 359,6° arrondi donne 360° : c'est 0°.
        ((h.round() as u32) % 360, (s * 100.0).round() as u32, (l * 100.0).round() as u32)
    }

    /// Le texte à copier, dans le format choisi.
    pub fn text(self, format: Format) -> String {
        match format {
            Format::Hex => self.hex(),
            Format::Rgb => format!("rgb({}, {}, {})", self.r, self.g, self.b),
            Format::Hsl => {
                let (h, s, l) = self.hsl();
                format!("hsl({h}, {s}%, {l}%)")
            }
        }
    }
}

/// Ajoute une couleur en tête de l'historique : sans doublon (elle remonte si
/// elle y était déjà), et jamais plus de HISTORY_MAX.
pub fn push_history(history: &mut Vec<Rgb>, color: Rgb) {
    history.retain(|c| *c != color);
    history.insert(0, color);
    history.truncate(HISTORY_MAX);
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLUE: Rgb = Rgb { r: 0x3A, g: 0x7B, b: 0xD5 };

    #[test]
    fn hex_round_trip() {
        assert_eq!(BLUE.hex(), "#3A7BD5");
        assert_eq!(Rgb::from_hex("#3A7BD5"), Some(BLUE));
        assert_eq!(Rgb::from_hex("3a7bd5"), Some(BLUE));
        assert_eq!(Rgb::from_hex(" #3a7bd5 "), Some(BLUE));
        assert_eq!(Rgb { r: 0, g: 5, b: 255 }.hex(), "#0005FF");
    }

    #[test]
    fn hex_refuses_garbage() {
        for bad in ["", "#", "#3A7BD", "#3A7BD5F", "#GGGGGG", "rgb(1,2,3)", "#3A7BD5;", "#+1+2+3"] {
            assert_eq!(Rgb::from_hex(bad), None, "{bad}");
        }
    }

    #[test]
    fn rgb_text() {
        assert_eq!(BLUE.text(Format::Rgb), "rgb(58, 123, 213)");
        assert_eq!(BLUE.text(Format::Hex), "#3A7BD5");
    }

    #[test]
    fn hsl_known_colors() {
        assert_eq!(Rgb { r: 255, g: 0, b: 0 }.hsl(), (0, 100, 50));
        assert_eq!(Rgb { r: 0, g: 255, b: 0 }.hsl(), (120, 100, 50));
        assert_eq!(Rgb { r: 0, g: 0, b: 255 }.hsl(), (240, 100, 50));
        assert_eq!(Rgb { r: 255, g: 255, b: 255 }.hsl(), (0, 0, 100));
        assert_eq!(Rgb { r: 0, g: 0, b: 0 }.hsl(), (0, 0, 0));
        assert_eq!(Rgb { r: 128, g: 128, b: 128 }.hsl(), (0, 0, 50));
        // Magenta-rouge : la teinte « tourne » (valeur négative ramenée dans 0-359).
        assert_eq!(Rgb { r: 255, g: 0, b: 128 }.hsl(), (330, 100, 50));
        assert_eq!(BLUE.text(Format::Hsl), "hsl(215, 65%, 53%)");
    }

    #[test]
    fn hsl_never_360() {
        // Presque rouge, un soupçon de bleu : 359,x° doit rester sous 360.
        let (h, _, _) = Rgb { r: 255, g: 0, b: 1 }.hsl();
        assert!(h < 360);
    }

    #[test]
    fn format_setting() {
        assert_eq!(Format::parse(Some("rgb")), Format::Rgb);
        assert_eq!(Format::parse(Some("hsl")), Format::Hsl);
        assert_eq!(Format::parse(Some("hex")), Format::Hex);
        assert_eq!(Format::parse(Some("n'importe quoi")), Format::Hex);
        assert_eq!(Format::parse(None), Format::Hex);
    }

    #[test]
    fn history_is_bounded_and_without_duplicates() {
        let mut h = Vec::new();
        for i in 0..12u8 {
            push_history(&mut h, Rgb { r: i, g: 0, b: 0 });
        }
        assert_eq!(h.len(), HISTORY_MAX);
        assert_eq!(h[0].r, 11, "la plus récente en tête");
        assert_eq!(h[7].r, 4, "les plus anciennes sont parties");
        // Reprendre une couleur déjà là la remonte, sans doublon.
        push_history(&mut h, Rgb { r: 6, g: 0, b: 0 });
        assert_eq!(h.len(), HISTORY_MAX);
        assert_eq!(h[0].r, 6);
        assert_eq!(h.iter().filter(|c| c.r == 6).count(), 1);
    }
}
