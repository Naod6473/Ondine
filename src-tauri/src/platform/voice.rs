// Parler à Ondine à voix haute : ce qui touche au micro et à Windows.
//
//   - `dictate` : la reconnaissance vocale de Windows
//     (`Windows.Media.SpeechRecognition`, utilisable par une appli de bureau
//     non empaquetée : le `SpeechRecognizer` est « DualApiPartition »). La
//     dictée libre (contrainte de sujet par défaut) passe par le service en
//     ligne de Microsoft : Windows la refuse si « Reconnaissance vocale en
//     ligne » est coupée dans Paramètres → Confidentialité → Voix
//     (0x80045509), et le micro doit être permis aux « applications de
//     bureau ». Windows capte le micro lui-même ; les mots devinés en route
//     arrivent par `HypothesisGenerated` (sous-titres en direct).
//   Quand Windows échoue sans dire pourquoi (état « Unknown », 6, souvent vu
//   par une appli non empaquetée), on lit en plus, sans rien changer, les
//   réglages de Windows qui l'expliquent le plus souvent (reconnaissance en
//   ligne, micro des applications de bureau) : la phrase rendue dit quoi
//   régler (`Failure::fix` : la page des Paramètres à ouvrir), et
//   `Failure::detail` (étape, HRESULT, langues) part dans le journal.
//   La langue : celle de l'appli si Windows sait y faire la dictée
//   (`SupportedTopicLanguages`), sinon une variante (fr-CA pour fr-FR), sinon
//   la langue de la voix de Windows.
//   - `record` : la capture du micro en mémoire (WASAPI partagé), pour
//     l'option « transcription par l'API ». Rien n'est écrit sur le disque.
//   - le niveau du micro pendant la dictée (IAudioMeterInformation), pour que
//     le halo tremble avec la voix pendant que Windows écoute.
//   - `foreground_area` : la fenêtre active (pas celle d'Ondine), pour
//     « Regarde ça ».
//
// `stop` : 0 = on continue, FINISH = la personne a fini (touche relâchée,
// ou appuyée une 2e fois), CANCEL = Échap (rien n'est gardé).
//
// Sous Linux (vérifications), tout renvoie « seulement sous Windows ».

use std::sync::atomic::AtomicU8;

/// `stop` : la personne a fini de parler (on garde ce qui est dit).
pub const FINISH: u8 = 1;
/// `stop` : Échap (on jette tout).
pub const CANCEL: u8 = 2;

/// Ce que la capture du micro rend : le son en mono, et sa fréquence.
pub struct Pcm {
    pub samples: Vec<f32>,
    pub rate: u32,
}

/// Les rappels d'une écoute : mots devinés en route, niveau du micro (0..1).
#[cfg_attr(not(windows), allow(dead_code))] // lus seulement sous Windows
pub struct Listen<'a> {
    pub stop: &'a AtomicU8,
    pub partial: &'a mut dyn FnMut(&str),
    pub level: &'a mut dyn FnMut(f32),
}

/// Ce qu'il faut régler dans Windows quand l'écoute échoue : une page des
/// Paramètres Windows, toujours prise dans cette liste fixe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fix {
    /// Confidentialité → Voix (« Reconnaissance vocale en ligne »).
    Speech,
    /// Confidentialité → Microphone (applications de bureau).
    Mic,
    /// Heure et langue → Voix (la langue de la reconnaissance).
    Language,
}

impl Fix {
    pub fn id(self) -> &'static str {
        match self {
            Fix::Speech => "speech",
            Fix::Mic => "mic",
            Fix::Language => "language",
        }
    }

    pub fn from_id(id: &str) -> Option<Fix> {
        [Fix::Speech, Fix::Mic, Fix::Language].into_iter().find(|f| f.id() == id)
    }

    /// La page des Paramètres Windows à ouvrir.
    pub fn uri(self) -> &'static str {
        match self {
            Fix::Speech => "ms-settings:privacy-speech",
            Fix::Mic => "ms-settings:privacy-microphone",
            Fix::Language => "ms-settings:speech",
        }
    }
}

/// Un échec de l'écoute : la phrase pour la personne, ce qu'il faut régler,
/// et le détail technique pour le journal (vide : rien à diagnostiquer).
#[derive(Debug)]
pub struct Failure {
    pub message: String,
    pub fix: Option<Fix>,
    pub detail: String,
}

