// Le tempo de la musique (battements par minute), pour que la mascotte danse
// en rythme (module Musique, commande `tempo`).
//
// Ce qu'on reçoit : le niveau sonore de ce qui sort des haut-parleurs, lu
// ~100 fois par seconde par l'« indicateur de niveau » de Windows
// (platform/halos.rs, `Meter`) : un seul nombre de 0 à 1 à chaque fois, jamais
// le son lui-même. Rien n'est enregistré ni envoyé ; on garde 8 secondes de
// ces nombres en mémoire, le temps de trouver le rythme.
//
// Comment :
//   1. les attaques : la montée du niveau (en échelle logarithmique, comme
//      l'oreille) d'un échantillon au suivant, seulement quand ça monte ;
//   2. l'autocorrélation de ces attaques sur 8 s : pour chaque écart possible
//      entre deux temps (60 à 200 BPM), à quel point le signal ressemble à
//      lui-même décalé de cet écart. Un léger penchant pour les tempos autour
//      de 120 départage le simple et le double (90 ou 180 ?) ;
//   3. la phase : où tombent les temps (le décalage qui rassemble le plus
//      d'attaques, les plus récentes comptent plus), pour que les pas de la
//      mascotte tombent sur le temps et pas entre deux ;
//   4. le recalage : une mesure proche du tempo retenu le lisse ; une mesure
//      au double ou à la moitié est ignorée ; trois mesures de suite ailleurs
//      (le morceau a changé de rythme) le remplacent ; un silence de 1,5 s ou
//      un nouveau morceau repartent de zéro.
//
// Tout est pur et testé avec des signaux fabriqués (en bas du fichier).

use std::collections::VecDeque;

/// Les bornes du tempo cherché.
pub const MIN_BPM: f32 = 60.0;
pub const MAX_BPM: f32 = 200.0;
/// Ce qu'on garde en mémoire (secondes), et le minimum avant de répondre.
const WINDOW_S: f32 = 8.0;
const MIN_DATA_S: f32 = 4.0;
/// En dessous de ce niveau, c'est le silence ; 1,5 s de silence efface tout.
const SILENCE: f32 = 0.01;
const SILENCE_RESET_S: f32 = 1.5;
/// Une mesure moins nette que ça ne compte pas (0 à 1).
const MIN_CONFIDENCE: f32 = 0.06;
/// Deux tempos à moins de 4 % l'un de l'autre sont « le même ».
const SAME: f32 = 0.04;
/// La largeur du penchant pour ~120 BPM, en octaves (plus large = plus doux).
const PRIOR_OCTAVES: f32 = 1.0;
/// Mesures de suite ailleurs avant de changer de tempo.
const SWITCH_AFTER: u8 = 3;

/// Ce que le module publie (message « media.tempo »).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tempo {
    pub bpm: f32,
    /// Où on en est dans le temps en cours, au dernier échantillon : 0 = pile sur le temps, 0,5 = entre deux.
    pub phase: f32,
    /// La netteté du rythme (0 à 1).
    pub confidence: f32,
    /// L'énergie du son sur les dernières secondes (0 à 1), pour deviner le style.
    pub energy: f32,
}

pub struct TempoTracker {
    /// Échantillons par seconde.
    fs: f32,
    onset: VecDeque<f32>,
    level: VecDeque<f32>,
    prev: f32,
    quiet: usize,
    locked: Option<f32>,
    candidate: Option<(f32, u8)>,
    confidence: f32,
}

fn same(a: f32, b: f32) -> bool {
    (a - b).abs() / b.max(1.0) < SAME
}

impl TempoTracker {
    pub fn new(fs: f32) -> Self {
        let cap = (WINDOW_S * fs) as usize + 1;
        TempoTracker {
            fs: fs.max(20.0),
            onset: VecDeque::with_capacity(cap),
            level: VecDeque::with_capacity(cap),
            prev: 0.0,
            quiet: 0,
            locked: None,
            candidate: None,
            confidence: 0.0,
        }
    }

    /// Tout oublier (nouveau morceau, silence).
    pub fn reset(&mut self) {
        self.onset.clear();
        self.level.clear();
        self.prev = 0.0;
        self.locked = None;
        self.candidate = None;
        self.confidence = 0.0;
    }

    /// Le tempo retenu, s'il y en a un (pour les tests).
    #[cfg(test)]
    pub fn bpm(&self) -> Option<f32> {
        self.locked
    }

