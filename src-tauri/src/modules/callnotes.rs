// Module « Notes d'appel » (1.2.4) : un appel enregistré d'un clic, écrit
// personne par personne, avec un résumé et les choses à faire.
//
// Un clic sur « Enregistrer un appel » (page Notes d'appel des Réglages, ou
// la pilule de dictée par le bus : `callnotes.start` / `callnotes.stop`)
// capte en même temps :
//   - le micro (vous) ;
//   - le son du PC (WASAPI loopback : la voix des autres, sans robot dans la
//     réunion), voir platform/voice.rs `capture`.
// Chaque côté est ramené à 16 kHz et écrit dans un fichier TEMPORAIRE
// (%TEMP%\Ondine-callnotes\<id>-mic.wav et -pc.wav), effacé dès que la
// transcription est écrite. Pendant l'appel, des morceaux qui finissent sur
// une pause sont écrits en direct par Parakeet (services/speech.rs).
//
// À la fin, la transcription (moteur du réglage « engine ») :
//   - « parakeet » (par défaut) : sur le PC, rien ne part. Le micro est écrit
//     morceau par morceau (« Vous »), le son du PC en séparant les voix
//     (`speech::transcribe_speakers`) : « Personne 2 », « Personne 3 »… que
//     l'on peut renommer. Parakeet pas encore téléchargé : on le dit, sans
//     jamais passer à l'API tout seul ;
//   - « api » (seulement si la personne l'a choisi) : l'audio part, morceau par
//     morceau, vers OpenAI ou Gemini avec la clé de Parler à Ondine
//     (askclaude_voice.rs). Les autres voix ne sont pas séparées (« Personne 2 »).
// Le résumé, les points clés et les choses à faire (avec qui) : l'IA de Parler
// à Ondine, avec votre clé, d'un clic (ou tout seul si « autoSummary », coupé
// par défaut). La réponse est lue comme du JSON, jamais exécutée.
//
// Les notes : %APPDATA%\Ondine\callnotes\<id>.json, une par fichier (écriture
// via un fichier temporaire renommé). Supprimer = Corbeille, avec « Annuler ».
// Le texte des appels ne passe jamais par le journal ; le bus ne porte que des
// ids et l'état (`callnotes.state {recording, startedAt}` pour la pilule,
// `callnotes.changed {id}`, `callnotes.error {message}`).

use crate::sync::LockExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::askclaude_providers::{self as providers, Provider};
use super::callnotes_audio::{self as audio, Downsampler, Live, WavWriter};
use super::callnotes_text::{self as text, Line, Note, Speaker, Status, Words};
use super::{ModuleContext, RustModule};
use crate::platform::{self, voice};
use crate::services::bus::BusMessage;
use crate::services::undo::DEFAULT_WINDOW;
use crate::services::{files, log, speech};

const ID: &str = "callnotes";
/// Un appel s'arrête tout seul au bout de 4 heures (un oubli).
const MAX_CALL: Duration = Duration::from_secs(4 * 3600);
/// Les morceaux de la transcription finale : Parakeet, API.
const PARAKEET_SECS: u32 = 30;
const API_SECS: u32 = 60;
/// Ce qui part vers l'IA pour le résumé, au plus (caractères).
const MAX_TRANSCRIPT_CHARS: usize = 200_000;
/// Au plus ce nombre de notes gardées en mémoire et listées.
const MAX_NOTES: usize = 500;

pub const PARAKEET_MISSING: &str = "Parakeet, la reconnaissance sur le PC, n'est pas encore téléchargé : téléchargez-le dans les Réglages (groupe Voix), ou choisissez la transcription par l'API dans les réglages des notes d'appel.";
const ASKCLAUDE_OFF: &str = "Activez « Parler à Ondine » : c'est son IA, avec votre clé, qui écrit le résumé et la transcription par l'API.";
const CLOSED_DURING_CALL: &str = "Ondine s'est fermée avant d'écrire la transcription : cliquez sur « Réessayer ».";
const PC_SOUND_MISSING: &str = "Le son du PC n'a pas pu être enregistré : seul votre micro est noté.";

/// Un côté de l'appel (micro ou son du PC) en train d'être écrit.
#[derive(Default)]
struct Side {
    writer: Option<WavWriter>,
    down: Option<Downsampler>,
    live: Live,
    /// Le fil de capture s'est arrêté sur une erreur.
    failed: bool,
}

