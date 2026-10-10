// « Parler à Ondine » à voix haute : le raccourci, l'écoute, la transcription.
//
// Un raccourci global (réglage « voiceHotkey », Ctrl+Alt+V par défaut)
// ouvre Parler à Ondine et écoute. Deux façons (réglage « micMode ») :
//   - « once » : appuyer une fois, l'écoute s'arrête au silence (ou au 2e appui) ;
//   - « hold » : maintenir les touches, l'écoute s'arrête au relâchement.
// Échap annule (raccourci global posé seulement pendant l'écoute). Le 2e
// raccourci (« lookHotkey », « Regarde ça ») fait pareil, après avoir pris une
// image de la fenêtre active : elle est jointe à la question, montrée avant
// l'envoi (elle ne part qu'au clic sur « Envoyer »).
//
// La reconnaissance (réglage « voiceEngine ») :
//   - « windows » (par défaut) : la dictée de Windows (platform/voice.rs).
//     Sous-titres en direct. Windows passe par son service en ligne ;
//   - « api » : le micro est capté en mémoire (WASAPI), puis l'audio part
//     vers OpenAI (audio/transcriptions) ou Gemini (audio en entrée), avec la
//     clé déjà rangée. Claude n'écoute pas l'audio : avec Claude, on prend la
//     clé OpenAI, sinon Gemini, sinon on le dit. Si personne n'a parlé, rien
//     ne part.
// Rien n'est jamais écrit sur le disque, ni noté dans le journal (seulement
// « écoute : N caractères »).
//
// Discrétion (réglage « discreet », activé par défaut) : en visio (le micro
// est déjà pris par une autre appli), en présentation ou en concentration
// (Pomodoro « timer.focus », agents « agents.quiet »), le micro ne s'ouvre
// pas et l'île le dit.
//
// Ce qui est publié sur le bus :
//   - `voice.listening {on, look}` : début / fin de l'écoute (le halo, la mascotte) ;
//   - `voice.level {level}` : le niveau du micro, 0..1, ~15 fois par seconde ;
//   - `askclaude.voice {kind, …}` pour le front du module : `open {look, hold}`,
//     `partial {text}`, `transcribing`, `final {text, look}`, `empty`,
//     `cancel`, `blocked {why}`, `error {message}`.

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::askclaude_providers::{self as providers, Provider};
use crate::platform::{self, voice};
use crate::services::log;

const ID: &str = "askclaude";
/// Les raccourcis proposés (les autres valeurs sont refusées).
pub const HOTKEYS: &[&str] = &["Ctrl+Alt+V", "Alt+Shift+V", "Ctrl+Alt+Enter"];
pub const LOOK_HOTKEYS: &[&str] = &["Ctrl+Alt+G", "Alt+Shift+G"];
const DEFAULT_HOTKEY: &str = "Ctrl+Alt+V";
/// On abandonne si personne ne parle dans ce délai (mains libres : plus court).
const INITIAL_SILENCE_MS: i64 = 6000;
const HANDS_FREE_SILENCE_MS: i64 = 4000;
/// Une écoute dure au plus ça (« hold » : la touche peut rester tenue).
const MAX_ONCE: Duration = Duration::from_secs(30);
const MAX_HOLD: Duration = Duration::from_secs(60);
/// Le niveau part au plus ~15 fois par seconde.
const LEVEL_EVERY: Duration = Duration::from_millis(66);
/// Le modèle de transcription d'OpenAI.
const OPENAI_STT_MODEL: &str = "gpt-4o-mini-transcribe";
/// Une image de la fenêtre active : son plus grand côté, au plus.
const LOOK_MAX_SIDE: u32 = 1600;

/// L'écoute en cours (une seule à la fois).
struct Session {
    stop: AtomicU8,
    hold: bool,
    started: Instant,
}