    /// Un nouvel échantillon du niveau (0 à 1).
    pub fn push(&mut self, peak: f32) {
        let peak = if peak.is_finite() { peak.clamp(0.0, 1.0) } else { 0.0 };
        if peak < SILENCE {
            self.quiet += 1;
            if self.quiet as f32 >= SILENCE_RESET_S * self.fs {
                if !self.onset.is_empty() || self.locked.is_some() {
                    self.reset();
                }
                return;
            }
        } else {
            self.quiet = 0;
        }
        // L'oreille entend en échelle logarithmique : une attaque douce compte aussi.
        let x = (1.0 + 100.0 * peak).ln();
        let rise = (x - self.prev).max(0.0);
        self.prev = x;
        let cap = (WINDOW_S * self.fs) as usize;
        if self.onset.len() >= cap {
            self.onset.pop_front();
            self.level.pop_front();
        }
        self.onset.push_back(rise);
        self.level.push_back(peak);
    }

    /// Une mesure brute sur ce qu'on a en mémoire : (BPM, netteté).
    fn measure(&self) -> Option<(f32, f32)> {
        let n = self.onset.len();
        if (n as f32) < MIN_DATA_S * self.fs {
            return None;
        }
        // Lissées (une cloche de 20 ms) : un temps tombe rarement pile sur un
        // échantillon (à 160 BPM, un temps tous les 37,5).
        let sigma = (0.02 * self.fs).max(1.0);
        let radius = (3.0 * sigma).ceil() as isize;
        let kernel: Vec<f32> = (-radius..=radius).map(|d| (-0.5 * (d as f32 / sigma).powi(2)).exp()).collect();
        let o: Vec<f32> = (0..n as isize)
            .map(|i| {
                (-radius..=radius)
                    .map(|d| self.onset.get((i + d).max(0) as usize).copied().unwrap_or(0.0) * kernel[(d + radius) as usize])
                    .sum()
            })
            .collect();
        let mean = o.iter().sum::<f32>() / n as f32;
        let c: Vec<f32> = o.iter().map(|v| v - mean).collect();
        let energy0 = c.iter().map(|v| v * v).sum::<f32>() / n as f32;
        if energy0 <= 1e-9 {
            return None;
        }
        // Autocorrélation sans biais (divisée par le nombre de paires), à un
        // écart fractionnaire : le signal décalé est lu entre deux échantillons.
        let corr = |tau: f32| -> f32 {
            let k = tau.floor() as usize;
            let f = tau - k as f32;
            if k + 1 >= n {
                return 0.0;
            }
            let mut s = 0.0;
            for i in (k + 1)..n {
                s += c[i] * (c[i - k] * (1.0 - f) + c[i - k - 1] * f);
            }
            s / (n - k - 1) as f32
        };
        // Tous les demi-BPM de 60 à 200, avec un penchant doux pour ~120 BPM
        // (la moitié ou le double restent possibles).
        let steps = ((MAX_BPM - MIN_BPM) * 2.0) as usize;
        let mut scores = Vec::with_capacity(steps + 1);
        for k in 0..=steps {
            let bpm = MIN_BPM + k as f32 * 0.5;
            let r = corr(60.0 * self.fs / bpm);
            let oct = (bpm / 120.0).log2() / PRIOR_OCTAVES;
            scores.push((r * (-0.5 * oct * oct).exp(), r));
        }
        let (best, &(best_s, best_r)) = scores.iter().enumerate().max_by(|a, b| a.1 .0.total_cmp(&b.1 .0))?;
        if best_r <= 0.0 {
            return None;
        }
        // Entre deux pas de la grille : le sommet de la parabole qui passe par les trois voisins.
        let mut bpm = MIN_BPM + best as f32 * 0.5;
        if best > 0 && best < steps {
            let (a, cc) = (scores[best - 1].0, scores[best + 1].0);
            let den = a - 2.0 * best_s + cc;
            if den.abs() > 1e-12 {
                bpm += 0.5 * (0.5 * (a - cc) / den).clamp(-0.5, 0.5);
            }
        }
        Some((bpm.clamp(MIN_BPM, MAX_BPM), (best_r / energy0).clamp(0.0, 1.0)))
    }

