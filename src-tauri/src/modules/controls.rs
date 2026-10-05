// Module « Contrôles » : le volume des haut-parleurs et du micro, et la
// luminosité des écrans, depuis l'île.
//
// Le front (src/modules/controls) affiche les curseurs et les boutons
// « couper », et les interrupteurs Wi-Fi / Bluetooth / mode avion. Ici on ne
// fait que transmettre à platform::audio, platform::brightness et
// platform::radios, en vérifiant les valeurs reçues. Rien n'est écrit
// dans le journal à chaque changement.

use serde_json::{json, Value};

use super::{ModuleContext, RustModule};
use crate::platform::audio::{self, Device};
use crate::platform::brightness;
use crate::platform::radios::{self, Kind};

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

    fn invoke(&self, _ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
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
