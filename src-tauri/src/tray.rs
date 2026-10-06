// L'icône de la zone de notification : Ouvrir l'île, Réglages, Journal, Quitter.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

/// `en` : le menu en anglais (réglage « Langue », lu au démarrage).
pub fn build(app: &AppHandle, en: bool) -> tauri::Result<()> {
    let tr = |fr: &'static str, english: &'static str| if en { english } else { fr };
    let open = MenuItem::with_id(app, "open", tr("Ouvrir l'île", "Open the island"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", tr("Réglages…", "Settings…"), true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", tr("Ouvrir le dossier du journal", "Open the log folder"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", tr("Quitter", "Quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep1, &settings, &logs, &sep2, &quit])?;

    let mut builder = TrayIconBuilder::with_id("island")
        .tooltip("Ondine")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            "logs" => crate::open_logs_folder(),
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
