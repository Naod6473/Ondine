// Empreinte d'un fichier (Étagère) : glisser un fichier sur la cible
// « Empreinte » de l'île calcule son SHA-256, ou le compare à une empreinte
// copiée.
//
//   - le calcul se fait dans un thread, en lisant le fichier par blocs de 1 Mo :
//     un ISO de plusieurs Go ne prend jamais plus d'un bloc en mémoire ;
//   - si le presse-papiers contient une empreinte (32, 40, 64 ou 128 chiffres
//     hexadécimaux : MD5, SHA-1, SHA-256 ou SHA-512), on calcule le même
//     algorithme et on dit si c'est identique. Un texte copié peut en contenir
//     plusieurs (une liste « SHA256SUMS ») : le fichier est identique s'il
//     correspond à l'une d'elles. Sinon, SHA-256 ;
//   - le presse-papiers n'est lu que s'il n'est pas marqué sensible ; son texte
//     n'est jamais écrit dans le journal ni envoyé sur le bus (seulement
//     « identique : oui / non ») ;
//   - un seul calcul à la fois, 5 fichiers au plus ; « Arrêter » l'interrompt.
//
// Le résultat arrive au front par le sujet "shelf.hashed" ; pendant un long
// calcul, "shelf.hash-progress" donne le pourcentage (une fois par seconde).

use crate::sync::LockExt;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::Digest;
use tauri::AppHandle;

use super::ModuleContext;
use crate::platform;
use crate::services::{bus, files, log};

/// Au plus tant de fichiers à la fois (au-delà, on refuse poliment).
pub const MAX_FILES: usize = 5;
/// La taille d'un bloc lu (le fichier n'est jamais lu en entier d'un coup).
const BLOCK: usize = 1024 * 1024;
/// En dessous de cette taille (tous fichiers compris), pas de pourcentage : c'est trop rapide.
const PROGRESS_FROM: u64 = 64 * 1024 * 1024;
/// Un pourcentage au plus toutes les…
const PROGRESS_EVERY: Duration = Duration::from_secs(1);
/// Un texte copié plus long n'est pas regardé (ce n'est pas une liste d'empreintes).
const MAX_CLIPBOARD_CHARS: usize = 200_000;
/// L'erreur d'un calcul interrompu par « Arrêter ».
const CANCELLED: &str = "arrêté";

/// Les algorithmes reconnus, d'après la longueur de l'empreinte copiée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algo {
    Md5,
    Sha1,
    Sha256,
    Sha512,
}

impl Algo {
    pub fn name(self) -> &'static str {
        match self {
            Algo::Md5 => "MD5",
            Algo::Sha1 => "SHA-1",
            Algo::Sha256 => "SHA-256",
            Algo::Sha512 => "SHA-512",
        }
    }

    /// 32 chiffres hexadécimaux = MD5, 40 = SHA-1, 64 = SHA-256, 128 = SHA-512.
    pub fn from_hex_len(len: usize) -> Option<Algo> {
        match len {
            32 => Some(Algo::Md5),
            40 => Some(Algo::Sha1),
            64 => Some(Algo::Sha256),
            128 => Some(Algo::Sha512),
            _ => None,
        }
    }
}

/// Les empreintes trouvées dans un texte copié : l'algorithme (d'après la
/// première trouvée) et toutes celles de cette longueur, en minuscules.
/// Marche avec une empreinte seule, « sha256:… », la sortie de sha256sum
/// (« empreinte  fichier.iso », une par ligne) ou de certutil / openssl.
/// None : aucune empreinte dans le texte.
pub fn expected_from_text(text: &str) -> Option<(Algo, Vec<String>)> {
    if text.chars().count() > MAX_CLIPBOARD_CHARS {
        return None;
    }
    let mut algo = None;
    let mut found: Vec<String> = Vec::new();
    // Un mot = une suite de lettres et de chiffres : « sha256:abc… » donne
    // « sha256 » et « abc… » ; une empreinte collée à d'autres lettres n'en est pas une.
    for word in text.split(|c: char| !c.is_ascii_alphanumeric()) {
        if !word.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        let Some(a) = Algo::from_hex_len(word.len()) else { continue };
        if *algo.get_or_insert(a) != a {
            continue;
        }
        let word = word.to_ascii_lowercase();
        if !found.contains(&word) && found.len() < 10_000 {
            found.push(word);
        }
    }
    algo.map(|a| (a, found))
}

