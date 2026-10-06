// Ondine : le câblage de l'appli et les commandes que le front peut appeler.
//
// Plan du dossier src-tauri/src :
//   lib.rs        ← ici : démarrage + liste des commandes Tauri
//   island/       ← la fenêtre de l'île (placement, DPI, clics traversants, souris)
//   tray.rs       ← l'icône de la zone de notification
//   services/     ← réglages, journal, identifiants, bus, annulation, confidentialité
//   modules/      ← le registre des modules Rust et les modules eux-mêmes
//   platform/     ← tout ce qui touche à Win32

mod cli;
mod diagnostics;
mod island;
mod modules;
mod platform;
mod services;
mod sync;
mod tray;
mod update;

use crate::sync::LockExt;
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
    /// L'appli tourne en administrateur : le glisser-déposer depuis l'Explorateur est bloqué.
    elevated: bool,
    /// La fenêtre de réglages a le fond Mica de Windows 11 (sinon : fond peint par la page).
    mica: bool,
}

// ── Démarrage et réglages ────────────────────────────────────────────────────

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>, registry: State<Registry>) -> BootInfo {
    let settings = shared.settings.locked().clone();
    BootInfo {
        screen: island::screen_info(&app, &settings.general.screen),
        settings,
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_modules: registry.statuses(),
        elevated: platform::is_elevated(),
        mica: platform::supports_mica(),
    }
}

/// Applique et enregistre de nouveaux réglages, puis prévient toutes les fenêtres.
/// Lancement avec Windows (réglage `general.autostart`). Seulement depuis la
/// version installée : `tauri dev` ne doit pas inscrire son exe de travail.
fn apply_autostart(on: bool) {
    if cfg!(debug_assertions) {
        return;
    }
    if let Err(e) = platform::set_autostart(on) {
        log::warn(format!("lancement avec Windows non modifié : {e}"));
    }
}

fn apply_settings(app: &AppHandle, shared: &Shared, new: Settings) -> Result<(), String> {
    let screen_changed = {
        let mut current = shared.settings.locked();
        // L'écran, ou la place de l'île sur l'écran : il faut replacer la fenêtre.
        let changed = current.general.screen != new.general.screen
            || current.island.edge != new.island.edge
            || current.island.align != new.island.align
            || current.island.offset != new.island.offset;
        *current = new.clone();
        changed
    };
    settings::save(&new)?;
    apply_autostart(new.general.autostart);
    log::set_min_level(log::Level::parse(&new.general.log_level));
    island::apply_hotkey(app, &new.island.hotkey);
    if screen_changed {
        island::apply_geometry(app, &new.general.screen, shared.gate.collapsed.load(Ordering::Relaxed));
    }
    let _ = app.emit("settings-changed", new);
    Ok(())
}

#[tauri::command]
fn settings_save(app: AppHandle, shared: State<Shared>, mut settings: Settings) -> Result<(), String> {
    settings.sanitize();
    apply_settings(&app, &shared, settings)
}

/// Écrit une copie des réglages dans %APPDATA%\Ondine\exports et ouvre ce dossier.
#[tauri::command]
fn settings_export(shared: State<Shared>) -> Result<String, String> {
    let current = shared.settings.locked().clone();
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

/// Boîte « Choisir un dossier » de Windows. Renvoie None si on annule.
/// `async` : la boîte bloque jusqu'au choix, il ne faut pas bloquer le thread
/// principal (doc du plugin dialog). Elle est rattachée à la fenêtre qui la
/// demande, pour s'afficher devant elle (l'île est « toujours au premier plan »).
#[tauri::command]
async fn dialog_pick_folder(window: Window, title: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title.unwrap_or_else(|| "Choisir un dossier".into()))
        .blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().to_string())
}

/// Boîte « Ouvrir un fichier », filtrée par extensions (ex. ["ics"]). Mêmes
/// précautions que pour les dossiers. Les extensions viennent des manifestes :
/// on ne garde que des lettres et des chiffres.
#[tauri::command]
async fn dialog_pick_file(window: Window, title: Option<String>, extensions: Vec<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let clean: Vec<String> = extensions
        .into_iter()
        .filter(|e| !e.is_empty() && e.len() < 10 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .collect();
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title.unwrap_or_else(|| "Choisir un fichier".into()));
    if !clean.is_empty() {
        let refs: Vec<&str> = clean.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(clean.join(", ").to_uppercase(), &refs);
    }
    let picked = dialog.blocking_pick_file()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().to_string())
}

// ── Fenêtre de l'île ─────────────────────────────────────────────────────────

/// Île cachée → la fenêtre devient la bande de réveil et la lecture de la souris
/// s'endort. Sinon → panneau et lecture à 60 Hz.
#[tauri::command]
fn island_set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let pref = shared.settings.locked().general.screen.clone();
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

/// On a attrapé l'île par son bord extérieur : la fenêtre suit la souris
/// jusqu'au lâcher, puis s'aimante à un bord (island/mod.rs).
#[tauri::command]
fn island_drag_start(app: AppHandle, shared: State<Shared>) {
    island::drag_start(&app, &shared.gate);
}

/// Ce que fait la personne devant l'écran : depuis quand elle n'a rien touché,
/// et si une présentation ou une appli plein écran est en cours.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeskState {
    idle_ms: u64,
    busy: bool,
}

/// La langue de l'interface, "fr" ou "en" (le réglage, ou « auto » résolu).
pub fn app_language(settings: &settings::Settings) -> &'static str {
    match settings.general.language.as_str() {
        "fr" => "fr",
        "en" => "en",
        _ => platform::system_language(),
    }
}

