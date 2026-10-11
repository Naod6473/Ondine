// Confidentialité et sécurité des chemins.
//
// Règle : tout chemin qui vient de l'extérieur (glisser-déposer, front, contenu
// d'un fichier…) passe par `check_path` avant qu'un module ne le lise ou ne le
// modifie. On refuse :
//   - les chemins relatifs (on ne devine jamais depuis quel dossier ils partent) ;
//   - les chemins qui n'existent pas ;
//   - les chemins situés dans un dossier exclu par l'utilisateur.
// Le chemin est « canonisé » (liens et `..` résolus) avant la comparaison, pour
// qu'un `C:\Docs\..\Secret` ne contourne pas l'exclusion de `C:\Secret`.
//
// Aucune télémétrie : l'île n'envoie rien nulle part de sa propre initiative.
// Un module qui envoie du contenu à l'API Claude doit le déclarer (permission
// "claude-api") et montrer ce qui part avant l'envoi (règle reprise dans
// docs/ARCHITECTURE.md ; le composant d'aperçu arrivera avec la phase 8).

use std::path::{Path, PathBuf};

use crate::services::settings::Settings;

pub fn check_path(settings: &Settings, raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("chemin refusé : il doit être absolu".into());
    }
    let real = simplify(std::fs::canonicalize(path).map_err(|_| "chemin introuvable".to_string())?);
    if is_excluded(settings, &real) {
        return Err("chemin refusé : il se trouve dans un dossier exclu".into());
    }
    Ok(real)
}

/// Valide tout le périmètre AVANT une opération récursive : sélectionner un
/// parent n'autorise jamais à lire, déplacer ou jeter ses descendants exclus.
/// Avec des exclusions actives, les liens internes sont refusés : on ne suit
/// pas un alias vers un autre périmètre. Une erreur de lecture refuse tout.
pub fn check_tree(settings: &Settings, raw: &str) -> Result<PathBuf, String> {
    let root = check_path(settings, raw)?;
    if settings.privacy.excluded_folders.is_empty() { return Ok(root); }
    // Le cas courant se décide sans parcourir tout un gros dossier.
    if settings.privacy.excluded_folders.iter().filter_map(|p| std::fs::canonicalize(p).ok()).any(|p| contains_path(&root, &simplify(p))) {
        return Err("opération refusée : le dossier contient un dossier exclu".into());
    }
    let mut pending = vec![root.clone()];
    while let Some(path) = pending.pop() {
        let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("vérification impossible : {e}"))?;
        if meta.file_type().is_symlink() {
            return Err("opération refusée : le dossier contient un lien symbolique".into());
        }
        check_path(settings, &path.to_string_lossy())?;
        if meta.is_dir() {
            for child in std::fs::read_dir(&path).map_err(|e| format!("dossier illisible : {e}"))? {
                pending.push(child.map_err(|e| e.to_string())?.path());
            }
        }
    }
    Ok(root)
}

/// Vrai si `real` (déjà canonisé) est dans un des dossiers exclus.
pub fn is_excluded(settings: &Settings, real: &Path) -> bool {
    settings.privacy.excluded_folders.iter().any(|folder| {
        // Un dossier exclu qui n'existe plus ne peut rien contenir.
        match std::fs::canonicalize(folder) {
            Ok(excluded) => contains_path(&simplify(excluded), real),
            Err(_) => false,
        }
    })
}

/// Comparaison par composants : « Secret2 » n'est pas dans « Secret ».
/// Sous Windows, on emploie sa comparaison Unicode sans tenir compte de la casse.
pub fn contains_path(folder: &Path, path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Globalization::{CompareStringOrdinal, CSTR_EQUAL};
        let mut parts = path.components();
        for expected in folder.components() {
            let Some(actual) = parts.next() else { return false };
            let a: Vec<u16> = expected.as_os_str().encode_wide().collect();
            let b: Vec<u16> = actual.as_os_str().encode_wide().collect();
            // Les tranches restent valides pendant l'appel et leurs longueurs
            // proviennent des composants d'un chemin Windows canonique.
            if unsafe { CompareStringOrdinal(&a, &b, true) } != CSTR_EQUAL { return false; }
        }
        true
    }
    #[cfg(not(windows))]
    path.starts_with(folder)
}

/// Sous Windows, `canonicalize` renvoie des chemins « étendus » (`\\?\C:\…`) que
/// l'Explorateur et l'utilisateur ne connaissent pas. On les ramène à la forme
/// habituelle (`C:\…`, ou `\\serveur\partage\…` pour un dossier réseau).
pub fn simplify(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        // Seulement « lettre de lecteur + : », pour ne rien casser d'autre.
        let b = rest.as_bytes();
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            return PathBuf::from(rest);
        }
    }
    path
}

/// Vérifie qu'un dossier ajouté à la liste d'exclusion existe vraiment.
pub fn check_folder(raw: &str) -> Result<String, String> {
    let path = Path::new(raw.trim());
    if !path.is_absolute() || !path.is_dir() {
        return Err("indiquez le chemin complet d'un dossier existant".into());
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excluded_prefix_respects_components_and_windows_case() {
        assert!(!contains_path(Path::new("/secret"), Path::new("/secret2/file")));
        #[cfg(windows)]
        assert!(contains_path(Path::new(r"C:\Données\Secret"), Path::new(r"c:\DONNÉES\secret\file.txt")));
    }

    #[test]
    fn extended_paths_are_simplified() {
        assert_eq!(simplify(PathBuf::from(r"\\?\C:\Users\a")), PathBuf::from(r"C:\Users\a"));
        assert_eq!(simplify(PathBuf::from(r"\\?\UNC\srv\share")), PathBuf::from(r"\\srv\share"));
        assert_eq!(simplify(PathBuf::from("/tmp/x")), PathBuf::from("/tmp/x"));
    }

    #[test]
    fn relative_paths_are_refused() {
        assert!(check_path(&Settings::default(), "docs/a.txt").is_err());
    }

    #[test]
    fn selecting_a_parent_does_not_bypass_a_nested_exclusion() {
        let base = std::env::temp_dir().join(format!("ondine-privacy-parent-{}", std::process::id()));
        let secret = base.join("public").join("secret");
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(secret.join("private.txt"), "private").unwrap();
        let mut settings = Settings::default();
        settings.privacy.excluded_folders.push(secret.to_string_lossy().to_string());
        assert!(check_path(&settings, &base.to_string_lossy()).is_ok());
        assert!(check_tree(&settings, &base.to_string_lossy()).is_err());
        assert!(!base.with_extension("zip").exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn excluded_folder_blocks_its_children() {
        let base = std::env::temp_dir().join("island-privacy-test");
        let secret = base.join("secret");
        std::fs::create_dir_all(&secret).unwrap();
        let file = secret.join("a.txt");
        std::fs::write(&file, "x").unwrap();

        let mut s = Settings::default();
        assert!(check_path(&s, file.to_str().unwrap()).is_ok());
        s.privacy.excluded_folders.push(secret.to_string_lossy().to_string());
        // Même en passant par un détour avec `..`.
        let detour = base.join("secret").join("..").join("secret").join("a.txt");
        assert!(check_path(&s, detour.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
