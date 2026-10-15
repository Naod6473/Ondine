// La reconnaissance vocale sur le PC (1.2.4) : Parakeet, 100 % hors ligne,
// pour la dictée partout, les notes d'appel et Parler à Ondine.
//
// Version de départ posée avant le travail des branches : l'API ci-dessous
// est le contrat partagé. La branche « parole » la remplit (sherpa-onnx,
// modèles téléchargés seulement au clic, vérifiés par SHA-256) ; les autres
// branches l'appellent sans attendre qu'elle soit finie.
#![allow(dead_code)]

use serde::Serialize;

/// Tous les modèles travaillent en 16 kHz, mono, échantillons f32 entre -1 et 1.
pub const SAMPLE_RATE: u32 = 16_000;

/// Un tour de parole d'un appel : qui parle (0, 1, 2… dans l'ordre d'apparition), quand, et quoi.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub speaker: usize,
    /// Début et fin, en secondes depuis le début de l'audio donné.
    pub start: f32,
    pub end: f32,
    pub text: String,
}

/// Les modèles sont-ils téléchargés et prêts ?
pub fn ready() -> bool {
    false
}

/// Écrit en texte un morceau d'audio (16 kHz mono). `lang` : "fr", "en"… ou None (détection).
pub fn transcribe(_samples: &[f32], _lang: Option<&str>) -> Result<String, String> {
    Err("La reconnaissance sur le PC n'est pas encore installée.".into())
}

/// Écrit un long enregistrement en séparant les voix (notes d'appel).
pub fn transcribe_speakers(_samples: &[f32], _lang: Option<&str>) -> Result<Vec<Turn>, String> {
    Err("La reconnaissance sur le PC n'est pas encore installée.".into())
}