impl Side {
    fn push(&mut self, chunk: &[f32], rate: u32, live: bool) {
        let mut out = Vec::with_capacity(chunk.len());
        self.down.get_or_insert_with(|| Downsampler::new(rate)).push(chunk, &mut out);
        if let Some(w) = self.writer.as_mut() {
            if w.write(&out).is_err() {
                self.writer = None; // disque plein… : ce qui est écrit reste
            }
        }
        if live {
            self.live.push(&out);
        }
    }

    fn close(&mut self) {
        if let Some(w) = self.writer.take() {
            let _ = w.finish();
        }
    }
}

struct Recording {
    id: String,
    stop: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
    mic: Arc<Mutex<Side>>,
    pc: Arc<Mutex<Side>>,
}

#[derive(Default)]
struct Inner {
    notes: Mutex<Vec<Note>>,
    recording: Mutex<Option<Recording>>,
    /// Les notes dont la transcription ou le résumé s'écrit.
    working: Mutex<Vec<String>>,
    /// Les mots en direct de l'appel en cours (micro = « me », PC = « pc »).
    live: Mutex<Vec<Line>>,
    starting: AtomicBool,
}

#[derive(Default)]
pub struct CallNotes {
    inner: Arc<Inner>,
}

// ── Petits outils ────────────────────────────────────────────────────────────

fn emit(app: &AppHandle, topic: &str, payload: Value) {
    super::with_context(app, ID, |ctx| ctx.emit(topic, payload));
}

/// L'état de l'enregistrement pour la pilule : publié même si le module vient
/// d'être coupé (l'arrêt qui suit doit éteindre le point rouge partout).
fn emit_state(app: &AppHandle, inner: &Inner) {
    crate::services::bus::emit(app, ID, "callnotes.state", inner.state_payload());
}

fn changed(app: &AppHandle, id: &str) {
    emit(app, "callnotes.changed", json!({ "id": id }));
}

/// Les réglages du module, même désactivé (une transcription finit de s'écrire).
fn settings(app: &AppHandle) -> Map<String, Value> {
    let shared = app.state::<crate::Shared>();
    let s = shared.settings.locked();
    s.modules.get(ID).map(|m| m.values.clone()).unwrap_or_default()
}

fn engine(s: &Map<String, Value>) -> &'static str {
    if s.get("engine").and_then(Value::as_str) == Some("api") {
        "api"
    } else {
        "parakeet"
    }
}

/// La langue de l'appel pour la reconnaissance : None = détection.
fn call_lang(s: &Map<String, Value>) -> Option<&'static str> {
    match s.get("language").and_then(Value::as_str) {
        Some("fr") => Some("fr"),
        Some("en") => Some("en"),
        _ => None,
    }
}

/// (langue de l'appli, tutoiement)
fn app_voice(app: &AppHandle) -> (&'static str, bool) {
    let shared = app.state::<crate::Shared>();
    let s = shared.settings.locked();
    let lang = crate::app_language(&s);
    (lang, crate::services::settings::tutoie(&s.general, lang))
}

fn me_name(app: &AppHandle) -> &'static str {
    match app_voice(app) {
        ("en", _) => "You",
        (_, true) => "Toi",
        _ => "Vous",
    }
}

fn person_name(app: &AppHandle) -> impl Fn(usize) -> String {
    let en = app_voice(app).0 == "en";
    move |n| if en { format!("Person {n}") } else { format!("Personne {n}") }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// %APPDATA%\Ondine\callnotes
fn notes_dir() -> PathBuf {
    platform::config_dir().join("callnotes")
}

fn note_path(id: &str) -> PathBuf {
    notes_dir().join(format!("{id}.json"))
}

/// %TEMP%\Ondine-callnotes : l'audio, le temps d'écrire la transcription.
fn audio_dir() -> PathBuf {
    std::env::temp_dir().join("Ondine-callnotes")
}

fn mic_path(id: &str) -> PathBuf {
    audio_dir().join(format!("{id}-mic.wav"))
}

fn pc_path(id: &str) -> PathBuf {
    audio_dir().join(format!("{id}-pc.wav"))
}

fn delete_audio(id: &str) {
    let _ = std::fs::remove_file(mic_path(id));
    let _ = std::fs::remove_file(pc_path(id));
}

fn save(note: &Note) -> Result<(), String> {
    let dir = notes_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(note).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{}.json.tmp", note.id));
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, note_path(&note.id)).map_err(|e| e.to_string())
}

fn load_one(path: &Path) -> Option<Note> {
    let note: Note = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    text::valid_id(&note.id).then_some(note)
}

/// Relit toutes les notes (les plus récentes d'abord). Un fichier illisible est laissé tel quel.
fn load_all() -> Vec<Note> {
    let mut notes: Vec<Note> = std::fs::read_dir(notes_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| load_one(&e.path()))
        .collect();
    notes.sort_by_key(|n| std::cmp::Reverse(n.start));
    notes.truncate(MAX_NOTES);
    notes
}

