// Island : le câblage de l'appli et les commandes que le front peut appeler.
//
// Plan du dossier src-tauri/src :
//   lib.rs        ← ici : démarrage + liste des commandes Tauri
//   island/       ← la fenêtre de l'île (placement, DPI, clics traversants, souris)
//   tray.rs       ← l'icône de la zone de notification
//   services/     ← réglages, journal, identifiants, bus, annulation, confidentialité
//   modules/      ← le registre des modules Rust et les modules eux-mêmes
//   platform/     ← tout ce qui touche à Win32

mod island;
mod modules;
mod platform;
mod services;
mod tray;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window};

use island::{PollGate, ScreenInfo};
use modules::{ModuleStatus, Registry};
use services::bus::{self, BusMessage};
use services::settings::{self, Settings};
use services::undo::UndoService;
use services::{credentials, log, privacy};

/// L'état partagé entre les commandes (Tauri le garde pour nous : `app.manage`).
pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
    rust_modules: Vec<ModuleStatus>,
}

// ── Démarrage et réglages ────────────────────────────────────────────────────

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>, registry: State<Registry>) -> BootInfo {
    let settings = shared.settings.lock().unwrap().clone();
    BootInfo {
        screen: island::screen_info(&app, &settings.general.screen),
        settings,
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_modules: registry.statuses(),
    }
}

/// Applique et enregistre de nouveaux réglages, puis prévient toutes les fenêtres.
fn apply_settings(app: &AppHandle, shared: &Shared, new: Settings) -> Result<(), String> {
    let screen_changed = {
        let mut current = shared.settings.lock().unwrap();
        let changed = current.general.screen != new.general.screen;
        *current = new.clone();
        changed
    };
    settings::save(&new)?;
    log::set_min_level(log::Level::parse(&new.general.log_level));
    if screen_changed {
        island::apply_geometry(app, &new.general.screen, shared.gate.collapsed.load(Ordering::Relaxed));
    }
    let _ = app.emit("settings-changed", new);
    Ok(())
}

#[tauri::command]
fn settings_save(app: AppHandle, shared: State<Shared>, settings: Settings) -> Result<(), String> {
    apply_settings(&app, &shared, settings)
}

/// Écrit une copie des réglages dans %APPDATA%\Island\exports et ouvre ce dossier.
#[tauri::command]
fn settings_export(shared: State<Shared>) -> Result<String, String> {
    let current = shared.settings.lock().unwrap().clone();
    let file = settings::export(&current)?;
    if let Some(dir) = file.parent() {
        platform::reveal_folder(dir);
    }
    log::info("réglages exportés");
    Ok(file.to_string_lossy().to_string())
}

/// Reçoit le TEXTE d'un fichier de réglages (lu par la fenêtre de réglages).
#[tauri::command]
fn settings_import(app: AppHandle, shared: State<Shared>, text: String) -> Result<(), String> {
    if text.len() > 1_000_000 {
        return Err("fichier trop gros pour être un fichier de réglages".into());
    }
    let imported = settings::parse(&text)?;
    apply_settings(&app, &shared, imported)?;
    log::info("réglages importés");
    Ok(())
}

/// Vérifie un dossier à exclure avant de l'ajouter à la liste.
#[tauri::command]
fn privacy_check_folder(path: String) -> Result<String, String> {
    privacy::check_folder(&path)
}

// ── Fenêtre de l'île ─────────────────────────────────────────────────────────

/// Île cachée → la fenêtre devient la bande de réveil et la lecture de la souris
/// s'endort. Sinon → panneau et lecture à 60 Hz.
#[tauri::command]
fn island_set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let pref = shared.settings.lock().unwrap().general.screen.clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
    island::refresh_click_through(&app, &shared.gate);
    shared.gate.set_active(!collapsed);
}

/// Le front envoie la forme actuelle de l'île ; le Rust en déduit les clics traversants.
#[tauri::command]
fn island_set_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
}

/// Donne (ou rend) le focus clavier : seulement quand c'est nécessaire (île
/// ouverte par un clic, pour qu'Échap fonctionne ; un champ texte).
#[tauri::command]
fn island_set_focus(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    platform::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn island_reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.lock().unwrap().general.screen.clone();
    island::apply_geometry(&app, &pref, shared.gate.collapsed.load(Ordering::Relaxed));
}

// ── Journal ──────────────────────────────────────────────────────────────────

/// Le front écrit dans le même journal que le Rust. `source` : "ui" ou un id de module.
#[tauri::command]
fn log_write(level: String, source: String, message: String) {
    let source: String = source.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(32).collect();
    let message: String = message.chars().take(2000).collect();
    log::write(log::Level::parse(&level), &format!("ui:{source}"), &message);
}