    /// Où on en est dans le temps (0 à 1) au dernier échantillon, pour ce tempo.
    fn phase(&self, bpm: f32) -> f32 {
        let n = self.onset.len();
        let period = 60.0 * self.fs / bpm;
        if n < 2 || period < 2.0 {
            return 0.0;
        }
        let at = |i: isize| -> f32 {
            if i < 0 || i as usize >= n {
                0.0
            } else {
                self.onset[i as usize]
            }
        };
        let last = n as isize - 1;
        let beats = (n as f32 / period).floor() as usize;
        let mut best = 0usize;
        let mut best_s = f32::MIN;
        for back in 0..period.ceil() as usize {
            let mut s = 0.0;
            let mut w = 1.0;
            for k in 0..beats {
                let i = last - back as isize - (k as f32 * period).round() as isize;
                // Les attaques tombent rarement pile sur un échantillon : ses voisins comptent un peu.
                s += w * (at(i) + 0.5 * (at(i - 1) + at(i + 1)));
                w *= 0.9;
            }
            if s > best_s {
                best_s = s;
                best = back;
            }
        }
        (best as f32 / period).rem_euclid(1.0)
    }

    /// L'énergie du son (0 à 1) : la moyenne du niveau sur ce qu'on a en mémoire.
    fn energy(&self) -> f32 {
        if self.level.is_empty() {
            return 0.0;
        }
        (self.level.iter().sum::<f32>() / self.level.len() as f32).clamp(0.0, 1.0)
    }

