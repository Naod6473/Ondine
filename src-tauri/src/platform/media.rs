// « En cours de lecture » : ce que Windows affiche dans son propre panneau
// multimédia (touches de volume, Win+A). L'API s'appelle SMTC
// (System Media Transport Controls) ; Spotify, les navigateurs, VLC, le lecteur
// Windows… y publient le titre en cours.
//
// On ne fait que LIRE ce que Windows expose déjà, et envoyer lecture/pause,
// suivant, précédent, ou « aller à telle position » (si le lecteur l'accepte). Rien ne sort de l'ordinateur, rien n'est écrit dans le
// journal (un titre écouté est une donnée personnelle).
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
}

/// Les commandes qu'on peut envoyer au lecteur.
#[derive(Debug, Clone, Copy)]
pub enum Control {
    TogglePlayPause,
    Next,
    Previous,
    /// Aller à cette position, en millisecondes depuis le début du morceau.
    Seek(u64),
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
            status,
            position_ms,
            duration_ms,
            can_toggle: can(&|c| c.IsPlayPauseToggleEnabled()),
            can_next: can(&|c| c.IsNextEnabled()),
            can_previous: can(&|c| c.IsPreviousEnabled()),
            can_seek: can(&|c| c.IsPlaybackPositionEnabled()) && duration_ms.is_some(),
        }))
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

    /// Envoie lecture/pause, suivant ou précédent au lecteur actuel.
    pub fn control(action: Control) -> Result<(), String> {
        let manager = manager()?;
        let session = session(&manager).ok_or("aucun lecteur en cours")?;
        let op = match action {
            Control::TogglePlayPause => session.TryTogglePlayPauseAsync(),
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
        };
        match op.and_then(|op| op.get()) {
            Ok(true) => Ok(()),
            Ok(false) => Err("le lecteur a refusé la commande".into()),
            Err(e) => Err(format!("commande impossible : {e}")),
        }
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
}
