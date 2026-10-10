// Action « Décompresser une archive .zip » des règles.
//
// Prudence, parce que l'archive vient souvent d'Internet :
//   - les chemins qui sortiraient du dossier (« ../../Windows/… », chemins
//     absolus) sont ignorés : `enclosed_name` de la crate zip les refuse ;
//   - tout va dans un NOUVEAU sous-dossier au nom de l'archive (« photos (2) »
//     s'il existe déjà) : aucun fichier existant n'est jamais écrasé ;
//   - au plus 10 000 éléments et 4 Go une fois décompressée (une « bombe »
//     de quelques Ko qui se déplie en To est arrêtée en route) ;
//   - rien n'est lancé ni ouvert : on écrit des fichiers, c'est tout ;
//   - en cas d'erreur en route, le dossier à moitié rempli part à la Corbeille.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use crate::services::files;

const MAX_ENTRIES: usize = 10_000;
const MAX_TOTAL: u64 = 4 * 1024 * 1024 * 1024;

/// Décompresse `archive` dans un nouveau sous-dossier de `dest_parent`.
/// Renvoie ce sous-dossier.
pub fn extract(archive: &Path, dest_parent: &Path) -> Result<PathBuf, String> {
    let is_zip = archive.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if !is_zip {
        return Err("ce n'est pas une archive .zip".into());
    }
    let file = File::open(archive).map_err(|e| format!("archive illisible : {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("archive illisible : {e}"))?;
    if zip.len() > MAX_ENTRIES {
        return Err(format!("archive trop grande (plus de {MAX_ENTRIES} éléments)"));
    }
    let stem = archive.file_stem().map(|s| s.to_os_string()).unwrap_or_else(|| "archive".into());
    let dest = files::unique_dest(dest_parent, &stem);
    fs::create_dir_all(&dest).map_err(|e| format!("impossible de créer {} : {e}", dest.display()))?;

    match fill(&mut zip, &dest) {
        Ok(()) => Ok(dest),
        Err(e) => {
            // Le dossier vient d'être créé par nous : à la Corbeille, jamais effacé.
            let _ = files::to_trash(std::slice::from_ref(&dest));
            Err(e)
        }
    }
}

fn fill(zip: &mut zip::ZipArchive<File>, dest: &Path) -> Result<(), String> {
    let mut written: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("archive abîmée : {e}"))?;
        // Un chemin qui sortirait du dossier : ignoré.
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = dest.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // create_new : jamais d'écrasement (deux entrées au même nom : la seconde est refusée).
        let mut w = File::options().write(true).create_new(true).open(&out).map_err(|e| format!("{} : {e}", out.display()))?;
        // La taille annoncée peut mentir : on compte ce qui est vraiment écrit.
        let left = MAX_TOTAL.saturating_sub(written);
        let n = io::copy(&mut (&mut entry).take(left + 1), &mut w).map_err(|e| format!("décompression impossible : {e}"))?;
        written += n;
        if written > MAX_TOTAL {
            return Err("archive trop grande une fois décompressée (plus de 4 Go)".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut w = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn extracts_into_a_new_folder_and_skips_escapes() {
        let dir = std::env::temp_dir().join(format!("ondine-unzip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("photos.zip");
        make_zip(&archive, &[("a.txt", b"bonjour"), ("sous/b.txt", b"x"), ("../evade.txt", b"non")]);

        let out = extract(&archive, &dir).unwrap();
        assert_eq!(out, dir.join("photos"));
        assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "bonjour");
        assert!(out.join("sous/b.txt").exists());
        assert!(!dir.join("evade.txt").exists());

        // Une seconde fois : un nouveau dossier, rien d'écrasé.
        let again = extract(&archive, &dir).unwrap();
        assert_eq!(again, dir.join("photos (2)"));

        assert!(extract(&dir.join("pas-zip.txt"), &dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
