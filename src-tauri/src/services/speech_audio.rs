// La reconnaissance vocale sur le PC (1.2.4) : tout ce qui ne touche ni au
// modèle ni au système, testé sous Linux.
//
//   - `to_16k_mono` : n'importe quel son (stéréo, 44,1 ou 48 kHz…) vers ce que
//     les modèles attendent, 16 kHz mono (filtre « sinc » fenêtré de 32
//     coefficients : propre pour la voix, peu de calcul) ;
//   - `split_for_model` : un long enregistrement coupé en morceaux de 28 s au
//     plus, là où c'est le plus calme (Parakeet n'avale pas une heure d'un coup) ;
//   - `words_from_tokens` : les morceaux de mots de Parakeet (« ▁dem », « ande »,
//     « z ») recollés en mots, chacun avec son moment ;
//   - `group_turns` : les mots rangés par voix (ce que dit la séparation des
//     voix) en tours de parole lisibles.
//
// Technique reprise et adaptée de Coucou (licence MIT, voir THIRD-PARTY.md).

// Le découpage et les mots ne servent qu'au moteur (Windows) ; les tours de
// parole, aux notes d'appel (autre branche de la 1.2.4).
#![allow(dead_code)]

use super::speech::{Turn, SAMPLE_RATE};

// ── Rééchantillonnage ─────────────────────────────────────────────────────────

/// Les coefficients de chaque côté de l'échantillon calculé.
const HALF_TAPS: isize = 16;

/// Un son entrelacé (`channels` voies, `rate` Hz) → 16 kHz mono.
pub fn to_16k_mono(interleaved: &[f32], channels: u16, rate: u32) -> Vec<f32> {
    let mono = to_mono(interleaved, channels);
    resample(&mono, rate)
}

/// La moyenne des voies (gauche + droite) : une seule voix.
pub fn to_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
    let n = usize::from(channels.max(1));
    if n == 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks_exact(n).map(|frame| frame.iter().sum::<f32>() / n as f32).collect()
}

/// Un son mono de `rate` Hz → 16 kHz (déjà à 16 kHz : recopié tel quel).
pub fn resample(input: &[f32], rate: u32) -> Vec<f32> {
    if rate == 0 || input.is_empty() {
        return Vec::new();
    }
    if rate == SAMPLE_RATE {
        return input.to_vec();
    }
    // Échantillons d'entrée par échantillon de sortie.
    let step = f64::from(rate) / f64::from(SAMPLE_RATE);
    // Fréquence de coupure : sous la moitié de la plus basse des deux
    // fréquences (pas de « repliement » quand on descend), avec une marge.
    let fc = (1.0 / step).min(1.0) * 0.92;
    let out_len = ((input.len() as f64) / step).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * step;
        let centre = pos.floor() as isize;
        let frac = pos - centre as f64;
        let mut acc = 0.0f64;
        let mut norm = 0.0f64;
        for k in (-HALF_TAPS + 1)..=HALF_TAPS {
            let idx = centre + k;
            if idx < 0 || idx as usize >= input.len() {
                continue;
            }
            let x = k as f64 - frac;
            let sinc = if x.abs() < 1e-9 { 1.0 } else { (std::f64::consts::PI * x * fc).sin() / (std::f64::consts::PI * x * fc) };
            // Fenêtre de Blackman sur les 32 coefficients.
            let n = (x + HALF_TAPS as f64) / (2.0 * HALF_TAPS as f64);
            let w = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * n).cos() + 0.08 * (4.0 * std::f64::consts::PI * n).cos();
            let c = sinc * w;
            acc += f64::from(input[idx as usize]) * c;
            norm += c;
        }
        out.push(if norm.abs() > 1e-9 { (acc / norm) as f32 } else { 0.0 });
    }
    out
}

// ── Découpage en morceaux ─────────────────────────────────────────────────────

/// Le plus long morceau donné au modèle d'un coup, en secondes.
pub const MAX_CHUNK_SECONDS: f64 = 28.0;

