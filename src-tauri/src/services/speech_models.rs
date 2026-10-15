// Les modèles de la reconnaissance vocale sur le PC (1.2.4) : leur liste, leur
// téléchargement (seulement au clic), leur vérification et leur suppression.
//
// - Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0), quantifié en int8 pour
//   sherpa-onnx : 25 langues européennes, ~670 Mo ;
// - la séparation des voix (notes d'appel) : la segmentation pyannote 3.0
//   (MIT) et un modèle d'empreinte de voix 3D-Speaker CAM++ (Apache-2.0), ~30 Mo.
//
// Les adresses visent Hugging Face à une révision FIXE (un commit, jamais
// « main ») : le fichier ne peut pas changer sous nos pieds. Chaque fichier
// arrive dans un « .part », sa taille et son SHA-256 sont vérifiés, puis il
// prend son vrai nom. Un fichier qui ne correspond pas est jeté. Un
// téléchargement coupé (réseau) reprend où il en était au clic suivant ;
// « Annuler » jette ce qui était commencé.
//
// Rangement : %LOCALAPPDATA%\Ondine\Models\<jeu>\. Rien d'autre ne part sur
// Internet : aucune requête tant que la personne n'a pas cliqué sur Télécharger.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::services::log;
use crate::sync::LockExt;

/// Un fichier à télécharger.
pub struct ModelFile {
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// Des fichiers rangés ensemble dans un dossier.
pub struct ModelSet {
    pub id: &'static str,
    pub files: &'static [ModelFile],
}

impl ModelSet {
    pub fn dir(&self) -> PathBuf {
        models_dir().join(self.id)
    }

    #[cfg_attr(not(windows), allow(dead_code))] // le moteur (Windows) seulement
    pub fn path(&self, name: &str) -> String {
        self.dir().join(name).to_string_lossy().into_owned()
    }

    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    /// Chaque fichier est là, avec sa taille (l'empreinte a été vérifiée à l'arrivée).
    pub fn is_present(&self) -> bool {
        self.files.iter().all(|f| fs::metadata(self.dir().join(f.name)).map(|m| m.len() == f.size).unwrap_or(false))
    }
}

/// L'adresse d'un fichier de Parakeet, à sa révision fixe.
macro_rules! parakeet_url {
    ($name:literal) => {
        concat!("https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78/", $name)
    };
}

/// Parakeet TDT 0.6B v3, int8 : les mots (dictée, Parler à Ondine, appels).
pub static PARAKEET: ModelSet = ModelSet {
    id: "parakeet-tdt-0.6b-v3-int8",
    files: &[
        ModelFile {
            name: "encoder.int8.onnx",
            url: parakeet_url!("encoder.int8.onnx"),
            size: 652_184_281,
            sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
        },
        ModelFile {
            name: "decoder.int8.onnx",
            url: parakeet_url!("decoder.int8.onnx"),
            size: 11_845_275,
            sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
        },
        ModelFile {
            name: "joiner.int8.onnx",
            url: parakeet_url!("joiner.int8.onnx"),
            size: 6_355_277,
            sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
        },
        ModelFile {
            name: "tokens.txt",
            url: parakeet_url!("tokens.txt"),
            size: 93_939,
            sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
        },
    ],
};

/// La séparation des voix : qui parle quand, dans un appel.
pub static DIARIZER: ModelSet = ModelSet {
    id: "diarizer",
    files: &[
        ModelFile {
            name: "segmentation.int8.onnx",
            url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.int8.onnx",
            size: 1_540_506,
            sha256: "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
        },
        ModelFile {
            name: "embedding.onnx",
            url: "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/0743f301363dec56491a490f6d6cbc9d67f9a3bf/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
            size: 28_281_164,
            sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
        },
    ],
};

/// Les deux jeux, téléchargés ensemble (un seul bouton).
pub static SETS: [&ModelSet; 2] = [&PARAKEET, &DIARIZER];

/// %LOCALAPPDATA%\Ondine\Models.
pub fn models_dir() -> PathBuf {
    crate::platform::local_dir().join("Models")
}

/// La taille de tout le téléchargement, en octets.
pub fn download_size() -> u64 {
    SETS.iter().map(|s| s.total_size()).sum()
}

// ── L'état du téléchargement ──────────────────────────────────────────────────

/// Ce que les Réglages affichent.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "missing", "downloading", "ready" ou "failed".
    pub state: &'static str,
    /// Octets déjà là (téléchargement en cours) et taille totale.
    pub done: u64,
    pub total: u64,
    /// Le dernier échec, en français (state = "failed").
    pub error: Option<String>,
    /// Le moteur est compilé dans cette version d'Ondine (Windows).
    pub supported: bool,
    /// Le modèle est chargé en mémoire en ce moment.
    pub loaded: bool,
}