static SESSION: Mutex<Option<Arc<Session>>> = Mutex::new(None);
/// Les raccourcis enregistrés auprès de Windows (voix, regarde ça).
static REGISTERED: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));
/// L'image de la fenêtre active prise par « Regarde ça » (nom, PNG en base64),
/// reprise par `prepare {look: true}`. En mémoire seulement.
static LOOK: Mutex<Option<(String, String)>> = Mutex::new(None);
/// Concentration en cours (Pomodoro, agents) : sujets du bus suivis par `on_event`.
static FOCUS: AtomicBool = AtomicBool::new(false);
static QUIET: AtomicBool = AtomicBool::new(false);
/// Numéro de la dernière écoute (une écoute finie n'efface pas la suivante).
static NEXT: AtomicU64 = AtomicU64::new(0);

/// Comment écouter.
#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub look: bool,
    pub hold: bool,
    /// Mains libres (le micro se rallume après une réponse) : abandon plus rapide.
    pub hands_free: bool,
}

fn emit(app: &AppHandle, topic: &str, payload: Value) {
    super::with_context(app, ID, |ctx| ctx.emit(topic, payload));
}

fn voice_event(app: &AppHandle, kind: &str, mut extra: Value) {
    extra["kind"] = json!(kind);
    emit(app, "askclaude.voice", extra);
}

fn settings(app: &AppHandle) -> serde_json::Map<String, Value> {
    super::with_context(app, ID, |ctx| ctx.settings()).unwrap_or_default()
}

fn hold_mode(s: &serde_json::Map<String, Value>) -> bool {
    s.get("micMode").and_then(Value::as_str) == Some("hold")
}

/// Le fil de fond : toutes les secondes, les raccourcis suivent les réglages
/// (et le module activé).
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2)); // le temps que les réglages soient chargés
        loop {
            let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let (voice, look) = if super::is_active(&app, ID) {
                    let s = settings(&app);
                    let pick = |key: &str, default: &str, list: &[&str]| {
                        let v = s.get(key).and_then(Value::as_str).unwrap_or(default);
                        if list.contains(&v) { v.to_string() } else { String::new() }
                    };
                    (pick("voiceHotkey", DEFAULT_HOTKEY, HOTKEYS), pick("lookHotkey", "", LOOK_HOTKEYS))
                } else {
                    (String::new(), String::new())
                };
                apply_hotkeys(&app, &voice, &look);
            }));
            if step.is_err() {
                log::warn("parler à Ondine : erreur inattendue avec les raccourcis, on réessaie");
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

/// Enregistre (ou retire) les deux raccourcis s'ils ont changé.
fn apply_hotkeys(app: &AppHandle, voice: &str, look: &str) {
    let mut guard = REGISTERED.locked();
    let reg = &mut *guard;
    let gs = app.global_shortcut();
    for (current, wanted, is_look) in [(&mut reg.0, voice, false), (&mut reg.1, look, true)] {
        if current.as_str() == wanted {
            continue;
        }
        if !current.is_empty() {
            let _ = gs.unregister(current.as_str());
        }
        *current = wanted.to_string();
        if wanted.is_empty() {
            continue;
        }
        let result = gs.on_shortcut(wanted, move |app, _shortcut, event| {
            let app = app.clone();
            let pressed = event.state == ShortcutState::Pressed;
            // Le gestionnaire tourne sur le thread principal : on ne le bloque pas.
            std::thread::spawn(move || on_hotkey(&app, is_look, pressed));
        });
        if let Err(e) = result {
            let text = e.to_string();
            let pretty = wanted.replace("Shift", "Maj").replace("Enter", "Entrée");
            let msg = if text.contains("already registered") {
                format!("{pretty} est déjà pris par un autre logiciel : choisissez un autre raccourci dans les réglages de Parler à Ondine")
            } else {
                format!("le raccourci {pretty} est refusé : {text}")
            };
            log::warn(format!("parler à Ondine : {msg}"));
            voice_event(app, "error", json!({ "message": msg }));
        }
    }
}

/// Le raccourci est pressé ou relâché.
fn on_hotkey(app: &AppHandle, look: bool, pressed: bool) {
    let current = SESSION.locked().clone();
    match (current, pressed) {
        // Pendant l'écoute : relâcher (« hold ») ou appuyer une 2e fois (« once ») termine.
        (Some(s), false) if s.hold => s.stop.store(voice::FINISH, Ordering::SeqCst),
        (Some(s), true) if !s.hold && s.started.elapsed() > Duration::from_millis(400) => s.stop.store(voice::FINISH, Ordering::SeqCst),
        (None, true) => {
            let hold = hold_mode(&settings(app));
            if let Err(e) = listen(app, Options { look, hold, hands_free: false }) {
                voice_event(app, "error", json!({ "message": e }));
            }
        }
        _ => {}
    }
}

/// Termine (FINISH) ou annule (CANCEL) l'écoute en cours.
pub fn stop(cancel: bool) {
    if let Some(s) = SESSION.locked().as_ref() {
        s.stop.store(if cancel { voice::CANCEL } else { voice::FINISH }, Ordering::SeqCst);
    }
}

/// Une écoute est-elle en cours ?
pub fn listening() -> bool {
    SESSION.locked().is_some()
}

/// Suit la concentration (sujets du bus écoutés par le module).
pub fn on_event(topic: &str, payload: &Value) {
    let on = payload.get("on").and_then(Value::as_bool).unwrap_or(false);
    match topic {
        "timer.focus" => FOCUS.store(on, Ordering::SeqCst),
        "agents.quiet" => QUIET.store(on, Ordering::SeqCst),
        _ => {}
    }
}

/// Pourquoi rester discrète maintenant (visio, présentation, concentration),
/// si le réglage « discreet » est activé.
pub fn discreet(app: &AppHandle) -> Option<&'static str> {
    if settings(app).get("discreet").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let mic: Vec<String> = platform::media_use::current().mic;
    why_discreet(&mic, platform::presentation_busy(), FOCUS.load(Ordering::SeqCst) || QUIET.load(Ordering::SeqCst))
}

