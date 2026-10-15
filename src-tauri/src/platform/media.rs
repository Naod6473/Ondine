// « En cours de lecture » : ce que Windows affiche dans son propre panneau
// multimédia (touches de volume, Win+A). L'API s'appelle SMTC
// (System Media Transport Controls) ; Spotify, les navigateurs, VLC, le lecteur
// Windows… y publient le titre en cours.
//
// On ne fait que LIRE ce que Windows expose déjà, et envoyer lecture/pause,
// suivant, précédent, aléatoire, répétition, ou « aller à telle position » (si
// le lecteur l'accepte). Rien ne sort de l'ordinateur, rien n'est écrit dans le
// journal (un titre écouté est une donnée personnelle).
//
// Le volume (1.2.4) est celui DU LECTEUR seul, comme dans le mélangeur de
// volume de Windows : on retrouve la session audio du programme qui joue
// (Core Audio, `ISimpleAudioVolume`) à partir de l'identifiant que donne le
// SMTC (`SourceAppUserModelId`). Le volume du PC n'est jamais touché.
// Technique reprise et adaptée de Coucou (MIT, carte Spotify de Windows).
//
// Sous Linux (vérifications), tout renvoie « rien en lecture ».

use serde::Serialize;

/// L'état du lecteur que Windows considère comme « actuel ».
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// L'appli qui joue (ex. « Spotify.exe », ou un identifiant d'appli du Store).
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Le genre donné par le lecteur (« Rock », « Hip-Hop, Rap »…), souvent vide :
    /// beaucoup de lecteurs ne le remplissent pas. Sert au style de la danse de la mascotte.
    pub genre: String,
    /// "playing", "paused", "stopped" ou "changing".
    pub status: &'static str,
    /// Position et durée en millisecondes, si l'appli les donne.
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub can_toggle: bool,
    pub can_next: bool,
    pub can_previous: bool,
    /// Le lecteur accepte-t-il qu'on change la position (barre cliquable) ?
    pub can_seek: bool,
    /// Lecture aléatoire en cours (faux si le lecteur ne le dit pas).
    pub shuffle: bool,
    /// Répétition : "none", "track" (le morceau) ou "list" (la liste).
    pub repeat: &'static str,
    /// Le lecteur accepte-t-il qu'on change l'aléatoire, la répétition ?
    pub can_shuffle: bool,
    pub can_repeat: bool,
}

/// Le mode de répétition demandé par le front, vérifié.
pub fn parse_repeat(mode: &str) -> Option<&'static str> {
    match mode {
        "none" => Some("none"),
        "track" => Some("track"),
        "list" => Some("list"),
        _ => None,
    }
}

/// Le volume d'un lecteur : 0 à 100, et coupé ou non.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PlayerVolume {
    pub volume: u32,
    pub muted: bool,
}

/// Le dernier morceau d'un chemin (« C:\\…\\Spotify.exe » → « spotify.exe »), en minuscules.
#[cfg_attr(not(windows), allow(dead_code))]
fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).trim().to_lowercase()
}

/// Les navigateurs qui se déclarent au SMTC sous un nom qui n'est pas celui de
/// leur programme : Edge (« MSEdge »), Chrome (« Chrome »), Firefox (un code
/// de 16 chiffres hexadécimaux, tiré de son dossier d'installation)…
#[cfg_attr(not(windows), allow(dead_code))]
fn alias_exe(id: &str) -> Option<&'static str> {
    let id = id.to_lowercase();
    match id.as_str() {
        "msedge" => Some("msedge.exe"),
        "chrome" => Some("chrome.exe"),
        "brave" => Some("brave.exe"),
        "opera" => Some("opera.exe"),
        "vivaldi" => Some("vivaldi.exe"),
        "firefox" => Some("firefox.exe"),
        _ if id.len() == 16 && id.chars().all(|c| c.is_ascii_hexdigit()) => Some("firefox.exe"),
        _ => None,
    }
}