fn arg_id(args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(Value::as_str).unwrap_or("");
    if text::valid_id(id) {
        Ok(id.to_string())
    } else {
        Err("note introuvable".into())
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Le titre par défaut : « Appel du 15/10 à 10:00 ».
fn default_title(app: &AppHandle) -> String {
    let t = platform::local_time();
    if app_voice(app).0 == "en" {
        format!("Call on {:02}/{:02} at {:02}:{:02}", t.day, t.month, t.hour, t.minute)
    } else {
        format!("Appel du {:02}/{:02} à {:02}:{:02}", t.day, t.month, t.hour, t.minute)
    }
}

fn local_stamp() -> String {
    let t = platform::local_time();
    format!("{:04}-{:02}-{:02} {:02}:{:02}", t.year, t.month, t.day, t.hour, t.minute)
}

impl Inner {
    fn note(&self, id: &str) -> Option<Note> {
        self.notes.locked().iter().find(|n| n.id == id).cloned()
    }

    /// Change une note, l'enregistre et prévient la page.
    fn change(&self, app: &AppHandle, id: &str, f: impl FnOnce(&mut Note)) -> Option<Note> {
        let updated = {
            let mut notes = self.notes.locked();
            let note = notes.iter_mut().find(|n| n.id == id)?;
            f(note);
            note.clone()
        };
        if let Err(e) = save(&updated) {
            log::warn(format!("notes d'appel : enregistrement impossible ({e})"));
        }
        changed(app, id);
        Some(updated)
    }

    fn recording_id(&self) -> Option<String> {
        self.recording.locked().as_ref().map(|r| r.id.clone())
    }

    fn is_working(&self, id: &str) -> bool {
        self.working.locked().iter().any(|w| w == id)
    }

    fn set_working(&self, id: &str, on: bool) {
        let mut w = self.working.locked();
        w.retain(|x| x != id);
        if on {
            w.push(id.to_string());
        }
    }

    fn state_payload(&self) -> Value {
        let started = self.recording_id().and_then(|id| self.note(&id)).map(|n| n.start);
        json!({ "recording": started.is_some(), "startedAt": started })
    }
}

// ── Enregistrer ──────────────────────────────────────────────────────────────

/// Lance un fil de capture ; attend un instant pour savoir s'il a pu s'ouvrir.
fn spawn_capture(source: voice::Source, side: Arc<Mutex<Side>>, stop: Arc<AtomicBool>, live: bool) -> (std::thread::JoinHandle<()>, Option<String>) {
    let (tx, rx) = mpsc::channel::<String>();
    let handle = std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            voice::capture(source, &stop, &mut |chunk, rate| side.locked().push(chunk, rate, live))
        }));
        let error = match result {
            Ok(Ok(())) => return,
            Ok(Err(f)) => {
                if !f.detail.is_empty() {
                    log::warn(format!("notes d'appel : {}", f.detail));
                }
                f.message
            }
            Err(_) => "la capture du son a planté".to_string(),
        };
        side.locked().failed = true;
        let _ = tx.send(error);
    });
    // Une erreur d'ouverture arrive tout de suite ; au-delà, la capture tourne.
    let early = rx.recv_timeout(Duration::from_millis(800)).ok();
    (handle, early)
}

impl CallNotes {
    fn record(&self, app: &AppHandle) -> Result<String, String> {
        if self.inner.recording.locked().is_some() || self.inner.starting.swap(true, Ordering::SeqCst) {
            return Err("un appel est déjà en cours d'enregistrement".into());
        }
        let result = self.start_inner(app);
        self.inner.starting.store(false, Ordering::SeqCst);
        result
    }