/// La règle de discrétion (sans le système, pour les tests).
fn why_discreet(mic_users: &[String], presenting: bool, focus: bool) -> Option<&'static str> {
    if mic_users.iter().any(|a| !a.to_lowercase().contains("ondine")) {
        Some("call")
    } else if presenting {
        Some("presentation")
    } else if focus {
        Some("focus")
    } else {
        None
    }
}

/// Reprend l'image de « Regarde ça » (une seule fois).
pub fn take_look() -> Option<(String, String)> {
    LOOK.locked().take()
}

/// Ouvre le micro et écoute (dans un fil à part). Erreur si une écoute est
/// déjà en cours ou si le module est coupé ; `blocked` si discrétion.
pub fn listen(app: &AppHandle, opts: Options) -> Result<(), String> {
    if !super::is_active(app, ID) {
        return Err("le module Parler à Ondine est désactivé".into());
    }
    let session = {
        let mut cur = SESSION.locked();
        if cur.is_some() {
            return Err("Ondine écoute déjà".into());
        }
        if let Some(why) = discreet(app) {
            drop(cur);
            voice_event(app, "blocked", json!({ "why": why }));
            return Ok(());
        }
        let s = Arc::new(Session { stop: AtomicU8::new(0), hold: opts.hold, started: Instant::now() });
        *cur = Some(s.clone());
        s
    };
    // « Regarde ça » : la fenêtre active AVANT que l'île ne s'ouvre.
    let mut look = opts.look;
    if look {
        match look_capture() {
            Ok(img) => *LOOK.locked() = Some(img),
            Err(e) => {
                look = false;
                voice_event(app, "error", json!({ "message": e }));
            }
        }
    }
    let id = NEXT.fetch_add(1, Ordering::SeqCst) + 1;
    set_escape(app, true);
    emit(app, "voice.listening", json!({ "on": true, "look": look }));
    voice_event(app, "open", json!({ "look": look, "hold": opts.hold, "id": id }));
    let app2 = app.clone();
    std::thread::spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&app2, &session, opts)));
        set_escape(&app2, false);
        *SESSION.locked() = None;
        emit(&app2, "voice.level", json!({ "level": 0 }));
        emit(&app2, "voice.listening", json!({ "on": false, "look": look }));
        let cancelled = session.stop.load(Ordering::SeqCst) == voice::CANCEL;
        match outcome {
            _ if cancelled => voice_event(&app2, "cancel", json!({ "id": id })),
            Ok(Ok(text)) if text.trim().is_empty() => voice_event(&app2, "empty", json!({ "id": id })),
            Ok(Ok(text)) => {
                log::info(format!("parler à Ondine : écoute finie ({} caractères)", text.chars().count()));
                voice_event(&app2, "final", json!({ "text": text.trim(), "look": look, "id": id }));
            }
            Ok(Err(e)) => voice_event(&app2, "error", json!({ "message": e, "id": id })),
            Err(_) => voice_event(&app2, "error", json!({ "message": "erreur inattendue pendant l'écoute", "id": id })),
        }
    });
    Ok(())
}

