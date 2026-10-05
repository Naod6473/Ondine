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
// ARCHITECTURE.md ; le composant d'aperçu arrivera avec la phase 8).

use std::path::{Path, PathBuf};

use crate::services::settings::Settings;

#[allow(dead_code)] // utilisée par ModuleContext::check_path
pub fn check_path(settings: &Settings, raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("chemin refusé : il doit être absolu".into());
    }
    let real = std::fs::canonicalize(path).map_err(|_| "chemin introuvable".to_string())?;
    if is_excluded(settings, &real) {
        return Err("chemin refusé : il se trouve dans un dossier exclu".into());
    }
    Ok(real)
}

/// Vrai si `real` (déjà canonisé) est dans un des dossiers exclus.
#[allow(dead_code)]
pub fn is_excluded(settings: &Settings, real: &Path) -> bool {
    settings.privacy.excluded_folders.iter().any(|folder| {
        // Un dossier exclu qui n'existe plus ne peut rien contenir.
        match std::fs::canonicalize(folder) {
            Ok(excluded) => real.starts_with(&excluded),
            Err(_) => false,
        }
    })
}

/// Vérifie qu'un dossier ajouté à la liste d'exclusion existe vraiment.
pub fn check_folder(raw: &str) -> Result<String, String> {
    let path = Path::new(raw.trim());
    if !path.is_absolute() || !path.is_dir() {
        return Err("indique le chemin complet d'un dossier existant".into());
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_are_refused() {
        assert!(check_path(&Settings::default(), "docs/a.txt").is_err());
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