    fn start_inner(&self, app: &AppHandle) -> Result<String, String> {
        let s = settings(app);
        let engine = engine(&s);
        if engine == "parakeet" && !speech::ready() {
            return Err(PARAKEET_MISSING.into());
        }
        if engine == "api" {
            // Seulement vérifier qu'une clé est là : rien ne part maintenant.
            let ask = super::with_context(app, "askclaude", |ctx| ctx.settings()).ok_or(ASKCLAUDE_OFF)?;
            super::askclaude_voice::stt_key(app, &ask)?;
        }
        std::fs::create_dir_all(audio_dir()).map_err(|e| format!("dossier temporaire impossible : {e}"))?;
        let mut start = now_ms();
        while note_path(&start.to_string()).exists() || mic_path(&start.to_string()).exists() {
            start += 1;
        }
        let id = start.to_string();
        let live = engine == "parakeet";
        let open = |path: PathBuf| -> Result<Arc<Mutex<Side>>, String> {
            let writer = WavWriter::create(&path).map_err(|e| format!("fichier temporaire impossible : {e}"))?;
            Ok(Arc::new(Mutex::new(Side { writer: Some(writer), ..Side::default() })))
        };
        let mic = open(mic_path(&id))?;
        let pc = open(pc_path(&id))?;
        let stop = Arc::new(AtomicBool::new(false));
        let (mic_thread, mic_error) = spawn_capture(voice::Source::Mic, mic.clone(), stop.clone(), live);
        if let Some(err) = mic_error {
            stop.store(true, Ordering::SeqCst);
            let _ = mic_thread.join();
            mic.locked().close();
            pc.locked().close();
            delete_audio(&id);
            return Err(format!("le micro ne s'ouvre pas : {err}"));
        }
        let (pc_thread, pc_error) = spawn_capture(voice::Source::Speakers, pc.clone(), stop.clone(), live);
        if let Some(err) = &pc_error {
            log::warn(format!("notes d'appel : son du PC indisponible ({err})"));
        }
        let note = Note {
            id: id.clone(),
            title: default_title(app),
            title_edited: false,
            start,
            end: None,
            start_local: local_stamp(),
            status: Status::Recording,
            engine: engine.into(),
            speakers: Vec::new(),
            lines: Vec::new(),
            summary: None,
            key_points: Vec::new(),
            todos: Vec::new(),
            error: None,
            warning: pc_error.map(|_| PC_SOUND_MISSING.to_string()),
        };
        let _ = save(&note);
        {
            let mut notes = self.inner.notes.locked();
            notes.insert(0, note);
            notes.truncate(MAX_NOTES);
        }
        self.inner.live.locked().clear();
        *self.inner.recording.locked() = Some(Recording { id: id.clone(), stop: stop.clone(), threads: vec![mic_thread, pc_thread], mic: mic.clone(), pc: pc.clone() });
        self.spawn_ticker(app.clone(), id.clone(), mic, pc, stop, live);
        log::info("notes d'appel : enregistrement commencé");
        emit_state(app, &self.inner);
        changed(app, &id);
        Ok(id)
    }

    /// Chaque seconde : les mots en direct (Parakeet), et l'arrêt tout seul
    /// (module coupé, 4 heures passées, micro perdu).
    fn spawn_ticker(&self, app: AppHandle, id: String, mic: Arc<Mutex<Side>>, pc: Arc<Mutex<Side>>, stop: Arc<AtomicBool>, live: bool) {
        let inner = self.inner.clone();
        let lang = call_lang(&settings(&app));
        std::thread::spawn(move || {
            let begun = Instant::now();
            while !stop.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_secs(1));
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                let mic_lost = mic.locked().failed;
                if !super::is_active(&app, ID) || begun.elapsed() > MAX_CALL || mic_lost {
                    let module = CallNotes { inner: inner.clone() };
                    module.stop_recording(&app);
                    break;
                }
                if !live {
                    continue;
                }
                for (side, who) in [(&mic, text::ME), (&pc, text::PC)] {
                    let chunk = side.locked().live.take();
                    let Some((start, samples)) = chunk else { continue };
                    let result = std::panic::catch_unwind(|| speech::transcribe(&samples, lang));
                    let Ok(Ok(words)) = result else { continue };
                    let words = words.trim().to_string();
                    if words.is_empty() || stop.load(Ordering::SeqCst) {
                        continue;
                    }
                    let end = start + samples.len() as f64 / f64::from(speech::SAMPLE_RATE);
                    {
                        let mut l = inner.live.locked();
                        l.push(Line { speaker: who.into(), start, end, text: words });
                        l.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
                    }
                    changed(&app, &id);
                }
            }
        });
    }

    fn stop_recording(&self, app: &AppHandle) {
        let Some(mut rec) = self.inner.recording.locked().take() else { return };
        rec.stop.store(true, Ordering::SeqCst);
        // Les fils de capture s'arrêtent en 20 ms ; le fil des mots en direct
        // (peut-être en train d'écrire un morceau) finit tout seul.
        for t in rec.threads.drain(..) {
            let _ = t.join();
        }
        rec.mic.locked().close();
        let pc_failed = {
            let mut pc = rec.pc.locked();
            pc.close();
            pc.failed
        };
        self.inner.live.locked().clear();
        self.inner.change(app, &rec.id, |n| {
            n.end = Some(now_ms());
            n.status = Status::Processing;
            if pc_failed && n.warning.is_none() {
                n.warning = Some(PC_SOUND_MISSING.into());
            }
        });
        log::info("notes d'appel : enregistrement arrêté");
        emit_state(app, &self.inner);
        let (inner, app, id) = (self.inner.clone(), app.clone(), rec.id.clone());
        std::thread::spawn(move || process(&app, &inner, &id));
    }
}