/// Coupe un long son en morceaux de `max_seconds` au plus : chaque coupure se
/// fait dans le passage le plus calme (fenêtres de 0,1 s) des 8 dernières
/// secondes du morceau, pour ne pas couper un mot. Rend (début, morceau) ; les
/// morceaux mis bout à bout redonnent exactement le son.
pub fn split_for_model(samples: &[f32], rate: u32, max_seconds: f64) -> Vec<(usize, &[f32])> {
    let rate = rate.max(1) as usize;
    let max = ((max_seconds * rate as f64) as usize).max(1);
    let window = (rate / 10).max(2);
    let mut out = Vec::new();
    let mut start = 0;
    while start < samples.len() {
        if samples.len() - start <= max {
            out.push((start, &samples[start..]));
            break;
        }
        let search_from = start + max.saturating_sub(8 * rate);
        let mut best = start + max;
        let mut best_energy = f64::MAX;
        let mut at = search_from;
        while at + window <= start + max {
            let e: f64 = samples[at..at + window].iter().map(|&s| f64::from(s) * f64::from(s)).sum();
            if e < best_energy {
                best_energy = e;
                best = at + window / 2;
            }
            at += window / 2;
        }
        // Jamais un morceau vide (on avance toujours).
        let best = best.max(start + 1);
        out.push((start, &samples[start..best]));
        start = best;
    }
    out
}

// ── Mots et moments ───────────────────────────────────────────────────────────

/// Un mot et sa place dans le son (secondes).
#[derive(Clone, Debug, PartialEq)]
pub struct TimedWord {
    pub text: String,
    pub start: f32,
    pub end: f32,
}

/// Les morceaux de Parakeet (« ▁Ne », « ▁vous », « ▁dem », « ande », « z ») →
/// des mots avec leur moment. Un morceau qui commence par une espace (ou « ▁ »)
/// commence un mot ; un mot finit où commence le suivant (ou un peu après son
/// dernier morceau, pour le dernier). `offset` : le début du morceau de son,
/// `length` : sa durée.
pub fn words_from_tokens(tokens: &[String], timestamps: &[f32], offset: f32, length: f32) -> Vec<TimedWord> {
    let mut out: Vec<TimedWord> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        let at = offset + timestamps.get(i).copied().unwrap_or(0.0);
        let starts_word = token.starts_with(' ') || token.starts_with('▁') || out.is_empty();
        let piece = token.trim_start_matches([' ', '▁']);
        if starts_word {
            if let Some(last) = out.last_mut() {
                last.end = last.end.max(at);
            }
            if piece.is_empty() {
                continue;
            }
            out.push(TimedWord { text: piece.to_string(), start: at, end: at + 0.08 });
        } else if let Some(last) = out.last_mut() {
            last.text.push_str(piece);
            last.end = at + 0.08;
        }
    }
    if let Some(last) = out.last_mut() {
        last.end = (last.end + 0.25).min(offset + length).max(last.start);
    }
    out.retain(|w| !w.text.is_empty());
    out
}

// ── Tours de parole ───────────────────────────────────────────────────────────

/// Un passage où une voix parle, selon la séparation des voix.
#[derive(Clone, Debug, PartialEq)]
pub struct Segment {
    /// Le numéro donné par le modèle (dans un ordre quelconque).
    pub speaker: i32,
    pub start: f32,
    pub end: f32,
}

/// Des mots plus espacés que ça commencent un nouveau tour.
pub const PAUSE: f32 = 1.4;
/// Un tour ne dépasse jamais ça : la transcription reste lisible.
pub const MAX_TURN_SECONDS: f32 = 40.0;
/// Un mot hors de tout passage est donné à la voix la plus proche, à moins de ça.
const NEAREST: f32 = 2.0;

fn distance(t: f32, s: &Segment) -> f32 {
    if t < s.start {
        s.start - t
    } else if t > s.end {
        t - s.end
    } else {
        0.0
    }
}

/// La voix qui parle au milieu du mot, ou la plus proche ; None si aucune n'est assez près.
fn speaker_of(word: &TimedWord, segments: &[Segment]) -> Option<i32> {
    let mid = (word.start + word.end) / 2.0;
    if let Some(s) = segments.iter().find(|s| mid >= s.start && mid <= s.end) {
        return Some(s.speaker);
    }
    segments
        .iter()
        .min_by(|a, b| distance(mid, a).total_cmp(&distance(mid, b)))
        .filter(|s| distance(mid, s) < NEAREST)
        .map(|s| s.speaker)
}