/// Le programme `exe_path` (chemin complet) est-il le lecteur `app_id`
/// (l'identifiant donné par le SMTC) ? Trois cas :
/// - « Spotify.exe » (programme classique) : même nom de fichier ;
/// - un alias de navigateur (voir `alias_exe`) ;
/// - une appli du Store, « Paquet_éditeur!Appli » : le programme vit dans
///   « …\\WindowsApps\\Paquet_version_archi__éditeur\\ ».
///
/// En dernier recours, le même nom sans « .exe » (« Spotify » ↔ spotify.exe).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn player_matches(app_id: &str, exe_path: &str) -> bool {
    let id = app_id.trim();
    if id.is_empty() || exe_path.trim().is_empty() {
        return false;
    }
    let exe = file_name(exe_path);
    if let Some((family, _)) = id.split_once('!') {
        let Some((name, publisher)) = family.rsplit_once('_') else { return false };
        let (name, publisher) = (name.to_lowercase(), publisher.to_lowercase());
        let path = exe_path.to_lowercase();
        return path.contains("\\windowsapps\\")
            && path.split(['\\', '/']).any(|dir| dir.starts_with(&format!("{name}_")) && dir.ends_with(&format!("__{publisher}")));
    }
    let wanted = file_name(id);
    if wanted.ends_with(".exe") {
        return exe == wanted;
    }
    if let Some(alias) = alias_exe(&wanted) {
        return exe == alias;
    }
    exe.strip_suffix(".exe").is_some_and(|stem| stem == wanted)
}

/// Repli quand le programme d'une session audio est illisible : l'identifiant
/// de la session (« …|\\Device\\…\\Spotify.exe%b{…} » ou
/// « …|Paquet_éditeur!Appli%b… ») contient-il celui du lecteur ?
#[cfg_attr(not(windows), allow(dead_code))]
pub fn session_matches(app_id: &str, session_id: &str) -> bool {
    let id = app_id.trim().to_lowercase();
    if id.len() < 3 {
        return false;
    }
    let session = session_id.to_lowercase();
    if id.ends_with(".exe") {
        let name = file_name(&id);
        return session.contains(&format!("\\{name}%")) || session.contains(&format!("\\{name}|"));
    }
    id.contains('!') && session.contains(&format!("|{id}%"))
}

/// Un identifiant d'appli du Store qu'on peut passer à « shell:AppsFolder\\… »
/// sans risque (lettres, chiffres, « . », « _ », « - » et un seul « ! »).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn launchable_aumid(app_id: &str) -> bool {
    let parts: Vec<&str> = app_id.split('!').collect();
    parts.len() == 2
        && parts.iter().all(|p| !p.is_empty())
        && app_id.len() <= 200
        && app_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '!'))
}

/// Les commandes qu'on peut envoyer au lecteur.
// (Sous Linux, `control` ne lit pas la position de Seek : pas d'avertissement pour ça.)
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
pub enum Control {
    TogglePlayPause,
    /// Mettre en pause (rien ne repart si c'était déjà en pause).
    Pause,
    Next,
    Previous,
    /// Aller à cette position, en millisecondes depuis le début du morceau.
    Seek(u64),
    /// Lecture aléatoire oui / non.
    Shuffle(bool),
    /// Répétition : "none", "track" ou "list" (voir `parse_repeat`).
    Repeat(&'static str),
}

#[cfg(windows)]
pub use self::win::*;

#[cfg(not(windows))]
pub use self::stub::*;

#[cfg(windows)]
mod win {
    use super::{Control, NowPlaying};
    use windows::core::Interface;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Media::MediaPlaybackAutoRepeatMode as RepeatMode;
    use windows::Storage::Streams::{DataReader, IInputStream};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    /// Le gestionnaire des lecteurs de Windows.
    pub type Manager = GlobalSystemMediaTransportControlsSessionManager;

    /// Au-delà, on ignore la pochette (une image d'album fait quelques centaines de Ko).
    const MAX_ARTWORK_BYTES: u64 = 4 * 1024 * 1024;

    /// Les API « WinRT » demandent que le thread soit initialisé une fois. Appeler
    /// plusieurs fois ne pose pas de problème ; un thread déjà initialisé
    /// autrement (STA) renvoie une erreur qu'on peut ignorer : les appels marchent.
    pub fn init_thread() {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
    }

    /// Le gestionnaire des lecteurs. `.get()` attend la fin de l'appel asynchrone
    /// (on est toujours sur un thread secondaire, jamais sur le thread de l'interface).
    pub fn manager() -> Result<Manager, String> {
        init_thread();
        Manager::RequestAsync()
            .and_then(|op| op.get())
            .map_err(|e| format!("SMTC indisponible : {e}"))
    }

    /// Le lecteur actuel, s'il y en a un.
    fn session(manager: &Manager) -> Option<Session> {
        manager.GetCurrentSession().ok()
    }