impl From<String> for Failure {
    fn from(message: String) -> Failure {
        Failure { message, fix: None, detail: String::new() }
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Failure {
        message.to_string().into()
    }
}

#[cfg_attr(not(windows), allow(dead_code))] // utilisés seulement sous Windows (et les tests)
pub(crate) const PRIVACY_TEXT: &str = "la dictée de Windows est coupée : activez « Reconnaissance vocale en ligne » dans Paramètres Windows → Confidentialité → Voix, ou choisissez la transcription par l'API dans les réglages";
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const MIC_TEXT: &str = "Windows refuse le micro : Paramètres Windows → Confidentialité → Microphone → « Autoriser les applications de bureau à accéder au microphone »";
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const UNKNOWN_TEXT: &str = "la dictée de Windows n'a pas marché sans dire pourquoi : vérifiez dans Paramètres Windows que « Reconnaissance vocale en ligne » est activée (Confidentialité → Voix), que le micro est permis aux applications de bureau (Confidentialité → Microphone) et que la voix de votre langue est installée (Heure et langue → Voix)";

/// Windows a échoué sans dire pourquoi : la phrase et la page à ouvrir,
/// d'après ses réglages (`online` : reconnaissance vocale en ligne ;
/// `mic` : micro permis aux applications de bureau ; None = inconnu).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn explain_unknown(online: Option<bool>, mic: Option<bool>) -> (&'static str, Fix) {
    match (online, mic) {
        (Some(false), _) => (PRIVACY_TEXT, Fix::Speech),
        (_, Some(false)) => (MIC_TEXT, Fix::Mic),
        _ => (UNKNOWN_TEXT, Fix::Speech),
    }
}