/// Les mots rangés en tours de parole : chaque mot va à la voix qui parle à ce
/// moment (sinon la plus proche, sinon celle du mot d'avant) ; les mots qui se
/// suivent d'une même voix, sans longue pause, font un tour. Les voix sont
/// renumérotées 0, 1, 2… dans l'ordre où elles parlent pour la première fois.
/// Sans passages (une seule voix, ou séparation impossible) : tout est la voix 0.
pub fn group_turns(words: &[TimedWord], segments: &[Segment]) -> Vec<Turn> {
    let mut order: Vec<i32> = Vec::new();
    let mut previous: Option<usize> = None;
    let mut out: Vec<Turn> = Vec::new();
    for w in words {
        let speaker = match speaker_of(w, segments) {
            Some(raw) => match order.iter().position(|&s| s == raw) {
                Some(i) => i,
                None => {
                    order.push(raw);
                    order.len() - 1
                }
            },
            None => previous.unwrap_or(0),
        };
        previous = Some(speaker);
        if let Some(last) = out.last_mut() {
            if last.speaker == speaker && w.start - last.end < PAUSE && w.end - last.start < MAX_TURN_SECONDS {
                last.text.push(' ');
                last.text.push_str(&w.text);
                last.end = w.end;
                continue;
            }
        }
        out.push(Turn { speaker, start: w.start, end: w.end, text: w.text.clone() });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f64, rate: u32, seconds: f64) -> Vec<f32> {
        let n = (f64::from(rate) * seconds) as usize;
        (0..n).map(|i| (0.5 * (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(rate)).sin()) as f32).collect()
    }

    /// La fréquence d'un son simple, par les passages à zéro.
    fn frequency(samples: &[f32], rate: u32) -> f64 {
        let crossings = samples.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        crossings as f64 * f64::from(rate) / samples.len() as f64
    }

    #[test]
    fn resampling_keeps_the_length_and_the_tone() {
        for rate in [8_000u32, 44_100, 48_000, 96_000] {
            let input = tone(440.0, rate, 1.0);
            let out = resample(&input, rate);
            assert!((out.len() as i64 - 16_000).abs() <= 1, "{rate} Hz : {} échantillons", out.len());
            let f = frequency(&out, SAMPLE_RATE);
            assert!((f - 440.0).abs() < 5.0, "{rate} Hz : {f} Hz");
            // Le volume est gardé (pas de gain parasite du filtre).
            let peak = out[100..out.len() - 100].iter().fold(0.0f32, |m, v| m.max(v.abs()));
            assert!((peak - 0.5).abs() < 0.03, "{rate} Hz : crête {peak}");
        }
        // Déjà à 16 kHz : tel quel. Rien : rien.
        let same = tone(300.0, 16_000, 0.1);
        assert_eq!(resample(&same, 16_000), same);
        assert!(resample(&[], 48_000).is_empty());
        assert!(resample(&same, 0).is_empty());
    }

    #[test]
    fn resampling_removes_what_16k_cannot_hold() {
        // 12 kHz à 48 kHz : au-delà de 8 kHz, il doit disparaître, pas se replier en 4 kHz.
        let out = resample(&tone(12_000.0, 48_000, 0.5), 48_000);
        let rms = (out[50..out.len() - 50].iter().map(|v| v * v).sum::<f32>() / (out.len() - 100) as f32).sqrt();
        assert!(rms < 0.02, "il reste {rms}");
    }

    #[test]
    fn stereo_becomes_mono() {
        assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5, -1.0, 1.0], 2), vec![0.5, 0.5, 0.0]);
        assert_eq!(to_mono(&[0.1, 0.2], 1), vec![0.1, 0.2]);
        assert_eq!(to_mono(&[0.3, 0.3, 0.3], 0), vec![0.3, 0.3, 0.3]);
        let out = to_16k_mono(&[0.25f32; 48_000 * 2], 2, 48_000);
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|v| (v - 0.25).abs() < 1e-3));
    }

    #[test]
    fn long_audio_is_cut_in_the_quiet() {
        let rate = SAMPLE_RATE;
        // 50 s de « voix » avec un silence à 25 s.
        let mut samples = tone(200.0, rate, 50.0);
        for s in &mut samples[(25.2 * f64::from(rate)) as usize..(25.6 * f64::from(rate)) as usize] {
            *s = 0.0;
        }
        let parts = split_for_model(&samples, rate, MAX_CHUNK_SECONDS);
        assert_eq!(parts.len(), 2);
        let cut = parts[1].0 as f64 / f64::from(rate);
        assert!((25.2..=25.6).contains(&cut), "coupé à {cut}");
        assert_eq!(parts.iter().map(|p| p.1.len()).sum::<usize>(), samples.len());
        // Bout à bout, les morceaux redonnent le son.
        assert_eq!(parts[0].0 + parts[0].1.len(), parts[1].0);
        // Court : un seul morceau ; vide : aucun.
        assert_eq!(split_for_model(&samples[..1000], rate, MAX_CHUNK_SECONDS).len(), 1);
        assert!(split_for_model(&[], rate, MAX_CHUNK_SECONDS).is_empty());
        // Très long (3 min) : jamais un morceau de plus de 28 s.
        let long = tone(150.0, rate, 180.0);
        let parts = split_for_model(&long, rate, MAX_CHUNK_SECONDS);
        assert!(parts.len() >= 7);
        assert!(parts.iter().all(|p| p.1.len() as f64 <= MAX_CHUNK_SECONDS * f64::from(rate) && !p.1.is_empty()));
        assert_eq!(parts.iter().map(|p| p.1.len()).sum::<usize>(), long.len());
    }

    fn toks(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn tokens_make_words_with_their_times() {
        let words = words_from_tokens(&toks(&[" Ne", " vous", " dem", "ande", "z", "▁pas", "."]), &[0.0, 0.16, 0.32, 0.4, 0.56, 0.72, 0.8], 10.0, 2.0);
        let texts: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["Ne", "vous", "demandez", "pas."]);
        assert!((words[2].start - 10.32).abs() < 1e-4);
        assert!(words[2].end >= 10.72 - 1e-4);
        assert!(words[3].end <= 12.0);
        assert!(words_from_tokens(&[], &[], 0.0, 1.0).is_empty());
    }

    fn word(text: &str, start: f32, end: f32) -> TimedWord {
        TimedWord { text: text.into(), start, end }
    }

    #[test]
    fn words_are_grouped_into_turns() {
        let words = [
            word("Bonjour", 0.0, 0.4),
            word("à", 0.5, 0.6),
            word("tous.", 0.6, 0.9),
            word("Salut", 1.2, 1.5),
            word("Alice.", 1.5, 1.9),
            word("On", 2.3, 2.4),
            word("commence", 2.4, 2.8),
            // Un mot entre deux passages, tout près du second.
            word("?", 4.95, 5.0),
            // Après une longue pause, même voix : un nouveau tour.
            word("Oui.", 9.0, 9.3),
        ];
        // Le modèle numérote les voix dans le désordre : 7 parle en premier.
        let segments = [
            Segment { speaker: 7, start: 0.0, end: 1.0 },
            Segment { speaker: 3, start: 1.1, end: 2.0 },
            Segment { speaker: 7, start: 2.2, end: 3.0 },
            Segment { speaker: 3, start: 5.5, end: 6.0 },
            Segment { speaker: 3, start: 8.8, end: 9.5 },
        ];
        let turns = group_turns(&words, &segments);
        let got: Vec<(usize, &str)> = turns.iter().map(|t| (t.speaker, t.text.as_str())).collect();
        assert_eq!(got, [(0, "Bonjour à tous."), (1, "Salut Alice."), (0, "On commence"), (1, "?"), (1, "Oui.")]);
        assert!((turns[0].start - 0.0).abs() < 1e-6 && (turns[0].end - 0.9).abs() < 1e-6);
    }

    #[test]
    fn without_voices_everything_is_one_speaker() {
        let words = [word("Un", 0.0, 0.2), word("deux", 0.3, 0.5), word("trois", 3.0, 3.2)];
        let turns = group_turns(&words, &[]);
        assert_eq!(turns.len(), 2);
        assert!(turns.iter().all(|t| t.speaker == 0));
        assert_eq!(turns[0].text, "Un deux");
        // Un mot loin de tout passage garde la voix du mot d'avant.
        let segments = [Segment { speaker: 5, start: 0.0, end: 0.6 }, Segment { speaker: 9, start: 20.0, end: 21.0 }];
        let turns = group_turns(&words, &segments);
        assert_eq!(turns.iter().map(|t| t.speaker).collect::<Vec<_>>(), [0, 0]);
        assert!(group_turns(&[], &segments).is_empty());
    }

    #[test]
    fn a_turn_never_gets_too_long() {
        let words: Vec<TimedWord> = (0..200).map(|i| word("mot", i as f32 * 0.5, i as f32 * 0.5 + 0.3)).collect();
        let turns = group_turns(&words, &[]);
        assert!(turns.len() >= 3);
        assert!(turns.iter().all(|t| t.end - t.start < MAX_TURN_SECONDS));
    }
}