    /// Ce qui joue en ce moment (None si aucun lecteur).
    pub fn now_playing(manager: &Manager) -> Result<Option<NowPlaying>, String> {
        let Some(session) = session(manager) else { return Ok(None) };
        let text = |r: windows::core::Result<windows::core::HSTRING>| r.map(|h| h.to_string()).unwrap_or_default();

        let props = session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.get())
            .map_err(|e| format!("titre illisible : {e}"))?;
        let info = session.GetPlaybackInfo().map_err(|e| format!("état illisible : {e}"))?;
        let controls = info.Controls().ok();
        let can = |f: &dyn Fn(&windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackControls) -> windows::core::Result<bool>| {
            controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false)
        };

        let status = match info.PlaybackStatus().unwrap_or(Status::Closed) {
            Status::Playing => "playing",
            Status::Paused => "paused",
            Status::Changing => "changing",
            _ => "stopped",
        };

        // La position donnée par Windows date de « LastUpdatedTime » : si ça joue,
        // on ajoute le temps écoulé depuis.
        let (mut position_ms, mut duration_ms) = (None, None);
        if let Ok(t) = session.GetTimelineProperties() {
            let ms = |ticks: i64| (ticks.max(0) / 10_000) as u64; // 1 tick = 100 ns
            let start = t.StartTime().map(|d| d.Duration).unwrap_or(0);
            let end = t.EndTime().map(|d| d.Duration).unwrap_or(0);
            if end > start {
                duration_ms = Some(ms(end - start));
                let mut pos = ms(t.Position().map(|d| d.Duration).unwrap_or(0) - start);
                if status == "playing" {
                    if let Ok(updated) = t.LastUpdatedTime() {
                        pos += elapsed_since_ms(updated.UniversalTime);
                    }
                }
                position_ms = Some(pos.min(ms(end - start)));
            }
        }

