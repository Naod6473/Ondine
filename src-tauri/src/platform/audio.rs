// Le volume des haut-parleurs et du micro : ceux que Windows utilise « par
// défaut » (les mêmes que l'icône 🔊 de la barre des tâches).
//
// L'API s'appelle Core Audio : on demande à Windows le périphérique par défaut
// (sortie = haut-parleurs, entrée = micro), puis son « IAudioEndpointVolume »,
// qui sait lire et changer le niveau (0.0 à 1.0) et la coupure (muet).
//
// Rien n'est enregistré ni écouté : on ne touche qu'au réglage de volume.
// Sous Linux (vérifications), tout renvoie « pas de périphérique ».

use serde::Serialize;

/// Haut-parleurs (sortie) ou micro (entrée).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Device {
    Speakers,
    Microphone,
}

/// L'état d'un périphérique : niveau de 0 à 100, et coupé ou non.
#[derive(Debug, Clone, Serialize)]
pub struct Level {
    pub volume: u32,
    pub muted: bool,
}

#[cfg(windows)]
mod imp {
    use super::{Device, Level};
    use ::windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use ::windows::Win32::Media::Audio::{eCapture, eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    /// Le réglage de volume du périphérique par défaut. Il faut COM (voir `with_com`).
    fn endpoint(device: Device) -> Result<IAudioEndpointVolume, String> {
        let flow = match device {
            Device::Speakers => eRender,
            Device::Microphone => eCapture,
        };
        unsafe {
            let devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|_| "le service audio de Windows ne répond pas".to_string())?;
            // Pas de périphérique par défaut = rien de branché (ou tout désactivé).
            let dev = devices.GetDefaultAudioEndpoint(flow, eConsole).map_err(|_| match device {
                Device::Speakers => "aucune sortie audio".to_string(),
                Device::Microphone => "aucun micro".to_string(),
            })?;
            dev.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(|e| format!("réglage du volume indisponible ({e})"))
        }
    }

    pub fn get(device: Device) -> Result<Level, String> {
        crate::platform::with_com(|| {
            let ep = endpoint(device)?;
            unsafe {
                let volume = ep.GetMasterVolumeLevelScalar().map_err(|e| e.to_string())?;
                let muted = ep.GetMute().map_err(|e| e.to_string())?.as_bool();
                Ok(Level { volume: (volume * 100.0).round() as u32, muted })
            }
        })
    }

    pub fn set_volume(device: Device, percent: u32) -> Result<(), String> {
        crate::platform::with_com(|| {
            let ep = endpoint(device)?;
            let level = percent.min(100) as f32 / 100.0;
            // Le 2e paramètre (un identifiant « qui a changé le volume ») ne nous sert pas.
            unsafe { ep.SetMasterVolumeLevelScalar(level, std::ptr::null()) }.map_err(|e| e.to_string())
        })
    }

    pub fn set_muted(device: Device, muted: bool) -> Result<(), String> {
        crate::platform::with_com(|| {
            let ep = endpoint(device)?;
            unsafe { ep.SetMute(muted, std::ptr::null()) }.map_err(|e| e.to_string())
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Device, Level};

    pub fn get(_device: Device) -> Result<Level, String> {
        Err("pas de périphérique audio (hors Windows)".into())
    }
    pub fn set_volume(_device: Device, _percent: u32) -> Result<(), String> {
        Err("pas de périphérique audio (hors Windows)".into())
    }
    pub fn set_muted(_device: Device, _muted: bool) -> Result<(), String> {
        Err("pas de périphérique audio (hors Windows)".into())
    }
}

pub use imp::{get, set_muted, set_volume};