struct Progress {
    running: bool,
    done: u64,
    error: Option<String>,
}

static PROGRESS: Mutex<Progress> = Mutex::new(Progress { running: false, done: 0, error: None });
static CANCEL: AtomicBool = AtomicBool::new(false);

/// L'état actuel (sans le moteur : `speech::status` complète).
pub fn status(supported: bool, loaded: bool) -> Status {
    let p = PROGRESS.locked();
    let total = download_size();
    let (state, done) = if p.running {
        ("downloading", p.done)
    } else if SETS.iter().all(|s| s.is_present()) {
        ("ready", total)
    } else if p.error.is_some() {
        ("failed", 0)
    } else {
        ("missing", 0)
    };
    Status { state, done, total, error: if state == "failed" { p.error.clone() } else { None }, supported, loaded }
}

/// Lance le téléchargement dans un fil à part ; `notify` est appelé à chaque
/// progrès (4 fois par seconde au plus) et à la fin. Faux si un téléchargement
/// tourne déjà.
pub fn start_download(notify: impl Fn() + Send + 'static) -> bool {
    {
        let mut p = PROGRESS.locked();
        if p.running {
            return false;
        }
        *p = Progress { running: true, done: 0, error: None };
    }
    CANCEL.store(false, Ordering::SeqCst);
    notify();
    std::thread::spawn(move || {
        log::info("reconnaissance sur le PC : téléchargement des modèles demandé");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| download_all(&notify))).unwrap_or_else(|_| Err("erreur inattendue pendant le téléchargement".into()));
        let cancelled = CANCEL.swap(false, Ordering::SeqCst);
        {
            let mut p = PROGRESS.locked();
            p.running = false;
            p.error = match &result {
                Err(_) if cancelled => None,
                Err(e) => Some(e.clone()),
                Ok(()) => None,
            };
        }
        match (&result, cancelled) {
            (Ok(()), _) => log::info("reconnaissance sur le PC : modèles téléchargés et vérifiés"),
            (Err(_), true) => {
                log::info("reconnaissance sur le PC : téléchargement annulé");
                remove_parts();
            }
            (Err(e), false) => log::warn(format!("reconnaissance sur le PC : téléchargement raté : {e}")),
        }
        notify();
    });
    true
}

/// Demande l'arrêt du téléchargement en cours (ce qui était commencé est jeté).
pub fn cancel() {
    if PROGRESS.locked().running {
        CANCEL.store(true, Ordering::SeqCst);
    }
}

/// Supprime les modèles (Réglages → Supprimer). Refusé pendant un téléchargement.
pub fn remove() -> Result<(), String> {
    if PROGRESS.locked().running {
        return Err("Un téléchargement est en cours : annulez-le d'abord.".into());
    }
    for set in SETS {
        let dir = set.dir();
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("Impossible de supprimer {} : {e}", dir.display()))?;
        }
    }
    PROGRESS.locked().error = None;
    log::info("reconnaissance sur le PC : modèles supprimés");
    Ok(())
}

/// Les « .part » laissés par un téléchargement annulé.
fn remove_parts() {
    for set in SETS {
        for f in set.files {
            let _ = fs::remove_file(part_path(&set.dir(), f.name));
        }
    }
}

fn part_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.part"))
}

