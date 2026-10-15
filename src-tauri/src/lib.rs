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
mod pet;
mod pill;
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
    pub settings_effects: Mutex<()>,
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

pub(crate) fn apply_settings(app: &AppHandle, shared: &Shared, new: Settings) -> Result<(), String> {
    update_settings(app, shared, |_| Ok(new)).map(|_| ())
}

pub(crate) fn update_settings(app: &AppHandle, shared: &Shared, change: impl FnOnce(&Settings) -> Result<Settings, String>) -> Result<Settings, String> {
    // Les effets Windows suivent le même ordre que les écritures sur le disque.
    let _effects = shared.settings_effects.locked();
    let (new, effects) = {
        let mut current = shared.settings.locked();
        let mut new = change(&current)?;
        new.sanitize();
        let effects = services::settings_patch::Effects::between(&current, &new);
        // Enregistré sous le verrou : une autre sauvegarde (fin de déplacement
        // de l'île…) ne peut pas passer entre la mémoire et le fichier.
        services::settings_patch::commit(&mut current, new, settings::save)?;
        (current.clone(), effects)
    };
    if effects.autostart { apply_autostart(new.general.autostart); }
    if effects.log { log::set_min_level(log::Level::parse(&new.general.log_level)); }
    if effects.hotkey { island::apply_hotkey(app, &new.island.hotkey); }
    if effects.geometry {
        island::apply_geometry(app, &new.general.screen, shared.gate.collapsed.load(Ordering::Relaxed));
    }
    // Le menu de l'icône montre les profils et coche l'actif.
    tray::sync_profiles(app, &new.profiles);
    let _ = app.emit("settings-changed", &new);
    // Ondine sur le bureau : montrée, cachée, au-dessus ou derrière les fenêtres.
    if effects.pet { pet::apply(app); }
    // Le mode de performance a peut-être changé : les boucles le lisent au tour suivant.
    if effects.perf { services::perf::refresh(app); }
    // La place réglée ou « éviter les réglages » a pu changer : l'île revérifie.
    if effects.dodge { island::dodge::recompute(app); }
    Ok(new)
}

#[tauri::command]
async fn settings_patch(app: AppHandle, window: Window, patch: Vec<services::settings_patch::Patch>) -> Result<Settings, String> {
    let pet = window.label() == "pet";
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        update_settings(&app, &shared, |current| if pet {
            services::settings_patch::apply_pet(current, &patch)
        } else { services::settings_patch::apply(current, &patch) })
    }).await.map_err(|e| format!("sauvegarde interrompue : {e}"))?
}

/// Active un profil ("" = aucun) : voir services/profiles.rs.
#[tauri::command]
async fn profile_activate(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || services::profiles::activate(&app, &id))
        .await.map_err(|e| e.to_string())?
}

/// Le nom du Wi-Fi connecté (bouton « Wi-Fi actuel » de la page Profils).
#[tauri::command]
async fn profile_wifi_name() -> Option<String> {
    tauri::async_runtime::spawn_blocking(platform::wifi::current_ssid).await.ok().flatten()
}

/// Écrit une copie des réglages dans %APPDATA%\Ondine\exports et ouvre ce dossier.
#[tauri::command]
async fn settings_export(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current = app.state::<Shared>().settings.locked().clone();
        let file = settings::export(&current)?;
        if let Some(dir) = file.parent() {
            platform::reveal_folder(dir);
        }
        log::info("réglages exportés");
        Ok(file.to_string_lossy().to_string())
    }).await.map_err(|e| e.to_string())?
}

