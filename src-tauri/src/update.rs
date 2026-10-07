// Mises à jour automatiques (plugin officiel tauri-plugin-updater).
//
// Comment ça marche :
//   1. le workflow « release » publie, à côté de l'installateur, un fichier
//      latest.json (numéro de version, notes, lien et signature de l'installateur) ;
//   2. `update_check` lit ce fichier sur GitHub et compare avec notre version ;
//   3. `update_install` télécharge l'installateur, vérifie sa signature avec la
//      clé publique de tauri.conf.json (un fichier modifié est refusé), puis le
//      lance en mode « passif » : une petite barre de progression, aucune
//      question. Le plugin ferme Ondine, l'installateur la relance.
//
// Seul le Rust parle au plugin : le front n'a aucune permission « updater ».

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::services::log;

/// Une installation à la fois (deux clics sur « Installer »).
static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// La nouvelle version (ex. "1.0.1").
    pub version: String,
    /// Celle qui tourne.
    pub current: String,
    /// Les notes de version (texte de la version GitHub), si elles existent.
    pub notes: Option<String>,
}

/// Y a-t-il une version plus récente ? `None` = on est à jour.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| format!("mise à jour : {e}"))?
        .check()
        .await
        .map_err(|e| {
            log::warn(format!("recherche de mise à jour impossible : {e}"));
            format!("impossible de joindre GitHub : {e}")
        })?;
    Ok(update.map(|u| {
        log::info(format!("mise à jour disponible : {} → {}", u.current_version, u.version));
        UpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone() }
    }))
}

/// Télécharge et lance la nouvelle version. Sur Windows, ne revient pas en cas
/// de succès : le plugin ferme Ondine pour laisser l'installateur travailler.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("une mise à jour est déjà en cours".into());
    }
    let result = install(&app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn install(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("mise à jour : {e}"))?;
    let Some(update) = updater.check().await.map_err(|e| format!("impossible de joindre GitHub : {e}"))? else {
        return Err("Ondine est déjà à jour".into());
    };
    log::info(format!("installation de la version {}", update.version));
    update
        .download_and_install(|_, _| {}, || log::info("mise à jour téléchargée, lancement de l'installateur"))
        .await
        .map_err(|e| {
            log::error(format!("mise à jour échouée : {e}"));
            format!("la mise à jour a échoué : {e}")
        })?;
    // Hors de Windows, l'installateur ne relance pas l'appli : on le fait nous-mêmes.
    app.restart();
}

// ── « Quoi de neuf » : la page de la version sur GitHub ──────────────────────

/// La page d'une version publiée sur GitHub (notes complètes, installateur).
const RELEASES_URL: &str = "https://github.com/Naod6473/Ondine/releases/tag/v";

/// L'adresse de la page de `version`, ou None si ce n'est pas un numéro de
/// version (« 1.0.1 », « 1.1.0-beta.2 ») : rien d'autre ne part au navigateur.
fn release_url(version: &str) -> Option<String> {
    let ok = !version.is_empty()
        && version.len() <= 40
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    ok.then(|| format!("{RELEASES_URL}{version}"))
}

/// Bouton « Tout voir » de la notification « Quoi de neuf » : ouvre dans le
/// navigateur la page GitHub de la version qui tourne. Le front ne donne
/// aucune adresse : c'est toujours celle de notre propre version.
#[tauri::command]
pub fn release_page_open() -> Result<(), String> {
    let url = release_url(env!("CARGO_PKG_VERSION")).ok_or("numéro de version inattendu")?;
    log::info("nouveautés : page de la version ouverte dans le navigateur");
    crate::platform::shell_open(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_page_of_a_version() {
        assert_eq!(release_url("1.0.1").as_deref(), Some("https://github.com/Naod6473/Ondine/releases/tag/v1.0.1"));
        assert_eq!(release_url("1.1.0-beta.2").as_deref(), Some("https://github.com/Naod6473/Ondine/releases/tag/v1.1.0-beta.2"));
        assert!(release_url(env!("CARGO_PKG_VERSION")).is_some());
        for bad in ["", "dev", "1.0.1/../../x", "1.0 1", "1.0.1?a=b"] {
            assert_eq!(release_url(bad), None, "{bad}");
        }
    }
}