/// Échap annule l'écoute : un raccourci global posé le temps de l'écoute.
fn set_escape(app: &AppHandle, on: bool) {
    let gs = app.global_shortcut();
    if on {
        let _ = gs.on_shortcut("Escape", |_app, _s, e| {
            if e.state == ShortcutState::Pressed {
                stop(true);
            }
        });
    } else {
        let _ = gs.unregister("Escape");
    }
}

/// L'écoute elle-même : renvoie le texte dit ("" si rien).
fn run(app: &AppHandle, s: &Session, opts: Options) -> Result<String, String> {
    let settings = settings(app);
    let lang = super::with_context(app, ID, |ctx| {
        use tauri::Manager;
        let shared = ctx.app.state::<crate::Shared>();
        let st = shared.settings.locked();
        crate::app_language(&st)
    })
    .unwrap_or("fr");
    let mut last_level = Instant::now() - LEVEL_EVERY;
    let mut level = |l: f32| {
        if last_level.elapsed() >= LEVEL_EVERY {
            last_level = Instant::now();
            emit(app, "voice.level", json!({ "level": (l.clamp(0.0, 1.0) * 100.0).round() / 100.0 }));
        }
    };
    let silence = if opts.hands_free { HANDS_FREE_SILENCE_MS } else { INITIAL_SILENCE_MS };
    let max = if opts.hold { MAX_HOLD } else { MAX_ONCE };
    // Un garde-fou : au-delà de la durée maximale, on termine.
    let started = Instant::now();
    if settings.get("voiceEngine").and_then(Value::as_str) == Some("api") {
        let (provider, key, model) = stt_key(app, &settings)?;
        let mut gate = SilenceGate::new(opts.hold, silence as u64);
        let pcm = voice::record(&s.stop, &mut |chunk, rate| {
            let rms = rms(chunk);
            level((rms * 6.0).sqrt().min(1.0));
            if started.elapsed() > max {
                return false;
            }
            gate.push(rms, chunk.len() as u64 * 1000 / u64::from(rate.max(1)))
        })?;
        if s.stop.load(Ordering::SeqCst) == voice::CANCEL || !gate.heard {
            return Ok(String::new()); // personne n'a parlé : rien ne part
        }
        voice_event(app, "transcribing", json!({}));
        let wav = wav_16k(&pcm.samples, pcm.rate);
        log::info(format!("parler à Ondine : audio envoyé à {} ({} octets)", provider.destination(), wav.len()));
        return transcribe(provider, &key, &model, &wav, lang);
    }
    let mut last_partial = String::new();
    let mut partial = |t: &str| {
        let t = t.trim();
        if t != last_partial {
            last_partial = t.to_string();
            voice_event(app, "partial", json!({ "text": t }));
        }
    };
    // Le garde-fou de durée tourne à côté de la dictée.
    let watchdog = {
        let stop = &s.stop;
        move || {
            if started.elapsed() > max {
                let _ = stop.compare_exchange(0, voice::FINISH, Ordering::SeqCst, Ordering::SeqCst);
            }
        }
    };
    let mut level_and_watch = |l: f32| {
        watchdog();
        level(l);
    };
    let tag = if lang == "en" { "en-US" } else { "fr-FR" };
    voice::dictate(tag, opts.hold, silence, voice::Listen { stop: &s.stop, partial: &mut partial, level: &mut level_and_watch })
}