/// Reçoit le TEXTE d'un fichier de réglages (lu par la fenêtre de réglages).
#[tauri::command]
async fn settings_import(app: AppHandle, text: String) -> Result<(), String> {
    if text.len() > 1_000_000 {
        return Err("fichier trop gros pour être un fichier de réglages".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let imported = settings::parse(&text)?;
        apply_settings(&app, &shared, imported)?;
        log::info("réglages importés");
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// « Reprendre la configuration de mon autre PC » (assistant de premier
/// lancement, dans l'île) : la boîte « Ouvrir » de Windows, puis le fichier de
/// réglages exporté est lu et importé comme par la fenêtre de réglages.
/// `Ok(false)` si on annule.
#[tauri::command]
async fn settings_import_pick(app: AppHandle, window: Window, title: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let picked = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title.unwrap_or_else(|| "Choisir un fichier de réglages".into()))
            .add_filter("Réglages d'Ondine", &["json"])
            .blocking_pick_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(false) };
        let shared = app.state::<Shared>();
        // Les dossiers exclus (Confidentialité) restent intouchables, même ici.
        let path = privacy::check_path(&shared.settings.locked().clone(), &path.to_string_lossy())?;
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > 1_000_000 {
            return Err("fichier trop gros pour être un fichier de réglages".into());
        }
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let imported = settings::parse(&text)?;
        apply_settings(&app, &shared, imported)?;
        log::info("réglages importés (assistant de premier lancement)");
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

/// Les logiciels connus installés sur ce PC (ids d'une liste fixe : « vscode »,
/// « spotify »…), pour pré-cocher les cartes de l'assistant. Tout reste sur le
/// PC (services/apps.rs). Lu hors du fil principal (registre, menu Démarrer).
#[tauri::command]
async fn apps_detect() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(services::apps::detect).await.unwrap_or_default()
}

/// Vérifie un dossier à exclure avant de l'ajouter à la liste.
#[tauri::command]
fn privacy_check_folder(path: String) -> Result<String, String> {
    privacy::check_folder(&path)
}

/// Ajoute un téléphone (sans `id`) ou remontre le QR code d'un téléphone déjà
/// préparé (`id`). Voir Réglages → Téléphones.
#[tauri::command]
async fn phone_certificate_setup(id: Option<String>, name: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || services::phone_tls::setup(id, name)).await.map_err(|e| e.to_string())?
}

/// Les téléphones préparés (partie publique seulement).
#[tauri::command]
fn phone_list() -> Value {
    services::phone_tls::list()
}

/// Révoque un téléphone : sa clé est effacée pour de bon.
#[tauri::command]
fn phone_revoke(id: String) -> Result<(), String> {
    services::phone_tls::revoke(&id)
}

/// Le téléphone pour lequel l'Étagère et la télécommande ouvrent leur lien.
#[tauri::command]
fn phone_activate(id: String) -> Result<(), String> {
    services::phone_tls::activate(&id)
}

/// Boîte « Choisir un dossier » de Windows. Renvoie None si on annule.
/// `async` : la boîte bloque jusqu'au choix, il ne faut pas bloquer le thread
/// principal (doc du plugin dialog). Elle est rattachée à la fenêtre qui la
/// demande, pour s'afficher devant elle (l'île est « toujours au premier plan »).
#[tauri::command]
async fn dialog_pick_folder(window: Window, title: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let picked = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title.unwrap_or_else(|| "Choisir un dossier".into()))
            .blocking_pick_folder()?;
        picked.into_path().ok().map(|p| p.to_string_lossy().to_string())
    }).await.ok().flatten()
}

/// Boîte « Ouvrir un fichier », filtrée par extensions (ex. ["ics"]). Mêmes
/// précautions que pour les dossiers. Les extensions viennent des manifestes :
/// on ne garde que des lettres et des chiffres.
#[tauri::command]
async fn dialog_pick_file(window: Window, title: Option<String>, extensions: Vec<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    }).await.ok().flatten()
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

/// L'île ouverte grandit pour montrer un contenu en entier (src/island/fit.ts) :
/// la fenêtre passe au panneau haut avant, et revient après.
#[tauri::command]
fn island_set_tall(app: AppHandle, shared: State<Shared>, tall: bool) {
    if shared.gate.tall.swap(tall, Ordering::Relaxed) == tall {
        return;
    }
    // Île cachée : la bande garde sa taille ; le panneau prendra la bonne au réveil.
    if !shared.gate.collapsed.load(Ordering::Relaxed) {
        let pref = shared.settings.locked().general.screen.clone();
        island::apply_geometry(&app, &pref, false);
    }
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

/// La page d'un reflet de l'île (autre écran, island/mirrors.rs) est chargée :
/// elle reçoit son apparence, et peut être montrée.
#[tauri::command]
fn mirror_look(app: AppHandle, window: Window) -> island::mirrors::MirrorLook {
    island::mirrors::page_ready(&app, window.label())
}

#[tauri::command]
fn island_reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.locked().general.screen.clone();
    island::apply_geometry(&app, &pref, shared.gate.collapsed.load(Ordering::Relaxed));
}

// ── Ondine sur le bureau (pet.rs) ────────────────────────────────────────────

/// Ouvre ou ferme la bulle à côté d'elle ; renvoie la disposition choisie.
/// `w`, `h` : la taille de la bulle mesurée par la page (px logiques).
#[tauri::command]
fn pet_open(app: AppHandle, open: bool, w: Option<f64>, h: Option<f64>) -> pet::Layout {
    pet::set_open(&app, open, w.zip(h))
}

/// La bulle a besoin d'une autre taille (son contenu a changé).
#[tauri::command]
fn pet_bubble(app: AppHandle, w: f64, h: f64) {
    pet::set_bubble(&app, w, h);
}

