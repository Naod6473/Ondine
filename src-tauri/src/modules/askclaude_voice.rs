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
//   - « offline » (1.2.3) : la dictée 100 % hors ligne, par le moteur de
//     bureau de Windows (SAPI, platform/voice.rs `dictate_offline`). Rien ne
//     quitte le PC. Il faut la reconnaissance vocale de la langue installée
//     dans Windows ; sinon l'erreur le dit, avec la page des Paramètres. En
//     hors ligne, on ne propose jamais de passer à l'API ;
//   - « parakeet » (1.2.4) : le micro est capté en mémoire (WASAPI), puis
//     Parakeet l'écrit sur le PC (services/speech.rs, sherpa-onnx). Rien ne
//     quitte le PC. Sans le modèle (~700 Mo, téléchargé au clic dans les
//     Réglages), l'erreur le dit et porte `models: true` (bouton vers le
//     téléchargement). Mots en direct (`LivePartials`) : tant que vous
//     parlez, un fil à part réécrit le son déjà capté toutes les ~0,9 s
//     (jamais deux à la fois, un tour sauté si la précédente n'a pas fini,
//     rien pendant le silence, pas plus de la moitié du temps de calcul) et
//     publie `partial`. Le texte final reste la transcription complète.
//     Coupé en mode Économie (services/perf.rs) ;
//   - « api » : le micro est capté en mémoire (WASAPI), puis l'audio part
//     vers OpenAI (audio/transcriptions) ou Gemini (audio en entrée), avec la
//     clé déjà rangée. Claude n'écoute pas l'audio : avec Claude, on prend la
//     clé OpenAI, sinon Gemini, sinon on le dit. Si personne n'a parlé, rien
//     ne part.
// Rien de ce qui est dit n'est écrit sur le disque, ni noté dans le journal
// (seulement « écoute : N caractères ») ; un échec de Windows y laisse son
// détail technique (étape, HRESULT, langues, réglages lus) pour le diagnostic.
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
//     `cancel`, `blocked {why}`, `error {message, fix?, apiTo?}` : `fix`, la
//     page des Paramètres Windows qui règle le problème (commande `voice_fix`) ;
//     `apiTo`, la destination de la transcription par l'API, proposée en un
//     clic quand la dictée de Windows échoue et qu'une clé OpenAI ou Gemini
//     est rangée ; `offline` (vrai), le moteur hors ligne est installé : le
//     bouton « Passer à la dictée hors ligne » est proposé à la place ;
//     `parakeet` (vrai), le modèle Parakeet est téléchargé : « Passer à
//     Parakeet sur le PC » ; `models` (vrai), Parakeet est choisi mais son
//     modèle manque : « Télécharger le modèle » ouvre les Réglages.

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::askclaude_providers::{self as providers, Provider};
use crate::platform::{self, voice};
use crate::services::log;
use crate::services::perf;
use crate::services::speech as stt;

