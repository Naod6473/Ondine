// Tout ce qui dépend du système d'exploitation, derrière un seul jeu de noms.
//
// Le reste de l'appli appelle `platform::…` et ne touche jamais Win32 directement.
// windows.rs est la vraie implémentation ; other.rs ne sert qu'à ce que le code
// compile ailleurs (vérifications sur Linux), il ne fait presque rien.

// Volume des haut-parleurs et du micro (Core Audio). Contient sa propre version Linux.
pub mod audio;
// Luminosité des écrans (portable : WMI ; externes : DDC/CI). Contient sa propre version Linux.
pub mod brightness;
// Wi-Fi, Bluetooth, mode avion (Windows.Devices.Radios). Contient sa propre version Linux.
pub mod radios;
// Internet joignable, VPN branchés (surveillance du module Réseau). Contient sa propre version Linux.
pub mod netwatch;
// Qui utilise le micro ou la caméra en ce moment (registre). Contient sa propre version Linux.
pub mod media_use;
// « En cours de lecture » (SMTC). Contient sa propre version Linux.
pub mod media;
// Lire le texte d'une image (OCR de Windows). Contient sa propre version Linux.
pub mod ocr;
// La pipette : choisir une couleur à l'écran. Contient sa propre version Linux.
pub mod picker;

#[cfg(windows)]
mod drop_target;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(not(windows))]
mod other;
#[cfg(not(windows))]
pub use self::other::*;

/// Date et heure locales, pour les lignes du journal et les noms d'export.
pub struct LocalTime {
    pub year: u32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

impl LocalTime {
    /// "2026-10-04 21:30:00"
    pub fn stamp(&self) -> String {
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }

    /// "20261004-213000", utilisable dans un nom de fichier.
    pub fn file_stamp(&self) -> String {
        format!(
            "{:04}{:02}{:02}-{:02}{:02}{:02}",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }
}
