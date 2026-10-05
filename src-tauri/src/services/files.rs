// Opérations sur les fichiers, partagées par les modules. Règles de l'île :
//   - JAMAIS de suppression définitive : « supprimer » = envoyer à la Corbeille ;
//   - JAMAIS d'écrasement : si le nom existe déjà à l'arrivée, on prend
//     « nom (2).ext », « nom (3).ext »… ;
//   - les chemins arrivent ici déjà validés (ModuleContext::check_path) ;
//   - chaque fonction renvoie de quoi annuler (voir le module Étagère).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Un nom libre dans `dir` pour `name` : `name`, sinon `nom (2).ext`, `nom (3).ext`…
pub fn unique_dest(dir: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let as_path = Path::new(name);
    let stem = as_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = as_path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for i in 2.. {
        let candidate = dir.join(format!("{stem} ({i}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

/// Copie un fichier ou un dossier (avec tout son contenu) vers `dest`, qui ne doit
/// pas exister. Les liens symboliques sont ignorés : on ne suit pas un lien vers
/// un endroit que l'utilisateur n'a pas choisi.
pub fn copy_recursive(src: &Path, dest: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        fs::create_dir(dest)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dest.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dest).map(|_| ())
    }
}

/// Copie `src` dans le dossier `dir`. Renvoie le chemin créé.
pub fn copy_into(src: &Path, dir: &Path) -> Result<PathBuf, String> {
    let name = src.file_name().ok_or("chemin sans nom")?;
    if dir.starts_with(src) {
        return Err("impossible de copier un dossier dans lui-même".into());
    }
    let dest = unique_dest(dir, name);
    copy_recursive(src, &dest).map_err(|e| format!("copie de {} impossible : {e}", name.to_string_lossy()))?;
    Ok(dest)
}

/// Déplace `src` dans le dossier `dir`. Renvoie le nouveau chemin.
///
/// Sur le même disque, c'est un simple renommage. D'un disque à l'autre, Windows
/// refuse le renommage : on copie, puis on envoie l'original à la Corbeille (et
/// non à la poubelle définitive).
pub fn move_into(src: &Path, dir: &Path) -> Result<PathBuf, String> {
    let name = src.file_name().ok_or("chemin sans nom")?;
    if dir.starts_with(src) {
        return Err("impossible de déplacer un dossier dans lui-même".into());
    }
    let dest = unique_dest(dir, name);
    move_to(src, &dest)?;
    Ok(dest)
}

/// Déplace `src` exactement vers `dest` (qui ne doit pas exister).
pub fn move_to(src: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        return Err(format!("{} existe déjà", dest.display()));
    }
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            // Autre disque (ou autre raison) : copie puis Corbeille.
            copy_recursive(src, dest).map_err(|e| format!("déplacement impossible : {e}"))?;
            trash::delete(src).map_err(|e| format!("copié, mais l'original n'a pas pu aller à la Corbeille : {e}"))
        }
    }
}

/// Envoie des fichiers à la Corbeille.
pub fn to_trash(paths: &[PathBuf]) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| format!("Corbeille : {e}"))
}

/// Ressort de la Corbeille l'élément qui se trouvait à `original` (le plus récent
/// s'il y en a plusieurs). Échoue si un fichier du même nom existe déjà là-bas.
#[cfg(any(windows, target_os = "linux"))]
pub fn restore_from_trash(original: &Path) -> Result<(), String> {
    let items = trash::os_limited::list().map_err(|e| format!("Corbeille illisible : {e}"))?;
    let item = items
        .into_iter()
        .filter(|i| same_path(&i.original_path(), original))
        .max_by_key(|i| i.time_deleted)
        .ok_or_else(|| format!("{} n'est plus dans la Corbeille", original.display()))?;
    trash::os_limited::restore_all([item]).map_err(|e| format!("restauration impossible : {e}"))
}

/// Deux chemins désignent-ils le même endroit ? Sous Windows, la casse ne compte pas.
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn restore_from_trash(_original: &Path) -> Result<(), String> {
    Err("restauration depuis la Corbeille non prise en charge ici".into())
}

