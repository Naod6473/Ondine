// Vos propres sons (1.2.4) : un fichier posé dans %APPDATA%\Ondine\sounds,
// nommé comme un son d'Ondine (tap.wav, open.mp3, drop.ogg, close.m4a…),
// remplace ce son. Les sons d'origine sont fabriqués sur place (Web Audio,
// src/island/sounds.ts) ; ici, on lit seulement les fichiers du dossier.
//
// Règles :
//   - seuls les noms connus (`NAMES`) et les extensions .wav, .mp3, .ogg,
//     .m4a sont pris ; le reste du dossier est ignoré sans bruit ;
//   - un fichier de plus de 2 Mo, ou dont le début ne ressemble pas à son
//     format (en-tête RIFF/WAVE, ID3 ou trame MP3, OggS, ftyp), est ignoré :
//     le son d'origine reste, et une ligne le dit dans le journal ;
//   - deux fichiers pour le même son : le premier dans l'ordre
//     .wav, .mp3, .ogg, .m4a ; l'autre est ignoré (une ligne au journal) ;
//   - rien n'est exécuté ni envoyé : les octets partent vers la fenêtre de
//     l'île, qui les décode avec Web Audio (un fichier illisible : le son
//     d'origine reste).
//
// Le dossier n'est créé que sur « Ouvrir le dossier des sons ».

use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};

use crate::services::log;

/// Les sons qu'un fichier peut remplacer (les noms de src/island/sounds.ts).
pub const NAMES: [&str; 13] = ["tap", "open", "close", "toggle", "drop", "boing", "plop", "jingle", "jingle-down", "glitch", "whoosh", "chomp", "pop"];

/// Les extensions acceptées, dans l'ordre de préférence.
pub const EXTENSIONS: [&str; 4] = ["wav", "mp3", "ogg", "m4a"];

/// 2 Mo au plus par fichier.
pub const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// %APPDATA%\Ondine\sounds.
pub fn dir() -> PathBuf {
    crate::platform::config_dir().join("sounds")
}

/// Le type MIME d'une extension acceptée.
pub fn mime(ext: &str) -> &'static str {
    match ext {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        _ => "audio/mp4",
    }
}

/// Ce que le dossier donne : pour chaque son remplacé, le fichier choisi ;
/// et les fichiers ignorés, avec la raison (pour le journal).
#[derive(Debug, Default, PartialEq)]
pub struct Resolved {
    /// (nom du son, nom du fichier, extension)
    pub chosen: Vec<(String, String, String)>,
    /// (nom du fichier, raison)
    pub ignored: Vec<(String, String)>,
}

/// Choisit les fichiers d'après leurs noms et leurs tailles (sans rien lire).
pub fn resolve(entries: &[(String, u64)]) -> Resolved {
    let mut out = Resolved::default();
    let mut sorted: Vec<&(String, u64)> = entries.iter().collect();
    // L'ordre de préférence des extensions, puis le nom : un résultat stable.
    let rank = |f: &str| f.rsplit_once('.').and_then(|(_, e)| EXTENSIONS.iter().position(|x| x.eq_ignore_ascii_case(e))).unwrap_or(usize::MAX);
    sorted.sort_by(|a, b| rank(&a.0).cmp(&rank(&b.0)).then(a.0.cmp(&b.0)));
    for (file, size) in sorted {
        let Some((stem, ext)) = file.rsplit_once('.') else { continue };
        let (stem, ext) = (stem.to_ascii_lowercase(), ext.to_ascii_lowercase());
        if !EXTENSIONS.contains(&ext.as_str()) || !NAMES.contains(&stem.as_str()) {
            continue; // pas un son d'Ondine : ignoré sans bruit
        }
        if *size == 0 {
            out.ignored.push((file.clone(), "fichier vide".into()));
        } else if *size > MAX_BYTES {
            out.ignored.push((file.clone(), "plus de 2 Mo".into()));
        } else if out.chosen.iter().any(|(n, _, _)| *n == stem) {
            out.ignored.push((file.clone(), "un autre fichier remplace déjà ce son".into()));
        } else {
            out.chosen.push((stem, file.clone(), ext));
        }
    }
    out.chosen.sort();
    out
}

/// Le début du fichier ressemble-t-il à son format ?
pub fn looks_like(ext: &str, bytes: &[u8]) -> bool {
    match ext {
        "wav" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE",
        "mp3" => bytes.starts_with(b"ID3") || (bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0),
        "ogg" => bytes.starts_with(b"OggS"),
        "m4a" => bytes.len() >= 8 && &bytes[4..8] == b"ftyp",
        _ => false,
    }
}