// ── Écrire la transcription, puis le résumé ──────────────────────────────────

/// Écrit la transcription depuis les fichiers audio, les efface, puis lance
/// le résumé si le réglage « autoSummary » le demande.
fn process(app: &AppHandle, inner: &Arc<Inner>, id: &str) {
    if inner.is_working(id) {
        return;
    }
    let Some(note) = inner.note(id) else { return };
    inner.set_working(id, true);
    changed(app, id);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| transcript(app, &note))).unwrap_or_else(|_| Err("la transcription a planté".into()));
    match result {
        Ok((speakers, lines)) => {
            let count = lines.len();
            inner.change(app, id, |n| {
                n.speakers = speakers;
                n.lines = lines;
                n.status = Status::Ready;
                n.error = None;
            });
            // La transcription est écrite : l'audio n'existe plus.
            delete_audio(id);
            log::info(format!("notes d'appel : transcription écrite ({count} tours de parole)"));
        }
        Err(e) => {
            log::warn(format!("notes d'appel : transcription impossible ({e})"));
            inner.change(app, id, |n| {
                n.status = Status::Failed;
                n.error = Some(e);
            });
        }
    }
    inner.set_working(id, false);
    changed(app, id);
    let ready = inner.note(id).is_some_and(|n| n.status == Status::Ready && !n.lines.is_empty());
    if ready && settings(app).get("autoSummary").and_then(Value::as_bool) == Some(true) {
        if let Err(e) = summarize(app, inner, id) {
            log::warn(format!("notes d'appel : résumé impossible ({e})"));
            emit(app, "callnotes.error", json!({ "message": e }));
        }
    }
}

fn read_side(path: &Path) -> Result<Vec<f32>, String> {
    if path.exists() {
        audio::read_wav(path)
    } else {
        Ok(Vec::new())
    }
}

fn lines_of(samples: &[f32], max_secs: u32, who: &str, mut write: impl FnMut(&[f32]) -> Result<String, String>) -> Result<Vec<Line>, String> {
    let rate = f64::from(speech::SAMPLE_RATE);
    let mut out = Vec::new();
    for (a, b) in audio::segments(samples, max_secs) {
        let words = write(&samples[a..b])?;
        let words = words.trim();
        if !words.is_empty() {
            out.push(Line { speaker: who.into(), start: a as f64 / rate, end: b as f64 / rate, text: words.to_string() });
        }
    }
    Ok(out)
}

fn turns_to_lines(turns: Vec<speech::Turn>) -> Vec<Line> {
    turns.into_iter().map(|t| Line { speaker: t.speaker.to_string(), start: f64::from(t.start), end: f64::from(t.end), text: t.text }).collect()
}

/// La transcription personne par personne d'une note dont l'audio est là.
fn transcript(app: &AppHandle, note: &Note) -> Result<(Vec<Speaker>, Vec<Line>), String> {
    let mic_file = mic_path(&note.id);
    if !mic_file.exists() && !pc_path(&note.id).exists() {
        return Err("l'enregistrement de cet appel n'existe plus".into());
    }
    let s = settings(app);
    let lang = call_lang(&s);
    let mic = read_side(&mic_file)?;
    let pc = read_side(&pc_path(&note.id))?;
    let pc_speech = audio::peak(&pc) >= audio::QUIET;
    let (mine, others) = if note.engine == "api" {
        let ask = super::with_context(app, "askclaude", |ctx| ctx.settings()).ok_or(ASKCLAUDE_OFF)?;
        let (provider, key, model) = super::askclaude_voice::stt_key(app, &ask)?;
        let api_lang = lang.unwrap_or(app_voice(app).0);
        log::info(format!("notes d'appel : audio envoyé à {} pour la transcription", provider.destination()));
        let mut send = |part: &[f32]| super::askclaude_voice::transcribe(provider, &key, &model, &super::askclaude_voice::wav_16k(part, speech::SAMPLE_RATE), api_lang);
        let mine = lines_of(&mic, API_SECS, text::ME, &mut send)?;
        let others = if pc_speech { lines_of(&pc, API_SECS, text::PC, &mut send)? } else { Vec::new() };
        (mine, others)
    } else {
        if !speech::ready() {
            return Err(PARAKEET_MISSING.into());
        }
        let others = if pc_speech { turns_to_lines(speech::transcribe_speakers(&pc, lang)?) } else { Vec::new() };
        if others.is_empty() && audio::peak(&mic) >= audio::QUIET {
            // Rien du PC : plusieurs personnes autour du même PC ? On sépare les voix du micro.
            let room = turns_to_lines(speech::transcribe_speakers(&mic, lang)?);
            let voices: std::collections::HashSet<&str> = room.iter().map(|l| l.speaker.as_str()).collect();
            if voices.len() > 1 {
                return Ok(text::build_room(room, person_name(app)));
            }
            let mine = room.into_iter().map(|mut l| {
                l.speaker = text::ME.into();
                l
            });
            return Ok(text::build(mine.collect(), Vec::new(), me_name(app), person_name(app)));
        }
        let mine = lines_of(&mic, PARAKEET_SECS, text::ME, |part| speech::transcribe(part, lang))?;
        (mine, others)
    };
    drop(mic);
    drop(pc);
    Ok(text::build(mine, others, me_name(app), person_name(app)))
}

