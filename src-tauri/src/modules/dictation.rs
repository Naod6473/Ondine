// La dictée partout (module « dictation », coupé par défaut).
//
// Maintenir une touche n'importe où (Ctrl droit par défaut), parler, relâcher :
// le texte est collé là où l'on écrit. Deux appuis rapides : mains libres
// jusqu'au prochain appui ; Échap annule ; un raccourci recolle la dernière
// dictée. La logique de la touche est dans dictation_logic.rs, ce qu'on fait
// des mots dans dictation_text.rs, ce qui est gardé sur le PC dans
// dictation_store.rs, et tout ce qui touche à Windows (crochet clavier, champ
// de texte, collage) dans platform/dictation.rs. La pilule est pill.rs + la
// page pill.html.
//
// Les fils :
//   - « sync » : toutes les secondes, suit les réglages (crochet clavier, touche,
//     raccourci pour recoller, pilule au repos, présentation en cours) ;
//   - « touche » : reçoit les événements du crochet et des boutons, fait
//     tourner la machine à états, ouvre et ferme les écoutes ;
//   - une écoute : capte et transcrit, prépare le texte, colle, note.
//
// Ce qui sort du PC, et seulement si on l'a choisi : la voix vers le service
// en ligne de Microsoft (dictée de Windows), l'audio vers OpenAI ou Gemini
// (moteur « API »), le texte (jamais l'audio) vers l'IA de Parler à Ondine
// (remise au propre, coupée par défaut). Parakeet et le moteur hors ligne de
// Windows restent sur le PC.

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::askclaude_providers::{self as providers, Provider, Request, Turn};
use super::dictation_logic::{bands, resample_16k, Action, DictKey, Engine, KeyLogic};
use super::dictation_store::{self as store, Store, Words};
use super::dictation_text::{self as text, AppStyle, Style, VoiceSnippet};
use super::{BusMessage, ModuleContext, RustModule};
use crate::pill::{self, Edge};
use crate::platform::dictation::{self as os, Field, KeyEvent, Outcome};
use crate::platform::voice::{self, Failure, Fix};
use crate::services::log;
use crate::services::speech;

const ID: &str = "dictation";

/// Une écoute ne dure jamais plus que ça (même en mains libres).
const MAX_LISTEN: Duration = Duration::from_secs(5 * 60);
/// Les bulles de la pilule : au plus ~30 images par seconde.
const BANDS_EVERY: Duration = Duration::from_millis(33);
/// La remise au propre : sans réponse dans ce délai, le texte part tel quel.
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(8);
/// Moins que ça de parole (secondes) : on ne transcrit pas.
const MIN_SPEECH: f64 = 0.25;
/// Les raccourcis proposés pour recoller (les autres sont refusés).
pub const PASTE_HOTKEYS: &[&str] = &["Ctrl+Alt+Shift+V", "Alt+Shift+D"];

#[derive(Default)]
pub struct Dictation;

/// Où en est la dictée (aussi « dictation.state » sur le bus).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Phase {
    #[default]
    Idle,
    Listening,
    HandsFree,
    Thinking,
}

impl Phase {
    pub fn id(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Listening => "listening",
            Phase::HandsFree => "handsFree",
            Phase::Thinking => "thinking",
        }
    }
}

/// Ce que montre la pilule (événement « pill-state », commande « pill_state »).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct View {
    phase: &'static str,
    engine: &'static str,
    edge: &'static str,
    key: &'static str,
    /// Un appel est enregistré (Notes d'appel), depuis `call_started_at` (ms).
    call: bool,
    call_started_at: Option<f64>,
    /// Un message à montrer : { id, kind, text?, fix? }.
    message: Option<Value>,
}

/// Les réglages qui décident si la pilule se montre au repos.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Rest {
    active: bool,
    at_rest: bool,
    discreet: bool,
    presenting: bool,
    edge: Edge,
}

/// La pilule est-elle visible ? Pendant une écoute, un message ou un appel :
/// toujours ; au repos : si on l'a voulu, et pas pendant une présentation.
fn pill_visible(rest: Rest, phase: Phase, message: bool, call: bool) -> bool {
    if !rest.active {
        return false;
    }
    if phase != Phase::Idle || message || call {
        return true;
    }
    rest.at_rest && !(rest.discreet && rest.presenting)
}

enum Msg {
    Key(KeyEvent),
    /// Bouton « Dicter » : mains libres tout de suite.
    Dictate,
    /// Bouton « Coller » (mains libres).
    Finish,
    /// Bouton « Annuler ».
    Cancel,
    /// L'écoute `id` est finie (collée, annulée ou en échec).
    Done(u64),
}