const ID: &str = "askclaude";
/// Les raccourcis proposés. Un raccourci personnalisé (1.2.4) est accepté
/// s'il passe `check_hotkey`.
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
pub(super) const OPENAI_STT_MODEL: &str = "gpt-4o-mini-transcribe";
/// Une image de la fenêtre active : son plus grand côté, au plus.
const LOOK_MAX_SIDE: u32 = 1600;
/// Parakeet : au-dessus de ce niveau crête, on écrit même si le seuil de
/// silence n'a rien vu (voix faible, micro loin).
const QUIET_SPEECH_PEAK: f32 = 0.02;
/// « Tester le micro » : durée.
const MIC_TEST: Duration = Duration::from_secs(4);
/// L'événement Tauri de « Tester le micro » (niveau, puis le bilan).
pub const MIC_TEST_EVENT: &str = "mic-test";
static MIC_TESTING: AtomicBool = AtomicBool::new(false);

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
/// Le dernier refus de chaque raccourci (voix, regarde ça), pour les Réglages.
static HOTKEY_ERRORS: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));

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
    // Le mot d'appel (« Dis Ondine »), coupé par défaut, a son propre fil.
    super::askclaude_wake::start(app.clone());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2)); // le temps que les réglages soient chargés
        loop {
            let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // Le micro choisi sert à toutes les captures d'Ondine, même module coupé.
                voice::set_mic(&mic_setting(&app));
                let (voice, look) = if super::is_active(&app, ID) {
                    let s = settings(&app);
                    let voice = pick_hotkey(s.get("voiceHotkey").and_then(Value::as_str).unwrap_or(DEFAULT_HOTKEY), HOTKEYS);
                    let look = pick_hotkey(s.get("lookHotkey").and_then(Value::as_str).unwrap_or(""), LOOK_HOTKEYS);
                    let mut guard = HOTKEY_ERRORS.locked();
                    let errors = &mut *guard;
                    for (picked, slot) in [(&voice, &mut errors.0), (&look, &mut errors.1)] {
                        if let Err(e) = picked {
                            if slot != e {
                                log::warn(format!("parler à Ondine : {e}"));
                                *slot = e.clone();
                            }
                        }
                    }
                    drop(guard);
                    let voice = voice.unwrap_or_default();
                    // Le même raccourci pour les deux : seulement « parler ».
                    let look = look.unwrap_or_default();
                    let look = if !look.is_empty() && same_hotkey(&look, &voice) { String::new() } else { look };
                    (voice, look)
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

/// Le micro choisi (`micDevice`), lu dans les réglages enregistrés.
fn mic_setting(app: &AppHandle) -> String {
    use tauri::Manager;
    let Some(shared) = app.try_state::<crate::Shared>() else { return String::new() };
    let st = shared.settings.locked();
    st.modules.get(ID).and_then(|m| m.values.get("micDevice")).and_then(Value::as_str).unwrap_or("").to_string()
}

/// La valeur d'un réglage de raccourci → le raccourci à poser ("" = aucun),
/// ou pourquoi il est refusé.
fn pick_hotkey(value: &str, presets: &[&str]) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || presets.contains(&value) {
        return Ok(value.to_string());
    }
    check_hotkey(value).map(|()| value.to_string()).map_err(|why| format!("le raccourci {} est refusé : {why}", pretty_hotkey(value)))
}

/// Deux écritures du même raccourci (« Alt+Ctrl+K » et « Ctrl+Alt+K ») ?
fn same_hotkey(a: &str, b: &str) -> bool {
    use tauri_plugin_global_shortcut::Shortcut;
    match (a.parse::<Shortcut>(), b.parse::<Shortcut>()) {
        (Ok(x), Ok(y)) => x.mods == y.mods && x.key == y.key,
        _ => a == b,
    }
}

/// Un raccourci personnalisé est-il acceptable ? Il doit se lire comme un
/// `Shortcut` du greffon de raccourcis globaux, avoir au moins un
/// modificateur (Ctrl, Alt, Maj, Win ; sauf F1 à F24), ne pas gêner la frappe
/// (Maj seule avec une touche) ni prendre un raccourci de Windows (Alt+F4,
/// Ctrl+Alt+Suppr, Win+L…) ou un raccourci d'édition (Ctrl+C…), qu'Ondine
/// volerait à toutes les applis.
pub fn check_hotkey(value: &str) -> Result<(), &'static str> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let sc: Shortcut = value.parse().map_err(|_| "raccourci illisible")?;
    let (m, k) = (sc.mods, sc.key);
    let fkey = matches!(
        k,
        Code::F1 | Code::F2 | Code::F3 | Code::F4 | Code::F5 | Code::F6 | Code::F7 | Code::F8 | Code::F9 | Code::F10 | Code::F11 | Code::F12 | Code::F13 | Code::F14 | Code::F15 | Code::F16 | Code::F17 | Code::F18 | Code::F19 | Code::F20 | Code::F21 | Code::F22 | Code::F23 | Code::F24
    );
    let (ctrl, alt, shift, win) = (Modifiers::CONTROL, Modifiers::ALT, Modifiers::SHIFT, Modifiers::SUPER);
    let allowed = ctrl | alt | shift | win;
    if !allowed.contains(m) {
        return Err("seules les touches Ctrl, Alt, Maj et Win peuvent accompagner la touche");
    }
    if m.is_empty() && !fkey {
        return Err("il faut au moins une touche Ctrl, Alt, Maj ou Win (sauf pour F1 à F24)");
    }
    if m.is_empty() && k == Code::F12 {
        return Err("F12 seule est réservée par Windows");
    }
    if m == shift && !fkey {
        return Err("Maj seule avec une touche gênerait la frappe : ajoutez Ctrl, Alt ou Win");
    }
    let windows: &[(Modifiers, Code)] = &[
        (alt, Code::F4),
        (alt, Code::Tab),
        (alt | shift, Code::Tab),
        (alt, Code::Escape),
        (alt, Code::Space),
        (ctrl, Code::Escape),
        (ctrl | shift, Code::Escape),
        (ctrl | alt, Code::Delete),
        (ctrl | alt, Code::Tab),
        (win, Code::KeyL),
        (win, Code::KeyD),
        (win, Code::KeyE),
        (win, Code::KeyR),
        (win, Code::KeyI),
        (win, Code::KeyX),
        (win, Code::KeyA),
        (win, Code::KeyS),
        (win, Code::KeyV),
        (win, Code::KeyH),
        (win, Code::KeyM),
        (win, Code::Tab),
        (win, Code::Period),
        (win | shift, Code::KeyS),
        (win | ctrl, Code::KeyD),
        (win | ctrl, Code::ArrowLeft),
        (win | ctrl, Code::ArrowRight),
        (win | ctrl, Code::F4),
    ];
    let editing = [Code::KeyA, Code::KeyC, Code::KeyF, Code::KeyN, Code::KeyO, Code::KeyP, Code::KeyS, Code::KeyT, Code::KeyV, Code::KeyW, Code::KeyX, Code::KeyY, Code::KeyZ];
    if windows.iter().any(|&(wm, wk)| wm == m && wk == k) || (m == win && matches!(k, Code::Digit0 | Code::Digit1 | Code::Digit2 | Code::Digit3 | Code::Digit4 | Code::Digit5 | Code::Digit6 | Code::Digit7 | Code::Digit8 | Code::Digit9)) {
        return Err("ce raccourci sert déjà à Windows");
    }
    if m == ctrl && editing.contains(&k) {
        return Err("ce raccourci sert à toutes les applis (copier, coller, enregistrer…)");
    }
    Ok(())
}

