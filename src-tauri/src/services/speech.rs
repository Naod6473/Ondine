// La reconnaissance vocale sur le PC (1.2.4) : Parakeet de NVIDIA (25 langues
// européennes) par sherpa-onnx, 100 % hors ligne, pour la dictée partout, les
// notes d'appel et Parler à Ondine.
//
// L'API ci-dessous est le contrat partagé entre les branches de la 1.2.4 :
// `SAMPLE_RATE`, `Turn`, `ready()`, `transcribe(samples, lang)`,
// `transcribe_speakers(samples, lang)`. En plus : `status()`, le
// téléchargement (`download`, `cancel`, `remove`) et `to_16k_mono` pour
// préparer un son capté à une autre fréquence.
//
// - Les modèles (~700 Mo) ne sont téléchargés qu'au clic sur « Télécharger »
//   (Réglages), depuis des adresses à révision fixe, taille et SHA-256 vérifiés
//   (speech_models.rs). Ensuite, plus rien ne part sur Internet.
// - Le moteur (sherpa-onnx, onnxruntime compris) est lié dans ondine.exe, sous
//   Windows seulement (Cargo.toml : dépendance de la cible Windows). Ailleurs
//   (tests sous Linux), `ready()` est toujours faux et la transcription répond
//   une erreur claire.
// - Le modèle est chargé au premier usage (~2 s, ~700 Mo de mémoire), puis
//   libéré après 5 minutes sans servir.
// - Les calculs sans modèle (rééchantillonnage, découpage, mots, tours de
//   parole) sont dans speech_audio.rs, testés sous Linux.
//
// Rien de ce qui est dit n'est écrit sur le disque ni dans le journal.

// `transcribe_speakers` et `Turn` servent aux notes d'appel (autre branche de
// la 1.2.4) : ils existent avant leur premier appel.
#![allow(dead_code)]

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::speech_audio as audio;
use super::speech_models as models;

pub use super::speech_audio::to_16k_mono;

/// Tous les modèles travaillent en 16 kHz, mono, échantillons f32 entre -1 et 1.
pub const SAMPLE_RATE: u32 = 16_000;

/// Un tour de parole d'un appel : qui parle (0, 1, 2… dans l'ordre d'apparition), quand, et quoi.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub speaker: usize,
    /// Début et fin, en secondes depuis le début de l'audio donné.
    pub start: f32,
    pub end: f32,
    pub text: String,
}

/// Le moteur est-il compilé dans cette version d'Ondine ?
pub const SUPPORTED: bool = cfg!(windows);

/// L'événement envoyé au front à chaque changement (progrès, fin, suppression).
pub const EVENT: &str = "speech-models";

/// La phrase quand le modèle manque (reprise par les modules qui l'appellent).
pub const MISSING: &str = "La reconnaissance sur le PC a besoin du modèle Parakeet (environ 700 Mo, une seule fois) : téléchargez-le dans les Réglages.";
const ONLY_WINDOWS: &str = "La reconnaissance sur le PC n'existe que dans Ondine pour Windows.";

/// Les modèles sont-ils téléchargés et le moteur disponible ?
pub fn ready() -> bool {
    SUPPORTED && models::PARAKEET.is_present()
}

/// L'état pour les Réglages : absent, en cours (octets), prêt, raté.
pub fn status() -> models::Status {
    models::status(SUPPORTED, engine::loaded())
}

/// Écrit en texte un morceau d'audio (16 kHz mono). `lang` : "fr", "en"… ou
/// None. Parakeet v3 reconnaît seul la langue parlée parmi ses 25 : `lang`
/// est gardé pour le contrat (un autre modèle pourrait s'en servir).
pub fn transcribe(samples: &[f32], _lang: Option<&str>) -> Result<String, String> {
    check()?;
    Ok(engine::words(samples)?.0)
}

/// Écrit un long enregistrement en séparant les voix (notes d'appel). Sans
/// les modèles de séparation, ou si elle échoue, tout est la voix 0.
pub fn transcribe_speakers(samples: &[f32], _lang: Option<&str>) -> Result<Vec<Turn>, String> {
    check()?;
    let (_, words) = engine::words(samples)?;
    let segments = if models::DIARIZER.is_present() { engine::segments(samples) } else { Vec::new() };
    Ok(audio::group_turns(&words, &segments))
}

fn check() -> Result<(), String> {
    if !SUPPORTED {
        return Err(ONLY_WINDOWS.into());
    }
    if !models::PARAKEET.is_present() {
        return Err(MISSING.into());
    }
    Ok(())
}

