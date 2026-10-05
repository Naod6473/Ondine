// Module « Lanceur » : un raccourci clavier (Alt+Espace par défaut) ouvre l'île
// sur une barre de recherche. On y trouve :
//   - les applications du menu Démarrer (raccourcis .lnk, .url…) ;
//   - quelques outils Windows utiles en informatique (Services, Gestionnaire de
//     périphériques…), dans une liste FIXE ;
//   - les fichiers ouverts récemment (dossier « Récent » de Windows) ;
//   - les actions de l'île (celles-là sont gérées côté front).
//
// Sécurité : le front ne donne jamais de chemin, seulement le numéro d'une
// entrée que le Rust a trouvée lui-même. Un fichier récent est revalidé au
// moment de l'ouvrir (`check_path` : dossiers exclus), et les fichiers
// exécutables (.exe, .bat, .ps1…) ne sont jamais proposés comme « récents ».

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::log;

const ID: &str = "launcher";
/// On relit le menu Démarrer et les récents au plus toutes les 30 s.
const RESCAN_AFTER: Duration = Duration::from_secs(30);
/// Garde-fous : un menu Démarrer énorme ne doit pas tout ralentir.
const MAX_APPS: usize = 3000;
const MAX_DEPTH: usize = 6;
const MAX_RECENT: usize = 40;
/// Le raccourci par défaut (même que PowerToys Run).
const DEFAULT_HOTKEY: &str = "Alt+Space";
/// Les raccourcis qu'on propose dans les réglages. Toute autre valeur est refusée.
const HOTKEYS: &[&str] = &["Alt+Space", "Ctrl+Space", "Ctrl+Alt+Space", "Ctrl+Shift+Space", "Super+Shift+Space"];

/// Extensions jamais proposées dans « récents » : les ouvrir LANCERAIT un programme.
const EXECUTABLE: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "msi", "msp", "scr", "cpl", "lnk", "url",
    "reg", "jar", "pif", "appref-ms", "application",
];

/// Outils Windows proposés en plus des applications (liste fixe : nom affiché, ce qu'on ouvre).
const TOOLS: &[(&str, &str)] = &[
    ("Paramètres Windows", "ms-settings:"),
    ("Panneau de configuration", "control.exe"),
    ("Gestionnaire des tâches", "taskmgr.exe"),
    ("Gestionnaire de périphériques", "devmgmt.msc"),
    ("Services", "services.msc"),
    ("Observateur d'événements", "eventvwr.msc"),
    ("Gestion de l'ordinateur", "compmgmt.msc"),
    ("Gestion des disques", "diskmgmt.msc"),
    ("Connexions réseau", "ncpa.cpl"),
    ("Programmes et fonctionnalités", "appwiz.cpl"),
    ("Informations système", "msinfo32.exe"),
    ("Éditeur du Registre", "regedit.exe"),
    ("Connexion Bureau à distance", "mstsc.exe"),
    ("Calculatrice", "calc.exe"),
    ("Bloc-notes", "notepad.exe"),
];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    App,
    Tool,
    Recent,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::App => "app",
            Kind::Tool => "tool",
            Kind::Recent => "recent",
        }
    }
}

#[derive(Debug, Clone)]
struct Entry {
    id: u32,
    name: String,
    kind: Kind,
    /// Ce qu'on ouvre : un chemin (raccourci, fichier) ou une commande de TOOLS.
    target: String,
    /// Une précision affichée sous le nom (dossier du fichier, « Outil Windows »…).
    detail: String,
}

#[derive(Default)]
struct State {
    entries: Vec<Entry>,
    scanned: Option<Instant>,
    /// Le raccourci réservé en ce moment ("" = aucun).
    hotkey: String,
    hotkey_error: Option<String>,
}

type Shared = Arc<Mutex<State>>;

#[derive(Default)]
pub struct Launcher {
    state: Shared,
}

