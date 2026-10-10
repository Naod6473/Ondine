// Ce que les halos de l'île (module « Animations de l'île ») lisent du PC.
// Tout est lu, rien n'est écrit, enregistré ni envoyé.
//
// - `peak` : le niveau sonore instantané (0 à 1) du micro ou de la sortie
//   par défaut, par l'« indicateur de niveau » de Core Audio
//   (IAudioMeterInformation::GetPeakValue) : le même que les barres vertes des
//   Paramètres de son. On n'ouvre AUCUN flux audio : on ne reçoit jamais le son
//   lui-même, seulement un nombre, et seulement quand une appli s'en sert déjà
//   (sinon Windows répond 0).
// - `Meter` : le même indicateur, gardé ouvert pour être lu souvent (~100 fois
//   par seconde) : le tempo de la musique (modules/media_tempo.rs) pour la
//   danse de la mascotte. Toujours un seul nombre, jamais le son.
// - `wifi_quality` : la qualité du signal Wi-Fi (0 à 100), par l'API Native
//   Wifi. ATTENTION : depuis Windows 11 24H2, Windows ne la donne qu'aux applis
//   autorisées à utiliser la localisation (comme le nom du Wi-Fi, voir wifi.rs) ;
//   sinon None, et le halo « Wi-Fi faible » ne s'allume jamais.
// - `lock_keys` : Verr Maj et Verr Num allumés ou non (GetKeyState, bit bas).
// - `keys_down` : quelles touches sont enfoncées EN CE MOMENT parmi une courte
//   liste fixe (Ctrl, C, X, V, touches de volume), par GetAsyncKeyState. Aucun
//   crochet clavier, aucune autre touche n'est regardée, rien n'est retenu.

/// Haut-parleurs (ce qui joue) ou micro.
pub use super::audio::Device;

/// Les touches regardées (une liste fixe : rien d'autre n'est lu).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Keys {
    pub ctrl: bool,
    pub c: bool,
    pub x: bool,
    pub v: bool,
    pub vol_up: bool,
    pub vol_down: bool,
    pub mute: bool,
}

pub fn peak(device: Device) -> Option<f32> {
    imp::peak(device)
}

pub fn wifi_quality() -> Option<u8> {
    imp::wifi_quality()
}

/// L'indicateur de niveau gardé ouvert, à lire souvent depuis UN fil (il
/// n'en sort pas : COM est préparé pour ce fil). Il suit le périphérique par
/// défaut (relu toutes les 3 s : un casque branché entre-temps).
pub struct Meter(imp::Meter);

impl Meter {
    pub fn new(device: Device) -> Self {
        Meter(imp::Meter::new(device))
    }
    /// Le niveau (0 à 1), ou None si Windows ne le donne pas.
    pub fn read(&mut self) -> Option<f32> {
        self.0.read()
    }
}

/// (Verr Maj, Verr Num).
pub fn lock_keys() -> (bool, bool) {
    imp::lock_keys()
}

pub fn keys_down() -> Keys {
    imp::keys_down()
}

#[cfg(windows)]
mod imp {
    use super::{Device, Keys};
    use ::windows::Win32::Foundation::HANDLE;
    use ::windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use ::windows::Win32::Media::Audio::{eCapture, eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use ::windows::Win32::NetworkManagement::WiFi::{
        wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle,
        WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO, WLAN_INTERFACE_INFO_LIST,
    };
    use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetKeyState, VIRTUAL_KEY, VK_CAPITAL, VK_CONTROL, VK_NUMLOCK, VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
    };