/// Lance le téléchargement (au clic seulement) ; le progrès arrive par l'événement `speech-models`.
pub fn download(app: &AppHandle) -> Result<(), String> {
    if !SUPPORTED {
        return Err(ONLY_WINDOWS.into());
    }
    let app = app.clone();
    models::start_download(move || {
        let _ = app.emit(EVENT, status());
    });
    Ok(())
}

/// Arrête le téléchargement en cours.
pub fn cancel() {
    models::cancel();
}

/// Supprime les modèles (et libère la mémoire).
pub fn remove(app: &AppHandle) -> Result<(), String> {
    engine::unload();
    let result = models::remove();
    let _ = app.emit(EVENT, status());
    result
}

// ── Commandes Tauri (bloc des Réglages, src/settings/voice/parakeet-block.ts) ──

#[tauri::command]
pub fn speech_status() -> models::Status {
    status()
}

#[tauri::command]
pub fn speech_download(app: AppHandle) -> Result<models::Status, String> {
    download(&app)?;
    Ok(status())
}

#[tauri::command]
pub fn speech_cancel() -> models::Status {
    cancel();
    status()
}

#[tauri::command]
pub fn speech_remove(app: AppHandle) -> Result<models::Status, String> {
    remove(&app)?;
    Ok(status())
}

// ── Le moteur (Windows) ───────────────────────────────────────────────────────