/// Un raccourci à lire (« Ctrl + Alt + Maj + K »).
fn pretty_hotkey(value: &str) -> String {
    value
        .split('+')
        .map(|t| match t.trim() {
            "Shift" => "Maj".to_string(),
            "Super" => "Win".to_string(),
            "Enter" => "Entrée".to_string(),
            "Space" => "Espace".to_string(),
            "Delete" => "Suppr".to_string(),
            "Escape" => "Échap".to_string(),
            k => k.strip_prefix("Key").or_else(|| k.strip_prefix("Digit")).unwrap_or(k).to_string(),
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

/// Pour les Réglages : le dernier refus de chaque raccourci ("" = aucun).
pub fn hotkey_errors() -> Value {
    let e = HOTKEY_ERRORS.locked();
    json!({ "voiceHotkey": e.0, "lookHotkey": e.1 })
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
        {
            let mut errors = HOTKEY_ERRORS.locked();
            let slot = if is_look { &mut errors.1 } else { &mut errors.0 };
            slot.clear();
        }
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
            let pretty = pretty_hotkey(wanted);
            let msg = if text.contains("already registered") {
                format!("{pretty} est déjà pris par un autre logiciel : choisissez un autre raccourci dans les réglages de Parler à Ondine")
            } else {
                format!("le raccourci {pretty} est refusé : {text}")
            };
            log::warn(format!("parler à Ondine : {msg}"));
            {
                let mut errors = HOTKEY_ERRORS.locked();
                *(if is_look { &mut errors.1 } else { &mut errors.0 }) = msg.clone();
            }
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
            Ok(Err(f)) => {
                // Le détail (étape, HRESULT, langues, réglages de Windows lus) va
                // dans le journal : jamais ce qui a été dit.
                if !f.detail.is_empty() {
                    log::warn(format!("parler à Ondine : {} [{}]", f.message, f.detail));
                }
                // La dictée de Windows a échoué : proposer la transcription par
                // l'API si une clé OpenAI ou Gemini est rangée (rien ne part sans le clic).
                // En hors ligne, jamais : la personne a choisi que rien ne parte.
                let engine = VoiceEngine::of(&settings(&app2));
                let windows_failed = !f.detail.is_empty() && engine == VoiceEngine::Windows;
                let api_to = if windows_failed { api_offer(&app2) } else { None };
                // Le moteur hors ligne est là : le proposer aussi (rien ne part).
                let offline = windows_failed && voice::offline_engine(dictation_tag(&app2)).is_some();
                // Parakeet sur le PC : proposé s'il est prêt ; s'il est choisi
                // sans son modèle, le bouton mène au téléchargement.
                let parakeet = windows_failed && stt::ready();
                let models = engine == VoiceEngine::Parakeet && !stt::ready();
                voice_event(&app2, "error", json!({ "message": f.message, "fix": f.fix.map(voice::Fix::id), "apiTo": api_to, "offline": offline, "parakeet": parakeet, "models": models, "id": id }));
            }
            Err(_) => voice_event(&app2, "error", json!({ "message": "erreur inattendue pendant l'écoute", "id": id })),
        }
    });
    Ok(())
}

