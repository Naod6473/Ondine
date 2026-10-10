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
// Le tempo (commande "tempo" {on}, message "media.tempo") : pendant que la
// mascotte danse, un fil lit le niveau de ce qui sort des haut-parleurs ~100
// fois par seconde (50 en économie d'énergie ; un seul nombre à chaque fois,
// jamais le son), en déduit le tempo et la place des temps (media_tempo.rs)
// et publie une fois par seconde {bpm, phase, confidence, energy} (ou
// {bpm: null} quand le rythme est perdu). Le front redit « on » toutes les
// 10 s : sans nouvelle depuis 30 s, ou module coupé, le fil s'arrête. Un
// nouveau morceau repart de zéro. Rien n'est gardé au-delà de 8 secondes.
//
// "media.pause" (bus) met en pause ce qui joue : l'Agenda le demande quand
// vous rejoignez une réunion. Rien ne repart si c'était déjà en pause.
//
// Rien n'est envoyé hors de l'ordinateur ni écrit dans le journal.

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::media_tempo::TempoTracker;
use super::{ModuleContext, RustModule};
use crate::platform::media::{self, Control, NowPlaying};
use crate::services::bus::BusMessage;
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

/// Sans nouvelle « on » du front depuis ce délai, le fil du tempo s'arrête.
const TEMPO_KEEPALIVE: Duration = Duration::from_secs(30);

/// Le fil du tempo : voulu jusqu'à quand, en marche ou non, et le numéro du morceau (pour repartir de zéro).
#[derive(Default)]
struct TempoCtl {
    until: Mutex<Option<Instant>>,
    running: AtomicBool,
    track: AtomicU64,
}

#[derive(Default)]
pub struct Media {
    state: Arc<Mutex<State>>,
    tempo: Arc<TempoCtl>,
}

impl RustModule for Media {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/media/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, state, tempo) = (app.clone(), self.state.clone(), self.tempo.clone());
        std::thread::spawn(move || watch(app, state, tempo));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // { on: bool } : la mascotte danse (ou plus) ; à redire toutes les 10 s.
            "tempo" => {
                // Réglage « Danser au tempo de la musique » décoché : jamais.
                let allowed = ctx.settings().get("danceTempo").and_then(Value::as_bool).unwrap_or(true);
                let on = allowed && args.get("on").and_then(Value::as_bool).unwrap_or(false);
                *self.tempo.until.locked() = on.then(|| Instant::now() + TEMPO_KEEPALIVE);
                if on && !self.tempo.running.swap(true, Ordering::SeqCst) {
                    let (app, tempo) = (ctx.app.clone(), self.tempo.clone());
                    std::thread::spawn(move || listen_tempo(app, tempo));
                }
                Ok(Value::Null)
            }
            "state" => Ok(payload(&self.state.locked())),
            "artwork" => Ok(json!({ "url": self.state.locked().artwork })),
            "toggle" => media::control(Control::TogglePlayPause).map(|_| Value::Null),
            "next" => media::control(Control::Next).map(|_| Value::Null),
            "previous" => media::control(Control::Previous).map(|_| Value::Null),
            "seek" => media::control(Control::Seek(seek_target(&args)?)).map(|_| Value::Null),
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// "media.pause" : un autre module demande le silence (l'Agenda, quand
    /// vous rejoignez une réunion). Seulement si quelque chose joue : une
    /// musique déjà en pause ne repart jamais.
    fn on_event(&self, _ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic != "media.pause" {
            return;
        }
        let playing = self.state.locked().current.as_ref().is_some_and(|p| p.status == "playing");
        if !playing {
            return;
        }
        // Dans un fil à part : le message peut arriver par le fil de l'interface,
        // qu'on ne bloque pas le temps que Windows réponde.
        let who = msg.source.clone();
        std::thread::spawn(move || {
            media::init_thread();
            if let Err(e) = media::control(Control::Pause) {
                log::warn(format!("musique : pause demandée par {who} : {e}"));
            }
        });
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
fn watch(app: AppHandle, state: Arc<Mutex<State>>, tempo: Arc<TempoCtl>) {
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
            if update(&app, &state, m, now) {
                // Nouveau morceau : le tempo repart de zéro.
                tempo.track.fetch_add(1, Ordering::Relaxed);
            }
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

/// Compare avec l'état précédent et publie si quelque chose a changé ; vrai si c'est un nouveau morceau.
fn update(app: &AppHandle, state: &Arc<Mutex<State>>, manager: &media::Manager, now: Option<NowPlaying>) -> bool {
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
        return false;
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
    new_track
}

/// Le fil du tempo : lit le niveau des haut-parleurs, publie le tempo une fois
/// par seconde, s'arrête quand plus personne ne le demande.
fn listen_tempo(app: AppHandle, tempo: Arc<TempoCtl>) {
    /// Remet `running` à faux en partant, même après une panique.
    struct Done(Arc<TempoCtl>);
    impl Drop for Done {
        fn drop(&mut self) {
            self.0.running.store(false, Ordering::SeqCst);
        }
    }
    let _done = Done(tempo.clone());
    let eco = |m: perf::Mode| m == perf::Mode::Eco;
    let mut fs_eco = eco(perf::mode());
    let mut tracker = TempoTracker::new(if fs_eco { 50.0 } else { 100.0 });
    let mut meter = crate::platform::halos::Meter::new(crate::platform::halos::Device::Speakers);
    let mut track = tempo.track.load(Ordering::Relaxed);
    let mut said = Instant::now();
    let mut had = false;
    loop {
        let wanted = tempo.until.locked().is_some_and(|t| Instant::now() < t);
        if !wanted || !super::is_active(&app, ID) {
            break;
        }
        // Le mode de performance a changé : on repart au bon rythme.
        if eco(perf::mode()) != fs_eco {
            fs_eco = !fs_eco;
            tracker = TempoTracker::new(if fs_eco { 50.0 } else { 100.0 });
        }
        let now_track = tempo.track.load(Ordering::Relaxed);
        if now_track != track {
            track = now_track;
            tracker.reset();
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            tracker.push(meter.read().unwrap_or(0.0));
            if said.elapsed() >= Duration::from_secs(1) {
                said = Instant::now();
                match tracker.update() {
                    Some(t) => {
                        had = true;
                        let round = |v: f32, k: f32| (v * k).round() / k;
                        bus::emit(
                            &app,
                            ID,
                            "media.tempo",
                            json!({ "bpm": round(t.bpm, 10.0), "phase": round(t.phase, 1000.0), "confidence": round(t.confidence, 100.0), "energy": round(t.energy, 100.0) }),
                        );
                    }
                    None if had => {
                        had = false;
                        bus::emit(&app, ID, "media.tempo", json!({ "bpm": null }));
                    }
                    None => {}
                }
            }
        }));
        if step.is_err() {
            log::warn("musique : erreur inattendue dans le tempo, on repart de zéro");
            tracker.reset();
        }
        std::thread::sleep(Duration::from_millis(if fs_eco { 20 } else { 10 }));
    }
    if had {
        bus::emit(&app, ID, "media.tempo", json!({ "bpm": null }));
    }
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
            genre: String::new(),
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
