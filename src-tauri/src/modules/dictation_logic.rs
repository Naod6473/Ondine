// La dictée partout : la logique de la touche et des bulles de la pilule, sans
// rien de Windows (testée telle quelle sous Linux).
//
// La touche (technique reprise de Flow de Coucou, MIT, adaptée) :
//   - maintenir : Ondine écoute ; relâcher : le texte est collé ;
//   - deux appuis rapides : mains libres, jusqu'au prochain appui ;
//   - Échap, ou une autre touche pendant que la touche est tenue (un
//     raccourci comme Ctrl+C) : on annule.
// L'écoute commence dès le premier appui, pour ne pas perdre le premier mot ;
// un appui trop court pour être « tenu » attend un instant le second ; sans
// second appui, on laisse tomber.
//
// Les bulles de la pilule : neuf bandes de fréquences, des graves (à gauche)
// aux aigus (à droite), calculées sur le PC à partir du son du micro (une
// petite transformée de Fourier, ~30 fois par seconde pendant l'écoute).

/// Où en est la touche.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Phase {
    Idle,
    /// Tenue depuis `since` (secondes).
    Holding { since: f64 },
    /// Relâchée vite : on attend un second appui jusqu'à `until`.
    TapWait { until: f64 },
    /// Mains libres.
    Locked,
}

/// Ce qu'il faut faire après un événement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    None,
    /// Ouvrir le micro et montrer la pilule.
    Start,
    /// Mains libres : on continue d'écouter, touche relâchée.
    Lock,
    /// Fin de l'écoute : on colle ce qui a été dit.
    Finish,
    /// Fin de l'écoute : on ne colle rien.
    Cancel,
    /// L'écoute précédente est abandonnée (trop courte) et une nouvelle commence.
    Restart,
}

/// En dessous, un appui est un « tap » (secondes).
pub const HOLD_THRESHOLD: f64 = 0.30;
/// Le second appui d'un double appui arrive dans ce délai (secondes).
pub const DOUBLE_TAP_WINDOW: f64 = 0.40;

/// La machine à états de la touche.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KeyLogic {
    phase: Phase,
}

impl Default for KeyLogic {
    fn default() -> Self {
        Self { phase: Phase::Idle }
    }
}

impl KeyLogic {
    #[cfg(test)]
    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn is_active(&self) -> bool {
        self.phase != Phase::Idle
    }

    pub fn is_locked(&self) -> bool {
        self.phase == Phase::Locked
    }

    /// La touche s'enfonce (ou se répète, tenue) à l'instant `t`.
    pub fn key_down(&mut self, t: f64) -> Action {
        match self.phase {
            Phase::Idle => {
                self.phase = Phase::Holding { since: t };
                Action::Start
            }
            // La répétition automatique du clavier.
            Phase::Holding { .. } => Action::None,
            Phase::TapWait { until } => {
                if t <= until {
                    self.phase = Phase::Locked;
                    Action::Lock
                } else {
                    // L'attente a expiré sans qu'on le voie : on repart.
                    self.phase = Phase::Holding { since: t };
                    Action::Restart
                }
            }
            Phase::Locked => {
                self.phase = Phase::Idle;
                Action::Finish
            }
        }
    }

    /// La touche remonte à l'instant `t`.
    pub fn key_up(&mut self, t: f64) -> Action {
        let Phase::Holding { since } = self.phase else { return Action::None };
        if t - since >= HOLD_THRESHOLD {
            self.phase = Phase::Idle;
            return Action::Finish;
        }
        self.phase = Phase::TapWait { until: t + DOUBLE_TAP_WINDOW };
        Action::None
    }

    /// Une autre touche, touche tenue ou entre les deux appuis : c'était un
    /// raccourci, pas une dictée. En mains libres, on peut taper : rien ne change.
    pub fn other_key(&mut self) -> Action {
        match self.phase {
            Phase::Holding { .. } | Phase::TapWait { .. } => {
                self.phase = Phase::Idle;
                Action::Cancel
            }
            Phase::Idle | Phase::Locked => Action::None,
        }
    }

    /// Échap.
    pub fn escape(&mut self) -> Action {
        if self.phase == Phase::Idle {
            return Action::None;
        }
        self.phase = Phase::Idle;
        Action::Cancel
    }

    /// Appelée régulièrement : le délai du second appui est peut-être passé.
    pub fn tick(&mut self, t: f64) -> Action {
        match self.phase {
            Phase::TapWait { until } if t > until => {
                self.phase = Phase::Idle;
                Action::Cancel
            }
            _ => Action::None,
        }
    }

    /// Mains libres tout de suite (bouton « Dicter » de la pilule ou des Réglages).
    pub fn lock(&mut self) {
        self.phase = Phase::Locked;
    }

