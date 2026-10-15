// « Dis Ondine » / « Hey Ondine » : le mot d'appel de Parler à Ondine (1.2.4).
//
// Réglage `wakeWord` du module askclaude, COUPÉ PAR DÉFAUT ; les Réglages
// demandent une confirmation explicite avant de l'allumer. Une fois allumé :
//   - le micro choisi (platform/voice.rs `watch`) reste ouvert en permanence,
//     en mémoire seulement. Un petit point rouge reste visible sur l'île
//     (événement `voice.wake {on}`) ;
//   - un seuil d'énergie sur des trames de 30 ms (`WakeGate`, pur, testé)
//     repère le début et la fin de chaque passage parlé. Tant que personne ne
//     parle, rien d'autre ne tourne (pas de Parakeet) ;
//   - les 2,4 premières secondes d'un passage sont écrites par Parakeet
//     (services/speech.rs, sur le PC) et comparées, avec souplesse, à « dis
//     Ondine », « hey Ondine », « hé Ondine », « ok Ondine » (`wake_rest`,
//     pur, testé). Rien n'est gardé, rien n'est envoyé, rien n'est noté au
//     journal tant que le mot n'est pas dit ;
//   - le mot reconnu : comme le raccourci. La phrase continue après le mot
//     (« Hey Ondine, quel temps fait-il ? ») : la suite devient la question ;
//     sinon Parler à Ondine s'ouvre et écoute la suite.
//
// En pause (le micro est fermé) : module coupé, réglage coupé, hors Windows,
// Parakeet pas téléchargé, Ondine écoute déjà (raccourci, dictée, notes
// d'appel : `voice::ondine_capturing`), discrétion (visio, présentation,
// concentration, si le réglage « discreet » est activé), PC verrouillé, mode
// Économie d'énergie (choisi, ou automatique sur batterie).

use std::sync::atomic::AtomicU8;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::AppHandle;

use super::askclaude_voice as voice_mod;
use super::callnotes_audio::Downsampler;
use crate::platform::{self, voice};
use crate::services::{bus, log, perf, speech as stt};
use crate::sync::LockExt;

const ID: &str = "askclaude";
/// Un passage plus long que ça n'est vérifié que sur son début.
const HEAD_SECONDS: f32 = 2.4;

/// L'état montré aux Réglages et à l'île : à l'écoute, ou en pause et pourquoi.
#[derive(Clone, Debug, PartialEq, Eq)]
struct State {
    on: bool,
    /// "off", "windows", "parakeet", "busy", "discreet", "locked", "eco" ; "" à l'écoute.
    paused: &'static str,
}

static STATE: Mutex<State> = Mutex::new(State { on: false, paused: "off" });

/// Pour les Réglages (`wake_state`).
pub fn state() -> Value {
    let s = STATE.locked().clone();
    json!({ "supported": cfg!(windows), "on": s.on, "paused": s.paused, "parakeet": stt::ready() })
}

fn publish(app: &AppHandle, on: bool, paused: &'static str) {
    let next = State { on, paused };
    let mut cur = STATE.locked();
    if *cur != next {
        *cur = next;
        drop(cur);
        // Directement sur le bus : le point de l'île doit s'éteindre même module coupé.
        bus::emit(app, ID, "voice.wake", json!({ "on": on, "paused": paused }));
    }
}

/// Pourquoi ne pas écouter maintenant (None : on écoute).
fn pause_reason(app: &AppHandle) -> Option<&'static str> {
    let wanted = super::with_context(app, ID, |ctx| ctx.settings().get("wakeWord").and_then(Value::as_bool) == Some(true)).unwrap_or(false);
    if !wanted {
        return Some("off");
    }
    if !cfg!(windows) {
        return Some("windows");
    }
    if !stt::ready() {
        return Some("parakeet");
    }
    if voice_mod::listening() || voice::ondine_capturing() {
        return Some("busy");
    }
    if voice_mod::discreet(app).is_some() {
        return Some("discreet");
    }
    if platform::session::locked() == Some(true) {
        return Some("locked");
    }
    if perf::mode() == perf::Mode::Eco {
        return Some("eco");
    }
    None
}