struct Runtime {
    store: Mutex<Option<Store>>,
    tx: Mutex<Option<Sender<Msg>>>,
    view: Mutex<View>,
    phase: Mutex<Phase>,
    rest: Mutex<Rest>,
    next_message: AtomicU64,
}

fn rt() -> &'static Runtime {
    static RT: OnceLock<Runtime> = OnceLock::new();
    RT.get_or_init(|| Runtime {
        store: Mutex::new(None),
        tx: Mutex::new(None),
        view: Mutex::new(View { phase: "idle", engine: "windows", edge: "bottom", key: "rightCtrl", ..View::default() }),
        phase: Mutex::new(Phase::Idle),
        rest: Mutex::new(Rest::default()),
        next_message: AtomicU64::new(1),
    })
}

/// Le fichier dictation.json, chargé au premier besoin.
fn with_store<R>(f: impl FnOnce(&mut Store) -> R) -> R {
    let mut guard = rt().store.locked();
    let s = guard.get_or_insert_with(Store::load);
    f(s)
}

fn send(msg: Msg) {
    if let Some(tx) = rt().tx.locked().as_ref() {
        let _ = tx.send(msg);
    }
}

// ── Les réglages ─────────────────────────────────────────────────────────────

fn str_of<'a>(s: &'a Map<String, Value>, key: &str, default: &'a str) -> &'a str {
    s.get(key).and_then(Value::as_str).unwrap_or(default)
}

fn bool_of(s: &Map<String, Value>, key: &str, default: bool) -> bool {
    s.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn settings(app: &AppHandle) -> Option<Map<String, Value>> {
    super::with_context(app, ID, |ctx| ctx.settings())
}

fn language(app: &AppHandle) -> &'static str {
    let shared = app.state::<crate::Shared>();
    let s = shared.settings.locked();
    crate::app_language(&s)
}

/// Les réglages d'un autre module (Parler à Ondine : fournisseur et modèle de l'IA).
fn module_values(app: &AppHandle, id: &str) -> Map<String, Value> {
    let shared = app.state::<crate::Shared>();
    let s = shared.settings.locked();
    s.modules.get(id).map(|m| m.values.clone()).unwrap_or_default()
}

fn keep(s: &Map<String, Value>) -> Option<u64> {
    text::keep_days(str_of(s, "keepDays", "30"))
}

fn default_style(s: &Map<String, Value>) -> Style {
    Style::from_id(str_of(s, "defaultStyle", "natural")).unwrap_or_default()
}

// ── La pilule et le bus ──────────────────────────────────────────────────────

fn push_view(app: &AppHandle) {
    let view = rt().view.locked().clone();
    let phase = *rt().phase.locked();
    let rest = *rt().rest.locked();
    if pill_visible(rest, phase, view.message.is_some(), view.call) {
        pill::show(app, rest.edge);
    } else {
        pill::hide(app);
    }
    pill::emit(app, "pill-state", view);
}

fn set_phase(app: &AppHandle, phase: Phase, engine: Engine) {
    let changed = {
        let mut p = rt().phase.locked();
        let changed = *p != phase;
        *p = phase;
        changed
    };
    {
        let mut v = rt().view.locked();
        v.phase = phase.id();
        v.engine = engine.id();
        // Une nouvelle écoute efface le message précédent.
        if phase == Phase::Listening || phase == Phase::HandsFree {
            v.message = None;
        }
    }
    push_view(app);
    if changed {
        super::with_context(app, ID, |ctx| ctx.emit("dictation.state", json!({ "phase": phase.id(), "engine": engine.id() })));
    }
}

/// Un message dans la pilule. `kind` : copied, nothing, failed, parakeet,
/// noKey, error (avec `text`, la phrase de Rust), et `fix` pour un bouton
/// vers les Paramètres Windows.
fn message(app: &AppHandle, kind: &str, text: Option<&str>, fix: Option<Fix>) {
    let id = rt().next_message.fetch_add(1, Ordering::Relaxed);
    rt().view.locked().message = Some(json!({ "id": id, "kind": kind, "text": text, "fix": fix.map(Fix::id) }));
    push_view(app);
}

fn dismiss(app: &AppHandle) {
    rt().view.locked().message = None;
    push_view(app);
}

fn emit_bands(app: &AppHandle, levels: &[f32; bands::COUNT]) {
    let rounded: Vec<f32> = levels.iter().map(|v| (v * 100.0).round() / 100.0).collect();
    pill::emit(app, "pill-bands", rounded);
}