/// La langue de dictée : `wanted` si Windows sait y dicter, sinon une
/// variante de la même langue (fr-CA pour fr-FR), sinon None (on prendra la
/// langue de la voix de Windows).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn pick_language(wanted: &str, topics: &[String]) -> Option<String> {
    if let Some(t) = topics.iter().find(|t| t.eq_ignore_ascii_case(wanted)) {
        return Some(t.clone());
    }
    let primary = |t: &str| t.split('-').next().unwrap_or("").to_ascii_lowercase();
    topics.iter().find(|t| primary(t) == primary(wanted)).cloned()
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{explain_unknown, pick_language, Failure, Fix, Listen, Pcm, CANCEL, FINISH, MIC_TEXT, PRIVACY_TEXT};
    use std::sync::atomic::Ordering;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use windows::core::{Ref, HSTRING};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionCompletedEventArgs, SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession,
        SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognitionResultStatus, SpeechRecognizer,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};

    /// Toutes les 40 ms : mots devinés, niveau, fin demandée.
    const TICK: Duration = Duration::from_millis(40);
    /// Le code de Windows quand la reconnaissance vocale en ligne est coupée.
    const PRIVACY_OFF: u32 = 0x8004_5509;
    const ACCESS_DENIED: u32 = 0x8007_0005;
    /// Pas de micro (ou pas de pilote de son).
    const NO_DEVICE: u32 = 0x8889_0004;
    const NO_ENDPOINT: u32 = 0x8007_0490;

    fn span(ms: i64) -> TimeSpan {
        TimeSpan { Duration: ms * 10_000 }
    }

    // ── Les réglages de Windows qui expliquent un échec (lus, jamais écrits) ──

    fn reg_dword(root: HKEY, path: &str, name: &str) -> Option<u32> {
        let mut value = 0u32;
        let mut size = 4u32;
        let err = unsafe { RegGetValueW(root, &HSTRING::from(path), &HSTRING::from(name), RRF_RT_REG_DWORD, None, Some(&mut value as *mut u32 as *mut _), Some(&mut size)) };
        err.is_ok().then_some(value)
    }

    fn reg_text(root: HKEY, path: &str, name: &str) -> Option<String> {
        let mut buf = [0u16; 64];
        let mut size = (buf.len() * 2) as u32;
        let err = unsafe { RegGetValueW(root, &HSTRING::from(path), &HSTRING::from(name), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut size)) };
        err.is_ok().then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).min(buf.len())]).trim_end_matches('\0').to_string())
    }

    /// « Reconnaissance vocale en ligne » (Confidentialité → Voix) : activée ?
    /// Une stratégie d'entreprise peut aussi l'interdire.
    fn online_speech() -> Option<bool> {
        if reg_dword(HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Microsoft\InputPersonalization", "AllowInputPersonalization") == Some(0) {
            return Some(false);
        }
        reg_dword(HKEY_CURRENT_USER, r"Software\Microsoft\Speech_OneCore\Settings\OnlineSpeechPrivacy", "HasAccepted").map(|v| v != 0)
    }

    /// Le micro est-il permis (à l'ordinateur, à vous, aux applications de bureau) ?
    fn mic_for_desktop() -> Option<bool> {
        const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
        let values = [
            reg_text(HKEY_LOCAL_MACHINE, BASE, "Value"),
            reg_text(HKEY_CURRENT_USER, BASE, "Value"),
            reg_text(HKEY_CURRENT_USER, &format!(r"{BASE}\NonPackaged"), "Value"),
        ];
        if values.iter().flatten().any(|v| v.eq_ignore_ascii_case("Deny")) {
            Some(false)
        } else if values.iter().any(Option::is_some) {
            Some(true)
        } else {
            None
        }
    }

    fn yes_no(v: Option<bool>) -> &'static str {
        match v {
            Some(true) => "oui",
            Some(false) => "non",
            None => "?",
        }
    }

    /// Le détail pour le journal : l'étape, ce qui s'est passé, les langues et les réglages lus.
    fn detail(step: &str, what: &str, langs: &str, online: Option<bool>, mic: Option<bool>) -> String {
        format!("étape « {step} », {what}, {langs}, reconnaissance en ligne : {}, micro des applis de bureau : {}", yes_no(online), yes_no(mic))
    }

    /// Une erreur de Windows (HRESULT), en phrase simple.
    fn hr_failure(step: &str, langs: &str, e: &windows::core::Error) -> Failure {
        let code = e.code().0 as u32;
        let (online, mic) = (online_speech(), mic_for_desktop());
        let (message, fix) = match code {
            PRIVACY_OFF => (PRIVACY_TEXT.to_string(), Some(Fix::Speech)),
            ACCESS_DENIED => (MIC_TEXT.to_string(), Some(Fix::Mic)),
            NO_DEVICE | NO_ENDPOINT => ("aucun micro trouvé".to_string(), Some(Fix::Mic)),
            _ => {
                let (text, fix) = explain_unknown(online, mic);
                (text.to_string(), Some(fix))
            }
        };
        let what = format!("HRESULT 0x{code:08X} ({})", e.message());
        Failure { message, fix, detail: detail(step, &what, langs, online, mic) }
    }

    /// Une erreur de la capture du micro (transcription par l'API).
    fn mic_failure(e: &windows::core::Error) -> Failure {
        let code = e.code().0 as u32;
        let mic = mic_for_desktop();
        let (message, fix) = match code {
            ACCESS_DENIED => (MIC_TEXT.to_string(), Some(Fix::Mic)),
            NO_DEVICE | NO_ENDPOINT => ("aucun micro trouvé".to_string(), Some(Fix::Mic)),
            _ if mic == Some(false) => (MIC_TEXT.to_string(), Some(Fix::Mic)),
            _ => (format!("micro indisponible ({e})"), None),
        };
        let detail = format!("étape « capture du micro (WASAPI) », HRESULT 0x{code:08X} ({}), micro des applis de bureau : {}", e.message(), yes_no(mic));
        Failure { message, fix, detail }
    }

    /// Un état de Windows qui n'est pas un succès, en phrase simple (None : tout va bien,
    /// ou personne n'a parlé, ou c'est annulé).
    fn status_failure(step: &str, langs: &str, s: SpeechRecognitionResultStatus) -> Option<Failure> {
        if matches!(s, SpeechRecognitionResultStatus::Success | SpeechRecognitionResultStatus::TimeoutExceeded | SpeechRecognitionResultStatus::UserCanceled) {
            return None;
        }
        let (online, mic) = (online_speech(), mic_for_desktop());
        let (message, fix) = match s {
            SpeechRecognitionResultStatus::TopicLanguageNotSupported | SpeechRecognitionResultStatus::GrammarLanguageMismatch => (
                "Windows ne sait pas encore écouter dans cette langue : ajoutez la reconnaissance vocale de la langue dans Paramètres Windows → Heure et langue → Voix".to_string(),
                Some(Fix::Language),
            ),
            SpeechRecognitionResultStatus::NetworkFailure => ("la dictée de Windows a besoin d'Internet".to_string(), None),
            SpeechRecognitionResultStatus::MicrophoneUnavailable => ("le micro n'est pas disponible".to_string(), Some(Fix::Mic)),
            SpeechRecognitionResultStatus::AudioQualityFailure => ("le son du micro est trop mauvais".to_string(), None),
            // Unknown (6) et le reste : Windows ne dit pas pourquoi ; ses réglages, souvent.
            _ => {
                let (text, fix) = explain_unknown(online, mic);
                (text.to_string(), Some(fix))
            }
        };
        let what = format!("état {} ({s:?})", s.0);
        Some(Failure { message, fix, detail: detail(step, &what, langs, online, mic) })
    }

    /// Le niveau du micro par défaut (crête, 0..1), tant qu'une appli le capte.
    struct Meter(Option<IAudioMeterInformation>);

    impl Meter {
        fn open() -> Meter {
            let meter = unsafe {
                CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .and_then(|e| e.GetDefaultAudioEndpoint(eCapture, eConsole))
                    .and_then(|d| d.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None))
                    .ok()
            };
            Meter(meter)
        }

        fn peak(&self) -> f32 {
            self.0.as_ref().and_then(|m| unsafe { m.GetPeakValue() }.ok()).unwrap_or(0.0).clamp(0.0, 1.0)
        }
    }

    /// Les langues où Windows sait faire la dictée libre.
    fn topic_languages() -> Vec<String> {
        let Ok(list) = SpeechRecognizer::SupportedTopicLanguages() else { return Vec::new() };
        (0..list.Size().unwrap_or(0)).filter_map(|i| list.GetAt(i).ok()).filter_map(|l| l.LanguageTag().ok()).map(|t| t.to_string()).collect()
    }

    /// Le moteur, et un résumé des langues (pour le journal).
    fn recognizer(lang: &str) -> Result<(SpeechRecognizer, String), Failure> {
        let topics = topic_languages();
        let system = SpeechRecognizer::SystemSpeechLanguage().and_then(|l| l.LanguageTag()).map(|t| t.to_string()).unwrap_or_else(|_| "?".into());
        let mut langs = format!("langue voulue {lang}, voix de Windows {system}, dictée possible en [{}]", topics.join(", "));
        // La langue de l'appli (ou une variante) si Windows sait y dicter ; sinon, celle de la voix de Windows.
        if let Some(tag) = pick_language(lang, &topics) {
            match Language::CreateLanguage(&HSTRING::from(tag.as_str())).and_then(|l| SpeechRecognizer::Create(&l)) {
                Ok(rec) => {
                    langs.push_str(&format!(", utilisée {tag}"));
                    return Ok((rec, langs));
                }
                Err(e) => langs.push_str(&format!(", {tag} refusée (0x{:08X})", e.code().0 as u32)),
            }
        }
        langs.push_str(&format!(", utilisée {system}"));
        match SpeechRecognizer::new() {
            Ok(rec) => Ok((rec, langs)),
            Err(e) => Err(hr_failure("création du moteur", &langs, &e)),
        }
    }

    /// Écoute et renvoie ce qui a été dit ("" si rien, ou Échap). `hold` :
    /// tant que la touche est tenue (session continue) ; sinon une phrase,
    /// arrêtée par le silence. `initial_silence_ms` : on abandonne si
    /// personne ne parle d'ici là.
    pub fn dictate(lang: &str, hold: bool, initial_silence_ms: i64, cb: Listen) -> Result<String, Failure> {
        super::super::media::init_thread();
        let (rec, langs) = recognizer(lang)?;
        let langs = langs.as_str();
        let run = || -> Result<String, Failure> {
            let t = rec.Timeouts().map_err(|e| hr_failure("délais", langs, &e))?;
            let _ = t.SetInitialSilenceTimeout(span(initial_silence_ms));
            let _ = t.SetEndSilenceTimeout(span(if hold { 4000 } else { 1200 }));
            // Sans contrainte ajoutée : la dictée libre.
            let compiled = rec.CompileConstraintsAsync().and_then(|op| op.get()).map_err(|e| hr_failure("préparation (CompileConstraints)", langs, &e))?;
            if let Some(f) = compiled.Status().ok().and_then(|s| status_failure("préparation (CompileConstraints)", langs, s)) {
                return Err(f);
            }
            let (tx, rx) = mpsc::channel::<String>();
            let token = rec
                .HypothesisGenerated(&TypedEventHandler::new(move |_, args: Ref<'_, SpeechRecognitionHypothesisGeneratedEventArgs>| {
                    if let Ok(text) = args.ok().and_then(|a| a.Hypothesis()).and_then(|h| h.Text()) {
                        let _ = tx.send(text.to_string());
                    }
                    Ok(())
                }))
                .map_err(|e| hr_failure("sous-titres", langs, &e))?;
            let meter = Meter::open();
            let result = if hold { continuous(&rec, &rx, &meter, langs, cb) } else { once(&rec, &rx, &meter, langs, cb) };
            let _ = rec.RemoveHypothesisGenerated(token);
            result
        };
        let result = run();
        let _ = rec.Close();
        result
    }

    /// Une phrase : Windows s'arrête tout seul au silence.
    fn once(rec: &SpeechRecognizer, hyps: &mpsc::Receiver<String>, meter: &Meter, langs: &str, cb: Listen) -> Result<String, Failure> {
        const STEP: &str = "écoute (RecognizeAsync)";
        let op = rec.RecognizeAsync().map_err(|e| hr_failure(STEP, langs, &e))?;
        let mut last = String::new();
        let mut stopping = false;
        loop {
            while let Ok(h) = hyps.try_recv() {
                (cb.partial)(&h);
                last = h;
            }
            (cb.level)(meter.peak());
            // AsyncStatus (crate windows-future, pas reprise par `windows`) :
            // 0 en cours, 1 fini, 2 annulé, 3 erreur.
            match op.Status().map_err(|e| hr_failure(STEP, langs, &e))?.0 {
                1 => break,
                2 => return Ok(String::new()),
                3 => {
                    let code = op.ErrorCode().unwrap_or_default();
                    return Err(hr_failure(STEP, langs, &windows::core::Error::from_hresult(code)));
                }
                _ => {}
            }
            match cb.stop.load(Ordering::SeqCst) {
                CANCEL => {
                    let _ = op.Cancel();
                    return Ok(String::new());
                }
                // Appuyée une 2e fois : on garde ce qui est déjà compris.
                FINISH if !stopping => {
                    stopping = true;
                    let _ = rec.StopRecognitionAsync();
                }
                _ => {}
            }
            std::thread::sleep(TICK);
        }
        let result = op.GetResults().map_err(|e| hr_failure(STEP, langs, &e))?;
        if let Some(f) = result.Status().ok().and_then(|s| status_failure(STEP, langs, s)) {
            return Err(f);
        }
        let text = result.Text().map(|t| t.to_string()).unwrap_or_default();
        Ok(if text.trim().is_empty() { last } else { text })
    }

    /// Tant que la touche est tenue : une session continue, phrase après phrase.
    fn continuous(rec: &SpeechRecognizer, hyps: &mpsc::Receiver<String>, meter: &Meter, langs: &str, cb: Listen) -> Result<String, Failure> {
        const STEP: &str = "écoute continue (ContinuousRecognitionSession)";
        let session: SpeechContinuousRecognitionSession = rec.ContinuousRecognitionSession().map_err(|e| hr_failure(STEP, langs, &e))?;
        let _ = session.SetAutoStopSilenceTimeout(span(60_000));
        let (rtx, results) = mpsc::channel::<String>();
        let t1 = session
            .ResultGenerated(&TypedEventHandler::new(move |_, args: Ref<'_, SpeechContinuousRecognitionResultGeneratedEventArgs>| {
                if let Ok(r) = args.ok().and_then(|a| a.Result()) {
                    if r.Status().is_ok_and(|s| s == SpeechRecognitionResultStatus::Success) {
                        let _ = rtx.send(r.Text().map(|t| t.to_string()).unwrap_or_default());
                    }
                }
                Ok(())
            }))
            .map_err(|e| hr_failure(STEP, langs, &e))?;
        let (ctx, completed) = mpsc::channel::<SpeechRecognitionResultStatus>();
        let t2 = session
            .Completed(&TypedEventHandler::new(move |_, args: Ref<'_, SpeechContinuousRecognitionCompletedEventArgs>| {
                let _ = ctx.send(args.ok().and_then(|a| a.Status()).unwrap_or(SpeechRecognitionResultStatus::Unknown));
                Ok(())
            }))
            .map_err(|e| hr_failure(STEP, langs, &e))?;
        let done = |text: Result<String, Failure>| {
            let _ = session.RemoveResultGenerated(t1);
            let _ = session.RemoveCompleted(t2);
            text
        };
        if let Err(e) = session.StartAsync().and_then(|a| a.get()) {
            return done(Err(hr_failure(STEP, langs, &e)));
        }
        let mut said: Vec<String> = Vec::new();
        loop {
            while let Ok(r) = results.try_recv() {
                said.push(r);
            }
            while let Ok(h) = hyps.try_recv() {
                (cb.partial)(&[said.join(" "), h].join(" "));
            }
            (cb.level)(meter.peak());
            if let Ok(status) = completed.try_recv() {
                return done(match status_failure(STEP, langs, status) {
                    Some(f) => Err(f),
                    None => Ok(said.join(" ")),
                });
            }
            match cb.stop.load(Ordering::SeqCst) {
                CANCEL => {
                    let _ = session.CancelAsync().and_then(|a| a.get());
                    return done(Ok(String::new()));
                }
                FINISH => {
                    // Windows rend la phrase en cours, puis prévient (Completed).
                    let _ = session.StopAsync().and_then(|a| a.get());
                    let until = Instant::now() + Duration::from_millis(1500);
                    while Instant::now() < until && completed.try_recv().is_err() {
                        std::thread::sleep(TICK);
                    }
                    while let Ok(r) = results.try_recv() {
                        said.push(r);
                    }
                    return done(Ok(said.join(" ")));
                }
                _ => {}
            }
            std::thread::sleep(TICK);
        }
    }

    /// Le sous-format « nombres à virgule » d'un WAVEFORMATEXTENSIBLE.
    const FLOAT_SUBTYPE: windows::core::GUID = windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

    /// Capte le micro par défaut, en mémoire, jusqu'à `stop` (ou `chunk`
    /// qui renvoie faux : le silence est revenu). Chaque morceau (mono)
    /// passe par `chunk` ; le son entier est rendu à la fin.
    pub fn record(stop: &std::sync::atomic::AtomicU8, chunk: &mut dyn FnMut(&[f32], u32) -> bool) -> Result<Pcm, Failure> {
        super::super::media::init_thread();
        unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| mic_failure(&e))?;
            let device = devices.GetDefaultAudioEndpoint(eCapture, eConsole).map_err(|e| mic_failure(&e))?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| mic_failure(&e))?;
            let format = client.GetMixFormat().map_err(|e| mic_failure(&e))?;
            let f: WAVEFORMATEX = *format;
            let float = f.wFormatTag == WAVE_FORMAT_IEEE_FLOAT
                || (f.wFormatTag == WAVE_FORMAT_EXTENSIBLE && { std::ptr::read_unaligned(format as *const WAVEFORMATEXTENSIBLE).SubFormat } == FLOAT_SUBTYPE);
            let (channels, rate, bits) = (f.nChannels.max(1) as usize, f.nSamplesPerSec, f.wBitsPerSample);
            // Une seconde de tampon (en unités de 100 ns).
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 10_000_000, 0, format, None);
            CoTaskMemFree(Some(format as *const _));
            init.map_err(|e| mic_failure(&e))?;
            if !(float && bits == 32) && bits != 16 {
                return Err(format!("format du micro non pris en charge ({bits} bits)").into());
            }
            let capture: IAudioCaptureClient = client.GetService().map_err(|e| mic_failure(&e))?;
            client.Start().map_err(|e| mic_failure(&e))?;
            let mut all: Vec<f32> = Vec::new();
            let mut mono: Vec<f32> = Vec::new();
            let result = loop {
                std::thread::sleep(Duration::from_millis(20));
                if stop.load(Ordering::SeqCst) != 0 {
                    break Ok(());
                }
                mono.clear();
                loop {
                    match capture.GetNextPacketSize() {
                        Ok(0) => break,
                        Ok(_) => {}
                        Err(e) => return Err(mic_failure(&e)),
                    }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let (mut frames, mut flags) = (0u32, 0u32);
                    if let Err(e) = capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) {
                        let _ = client.Stop();
                        return Err(mic_failure(&e));
                    }
                    let n = frames as usize;
                    if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                        mono.extend(std::iter::repeat_n(0.0, n));
                    } else if float {
                        let s = std::slice::from_raw_parts(data as *const f32, n * channels);
                        mono.extend(s.chunks(channels).map(|c| c.iter().sum::<f32>() / channels as f32));
                    } else {
                        let s = std::slice::from_raw_parts(data as *const i16, n * channels);
                        mono.extend(s.chunks(channels).map(|c| c.iter().map(|&v| v as f32 / 32768.0).sum::<f32>() / channels as f32));
                    }
                    let _ = capture.ReleaseBuffer(frames);
                }
                all.extend_from_slice(&mono);
                if !chunk(&mono, rate) {
                    break Ok(());
                }
            };
            let _ = client.Stop();
            result.map(|()| Pcm { samples: all, rate })
        }
    }

    /// La fenêtre active, si ce n'est pas une fenêtre d'Ondine : sa zone à
    /// l'écran (pixels physiques), pour « Regarde ça ».
    pub fn foreground_area() -> Option<super::super::record::Area> {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic};
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() || IsIconic(hwnd).as_bool() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == std::process::id() {
                return None;
            }
            let mut r = RECT::default();
            GetWindowRect(hwnd, &mut r).ok()?;
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            (w > 8 && h > 8).then_some(super::super::record::Area { x: r.left, y: r.top, width: w as u32, height: h as u32 })
        }
    }
}