/// On a attrapé Ondine : elle suit la souris jusqu'au lâcher.
#[tauri::command]
fn pet_drag_start(app: AppHandle) {
    pet::drag_start(&app);
}

/// Les cases de la page qui prennent la souris (la mascotte, la bulle).
#[tauri::command]
fn pet_set_hit(app: AppHandle, rects: Vec<pet::HitRect>) {
    pet::set_hit(&app, rects);
}

/// Ondine sort de l'île : posée là où la souris est (glisser depuis l'île),
/// ou à sa dernière place.
#[tauri::command]
fn pet_place(app: AppHandle, at_cursor: bool) {
    let at = if at_cursor { platform::cursor_physical() } else { None };
    pet::place_on_desk(&app, at);
}

/// Ondine rentre dans l'île.
#[tauri::command]
fn pet_back(app: AppHandle) {
    pet::back_to_island(&app);
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
/// appelle (fournie par Tauri, donc impossible à falsifier depuis la page) :
/// c'est elle, et non `source`, que le Rust consulte pour décider (modules/mod.rs).
/// `source` (le module front émetteur) est déclaré par la page : tous les
/// modules front partagent la même page, on ne peut pas le vérifier ; il ne sert
/// qu'à l'affichage et au journal, et il est donc seulement nettoyé.
#[tauri::command]
fn bus_publish(app: AppHandle, window: Window, topic: String, payload: Value, source: String) {
    let source: String = source.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(32).collect();
    let msg = BusMessage { topic, payload, source, origin: window.label().to_string() };
    bus::deliver(&app, msg);
}

/// LA porte d'entrée vers le code Rust des modules (voir modules/mod.rs).
/// `async` : Tauri l'exécute hors du thread principal, un module lent ne fige pas l'île.
#[tauri::command]
async fn module_invoke(app: AppHandle, window: Window, module: String, command: String, args: Value, work: State<'_, services::work::WorkGates>) -> Result<Value, String> {
    if window.label() == "annotate" && !(module == "capture" && matches!(command.as_str(), "annotate_image" | "annotate_export")) {
        return Err("commande refusée depuis la fenêtre d'annotation".into());
    }
    if window.label() == "pet" && !app.state::<Shared>().settings.locked().mascot.pet_tabs.contains(&module) {
        return Err("cet onglet n'est pas disponible sur la mascotte".into());
    }
    if window.label() == pill::WINDOW_LABEL && !(module == "dictation" && matches!(command.as_str(), "pill_state" | "pill_hit" | "pill_action")) {
        return Err("commande refusée depuis la pilule de la dictée".into());
    }
    let permit = work.enter(&module, &command).await?;
    // HTTP, Win32, fichiers et ZIP sont synchrones : ils ne doivent pas occuper
    // les workers async qui livrent les événements et les autres commandes.
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        // La sélection peut avoir changé pendant l'attente dans la file.
        if window.label() == "pet" && !app.state::<Shared>().settings.locked().mascot.pet_tabs.contains(&module) {
            return Err("cet onglet n'est pas disponible sur la mascotte".into());
        }
        modules::invoke(&app, &module, &command, args)
    })
        .await
        .map_err(|e| format!("opération interrompue : {e}"))?
}

#[tauri::command]
async fn undo_run(app: AppHandle, id: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<UndoService>().run(&app, id))
        .await.map_err(|e| e.to_string())?
}

// ── Fenêtre de réglages ──────────────────────────────────────────────────────

/// WebView2 n'autorise qu'un seul « environnement » par appli, fixé par la première
/// fenêtre créée : toutes les fenêtres doivent donc demander EXACTEMENT les mêmes
/// arguments que l'île (voir `additionalBrowserArgs` dans tauri.conf.json), sinon
/// la seconde reste blanche sans aucune erreur. (Constat de Coucou.)
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

pub(crate) fn page_url(app: &AppHandle, page: &str) -> WebviewUrl {
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
                    // Les réglages fermés : l'île rentre chez elle (island/dodge.rs).
                    if hidden.label() == island::dodge::SETTINGS_LABEL {
                        island::dodge::settings_window_changed(hidden.app_handle());
                    }
                }
            });
        }
        Err(err) => log::error(format!("fenêtre « {label} » impossible à créer : {err}")),
    }
}