// ── Le fil « sync » ──────────────────────────────────────────────────────────

fn sync_loop(app: AppHandle, tx: Sender<Msg>) {
    let mut listener: Option<(DictKey, os::KeyListener)> = None;
    let mut hotkey = String::new();
    let mut last_error = String::new();
    let mut last_busy = Instant::now() - Duration::from_secs(10);
    let mut presenting = false;
    std::thread::sleep(Duration::from_secs(2)); // le temps que les réglages soient chargés
    loop {
        let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let s = settings(&app);
            let active = s.is_some();
            let s = s.unwrap_or_default();
            let key = DictKey::from_id(str_of(&s, "holdKey", "rightCtrl"));
            // Le crochet clavier : seulement module allumé.
            if !active {
                listener = None;
            } else if listener.as_ref().map(|(k, _)| *k) != Some(key) {
                listener = None;
                let tx = tx.clone();
                match os::listen(key, Box::new(move |e| {
                    let _ = tx.send(Msg::Key(e));
                })) {
                    Ok(l) => {
                        listener = Some((key, l));
                        last_error.clear();
                    }
                    Err(e) => {
                        if e != last_error {
                            log::warn(format!("dictée : la touche ne peut pas être suivie : {e}"));
                            last_error = e;
                        }
                    }
                }
            }
            // Le raccourci pour recoller.
            let wanted = if active { str_of(&s, "pasteHotkey", PASTE_HOTKEYS[0]) } else { "" };
            let wanted = if PASTE_HOTKEYS.contains(&wanted) { wanted.to_string() } else { String::new() };
            if wanted != hotkey {
                let gs = app.global_shortcut();
                if !hotkey.is_empty() {
                    let _ = gs.unregister(hotkey.as_str());
                }
                hotkey = wanted.clone();
                if !wanted.is_empty() {
                    let result = gs.on_shortcut(wanted.as_str(), |app, _s, e| {
                        if e.state == ShortcutState::Pressed {
                            let app = app.clone();
                            std::thread::spawn(move || paste_again(&app));
                        }
                    });
                    if let Err(e) = result {
                        log::warn(format!("dictée : le raccourci {} est refusé : {e}", wanted.replace("Shift", "Maj")));
                    }
                }
            }
            // La pilule au repos.
            let discreet = bool_of(&s, "discreet", true);
            if active && discreet && last_busy.elapsed() >= Duration::from_secs(2) {
                last_busy = Instant::now();
                presenting = crate::platform::presentation_busy();
            }
            let rest = Rest { active, at_rest: bool_of(&s, "pillAtRest", true), discreet, presenting, edge: Edge::from_id(str_of(&s, "edge", "bottom")) };
            let changed = {
                let mut r = rt().rest.locked();
                let changed = *r != rest;
                *r = rest;
                changed
            };
            {
                let mut v = rt().view.locked();
                v.edge = rest.edge.id();
                v.key = key.id();
            }
            if changed {
                push_view(&app);
            }
        }));
        if step.is_err() {
            log::warn("dictée : erreur inattendue en suivant les réglages, on réessaie");
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

// ── Le fil « touche » ────────────────────────────────────────────────────────

struct Session {
    id: u64,
    stop: Arc<AtomicU8>,
    hands_free: Arc<AtomicBool>,
    engine: Engine,
    started: Instant,
    thinking: bool,
}

fn key_loop(app: AppHandle, rx: Receiver<Msg>) {
    let clock = Instant::now();
    let mut logic = KeyLogic::default();
    let mut session: Option<Session> = None;
    let mut next_id = 1u64;
    loop {
        let msg = rx.recv_timeout(Duration::from_millis(50));
        let t = clock.elapsed().as_secs_f64();
        let action = match msg {
            Ok(Msg::Key(KeyEvent::Down)) => logic.key_down(t),
            Ok(Msg::Key(KeyEvent::Up)) => logic.key_up(t),
            Ok(Msg::Key(KeyEvent::Other)) => logic.other_key(),
            Ok(Msg::Key(KeyEvent::Escape)) => logic.escape(),
            Ok(Msg::Dictate) => {
                if session.is_none() {
                    logic.lock();
                    Action::Start
                } else {
                    Action::None
                }
            }
            Ok(Msg::Finish) => {
                if logic.is_active() {
                    logic.reset();
                    Action::Finish
                } else {
                    Action::None
                }
            }
            Ok(Msg::Cancel) => logic.escape(),
            Ok(Msg::Done(id)) => {
                if session.as_ref().is_some_and(|s| s.id == id) {
                    let engine = session.take().map(|s| s.engine).unwrap_or(Engine::Windows);
                    logic.reset();
                    set_phase(&app, Phase::Idle, engine);
                }
                Action::None
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Le garde-fou de durée : on colle ce qui a été dit.
                if session.as_ref().is_some_and(|s| !s.thinking && s.started.elapsed() > MAX_LISTEN) {
                    logic.reset();
                    Action::Finish
                } else {
                    logic.tick(t)
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        match action {
            Action::None => {}
            Action::Start | Action::Restart => {
                if let Some(s) = session.as_ref() {
                    if s.thinking {
                        // L'écoute précédente se colle encore : on attend.
                        logic.reset();
                        continue;
                    }
                    s.stop.store(voice::CANCEL, Ordering::SeqCst);
                    session = None;
                }
                match begin(&app, next_id, logic.is_locked()) {
                    Some(s) => {
                        next_id += 1;
                        session = Some(s);
                    }
                    None => logic.reset(),
                }
            }
            Action::Lock => {
                if let Some(s) = session.as_ref() {
                    s.hands_free.store(true, Ordering::SeqCst);
                    set_phase(&app, Phase::HandsFree, s.engine);
                }
            }
            Action::Finish => {
                if let Some(s) = session.as_mut() {
                    if !s.thinking {
                        s.thinking = true;
                        s.stop.store(voice::FINISH, Ordering::SeqCst);
                        set_phase(&app, Phase::Thinking, s.engine);
                    }
                }
            }
            Action::Cancel => {
                if let Some(s) = session.as_ref() {
                    if !s.thinking {
                        s.stop.store(voice::CANCEL, Ordering::SeqCst);
                        let engine = s.engine;
                        session = None;
                        set_phase(&app, Phase::Idle, engine);
                    }
                }
            }
        }
    }
}

/// Ouvre une écoute (None : module coupé).
fn begin(app: &AppHandle, id: u64, hands_free: bool) -> Option<Session> {
    let s = settings(app)?;
    let engine = Engine::pick(str_of(&s, "engine", "auto"), speech::ready());
    let stop = Arc::new(AtomicU8::new(0));
    let hands = Arc::new(AtomicBool::new(hands_free));
    let session = Session { id, stop: stop.clone(), hands_free: hands.clone(), engine, started: Instant::now(), thinking: false };
    set_phase(app, if hands_free { Phase::HandsFree } else { Phase::Listening }, engine);
    let app = app.clone();
    let key = DictKey::from_id(str_of(&s, "holdKey", "rightCtrl"));
    std::thread::spawn(move || {
        let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_session(&app, &s, engine, key, &stop, &hands)));
        if run.is_err() {
            log::error("dictée : l'écoute a planté");
            message(&app, "failed", None, None);
        }
        send(Msg::Done(id));
    });
    Some(session)
}

// ── Une écoute ───────────────────────────────────────────────────────────────

/// Pourquoi rien n'a été collé.
struct Problem {
    kind: &'static str,
    text: Option<String>,
    fix: Option<Fix>,
}

impl From<Failure> for Problem {
    fn from(f: Failure) -> Problem {
        if !f.detail.is_empty() {
            log::warn(format!("dictée : {} ({})", f.message, f.detail));
        }
        Problem { kind: "error", text: Some(f.message), fix: f.fix }
    }
}

fn run_session(app: &AppHandle, s: &Map<String, Value>, engine: Engine, key: DictKey, stop: &AtomicU8, hands_free: &AtomicBool) {
    let lang = language(app);
    let started = Instant::now();
    let heard = match listen(app, engine, lang, stop) {
        Ok(h) => h,
        Err(p) => {
            if stop.load(Ordering::SeqCst) != voice::CANCEL {
                message(app, p.kind, p.text.as_deref(), p.fix);
            }
            return;
        }
    };
    if stop.load(Ordering::SeqCst) == voice::CANCEL {
        return;
    }
    let raw = heard.trim();
    if raw.is_empty() {
        message(app, "nothing", None, None);
        return;
    }
    let seconds = started.elapsed().as_secs_f64();
    // La touche encore tenue ferait Ctrl+Alt+V au lieu de Ctrl+V.
    os::wait_key_released(key);
    crate::platform::wait_modifiers_released(Duration::from_millis(600));
    let app_id = os::foreground_app();
    let style = with_store(|st| st.style_for(app_id.as_deref(), default_style(s)));
    let final_text = prepare_text(app, s, raw, app_id.as_deref(), style, lang);
    let outcome = deliver(&final_text);
    let name = app_id.as_deref().filter(|a| !text::is_shell(a)).map(text::display_name);
    let entry = with_store(|st| st.record(&final_text, name.as_deref(), seconds, hands_free.load(Ordering::SeqCst), keep(s), store::today(), store::now_ms()));
    super::with_context(app, ID, |ctx| ctx.emit("dictation.history", json!({ "entry": entry })));
    match outcome {
        Outcome::Pasted => {}
        Outcome::Copied => message(app, "copied", None, None),
        Outcome::Failed => message(app, "failed", None, None),
    }
}

/// Colle là où l'on écrit, sinon garde dans le presse-papiers.
fn deliver(text: &str) -> Outcome {
    match os::text_field() {
        Field::No => {
            if os::copy(text) {
                Outcome::Copied
            } else {
                Outcome::Failed
            }
        }
        Field::Yes | Field::Unknown => os::paste(text),
    }
}

/// Écoute jusqu'à `stop` et renvoie ce qui a été dit.
fn listen(app: &AppHandle, engine: Engine, lang: &str, stop: &AtomicU8) -> Result<String, Problem> {
    if engine.records() {
        return listen_recording(app, engine, lang, stop);
    }
    // Windows écoute de son côté ; on capte à côté seulement pour les bulles.
    let monitor_stop = Arc::new(AtomicU8::new(0));
    let spectrum = Arc::new(AtomicBool::new(false));
    {
        let (app, monitor_stop, spectrum) = (app.clone(), monitor_stop.clone(), spectrum.clone());
        std::thread::spawn(move || {
            let mut ring: Vec<f32> = Vec::with_capacity(bands::FFT * 4);
            let mut last = Instant::now() - BANDS_EVERY;
            let _ = voice::monitor(&monitor_stop, &mut |chunk, rate| {
                push_ring(&mut ring, chunk);
                if last.elapsed() >= BANDS_EVERY && ring.len() >= bands::FFT {
                    last = Instant::now();
                    spectrum.store(true, Ordering::Relaxed);
                    emit_bands(&app, &bands::levels(&ring, rate));
                }
                true
            });
        });
    }
    let clock = Instant::now();
    let mut last = Instant::now() - BANDS_EVERY;
    let mut level = |l: f32| {
        if !spectrum.load(Ordering::Relaxed) && last.elapsed() >= BANDS_EVERY {
            last = Instant::now();
            emit_bands(app, &bands::from_level(l, clock.elapsed().as_secs_f64()));
        }
    };
    let mut partial = |_: &str| {};
    let tag = if lang == "en" { "en-US" } else { "fr-FR" };
    let cb = voice::Listen { stop, partial: &mut partial, level: &mut level };
    let result = if engine == Engine::Offline { voice::dictate_offline(tag, true, 10_000, cb) } else { voice::dictate(tag, true, 10_000, cb) };
    monitor_stop.store(voice::FINISH, Ordering::SeqCst);
    result.map_err(Problem::from)
}

/// Garde les derniers échantillons, juste assez pour la transformée.
fn push_ring(ring: &mut Vec<f32>, chunk: &[f32]) {
    ring.extend_from_slice(chunk);
    if ring.len() > bands::FFT * 2 {
        let cut = ring.len() - bands::FFT;
        ring.drain(..cut);
    }
}

/// Parakeet ou API : on capte le son en mémoire, puis on transcrit.
fn listen_recording(app: &AppHandle, engine: Engine, lang: &str, stop: &AtomicU8) -> Result<String, Problem> {
    if engine == Engine::Parakeet && !speech::ready() {
        return Err(Problem { kind: "parakeet", text: None, fix: None });
    }
    // La clé avant d'ouvrir le micro : sans clé, rien à écouter.
    let api = if engine == Engine::Api { Some(api_key(app)?) } else { None };
    let mut ring: Vec<f32> = Vec::with_capacity(bands::FFT * 4);
    let mut last = Instant::now() - BANDS_EVERY;
    let pcm = voice::record(stop, &mut |chunk, rate| {
        push_ring(&mut ring, chunk);
        if last.elapsed() >= BANDS_EVERY && ring.len() >= bands::FFT {
            last = Instant::now();
            emit_bands(app, &bands::levels(&ring, rate));
        }
        true
    })?;
    if stop.load(Ordering::SeqCst) == voice::CANCEL {
        return Ok(String::new());
    }
    let seconds = pcm.samples.len() as f64 / f64::from(pcm.rate.max(1));
    if seconds < MIN_SPEECH || super::dictation_logic::peak(&pcm.samples) < 0.01 {
        return Ok(String::new()); // personne n'a parlé : rien ne part
    }
    match api {
        None => {
            let samples = resample_16k(&pcm.samples, pcm.rate);
            speech::transcribe(&samples, Some(lang)).map_err(|e| Problem { kind: "error", text: Some(e), fix: None })
        }
        Some((provider, key, model)) => {
            let wav = super::askclaude_voice::wav_16k(&pcm.samples, pcm.rate);
            log::info(format!("dictée : audio envoyé à {} ({} octets)", provider.destination(), wav.len()));
            super::askclaude_voice::transcribe(provider, &key, &model, &wav, lang).map_err(|e| Problem { kind: "error", text: Some(e), fix: None })
        }
    }
}

/// La clé OpenAI, sinon Gemini, et le modèle de transcription.
fn api_key(app: &AppHandle) -> Result<(Provider, String, String), Problem> {
    let ask = module_values(app, "askclaude");
    let found = super::with_context(app, ID, |ctx| {
        for p in [Provider::OpenAi, Provider::Gemini] {
            if let Ok(Some(key)) = ctx.credential(p.credential_key()) {
                return Some((p, key));
            }
        }
        None
    })
    .flatten();
    let Some((p, key)) = found else { return Err(Problem { kind: "noKey", text: None, fix: None }) };
    let model = match p {
        Provider::Gemini => super::askclaude::model_from(&ask, p).or_else(|_| super::askclaude::model_from(&Map::new(), p)).map_err(|e| Problem { kind: "error", text: Some(e), fix: None })?,
        _ => super::askclaude_voice::OPENAI_STT_MODEL.to_string(),
    };
    Ok((p, key, model))
}

/// Snippets à la voix, dictionnaire, puis (si on l'a voulu) remise au propre.
fn prepare_text(app: &AppHandle, s: &Map<String, Value>, raw: &str, app_id: Option<&str>, style: Style, lang: &str) -> String {
    let snippets = if bool_of(s, "voiceSnippets", true) { voice_snippets(app) } else { Vec::new() };
    let words = with_store(|st| st.data.words.clone());
    let prepared = text::prepare(raw, &words.words, &words.replacements, &snippets);
    let mut body = prepared.text.clone();
    if bool_of(s, "cleanup", false) && style != Style::Verbatim && text::word_count(&body) >= 3 {
        if let Some(clean) = cleanup(app, &body, style, app_id, &words.words, lang == "en") {
            if text::plausible(&clean, &body) && text::keeps_marks(&clean, &prepared.snippets) {
                body = clean;
            }
        }
    }
    text::finish(&body, &prepared.snippets)
}

/// Les snippets du Presse-papiers (module allumé) : leur nom se dit.
fn voice_snippets(app: &AppHandle) -> Vec<VoiceSnippet> {
    let Ok(list) = super::invoke(app, "clipboard", "list", json!({ "query": "" })) else { return Vec::new() };
    list["snippets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| Some(VoiceSnippet { trigger: n["name"].as_str()?.to_string(), text: n["text"].as_str()?.to_string() }))
        .collect()
}

/// Le texte part vers l'IA de Parler à Ondine ; None si pas de clé, erreur ou trop lent.
fn cleanup(app: &AppHandle, body: &str, style: Style, app_id: Option<&str>, words: &[String], english: bool) -> Option<String> {
    let ask = module_values(app, "askclaude");
    let provider = Provider::from_id(str_of(&ask, "provider", "claude"));
    let model = super::askclaude::model_from(&ask, provider).ok()?;
    let key = super::with_context(app, ID, |ctx| {
        ctx.require("claude-api")?;
        ctx.credential(provider.credential_key())
    })?
    .ok()
    .flatten()?;
    let system = text::cleanup_system(style, app_id.map(text::display_name).as_deref(), words, english);
    let turns = [Turn { user: true, text: text::cleanup_user(body), attachment: None, notes: None }];
    let (url, req) = providers::request(provider, &Request { model: &model, max_tokens: 1024, system: &system, turns: &turns, tools: &[], extra: &[] });
    log::info(format!("dictée : texte envoyé à {} pour la remise au propre ({} caractères)", provider.destination(), body.chars().count()));
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(providers::call(provider, &key, &url, &req));
    });
    match rx.recv_timeout(CLEANUP_TIMEOUT) {
        Ok(Ok(v)) => Some(text::cleanup_answer(v["answer"].as_str().unwrap_or(""))),
        Ok(Err(e)) => {
            log::warn(format!("dictée : remise au propre impossible : {e}"));
            None
        }
        Err(_) => {
            log::warn("dictée : remise au propre trop lente, texte collé tel qu'entendu");
            None
        }
    }
}

/// Le raccourci « recoller la dernière dictée ».
fn paste_again(app: &AppHandle) {
    if !super::is_active(app, ID) {
        return;
    }
    let Some(last) = with_store(|st| st.last_text()) else {
        message(app, "empty", None, None);
        return;
    };
    crate::platform::wait_modifiers_released(Duration::from_millis(800));
    match deliver(&last) {
        Outcome::Pasted => {}
        Outcome::Copied => message(app, "copied", None, None),
        Outcome::Failed => message(app, "failed", None, None),
    }
}

// ── Le module ────────────────────────────────────────────────────────────────

fn arg_u64(args: &Value, key: &str) -> Result<u64, String> {
    args.get(key).and_then(Value::as_u64).ok_or_else(|| format!("argument « {key} » manquant"))
}

impl RustModule for Dictation {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/dictation/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (tx, rx) = mpsc::channel::<Msg>();
        *rt().tx.locked() = Some(tx.clone());
        let a = app.clone();
        std::thread::Builder::new().name("ondine-dictee".into()).spawn(move || key_loop(a, rx)).ok();
        let a = app.clone();
        std::thread::spawn(move || sync_loop(a, tx));
        // L'historique trop vieux part au démarrage (sans rien charger si le module est coupé).
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            if let Some(s) = settings(&a) {
                with_store(|st| {
                    if st.prune(keep(&s), store::now_ms()) {
                        st.save();
                    }
                });
            }
        });
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let app = ctx.app;
        match command {
            // L'état pour la page Dictée.
            "status" => {
                let s = ctx.settings();
                let ready = speech::ready();
                let engine = Engine::pick(str_of(&s, "engine", "auto"), ready);
                let has_api_key = [Provider::OpenAi, Provider::Gemini].iter().any(|p| ctx.credential(p.credential_key()).ok().flatten().is_some());
                let ask = module_values(app, "askclaude");
                let provider = Provider::from_id(str_of(&ask, "provider", "claude"));
                Ok(json!({
                    "phase": rt().phase.locked().id(),
                    "engine": engine.id(),
                    "parakeetReady": ready,
                    "hasApiKey": has_api_key,
                    "cleanupDestination": provider.destination(),
                    "windows": cfg!(windows),
                }))
            }
            // { query, limit } → { items, total }
            "history" => {
                let query = args.get("query").and_then(Value::as_str).unwrap_or("");
                let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(200).min(2000) as usize;
                Ok(with_store(|st| json!({ "items": st.search(query, limit), "total": st.data.history.len() })))
            }
            "delete" => {
                let id = arg_u64(&args, "id")?;
                Ok(json!(with_store(|st| st.delete(id))))
            }
            // { stats } : vider l'historique (et les chiffres si stats).
            "clear" => {
                let stats = args.get("stats").and_then(Value::as_bool).unwrap_or(false);
                with_store(|st| st.clear(stats));
                Ok(Value::Null)
            }
            // Copie une dictée de l'historique (gardée hors des historiques du presse-papiers).
            "copy" => {
                ctx.require("clipboard")?;
                let id = arg_u64(&args, "id")?;
                let text = with_store(|st| st.find(id).map(|e| e.text.clone())).ok_or("dictée introuvable")?;
                if os::copy(&text) {
                    Ok(Value::Null)
                } else {
                    Err("le presse-papiers est occupé, réessayez".into())
                }
            }
            "stats" => Ok(with_store(|st| st.stats(store::today()))),
            "words" => Ok(with_store(|st| serde_json::to_value(&st.data.words).unwrap_or(Value::Null))),
            "set_words" => {
                let words: Words = serde_json::from_value(args).map_err(|e| format!("dictionnaire illisible : {e}"))?;
                Ok(with_store(|st| {
                    st.set_words(words);
                    serde_json::to_value(&st.data.words).unwrap_or(Value::Null)
                }))
            }
            "styles" => Ok(with_store(|st| json!({ "styles": st.data.styles }))),
            "set_styles" => {
                let styles: Vec<AppStyle> = serde_json::from_value(args.get("styles").cloned().unwrap_or(Value::Null)).map_err(|e| format!("styles illisibles : {e}"))?;
                Ok(with_store(|st| {
                    st.set_styles(styles);
                    json!({ "styles": st.data.styles })
                }))
            }
            // Les applis ouvertes, pour ajouter un style.
            "running_apps" => {
                let apps: Vec<Value> = os::running_apps()
                    .into_iter()
                    .filter(|a| !text::is_shell(a))
                    .map(|a| json!({ "id": store::clean_app_id(&a), "name": text::display_name(&a) }))
                    .collect();
                Ok(json!({ "apps": apps }))
            }
            // Les noms des snippets qu'on peut dire.
            "snippets" => {
                let names: Vec<String> = voice_snippets(app).into_iter().map(|n| n.trigger).collect();
                Ok(json!({ "clipboard": super::module_enabled(app, "clipboard"), "names": names }))
            }
            "hands_free" => {
                send(Msg::Dictate);
                Ok(Value::Null)
            }
            "paste_again" => {
                let app = app.clone();
                std::thread::spawn(move || paste_again(&app));
                Ok(Value::Null)
            }
            // La pilule : son état au démarrage de la page.
            "pill_state" => Ok(serde_json::to_value(rt().view.locked().clone()).unwrap_or(Value::Null)),
            // { rects: [{x,y,w,h}] } : les cases qui prennent la souris.
            "pill_hit" => {
                let rects: Vec<crate::pet::HitRect> = serde_json::from_value(args.get("rects").cloned().unwrap_or(Value::Null)).unwrap_or_default();
                pill::set_hit(app, rects);
                Ok(Value::Null)
            }
            // { action } : dictate, finish, cancel, dismiss, fix (+ fix).
            "pill_action" => {
                match args.get("action").and_then(Value::as_str).unwrap_or("") {
                    "dictate" => send(Msg::Dictate),
                    "finish" => send(Msg::Finish),
                    "cancel" => send(Msg::Cancel),
                    "dismiss" => dismiss(app),
                    "fix" => {
                        let fix = args.get("fix").and_then(Value::as_str).and_then(Fix::from_id).ok_or("page des Paramètres inconnue")?;
                        crate::platform::shell_open(fix.uri())?;
                        dismiss(app);
                    }
                    other => return Err(format!("action inconnue : {other}")),
                }
                Ok(Value::Null)
            }
            _ => Err(format!("commande inconnue : {command}")),
        }
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic == "callnotes.state" {
            {
                let mut v = rt().view.locked();
                v.call = msg.payload.get("recording").and_then(Value::as_bool).unwrap_or(false);
                v.call_started_at = if v.call { msg.payload.get("startedAt").and_then(Value::as_f64) } else { None };
            }
            push_view(ctx.app);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rest(at_rest: bool, presenting: bool) -> Rest {
        Rest { active: true, at_rest, discreet: true, presenting, edge: Edge::Bottom }
    }

    #[test]
    fn the_pill_shows_when_it_should() {
        // Au repos : selon le réglage, et cachée pendant une présentation.
        assert!(pill_visible(rest(true, false), Phase::Idle, false, false));
        assert!(!pill_visible(rest(false, false), Phase::Idle, false, false));
        assert!(!pill_visible(rest(true, true), Phase::Idle, false, false));
        // Discrétion coupée : elle reste.
        assert!(pill_visible(Rest { discreet: false, ..rest(true, true) }, Phase::Idle, false, false));
        // Pendant l'écoute, un message ou un appel : toujours.
        assert!(pill_visible(rest(false, true), Phase::Listening, false, false));
        assert!(pill_visible(rest(false, false), Phase::Idle, true, false));
        assert!(pill_visible(rest(false, false), Phase::Idle, false, true));
        // Module coupé : jamais.
        assert!(!pill_visible(Rest { active: false, ..rest(true, false) }, Phase::Listening, true, true));
    }

    #[test]
    fn phases_have_the_bus_names() {
        assert_eq!(Phase::Idle.id(), "idle");
        assert_eq!(Phase::Listening.id(), "listening");
        assert_eq!(Phase::HandsFree.id(), "handsFree");
        assert_eq!(Phase::Thinking.id(), "thinking");
    }

    #[test]
    fn the_ring_keeps_just_enough_sound() {
        let mut ring = Vec::new();
        for _ in 0..10 {
            push_ring(&mut ring, &[0.1; 300]);
        }
        assert!(ring.len() >= bands::FFT && ring.len() <= bands::FFT * 2);
    }

    #[test]
    fn settings_have_safe_defaults() {
        let s = Map::new();
        assert_eq!(keep(&s), Some(30));
        assert_eq!(default_style(&s), Style::Natural);
        assert!(!bool_of(&s, "cleanup", false));
        assert!(PASTE_HOTKEYS.contains(&"Ctrl+Alt+Shift+V"));
    }
}
