// Le volume de chaque application (comme le « Mélangeur de volume » de
// Windows) : Chrome plus bas, Spotify plus fort, Teams coupé…
//
// L'API s'appelle Core Audio : chaque sortie audio a un « gestionnaire de
// sessions » (IAudioSessionManager2) ; chaque appli qui fait du son y a une
// ou plusieurs sessions, avec leur volume (ISimpleAudioVolume, 0.0 à 1.0, en
// plus du volume général) et leur niveau instantané (IAudioMeterInformation,
// un seul nombre : jamais le son lui-même).
//
// On regarde toutes les sorties actives (une appli peut jouer sur le casque
// pendant que le reste sort sur les haut-parleurs), et on regroupe les
// sessions par programme : une appli = une ligne, même si elle a trois
// sessions (Chrome en ouvre une par onglet qui joue).
//
// Rien n'est écrit ailleurs que dans le volume de l'appli, rien n'est envoyé,
// et les noms d'applis ne vont pas dans le journal.
// Sous Linux (vérifications), la liste est vide.

use serde::Serialize;

/// Une appli qui a du son (ou peut en avoir) en ce moment.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppVolume {
    /// « pid:1234 », ou « system » pour les sons de Windows. Sert seulement à la choisir.
    pub key: String,
    /// « Chrome », « Spotify », « Sons système ».
    pub name: String,
    /// 0 à 100 (relatif au volume général, comme dans Windows).
    pub volume: u32,
    pub muted: bool,
    /// Elle joue en ce moment (sinon : session ouverte mais silencieuse).
    pub active: bool,
    /// Le niveau instantané (0 à 1), pour la petite barre qui bouge.
    pub peak: f32,
}

/// Les noms courts d'exécutables connus → leur nom lisible.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
const KNOWN: &[(&str, &str)] = &[
    ("msedge", "Edge"),
    ("msedgewebview2", "Edge WebView"),
    ("chrome", "Chrome"),
    ("firefox", "Firefox"),
    ("brave", "Brave"),
    ("opera", "Opera"),
    ("vivaldi", "Vivaldi"),
    ("spotify", "Spotify"),
    ("vlc", "VLC"),
    ("discord", "Discord"),
    ("ms-teams", "Teams"),
    ("teams", "Teams"),
    ("zoom", "Zoom"),
    ("slack", "Slack"),
    ("whatsapp", "WhatsApp"),
    ("ondine", "Ondine"),
    ("explorer", "Explorateur"),
    ("applemusic", "Apple Music"),
    ("itunes", "iTunes"),
    ("deezer", "Deezer"),
    ("steam", "Steam"),
    ("obs64", "OBS"),
];

/// Le nom à montrer : le nom que l'appli donne à sa session s'il est lisible
/// (pas une référence « @%SystemRoot%\… »), sinon celui de son exécutable
/// (« C:\…\spotify.exe » → « Spotify »).
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn pretty_name(display: &str, exe_path: Option<&str>) -> String {
    let display = display.trim();
    if !display.is_empty() && !display.starts_with('@') {
        return display.to_string();
    }
    let Some(path) = exe_path else { return "Application".to_string() };
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = file.rsplit_once('.').map(|(s, ext)| if ext.eq_ignore_ascii_case("exe") { s } else { file }).unwrap_or(file);
    if stem.is_empty() {
        return "Application".to_string();
    }
    let lower = stem.to_lowercase();
    if let Some((_, nice)) = KNOWN.iter().find(|(k, _)| *k == lower) {
        return (*nice).to_string();
    }
    // Première lettre en majuscule : « audacity » → « Audacity ».
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => "Application".to_string(),
    }
}