/// Le mot d'appel suivi d'une question (« Hey Ondine, quel temps fait-il ? ») :
/// comme une écoute finie, la question part dans Parler à Ondine.
pub fn heard_text(app: &AppHandle, text: &str) {
    let id = NEXT.fetch_add(1, Ordering::SeqCst) + 1;
    log::info(format!("parler à Ondine : mot d'appel suivi d'une question ({} caractères)", text.chars().count()));
    voice_event(app, "open", json!({ "look": false, "hold": false, "id": id }));
    voice_event(app, "final", json!({ "text": text.trim(), "look": false, "id": id }));
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

/// La reconnaissance choisie (réglage « voiceEngine »).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoiceEngine {
    /// La dictée de Windows (service en ligne de Microsoft).
    Windows,
    /// Le moteur de bureau de Windows, 100 % hors ligne.
    Offline,
    /// L'audio part vers OpenAI ou Gemini.
    Api,
    /// Parakeet, sur le PC (1.2.4) : rien ne le quitte.
    Parakeet,
}

impl VoiceEngine {
    pub fn of(settings: &serde_json::Map<String, Value>) -> VoiceEngine {
        match settings.get("voiceEngine").and_then(Value::as_str) {
            Some("api") => VoiceEngine::Api,
            Some("offline") => VoiceEngine::Offline,
            Some("parakeet") => VoiceEngine::Parakeet,
            _ => VoiceEngine::Windows,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            VoiceEngine::Windows => "windows",
            VoiceEngine::Offline => "offline",
            VoiceEngine::Api => "api",
            VoiceEngine::Parakeet => "parakeet",
        }
    }
}

/// La langue de l'appli ("fr" ou "en").
fn app_lang(app: &AppHandle) -> &'static str {
    super::with_context(app, ID, |ctx| {
        use tauri::Manager;
        let shared = ctx.app.state::<crate::Shared>();
        let st = shared.settings.locked();
        crate::app_language(&st)
    })
    .unwrap_or("fr")
}

/// La langue de la dictée, en étiquette complète.
pub fn dictation_tag(app: &AppHandle) -> &'static str {
    if app_lang(app) == "en" {
        "en-US"
    } else {
        "fr-FR"
    }
}