/// Le client HTTP : TLS de Windows (certificats d'entreprise compris), délais
/// de connexion et de lecture (pas de délai global : 650 Mo prennent du temps).
fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .timeout_recv_body(None)
        .user_agent(concat!("Ondine/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn download_all(notify: &dyn Fn()) -> Result<(), String> {
    let agent = agent();
    let mut done_before: u64 = 0;
    let mut last = Instant::now();
    for set in SETS {
        let dir = set.dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {} : {e}", dir.display()))?;
        for file in set.files {
            let path = dir.join(file.name);
            if fs::metadata(&path).map(|m| m.len() == file.size).unwrap_or(false) {
                done_before += file.size;
                continue;
            }
            let mut on_bytes = |got: u64| {
                if last.elapsed() >= Duration::from_millis(250) {
                    last = Instant::now();
                    PROGRESS.locked().done = done_before + got;
                    notify();
                }
            };
            fetch(&agent, file, &part_path(&dir, file.name), &mut on_bytes)?;
            fs::rename(part_path(&dir, file.name), &path).map_err(|e| format!("{} : {e}", file.name))?;
            done_before += file.size;
        }
    }
    PROGRESS.locked().done = done_before;
    Ok(())
}

/// Télécharge un fichier dans `part` (en reprenant s'il est déjà commencé),
/// puis vérifie taille et empreinte. `on_bytes` reçoit les octets du fichier déjà là.
fn fetch(agent: &ureq::Agent, file: &ModelFile, part: &Path, on_bytes: &mut dyn FnMut(u64)) -> Result<(), String> {
    let err = |e: &dyn std::fmt::Display| format!("{} : {e}", file.name);
    // Ce qui est déjà là : on le relit pour l'empreinte, puis on demande la suite.
    let mut hash = Sha256::new();
    let mut have = 0u64;
    if let Ok(meta) = fs::metadata(part) {
        if meta.len() > 0 && meta.len() < file.size {
            have = hash_into(&mut hash, part).map_err(|e| err(&e))?;
        }
    }
    let mut request = agent.get(file.url);
    if have > 0 {
        request = request.header("range", &format!("bytes={have}-"));
    }
    let mut resp = request.call().map_err(|e| format!("{} : connexion impossible ({e})", file.name))?;
    let status = resp.status().as_u16();
    let mut out = match status {
        206 if have > 0 => {
            let mut f = OpenOptions::new().write(true).open(part).map_err(|e| err(&e))?;
            f.set_len(have).map_err(|e| err(&e))?;
            f.seek(SeekFrom::End(0)).map_err(|e| err(&e))?;
            f
        }
        200 => {
            // Le serveur renvoie tout : on repart de zéro.
            hash = Sha256::new();
            have = 0;
            File::create(part).map_err(|e| err(&e))?
        }
        _ => return Err(format!("{} : le serveur a répondu {status}", file.name)),
    };
    let mut reader = resp.body_mut().with_config().limit(file.size + 1).reader();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("annulé".into());
        }
        let n = reader.read(&mut buf).map_err(|e| format!("{} : téléchargement coupé ({e})", file.name))?;
        if n == 0 {
            break;
        }
        have += n as u64;
        if have > file.size {
            drop(out);
            let _ = fs::remove_file(part);
            return Err(format!("{} : le fichier reçu est plus gros que prévu", file.name));
        }
        out.write_all(&buf[..n]).map_err(|e| err(&e))?;
        hash.update(&buf[..n]);
        on_bytes(have);
    }
    out.flush().map_err(|e| err(&e))?;
    drop(out);
    if !matches(have, &hex(&hash.finalize()), file) {
        let _ = fs::remove_file(part);
        return Err(format!("{} : le fichier reçu n'est pas celui attendu (taille ou empreinte SHA-256)", file.name));
    }
    Ok(())
}

/// Ajoute le contenu d'un fichier à l'empreinte ; rend sa taille.
fn hash_into(hash: &mut Sha256, path: &Path) -> std::io::Result<u64> {
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            return Ok(total);
        }
        hash.update(&buf[..n]);
        total += n as u64;
    }
}

