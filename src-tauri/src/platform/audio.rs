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

/// Une sortie audio (casque, haut-parleurs, écran HDMI…).
#[derive(Debug, Clone, Serialize)]
pub struct Output {
    /// L'identifiant Windows du périphérique (opaque, sert seulement à le choisir).
    pub id: String,
    pub name: String,
    /// C'est la sortie par défaut en ce moment.
    pub default: bool,
}

/// L'état d'un périphérique : niveau de 0 à 100, et coupé ou non.
#[derive(Debug, Clone, Serialize)]
pub struct Level {
    pub volume: u32,
    pub muted: bool,
}

#[cfg(windows)]
#[allow(non_snake_case)] // les méthodes de IPolicyConfig gardent leur nom Windows
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

    // ── Choisir la sortie audio ──────────────────────────────────────────────
    //
    // Lister les sorties est une API documentée (IMMDeviceEnumerator). En
    // revanche, Windows ne donne AUCUNE API officielle pour changer la sortie
    // par défaut : tous les logiciels qui le font (EarTrumpet, SoundSwitch…)
    // passent par l'interface interne « IPolicyConfig » de Windows, décrite
    // ci-dessous. Elle marche de Windows 7 à 11, mais Microsoft pourrait la
    // changer : en cas d'échec, on le dit simplement, rien ne casse.

    use ::windows::core::{interface, IUnknown, IUnknown_Vtbl, GUID, HRESULT, HSTRING, PCWSTR};
    use ::windows::Win32::Foundation::PROPERTYKEY;
    use ::windows::Win32::Media::Audio::{eCommunications, eMultimedia, ERole, DEVICE_STATE_ACTIVE};
    use ::windows::Win32::System::Com::STGM_READ;
    use std::ffi::c_void;

    /// IPolicyConfig (non documentée). Seule la 11e méthode, SetDefaultEndpoint,
    /// sert ; les autres sont déclarées pour que l'ordre soit le bon.
    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, id: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        fn GetDeviceFormat(&self, id: PCWSTR, default: i32, format: *mut *mut c_void) -> HRESULT;
        fn ResetDeviceFormat(&self, id: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, id: PCWSTR, endpoint: *mut c_void, mix: *mut c_void) -> HRESULT;
        fn GetProcessingPeriod(&self, id: PCWSTR, default: i32, period: *mut i64, min: *mut i64) -> HRESULT;
        fn SetProcessingPeriod(&self, id: PCWSTR, period: *mut i64) -> HRESULT;
        fn GetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn SetShareMode(&self, id: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn GetPropertyValue(&self, id: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetPropertyValue(&self, id: PCWSTR, key: *const c_void, value: *mut c_void) -> HRESULT;
        fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
    }

    /// L'objet de Windows qui implémente IPolicyConfig (« PolicyConfigClient »).
    const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    /// PKEY_Device_FriendlyName : « Haut-parleurs (Realtek Audio) ».
    const FRIENDLY_NAME: PROPERTYKEY =
        PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };

    pub fn outputs() -> Result<Vec<super::Output>, String> {
        crate::platform::with_com(|| unsafe {
            let devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|_| "le service audio de Windows ne répond pas".to_string())?;
            let default_id = devices
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .and_then(|d| d.GetId())
                .map(|p| {
                    let s = p.to_string().unwrap_or_default();
                    ::windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const c_void));
                    s
                })
                .unwrap_or_default();
            let list = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for i in 0..list.GetCount().map_err(|e| e.to_string())? {
                let Ok(dev) = list.Item(i) else { continue };
                let Ok(raw_id) = dev.GetId() else { continue };
                let id = raw_id.to_string().unwrap_or_default();
                ::windows::Win32::System::Com::CoTaskMemFree(Some(raw_id.0 as *const c_void));
                let name = dev
                    .OpenPropertyStore(STGM_READ)
                    .and_then(|store| store.GetValue(&FRIENDLY_NAME))
                    .map(|v| v.to_string())
                    .unwrap_or_default();
                let name = if name.is_empty() { "Sortie audio".to_string() } else { name };
                out.push(super::Output { default: id == default_id, id, name });
            }
            Ok(out)
        })
    }

    pub fn set_default_output(id: &str) -> Result<(), String> {
        // On n'accepte qu'un identifiant de la liste actuelle : jamais une valeur inventée.
        if !outputs()?.iter().any(|o| o.id == id) {
            return Err("cette sortie audio n'existe plus".into());
        }
        crate::platform::with_com(|| unsafe {
            let policy: IPolicyConfig = CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
                .map_err(|_| "Windows refuse de changer la sortie audio d'ici (interface interne absente)".to_string())?;
            let id = HSTRING::from(id);
            // Les trois « rôles » : sons système, musique / vidéo, appels.
            for role in [eConsole, eMultimedia, eCommunications] {
                policy.SetDefaultEndpoint(PCWSTR(id.as_ptr()), role).ok().map_err(|e| format!("changement de sortie refusé ({e})"))?;
            }
            Ok(())
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
    pub fn outputs() -> Result<Vec<super::Output>, String> {
        Ok(Vec::new())
    }
    pub fn set_default_output(_id: &str) -> Result<(), String> {
        Err("pas de périphérique audio (hors Windows)".into())
    }
}

pub use imp::{get, outputs, set_default_output, set_muted, set_volume};