#[cfg(windows)]
mod engine {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig, OfflineTransducerModelConfig};

    use super::super::speech_audio::{self as audio, Segment, TimedWord};
    use super::super::speech_models::{DIARIZER, PARAKEET};
    use super::SAMPLE_RATE;
    use crate::services::log;
    use crate::sync::LockExt;

    /// Libéré après ce temps sans servir (la mémoire revient à Windows).
    const IDLE: Duration = Duration::from_secs(5 * 60);

    static SLOT: Mutex<Option<Arc<OfflineRecognizer>>> = Mutex::new(None);
    /// Un seul chargement à la fois (jamais deux fois 700 Mo).
    static LOAD: Mutex<()> = Mutex::new(());
    /// Une transcription à la fois (dictée et notes d'appel ne se marchent pas dessus).
    static DECODE: Mutex<()> = Mutex::new(());
    static LAST_USE: Mutex<Option<Instant>> = Mutex::new(None);
    static REAPER: AtomicBool = AtomicBool::new(false);

    fn threads() -> i32 {
        std::thread::available_parallelism().map(|n| n.get().clamp(1, 4) as i32).unwrap_or(2)
    }

    pub fn loaded() -> bool {
        SLOT.locked().is_some()
    }

    pub fn unload() {
        if SLOT.locked().take().is_some() {
            log::info("reconnaissance sur le PC : modèle libéré");
        }
    }

    /// Le modèle chargé, ou chargé maintenant.
    fn recognizer() -> Result<Arc<OfflineRecognizer>, String> {
        if let Some(r) = SLOT.locked().clone() {
            return Ok(r);
        }
        let _guard = LOAD.locked();
        if let Some(r) = SLOT.locked().clone() {
            return Ok(r);
        }
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.transducer = OfflineTransducerModelConfig {
            encoder: Some(PARAKEET.path("encoder.int8.onnx")),
            decoder: Some(PARAKEET.path("decoder.int8.onnx")),
            joiner: Some(PARAKEET.path("joiner.int8.onnx")),
        };
        config.model_config.tokens = Some(PARAKEET.path("tokens.txt"));
        config.model_config.model_type = Some("nemo_transducer".into());
        config.model_config.num_threads = threads();
        let started = Instant::now();
        let r = OfflineRecognizer::create(&config).map(Arc::new).ok_or_else(|| {
            log::warn("reconnaissance sur le PC : le modèle n'a pas pu être chargé");
            "Le modèle Parakeet n'a pas pu être chargé : supprimez-le puis téléchargez-le de nouveau dans les Réglages.".to_string()
        })?;
        log::info(format!("reconnaissance sur le PC : modèle chargé en {} ms", started.elapsed().as_millis()));
        *SLOT.locked() = Some(r.clone());
        touch();
        spawn_reaper();
        Ok(r)
    }

    fn touch() {
        *LAST_USE.locked() = Some(Instant::now());
    }

    /// Un fil qui libère le modèle après `IDLE` sans servir, puis s'arrête
    /// (le prochain chargement en relance un).
    fn spawn_reaper() {
        if REAPER.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::spawn(|| {
            loop {
                std::thread::sleep(Duration::from_secs(20));
                if SLOT.locked().is_none() {
                    break;
                }
                let idle = LAST_USE.locked().map(|t| t.elapsed() >= IDLE).unwrap_or(true);
                // Jamais pendant une transcription (son verrou est pris).
                if idle {
                    if let Ok(_free) = DECODE.try_lock() {
                        unload();
                        break;
                    }
                }
            }
            REAPER.store(false, Ordering::SeqCst);
            // Rechargé pendant qu'on s'arrêtait : un nouveau fil veille.
            if SLOT.locked().is_some() {
                spawn_reaper();
            }
        });
    }

    /// Le texte et chaque mot avec son moment.
    pub fn words(samples: &[f32]) -> Result<(String, Vec<TimedWord>), String> {
        if samples.len() < (SAMPLE_RATE as usize) / 4 {
            return Ok((String::new(), Vec::new()));
        }
        let rec = recognizer()?;
        let _busy = DECODE.locked();
        touch();
        let mut text = String::new();
        let mut words = Vec::new();
        for (offset, chunk) in audio::split_for_model(samples, SAMPLE_RATE, audio::MAX_CHUNK_SECONDS) {
            if chunk.len() < (SAMPLE_RATE as usize) / 4 {
                continue;
            }
            let stream = rec.create_stream();
            stream.accept_waveform(SAMPLE_RATE as i32, chunk);
            rec.decode(&stream);
            let Some(result) = stream.get_result() else { continue };
            let start = offset as f32 / SAMPLE_RATE as f32;
            let length = chunk.len() as f32 / SAMPLE_RATE as f32;
            words.extend(audio::words_from_tokens(&result.tokens, result.timestamps.as_deref().unwrap_or(&[]), start, length));
            let t = result.text.trim();
            if !t.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(t);
            }
        }
        touch();
        Ok((text, words))
    }

    /// Qui parle quand (vide si ça n'a pas marché ou si c'est trop court).
    pub fn segments(samples: &[f32]) -> Vec<Segment> {
        if samples.len() < SAMPLE_RATE as usize * 2 {
            return Vec::new();
        }
        let mut config = OfflineSpeakerDiarizationConfig::default();
        config.segmentation.pyannote.model = Some(DIARIZER.path("segmentation.int8.onnx"));
        config.segmentation.num_threads = threads();
        config.embedding.model = Some(DIARIZER.path("embedding.onnx"));
        config.embedding.num_threads = threads();
        // Nombre de voix inconnu : le seuil décide. Plus haut que 0,5 par
        // défaut, pour ne pas couper une même voix en deux au fil d'un appel.
        config.clustering.num_clusters = -1;
        config.clustering.threshold = 0.7;
        let Some(d) = OfflineSpeakerDiarization::create(&config) else {
            log::warn("reconnaissance sur le PC : la séparation des voix n'a pas pu être chargée");
            return Vec::new();
        };
        let Some(result) = d.process(samples) else { return Vec::new() };
        result.sort_by_start_time().into_iter().map(|s| Segment { speaker: s.speaker, start: s.start, end: s.end }).collect()
    }
}

/// Sans moteur (Linux, tests) : jamais prêt.
#[cfg(not(windows))]
mod engine {
    use super::super::speech_audio::{Segment, TimedWord};

    pub fn loaded() -> bool {
        false
    }

    pub fn unload() {}

    pub fn words(_samples: &[f32]) -> Result<(String, Vec<TimedWord>), String> {
        Err(super::ONLY_WINDOWS.into())
    }

    pub fn segments(_samples: &[f32]) -> Vec<Segment> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_contract_holds_without_the_engine() {
        assert_eq!(SAMPLE_RATE, 16_000);
        if !SUPPORTED {
            assert!(!ready());
            assert!(transcribe(&[0.0; 16_000], Some("fr")).is_err());
            assert!(transcribe_speakers(&[0.0; 16_000], None).is_err());
            assert!(!status().supported);
        }
        // La forme envoyée au front.
        let t = Turn { speaker: 1, start: 0.5, end: 1.0, text: "Bonjour".into() };
        assert_eq!(serde_json::to_value(&t).unwrap(), serde_json::json!({ "speaker": 1, "start": 0.5, "end": 1.0, "text": "Bonjour" }));
        let s = serde_json::to_value(status()).unwrap();
        for key in ["state", "done", "total", "error", "supported", "loaded"] {
            assert!(s.get(key).is_some(), "{key}");
        }
    }
}