/// L'empreinte en hexadécimal minuscule.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Le fichier reçu est-il bien celui attendu ? (taille ET empreinte, sans
/// tenir compte des majuscules de l'empreinte attendue).
pub fn matches(size: u64, sha256_hex: &str, file: &ModelFile) -> bool {
    size == file.size && sha256_hex.eq_ignore_ascii_case(file.sha256)
}

/// Vérifie un fichier déjà sur le disque.
#[cfg(test)]
fn verify_file(path: &Path, file: &ModelFile) -> bool {
    let mut hash = Sha256::new();
    match hash_into(&mut hash, path) {
        Ok(size) => matches(size, &hex(&hash.finalize()), file),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_is_pinned_and_adds_up() {
        assert_eq!(PARAKEET.total_size(), 652_184_281 + 11_845_275 + 6_355_277 + 93_939);
        assert!(DIARIZER.total_size() < 40_000_000);
        // « environ 700 Mo » dans les Réglages.
        assert!((690_000_000..710_000_000).contains(&download_size()), "{}", download_size());
        for set in SETS {
            for f in set.files {
                assert_eq!(f.sha256.len(), 64, "{}", f.name);
                assert!(f.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{}", f.name);
                assert!(f.url.starts_with("https://huggingface.co/"), "{}", f.url);
                // Une révision fixe (un commit de 40 caractères), jamais « main ».
                let rev = f.url.split("/resolve/").nth(1).and_then(|r| r.split('/').next()).unwrap_or("");
                assert_eq!(rev.len(), 40, "{}", f.url);
                assert!(rev.chars().all(|c| c.is_ascii_hexdigit()), "{}", f.url);
                assert!(f.url.ends_with(f.name) || set.id == "diarizer", "{}", f.url);
            }
        }
    }

    const ABC: ModelFile = ModelFile {
        name: "abc.txt",
        url: "https://huggingface.co/x/resolve/0000000000000000000000000000000000000000/abc.txt",
        size: 3,
        // SHA-256 de « abc » (FIPS 180-2).
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    };

    #[test]
    fn the_fingerprint_is_checked() {
        let mut h = Sha256::new();
        h.update(b"abc");
        let digest = hex(&h.finalize());
        assert_eq!(digest, ABC.sha256);
        assert!(matches(3, &digest, &ABC));
        assert!(matches(3, &digest.to_uppercase(), &ABC));
        // Bonne empreinte, mauvaise taille ; bonne taille, autre contenu.
        assert!(!matches(4, &digest, &ABC));
        let mut h = Sha256::new();
        h.update(b"abd");
        assert!(!matches(3, &hex(&h.finalize()), &ABC));
    }

    #[test]
    fn a_file_on_disk_is_verified() {
        let dir = std::env::temp_dir().join(format!("ondine-speech-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let good = dir.join("abc.txt");
        fs::write(&good, b"abc").unwrap();
        assert!(verify_file(&good, &ABC));
        fs::write(&good, b"abX").unwrap();
        assert!(!verify_file(&good, &ABC));
        assert!(!verify_file(&dir.join("absent"), &ABC));
        // L'empreinte d'un fichier en plusieurs fois = celle du tout (reprise).
        let big: Vec<u8> = (0..700_000u32).map(|i| (i % 251) as u8).collect();
        let p = dir.join("big");
        fs::write(&p, &big).unwrap();
        let mut a = Sha256::new();
        assert_eq!(hash_into(&mut a, &p).unwrap(), 700_000);
        let mut b = Sha256::new();
        b.update(&big[..300_000]);
        b.update(&big[300_000..]);
        assert_eq!(hex(&a.finalize()), hex(&b.finalize()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn nothing_is_ready_before_the_click() {
        // Aucun téléchargement lancé dans les tests : l'état ne peut pas être « en cours ».
        let s = status(false, false);
        assert_ne!(s.state, "downloading");
        assert_eq!(s.total, download_size());
        assert!(!s.supported && !s.loaded);
    }
}
