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

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{Listen, Pcm, CANCEL, FINISH};
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

    /// Une erreur de Windows en phrase simple.
    fn hr_text(e: &windows::core::Error) -> String {
        match e.code().0 as u32 {
            PRIVACY_OFF => "la dictée de Windows est coupée : activez « Reconnaissance vocale en ligne » dans Paramètres Windows → Confidentialité → Voix, ou choisissez la transcription par l'API dans les réglages".into(),
            ACCESS_DENIED => "Windows refuse le micro : Paramètres Windows → Confidentialité → Microphone → « Autoriser les applications de bureau à accéder au microphone »".into(),
            NO_DEVICE | NO_ENDPOINT => "aucun micro trouvé".into(),
            _ => format!("reconnaissance vocale indisponible ({e})"),
        }
    }

    fn status_text(s: SpeechRecognitionResultStatus) -> Option<String> {
        Some(match s {
            SpeechRecognitionResultStatus::Success | SpeechRecognitionResultStatus::TimeoutExceeded | SpeechRecognitionResultStatus::UserCanceled => return None,
            SpeechRecognitionResultStatus::TopicLanguageNotSupported | SpeechRecognitionResultStatus::GrammarLanguageMismatch => {
                "Windows ne sait pas encore écouter dans cette langue : ajoutez la reconnaissance vocale de la langue dans Paramètres Windows → Heure et langue → Voix".into()
            }
            SpeechRecognitionResultStatus::NetworkFailure => "la dictée de Windows a besoin d'Internet".into(),
            SpeechRecognitionResultStatus::MicrophoneUnavailable => "le micro n'est pas disponible".into(),
            SpeechRecognitionResultStatus::AudioQualityFailure => "le son du micro est trop mauvais".into(),
            _ => format!("reconnaissance vocale impossible (état {})", s.0),
        })
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

    fn recognizer(lang: &str) -> Result<SpeechRecognizer, String> {
        // La langue de l'appli si Windows l'a ; sinon, celle de la voix de Windows.
        let wanted = Language::CreateLanguage(&HSTRING::from(lang)).and_then(|l| SpeechRecognizer::Create(&l));
        wanted.or_else(|_| SpeechRecognizer::new()).map_err(|e| hr_text(&e))
    }

    /// Écoute et renvoie ce qui a été dit ("" si rien, ou Échap). `hold` :
    /// tant que la touche est tenue (session continue) ; sinon une phrase,
    /// arrêtée par le silence. `initial_silence_ms` : on abandonne si
    /// personne ne parle d'ici là.
    pub fn dictate(lang: &str, hold: bool, initial_silence_ms: i64, cb: Listen) -> Result<String, String> {
        super::super::media::init_thread();
        let rec = recognizer(lang)?;
        let run = || -> Result<String, String> {
            let t = rec.Timeouts().map_err(|e| hr_text(&e))?;
            let _ = t.SetInitialSilenceTimeout(span(initial_silence_ms));
            let _ = t.SetEndSilenceTimeout(span(if hold { 4000 } else { 1200 }));
            // Sans contrainte ajoutée : la dictée libre.
            let compiled = rec.CompileConstraintsAsync().and_then(|op| op.get()).map_err(|e| hr_text(&e))?;
            if let Some(msg) = compiled.Status().ok().and_then(status_text) {
                return Err(msg);
            }
            let (tx, rx) = mpsc::channel::<String>();
            let token = rec
                .HypothesisGenerated(&TypedEventHandler::new(move |_, args: Ref<'_, SpeechRecognitionHypothesisGeneratedEventArgs>| {
                    if let Ok(text) = args.ok().and_then(|a| a.Hypothesis()).and_then(|h| h.Text()) {
                        let _ = tx.send(text.to_string());
                    }
                    Ok(())
                }))
                .map_err(|e| hr_text(&e))?;
            let meter = Meter::open();
            let result = if hold { continuous(&rec, &rx, &meter, cb) } else { once(&rec, &rx, &meter, cb) };
            let _ = rec.RemoveHypothesisGenerated(token);
            result
        };
        let result = run();
        let _ = rec.Close();
        result
    }

    /// Une phrase : Windows s'arrête tout seul au silence.
    fn once(rec: &SpeechRecognizer, hyps: &mpsc::Receiver<String>, meter: &Meter, cb: Listen) -> Result<String, String> {
        let op = rec.RecognizeAsync().map_err(|e| hr_text(&e))?;
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
            match op.Status().map_err(|e| hr_text(&e))?.0 {
                1 => break,
                2 => return Ok(String::new()),
                3 => {
                    let code = op.ErrorCode().unwrap_or_default();
                    return Err(hr_text(&windows::core::Error::from_hresult(code)));
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
        let result = op.GetResults().map_err(|e| hr_text(&e))?;
        if let Some(msg) = result.Status().ok().and_then(status_text) {
            return Err(msg);
        }
        let text = result.Text().map(|t| t.to_string()).unwrap_or_default();
        Ok(if text.trim().is_empty() { last } else { text })
    }

    /// Tant que la touche est tenue : une session continue, phrase après phrase.
    fn continuous(rec: &SpeechRecognizer, hyps: &mpsc::Receiver<String>, meter: &Meter, cb: Listen) -> Result<String, String> {
        let session: SpeechContinuousRecognitionSession = rec.ContinuousRecognitionSession().map_err(|e| hr_text(&e))?;
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
            .map_err(|e| hr_text(&e))?;
        let (ctx, completed) = mpsc::channel::<SpeechRecognitionResultStatus>();
        let t2 = session
            .Completed(&TypedEventHandler::new(move |_, args: Ref<'_, SpeechContinuousRecognitionCompletedEventArgs>| {
                let _ = ctx.send(args.ok().and_then(|a| a.Status()).unwrap_or(SpeechRecognitionResultStatus::Unknown));
                Ok(())
            }))
            .map_err(|e| hr_text(&e))?;
        let done = |text: Result<String, String>| {
            let _ = session.RemoveResultGenerated(t1);
            let _ = session.RemoveCompleted(t2);
            text
        };
        if let Err(e) = session.StartAsync().and_then(|a| a.get()) {
            return done(Err(hr_text(&e)));
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
                return done(match status_text(status) {
                    Some(msg) => Err(msg),
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
    pub fn record(stop: &std::sync::atomic::AtomicU8, chunk: &mut dyn FnMut(&[f32], u32) -> bool) -> Result<Pcm, String> {
        super::super::media::init_thread();
        unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| hr_text(&e))?;
            let device = devices.GetDefaultAudioEndpoint(eCapture, eConsole).map_err(|e| hr_text(&e))?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| hr_text(&e))?;
            let format = client.GetMixFormat().map_err(|e| hr_text(&e))?;
            let f: WAVEFORMATEX = *format;
            let float = f.wFormatTag == WAVE_FORMAT_IEEE_FLOAT
                || (f.wFormatTag == WAVE_FORMAT_EXTENSIBLE && { std::ptr::read_unaligned(format as *const WAVEFORMATEXTENSIBLE).SubFormat } == FLOAT_SUBTYPE);
            let (channels, rate, bits) = (f.nChannels.max(1) as usize, f.nSamplesPerSec, f.wBitsPerSample);
            // Une seconde de tampon (en unités de 100 ns).
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 10_000_000, 0, format, None);
            CoTaskMemFree(Some(format as *const _));
            init.map_err(|e| hr_text(&e))?;
            if !(float && bits == 32) && bits != 16 {
                return Err(format!("format du micro non pris en charge ({bits} bits)"));
            }
            let capture: IAudioCaptureClient = client.GetService().map_err(|e| hr_text(&e))?;
            client.Start().map_err(|e| hr_text(&e))?;
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
                        Err(e) => return Err(hr_text(&e)),
                    }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let (mut frames, mut flags) = (0u32, 0u32);
                    if let Err(e) = capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) {
                        let _ = client.Stop();
                        return Err(hr_text(&e));
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
    use super::{Listen, Pcm};

    const ONLY_WINDOWS: &str = "disponible seulement sous Windows";

    pub fn dictate(_lang: &str, _hold: bool, _initial_silence_ms: i64, _cb: Listen) -> Result<String, String> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn record(_stop: &std::sync::atomic::AtomicU8, _chunk: &mut dyn FnMut(&[f32], u32) -> bool) -> Result<Pcm, String> {
        Err(ONLY_WINDOWS.into())
    }

    pub fn foreground_area() -> Option<super::super::record::Area> {
        None
    }
}