// ── La transcription par l'API ───────────────────────────────────────────────

/// Le fournisseur, la clé et le modèle pour transcrire (Claude n'écoute pas l'audio).
fn stt_key(app: &AppHandle, settings: &serde_json::Map<String, Value>) -> Result<(Provider, String, String), String> {
    let chosen = Provider::from_id(settings.get("provider").and_then(Value::as_str).unwrap_or(""));
    let order: &[Provider] = match chosen {
        Provider::Gemini => &[Provider::Gemini],
        Provider::OpenAi => &[Provider::OpenAi],
        Provider::Claude => &[Provider::OpenAi, Provider::Gemini],
    };
    super::with_context(app, ID, |ctx| -> Result<(Provider, String, String), String> {
        ctx.require("claude-api")?;
        for &p in order {
            if let Some(key) = ctx.credential(p.credential_key())? {
                let model = match p {
                    Provider::Gemini => super::askclaude::model(ctx, p)?,
                    _ => OPENAI_STT_MODEL.to_string(),
                };
                return Ok((p, key, model));
            }
        }
        Err(match chosen {
            Provider::Claude => "Claude n'écoute pas l'audio : pour la transcription par l'API, ajoutez une clé OpenAI ou Gemini dans Réglages → Identifiants, ou choisissez la reconnaissance de Windows".into(),
            p => format!("pas de {} : ajoutez-la dans Réglages → Identifiants", p.key_label().to_lowercase()),
        })
    })
    .unwrap_or_else(|| Err("module indisponible".into()))
}

/// Envoie l'audio (WAV) et renvoie le texte.
fn transcribe(provider: Provider, key: &str, model: &str, wav: &[u8], lang: &str) -> Result<String, String> {
    match provider {
        Provider::Gemini => {
            let prompt = if lang == "en" {
                "Transcribe exactly what is said in this audio, in its language. Answer with the transcription only, nothing else. If nobody speaks, answer with nothing."
            } else {
                "Transcris exactement ce qui est dit dans cet audio, dans sa langue. Réponds seulement par la transcription, rien d'autre. Si personne ne parle, ne réponds rien."
            };
            let body = json!({
                "contents": [{ "role": "user", "parts": [
                    { "text": prompt },
                    { "inline_data": { "mime_type": "audio/wav", "data": base64::engine::general_purpose::STANDARD.encode(wav) } }
                ] }],
                "generationConfig": { "temperature": 0 }
            });
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
            let answer = providers::call(Provider::Gemini, key, &url, &body)?;
            Ok(answer["answer"].as_str().unwrap_or("").trim().to_string())
        }
        _ => {
            use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
                .http_status_as_error(false)
                .timeout_global(Some(Duration::from_secs(60)))
                .build()
                .into();
            let (boundary, body) = multipart(&[("model", model.as_bytes(), None), ("language", lang.as_bytes(), None), ("response_format", b"json", None), ("file", wav, Some("audio.wav"))]);
            let mut resp = agent
                .post("https://api.openai.com/v1/audio/transcriptions")
                .header("authorization", &format!("Bearer {key}"))
                .header("content-type", &format!("multipart/form-data; boundary={boundary}"))
                .send(&body[..])
                .map_err(|e| format!("impossible de joindre l'API : {e}"))?;
            let status = resp.status().as_u16();
            let v: Value = resp.body_mut().with_config().limit(1024 * 1024).read_json().map_err(|_| format!("réponse illisible de l'API (code {status})"))?;
            if status != 200 {
                return Err(providers::api_error(Provider::OpenAi, status, &v));
            }
            Ok(v["text"].as_str().unwrap_or("").trim().to_string())
        }
    }
}