#[tauri::command]
fn ui_language(shared: State<Shared>) -> &'static str {
    app_language(&shared.settings.locked())
}

#[tauri::command]
fn desk_state() -> DeskState {
    DeskState { idle_ms: platform::idle_ms(), busy: platform::presentation_busy() }
}

#[tauri::command]
fn island_reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.locked().general.screen.clone();
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

fn page_url(app: &AppHandle, page: &str) -> WebviewUrl {
    // En développement, les pages sont servies par Vite.
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path(&format!("/{page}"));
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App(page.into())
}

/// Les fenêtres secondaires (réglages, annotation) sont créées cachées au
/// démarrage, puis seulement montrées ou cachées : sous WebView2, une fenêtre
/// créée plus tard peut rester blanche.
fn create_hidden_window(app: &AppHandle, label: &str, page: &str, title: &str, size: (f64, f64), min: (f64, f64), mica: bool) {
    let url = page_url(app, page);
    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .additional_browser_args(BROWSER_ARGS)
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(min.0, min.1)
        .visible(false)
        .center();
    // Windows 11 : le fond « Mica » (le fond d'écran flouté et teinté, comme les
    // Paramètres de Windows). La page laisse alors son fond transparent.
    // Sur Windows 10, Mica n'existe pas : on garde une fenêtre normale.
    if mica && platform::supports_mica() {
        builder = builder
            .transparent(true)
            .effects(tauri::utils::config::WindowEffectsConfig { effects: vec![tauri::window::Effect::Mica], ..Default::default() });
    }
    match builder.build() {
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
        Err(err) => log::error(format!("fenêtre « {label} » impossible à créer : {err}")),
    }
}

/// Montre une fenêtre secondaire et lui donne le focus.
pub fn show_window(app: &AppHandle, label: &str) {
    let Some(win) = app.get_webview_window(label) else { return };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

pub fn show_settings_window(app: &AppHandle) {
    show_window(app, "settings");
}

/// La fenêtre qui appelle se cache (bouton « Fermer » de l'annotation).
#[tauri::command]
fn window_hide(window: tauri::Window) {
    let _ = window.hide();
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

/// `ondine.exe notify …` : appelé par un autre outil (hook de Claude Code…),
/// envoie un message à l'île déjà ouverte puis s'arrête. Voir cli.rs.
pub fn notify_cli() {
    cli::notify(std::env::args().skip(2).collect());
}

/// `ondine.exe permission` : Autoriser / Refuser depuis l'île (voir cli.rs).
pub fn permission_cli() {
    cli::permission(std::env::args().skip(2).collect());
}

/// `ondine.exe mcp` : l'île comme serveur MCP pour les agents (voir cli.rs).
pub fn mcp_cli() {
    cli::mcp();
}

pub fn run() {
    // Avant tout : récupérer les dossiers de l'ancien nom (« Island »).
    let migrated = platform::migrate_old_dirs();
    let loaded = settings::load();
    log::set_min_level(log::Level::parse(&loaded.general.log_level));
    for line in migrated {
        log::info(line);
    }

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
        // Boîte « Choisir un dossier » (utilisée seulement depuis le Rust, voir dialog_pick_folder).
        .plugin(tauri_plugin_dialog::init())
        // Raccourcis clavier globaux : réservés par le module Règles (Rust seulement).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Mises à jour : appelé seulement depuis le Rust (voir update.rs).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Shared { settings: Mutex::new(loaded.clone()), gate: gate.clone() })
        .manage(Registry::new())
        .manage(UndoService::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            settings_save,
            settings_export,
            settings_import,
            privacy_check_folder,
            dialog_pick_folder,
            dialog_pick_file,
            island_set_collapsed,
            island_set_rect,
            island_set_focus,
            island_reposition,
            island_drag_start,
            desk_state,
            ui_language,
            log_write,
            logs_open_folder,
            credential_exists,
            credential_set,
            credential_delete,
            bus_publish,
            module_invoke,
            undo_run,
            settings_open_window,
            window_hide,
            app_quit,
            update::update_check,
            update::update_install,
            diagnostics::bug_report_open,
            diagnostics::self_usage,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle, app_language(&loaded) == "en")?;
            // Avant l'île : voir create_hidden_window.
            create_hidden_window(&handle, "settings", "settings.html", "Réglages — Ondine", (760.0, 720.0), (560.0, 480.0), true);
            create_hidden_window(&handle, "annotate", "annotate.html", "Annoter — Ondine", (1100.0, 760.0), (640.0, 420.0), false);

            if let Some(win) = island::window(&handle) {
                platform::make_non_activating(&win);
                // On démarre en bande de réveil, sauf si le front a déjà demandé le
                // panneau : version installée, la page se charge très vite et peut
                // parler pendant ce setup (la création des fenêtres de réglages fait
                // tourner la boucle de messages). Forcer la bande ici laissait l'île
                // affichée dans une fenêtre de 6 px (« Toujours en mini »).
                island::apply_geometry(&handle, &loaded.general.screen, gate.collapsed.load(Ordering::Relaxed));
                let _ = win.show();
            }
            island::apply_hotkey(&handle, &loaded.island.hotkey);
            // À chaque démarrage : l'exe a pu changer de place (réinstallation).
            apply_autostart(loaded.general.autostart);
            island::spawn_cursor_poll(handle.clone(), gate.clone());
            // Travail de fond des modules (ex. : Musique surveille le lecteur).
            handle.state::<Registry>().start_all(&handle);

            log::info(format!("--- Ondine {} démarrée ---", env!("CARGO_PKG_VERSION")));
            if platform::is_elevated() {
                log::warn("l'île tourne en administrateur : Windows bloque le glisser-déposer depuis l'Explorateur");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Ondine");
}