    pub fn peak(device: Device) -> Option<f32> {
        let flow = match device {
            Device::Speakers => eRender,
            Device::Microphone => eCapture,
        };
        crate::platform::with_com(|| unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let dev = devices.GetDefaultAudioEndpoint(flow, eConsole).ok()?;
            let meter = dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None).ok()?;
            meter.GetPeakValue().ok().map(|v| v.clamp(0.0, 1.0))
        })
    }

    /// L'indicateur gardé ouvert (voir `super::Meter`).
    pub struct Meter {
        device: Device,
        meter: Option<IAudioMeterInformation>,
        since: std::time::Instant,
        /// COM préparé par nous (à défaire en partant).
        com: bool,
    }

    impl Meter {
        pub fn new(device: Device) -> Self {
            use ::windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
            Meter { device, meter: None, since: std::time::Instant::now(), com }
        }

        pub fn read(&mut self) -> Option<f32> {
            // Relu toutes les 3 s : le périphérique par défaut a pu changer.
            if self.meter.is_none() || self.since.elapsed() >= std::time::Duration::from_secs(3) {
                self.since = std::time::Instant::now();
                let flow = match self.device {
                    Device::Speakers => eRender,
                    Device::Microphone => eCapture,
                };
                self.meter = unsafe {
                    CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
                        .and_then(|devices| devices.GetDefaultAudioEndpoint(flow, eConsole))
                        .and_then(|dev| dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None))
                        .ok()
                };
            }
            let value = unsafe { self.meter.as_ref()?.GetPeakValue() };
            match value {
                Ok(v) => Some(v.clamp(0.0, 1.0)),
                Err(_) => {
                    self.meter = None;
                    None
                }
            }
        }
    }

    impl Drop for Meter {
        fn drop(&mut self) {
            self.meter = None;
            if self.com {
                unsafe { ::windows::Win32::System::Com::CoUninitialize() };
            }
        }
    }

    pub fn wifi_quality() -> Option<u8> {
        unsafe {
            let mut version = 0u32;
            let mut handle = HANDLE::default();
            if WlanOpenHandle(2, None, &mut version, &mut handle) != 0 {
                return None; // pas de service WLAN (PC sans Wi-Fi)
            }
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            let mut found = None;
            if WlanEnumInterfaces(handle, None, &mut list) == 0 && !list.is_null() {
                let count = (*list).dwNumberOfItems as usize;
                let first = std::ptr::addr_of!((*list).InterfaceInfo) as *const WLAN_INTERFACE_INFO;
                for i in 0..count {
                    let info = &*first.add(i);
                    if info.isState != wlan_interface_state_connected {
                        continue;
                    }
                    let mut size = 0u32;
                    let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
                    let rc = WlanQueryInterface(handle, &info.InterfaceGuid, wlan_intf_opcode_current_connection, None, &mut size, &mut data, None);
                    if rc != 0 || data.is_null() {
                        continue;
                    }
                    let attrs = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                    found = Some(attrs.wlanAssociationAttributes.wlanSignalQuality.min(100) as u8);
                    WlanFreeMemory(data);
                    break;
                }
            }
            if !list.is_null() {
                WlanFreeMemory(list as *const core::ffi::c_void);
            }
            WlanCloseHandle(handle, None);
            found
        }
    }

    pub fn lock_keys() -> (bool, bool) {
        unsafe { (GetKeyState(VK_CAPITAL.0 as i32) & 1 != 0, GetKeyState(VK_NUMLOCK.0 as i32) & 1 != 0) }
    }

    fn down(vk: VIRTUAL_KEY) -> bool {
        unsafe { (GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000) != 0 }
    }

    pub fn keys_down() -> Keys {
        Keys {
            ctrl: down(VK_CONTROL),
            c: down(VIRTUAL_KEY(b'C' as u16)),
            x: down(VIRTUAL_KEY(b'X' as u16)),
            v: down(VIRTUAL_KEY(b'V' as u16)),
            vol_up: down(VK_VOLUME_UP),
            vol_down: down(VK_VOLUME_DOWN),
            mute: down(VK_VOLUME_MUTE),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    //! Hors Windows (vérifications sur Linux) : rien à lire.
    use super::{Device, Keys};

    pub fn peak(_device: Device) -> Option<f32> {
        None
    }
    pub struct Meter;
    impl Meter {
        pub fn new(_device: Device) -> Self {
            Meter
        }
        pub fn read(&mut self) -> Option<f32> {
            None
        }
    }
    pub fn wifi_quality() -> Option<u8> {
        None
    }
    pub fn lock_keys() -> (bool, bool) {
        (false, false)
    }
    pub fn keys_down() -> Keys {
        Keys::default()
    }
}
