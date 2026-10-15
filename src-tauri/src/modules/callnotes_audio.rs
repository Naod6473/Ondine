// Notes d'appel (1.2.4) : le son, en code pur testé (rien de Windows ici).
//
//   - `Downsampler` : la fréquence de l'appareil (48 kHz…) → 16 kHz, au fil
//     de l'eau (moyenne des échantillons couverts, comme `wav_16k` de la voix) ;
//   - `WavWriter` / `read_wav` : le fichier TEMPORAIRE d'un côté de l'appel
//     (16 kHz, mono, 16 bits), effacé dès que la transcription est écrite ;
//   - `Live` : ce que les mots en direct n'ont pas encore pris (un morceau
//     finit sur une pause, ou au bout de 12 s) ;
//   - `segments` : un long enregistrement coupé en morceaux qui finissent
//     sur un silence, pour la transcription finale (Parakeet ou API).
//
// Quelques idées (morceaux qui finissent sur une pause, coupe au moment le
// plus calme) viennent du Notetaker de Coucou (MIT, voir THIRD-PARTY.md).

use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::services::speech::SAMPLE_RATE;

/// Au-dessous de ce niveau (crête), un morceau est du silence : rien n'est transcrit.
pub const QUIET: f32 = 0.01;

/// Le plus fort échantillon (valeur absolue).
pub fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()))
}

// ── 16 kHz ───────────────────────────────────────────────────────────────────

/// Ramène un son à 16 kHz, morceau par morceau : l'échantillon de sortie n°i
/// est la moyenne des échantillons d'entrée [i·r/16000, (i+1)·r/16000).
pub struct Downsampler {
    rate: u64,
    /// Les échantillons reçus pas encore utilisés, et le numéro du premier.
    buf: Vec<f32>,
    first: u64,
    /// Le numéro du prochain échantillon de sortie.
    out: u64,
}

impl Downsampler {
    pub fn new(rate: u32) -> Downsampler {
        Downsampler { rate: u64::from(rate.max(1)), buf: Vec::new(), first: 0, out: 0 }
    }

    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let target = u64::from(SAMPLE_RATE);
        self.buf.extend_from_slice(input);
        let have = self.first + self.buf.len() as u64;
        loop {
            let a = self.out * self.rate / target;
            let b = ((self.out + 1) * self.rate / target).max(a + 1);
            if b > have {
                break;
            }
            let slice = &self.buf[(a - self.first) as usize..(b - self.first) as usize];
            out.push(slice.iter().sum::<f32>() / slice.len() as f32);
            self.out += 1;
        }
        // On garde ce dont le prochain échantillon de sortie aura besoin.
        let next = (self.out * self.rate / target).min(have);
        let drop = (next - self.first) as usize;
        if drop > 0 {
            self.buf.drain(..drop);
            self.first = next;
        }
    }
}

// ── Fichiers WAV temporaires ─────────────────────────────────────────────────

/// Un WAV 16 kHz mono 16 bits écrit au fil de l'appel ; l'en-tête est
/// complété à la fin (`finish`).
pub struct WavWriter {
    out: BufWriter<File>,
    samples: u64,
}

impl WavWriter {
    pub fn create(path: &Path) -> std::io::Result<WavWriter> {
        let mut out = BufWriter::new(File::create(path)?);
        out.write_all(&header(0))?;
        Ok(WavWriter { out, samples: 0 })
    }

    pub fn write(&mut self, samples: &[f32]) -> std::io::Result<()> {
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            bytes.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        self.samples += samples.len() as u64;
        self.out.write_all(&bytes)
    }

    pub fn finish(mut self) -> std::io::Result<()> {
        let data = (self.samples * 2).min(u64::from(u32::MAX - 36)) as u32;
        self.out.flush()?;
        let mut file = self.out.into_inner().map_err(|e| e.into_error())?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(&header(data))?;
        file.flush()
    }
}

fn header(data_bytes: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&SAMPLE_RATE.to_le_bytes());
    h[28..32].copy_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

/// Relit un WAV écrit par `WavWriter`. Un fichier coupé (Ondine fermée en
/// plein appel, en-tête jamais complété) est lu jusqu'au bout quand même.
pub fn read_wav(path: &Path) -> Result<Vec<f32>, String> {
    let mut bytes = Vec::new();
    File::open(path).and_then(|mut f| f.read_to_end(&mut bytes)).map_err(|e| format!("enregistrement illisible : {e}"))?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[36..40] != b"data" {
        return Err("enregistrement illisible".into());
    }
    Ok(bytes[44..].chunks_exact(2).map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0).collect())
}

// ── Les mots en direct ───────────────────────────────────────────────────────

/// Ce qu'un côté de l'appel a capté depuis le dernier morceau transcrit en direct.
#[derive(Default)]
pub struct Live {
    pending: Vec<f32>,
    /// Où commence `pending`, en échantillons depuis le début de l'appel.
    start: u64,
    total: u64,
}

impl Live {
    pub fn push(&mut self, samples: &[f32]) {
        self.pending.extend_from_slice(samples);
        self.total += samples.len() as u64;
    }