/// L'empreinte de tout ce que donne `reader`, lu par blocs. `progress` reçoit
/// le nombre d'octets lus après chaque bloc ; `cancel` arrête le calcul.
pub fn hash_reader(reader: impl Read, algo: Algo, cancel: &AtomicBool, progress: impl FnMut(u64)) -> Result<String, String> {
    match algo {
        Algo::Md5 => digest::<md5::Md5>(reader, cancel, progress),
        Algo::Sha1 => digest::<sha1::Sha1>(reader, cancel, progress),
        Algo::Sha256 => digest::<sha2::Sha256>(reader, cancel, progress),
        Algo::Sha512 => digest::<sha2::Sha512>(reader, cancel, progress),
    }
}

/// Le même calcul pour chaque algorithme (ils ont tous la même forme : `Digest`).
fn digest<D: Digest>(mut reader: impl Read, cancel: &AtomicBool, mut progress: impl FnMut(u64)) -> Result<String, String> {
    let mut hasher = D::new();
    let mut buf = vec![0u8; BLOCK];
    let mut total = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(format!("lecture impossible : {e}")),
        };
        hasher.update(&buf[..n]);
        total += n as u64;
        progress(total);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.display().to_string())
}

// ── Le calcul en fond ────────────────────────────────────────────────────────

/// Un calcul est-il en cours ? (un seul à la fois)
static RUNNING: AtomicBool = AtomicBool::new(false);
/// « Arrêter » a été demandé.
static CANCEL: AtomicBool = AtomicBool::new(false);
/// Le numéro du dernier calcul (pour « Copier » le bon résultat).
static JOB: AtomicU64 = AtomicU64::new(0);
/// Le dernier résultat : (numéro du calcul, [(nom, empreinte)]). Pour « Copier ».
static LAST: Mutex<(u64, Vec<(String, String)>)> = Mutex::new((0, Vec::new()));