/// L'IA de Parler à Ondine (fournisseur, clé, modèle), lue sans rien envoyer.
fn summary_ai(app: &AppHandle) -> Result<(Provider, String, String), String> {
    super::with_context(app, "askclaude", |ctx| -> Result<(Provider, String, String), String> {
        let provider = super::askclaude::provider(ctx);
        let model = super::askclaude::model(ctx, provider)?;
        let key = ctx.credential(provider.credential_key())?.ok_or_else(|| format!("pas de {} : ajoutez-la dans Réglages → Identifiants", provider.key_label().to_lowercase()))?;
        Ok((provider, key, model))
    })
    .unwrap_or_else(|| Err(ASKCLAUDE_OFF.into()))
}

/// Écrit le résumé, les points clés et les choses à faire. La transcription
/// (texte seulement, jamais l'audio) part vers l'IA de Parler à Ondine.
fn summarize(app: &AppHandle, inner: &Arc<Inner>, id: &str) -> Result<(), String> {
    let note = inner.note(id).ok_or("note introuvable")?;
    if note.lines.is_empty() {
        return Err("rien à résumer : la transcription est vide".into());
    }
    if inner.is_working(id) {
        return Err("cette note est déjà en train de s'écrire".into());
    }
    let (provider, key, model) = summary_ai(app)?;
    inner.set_working(id, true);
    changed(app, id);
    let transcript: String = text::plain_transcript(&note).chars().take(MAX_TRANSCRIPT_CHARS).collect();
    let lang = app_voice(app).0;
    let turn = providers::Turn { user: true, text: format!("<transcription>\n{transcript}\n</transcription>"), attachment: None, notes: None };
    let request = providers::Request { model: &model, max_tokens: 2048, system: text::summary_prompt(lang), turns: &[turn], tools: &[], extra: &[] };
    let (url, body) = providers::request(provider, &request);
    log::info(format!("notes d'appel : transcription envoyée à {} pour le résumé", provider.destination()));
    let answer = providers::call(provider, &key, &url, &body);
    inner.set_working(id, false);
    let answer = match answer {
        Ok(a) => a,
        Err(e) => {
            changed(app, id);
            return Err(e);
        }
    };
    let reply = answer["answer"].as_str().unwrap_or("").to_string();
    inner.change(app, id, |n| match text::parse_summary(&reply) {
        Some(parsed) => {
            if let Some(title) = parsed.title.filter(|_| !n.title_edited) {
                n.title = title;
            }
            n.summary = Some(parsed.summary).filter(|s| !s.is_empty());
            n.key_points = parsed.key_points;
            n.todos = parsed.todos;
        }
        // Pas de JSON : le texte est gardé comme résumé, tel quel (jamais exécuté).
        None => n.summary = Some(reply.trim().chars().take(4000).collect()),
    });
    Ok(())
}

// ── Ce que voit la page ──────────────────────────────────────────────────────

/// La liste (sans la transcription) : de quoi dessiner la colonne de gauche.
fn list_json(inner: &Inner) -> Value {
    let working = inner.working.locked().clone();
    let notes: Vec<Value> = inner
        .notes
        .locked()
        .iter()
        .map(|n| {
            json!({
                "id": n.id, "title": n.title, "start": n.start, "end": n.end,
                "status": n.status, "people": n.speakers.len(), "working": working.contains(&n.id),
            })
        })
        .collect();
    json!({ "notes": notes })
}