pub fn open_logs_folder() {
    let dir = log::dir();
    let _ = std::fs::create_dir_all(&dir);
    platform::reveal_folder(&dir);
}

#[tauri::command]
fn logs_open_folder() {
    open_logs_folder();
}

// ── Identifiants ─────────────────────────────────────────────────────────────
// Volontairement : pas de commande qui RENVOIE une clé.

#[tauri::command]
fn credential_exists(key: String) -> bool {
    credentials::exists(&key)
}

#[tauri::command]
fn credential_set(key: String, value: String) -> Result<(), String> {
    let result = credentials::set(&key, &value);
    match &result {
        Ok(()) => log::info(format!("identifiant « {key} » enregistré")),
        Err(e) => log::warn(format!("identifiant « {key} » non enregistré : {e}")),
    }
    result
}

#[tauri::command]
fn credential_delete(key: String) -> Result<(), String> {
    log::info(format!("identifiant « {key} » supprimé"));
    credentials::delete(&key)
}

// ── Bus, modules, annulation ─────────────────────────────────────────────────

/// Une fenêtre publie sur le bus. L'origine est l'étiquette de la fenêtre qui
/// appelle (fournie par Tauri, donc impossible à falsifier depuis la page).
#[tauri::command]
fn bus_publish(app: AppHandle, window: Window, topic: String, payload: Value, source: String) {
    let msg = BusMessage { topic, payload, source, origin: window.label().to_string() };
    bus::deliver(&app, msg);
}

/// LA porte d'entrée vers le code Rust des modules (voir modules/mod.rs).
/// `async` : Tauri l'exécute hors du thread principal, un module lent ne fige pas l'île.
#[tauri::command]
async fn module_invoke(app: AppHandle, module: String, command: String, args: Value) -> Result<Value, String> {
    modules::invoke(&app, &module, &command, args)
}

#[tauri::command]
fn undo_run(app: AppHandle, undo: State<UndoService>, id: u64) -> Result<String, String> {
    undo.run(&app, id)
}

// ── Fenêtre de réglages ──────────────────────────────────────────────────────

/// WebView2 n'autorise qu'un seul « environnement » par appli, fixé par la première
/// fenêtre créée : toutes les fenêtres doivent donc demander EXACTEMENT les mêmes
/// arguments que l'île (voir `additionalBrowserArgs` dans tauri.conf.json), sinon
/// la seconde reste blanche sans aucune erreur. (Constat de Coucou.)
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    // En développement, les pages sont servies par Vite.
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// La fenêtre de réglages est créée cachée au démarrage, puis seulement montrée
/// ou cachée : sous WebView2, une fenêtre créée plus tard peut rester blanche.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(BROWSER_ARGS)
        .title("Réglages — Island")
        .inner_size(760.0, 720.0)
        .min_inner_size(560.0, 480.0)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            // Fermer = cacher, sinon on ne pourrait plus la rouvrir.
            let hidden = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
        }
        Err(err) => log::error(format!("fenêtre de réglages impossible à créer : {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else { return };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn settings_open_window(app: AppHandle) {
    show_settings_window(&app);
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

// ── Démarrage ────────────────────────────────────────────────────────────────

pub fn run() {
    let loaded = settings::load();
    log::set_min_level(log::Level::parse(&loaded.general.log_level));

    // Une panique (n'importe où) est notée dans le journal. Celles des modules
    // sont en plus rattrapées par catch_unwind (modules/mod.rs).
    std::panic::set_hook(Box::new(|info| {
        log::error(format!("panique : {info}"));
    }));

    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        // Relancer l'appli alors qu'elle tourne déjà : on ouvre l'île existante.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
        }))
        .manage(Shared { settings: Mutex::new(loaded.clone()), gate: gate.clone() })
        .manage(Registry::new())
        .manage(UndoService::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            settings_save,
            settings_export,
            settings_import,
            privacy_check_folder,
            island_set_collapsed,
            island_set_rect,
            island_set_focus,
            island_reposition,
            log_write,
            logs_open_folder,
            credential_exists,
            credential_set,
            credential_delete,
            bus_publish,
            module_invoke,
            undo_run,
            settings_open_window,
            app_quit,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            // Avant l'île : voir create_settings_window.
            create_settings_window(&handle);

            if let Some(win) = island::window(&handle) {
                platform::make_non_activating(&win);
                // On démarre en bande de réveil : le front décidera quoi montrer.
                island::apply_geometry(&handle, &loaded.general.screen, true);
                let _ = win.show();
            }
            gate.collapsed.store(true, Ordering::Relaxed);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            log::info(format!("--- Island {} démarrée ---", env!("CARGO_PKG_VERSION")));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Island");
}