/// Crée une archive .zip contenant `paths`, dans le dossier du premier élément.
/// Renvoie le chemin de l'archive.
pub fn zip(paths: &[PathBuf]) -> Result<PathBuf, String> {
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    let first = paths.first().ok_or("rien à compresser")?;
    let dir = first.parent().ok_or("dossier introuvable")?;
    let base = if paths.len() == 1 {
        first.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Archive".into())
    } else {
        "Archive".to_string()
    };
    let out = unique_dest(dir, std::ffi::OsStr::new(&format!("{base}.zip")));
    let file = fs::File::create(&out).map_err(|e| format!("archive impossible à créer : {e}"))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // Ajoute `path` dans l'archive sous le nom `name` (dossiers compris).
    fn add(
        writer: &mut zip::ZipWriter<fs::File>,
        path: &Path,
        name: &str,
        options: SimpleFileOptions,
        out: &Path,
    ) -> Result<(), String> {
        let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() || path == out {
            return Ok(());
        }
        if meta.is_dir() {
            writer.add_directory(format!("{name}/"), options).map_err(|e| e.to_string())?;
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let child = format!("{name}/{}", entry.file_name().to_string_lossy());
                add(writer, &entry.path(), &child, options, out)?;
            }
        } else {
            writer.start_file(name, options).map_err(|e| e.to_string())?;
            let mut src = fs::File::open(path).map_err(|e| e.to_string())?;
            io::copy(&mut src, writer).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    let result = (|| {
        for p in paths {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).ok_or("chemin sans nom")?;
            add(&mut writer, p, &name, options, &out)?;
        }
        let mut f = writer.finish().map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        // Archive à moitié écrite : à la Corbeille, pas supprimée.
        let _ = trash::delete(&out);
        return Err(format!("compression impossible : {e}"));
    }
    Ok(out)
}

/// Ouvre l'Explorateur sur le dossier de `path`, avec l'élément sélectionné.
/// On lance explorer.exe avec le chemin en argument : rien venant du contenu du
/// fichier n'est exécuté.
pub fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer attend exactement `/select,"C:\chemin"` : on écrit l'argument
        // tel quel (raw_arg) car l'échappement automatique de Rust le gênerait.
        // Un chemin Windows ne peut pas contenir de guillemet : pas d'injection possible.
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Explorateur : {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("disponible seulement sous Windows".into())
    }
}

/// Ouvre un dossier (ou la racine d'un lecteur) dans l'Explorateur.
pub fn open_folder(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Même remarque que `reveal` : un chemin Windows ne contient pas de guillemet.
        // La racine d'un lecteur (« E:\ ») s'écrit sans guillemets : « \" »
        // serait lu comme un guillemet échappé.
        let text = path.display().to_string();
        let arg = if text.ends_with('\\') { text } else { format!("\"{text}\"") };
        std::process::Command::new("explorer.exe")
            .raw_arg(arg)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Explorateur : {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("disponible seulement sous Windows".into())
    }
}

/// Met du texte dans le presse-papiers.
pub fn copy_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("presse-papiers indisponible : {e}"))?;
    clipboard.set_text(text.to_string()).map_err(|e| format!("presse-papiers : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("island-files-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn never_overwrites() {
        let dir = temp("unique");
        fs::write(dir.join("a.txt"), "1").unwrap();
        fs::write(dir.join("a (2).txt"), "2").unwrap();
        assert_eq!(unique_dest(&dir, "a.txt".as_ref()), dir.join("a (3).txt"));
        assert_eq!(unique_dest(&dir, "b.txt".as_ref()), dir.join("b.txt"));
    }

    #[test]
    fn copies_and_moves_folders() {
        let base = temp("copy");
        let src = base.join("src");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub").join("f.txt"), "x").unwrap();
        let dest_dir = base.join("dest");
        fs::create_dir(&dest_dir).unwrap();

        let copied = copy_into(&src, &dest_dir).unwrap();
        assert_eq!(fs::read_to_string(copied.join("sub").join("f.txt")).unwrap(), "x");
        // Une seconde copie ne remplace pas la première.
        assert_eq!(copy_into(&src, &dest_dir).unwrap(), dest_dir.join("src (2)"));

        let moved = move_into(&src, &dest_dir).unwrap();
        assert!(!src.exists());
        assert_eq!(moved, dest_dir.join("src (3)"));
        assert!(copy_into(&dest_dir, &dest_dir.join("src")).is_err());
    }

    #[test]
    fn zips_files_and_folders() {
        let base = temp("zip");
        fs::write(base.join("a.txt"), "hello").unwrap();
        fs::create_dir(base.join("d")).unwrap();
        fs::write(base.join("d").join("b.txt"), "world").unwrap();
        let out = zip(&[base.join("a.txt"), base.join("d")]).unwrap();
        assert_eq!(out, base.join("Archive.zip"));
        let archive = zip::ZipArchive::new(fs::File::open(&out).unwrap()).unwrap();
        let mut names: Vec<String> = archive.file_names().map(String::from).collect();
        names.sort();
        assert_eq!(names, vec!["a.txt", "d/", "d/b.txt"]);
    }
}