/// Les applis rangées : celles qui jouent d'abord, puis par nom ; les sons
/// de Windows toujours à la fin.
#[cfg_attr(not(windows), allow(dead_code))] // utilisé seulement sous Windows (et les tests)
pub fn sort_apps(list: &mut [AppVolume]) {
    list.sort_by(|a, b| {
        (a.key == "system")
            .cmp(&(b.key == "system"))
            .then(b.active.cmp(&a.active))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// « pid:1234 » → 1234 ; « system » → 0 ; autre chose → None.
pub fn parse_key(key: &str) -> Option<u32> {
    if key == "system" {
        return Some(0);
    }
    key.strip_prefix("pid:")?.parse::<u32>().ok().filter(|p| *p != 0)
}

#[cfg(windows)]
mod imp {
    use super::{pretty_name, sort_apps, AppVolume};
    use ::windows::core::Interface;
    use ::windows::Win32::Foundation::CloseHandle;
    use ::windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use ::windows::Win32::Media::Audio::{
        eRender, AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
        MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use ::windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
    use ::windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use std::collections::HashMap;

    /// Une session audio ouverte, avec ce qu'il faut pour la lire et la régler.
    struct Session {
        pid: u32,
        system: bool,
        display: String,
        active: bool,
        volume: ISimpleAudioVolume,
        meter: Option<IAudioMeterInformation>,
    }

    /// Le chemin complet du programme `pid`, ou None (programme protégé, fermé…).
    fn process_path(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, ::windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            named.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// Toutes les sessions encore vivantes, sur toutes les sorties actives.
    fn sessions() -> Vec<Session> {
        let mut out = Vec::new();
        unsafe {
            let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return out };
            let Ok(list) = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return out };
            for d in 0..list.GetCount().unwrap_or(0) {
                let Ok(device) = list.Item(d) else { continue };
                let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
                let Ok(all) = manager.GetSessionEnumerator() else { continue };
                for i in 0..all.GetCount().unwrap_or(0) {
                    let Ok(control) = all.GetSession(i) else { continue };
                    let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
                    let state = control.GetState().unwrap_or(AudioSessionStateExpired);
                    if state == AudioSessionStateExpired {
                        continue; // l'appli est partie
                    }
                    let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };
                    let display = control
                        .GetDisplayName()
                        .map(|w| {
                            let text = w.to_string().unwrap_or_default();
                            CoTaskMemFree(Some(w.0 as *const _));
                            text
                        })
                        .unwrap_or_default();
                    out.push(Session {
                        pid: control.GetProcessId().unwrap_or(0),
                        // S_OK (0) = c'est la session des sons de Windows ; S_FALSE (1) = non.
                        system: control.IsSystemSoundsSession() == ::windows::Win32::Foundation::S_OK,
                        display,
                        active: state == AudioSessionStateActive,
                        meter: control.cast::<IAudioMeterInformation>().ok(),
                        volume,
                    });
                }
            }
        }
        out
    }

    fn key_of(s: &Session) -> String {
        if s.system || s.pid == 0 {
            "system".to_string()
        } else {
            format!("pid:{}", s.pid)
        }
    }

    pub fn list() -> Vec<AppVolume> {
        crate::platform::with_com(|| {
            let mut by_key: HashMap<String, AppVolume> = HashMap::new();
            let mut paths: HashMap<u32, Option<String>> = HashMap::new();
            for s in sessions() {
                let key = key_of(&s);
                let (volume, muted, peak) = unsafe {
                    (
                        s.volume.GetMasterVolume().unwrap_or(1.0),
                        s.volume.GetMute().map(|b| b.as_bool()).unwrap_or(false),
                        s.meter.as_ref().and_then(|m| m.GetPeakValue().ok()).unwrap_or(0.0),
                    )
                };
                let volume = (volume * 100.0).round().clamp(0.0, 100.0) as u32;
                let peak = peak.clamp(0.0, 1.0);
                match by_key.get_mut(&key) {
                    // Une autre session de la même appli : elle compte si elle joue.
                    Some(app) => {
                        app.active |= s.active;
                        app.peak = app.peak.max(peak);
                        if s.active {
                            app.volume = volume;
                            app.muted = muted;
                        }
                    }
                    None => {
                        let name = if key == "system" {
                            "Sons système".to_string()
                        } else {
                            let path = paths.entry(s.pid).or_insert_with(|| process_path(s.pid));
                            pretty_name(&s.display, path.as_deref())
                        };
                        by_key.insert(key.clone(), AppVolume { key, name, volume, muted, active: s.active, peak });
                    }
                }
            }
            let mut list: Vec<AppVolume> = by_key.into_values().collect();
            sort_apps(&mut list);
            list
        })
    }

    pub fn set(key: &str, volume: Option<u32>, muted: Option<bool>) -> Result<(), String> {
        crate::platform::with_com(|| {
            let mine: Vec<Session> = sessions().into_iter().filter(|s| key_of(s) == key).collect();
            if mine.is_empty() {
                return Err("cette appli n'a plus de son à régler".to_string());
            }
            for s in &mine {
                unsafe {
                    if let Some(v) = volume {
                        s.volume.SetMasterVolume(v.min(100) as f32 / 100.0, std::ptr::null()).map_err(|e| format!("volume refusé : {e}"))?;
                    }
                    if let Some(m) = muted {
                        s.volume.SetMute(m, std::ptr::null()).map_err(|e| format!("coupure refusée : {e}"))?;
                    }
                }
            }
            Ok(())
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::AppVolume;

    pub fn list() -> Vec<AppVolume> {
        Vec::new()
    }
    pub fn set(_key: &str, _volume: Option<u32>, _muted: Option<bool>) -> Result<(), String> {
        Err("pas de son à régler (hors Windows)".into())
    }
}

/// Les applis qui ont une session audio, rangées.
pub fn list() -> Vec<AppVolume> {
    imp::list()
}

/// Change le volume (0 à 100) et/ou la coupure d'une appli (`key` de la liste).
pub fn set(key: &str, volume: Option<u32>, muted: Option<bool>) -> Result<(), String> {
    if parse_key(key).is_none() {
        return Err("appli inconnue".into());
    }
    imp::set(key, volume, muted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(key: &str, name: &str, active: bool) -> AppVolume {
        AppVolume { key: key.into(), name: name.into(), volume: 50, muted: false, active, peak: 0.0 }
    }

    #[test]
    fn names_read_well() {
        assert_eq!(pretty_name("", Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe")), "Chrome");
        assert_eq!(pretty_name("", Some(r"C:\Users\x\AppData\Roaming\Spotify\Spotify.exe")), "Spotify");
        assert_eq!(pretty_name("", Some(r"C:\Tools\audacity.exe")), "Audacity");
        assert_eq!(pretty_name("@%SystemRoot%\\System32\\AudioSrv.Dll,-202", Some(r"C:\x\ms-teams.exe")), "Teams");
        assert_eq!(pretty_name("Lecteur Windows Media", Some(r"C:\x\wmplayer.exe")), "Lecteur Windows Media");
        assert_eq!(pretty_name("", None), "Application");
        assert_eq!(pretty_name("  ", Some("")), "Application");
    }

    #[test]
    fn playing_apps_first_system_last() {
        let mut list = vec![app("system", "Sons système", true), app("pid:3", "Zoom", false), app("pid:2", "spotify", true), app("pid:1", "Chrome", false)];
        sort_apps(&mut list);
        let names: Vec<&str> = list.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["spotify", "Chrome", "Zoom", "Sons système"]);
    }

    #[test]
    fn keys_are_checked() {
        assert_eq!(parse_key("pid:1234"), Some(1234));
        assert_eq!(parse_key("system"), Some(0));
        assert_eq!(parse_key("pid:0"), None);
        assert_eq!(parse_key("pid:abc"), None);
        assert_eq!(parse_key("1234"), None);
        assert!(set("n'importe quoi", Some(10), None).is_err());
    }
}