/// Un corps multipart/form-data : (nom, contenu, nom de fichier éventuel).
fn multipart(parts: &[(&str, &[u8], Option<&str>)]) -> (String, Vec<u8>) {
    let boundary = format!("ondine-{:016x}", NEXT.load(Ordering::SeqCst).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0x5bd1_e995);
    let mut body = Vec::new();
    for (name, content, file) in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match file {
            Some(f) => body.extend_from_slice(format!("Content-Disposition: form-data; name=\"{name}\"; filename=\"{f}\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes()),
            None => body.extend_from_slice(format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes()),
        }
        body.extend_from_slice(content);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (boundary, body)
}

/// Le niveau moyen (RMS) d'un morceau de son.
fn rms(chunk: &[f32]) -> f32 {
    if chunk.is_empty() {
        return 0.0;
    }
    (chunk.iter().map(|v| v * v).sum::<f32>() / chunk.len() as f32).sqrt()
}

/// Décide quand la personne a fini de parler (capture pour l'API).
struct SilenceGate {
    hold: bool,
    /// Abandon si personne ne parle d'ici là (ms).
    initial_ms: u64,
    /// Le bruit de fond (le plus bas entendu), et le temps écoulé.
    floor: f32,
    elapsed_ms: u64,
    quiet_ms: u64,
    heard: bool,
}

impl SilenceGate {
    /// Fin de phrase : ce silence après avoir parlé.
    const END_MS: u64 = 1200;

    fn new(hold: bool, initial_ms: u64) -> SilenceGate {
        SilenceGate { hold, initial_ms, floor: 1.0, elapsed_ms: 0, quiet_ms: 0, heard: false }
    }

    /// Un morceau de `ms` millisecondes, de niveau `rms`. Faux = on s'arrête.
    fn push(&mut self, rms: f32, ms: u64) -> bool {
        self.elapsed_ms += ms;
        self.floor = self.floor.min(rms.max(0.0005));
        let speaking = rms > (self.floor * 3.0).max(0.015);
        if speaking {
            self.heard = true;
            self.quiet_ms = 0;
        } else {
            self.quiet_ms += ms;
        }
        if self.hold {
            return true; // seule la touche relâchée termine
        }
        if !self.heard {
            return self.elapsed_ms < self.initial_ms;
        }
        self.quiet_ms < Self::END_MS
    }
}

/// Le son en WAV mono 16 bits à 16 kHz (ce que les API préfèrent pour la voix).
fn wav_16k(samples: &[f32], rate: u32) -> Vec<u8> {
    const OUT: u32 = 16_000;
    let rate = rate.max(1);
    let n = (samples.len() as u64 * u64::from(OUT) / u64::from(rate)) as usize;
    let mut pcm = Vec::with_capacity(n * 2);
    for i in 0..n {
        // Moyenne des échantillons couverts par celui-ci (évite le crénelage le plus grossier).
        let a = (i as u64 * u64::from(rate) / u64::from(OUT)) as usize;
        let b = (((i + 1) as u64 * u64::from(rate) / u64::from(OUT)) as usize).clamp(a + 1, samples.len().max(a + 1));
        let slice = &samples[a.min(samples.len())..b.min(samples.len())];
        let v = if slice.is_empty() { 0.0 } else { slice.iter().sum::<f32>() / slice.len() as f32 };
        pcm.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&OUT.to_le_bytes());
    wav.extend_from_slice(&(OUT * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);
    wav
}

// ── « Regarde ça » ───────────────────────────────────────────────────────────

/// Une image PNG (base64) de la fenêtre active, réduite si besoin.
fn look_capture() -> Result<(String, String), String> {
    let area = voice::foreground_area().ok_or("pas de fenêtre à regarder : cliquez d'abord dans la fenêtre à montrer")?;
    let (w, h) = fit(area.width, area.height, LOOK_MAX_SIDE);
    let rgb = platform::record::Grabber::new(area, w, h, false)?.grab()?;
    let img = image::RgbImage::from_raw(w, h, rgb).ok_or("image de la fenêtre abîmée")?;
    let mut png = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png, image::ImageFormat::Png).map_err(|e| format!("image impossible : {e}"))?;
    Ok(("fenêtre active.png".into(), base64::engine::general_purpose::STANDARD.encode(png.into_inner())))
}

/// La taille réduite pour que le plus grand côté fasse au plus `max`.
fn fit(w: u32, h: u32, max: u32) -> (u32, u32) {
    let big = w.max(h).max(1);
    if big <= max {
        return (w.max(1), h.max(1));
    }
    (((u64::from(w) * u64::from(max)) / u64::from(big)).max(1) as u32, ((u64::from(h) * u64::from(max)) / u64::from(big)).max(1) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotkeys_parse() {
        use tauri_plugin_global_shortcut::Shortcut;
        for k in HOTKEYS.iter().chain(LOOK_HOTKEYS).chain(["Escape"].iter()) {
            assert!(k.parse::<Shortcut>().is_ok(), "{k}");
        }
        assert!(HOTKEYS.contains(&DEFAULT_HOTKEY));
    }

    #[test]
    fn discretion() {
        assert_eq!(why_discreet(&["Zoom".into()], false, false), Some("call"));
        assert_eq!(why_discreet(&["Ondine".into()], false, false), None);
        assert_eq!(why_discreet(&[], true, false), Some("presentation"));
        assert_eq!(why_discreet(&[], false, true), Some("focus"));
        assert_eq!(why_discreet(&[], false, false), None);
    }

    #[test]
    fn silence_ends_a_phrase() {
        let mut g = SilenceGate::new(false, 3000);
        // Du bruit de fond, puis de la voix, puis le silence.
        for _ in 0..10 {
            assert!(g.push(0.002, 50));
        }
        assert!(!g.heard);
        for _ in 0..20 {
            assert!(g.push(0.2, 50));
        }
        assert!(g.heard);
        let mut stopped_after = 0;
        for i in 1..100 {
            if !g.push(0.002, 50) {
                stopped_after = i * 50;
                break;
            }
        }
        assert_eq!(stopped_after, SilenceGate::END_MS as i32);
        // Personne ne parle : on abandonne au délai.
        let mut g = SilenceGate::new(false, 1000);
        assert!((0..19).all(|_| g.push(0.001, 50)));
        assert!(!g.push(0.001, 50));
        // « hold » : jamais arrêté par le silence.
        let mut g = SilenceGate::new(true, 100);
        assert!((0..100).all(|_| g.push(0.0, 50)));
    }

    #[test]
    fn wav_is_16k_mono() {
        let one_second = vec![0.5f32; 48_000];
        let wav = wav_16k(&one_second, 48_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(wav.len(), 44 + 16_000 * 2);
        assert_eq!(i16::from_le_bytes([wav[44], wav[45]]), 16383);
        assert_eq!(wav_16k(&[], 44_100).len(), 44);
    }

    #[test]
    fn multipart_has_every_part() {
        let (b, body) = multipart(&[("model", b"m", None), ("file", b"RIFF", Some("audio.wav"))]);
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with(&format!("--{b}\r\n")) && text.ends_with(&format!("--{b}--\r\n")));
        assert!(text.contains("name=\"model\"\r\n\r\nm\r\n"));
        assert!(text.contains("filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFF\r\n"));
    }

    #[test]
    fn look_is_shrunk() {
        assert_eq!(fit(3200, 1800, 1600), (1600, 900));
        assert_eq!(fit(800, 600, 1600), (800, 600));
        assert_eq!(fit(100, 4000, 1600), (40, 1600));
    }
}