/// "hash" { paths } : lance le calcul (chemins déjà validés, des fichiers).
/// Répond tout de suite ; le résultat arrive par "shelf.hashed".
pub fn start(ctx: &ModuleContext, paths: Vec<PathBuf>) -> Result<Value, String> {
    if paths.len() > MAX_FILES {
        return Err(format!("{MAX_FILES} fichiers au plus à la fois (vous en avez glissé {})", paths.len()));
    }
    if paths.is_empty() {
        return Err("aucun fichier (les dossiers n'ont pas d'empreinte)".into());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("une empreinte est déjà en cours de calcul".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let expected = if ctx.require("clipboard").is_ok() { expected_from_clipboard() } else { None };
    let algo = expected.as_ref().map(|(a, _)| *a).unwrap_or(Algo::Sha256);
    let total: u64 = paths.iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum();
    let job = JOB.fetch_add(1, Ordering::SeqCst) + 1;
    ctx.emit("task.started", json!({ "label": "Empreinte" }));
    // Le journal dit qu'on calcule, jamais ce qui était copié.
    ctx.log_info(format!("empreinte {} de {} fichier(s){}", algo.name(), paths.len(), if expected.is_some() { ", comparée à une empreinte copiée" } else { "" }));

    let app = ctx.app.clone();
    let (compare, count) = (expected.is_some(), paths.len());
    let spawned = std::thread::Builder::new().name("ondine-empreinte".into()).spawn(move || {
        let outcome = catch_unwind(AssertUnwindSafe(|| run(&app, job, &paths, algo, expected.as_ref().map(|(_, list)| list.as_slice()), total)));
        RUNNING.store(false, Ordering::SeqCst);
        let payload = outcome.unwrap_or_else(|_| {
            log::warn("empreinte : panique pendant le calcul");
            json!({ "job": job, "algo": algo.name(), "error": "erreur interne", "results": [] })
        });
        let ok = payload.get("error").is_none_or(Value::is_null) && !payload["cancelled"].as_bool().unwrap_or(false);
        bus::emit(&app, "shelf", "shelf.hashed", payload);
        bus::emit(&app, "shelf", if ok { "task.finished" } else { "task.failed" }, json!({ "label": "Empreinte" }));
    });
    if let Err(e) = spawned {
        RUNNING.store(false, Ordering::SeqCst);
        return Err(format!("calcul impossible : {e}"));
    }
    Ok(json!({ "job": job, "algo": algo.name(), "compare": compare, "count": count, "bytes": total }))
}

/// "hash_cancel" : arrête le calcul en cours (sans effet s'il n'y en a pas).
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// "hash_copy" { job } : copie le résultat de ce calcul. Un fichier :
/// l'empreinte seule ; plusieurs : une ligne « empreinte  nom » par fichier
/// (la forme de sha256sum, que d'autres outils savent relire).
pub fn copy(args: &Value) -> Result<Value, String> {
    let job = args.get("job").and_then(Value::as_u64).ok_or("paramètre « job » manquant")?;
    let text = {
        let last = LAST.locked();
        if last.0 != job || last.1.is_empty() {
            return Err("ce résultat n'est plus disponible".into());
        }
        sums_text(&last.1)
    };
    files::copy_text(&text)?;
    Ok(Value::Null)
}

/// Ce que « Copier » met dans le presse-papiers.
fn sums_text(results: &[(String, String)]) -> String {
    match results {
        [(_, hex)] => hex.clone(),
        many => many.iter().map(|(name, hex)| format!("{hex}  {name}")).collect::<Vec<_>>().join("\r\n"),
    }
}

/// Les empreintes du presse-papiers, s'il y en a et s'il n'est pas marqué sensible.
fn expected_from_clipboard() -> Option<(Algo, Vec<String>)> {
    if platform::clipboard_is_sensitive() {
        return None;
    }
    let text = arboard::Clipboard::new().ok()?.get_text().ok()?;
    expected_from_text(&text)
}

/// Le travail du thread : chaque fichier à son tour. Renvoie le message "shelf.hashed".
fn run(app: &AppHandle, job: u64, paths: &[PathBuf], algo: Algo, expected: Option<&[String]>, total: u64) -> Value {
    let mut done_before = 0u64;
    let mut last_sent = Instant::now();
    let mut results = Vec::new();
    let mut copied: Vec<(String, String)> = Vec::new();
    let mut cancelled = false;
    for path in paths {
        let name = file_name(path);
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let outcome = std::fs::File::open(path)
            .map_err(|e| format!("ouverture impossible : {e}"))
            .and_then(|file| {
                hash_reader(file, algo, &CANCEL, |read| {
                    if total >= PROGRESS_FROM && last_sent.elapsed() >= PROGRESS_EVERY {
                        last_sent = Instant::now();
                        let percent = ((done_before + read) * 100 / total.max(1)).min(99);
                        bus::emit(app, "shelf", "shelf.hash-progress", json!({ "job": job, "percent": percent }));
                    }
                })
            });
        done_before += size;
        match outcome {
            Ok(hex) => {
                let matches = expected.map(|list| list.contains(&hex));
                copied.push((name.clone(), hex.clone()));
                results.push(json!({ "name": name, "hex": hex, "matches": matches }));
            }
            Err(e) if e == CANCELLED => {
                cancelled = true;
                break;
            }
            Err(e) => results.push(json!({ "name": name, "error": e })),
        }
    }
    *LAST.locked() = (job, copied);
    json!({ "job": job, "algo": algo.name(), "compared": expected.is_some(), "cancelled": cancelled, "results": results })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn of(data: &[u8], algo: Algo) -> String {
        hash_reader(data, algo, &AtomicBool::new(false), |_| {}).unwrap()
    }

    #[test]
    fn known_vectors() {
        // Vecteurs officiels (RFC 1321, FIPS 180) pour « » et « abc ».
        assert_eq!(of(b"", Algo::Md5), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(of(b"abc", Algo::Md5), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(of(b"", Algo::Sha1), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(of(b"abc", Algo::Sha1), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(of(b"", Algo::Sha256), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(of(b"abc", Algo::Sha256), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            of(b"abc", Algo::Sha512),
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
        );
        assert_eq!(of(b"The quick brown fox jumps over the lazy dog", Algo::Md5), "9e107d9d372bb6826bd81d3542a419d6");
    }

    #[test]
    fn reads_by_blocks() {
        // Un million de « a » (vecteur FIPS 180) : plus d'un bloc, et la
        // progression est donnée bloc après bloc.
        let data = vec![b'a'; 1_000_000];
        let mut steps = Vec::new();
        let hex = hash_reader(std::io::Cursor::new(&data), Algo::Sha256, &AtomicBool::new(false), |n| steps.push(n)).unwrap();
        assert_eq!(hex, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
        assert_eq!(steps.last(), Some(&1_000_000));
        // Un flux qui donne peu à la fois (comme un disque réseau) : même résultat.
        struct Slow<'a>(&'a [u8]);
        impl Read for Slow<'_> {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                let n = self.0.len().min(buf.len()).min(4096);
                buf[..n].copy_from_slice(&self.0[..n]);
                self.0 = &self.0[n..];
                Ok(n)
            }
        }
        assert_eq!(hash_reader(Slow(&data), Algo::Sha256, &AtomicBool::new(false), |_| {}).unwrap(), hex);
    }

    #[test]
    fn cancel_stops_the_work() {
        let r = hash_reader(&b"abc"[..], Algo::Sha256, &AtomicBool::new(true), |_| {});
        assert_eq!(r, Err(CANCELLED.to_string()));
    }

    #[test]
    fn a_real_file() {
        let dir = std::env::temp_dir().join("ondine-hash-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc.txt");
        std::fs::write(&path, b"abc").unwrap();
        let file = std::fs::File::open(&path).unwrap();
        assert_eq!(hash_reader(file, Algo::Sha1, &AtomicBool::new(false), |_| {}).unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(file_name(&path), "abc.txt");
    }

    #[test]
    fn algorithm_from_the_copied_hash() {
        let sha = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
        assert_eq!(expected_from_text(sha), Some((Algo::Sha256, vec![sha.to_lowercase()])));
        assert_eq!(expected_from_text("900150983cd24fb0d6963f7d28e17f72").unwrap().0, Algo::Md5);
        assert_eq!(expected_from_text(" a9993e364706816aba3e25717850c26c9cd0d89d\n").unwrap().0, Algo::Sha1);
        assert_eq!(expected_from_text(&"ab".repeat(64)).unwrap().0, Algo::Sha512);
        // Avec ce qui l'entoure souvent : « sha256: », la sortie de sha256sum,
        // d'openssl, de certutil.
        let found = |t: &str| expected_from_text(t).map(|(a, list)| (a, list.len()));
        assert_eq!(found(&format!("sha256:{sha}")), Some((Algo::Sha256, 1)));
        assert_eq!(found(&format!("{sha}  ubuntu-24.04.iso")), Some((Algo::Sha256, 1)));
        assert_eq!(found(&format!("SHA256(ubuntu.iso)= {sha}")), Some((Algo::Sha256, 1)));
        assert_eq!(found(&format!("Hachage SHA256 de ubuntu.iso :\r\n{sha}\r\nCertUtil: -hashfile La commande s'est terminée correctement.")), Some((Algo::Sha256, 1)));
    }

    #[test]
    fn a_list_of_hashes() {
        // Une liste SHA256SUMS : toutes les empreintes de 64 chiffres sont gardées.
        let a = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let b = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let (algo, list) = expected_from_text(&format!("{a} *vide.txt\n{b} *abc.txt\n{a} *autre.txt\n")).unwrap();
        assert_eq!(algo, Algo::Sha256);
        assert_eq!(list, vec![a.to_string(), b.to_string()]);
        // Des longueurs mélangées : on garde celle de la première.
        let (algo, list) = expected_from_text(&format!("{a}\n900150983cd24fb0d6963f7d28e17f72")).unwrap();
        assert_eq!((algo, list.len()), (Algo::Sha256, 1));
    }

    #[test]
    fn no_hash_in_ordinary_text() {
        assert_eq!(expected_from_text(""), None);
        assert_eq!(expected_from_text("Bonjour, voici le fichier."), None);
        // Un UUID n'est pas une empreinte (ses morceaux sont trop courts)…
        assert_eq!(expected_from_text("550e8400-e29b-41d4-a716-446655440000"), None);
        // … ni des chiffres hexadécimaux collés à d'autres lettres, ni une mauvaise longueur.
        assert_eq!(expected_from_text(&format!("x{}", "a".repeat(64))), None);
        assert_eq!(expected_from_text(&"a".repeat(63)), None);
        assert_eq!(expected_from_text(&"a".repeat(65)), None);
        assert_eq!(expected_from_text(&"a".repeat(MAX_CLIPBOARD_CHARS + 1)), None);
    }

    #[test]
    fn copied_text_looks_like_sha256sum() {
        let one = vec![("a.iso".to_string(), "abc".to_string())];
        assert_eq!(sums_text(&one), "abc");
        let two = vec![("a.iso".to_string(), "abc".to_string()), ("b.iso".to_string(), "def".to_string())];
        assert_eq!(sums_text(&two), "abc  a.iso\r\ndef  b.iso");
    }

    #[test]
    fn names() {
        assert_eq!(Algo::from_hex_len(64), Some(Algo::Sha256));
        assert_eq!(Algo::from_hex_len(48), None);
        assert_eq!(Algo::Sha512.name(), "SHA-512");
    }
}