/// L'écoute elle-même : renvoie le texte dit ("" si rien).
fn run(app: &AppHandle, s: &Session, opts: Options) -> Result<String, voice::Failure> {
    let settings = settings(app);
    let lang = app_lang(app);
    let engine = VoiceEngine::of(&settings);
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
    if engine == VoiceEngine::Api || engine == VoiceEngine::Parakeet {
        // Avant d'ouvrir le micro : la clé (API) ou le modèle (Parakeet).
        let api = if engine == VoiceEngine::Api { Some(stt_key(app, &settings)?) } else { None };
        if engine == VoiceEngine::Parakeet && !stt::ready() {
            return Err(voice::Failure::from(stt::MISSING.to_string()));
        }
        let mut gate = SilenceGate::new(opts.hold, silence as u64);
        // Parakeet : vos mots en direct pendant que vous parlez (pas en mode Économie).
        let mut live = (engine == VoiceEngine::Parakeet && perf::mode() != perf::Mode::Eco).then(|| LivePartials::start(app.clone(), lang));
        let (pcm, info) = voice::record_info(&s.stop, &mut |chunk, rate| {
            let rms = rms(chunk);
            level((rms * 6.0).sqrt().min(1.0));
            if started.elapsed() > max {
                return false;
            }
            let go = gate.push(rms, chunk.len() as u64 * 1000 / u64::from(rate.max(1)));
            if let Some(live) = live.as_mut() {
                live.feed(chunk, rate, gate.talking());
            }
            go
        })?;
        // Plus aucun mot en direct après ça (le fil finit sa transcription en cours).
        drop(live);
        if s.stop.load(Ordering::SeqCst) == voice::CANCEL {
            return Ok(String::new());
        }
        if !gate.heard {
            // Un micro muet (coupé, volume à 0, bloqué, pas le bon) : le dire.
            if let Some(f) = voice::silent_mic(&info, None) {
                return Err(f);
            }
            // Parakeet (rien ne part) : une voix faible mais présente est
            // quand même écrite. L'API : personne n'a parlé, rien ne part.
            if engine == VoiceEngine::Api || info.peak < QUIET_SPEECH_PEAK {
                return Ok(String::new());
            }
        }
        voice_event(app, "transcribing", json!({}));
        let Some((provider, key, model)) = api else {
            // Parakeet : le son en 16 kHz, écrit sur le PC (rien ne part).
            let samples = stt::to_16k_mono(&pcm.samples, 1, pcm.rate);
            return stt::transcribe(&samples, Some(lang)).map_err(voice::Failure::from);
        };
        let wav = wav_16k(&pcm.samples, pcm.rate);
        log::info(format!("parler à Ondine : audio envoyé à {} ({} octets)", provider.destination(), wav.len()));
        return transcribe(provider, &key, &model, &wav, lang).map_err(voice::Failure::from);
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
    let tag = dictation_tag(app);
    let cb = voice::Listen { stop: &s.stop, partial: &mut partial, level: &mut level_and_watch };
    if engine == VoiceEngine::Offline {
        return voice::dictate_offline(tag, opts.hold, silence, cb);
    }
    voice::dictate(tag, opts.hold, silence, cb)
}

// ── Le micro : la liste et « Tester le micro » (Réglages, 1.2.4) ─────────────

/// Les micros du PC et celui choisi, pour les Réglages.
pub fn mics() -> Value {
    json!({
        "supported": cfg!(windows),
        "mics": voice::microphones(),
        "chosen": voice::chosen_mic(),
        "testing": MIC_TESTING.load(Ordering::SeqCst),
    })
}

/// Écoute le micro `device` (vide = celui par défaut) quelques secondes :
/// l'événement `mic-test` porte le niveau (~15 fois par seconde), puis le
/// bilan `{done, info?, problem?, fix?}`. Rien n'est gardé ni envoyé.
pub fn mic_test(app: &AppHandle, device: &str) -> Result<(), String> {
    use tauri::Emitter;
    if MIC_TESTING.swap(true, Ordering::SeqCst) {
        return Err("le test du micro est déjà en cours".into());
    }
    let app = app.clone();
    let device = device.to_string();
    std::thread::spawn(move || {
        let stop = AtomicU8::new(0);
        let started = Instant::now();
        let mut last = Instant::now() - LEVEL_EVERY;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            voice::mic_test(&device, &stop, &mut |chunk, _rate| {
                if last.elapsed() >= LEVEL_EVERY {
                    last = Instant::now();
                    let level = (rms(chunk) * 6.0).sqrt().min(1.0);
                    let _ = app.emit(MIC_TEST_EVENT, json!({ "level": (level * 100.0).round() / 100.0 }));
                }
                started.elapsed() < MIC_TEST
            })
        }));
        MIC_TESTING.store(false, Ordering::SeqCst);
        let end = match result {
            Ok(Ok(info)) => {
                let problem = voice::silent_mic(&info, None);
                log::info(format!("test du micro : {}", voice::mic_detail(&info)));
                json!({ "done": true, "info": info, "problem": problem.as_ref().map(|f| f.message.clone()), "fix": problem.and_then(|f| f.fix).map(voice::Fix::id) })
            }
            Ok(Err(f)) => {
                log::warn(format!("test du micro : {} [{}]", f.message, f.detail));
                json!({ "done": true, "problem": f.message, "fix": f.fix.map(voice::Fix::id) })
            }
            Err(_) => json!({ "done": true, "problem": "erreur inattendue pendant le test du micro" }),
        };
        let _ = app.emit(MIC_TEST_EVENT, end);
    });
    Ok(())
}

// ── La transcription par l'API ───────────────────────────────────────────────

