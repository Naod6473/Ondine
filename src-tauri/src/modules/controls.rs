// Module « Contrôles » : le volume des haut-parleurs et du micro, et la
// luminosité des écrans, depuis l'île.
//
// Le front (src/modules/controls) affiche les curseurs et les boutons
// « couper », et les interrupteurs Wi-Fi / Bluetooth / mode avion. Ici on ne
// fait que transmettre à platform::audio, platform::brightness et
// platform::radios, en vérifiant les valeurs reçues. Rien n'est écrit
// dans le journal à chaque changement.
//
// Un thread de fond regarde aussi, toutes les 2 s :
//   - qui utilise le micro ou la caméra (platform::media_use) → "controls.media-use",
//     pour le petit point orange / vert de l'île ;
//   - si le micro est coupé → "controls.mic-muted", pour le badge d'Ondine ;
//   - le raccourci « couper le micro » choisi dans les réglages (micHotkey).
//
// « Premier plan » : garde la fenêtre où tu travaillais (celle d'avant l'île)
// au-dessus des autres, comme une vidéo en incrustation. Un second appui la relâche.

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform::audio::{self, Device};
use crate::platform::media_use::{self, MediaUse};
use crate::services::{bus, log};
use crate::services::perf::{self, Loop};
use crate::platform::brightness;
use crate::platform::radios::{self, Kind};

const ID: &str = "controls";

/// Les raccourcis proposés pour couper / rétablir le micro (les autres sont refusés).
pub const MIC_HOTKEYS: &[&str] = &["Ctrl+Alt+M", "Ctrl+Shift+M", "Alt+Shift+M", "Pause"];

/// Le raccourci micro actuellement enregistré auprès de Windows ("" = aucun).
static MIC_HOTKEY: Mutex<String> = Mutex::new(String::new());

#[derive(Default)]
pub struct Controls;

/// "speakers" ou "microphone" → le périphérique ; toute autre valeur est refusée.
fn arg_device(args: &Value) -> Result<Device, String> {
    match args.get("device").and_then(Value::as_str) {
        Some("speakers") => Ok(Device::Speakers),
        Some("microphone") => Ok(Device::Microphone),
        _ => Err("périphérique inconnu (speakers ou microphone)".into()),
    }
}

/// L'état d'un périphérique, ou `null` s'il n'y en a pas (pas de micro branché…).
fn level_or_null(device: Device) -> Value {
    match audio::get(device) {
        Ok(level) => json!(level),
        Err(_) => Value::Null,
    }
}

impl RustModule for Controls {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/controls/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || watch(app));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // {} → [{ id, name, default }] : les sorties audio branchées.
            "outputs" => Ok(json!(audio::outputs()?)),
            // { id } : cette sortie devient celle par défaut (API interne de Windows, voir audio.rs).
            "set_output" => {
                let id = args.get("id").and_then(Value::as_str).filter(|s| s.len() <= 512).ok_or("sortie inconnue")?;
                audio::set_default_output(id)?;
                Ok(Value::Null)
            }
            // {} → { title, pinned } de la fenêtre où tu travaillais (null : aucune).
            "window" => Ok(match crate::platform::user_window(ctx.app) {
                Some(h) => json!({ "title": crate::platform::window_title(h), "pinned": crate::platform::is_topmost(h) }),
                None => Value::Null,
            }),
            // {} : la garde au premier plan, ou la relâche. → { title, pinned }
            "toggle_pin" => {
                let h = crate::platform::user_window(ctx.app).ok_or("aucune fenêtre à garder au premier plan")?;
                let pinned = !crate::platform::is_topmost(h);
                crate::platform::set_topmost(h, pinned)?;
                Ok(json!({ "title": crate::platform::window_title(h), "pinned": pinned }))
            }
            // {} → { mic: [noms], cam: [noms] } : qui utilise le micro / la caméra.
            "media_use" => Ok(json!(media_use::current())),
            // {} : coupe le micro s'il est ouvert, le rétablit sinon.
            "toggle_mic" => toggle_mic().map(|muted| json!({ "muted": muted })),
            // {} → { speakers: { volume, muted } | null, microphone: … }
            "state" => Ok(json!({
                "speakers": level_or_null(Device::Speakers),
                "microphone": level_or_null(Device::Microphone),
            })),
            // { device, volume: 0..100 }
            "set_volume" => {
                let device = arg_device(&args)?;
                let volume = args
                    .get("volume")
                    .and_then(Value::as_u64)
                    .filter(|v| *v <= 100)
                    .ok_or("le volume doit être un nombre entre 0 et 100")?;
                audio::set_volume(device, volume as u32)?;
                Ok(Value::Null)
            }
            // { device, muted: bool }
            "set_muted" => {
                let device = arg_device(&args)?;
                let muted = args.get("muted").and_then(Value::as_bool).ok_or("« muted » doit valoir true ou false")?;
                audio::set_muted(device, muted)?;
                Ok(Value::Null)
            }
            // {} → [{ id, name, brightness }] : les écrans réglables (peut être vide).
            // À part de « state » : parler aux écrans externes est lent.
            "screens" => Ok(json!(brightness::list())),
            // { id, brightness: 0..100 }
            "set_brightness" => {
                let id = args.get("id").and_then(Value::as_str).filter(|s| s.len() <= 16).ok_or("écran inconnu")?;
                let level = args
                    .get("brightness")
                    .and_then(Value::as_u64)
                    .filter(|v| *v <= 100)
                    .ok_or("la luminosité doit être un nombre entre 0 et 100")?;
                brightness::set(id, level as u32)?;
                Ok(Value::Null)
            }
            // {} → [{ kind: "wifi" | "bluetooth" | "mobile", on, disabled }]
            "radios" => Ok(json!(radios::list()?)),
            // { kind, on: bool }
            "set_radio" => {
                let kind = args.get("kind").and_then(Value::as_str).and_then(Kind::parse).ok_or("radio inconnue")?;
                let on = args.get("on").and_then(Value::as_bool).ok_or("« on » doit valoir true ou false")?;
                radios::set(kind, on)?;
                Ok(Value::Null)
            }
            // { on: bool } : tout éteindre, ou rallumer ce qui l'était.
            "set_airplane" => {
                let on = args.get("on").and_then(Value::as_bool).ok_or("« on » doit valoir true ou false")?;
                radios::set_airplane(on)?;
                Ok(Value::Null)
            }
            _ => Err(format!("commande non gérée : {command}")),
        }
    }
}