    /// L'écoute s'est arrêtée d'elle-même (pas de micro, erreur…).
    pub fn reset(&mut self) {
        self.phase = Phase::Idle;
    }
}

/// La touche à maintenir (définie avec le crochet clavier).
pub use crate::platform::dictation::DictKey;

/// Le moteur de reconnaissance choisi (réglage « engine »).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    /// Parakeet sur le PC (crate::services::speech).
    Parakeet,
    /// La dictée de Windows (service en ligne de Microsoft).
    Windows,
    /// Le moteur SAPI de bureau de Windows, hors ligne.
    Offline,
    /// L'audio part vers OpenAI ou Gemini.
    Api,
}

impl Engine {
    /// Le moteur à utiliser pour ce réglage ; « auto » : Parakeet s'il est
    /// prêt, sinon Windows.
    pub fn pick(setting: &str, parakeet_ready: bool) -> Engine {
        match setting {
            "parakeet" => Engine::Parakeet,
            "windows" => Engine::Windows,
            "offline" => Engine::Offline,
            "api" => Engine::Api,
            _ if parakeet_ready => Engine::Parakeet,
            _ => Engine::Windows,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Engine::Parakeet => "parakeet",
            Engine::Windows => "windows",
            Engine::Offline => "offline",
            Engine::Api => "api",
        }
    }

    /// Le moteur capte lui-même le son en mémoire (Parakeet, API) ; sinon
    /// c'est Windows qui écoute, et on capte à côté seulement pour les bulles.
    pub fn records(self) -> bool {
        matches!(self, Engine::Parakeet | Engine::Api)
    }
}

/// Les bandes de fréquences des bulles : graves à gauche, aigus à droite.
pub mod bands {
    pub const COUNT: usize = 9;
    pub const LOW_HZ: f64 = 90.0;
    pub const HIGH_HZ: f64 = 7000.0;
    /// La taille de la transformée (une puissance de deux).
    pub const FFT: usize = 512;

    /// Les `count + 1` bords des bandes en Hz, réguliers sur une échelle logarithmique.
    pub fn edges(count: usize) -> Vec<f64> {
        (0..=count).map(|i| LOW_HZ * (HIGH_HZ / LOW_HZ).powf(i as f64 / count as f64)).collect()
    }

    /// Les cases [début, fin) de la transformée qui forment chaque bande.
    /// Chaque bande a au moins une case, et elles se suivent.
    pub fn bin_ranges(fft_size: usize, sample_rate: f64, count: usize) -> Vec<(usize, usize)> {
        let bin_hz = sample_rate / fft_size as f64;
        let max_bin = fft_size / 2;
        let e = edges(count);
        let mut out = Vec::with_capacity(count);
        let mut last = 1;
        for i in 0..count {
            let from = last.max((e[i] / bin_hz).floor() as usize).min(max_bin.saturating_sub(1));
            let to = max_bin.min((from + 1).max((e[i + 1] / bin_hz).ceil() as usize));
            out.push((from, to));
            last = to;
        }
        out
    }

    /// La puissance d'une bande (dB) → 0..1 : le silence reste bas, une voix
    /// normale remplit la bulle.
    pub fn level(db: f64) -> f64 {
        let (floor, ceiling) = (-78.0, -30.0);
        ((db - floor) / (ceiling - floor)).clamp(0.0, 1.0)
    }

    /// Transformée de Fourier rapide, sur place (radix 2). `re.len()` est une
    /// puissance de deux.
    pub fn fft(re: &mut [f64], im: &mut [f64]) {
        let n = re.len();
        if n < 2 {
            return;
        }
        // Réordonne les cases (inversion des bits).
        let mut j = 0;
        for i in 1..n {
            let mut bit = n >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j |= bit;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let angle = -2.0 * std::f64::consts::PI / len as f64;
            let (wr, wi) = (angle.cos(), angle.sin());
            for start in (0..n).step_by(len) {
                let (mut cr, mut ci) = (1.0, 0.0);
                for k in 0..len / 2 {
                    let a = start + k;
                    let b = a + len / 2;
                    let tr = re[b] * cr - im[b] * ci;
                    let ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                    let next = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = next;
                }
            }
            len <<= 1;
        }
    }