    /// Un morceau pour les mots en direct : au moins 1,5 s, qui finit sur une
    /// pause (0,5 s calme), ou 12 s d'un coup. Le silence est jeté. Renvoie
    /// (début en secondes, échantillons).
    pub fn take(&mut self) -> Option<(f64, Vec<f32>)> {
        let rate = SAMPLE_RATE as usize;
        if self.pending.len() < rate * 3 / 2 {
            return None;
        }
        let tail = &self.pending[self.pending.len() - rate / 2..];
        if peak(tail) >= QUIET && self.pending.len() < rate * 12 {
            return None;
        }
        let start = self.start as f64 / f64::from(SAMPLE_RATE);
        let chunk = std::mem::take(&mut self.pending);
        self.start = self.total;
        (peak(&chunk) >= QUIET).then_some((start, chunk))
    }
}

// ── Morceaux pour la transcription finale ────────────────────────────────────

/// Coupe un long enregistrement en morceaux de `max_secs` au plus, chacun
/// coupé au moment le plus calme de ses 8 dernières secondes. Les morceaux
/// silencieux sont écartés. Renvoie (début, fin) en échantillons.
pub fn segments(samples: &[f32], max_secs: u32) -> Vec<(usize, usize)> {
    let rate = SAMPLE_RATE as usize;
    let max = (max_secs as usize * rate).max(rate);
    let window = rate / 10;
    let mut out = Vec::new();
    let mut start = 0;
    while start < samples.len() {
        let mut end = samples.len();
        if samples.len() - start > max {
            let search_from = start + max.saturating_sub(8 * rate);
            end = start + max;
            let mut best = f64::MAX;
            let mut at = search_from;
            while at + window <= start + max {
                let e: f64 = samples[at..at + window].iter().map(|&s| f64::from(s) * f64::from(s)).sum();
                if e < best {
                    best = e;
                    end = at + window / 2;
                }
                at += window / 2;
            }
        }
        if peak(&samples[start..end]) >= QUIET {
            out.push((start, end));
        }
        start = end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downsampling_48k_gives_one_sample_in_three() {
        let mut d = Downsampler::new(48_000);
        let mut out = Vec::new();
        // En petits morceaux irréguliers : même résultat qu'en un seul.
        let input: Vec<f32> = (0..4800).map(|i| (i % 3) as f32).collect();
        for part in input.chunks(7) {
            d.push(part, &mut out);
        }
        assert_eq!(out.len(), 1600);
        assert!(out.iter().all(|&v| (v - 1.0).abs() < 1e-6));
        // 16 kHz : tel quel.
        let mut same = Downsampler::new(16_000);
        let mut o = Vec::new();
        same.push(&[0.1, 0.2, 0.3], &mut o);
        assert_eq!(o, [0.1, 0.2, 0.3]);
        // 44,1 kHz : la bonne longueur à un échantillon près.
        let mut odd = Downsampler::new(44_100);
        let mut o = Vec::new();
        odd.push(&vec![0.5; 44_100], &mut o);
        assert!((15_999..=16_000).contains(&o.len()));
    }

    #[test]
    fn wav_files_round_trip_even_unfinished() {
        let dir = std::env::temp_dir().join(format!("ondine-callnotes-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.wav");
        let mut w = WavWriter::create(&path).unwrap();
        w.write(&[0.0, 0.5, -0.5]).unwrap();
        w.write(&[1.0]).unwrap();
        w.finish().unwrap();
        let back = read_wav(&path).unwrap();
        assert_eq!(back.len(), 4);
        assert!((back[1] - 0.5).abs() < 0.001 && (back[2] + 0.5).abs() < 0.001);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(u32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]]), 8);
        // Jamais fini (Ondine fermée en plein appel) : lu quand même.
        let cut = dir.join("b.wav");
        let mut w = WavWriter::create(&cut).unwrap();
        w.write(&[0.25; 10]).unwrap();
        drop(w);
        assert_eq!(read_wav(&cut).unwrap().len(), 10);
        assert!(read_wav(&dir.join("absent.wav")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn live_chunks_end_on_a_pause() {
        let rate = SAMPLE_RATE as usize;
        let mut live = Live::default();
        live.push(&vec![0.3; rate]);
        assert!(live.take().is_none()); // trop court
        live.push(&vec![0.3; rate]);
        assert!(live.take().is_none()); // on parle encore
        live.push(&vec![0.0; rate / 2]);
        let (start, chunk) = live.take().unwrap();
        assert_eq!(start, 0.0);
        assert_eq!(chunk.len(), rate * 5 / 2);
        // Le suivant commence où le premier s'arrête ; du silence seul est jeté.
        live.push(&vec![0.0; rate * 2]);
        assert!(live.take().is_none());
        live.push(&vec![0.3; rate * 13]);
        let (start, _) = live.take().unwrap();
        assert_eq!(start, 4.5);
    }

    #[test]
    fn long_audio_is_cut_in_the_quiet_and_silence_is_dropped() {
        let rate = SAMPLE_RATE as usize;
        let mut s = vec![0.4f32; rate * 50];
        // Un creux calme vers 25 s.
        for v in &mut s[rate * 25..rate * 25 + rate / 2] {
            *v = 0.0;
        }
        let segs = segments(&s, 30);
        assert_eq!(segs.len(), 2);
        let cut = segs[0].1;
        assert!(cut > rate * 25 && cut < rate * 25 + rate / 2, "coupé à {cut}");
        assert_eq!(segs[1], (cut, rate * 50));
        assert!(segments(&vec![0.0; rate * 40], 30).is_empty());
        assert!(segments(&[], 30).is_empty());
    }
}