/// Le fil du mot d'appel : il regarde chaque seconde s'il faut écouter.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        loop {
            let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match pause_reason(&app) {
                Some(why) => publish(&app, false, why),
                None => watch(&app),
            }));
            if step.is_err() {
                publish(&app, false, "off");
                log::warn("mot d'appel : erreur inattendue, on réessaie");
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

/// Ce que le fil de capture confie au fil de Parakeet.
enum Job {
    /// Le début d'un passage (ou un passage court, entier si `complete`).
    Check { id: u64, samples: Vec<f32>, complete: bool },
    /// Un long passage entier, une fois fini.
    Full { id: u64, samples: Vec<f32> },
}

/// Écoute jusqu'à une pause (réglage, discrétion…) ou au mot d'appel.
fn watch(app: &AppHandle) {
    publish(app, true, "");
    let stop = AtomicU8::new(0);
    // Parakeet tourne à côté, pour ne pas perdre de son pendant qu'il écrit.
    // Au plus deux passages en attente : le reste est oublié.
    let (tx, rx) = mpsc::sync_channel::<Job>(2);
    let worker = {
        let app = app.clone();
        std::thread::spawn(move || transcriber(&app, rx))
    };
    let mut gate = WakeGate::new();
    let mut down: Option<(u32, Downsampler)> = None;
    let mut pcm16 = Vec::new();
    let mut events = Vec::new();
    let mut checked = Instant::now();
    let result = voice::watch(&stop, &mut |chunk, rate| {
        // Une fois par seconde : faut-il se mettre en pause ?
        if checked.elapsed() >= Duration::from_secs(1) {
            checked = Instant::now();
            if pause_reason(app).is_some() {
                return false;
            }
        }
        // Une écoute a commencé (le mot vient d'être reconnu) : on rend le micro.
        if voice_mod::listening() {
            return false;
        }
        if down.as_ref().map(|(r, _)| *r) != Some(rate) {
            down = Some((rate, Downsampler::new(rate)));
        }
        let Some((_, d)) = down.as_mut() else { return true };
        pcm16.clear();
        d.push(chunk, &mut pcm16);
        events.clear();
        gate.push(&pcm16, &mut events);
        for e in events.drain(..) {
            let _ = tx.try_send(match e {
                WakeEvent::Check { id, samples, complete } => Job::Check { id, samples, complete },
                WakeEvent::Full { id, samples } => Job::Full { id, samples },
            });
        }
        true
    });
    drop(tx);
    let _ = worker.join();
    if let Err(f) = result {
        log::warn(format!("mot d'appel : micro indisponible : {} [{}]", f.message, f.detail));
        publish(app, false, "busy");
        // Un micro qui ne s'ouvre pas : on attend avant de réessayer.
        std::thread::sleep(Duration::from_secs(10));
    }
}

/// Le fil de Parakeet : vérifie chaque passage, déclenche Parler à Ondine.
fn transcriber(app: &AppHandle, rx: mpsc::Receiver<Job>) {
    // Le passage long dont le début contenait le mot (et ce qui suivait).
    let mut armed: Option<(u64, String)> = None;
    for job in rx {
        match job {
            Job::Check { id, samples, complete } => {
                let Ok(text) = stt::transcribe(&samples, None) else { continue };
                let Some(rest) = wake_rest(&text) else { continue };
                if complete {
                    trigger(app, &rest);
                } else {
                    armed = Some((id, rest));
                }
            }
            Job::Full { id, samples } => {
                let Some((armed_id, head_rest)) = armed.take() else { continue };
                if armed_id != id {
                    continue;
                }
                let rest = stt::transcribe(&samples, None).ok().and_then(|t| wake_rest(&t)).unwrap_or(head_rest);
                trigger(app, &rest);
            }
        }
    }
}

/// Le mot est dit : la question qui suit, ou Parler à Ondine qui écoute.
fn trigger(app: &AppHandle, rest: &str) {
    log::info("mot d'appel reconnu");
    if rest.trim().is_empty() {
        if let Err(e) = voice_mod::listen(app, voice_mod::Options { look: false, hold: false, hands_free: false }) {
            log::warn(format!("mot d'appel : {e}"));
        }
    } else {
        voice_mod::heard_text(app, rest);
    }
}

// ── La détection de voix (pure) ──────────────────────────────────────────────

/// Ce que `WakeGate` repère.
#[derive(Debug, PartialEq)]
pub(crate) enum WakeEvent {
    /// À vérifier : un passage court entier (`complete`), ou le début d'un long.
    Check { id: u64, samples: Vec<f32>, complete: bool },
    /// Un long passage entier, une fois fini (son début a déjà été vérifié).
    Full { id: u64, samples: Vec<f32> },
}

/// Repère les passages parlés dans un son 16 kHz mono : trames de 30 ms,
/// niveau (RMS) comparé au bruit de fond qui s'adapte.
pub(crate) struct WakeGate {
    frame: Vec<f32>,
    /// Le bruit de fond (RMS).
    floor: f32,
    /// Les dernières trames avant la voix (on garde le début du mot).
    pre: std::collections::VecDeque<f32>,
    /// Trames parlées d'affilée (avant le début d'un passage).
    run: u32,
    /// Le passage en cours.
    cur: Option<Vec<f32>>,
    voiced: u32,
    quiet_ms: u32,
    head_sent: bool,
    id: u64,
}

impl WakeGate {
    const RATE: usize = 16_000;
    const FRAME: usize = 480;
    const PRE_ROLL: usize = Self::RATE * 3 / 10;
    const START_FRAMES: u32 = 3;
    const END_MS: u32 = 700;
    const MAX: usize = Self::RATE * 12;
    /// Au moins 0,25 s de voix pour vérifier un passage (pas un clic, pas une toux).
    const MIN_VOICED: u32 = 8;

    pub(crate) fn new() -> WakeGate {
        WakeGate { frame: Vec::with_capacity(Self::FRAME), floor: 0.003, pre: std::collections::VecDeque::new(), run: 0, cur: None, voiced: 0, quiet_ms: 0, head_sent: false, id: 0 }
    }

    fn head_len() -> usize {
        (HEAD_SECONDS * Self::RATE as f32) as usize
    }

    pub(crate) fn push(&mut self, samples: &[f32], out: &mut Vec<WakeEvent>) {
        for &s in samples {
            self.frame.push(s);
            if self.frame.len() == Self::FRAME {
                let frame = std::mem::take(&mut self.frame);
                self.on_frame(&frame, out);
                self.frame = frame;
                self.frame.clear();
            }
        }
    }

    fn on_frame(&mut self, frame: &[f32], out: &mut Vec<WakeEvent>) {
        let rms = (frame.iter().map(|v| v * v).sum::<f32>() / frame.len() as f32).sqrt();
        let speaking = rms > (self.floor * 3.5).max(0.006);
        let Some(cur) = self.cur.as_mut() else {
            // Le bruit de fond suit le calme (descend vite, monte doucement).
            if !speaking {
                self.floor = if rms < self.floor { rms.max(0.0005) } else { self.floor * 0.98 + rms * 0.02 };
            }
            self.pre.extend(frame.iter().copied());
            while self.pre.len() > Self::PRE_ROLL {
                self.pre.pop_front();
            }
            self.run = if speaking { self.run + 1 } else { 0 };
            if self.run >= Self::START_FRAMES {
                self.id += 1;
                self.cur = Some(self.pre.drain(..).collect());
                self.voiced = self.run;
                self.quiet_ms = 0;
                self.head_sent = false;
                self.run = 0;
            }
            return;
        };
        cur.extend_from_slice(frame);
        if speaking {
            self.voiced += 1;
            self.quiet_ms = 0;
        } else {
            self.quiet_ms += 30;
        }
        if !self.head_sent && cur.len() >= Self::head_len() {
            self.head_sent = true;
            out.push(WakeEvent::Check { id: self.id, samples: cur[..Self::head_len()].to_vec(), complete: false });
        }
        if self.quiet_ms >= Self::END_MS || cur.len() >= Self::MAX {
            let samples = self.cur.take().unwrap_or_default();
            if self.head_sent {
                out.push(WakeEvent::Full { id: self.id, samples });
            } else if self.voiced >= Self::MIN_VOICED {
                out.push(WakeEvent::Check { id: self.id, samples, complete: true });
            }
        }
    }
}

// ── Le mot d'appel dans un texte (pur) ───────────────────────────────────────

/// Les mots qui précèdent « Ondine » (sans accents ; Parakeet les écrit à sa façon).
const CALLS: &[&str] = &["dis", "di", "dit", "dites", "hey", "hei", "hay", "he", "eh", "hep", "ok", "okay", "oke", "okey", "hi", "hello", "allo"];

/// Un mot sans accents ni ponctuation, en minuscules.
fn plain(word: &str) -> String {
    word.chars()
        .flat_map(char::to_lowercase)
        .filter_map(|c| {
            Some(match c {
                'à' | 'â' | 'ä' | 'á' => 'a',
                'é' | 'è' | 'ê' | 'ë' => 'e',
                'î' | 'ï' | 'í' => 'i',
                'ô' | 'ö' | 'ó' => 'o',
                'ù' | 'û' | 'ü' | 'ú' => 'u',
                'ÿ' | 'ý' => 'y',
                'ç' => 'c',
                c if c.is_alphanumeric() => c,
                _ => return None,
            })
        })
        .collect()
}

/// Distance d'édition (petits mots seulement).
fn distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut row = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            row.push((prev[j] + usize::from(ca != cb)).min(prev[j + 1] + 1).min(row[j] + 1));
        }
        prev = row;
    }
    prev[b.len()]
}

