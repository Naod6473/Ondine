// L'icône de la zone de notification : Ouvrir l'île, Profil (s'il y en a),
// Réglages, Journal, Quitter.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Wry};

use crate::island::WINDOW_LABEL;
use crate::services::log;
use crate::services::profiles::Profiles;
use crate::sync::LockExt;

const TRAY_ID: &str = "island";
/// Préfixe des entrées du sous-menu « Profil » : "profile:<id>" ("profile:" = aucun).
const PROFILE_PREFIX: &str = "profile:";

/// Le menu en anglais (réglage « Langue », lu au démarrage).
static ENGLISH: AtomicBool = AtomicBool::new(false);
/// Les profils tels que le menu les montre (on ne reconstruit que s'ils changent).
static SHOWN: Mutex<Option<(Vec<(String, String)>, String)>> = Mutex::new(None);

fn tr(fr: &'static str, english: &'static str) -> &'static str {
    if ENGLISH.load(Ordering::Relaxed) {
        english
    } else {
        fr
    }
}

/// Le menu complet. `profiles` : (id, nom) de chaque profil, et l'id de l'actif.
fn menu(app: &AppHandle, profiles: &[(String, String)], active: &str) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, "open", tr("Ouvrir l'île", "Open the island"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", tr("Réglages…", "Settings…"), true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", tr("Ouvrir le dossier du journal", "Open the log folder"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", tr("Quitter", "Quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    if profiles.is_empty() {
        return Menu::with_items(app, &[&open, &sep1, &settings, &logs, &sep2, &quit]);
    }
    // Sous-menu « Profil » : une case cochée devant le profil actif.
    let mut items = vec![CheckMenuItem::with_id(app, PROFILE_PREFIX, tr("Aucun", "None"), true, active.is_empty(), None::<&str>)?];
    for (id, name) in profiles {
        // « & » souligne la lettre suivante dans un menu Windows : on le double.
        let label = name.replace('&', "&&");
        items.push(CheckMenuItem::with_id(app, format!("{PROFILE_PREFIX}{id}"), label, true, id == active, None::<&str>)?);
    }
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let title = match profiles.iter().find(|(id, _)| id == active) {
        Some((_, name)) => format!("{} : {}", tr("Profil", "Profile"), name.replace('&', "&&")),
        None => tr("Profil", "Profile").to_string(),
    };
    let sub = Submenu::with_items(app, title, true, &refs)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&open, &sep1, &sub, &sep3, &settings, &logs, &sep2, &quit])
}

/// `en` : le menu en anglais (réglage « Langue », lu au démarrage).
pub fn build(app: &AppHandle, en: bool) -> tauri::Result<()> {
    ENGLISH.store(en, Ordering::Relaxed);
    let menu = menu(app, &[], "")?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Ondine")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            "logs" => crate::open_logs_folder(),
            // Un profil : on le change hors du gestionnaire du menu (qui sera remplacé).
            id if id.starts_with(PROFILE_PREFIX) => {
                let (app, id) = (app.clone(), id[PROFILE_PREFIX.len()..].to_string());
                std::thread::spawn(move || {
                    if let Err(e) = crate::services::profiles::activate(&app, &id) {
                        log::warn(format!("profil non changé : {e}"));
                    }
                });
            }
            // "open" : c'est le front qui fait passer l'île en `expanded`.
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// Met le menu et l'infobulle à jour quand les profils (ou l'actif) changent.
pub fn sync_profiles(app: &AppHandle, profiles: &Profiles) {
    let list: Vec<(String, String)> = profiles.list.iter().map(|p| (p.id.clone(), p.name.clone())).collect();
    let wanted = (list, profiles.active.clone());
    {
        let mut shown = SHOWN.locked();
        if shown.as_ref() == Some(&wanted) {
            return;
        }
        *shown = Some(wanted.clone());
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let (list, active) = wanted;
    match menu(app, &list, &active) {
        Ok(m) => {
            let _ = tray.set_menu(Some(m));
        }
        Err(e) => log::warn(format!("menu de l'icône non mis à jour : {e}")),
    }
    let tip = match list.iter().find(|(id, _)| *id == active) {
        Some((_, name)) => format!("Ondine · {name}"),
        None => "Ondine".to_string(),
    };
    let _ = tray.set_tooltip(Some(tip));
}
