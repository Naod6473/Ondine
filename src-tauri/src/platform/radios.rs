// Les radios du PC : Wi-Fi, Bluetooth, réseau mobile. Les mêmes interrupteurs
// que dans le centre de notifications de Windows (Win+A).
//
// L'API WinRT « Windows.Devices.Radios » liste les radios et les allume ou
// les éteint. Windows n'a PAS d'API publique pour le vrai « mode avion » :
// notre mode avion éteint toutes les radios, et les rallume ensuite (celles
// qui étaient allumées avant).
//
// À VÉRIFIER sur Windows : l'API est faite pour les applis du Store ; une
// appli classique comme l'île peut normalement s'en servir, mais Windows peut
// répondre « refusé » (DeniedBySystem). Dans ce cas, l'erreur le dit.
// Sous Linux (vérifications), aucune radio.

use serde::Serialize;

/// Une famille de radios, telle que le front la connaît.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Wifi,
    Bluetooth,
    Mobile,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "wifi" => Some(Kind::Wifi),
            "bluetooth" => Some(Kind::Bluetooth),
            "mobile" => Some(Kind::Mobile),
            _ => None,
        }
    }
}

/// L'état d'une famille : présente, allumée, ou bloquée (interrupteur
/// matériel, carte désactivée dans le Gestionnaire de périphériques).
#[derive(Debug, Clone, Serialize)]
pub struct RadioInfo {
    pub kind: Kind,
    pub on: bool,
    pub disabled: bool,
}

#[cfg(windows)]
mod imp {
    use super::{Kind, RadioInfo};
    use ::windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
    use std::sync::Mutex;

    /// Les familles allumées au moment où on a mis le mode avion, pour les
    /// rallumer à la sortie.
    static BEFORE_AIRPLANE: Mutex<Vec<Kind>> = Mutex::new(Vec::new());

    fn kind_of(radio: &Radio) -> Option<Kind> {
        match radio.Kind().ok()? {
            RadioKind::WiFi => Some(Kind::Wifi),
            RadioKind::Bluetooth => Some(Kind::Bluetooth),
            RadioKind::MobileBroadband => Some(Kind::Mobile),
            _ => None, // FM, autres : on ne les montre pas
        }
    }

    /// Toutes les radios connues de Windows (`.get()` attend la réponse).
    fn radios() -> Result<Vec<Radio>, String> {
        let list = Radio::GetRadiosAsync().and_then(|op| op.get()).map_err(|e| format!("Windows ne liste pas les radios ({e})"))?;
        let size = list.Size().unwrap_or(0);
        Ok((0..size).filter_map(|i| list.GetAt(i).ok()).collect())
    }

    /// Demande le droit de changer les radios (une fois suffit, Windows s'en souvient).
    fn ask_access() -> Result<(), String> {
        let status = Radio::RequestAccessAsync().and_then(|op| op.get()).map_err(|e| e.to_string())?;
        if status == RadioAccessStatus::Allowed {
            Ok(())
        } else {
            Err(denied(status))
        }
    }

    fn denied(status: RadioAccessStatus) -> String {
        match status {
            RadioAccessStatus::DeniedByUser => "Windows refuse : l'accès aux radios est coupé dans Paramètres > Confidentialité".into(),
            RadioAccessStatus::DeniedBySystem => "Windows refuse que l'île change les radios".into(),
            _ => "Windows n'a pas autorisé le changement".into(),
        }
    }

    pub fn list() -> Result<Vec<RadioInfo>, String> {
        let mut out: Vec<RadioInfo> = Vec::new();
        for radio in radios()? {
            let Some(kind) = kind_of(&radio) else { continue };
            let state = radio.State().unwrap_or(RadioState::Unknown);
            let on = state == RadioState::On;
            let disabled = state == RadioState::Disabled;
            // Plusieurs cartes de la même famille : allumée si l'une l'est.
            match out.iter_mut().find(|r| r.kind == kind) {
                Some(r) => {
                    r.on |= on;
                    r.disabled &= disabled;
                }
                None => out.push(RadioInfo { kind, on, disabled }),
            }
        }
        Ok(out)
    }

    pub fn set(kind: Kind, on: bool) -> Result<(), String> {
        ask_access()?;
        let target = if on { RadioState::On } else { RadioState::Off };
        let mut found = false;
        for radio in radios()? {
            if kind_of(&radio) != Some(kind) {
                continue;
            }
            found = true;
            let status = radio.SetStateAsync(target).and_then(|op| op.get()).map_err(|e| e.to_string())?;
            if status != RadioAccessStatus::Allowed {
                return Err(denied(status));
            }
        }
        if found {
            Ok(())
        } else {
            Err("aucune radio de ce type sur ce PC".into())
        }
    }

    /// Mode avion : tout éteindre (on retient ce qui était allumé), ou tout rallumer.
    pub fn set_airplane(on: bool) -> Result<(), String> {
        let mut before = BEFORE_AIRPLANE.lock().unwrap_or_else(|e| e.into_inner());
        if on {
            let current = list()?;
            *before = current.iter().filter(|r| r.on).map(|r| r.kind).collect();
            for r in current.iter().filter(|r| r.on) {
                set(r.kind, false)?;
            }
        } else {
            // Rien de retenu (l'île a redémarré) : on rallume le Wi-Fi et le Bluetooth.
            let kinds = if before.is_empty() { vec![Kind::Wifi, Kind::Bluetooth] } else { before.clone() };
            let present: Vec<Kind> = list()?.iter().map(|r| r.kind).collect();
            for kind in kinds.into_iter().filter(|k| present.contains(k)) {
                set(kind, true)?;
            }
            before.clear();
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Kind, RadioInfo};

    pub fn list() -> Result<Vec<RadioInfo>, String> {
        Ok(Vec::new())
    }
    pub fn set(_kind: Kind, _on: bool) -> Result<(), String> {
        Err("pas de radio (hors Windows)".into())
    }
    pub fn set_airplane(_on: bool) -> Result<(), String> {
        Err("pas de radio (hors Windows)".into())
    }
}

pub use imp::{list, set, set_airplane};