/// La fenêtre d'Ondine sur le bureau (pet.rs) : sans bordure, transparente, hors
/// de la barre des tâches, créée cachée comme les autres (voir create_hidden_window).
fn create_pet_window(app: &AppHandle) {
    let builder = WebviewWindowBuilder::new(app, pet::WINDOW_LABEL, page_url(app, "pet.html"))
        .additional_browser_args(BROWSER_ARGS)
        .title("Ondine")
        .inner_size(pet::PET_BOX, pet::PET_BOX)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
    match builder.build() {
        Ok(win) => platform::make_non_activating(&win),
        Err(err) => log::error(format!("fenêtre « pet » impossible à créer : {err}")),
    }
}

/// Montre une fenêtre secondaire et lui donne le focus.
pub fn show_window(app: &AppHandle, label: &str) {
    let Some(win) = app.get_webview_window(label) else { return };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    // Les réglages s'ouvrent : l'île s'écarte s'ils la cachent (island/dodge.rs).
    if label == island::dodge::SETTINGS_LABEL {
        island::dodge::settings_window_changed(app);
    }
}

pub fn show_settings_window(app: &AppHandle) {
    show_window(app, "settings");
}

/// La fenêtre qui appelle se cache (bouton « Fermer » de l'annotation).
#[tauri::command]
fn window_hide(window: tauri::Window) {
    let _ = window.hide();
    if window.label() == island::dodge::SETTINGS_LABEL {
        island::dodge::settings_window_changed(window.app_handle());
    }
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

/// `ondine.exe statusline` : ligne d'état de Claude Code, limites du forfait (voir cli.rs).
pub fn statusline_cli() {
    cli::statusline();
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
        .manage(Shared { settings: Mutex::new(loaded.clone()), settings_effects: Mutex::new(()), gate: gate.clone() })
        .manage(Registry::new())
        .manage(services::work::WorkGates::default())
        .manage(UndoService::default())
        .manage(pet::PetState::default())
        .manage(pill::PillState::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            settings_patch,
            settings_export,
            settings_import,
            settings_import_pick,
            apps_detect,
            privacy_check_folder,
            phone_certificate_setup,
            phone_list,
            phone_revoke,
            phone_activate,
            dialog_pick_folder,
            dialog_pick_file,
            island_set_collapsed,
            island_set_tall,
            island_set_rect,
            island_set_focus,
            island_reposition,
            island_drag_start,
            mirror_look,
            pet_open,
            pet_bubble,
            pet_drag_start,
            pet_set_hit,
            pet_place,
            pet_back,
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
            update::release_page_open,
            profile_activate,
            profile_wifi_name,
            diagnostics::bug_report_open,
            diagnostics::self_usage,
            services::perf::perf_state,
            // Reconnaissance sur le PC (1.2.4) : les modèles Parakeet.
            services::speech::speech_status,
            services::speech::speech_download,
            services::speech::speech_cancel,
            services::speech::speech_remove,
            services::custom_sounds::sounds_custom,
            services::custom_sounds::sounds_open_folder,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle, app_language(&loaded) == "en")?;
            // Avant l'île : voir create_hidden_window.
            create_hidden_window(&handle, "settings", "settings.html", "Réglages — Ondine", (760.0, 720.0), (560.0, 480.0), true);
            create_hidden_window(&handle, "annotate", "annotate.html", "Annoter — Ondine", (1100.0, 760.0), (640.0, 420.0), false);
            create_pet_window(&handle);
            // La pilule de la Dictée (cachée tant que le module est coupé).
            pill::create(&handle, page_url(&handle, "pill.html"));
            island::dodge::watch_settings_window(&handle);

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
            pet::apply(&handle);
            pet::spawn_hit_poll(handle.clone());
            pet::spawn_wander(handle.clone());
            pill::spawn_hit_poll(handle.clone());
            // À chaque démarrage : l'exe a pu changer de place (réinstallation).
            apply_autostart(loaded.general.autostart);
            // Le mode de performance (réglage + batterie), avant les boucles qui le lisent.
            services::perf::spawn_watch(handle.clone());
            island::spawn_cursor_poll(handle.clone(), gate.clone());
            // Travail de fond des modules (ex. : Musique surveille le lecteur).
            handle.state::<Registry>().start_all(&handle);
            // Profils : le menu de l'icône, et le changement automatique (heure, Wi-Fi).
            tray::sync_profiles(&handle, &loaded.profiles);
            services::profiles::spawn_auto(handle.clone());
            // Les bons moments pour proposer un onglet (première clé USB, première visio).
            services::hints::spawn_watch(handle.clone());

            log::info(format!("--- Ondine {} démarrée ---", env!("CARGO_PKG_VERSION")));
            if platform::is_elevated() {
                log::warn("l'île tourne en administrateur : Windows bloque le glisser-déposer depuis l'Explorateur");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("impossible de démarrer Ondine");
}
