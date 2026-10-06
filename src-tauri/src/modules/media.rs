// Module « Musique » : ce qui joue en ce moment (Spotify, navigateur, VLC…),
// avec lecture/pause, suivant et précédent.
//
// Un thread regarde l'état du lecteur une fois par seconde (platform::media) et
// publie "media.changed" sur le bus seulement quand quelque chose change :
// titre, état, boutons disponibles, ou un saut dans la position (on a avancé
// dans le morceau). Entre deux messages, le front fait avancer la barre de
// progression tout seul.
//
// La pochette n'est pas dans le message (le bus limite la taille à 64 Ko) : le
// message donne un numéro `artwork`, et le front la demande avec la commande
// "artwork" quand ce numéro change.
//
// Rien n'est envoyé hors de l'ordinateur ni écrit dans le journal.

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform::media::{self, Control, NowPlaying};
use crate::services::{bus, log};
use crate::services::perf::{self, Loop};

const ID: &str = "media";
/// Un écart plus grand entre la position attendue et la vraie = on a avancé ou reculé.
const SEEK_TOLERANCE_MS: u64 = 2_500;

#[derive(Default)]
struct State {
    /// Le dernier état publié (None = rien en lecture).
    current: Option<NowPlaying>,
    /// Numéro de la pochette : change à chaque nouveau morceau.
    artwork_id: u64,
    /// La pochette du morceau en cours, déjà prête à afficher (data URL).
    artwork: Option<String>,
}

#[derive(Default)]
pub struct Media {
    state: Arc<Mutex<State>>,
}

impl RustModule for Media {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/media/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || watch(app, state));
    }

    fn invoke(&self, _ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "state" => Ok(payload(&self.state.locked())),
            "artwork" => Ok(json!({ "url": self.state.locked().artwork })),
            "toggle" => media::control(Control::TogglePlayPause).map(|_| Value::Null),
            "next" => media::control(Control::Next).map(|_| Value::Null),
            "previous" => media::control(Control::Previous).map(|_| Value::Null),
            "seek" => media::control(Control::Seek(seek_target(&args)?)).map(|_| Value::Null),
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// La position demandée par le front (`{ "positionMs": 83000 }`), vérifiée :
/// un nombre positif, au plus 24 h (aucun morceau n'est plus long).
fn seek_target(args: &Value) -> Result<u64, String> {
    const MAX_MS: u64 = 24 * 60 * 60 * 1000;
    match args.get("positionMs").and_then(Value::as_u64) {
        Some(ms) if ms <= MAX_MS => Ok(ms),
        _ => Err("position invalide".into()),
    }
}

/// Ce que le front reçoit (message "media.changed" et commande "state").
fn payload(state: &State) -> Value {
    json!({ "playing": state.current, "artwork": state.artwork_id })
}

/// La boucle du thread : une fois par seconde (selon le mode de performance :
/// services/perf.rs), tant que l'île tourne.
fn watch(app: AppHandle, state: Arc<Mutex<State>>) {
    media::init_thread();
    let mut manager = None;
    let mut last_error = String::new();
    loop {
        std::thread::sleep(perf::every(Loop::Media));

        // Module désactivé (ou mis à l'écart) : on ne regarde rien.
        if !super::is_active(&app, ID) {
            if state.locked().current.take().is_some() {
                bus::emit(&app, ID, "media.changed", payload(&state.locked()));
            }
            manager = None;
            continue;
        }

        // Une panique ici ne doit pas tuer le thread (ni l'île) : on la note et on continue.
        let step = catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
            if manager.is_none() {
                manager = Some(media::manager()?);
            }
            let m = manager.as_ref().unwrap();
            let now = media::now_playing(m)?;
            update(&app, &state, m, now);
            Ok(())
        }));
        let error = match step {
            Ok(Ok(())) => String::new(),
            Ok(Err(e)) => e,
            Err(_) => "panique pendant la lecture de l'état du lecteur".into(),
        };
        if !error.is_empty() {
            // On repartira d'un gestionnaire neuf au prochain tour.
            manager = None;
            // Une seule ligne de journal par erreur différente, pas une par seconde.
            if error != last_error {
                log::warn(format!("musique : {error}"));
            }
        }
        last_error = error;
    }
}