/// Coupe le micro s'il était ouvert, le rétablit sinon. Renvoie le nouvel état.
fn toggle_mic() -> Result<bool, String> {
    let muted = !audio::get(Device::Microphone)?.muted;
    audio::set_muted(Device::Microphone, muted)?;
    Ok(muted)
}

/// Le thread de fond : micro / caméra utilisés, micro coupé, raccourci micro.
fn watch(app: AppHandle) {
    let mut last_use = MediaUse::default();
    let mut last_muted: Option<bool> = None;
    loop {
        // Toutes les 2 s (1 s en haute, 3 s en éco : services/perf.rs).
        std::thread::sleep(perf::every(Loop::Controls));
        if !super::is_active(&app, ID) {
            // Module désactivé : plus de point ni de raccourci.
            if last_use != MediaUse::default() {
                last_use = MediaUse::default();
                bus::emit(&app, ID, "controls.media-use", json!(last_use));
            }
            apply_mic_hotkey(&app, "");
            continue;
        }
        let step = catch_unwind(AssertUnwindSafe(|| {
            let wanted = super::with_context(&app, ID, |ctx| {
                // Absent (réglages jamais ouverts) : le raccourci par défaut du manifeste.
                ctx.settings().get("micHotkey").and_then(Value::as_str).unwrap_or("Ctrl+Alt+M").to_string()
            });
            apply_mic_hotkey(&app, &wanted.unwrap_or_default());

            let now = media_use::current();
            if now != last_use {
                bus::emit(&app, ID, "controls.media-use", json!(now));
                last_use = now;
            }
            // Pas de micro branché : on ne dit rien.
            let muted = audio::get(Device::Microphone).ok().map(|l| l.muted);
            if muted != last_muted {
                bus::emit(&app, ID, "controls.mic-muted", json!({ "muted": muted.unwrap_or(false), "source": "watch" }));
                last_muted = muted;
            }
        }));
        if step.is_err() {
            log::warn("contrôles : erreur inattendue pendant la surveillance, on continue");
        }
    }
}

/// Enregistre (ou retire) le raccourci « couper le micro ». Un appui coupe ou
/// rétablit le micro tout de suite, puis prévient l'île ("controls.mic-muted").
fn apply_mic_hotkey(app: &AppHandle, wanted: &str) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let wanted = if MIC_HOTKEYS.contains(&wanted) { wanted } else { "" };
    let mut current = MIC_HOTKEY.locked();
    if *current == wanted {
        return;
    }
    let gs = app.global_shortcut();
    if !current.is_empty() {
        let _ = gs.unregister(current.as_str());
    }
    *current = wanted.to_string();
    if wanted.is_empty() {
        return;
    }
    let result = gs.on_shortcut(wanted, |app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        match toggle_mic() {
            Ok(muted) => bus::emit(app, ID, "controls.mic-muted", json!({ "muted": muted, "source": "hotkey" })),
            Err(e) => bus::emit(app, ID, "controls.mic-error", json!({ "message": e })),
        }
    });
    if let Err(e) = result {
        let text = e.to_string();
        let msg = if text.contains("already registered") {
            format!("{wanted} est déjà pris par un autre logiciel : choisissez un autre raccourci dans les réglages de Contrôles")
        } else {
            format!("le raccourci micro {wanted} est refusé : {text}")
        };
        log::warn(format!("contrôles : {msg}"));
        bus::emit(app, ID, "controls.mic-error", json!({ "message": msg }));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn mic_hotkeys_parse() {
        use tauri_plugin_global_shortcut::Shortcut;
        for k in super::MIC_HOTKEYS {
            assert!(k.parse::<Shortcut>().is_ok(), "{k}");
        }
    }
}