impl RustModule for Launcher {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/launcher/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || hotkey_loop(app, state));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "entries" => {
                let stale = self.state.lock().unwrap().scanned.is_none_or(|t| t.elapsed() > RESCAN_AFTER);
                if stale {
                    let entries = scan(ctx);
                    let mut s = self.state.lock().unwrap();
                    s.entries = entries;
                    s.scanned = Some(Instant::now());
                }
                let s = self.state.lock().unwrap();
                let items: Vec<Value> = s
                    .entries
                    .iter()
                    .map(|e| json!({ "id": e.id, "name": e.name, "kind": e.kind.name(), "detail": e.detail }))
                    .collect();
                Ok(json!({ "items": items, "hotkey": s.hotkey, "hotkeyError": s.hotkey_error }))
            }
            "launch" => {
                let id = args.get("id").and_then(Value::as_u64).ok_or("entrée manquante")?;
                let entry = {
                    let s = self.state.lock().unwrap();
                    s.entries.iter().find(|e| u64::from(e.id) == id).cloned()
                };
                let entry = entry.ok_or("cette entrée n'existe plus, recherche à nouveau")?;
                // Un fichier récent : on revérifie (exclu entre-temps ? supprimé ?).
                if entry.kind == Kind::Recent {
                    let path = ctx.check_path(&entry.target)?;
                    if is_executable(&path) {
                        return Err("ce fichier est un programme : ouvre-le depuis l'Explorateur".into());
                    }
                }
                platform::forget_previous_foreground();
                platform::shell_open(&entry.target).map_err(|e| format!("{} : {e}", entry.name))?;
                // Le journal ne contient que le type d'entrée, jamais le nom du fichier.
                log::info(format!("lanceur : ouverture ({})", entry.kind.name()));
                Ok(Value::Null)
            }
            // Avant une action de l'île qui ouvre une fenêtre (terminal…) :
            // l'île ne rendra pas le focus à la fenêtre d'avant.
            "forget_focus" => {
                platform::forget_previous_foreground();
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Le raccourci global ──────────────────────────────────────────────────────

/// Toutes les secondes : le raccourci réservé correspond-il au réglage (et au
/// module activé) ? Sinon on libère l'ancien et on réserve le nouveau.
fn hotkey_loop(app: AppHandle, state: Shared) {
    std::thread::sleep(Duration::from_secs(2)); // le temps que les réglages soient chargés
    loop {
        let step = catch_unwind(AssertUnwindSafe(|| {
            let wanted = super::with_context(&app, ID, |ctx| wanted_hotkey(ctx)).unwrap_or_default();
            let current = state.lock().unwrap().hotkey.clone();
            if wanted != current {
                apply_hotkey(&app, &state, &current, &wanted);
            }
        }));
        if step.is_err() {
            log::warn("lanceur : erreur inattendue avec le raccourci, on réessaie");
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

/// Le raccourci demandé dans les réglages ("" = aucun).
fn wanted_hotkey(ctx: &ModuleContext) -> String {
    let settings = ctx.settings();
    let value = settings.get("hotkey").and_then(Value::as_str).unwrap_or(DEFAULT_HOTKEY);
    if HOTKEYS.contains(&value) {
        value.to_string()
    } else {
        String::new() // "off", ou une valeur inconnue
    }
}

fn apply_hotkey(app: &AppHandle, state: &Shared, current: &str, wanted: &str) {
    let gs = app.global_shortcut();
    if !current.is_empty() {
        let _ = gs.unregister(current);
    }
    let mut error = None;
    if !wanted.is_empty() {
        let app2 = app.clone();
        let result = gs.on_shortcut(wanted, move |_app, _shortcut, event| {
            // Au relâchement : pas de répétition si on garde les touches enfoncées.
            if event.state == ShortcutState::Released {
                let app3 = app2.clone();
                // Le gestionnaire tourne sur le thread principal : on ne le bloque pas.
                std::thread::spawn(move || {
                    super::with_context(&app3, ID, |ctx| ctx.emit("launcher.open", json!({})));
                });
            }
        });
        if let Err(e) = result {
            let text = e.to_string();
            let pretty = wanted.replace("Super", "Win").replace("Space", "Espace");
            let msg = if text.contains("already registered") {
                format!("{pretty} est déjà utilisé par un autre logiciel : choisis un autre raccourci dans les réglages du Lanceur")
            } else {
                format!("le raccourci {pretty} est refusé : {text}")
            };
            log::warn(format!("lanceur : {msg}"));
            super::with_context(app, ID, |ctx| ctx.emit("launcher.hotkey-error", json!({ "text": msg })));
            error = Some(msg);
        }
    }
    let mut s = state.lock().unwrap();
    // Même en cas d'échec, on note le raccourci voulu : on ne réessaie pas
    // chaque seconde (on réessaiera quand le réglage changera).
    s.hotkey = wanted.to_string();
    s.hotkey_error = error;
}

// ── La liste des entrées ─────────────────────────────────────────────────────

/// Relit tout : applications, outils, récents. COM est nécessaire pour lire
/// les raccourcis .lnk : on fait le travail dans un thread à part.
fn scan(ctx: &ModuleContext) -> Vec<Entry> {
    let roots = start_menu_dirs();
    let show_recent = ctx.settings().get("showRecent").and_then(Value::as_bool).unwrap_or(true);
    let recent_dir = if show_recent { recent_dir() } else { None };
    let handle = std::thread::spawn(move || {
        platform::with_com(|| {
            let mut apps = Vec::new();
            for root in &roots {
                walk(root, 0, &mut apps);
            }
            let recent = recent_dir.map(|d| recent_files(&d)).unwrap_or_default();
            (apps, recent)
        })
    });
    let (apps, recent) = handle.join().unwrap_or_default();

    let mut entries: Vec<Entry> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let push = |entries: &mut Vec<Entry>, name: String, kind: Kind, target: String, detail: String| {
        let id = entries.len() as u32 + 1;
        entries.push(Entry { id, name, kind, target, detail });
    };
    for (name, path) in apps {
        // Le même programme est souvent dans les deux menus Démarrer.
        if seen.insert(name.to_lowercase()) {
            push(&mut entries, name, Kind::App, path.display().to_string(), String::new());
        }
    }
    for (name, target) in TOOLS {
        if seen.insert(name.to_lowercase()) {
            push(&mut entries, (*name).to_string(), Kind::Tool, (*target).to_string(), "Outil Windows".into());
        }
    }
    let mut recent_count = 0;
    for path in recent {
        if recent_count >= MAX_RECENT {
            break;
        }
        // Dossiers exclus dans les réglages de confidentialité : invisibles ici.
        let Ok(path) = ctx.check_path(&path.display().to_string()) else { continue };
        if !path.is_file() || is_executable(&path) {
            continue;
        }
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let detail = path.parent().map(|p| p.display().to_string()).unwrap_or_default();
        push(&mut entries, name, Kind::Recent, path.display().to_string(), detail);
        recent_count += 1;
    }
    entries
}

/// Les deux dossiers « Programmes » du menu Démarrer (pour tous, et pour moi).
fn start_menu_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for var in ["ProgramData", "APPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            dirs.push(PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
    }
    dirs
}

/// Le dossier « Récent » de Windows : un raccourci .lnk par fichier ouvert.
fn recent_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join(r"Microsoft\Windows\Recent"))
}

/// Parcourt un dossier du menu Démarrer et note ses raccourcis d'applications.
fn walk(dir: &Path, depth: usize, out: &mut Vec<(String, PathBuf)>) {
    if depth > MAX_DEPTH || out.len() >= MAX_APPS {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for item in read.flatten() {
        let path = item.path();
        let Ok(kind) = item.file_type() else { continue };
        if kind.is_dir() {
            walk(&path, depth + 1, out);
        } else if let Some(name) = app_name(&path) {
            out.push((name, path));
        }
    }
}

/// « Firefox.lnk » → Some("Firefox"). Les désinstalleurs, l'aide et les
/// fichiers qui ne sont pas des raccourcis sont ignorés.
fn app_name(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    if !matches!(ext.as_str(), "lnk" | "url" | "appref-ms") {
        return None;
    }
    let name = path.file_stem()?.to_string_lossy().trim().to_string();
    let lower = name.to_lowercase();
    let noise = ["uninstall", "désinstaller", "desinstaller", "readme", "lisez-moi", "release notes"];
    if name.is_empty() || noise.iter().any(|n| lower.contains(n)) {
        return None;
    }
    Some(name)
}

/// Les fichiers ouverts récemment, du plus récent au plus ancien.
fn recent_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut links: Vec<(SystemTime, PathBuf)> = read
        .flatten()
        .filter(|i| i.path().extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")))
        .filter_map(|i| Some((i.metadata().ok()?.modified().ok()?, i.path())))
        .collect();
    links.sort_by(|a, b| b.0.cmp(&a.0));
    links
        .into_iter()
        .take(MAX_RECENT * 2) // de la marge : `scan` en écarte (dossiers, exclus…)
        .filter_map(|(_, lnk)| platform::shortcut_target(&lnk))
        .collect()
}

fn is_executable(path: &Path) -> bool {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    EXECUTABLE.contains(&ext.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names() {
        assert_eq!(app_name(Path::new("Firefox.lnk")).as_deref(), Some("Firefox"));
        assert_eq!(app_name(Path::new("Site.url")).as_deref(), Some("Site"));
        assert_eq!(app_name(Path::new("Uninstall Foo.lnk")), None);
        assert_eq!(app_name(Path::new("desktop.ini")), None);
    }

    #[test]
    fn executables_are_never_recent() {
        assert!(is_executable(Path::new("setup.EXE")));
        assert!(is_executable(Path::new("script.ps1")));
        assert!(!is_executable(Path::new("rapport.pdf")));
        assert!(!is_executable(Path::new("sans-extension")));
    }

    #[test]
    fn hotkeys_parse() {
        use tauri_plugin_global_shortcut::Shortcut;
        for k in HOTKEYS {
            assert!(k.parse::<Shortcut>().is_ok(), "{k}");
        }
    }
}