/// Une note entière ; pendant l'appel, avec les mots en direct.
fn note_json(app: &AppHandle, inner: &Inner, id: &str) -> Result<Value, String> {
    let mut note = inner.note(id).ok_or("note introuvable")?;
    if note.status == Status::Recording {
        note.speakers = vec![
            Speaker { id: text::ME.into(), name: me_name(app).into(), color: 0, me: true },
            Speaker { id: text::PC.into(), name: if app_voice(app).0 == "en" { "The PC".into() } else { "Le PC".into() }, color: 1, me: false },
        ];
        note.lines = inner.live.locked().clone();
    }
    let mut v = serde_json::to_value(&note).map_err(|e| e.to_string())?;
    v["working"] = json!(inner.is_working(id));
    Ok(v)
}

/// Ce qui part, et vers où (page des Réglages).
fn status_json(app: &AppHandle, inner: &Inner) -> Value {
    let s = settings(app);
    let (stt, ai) = super::with_context(app, "askclaude", |ctx| {
        let provider = super::askclaude::provider(ctx);
        let stt = super::askclaude_voice::stt_key(app, &ctx.settings()).ok().map(|(p, _, _)| p.destination());
        let has_key = crate::services::credentials::exists(provider.credential_key());
        (stt, json!({ "destination": provider.destination(), "key": has_key }))
    })
    .unwrap_or((None, Value::Null));
    let mut v = inner.state_payload();
    v["engine"] = json!(engine(&s));
    v["parakeet"] = json!(speech::ready());
    v["sttDestination"] = json!(stt);
    v["ai"] = ai;
    v["autoSummary"] = json!(s.get("autoSummary").and_then(Value::as_bool).unwrap_or(false));
    v
}

/// « Enregistrer sous » : un .md, dans un dossier qui n'est pas exclu.
fn export(ctx: &ModuleContext, note: &Note) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let (lang, _) = app_voice(ctx.app);
    let mut dialog = ctx.app.dialog().file().set_title(if lang == "en" { "Export the call notes" } else { "Exporter la note d'appel" }).set_file_name(text::file_name(&note.title)).add_filter("Markdown", &["md"]);
    if let Some(w) = ctx.app.get_webview_window("settings") {
        dialog = dialog.set_parent(&w);
    }
    let Some(picked) = dialog.blocking_save_file().and_then(|p| p.into_path().ok()) else { return Ok(json!({ "saved": null })) };
    let path = if picked.extension().is_none() { picked.with_extension("md") } else { picked };
    let parent = path.parent().ok_or("dossier introuvable")?;
    // Les dossiers exclus (Confidentialité) restent intouchables.
    ctx.check_path(&parent.to_string_lossy())?;
    std::fs::write(&path, text::markdown(note, &Words::of(lang))).map_err(|e| format!("enregistrement impossible : {e}"))?;
    ctx.log_info("note d'appel exportée en Markdown");
    Ok(json!({ "saved": path.file_name().map(|n| n.to_string_lossy().to_string()) }))
}