/// Le fournisseur, la clé et le modèle pour transcrire (Claude n'écoute pas l'audio).
pub(super) fn stt_key(app: &AppHandle, settings: &serde_json::Map<String, Value>) -> Result<(Provider, String, String), String> {
    let chosen = Provider::from_id(settings.get("provider").and_then(Value::as_str).unwrap_or(""));
    let order: &[Provider] = match chosen {
        Provider::Gemini => &[Provider::Gemini],
        Provider::OpenAi => &[Provider::OpenAi],
        // Claude, un serveur local, OpenRouter : pas d'audio ici.
        Provider::Claude | Provider::Local | Provider::OpenRouter => &[Provider::OpenAi, Provider::Gemini],
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
            Provider::Local | Provider::OpenRouter => "Ce fournisseur n'écoute pas l'audio : pour la transcription par l'API, ajoutez une clé OpenAI ou Gemini dans Réglages → Identifiants, ou choisissez la reconnaissance de Windows".into(),
            p => format!("pas de {} : ajoutez-la dans Réglages → Identifiants", p.key_label().to_lowercase()),
        })
    })
    .unwrap_or_else(|| Err("module indisponible".into()))
}

/// La destination de la transcription par l'API si elle est possible (une clé
/// OpenAI ou Gemini rangée), pour la proposer quand la dictée de Windows échoue.
/// Lit seulement le Gestionnaire d'identifiants : rien ne part.
fn api_offer(app: &AppHandle) -> Option<&'static str> {
    stt_key(app, &settings(app)).ok().map(|(p, _, _)| p.destination())
}