    /// Les neuf niveaux (0..1) des derniers `FFT` échantillons du micro.
    pub fn levels(samples: &[f32], sample_rate: u32) -> [f32; COUNT] {
        let mut out = [0.0f32; COUNT];
        if samples.len() < FFT || sample_rate == 0 {
            return out;
        }
        let tail = &samples[samples.len() - FFT..];
        // Fenêtre de Hann : pas de fausses fréquences aux bords du morceau.
        let mut re: Vec<f64> = tail
            .iter()
            .enumerate()
            .map(|(i, &v)| v as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (FFT - 1) as f64).cos()))
            .collect();
        let mut im = vec![0.0; FFT];
        fft(&mut re, &mut im);
        for (i, (from, to)) in bin_ranges(FFT, sample_rate as f64, COUNT).into_iter().enumerate() {
            let n = (to - from).max(1) as f64;
            let power: f64 = (from..to).map(|k| (re[k] * re[k] + im[k] * im[k]) / (FFT as f64 * FFT as f64)).sum::<f64>() / n;
            out[i] = level(10.0 * (power.max(1e-12)).log10()) as f32;
        }
        out
    }

    /// Sans spectre (le micro n'a pas pu être capté à côté) : neuf niveaux
    /// faits avec le seul niveau de la voix, plus forts au milieu, qui
    /// ondulent un peu avec le temps `t` (secondes).
    pub fn from_level(level: f32, t: f64) -> [f32; COUNT] {
        let mut out = [0.0f32; COUNT];
        for (i, v) in out.iter_mut().enumerate() {
            let middle = 1.0 - ((i as f64 - 4.0) / 5.0).powi(2);
            let wave = 0.75 + 0.25 * (t * 9.0 + i as f64 * 1.3).sin();
            *v = (level as f64 * middle * wave).clamp(0.0, 1.0) as f32;
        }
        out
    }
}

/// Le son ramené à 16 kHz (ce qu'attendent Parakeet et les API), par moyenne
/// des échantillons couverts : évite le crénelage le plus grossier.
pub fn resample_16k(samples: &[f32], rate: u32) -> Vec<f32> {
    const OUT: u64 = 16_000;
    let rate = u64::from(rate.max(1));
    if rate == OUT {
        return samples.to_vec();
    }
    let n = (samples.len() as u64 * OUT / rate) as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n as u64 {
        let a = (i * rate / OUT) as usize;
        let b = (((i + 1) * rate / OUT) as usize).clamp(a + 1, samples.len().max(a + 1));
        let slice = &samples[a.min(samples.len())..b.min(samples.len())];
        out.push(if slice.is_empty() { 0.0 } else { slice.iter().sum::<f32>() / slice.len() as f32 });
    }
    out
}