impl RustModule for CallNotes {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/callnotes/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let mut notes = load_all();
        let mut resume = Vec::new();
        for n in notes.iter_mut().filter(|n| matches!(n.status, Status::Recording | Status::Processing)) {
            // Ondine fermée pendant un appel ou son écriture. En local, on finit
            // tout seul ; vers l'API, il faut un clic (rien ne part sans vous).
            n.end.get_or_insert(n.start);
            if n.engine != "api" && speech::ready() {
                n.status = Status::Processing;
                resume.push(n.id.clone());
            } else {
                n.status = Status::Failed;
                n.error = Some(CLOSED_DURING_CALL.into());
            }
            let _ = save(n);
        }
        // L'audio d'une note écrite ou supprimée n'a rien à faire là.
        let files: Vec<String> = std::fs::read_dir(audio_dir()).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        let known: Vec<(String, Status)> = notes.iter().map(|n| (n.id.clone(), n.status)).collect();
        for f in text::stale_audio(&files, &known) {
            let _ = std::fs::remove_file(audio_dir().join(f));
        }
        *self.inner.notes.locked() = notes;
        for id in resume {
            let (inner, app) = (self.inner.clone(), app.clone());
            std::thread::spawn(move || process(&app, &inner, &id));
        }
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        match msg.topic.as_str() {
            "callnotes.start" => {
                if let Err(e) = self.record(ctx.app) {
                    ctx.emit("callnotes.error", json!({ "message": e }));
                }
            }
            "callnotes.stop" => self.stop_recording(ctx.app),
            _ => {}
        }
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let inner = &self.inner;
        match command {
            "status" => Ok(status_json(ctx.app, inner)),
            "list" => Ok(list_json(inner)),
            "get" => note_json(ctx.app, inner, &arg_id(&args)?),
            "start" => self.record(ctx.app).map(|id| json!({ "id": id })),
            "stop" => {
                self.stop_recording(ctx.app);
                Ok(Value::Null)
            }
            "rename" => {
                let id = arg_id(&args)?;
                let title: String = arg_str(&args, "title").trim().chars().filter(|c| !c.is_control()).take(120).collect();
                if title.is_empty() {
                    return Err("le titre est vide".into());
                }
                inner.change(ctx.app, &id, |n| {
                    n.title = title;
                    n.title_edited = true;
                });
                Ok(Value::Null)
            }
            "rename_speaker" => {
                let id = arg_id(&args)?;
                let mut note = inner.note(&id).ok_or("note introuvable")?;
                text::rename_speaker(&mut note, arg_str(&args, "speaker"), arg_str(&args, "name"))?;
                inner.change(ctx.app, &id, |n| {
                    n.speakers = note.speakers;
                    n.todos = note.todos;
                });
                Ok(Value::Null)
            }
            "toggle_todo" => {
                let id = arg_id(&args)?;
                let todo = args.get("todo").and_then(Value::as_u64).ok_or("tâche introuvable")? as u32;
                inner.change(ctx.app, &id, |n| {
                    if let Some(t) = n.todos.iter_mut().find(|t| t.id == todo) {
                        t.done = !t.done;
                    }
                });
                Ok(Value::Null)
            }
            "delete" => {
                let id = arg_id(&args)?;
                if inner.recording_id().as_deref() == Some(id.as_str()) {
                    return Err("arrêtez d'abord l'enregistrement".into());
                }
                if inner.is_working(&id) {
                    return Err("attendez la fin de l'écriture de cette note".into());
                }
                let path = note_path(&id);
                if path.exists() {
                    files::to_trash(std::slice::from_ref(&path))?;
                }
                // L'audio, lui, n'est jamais gardé (ni dans la Corbeille).
                delete_audio(&id);
                inner.notes.locked().retain(|n| n.id != id);
                changed(ctx.app, &id);
                let (inner2, app) = (self.inner.clone(), ctx.app.clone());
                ctx.offer_undo(
                    if app_voice(ctx.app).0 == "en" { "Call note deleted" } else { "Note d'appel supprimée" },
                    DEFAULT_WINDOW,
                    Box::new(move || {
                        files::restore_from_trash(&path)?;
                        let note = load_one(&path).ok_or("note illisible")?;
                        let id = note.id.clone();
                        {
                            let mut notes = inner2.notes.locked();
                            notes.push(note);
                            notes.sort_by_key(|n| std::cmp::Reverse(n.start));
                        }
                        changed(&app, &id);
                        Ok(())
                    }),
                );
                Ok(Value::Null)
            }
            "summarize" => {
                ctx.require("claude-api")?;
                summarize(ctx.app, inner, &arg_id(&args)?).map(|()| Value::Null)
            }
            "retry" => {
                let id = arg_id(&args)?;
                let note = inner.note(&id).ok_or("note introuvable")?;
                if note.status != Status::Failed {
                    return Err("cette note n'est pas à réessayer".into());
                }
                inner.change(ctx.app, &id, |n| {
                    n.status = Status::Processing;
                    n.error = None;
                });
                let (inner, app) = (self.inner.clone(), ctx.app.clone());
                std::thread::spawn(move || process(&app, &inner, &id));
                Ok(Value::Null)
            }
            "copy" => {
                ctx.require("clipboard")?;
                let note = inner.note(&arg_id(&args)?).ok_or("note introuvable")?;
                files::copy_text(&text::markdown(&note, &Words::of(app_voice(ctx.app).0)))?;
                Ok(Value::Null)
            }
            "export" => {
                let note = inner.note(&arg_id(&args)?).ok_or("note introuvable")?;
                export(ctx, &note)
            }
            "to_notes" => {
                let note = inner.note(&arg_id(&args)?).ok_or("note introuvable")?;
                if !super::is_active(ctx.app, "notes") {
                    return Err("le module Notes est désactivé".into());
                }
                let w = Words::of(app_voice(ctx.app).0);
                ctx.emit("notes.add", json!({ "text": text::note_for_notes(&note, &w) }));
                let mut todos = 0;
                for t in note.todos.iter().filter(|t| !t.done) {
                    ctx.emit("notes.add", json!({ "kind": "todo", "text": text::todo_for_notes(t) }));
                    todos += 1;
                }
                Ok(json!({ "todos": todos }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}