    /// À appeler de temps en temps (une fois par seconde) : la mesure, le
    /// recalage, et le tempo retenu avec sa phase (None : pas encore, ou plus de rythme).
    pub fn update(&mut self) -> Option<Tempo> {
        if let Some((bpm, conf)) = self.measure().filter(|(_, c)| *c >= MIN_CONFIDENCE) {
            self.confidence = conf;
            match self.locked {
                Some(cur) if same(bpm, cur) => {
                    // Le même tempo : on le lisse.
                    self.locked = Some(cur * 0.7 + bpm * 0.3);
                    self.candidate = None;
                }
                // Le double ou la moitié : la même musique comptée autrement, on garde.
                Some(cur) if same(bpm, cur * 2.0) || same(bpm, cur / 2.0) => self.candidate = None,
                _ => {
                    // Ailleurs : il faut le revoir (deux fois pour un premier tempo, trois pour en changer).
                    let seen = match self.candidate {
                        Some((c, k)) if same(bpm, c) => (c * 0.5 + bpm * 0.5, k + 1),
                        _ => (bpm, 1),
                    };
                    let need = if self.locked.is_some() { SWITCH_AFTER } else { 2 };
                    if seen.1 >= need {
                        self.locked = Some(seen.0);
                        self.candidate = None;
                    } else {
                        self.candidate = Some(seen);
                    }
                }
            }
        }
        let bpm = self.locked?;
        Some(Tempo { bpm, phase: self.phase(bpm), confidence: self.confidence, energy: self.energy() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un petit hasard reproductible (le bruit du signal fabriqué).
    struct Lcg(u32);
    impl Lcg {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (self.0 >> 8) as f32 / (1u32 << 24) as f32
        }
    }

    /// Un morceau fabriqué : une grosse caisse sur chaque temps, un charleston
    /// entre deux (plus faible), un fond musical et du bruit ; `offset_s` : le
    /// premier temps. Rend le niveau à `fs` échantillons par seconde.
    fn song(bpm: f32, secs: f32, fs: f32, offset_s: f32, seed: u32) -> Vec<f32> {
        let mut rng = Lcg(seed);
        let period = 60.0 / bpm;
        (0..(secs * fs) as usize)
            .map(|i| {
                let t = i as f32 / fs;
                let since = (t - offset_s).rem_euclid(period);
                let half = (t - offset_s - period / 2.0).rem_euclid(period);
                let kick = 0.6 * (-since / 0.07).exp();
                let hat = 0.18 * (-half / 0.03).exp();
                (0.15 + kick + hat + 0.08 * rng.next()).min(1.0)
            })
            .collect()
    }

    fn run(tr: &mut TempoTracker, samples: &[f32]) -> Option<Tempo> {
        let fs = tr.fs as usize;
        let mut out = None;
        for (i, &s) in samples.iter().enumerate() {
            tr.push(s);
            if (i + 1) % fs == 0 {
                out = tr.update();
            }
        }
        out
    }

    #[test]
    fn finds_the_tempo_of_synthetic_songs() {
        for (bpm, seed) in [(64.0, 12), (72.0, 1), (80.0, 13), (90.0, 2), (100.0, 3), (110.0, 14), (120.0, 4), (128.0, 5), (140.0, 6), (150.0, 15), (160.0, 7)] {
            let mut tr = TempoTracker::new(100.0);
            let got = run(&mut tr, &song(bpm, 12.0, 100.0, 0.13, seed)).expect("un tempo");
            assert!((got.bpm - bpm).abs() / bpm < 0.02, "{bpm} BPM : trouvé {}", got.bpm);
            assert!(got.confidence > MIN_CONFIDENCE);
        }
    }

    #[test]
    fn very_fast_songs_may_be_counted_half_time() {
        // 180 BPM : la mascotte peut danser à 180 ou à 90 (un pas tous les deux temps), pas ailleurs.
        let mut tr = TempoTracker::new(100.0);
        let got = run(&mut tr, &song(180.0, 12.0, 100.0, 0.0, 9)).expect("un tempo").bpm;
        assert!((got - 180.0).abs() < 4.0 || (got - 90.0).abs() < 2.0, "trouvé {got}");
    }

    #[test]
    fn works_at_eco_sampling_rate() {
        // En économie d'énergie, le niveau est lu 50 fois par seconde.
        let mut tr = TempoTracker::new(50.0);
        let got = run(&mut tr, &song(124.0, 12.0, 50.0, 0.3, 11)).expect("un tempo");
        assert!((got.bpm - 124.0).abs() < 3.0, "trouvé {}", got.bpm);
    }

    #[test]
    fn phase_lands_on_the_beat() {
        // Le dernier échantillon est à 11,99 s ; à 120 BPM avec le premier temps à 0,13 s,
        // le dernier temps était à 11,63 s : 0,36 s plus tôt, soit 72 % d'un temps.
        let mut tr = TempoTracker::new(100.0);
        let got = run(&mut tr, &song(120.0, 12.0, 100.0, 0.13, 4)).expect("un tempo");
        let want = ((11.99f32 - 0.13) % 0.5) / 0.5;
        let d = (got.phase - want).abs();
        assert!(d.min(1.0 - d) < 0.08, "phase {} au lieu de {want}", got.phase);
    }

    #[test]
    fn silence_and_noise_give_nothing() {
        let mut tr = TempoTracker::new(100.0);
        assert_eq!(run(&mut tr, &vec![0.0; 1000]), None);
        // Un bruit sans rythme : rien de net, ou en tout cas pas deux fois le même.
        let mut rng = Lcg(42);
        let noise: Vec<f32> = (0..1000).map(|_| 0.3 + 0.05 * rng.next()).collect();
        let mut tr = TempoTracker::new(100.0);
        let _ = run(&mut tr, &noise);
        // Un bruit peut tomber par hasard sur une mesure, mais il ne doit pas
        // en sortir un rythme net : la netteté reste faible.
        assert!(tr.bpm().is_none() || tr.confidence < 0.3, "bruit pris pour un rythme net : {:?}", tr.bpm());
    }

    #[test]
    fn needs_a_few_seconds_before_answering() {
        let mut tr = TempoTracker::new(100.0);
        assert_eq!(run(&mut tr, &song(120.0, 3.0, 100.0, 0.0, 1)), None);
    }

    #[test]
    fn follows_a_tempo_change() {
        let mut tr = TempoTracker::new(100.0);
        let first = run(&mut tr, &song(100.0, 10.0, 100.0, 0.0, 3)).expect("un tempo").bpm;
        assert!((first - 100.0).abs() < 2.0);
        // Le morceau suivant enchaîne sans silence, plus vite.
        let then = run(&mut tr, &song(136.0, 14.0, 100.0, 0.05, 8)).expect("un tempo").bpm;
        assert!((then - 136.0).abs() < 3.0, "toujours {then}");
    }

    #[test]
    fn silence_resets() {
        let mut tr = TempoTracker::new(100.0);
        assert!(run(&mut tr, &song(120.0, 10.0, 100.0, 0.0, 4)).is_some());
        assert_eq!(run(&mut tr, &vec![0.0; 200]), None);
        assert_eq!(tr.bpm(), None);
    }

    #[test]
    fn double_or_half_keeps_the_tempo() {
        // Le tempo retenu est 60 ; la mesure trouve 120 (la même musique comptée en double) : on garde 60.
        let mut tr = TempoTracker::new(100.0);
        run(&mut tr, &song(120.0, 10.0, 100.0, 0.0, 4));
        tr.locked = Some(60.0);
        let got = run(&mut tr, &song(120.0, 3.0, 100.0, 0.0, 5)).expect("un tempo");
        assert!((got.bpm - 60.0).abs() < 0.5, "{}", got.bpm);
        assert!(same(121.0, 120.0) && !same(126.0, 120.0));
    }

    #[test]
    fn bad_samples_are_ignored() {
        let mut tr = TempoTracker::new(100.0);
        tr.push(f32::NAN);
        tr.push(7.0);
        tr.push(-1.0);
        assert!(tr.onset.iter().all(|v| v.is_finite()));
    }
}