/// Compare avec l'état précédent et publie si quelque chose a changé.
fn update(app: &AppHandle, state: &Arc<Mutex<State>>, manager: &media::Manager, now: Option<NowPlaying>) {
    let (new_track, publish) = {
        let s = state.locked();
        let new_track = match (&s.current, &now) {
            (Some(a), Some(b)) => a.app != b.app || a.title != b.title || a.artist != b.artist || a.album != b.album,
            (None, None) => false,
            _ => true,
        };
        (new_track, new_track || differs(&s.current, &now))
    };
    if !publish {
        return;
    }
    // Nouveau morceau : on lit sa pochette (hors du verrou, ça peut prendre un instant).
    let artwork = if new_track && now.is_some() { read_artwork(manager) } else { None };

    let mut s = state.locked();
    if new_track {
        s.artwork_id += 1;
        s.artwork = artwork;
    }
    s.current = now;
    bus::emit(app, ID, "media.changed", payload(&s));
}

/// Même morceau : y a-t-il un changement qui mérite un message ?
fn differs(before: &Option<NowPlaying>, now: &Option<NowPlaying>) -> bool {
    let (Some(a), Some(b)) = (before, now) else { return false };
    if a.status != b.status || a.can_toggle != b.can_toggle || a.can_next != b.can_next || a.can_previous != b.can_previous || a.can_seek != b.can_seek {
        return true;
    }
    if a.duration_ms != b.duration_ms {
        return true;
    }
    // Position : on attend environ +1 s par tour si ça joue. Un gros écart = saut.
    match (a.position_ms, b.position_ms) {
        (Some(pa), Some(pb)) => {
            let expected = if b.status == "playing" { pa + 1_000 } else { pa };
            pb.abs_diff(expected) > SEEK_TOLERANCE_MS
        }
        _ => false,
    }
}

/// La pochette en data URL (« data:image/png;base64,… »), ou None.
fn read_artwork(manager: &media::Manager) -> Option<String> {
    match media::artwork(manager) {
        Ok(Some((bytes, mime))) => {
            // On n'accepte que des types d'image connus : ce texte finit dans un <img>.
            let mime = match mime.as_str() {
                "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp" => mime,
                _ => "image/jpeg".to_string(),
            };
            Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
        }
        Ok(None) => None,
        Err(e) => {
            log::debug(format!("musique : {e}"));
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(status: &'static str, pos: u64) -> Option<NowPlaying> {
        Some(NowPlaying {
            app: "Spotify.exe".into(),
            title: "Titre".into(),
            artist: "Artiste".into(),
            album: "Album".into(),
            status,
            position_ms: Some(pos),
            duration_ms: Some(200_000),
            can_toggle: true,
            can_next: true,
            can_previous: true,
            can_seek: true,
        })
    }

    #[test]
    fn normal_progress_is_not_a_change() {
        assert!(!differs(&song("playing", 10_000), &song("playing", 11_000)));
        assert!(!differs(&song("paused", 10_000), &song("paused", 10_000)));
    }

    #[test]
    fn seek_target_is_checked() {
        assert_eq!(seek_target(&json!({ "positionMs": 83_000 })), Ok(83_000));
        assert!(seek_target(&json!({ "positionMs": -5 })).is_err());
        assert!(seek_target(&json!({ "positionMs": "12" })).is_err());
        assert!(seek_target(&json!({})).is_err());
        assert!(seek_target(&json!({ "positionMs": 90_000_000 })).is_err());
    }

    #[test]
    fn pause_and_seek_are_changes() {
        assert!(differs(&song("playing", 10_000), &song("paused", 11_000)));
        assert!(differs(&song("playing", 10_000), &song("playing", 60_000)));
    }
}