/// Lit le dossier : les sons remplacés, prêts pour l'île (base64).
pub fn load_from(folder: &Path) -> Vec<Value> {
    let Ok(read) = std::fs::read_dir(folder) else { return Vec::new() };
    let entries: Vec<(String, u64)> = read
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e.metadata().ok()?.len())))
        .take(500)
        .collect();
    let resolved = resolve(&entries);
    for (file, why) in &resolved.ignored {
        log::warn(format!("sons : « {file} » ignoré ({why}), le son d'origine est gardé"));
    }
    let mut out = Vec::new();
    for (name, file, ext) in resolved.chosen {
        let bytes = match std::fs::read(folder.join(&file)) {
            Ok(b) if b.len() as u64 <= MAX_BYTES => b,
            Ok(_) => {
                log::warn(format!("sons : « {file} » ignoré (plus de 2 Mo), le son d'origine est gardé"));
                continue;
            }
            Err(e) => {
                log::warn(format!("sons : « {file} » illisible ({e}), le son d'origine est gardé"));
                continue;
            }
        };
        if !looks_like(&ext, &bytes) {
            log::warn(format!("sons : « {file} » ignoré (ce n'est pas un fichier .{ext} valide), le son d'origine est gardé"));
            continue;
        }
        out.push(json!({ "name": name, "file": file, "mime": mime(&ext), "data": base64::engine::general_purpose::STANDARD.encode(&bytes) }));
    }
    out
}

/// Les sons remplacés, le dossier et les noms possibles.
#[tauri::command]
pub fn sounds_custom() -> Value {
    let folder = dir();
    json!({ "folder": folder.display().to_string(), "names": NAMES, "extensions": EXTENSIONS, "sounds": load_from(&folder) })
}

/// « Ouvrir le dossier des sons » : le crée s'il manque, puis l'ouvre.
#[tauri::command]
pub fn sounds_open_folder() -> Result<(), String> {
    let folder = dir();
    std::fs::create_dir_all(&folder).map_err(|e| format!("dossier des sons : {e}"))?;
    crate::platform::reveal_folder(&folder);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str, size: u64) -> (String, u64) {
        (name.into(), size)
    }

    #[test]
    fn names_and_extensions() {
        let r = resolve(&[e("tap.wav", 10), e("Open.MP3", 10), e("readme.txt", 10), e("bonjour.wav", 10), e("jingle-down.ogg", 10), e("pop.m4a", 10), e("drop", 10)]);
        let names: Vec<&str> = r.chosen.iter().map(|c| c.0.as_str()).collect();
        assert_eq!(names, ["jingle-down", "open", "pop", "tap"]);
        assert_eq!(r.chosen.iter().find(|c| c.0 == "open").unwrap().2, "mp3");
        assert!(r.ignored.is_empty());
    }

    #[test]
    fn too_big_empty_and_doubles() {
        let r = resolve(&[e("tap.mp3", 10), e("tap.wav", 10), e("close.wav", MAX_BYTES + 1), e("drop.ogg", 0), e("boing.wav", MAX_BYTES)]);
        // .wav passe avant .mp3.
        assert_eq!(r.chosen, vec![("boing".into(), "boing.wav".into(), "wav".into()), ("tap".into(), "tap.wav".into(), "wav".into())]);
        let ignored: Vec<&str> = r.ignored.iter().map(|i| i.0.as_str()).collect();
        assert_eq!(ignored, ["close.wav", "tap.mp3", "drop.ogg"]);
    }

    #[test]
    fn file_headers() {
        assert!(looks_like("wav", b"RIFF\x24\0\0\0WAVEfmt "));
        assert!(!looks_like("wav", b"RIFF\x24\0\0\0AVI "));
        assert!(looks_like("mp3", b"ID3\x04") && looks_like("mp3", &[0xFF, 0xFB, 0x90]));
        assert!(!looks_like("mp3", b"MZ\x90\0"));
        assert!(looks_like("ogg", b"OggS\0") && !looks_like("ogg", b"RIFF"));
        assert!(looks_like("m4a", b"\0\0\0\x20ftypM4A ") && !looks_like("m4a", b"\0\0"));
    }

    #[test]
    fn a_bad_file_keeps_the_original() {
        let folder = std::env::temp_dir().join(format!("ondine-sons-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("tap.wav"), b"RIFF\x24\0\0\0WAVEfmt ").unwrap();
        std::fs::write(folder.join("drop.wav"), b"pas un son").unwrap();
        let out = load_from(&folder);
        let _ = std::fs::remove_dir_all(&folder);
        assert_eq!(out.len(), 1);
        assert_eq!((out[0]["name"].as_str(), out[0]["mime"].as_str()), (Some("tap"), Some("audio/wav")));
        assert!(load_from(Path::new("/dossier/qui/n/existe/pas")).is_empty());
    }
}