        Ok(Some(NowPlaying {
            app: text(session.SourceAppUserModelId()),
            title: text(props.Title()),
            artist: text(props.Artist()),
            album: text(props.AlbumTitle()),
            genre: genres(&props),
            status,
            position_ms,
            duration_ms,
            can_toggle: can(&|c| c.IsPlayPauseToggleEnabled()),
            can_next: can(&|c| c.IsNextEnabled()),
            can_previous: can(&|c| c.IsPreviousEnabled()),
            can_seek: can(&|c| c.IsPlaybackPositionEnabled()) && duration_ms.is_some(),
            // Un lecteur qui ne donne pas ces états (IReference vide) : « non ».
            shuffle: info.IsShuffleActive().and_then(|r| r.Value()).unwrap_or(false),
            repeat: match info.AutoRepeatMode().and_then(|r| r.Value()) {
                Ok(RepeatMode::Track) => "track",
                Ok(RepeatMode::List) => "list",
                _ => "none",
            },
            can_shuffle: can(&|c| c.IsShuffleEnabled()),
            can_repeat: can(&|c| c.IsRepeatEnabled()),
        }))
    }

    /// Les genres du morceau (trois au plus), séparés par des virgules ; vide si le lecteur n'en donne pas.
    fn genres(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> String {
        let Ok(list) = props.Genres() else { return String::new() };
        let n = list.Size().unwrap_or(0).min(3);
        (0..n)
            .filter_map(|i| list.GetAt(i).ok())
            .map(|h| h.to_string().trim().to_string())
            .filter(|g| !g.is_empty())
            .collect::<Vec<_>>()
            .join(", ")
    }

    /// Millisecondes écoulées depuis une date Windows (ticks de 100 ns depuis 1601).
    fn elapsed_since_ms(universal_time: i64) -> u64 {
        const UNIX_EPOCH_IN_TICKS: i64 = 116_444_736_000_000_000;
        let then_ms = (universal_time - UNIX_EPOCH_IN_TICKS) / 10_000;
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(then_ms);
        // Si l'horloge est bizarre (date dans le futur, ou très ancienne), on n'ajoute rien.
        let elapsed = now_ms - then_ms;
        if (0..6 * 60 * 60 * 1000).contains(&elapsed) {
            elapsed as u64
        } else {
            0
        }
    }

    /// La pochette du titre en cours : (octets de l'image, type MIME).
    pub fn artwork(manager: &Manager) -> Result<Option<(Vec<u8>, String)>, String> {
        let Some(session) = session(manager) else { return Ok(None) };
        let props = session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.get())
            .map_err(|e| format!("titre illisible : {e}"))?;
        // Pas de pochette : ce n'est pas une erreur.
        let Ok(reference) = props.Thumbnail() else { return Ok(None) };
        let read = || -> windows::core::Result<Option<(Vec<u8>, String)>> {
            let stream = reference.OpenReadAsync()?.get()?;
            let size = stream.Size()?;
            if size == 0 || size > MAX_ARTWORK_BYTES {
                return Ok(None);
            }
            let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
            let reader = DataReader::CreateDataReader(&stream.cast::<IInputStream>()?)?;
            let loaded = reader.LoadAsync(size as u32)?.get()?;
            let mut bytes = vec![0u8; loaded as usize];
            reader.ReadBytes(&mut bytes)?;
            Ok(Some((bytes, mime)))
        };
        read().map_err(|e| format!("pochette illisible : {e}"))
    }

    /// Envoie lecture/pause, pause, suivant ou précédent au lecteur actuel.
    pub fn control(action: Control) -> Result<(), String> {
        let manager = manager()?;
        let session = session(&manager).ok_or("aucun lecteur en cours")?;
        let op = match action {
            Control::TogglePlayPause => session.TryTogglePlayPauseAsync(),
            Control::Pause => session.TryPauseAsync(),
            Control::Next => session.TrySkipNextAsync(),
            Control::Previous => session.TrySkipPreviousAsync(),
            Control::Seek(ms) => {
                // Windows compte en « ticks » de 100 ns, à partir du début de la
                // chronologie du lecteur (StartTime, presque toujours 0).
                let start = session
                    .GetTimelineProperties()
                    .and_then(|t| t.StartTime())
                    .map(|d| d.Duration)
                    .unwrap_or(0);
                session.TryChangePlaybackPositionAsync(start + ms as i64 * 10_000)
            }
            Control::Shuffle(on) => session.TryChangeShuffleActiveAsync(on),
            Control::Repeat(mode) => session.TryChangeAutoRepeatModeAsync(match mode {
                "track" => RepeatMode::Track,
                "list" => RepeatMode::List,
                _ => RepeatMode::None,
            }),
        };
        match op.and_then(|op| op.get()) {
            Ok(true) => Ok(()),
            Ok(false) => Err("le lecteur a refusé la commande".into()),
            Err(e) => Err(format!("commande impossible : {e}")),
        }
    }

    // ── Le volume du lecteur (mélangeur de volume de Windows) ────────────────

    /// Le chemin complet du programme `pid`, ou None (programme protégé, fermé…).
    fn process_path(pid: u32) -> Option<String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            named.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// Les sessions audio du lecteur `app_id`, sur toutes les sorties actives
    /// (le lecteur peut jouer ailleurs que sur la sortie par défaut).
    fn player_sessions(app_id: &str) -> Vec<windows::Win32::Media::Audio::ISimpleAudioVolume> {
        use windows::Win32::Media::Audio::{
            eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        };
        use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
        init_thread();
        let mut out = Vec::new();
        // Un même programme revient souvent (plusieurs sessions) : on ne le lit qu'une fois.
        let mut seen: std::collections::HashMap<u32, bool> = std::collections::HashMap::new();
        unsafe {
            let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return out };
            let Ok(list) = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return out };
            for d in 0..list.GetCount().unwrap_or(0) {
                let Ok(device) = list.Item(d) else { continue };
                let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
                let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
                for i in 0..sessions.GetCount().unwrap_or(0) {
                    let Ok(control) = sessions.GetSession(i) else { continue };
                    let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
                    let pid = control.GetProcessId().unwrap_or(0);
                    if pid == 0 {
                        continue; // les sons du système
                    }
                    let by_process = *seen.entry(pid).or_insert_with(|| process_path(pid).is_some_and(|p| super::player_matches(app_id, &p)));
                    // Repli : le programme est illisible, mais l'identifiant de la session le nomme.
                    let matched = by_process
                        || control
                            .GetSessionInstanceIdentifier()
                            .ok()
                            .map(|w| {
                                let text = w.to_string().unwrap_or_default();
                                windows::Win32::System::Com::CoTaskMemFree(Some(w.0 as *const _));
                                text
                            })
                            .is_some_and(|id| super::session_matches(app_id, &id));
                    if matched {
                        if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                            out.push(volume);
                        }
                    }
                }
            }
        }
        out
    }

    /// Le volume du lecteur, ou None s'il n'a pas (encore) de session audio.
    pub fn player_volume(app_id: &str) -> Result<Option<super::PlayerVolume>, String> {
        let sessions = player_sessions(app_id);
        let Some(first) = sessions.first() else { return Ok(None) };
        unsafe {
            let level = first.GetMasterVolume().map_err(|e| format!("volume illisible : {e}"))?;
            let muted = first.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            Ok(Some(super::PlayerVolume { volume: (level * 100.0).round().clamp(0.0, 100.0) as u32, muted }))
        }
    }

    /// Change le volume (0 à 100) et/ou la coupure de toutes les sessions du lecteur.
    pub fn set_player_volume(app_id: &str, volume: Option<u32>, muted: Option<bool>) -> Result<Option<super::PlayerVolume>, String> {
        let sessions = player_sessions(app_id);
        if sessions.is_empty() {
            return Err("ce lecteur n'a pas de son à régler pour l'instant".into());
        }
        for s in &sessions {
            unsafe {
                if let Some(v) = volume {
                    s.SetMasterVolume(v.min(100) as f32 / 100.0, std::ptr::null()).map_err(|e| format!("volume refusé : {e}"))?;
                }
                if let Some(m) = muted {
                    s.SetMute(m, std::ptr::null()).map_err(|e| format!("coupure refusée : {e}"))?;
                }
            }
        }
        player_volume(app_id)
    }

    // ── Ouvrir le lecteur (clic sur la pochette) ─────────────────────────────

    /// Fait passer devant la fenêtre du lecteur `app_id` ; une appli du Store
    /// sans fenêtre trouvée est lancée par son identifiant (elle se montre).
    pub fn open_player(app_id: &str) -> Result<(), String> {
        use windows::core::BOOL;
        use windows::Win32::Foundation::{HWND, LPARAM};
        use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
        };

        // Les fenêtres principales visibles (avec un titre, sans propriétaire) et leur programme.
        unsafe extern "system" fn collect(h: HWND, lparam: LPARAM) -> BOOL {
            let list = unsafe { &mut *(lparam.0 as *mut Vec<(isize, u32)>) };
            unsafe {
                if IsWindowVisible(h).as_bool() && GetWindowTextLengthW(h) > 0 && GetWindow(h, GW_OWNER).is_err() {
                    let mut pid = 0u32;
                    GetWindowThreadProcessId(h, Some(&mut pid));
                    list.push((h.0 as isize, pid));
                }
            }
            BOOL(1)
        }
        let mut windows_list: Vec<(isize, u32)> = Vec::new();
        let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut windows_list as *mut _ as isize)) };
        let mut paths: std::collections::HashMap<u32, bool> = std::collections::HashMap::new();
        // EnumWindows va du premier plan vers l'arrière : la première trouvée est la plus récente.
        let target = windows_list
            .into_iter()
            .find(|(_, pid)| *paths.entry(*pid).or_insert_with(|| process_path(*pid).is_some_and(|p| super::player_matches(app_id, &p))))
            .map(|(h, _)| HWND(h as *mut _));

        let Some(target) = target else {
            if super::launchable_aumid(app_id) {
                std::process::Command::new("explorer.exe")
                    .arg(format!("shell:AppsFolder\\{app_id}"))
                    .spawn()
                    .map_err(|e| format!("lecteur impossible à ouvrir : {e}"))?;
                return Ok(());
            }
            return Err("la fenêtre du lecteur est introuvable".into());
        };
        unsafe {
            if IsIconic(target).as_bool() {
                let _ = ShowWindow(target, SW_RESTORE);
            }
            // Windows ne laisse passer une fenêtre devant qu'après une action au
            // clavier : une pression sur Alt, seule, lève ce verrou.
            let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
            };
            SendInput(&[key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)], std::mem::size_of::<INPUT>() as i32);
            if !SetForegroundWindow(target).as_bool() {
                return Err("Windows a refusé de passer au lecteur".into());
            }
        }
        // L'île, en se refermant, ne doit pas reprendre la main.
        crate::platform::forget_previous_foreground();
        Ok(())
    }
}