#[cfg(not(windows))]
mod stub {
    use super::{Failure, Listen, Pcm};

    const ONLY_WINDOWS: &str = "disponible seulement sous Windows";

    pub fn dictate(_lang: &str, _hold: bool, _initial_silence_ms: i64, _cb: Listen) -> Result<String, Failure> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn record(_stop: &std::sync::atomic::AtomicU8, _chunk: &mut dyn FnMut(&[f32], u32) -> bool) -> Result<Pcm, Failure> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn foreground_area() -> Option<super::super::record::Area> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fix_pages_are_a_fixed_list() {
        for f in [Fix::Speech, Fix::Mic, Fix::Language] {
            assert_eq!(Fix::from_id(f.id()), Some(f));
            assert!(f.uri().starts_with("ms-settings:"));
        }
        assert_eq!(Fix::from_id("ms-settings:"), None);
        assert_eq!(Fix::from_id(""), None);
    }

    #[test]
    fn unknown_is_explained_by_windows_settings() {
        assert_eq!(explain_unknown(Some(false), Some(true)), (PRIVACY_TEXT, Fix::Speech));
        assert_eq!(explain_unknown(Some(false), Some(false)), (PRIVACY_TEXT, Fix::Speech));
        assert_eq!(explain_unknown(Some(true), Some(false)), (MIC_TEXT, Fix::Mic));
        assert_eq!(explain_unknown(None, Some(false)), (MIC_TEXT, Fix::Mic));
        assert_eq!(explain_unknown(Some(true), Some(true)), (UNKNOWN_TEXT, Fix::Speech));
        assert_eq!(explain_unknown(None, None), (UNKNOWN_TEXT, Fix::Speech));
    }

    #[test]
    fn dictation_language() {
        let topics = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(pick_language("fr-FR", &topics(&["en-US", "fr-FR"])).as_deref(), Some("fr-FR"));
        assert_eq!(pick_language("fr-FR", &topics(&["en-US", "FR-fr"])).as_deref(), Some("FR-fr"));
        assert_eq!(pick_language("fr-FR", &topics(&["en-US", "fr-CA"])).as_deref(), Some("fr-CA"));
        assert_eq!(pick_language("en-US", &topics(&["en-GB"])).as_deref(), Some("en-GB"));
        assert_eq!(pick_language("fr-FR", &topics(&["en-US"])), None);
        assert_eq!(pick_language("fr-FR", &[]), None);
    }
}