/// « ondine », ou presque (« undine », « ondin », « on dine » collé…).
fn sounds_like_ondine(word: &str) -> bool {
    word.len() >= 5 && word.len() <= 8 && distance(word, "ondine") <= 1
}

/// Le texte commence-t-il par le mot d'appel (« Dis Ondine », « Hey
/// Ondine »…, au plus deux mots avant) ? Alors ce qui suit (peut-être vide).
pub(crate) fn wake_rest(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let plain: Vec<(usize, String)> = words.iter().enumerate().map(|(i, w)| (i, plain(w))).filter(|(_, p)| !p.is_empty()).collect();
    for start in 0..plain.len().min(3) {
        if !CALLS.contains(&plain[start].1.as_str()) {
            continue;
        }
        let Some((i1, w1)) = plain.get(start + 1) else { break };
        // « Ondine » en un mot, ou coupé en deux (« on dîne »).
        let end = if sounds_like_ondine(w1) {
            Some(*i1)
        } else {
            plain.get(start + 2).filter(|(_, w2)| sounds_like_ondine(&format!("{w1}{w2}"))).map(|(i2, _)| *i2)
        };
        if let Some(end) = end {
            let rest = words[end + 1..].join(" ");
            let rest = rest.trim_start_matches(|c: char| c.is_whitespace() || ",.;:!?-–—…".contains(c)).trim().to_string();
            let mut chars = rest.chars();
            return Some(match chars.next() {
                Some(c) => c.to_uppercase().chain(chars).collect(),
                None => String::new(),
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_phrases_are_recognized() {
        for t in ["Dis Ondine", "dis, Ondine !", "Hey Ondine.", "Hé Ondine", "OK Ondine", "Okay, Ondine", "hey undine", "Hé, on dîne", "Dis ondin"] {
            assert_eq!(wake_rest(t).as_deref(), Some(""), "{t}");
        }
        assert_eq!(wake_rest("Hey Ondine, quel temps fait-il ?").as_deref(), Some("Quel temps fait-il ?"));
        assert_eq!(wake_rest("Euh dis Ondine mets un minuteur de 5 minutes").as_deref(), Some("Mets un minuteur de 5 minutes"));
    }

    #[test]
    fn other_phrases_are_not() {
        for t in ["", "Ondine", "Bonjour Ondine", "on dîne à huit heures", "dis donc", "hey", "je lui ai dit Ondine hier soir parce que", "ok on y va", "dis Pauline"] {
            assert_eq!(wake_rest(t), None, "{t}");
        }
    }

    fn tone(level: f32, seconds: f32) -> Vec<f32> {
        (0..(seconds * 16_000.0) as usize).map(|i| if i % 2 == 0 { level } else { -level }).collect()
    }

    fn run(gate: &mut WakeGate, parts: &[(f32, f32)]) -> Vec<WakeEvent> {
        let mut out = Vec::new();
        for &(level, secs) in parts {
            gate.push(&tone(level, secs), &mut out);
        }
        out
    }

    #[test]
    fn silence_and_clicks_wake_nothing() {
        let mut g = WakeGate::new();
        assert!(run(&mut g, &[(0.001, 5.0)]).is_empty());
        // Un clic de 60 ms : pas un passage.
        assert!(run(&mut g, &[(0.3, 0.06), (0.001, 2.0)]).is_empty());
        // 150 ms de bruit : trop court pour être vérifié.
        assert!(run(&mut g, &[(0.3, 0.15), (0.001, 2.0)]).is_empty());
    }

    #[test]
    fn a_short_phrase_is_checked_whole() {
        let mut g = WakeGate::new();
        let out = run(&mut g, &[(0.001, 1.0), (0.2, 1.0), (0.001, 1.0)]);
        assert_eq!(out.len(), 1);
        let WakeEvent::Check { complete, samples, .. } = &out[0] else { panic!("{out:?}") };
        assert!(*complete);
        // Le début du mot est gardé (un peu avant la voix), et le silence de fin.
        assert!(samples.len() >= 16_000 + 16_000 * 7 / 10, "{}", samples.len());
        assert!(samples.len() <= 16_000 * 2, "{}", samples.len());
    }

    #[test]
    fn a_long_phrase_is_checked_on_its_start_then_given_whole() {
        let mut g = WakeGate::new();
        let out = run(&mut g, &[(0.001, 1.0), (0.2, 5.0), (0.001, 1.0)]);
        assert_eq!(out.len(), 2, "{out:?}");
        let WakeEvent::Check { id, samples, complete: false } = &out[0] else { panic!() };
        assert_eq!(samples.len(), WakeGate::head_len());
        let WakeEvent::Full { id: full, samples: all } = &out[1] else { panic!() };
        assert_eq!(id, full);
        assert!(all.len() > 16_000 * 5);
        // Un deuxième passage a un autre numéro.
        let out = run(&mut g, &[(0.2, 1.0), (0.001, 1.0)]);
        let WakeEvent::Check { id: next, .. } = &out[0] else { panic!() };
        assert_ne!(next, id);
    }

    #[test]
    fn steady_noise_becomes_the_floor() {
        let mut g = WakeGate::new();
        // Un ventilateur un peu fort : il devient le bruit de fond.
        assert!(run(&mut g, &[(0.004, 1.0), (0.005, 10.0)]).is_empty());
        // La voix, bien au-dessus : un passage.
        assert_eq!(run(&mut g, &[(0.1, 1.0), (0.005, 1.0)]).len(), 1);
    }
}