#[cfg(not(windows))]
mod stub {
    use super::{Control, NowPlaying};

    /// Rien à gérer hors de Windows.
    pub struct Manager;

    pub fn init_thread() {}

    pub fn manager() -> Result<Manager, String> {
        Ok(Manager)
    }

    pub fn now_playing(_: &Manager) -> Result<Option<NowPlaying>, String> {
        Ok(None)
    }

    pub fn artwork(_: &Manager) -> Result<Option<(Vec<u8>, String)>, String> {
        Ok(None)
    }

    pub fn control(_: Control) -> Result<(), String> {
        Err("disponible seulement sous Windows".into())
    }

    pub fn player_volume(_: &str) -> Result<Option<super::PlayerVolume>, String> {
        Ok(None)
    }

    pub fn set_player_volume(_: &str, _: Option<u32>, _: Option<bool>) -> Result<Option<super::PlayerVolume>, String> {
        Err("disponible seulement sous Windows".into())
    }

    pub fn open_player(_: &str) -> Result<(), String> {
        Err("disponible seulement sous Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classic_programs_match_by_file_name() {
        assert!(player_matches("Spotify.exe", r"C:\Users\a\AppData\Roaming\Spotify\Spotify.exe"));
        assert!(player_matches("vlc.exe", r"C:\Program Files\VideoLAN\VLC\VLC.EXE"));
        assert!(!player_matches("Spotify.exe", r"C:\Windows\explorer.exe"));
        assert!(!player_matches("", r"C:\x\spotify.exe"));
        assert!(!player_matches("Spotify.exe", ""));
        // « Spotify » sans .exe : repli sur le même nom.
        assert!(player_matches("Spotify", r"C:\x\Spotify.exe"));
    }

    #[test]
    fn browsers_match_by_alias() {
        assert!(player_matches("MSEdge", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"));
        assert!(player_matches("Chrome", r"C:\Program Files\Google\Chrome\Application\chrome.exe"));
        assert!(player_matches("308046B0AF4A39CB", r"C:\Program Files\Mozilla Firefox\firefox.exe"));
        assert!(!player_matches("MSEdge", r"C:\x\chrome.exe"));
    }

    #[test]
    fn store_apps_match_by_package_folder() {
        let id = "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify";
        assert!(player_matches(id, r"C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_1.220.0.0_x64__zpdnekdrzrea0\Spotify.exe"));
        assert!(!player_matches(id, r"C:\Users\a\AppData\Roaming\Spotify\Spotify.exe"));
        assert!(!player_matches(id, r"C:\Program Files\WindowsApps\Other.App_1.0_x64__zpdnekdrzrea0\Spotify.exe"));
        let media = "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic";
        assert!(player_matches(media, r"C:\Program Files\WindowsApps\Microsoft.ZuneMusic_11.2408.12.0_x64__8wekyb3d8bbwe\Microsoft.Media.Player.exe"));
        // Pas de « _éditeur » : rien ne correspond.
        assert!(!player_matches("Bizarre!App", r"C:\Program Files\WindowsApps\Bizarre_1\a.exe"));
    }

    #[test]
    fn audio_sessions_fall_back_on_their_identifier() {
        let session = r"{0.0.0.00000000}.{abc}|\Device\HarddiskVolume3\Users\a\AppData\Roaming\Spotify\Spotify.exe%b{00000000-0000-0000-0000-000000000000}|1%b4242";
        assert!(session_matches("Spotify.exe", session));
        assert!(!session_matches("chrome.exe", session));
        assert!(!session_matches("ab", session));
        let store = "{0.0.0.00000000}.{abc}|SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify%b{00000000}|1%b9";
        assert!(session_matches("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", store));
        // Un alias de navigateur ne se cherche pas dans l'identifiant (trop vague).
        assert!(!session_matches("MSEdge", r"x|\Device\y\msedge.exe%b{0}"));
    }

    #[test]
    fn only_clean_store_ids_are_launched() {
        assert!(launchable_aumid("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"));
        assert!(!launchable_aumid("Spotify.exe"));
        assert!(!launchable_aumid("a!b!c"));
        assert!(!launchable_aumid("a!b & calc"));
        assert!(!launchable_aumid("!b"));
    }

    #[test]
    fn repeat_modes_are_checked() {
        assert_eq!(parse_repeat("list"), Some("list"));
        assert_eq!(parse_repeat("track"), Some("track"));
        assert_eq!(parse_repeat("none"), Some("none"));
        assert_eq!(parse_repeat("all"), None);
    }
}