/// Le niveau le plus fort d'un morceau de son (0..1).
pub fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hold_then_release_pastes() {
        let mut k = KeyLogic::default();
        assert_eq!(k.key_down(0.0), Action::Start);
        assert_eq!(k.key_down(0.1), Action::None); // répétition du clavier
        assert_eq!(k.key_up(1.2), Action::Finish);
        assert!(!k.is_active());
    }

    #[test]
    fn two_quick_taps_go_hands_free_until_the_next_tap() {
        let mut k = KeyLogic::default();
        assert_eq!(k.key_down(0.0), Action::Start);
        assert_eq!(k.key_up(0.1), Action::None);
        assert!(matches!(k.phase(), Phase::TapWait { .. }));
        assert_eq!(k.key_down(0.3), Action::Lock);
        assert_eq!(k.key_up(0.35), Action::None);
        assert!(k.is_locked());
        // On peut taper au clavier en mains libres.
        assert_eq!(k.other_key(), Action::None);
        assert_eq!(k.key_down(5.0), Action::Finish);
        assert!(!k.is_active());
    }

    #[test]
    fn a_lone_tap_is_dropped_once_the_wait_is_over() {
        let mut k = KeyLogic::default();
        k.key_down(0.0);
        k.key_up(0.1);
        assert_eq!(k.tick(0.3), Action::None);
        assert_eq!(k.tick(0.6), Action::Cancel);
        assert!(!k.is_active());
        // Un appui après une attente expirée sans qu'on le voie : on repart.
        let mut k = KeyLogic::default();
        k.key_down(0.0);
        k.key_up(0.1);
        assert_eq!(k.key_down(2.0), Action::Restart);
        assert!(matches!(k.phase(), Phase::Holding { .. }));
    }

    #[test]
    fn a_shortcut_or_escape_cancels() {
        let mut k = KeyLogic::default();
        k.key_down(0.0);
        assert_eq!(k.other_key(), Action::Cancel);
        // Entre les deux appuis aussi.
        let mut k = KeyLogic::default();
        k.key_down(0.0);
        k.key_up(0.1);
        assert_eq!(k.other_key(), Action::Cancel);
        // Échap, même en mains libres ; rien quand rien n'écoute.
        let mut k = KeyLogic::default();
        k.lock();
        assert_eq!(k.escape(), Action::Cancel);
        assert_eq!(k.escape(), Action::None);
        let mut k = KeyLogic::default();
        k.key_down(0.0);
        assert_eq!(k.escape(), Action::Cancel);
        assert_eq!(k.key_up(0.5), Action::None);
    }

    #[test]
    fn keys_and_engines_read_from_the_settings() {
        assert_eq!(DictKey::from_id("rightAlt"), DictKey::RightAlt);
        assert_eq!(DictKey::from_id("n'importe quoi"), DictKey::RightCtrl);
        for k in [DictKey::RightCtrl, DictKey::RightAlt, DictKey::RightShift, DictKey::CtrlWin] {
            assert_eq!(DictKey::from_id(k.id()), k);
        }
        assert_eq!(Engine::pick("auto", true), Engine::Parakeet);
        assert_eq!(Engine::pick("auto", false), Engine::Windows);
        assert_eq!(Engine::pick("", false), Engine::Windows);
        assert_eq!(Engine::pick("offline", true), Engine::Offline);
        assert_eq!(Engine::pick("api", true), Engine::Api);
        // Parakeet choisi exprès : on le garde, même pas prêt (un message le dit).
        assert_eq!(Engine::pick("parakeet", false), Engine::Parakeet);
        assert!(Engine::Api.records() && Engine::Parakeet.records() && !Engine::Windows.records());
    }

    #[test]
    fn bands_cover_the_voice_from_low_to_high() {
        let e = bands::edges(9);
        assert_eq!(e.len(), 10);
        assert!((e[0] - 90.0).abs() < 1e-9 && (e[9] - 7000.0).abs() < 1e-6);
        for rate in [16_000.0, 44_100.0, 48_000.0] {
            let r = bands::bin_ranges(512, rate, 9);
            assert_eq!(r.len(), 9);
            for (i, (from, to)) in r.iter().enumerate() {
                assert!(to > from, "bande {i} vide à {rate} Hz");
                if i > 0 {
                    assert_eq!(*from, r[i - 1].1);
                }
            }
        }
        assert_eq!(bands::level(-100.0), 0.0);
        assert_eq!(bands::level(0.0), 1.0);
    }

    #[test]
    fn a_low_note_fills_the_left_bubbles_and_a_high_note_the_right_ones() {
        let rate = 16_000u32;
        let tone = |hz: f64| -> Vec<f32> { (0..1024).map(|i| (0.3 * (2.0 * std::f64::consts::PI * hz * i as f64 / rate as f64).sin()) as f32).collect() };
        let low = bands::levels(&tone(150.0), rate);
        let high = bands::levels(&tone(5000.0), rate);
        let argmax = |v: &[f32; 9]| v.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).map(|(i, _)| i).unwrap();
        assert!(argmax(&low) <= 1, "{low:?}");
        assert!(argmax(&high) >= 7, "{high:?}");
        // Le silence : tout en bas. Trop peu d'échantillons : rien.
        assert!(bands::levels(&[0.0; 512], rate).iter().all(|&v| v == 0.0));
        assert_eq!(bands::levels(&[0.5; 10], rate), [0.0; 9]);
        // Sans spectre : plus fort au milieu, borné.
        let f = bands::from_level(1.0, 0.0);
        assert!(f[4] > f[0] && f.iter().all(|v| (0.0..=1.0).contains(v)));
        assert_eq!(bands::from_level(0.0, 3.0), [0.0; 9]);
    }

    #[test]
    fn the_fft_finds_a_pure_tone() {
        let n = 64;
        let mut re: Vec<f64> = (0..n).map(|i| (2.0 * std::f64::consts::PI * 5.0 * i as f64 / n as f64).cos()).collect();
        let mut im = vec![0.0; n];
        bands::fft(&mut re, &mut im);
        let mag: Vec<f64> = re.iter().zip(&im).map(|(r, i)| (r * r + i * i).sqrt()).collect();
        let top = mag[..n / 2].iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        assert_eq!(top, 5);
        assert!((mag[5] - n as f64 / 2.0).abs() < 1e-6);
    }

    #[test]
    fn sound_is_brought_to_16k() {
        assert_eq!(resample_16k(&vec![0.25; 48_000], 48_000).len(), 16_000);
        assert!(resample_16k(&vec![0.25; 48_000], 48_000).iter().all(|&v| (v - 0.25).abs() < 1e-6));
        assert_eq!(resample_16k(&vec![0.1; 44_100], 44_100).len(), 16_000);
        assert_eq!(resample_16k(&[0.5, -0.5], 16_000), vec![0.5, -0.5]);
        assert!(resample_16k(&[], 48_000).is_empty());
        assert_eq!(peak(&[0.1, -0.7, 0.3]), 0.7);
    }
}