/// Envoie l'audio (WAV) et renvoie le texte.
pub(super) fn transcribe(provider: Provider, key: &str, model: &str, wav: &[u8], lang: &str) -> Result<String, String> {
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
    /// Mots en direct : on ne réécrit plus après ce silence.
    const TALKING_MS: u64 = 500;

    fn new(hold: bool, initial_ms: u64) -> SilenceGate {
        SilenceGate { hold, initial_ms, floor: 1.0, elapsed_ms: 0, quiet_ms: 0, heard: false }
    }

    /// La personne parle en ce moment (ou vient de s'arrêter, depuis moins de TALKING_MS).
    fn talking(&self) -> bool {
        self.heard && self.quiet_ms < Self::TALKING_MS
    }

    /// Un morceau de `ms` millisecondes, de niveau `rms`. Faux = on s'arrête.
    fn push(&mut self, rms: f32, ms: u64) -> bool {
        self.elapsed_ms += ms;
        self.floor = self.floor.min(rms.max(0.0005));
        // Seuil bas (−44 dB) : un micro de portable ou de casque capte souvent
        // la voix assez faiblement.
        let speaking = rms > (self.floor * 3.0).max(0.006);
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

// ── Parakeet : vos mots en direct (1.2.4) ────────────────────────────────────

/// Mots en direct : on réécrit au plus souvent toutes les… (ms de son capté).
const LIVE_EVERY_MS: u64 = 900;
/// … et au moins toutes les… (même si la transcription est lente).
const LIVE_MAX_EVERY_MS: u64 = 4000;

/// Quand réécrire le son déjà capté (sans horloge ni modèle : testé sous Linux).
struct LiveSchedule {
    /// Son capté depuis la dernière transcription en direct (ms).
    since_ms: u64,
}

impl LiveSchedule {
    /// Un morceau de `ms` : vrai = lancer une transcription maintenant. Rien
    /// pendant le silence (`talking` faux) ; si la précédente n'est pas finie
    /// (`busy`), on saute ce tour. `every_ms` : le pas actuel (`live_every`).
    fn tick(&mut self, ms: u64, talking: bool, busy: bool, every_ms: u64) -> bool {
        self.since_ms += ms;
        if self.since_ms < every_ms || !talking {
            return false;
        }
        self.since_ms = 0;
        !busy
    }
}

/// Le pas des mots en direct après une transcription qui a pris `took_ms` :
/// au moins deux fois sa durée (le calcul n'occupe jamais plus de la moitié
/// du temps), entre LIVE_EVERY_MS et LIVE_MAX_EVERY_MS.
fn live_every(took_ms: u64) -> u64 {
    took_ms.saturating_mul(2).clamp(LIVE_EVERY_MS, LIVE_MAX_EVERY_MS)
}

/// Les mots en direct de Parakeet : le son capté est gardé ici, et un fil à
/// part le réécrit en entier de temps en temps (LiveSchedule), une
/// transcription à la fois. Rien n'est écrit sur le disque. À la fin
/// (`drop`), le fil termine sa transcription en cours et n'envoie plus rien.
struct LivePartials {
    audio: Arc<Mutex<Vec<f32>>>,
    rate: Arc<AtomicU32>,
    busy: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    every: Arc<AtomicU64>,
    schedule: LiveSchedule,
    tx: Option<mpsc::Sender<()>>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl LivePartials {
    fn start(app: AppHandle, lang: &'static str) -> LivePartials {
        let (tx, rx) = mpsc::channel::<()>();
        let audio = Arc::new(Mutex::new(Vec::new()));
        let rate = Arc::new(AtomicU32::new(stt::SAMPLE_RATE));
        let busy = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let every = Arc::new(AtomicU64::new(LIVE_EVERY_MS));
        let worker = {
            let (audio, rate, busy, done, every) = (audio.clone(), rate.clone(), busy.clone(), done.clone(), every.clone());
            std::thread::spawn(move || {
                let mut last = String::new();
                while rx.recv().is_ok() {
                    if done.load(Ordering::SeqCst) {
                        break;
                    }
                    let samples = audio.locked().clone();
                    let started = Instant::now();
                    let text = stt::transcribe(&stt::to_16k_mono(&samples, 1, rate.load(Ordering::SeqCst)), Some(lang));
                    every.store(live_every(started.elapsed().as_millis() as u64), Ordering::SeqCst);
                    busy.store(false, Ordering::SeqCst);
                    if done.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(text) = text else { continue };
                    let text = text.trim();
                    if !text.is_empty() && text != last {
                        last = text.to_string();
                        voice_event(&app, "partial", json!({ "text": text }));
                    }
                }
            })
        };
        LivePartials { audio, rate, busy, done, every, schedule: LiveSchedule { since_ms: 0 }, tx: Some(tx), worker: Some(worker) }
    }

    /// Un morceau de son capté (mono, à la fréquence du micro).
    fn feed(&mut self, chunk: &[f32], rate: u32, talking: bool) {
        self.rate.store(rate, Ordering::SeqCst);
        self.audio.locked().extend_from_slice(chunk);
        let ms = chunk.len() as u64 * 1000 / u64::from(rate.max(1));
        let busy = self.busy.load(Ordering::SeqCst);
        if self.schedule.tick(ms, talking, busy, self.every.load(Ordering::SeqCst)) {
            if let Some(tx) = &self.tx {
                self.busy.store(true, Ordering::SeqCst);
                if tx.send(()).is_err() {
                    self.busy.store(false, Ordering::SeqCst);
                }
            }
        }
    }
}

impl Drop for LivePartials {
    fn drop(&mut self) {
        self.done.store(true, Ordering::SeqCst);
        self.tx.take();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

/// Le son en WAV mono 16 bits à 16 kHz (ce que les API préfèrent pour la voix).
pub(super) fn wav_16k(samples: &[f32], rate: u32) -> Vec<u8> {
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
    fn custom_hotkeys_follow_the_rules() {
        for ok in ["Ctrl+Alt+K", "Ctrl+Shift+F9", "F9", "F24", "Shift+F2", "Alt+Shift+M", "Super+Alt+Space", "Ctrl+Alt+Numpad1", "Ctrl+Shift+V"] {
            assert_eq!(check_hotkey(ok), Ok(()), "{ok}");
        }
        for bad in ["", "Ctrl+", "Ctrl+Alt", "Ctrl+Truc", "K", "Space", "Shift+K", "F12", "Alt+F4", "Ctrl+Alt+Delete", "Super+L", "Super+D", "Alt+Tab", "Ctrl+Shift+Escape", "Ctrl+C", "Ctrl+V", "Super+1"] {
            assert!(check_hotkey(bad).is_err(), "{bad}");
        }
        // Les choix proposés passent aussi les règles.
        for k in HOTKEYS.iter().chain(LOOK_HOTKEYS) {
            assert_eq!(check_hotkey(k), Ok(()), "{k}");
        }
    }

    #[test]
    fn hotkey_settings_are_picked_or_refused() {
        assert_eq!(pick_hotkey("", HOTKEYS), Ok(String::new()));
        assert_eq!(pick_hotkey("Ctrl+Alt+V", HOTKEYS), Ok("Ctrl+Alt+V".into()));
        assert_eq!(pick_hotkey("Ctrl+Alt+K", HOTKEYS), Ok("Ctrl+Alt+K".into()));
        let refused = pick_hotkey("Alt+F4", HOTKEYS).unwrap_err();
        assert!(refused.contains("Alt + F4") && refused.contains("Windows"), "{refused}");
        assert!(same_hotkey("Alt+Ctrl+K", "Ctrl+Alt+K"));
        assert!(!same_hotkey("Ctrl+Alt+K", "Ctrl+Alt+J"));
        assert_eq!(pretty_hotkey("Ctrl+Shift+Super+KeyK"), "Ctrl + Maj + Win + K");
        assert_eq!(pretty_hotkey("Ctrl+Alt+Enter"), "Ctrl + Alt + Entrée");
    }

    #[test]
    fn hotkey_fields_of_the_manifest() {
        let manifest: Value = serde_json::from_str(include_str!("../../../src/modules/askclaude/manifest.json")).unwrap();
        let fields = manifest["settings"]["fields"].as_array().unwrap();
        for (key, presets) in [("voiceHotkey", HOTKEYS), ("lookHotkey", LOOK_HOTKEYS)] {
            let f = fields.iter().find(|f| f["key"] == key).unwrap();
            assert_eq!(f["type"], "hotkey", "{key}");
            let values: Vec<&str> = f["options"].as_array().unwrap().iter().filter_map(|o| o["value"].as_str()).filter(|v| !v.is_empty()).collect();
            assert_eq!(values, presets, "{key}");
        }
        // Le mot d'appel est coupé par défaut ; le micro, celui de Windows.
        assert_eq!(fields.iter().find(|f| f["key"] == "wakeWord").unwrap()["default"], false);
        assert_eq!(fields.iter().find(|f| f["key"] == "micDevice").unwrap()["default"], "");
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
    fn live_words_are_paced() {
        // Toutes les ~0,9 s de son, seulement pendant qu'on parle.
        let mut s = LiveSchedule { since_ms: 0 };
        let ticks: Vec<bool> = (0..20).map(|_| s.tick(100, true, false, LIVE_EVERY_MS)).collect();
        assert_eq!(ticks.iter().filter(|t| **t).count(), 2);
        assert!(ticks[8] && ticks[17]);
        // Le silence : rien, puis tout de suite quand on reparle.
        let mut s = LiveSchedule { since_ms: 0 };
        assert!((0..30).all(|_| !s.tick(100, false, false, LIVE_EVERY_MS)));
        assert!(s.tick(20, true, false, LIVE_EVERY_MS));
        // La précédente n'est pas finie : ce tour est sauté (et le compte repart).
        let mut s = LiveSchedule { since_ms: 0 };
        assert!(!s.tick(1000, true, true, LIVE_EVERY_MS));
        assert!(!s.tick(500, true, false, LIVE_EVERY_MS));
        assert!(s.tick(400, true, false, LIVE_EVERY_MS));
        // Une transcription lente espace les suivantes (au plus la moitié du temps de calcul).
        assert_eq!(live_every(100), LIVE_EVERY_MS);
        assert_eq!(live_every(700), 1400);
        assert_eq!(live_every(60_000), LIVE_MAX_EVERY_MS);
    }

    #[test]
    fn talking_follows_the_voice() {
        let mut g = SilenceGate::new(false, 6000);
        assert!(!g.talking());
        g.push(0.001, 100);
        assert!(!g.talking(), "rien entendu encore");
        g.push(0.2, 100);
        assert!(g.talking());
        g.push(0.001, 300);
        assert!(g.talking(), "une petite pause");
        g.push(0.001, 300);
        assert!(!g.talking(), "le silence");
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
    fn engines_round_trip() {
        for id in ["windows", "offline", "api", "parakeet"] {
            let mut s = serde_json::Map::new();
            s.insert("voiceEngine".into(), json!(id));
            assert_eq!(VoiceEngine::of(&s).id(), id);
        }
        assert_eq!(VoiceEngine::of(&serde_json::Map::new()), VoiceEngine::Windows);
        // Le choix « parakeet » existe dans le manifeste (réglage voiceEngine).
        let manifest: Value = serde_json::from_str(include_str!("../../../src/modules/askclaude/manifest.json")).unwrap();
        let field = manifest["settings"]["fields"].as_array().unwrap().iter().find(|f| f["key"] == "voiceEngine").unwrap();
        let values: Vec<&str> = field["options"].as_array().unwrap().iter().filter_map(|o| o["value"].as_str()).collect();
        assert!(values.contains(&"parakeet"), "{values:?}");
        assert_eq!(field["default"], "windows");
    }

    #[test]
    fn look_is_shrunk() {
        assert_eq!(fit(3200, 1800, 1600), (1600, 900));
        assert_eq!(fit(800, 600, 1600), (800, 600));
        assert_eq!(fit(100, 4000, 1600), (40, 1600));
    }
}
