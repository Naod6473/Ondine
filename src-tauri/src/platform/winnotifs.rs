// Les notifications des autres applis (Centre de notifications de Windows),
// pour le module « Notifications de Windows » (modules/winnotifs.rs).
//
// API : `Windows.UI.Notifications.Management.UserNotificationListener`
// (Windows 10 1607 et plus). On la croyait réservée aux applis du Store
// (« identité de paquet ») ; d'autres îles pour Windows montrent qu'une appli
// ordinaire peut la lire, une fois que Windows le permet (Paramètres →
// Confidentialité → Notifications, « Autoriser les applications à accéder à
// vos notifications »). Technique reprise de windows-dynamic-island (Nazim
// Ferragh, MIT) et de PILLAR (warpirate, MIT), réécrite (THIRD-PARTY.md).
//
// Ce qui marche sans paquet : demander l'accès, lire la liste (relue à
// intervalle régulier par le module). Ce qui ne marche probablement pas :
// l'événement `NotificationChanged` (erreur 0x80070490 chez les autres
// projets), d'où la relecture. `RemoveNotification` : à vérifier sur le PC,
// le module le constate lui-même (une notification retirée qui revient à la
// lecture suivante = Windows refuse).
//
// On ne lit que le texte du modèle « ToastGeneric » (ce que montre la bulle),
// le nom de l'appli, son identifiant (AUMID, pour l'ouvrir) et son logo.
// Rien n'est gardé ici : le module garde ce qu'il faut, en mémoire.

/// Ce que Windows répond à « puis-je lire les notifications ? ».
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Access {
    Allowed,
    /// Refusé par la personne (ou par la case globale de Windows).
    Denied,
    /// Pas encore décidé (Windows n'a rien demandé).
    Unspecified,
}

/// Le contenu d'une notification, tel que Windows le donne.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Toast {
    pub id: u32,
    /// L'identifiant de l'appli (AUMID) : « Microsoft.Office.OUTLOOK.EXE.15 »…
    pub app_id: String,
    /// Son nom affiché (« Outlook »).
    pub app_name: String,
    /// Les lignes de texte du modèle ToastGeneric, dans l'ordre (titre d'abord).
    pub texts: Vec<String>,
}

#[cfg(windows)]
mod imp {
    use super::{Access, Toast};
    use ::windows::core::Interface;
    use ::windows::Foundation::Size;
    use ::windows::Storage::Streams::{DataReader, IInputStream};
    use ::windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus as Status};
    use ::windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

    /// Un logo d'appli fait quelques Ko ; au-delà, on s'en passe.
    const MAX_LOGO_BYTES: u64 = 48 * 1024;

    fn access_of(s: Status) -> Access {
        if s == Status::Allowed {
            Access::Allowed
        } else if s == Status::Denied {
            Access::Denied
        } else {
            Access::Unspecified
        }
    }

    /// Le lecteur de notifications de Windows.
    pub struct Listener(UserNotificationListener);

    /// Une notification de la liste : l'id tout de suite, le reste à la demande
    /// (on ne lit le texte que des nouvelles).
    pub struct Handle(UserNotification);

    /// Une demande d'accès lancée sur un autre fil (le fil de l'interface) :
    /// l'opération de Windows (agile, elle peut être attendue d'ailleurs).
    pub struct Pending(Box<dyn FnOnce() -> Result<Access, String> + Send>);

    impl Listener {
        /// None : l'API n'existe pas (Windows 10 trop ancien) ou ne répond pas.
        pub fn open() -> Result<Listener, String> {
            crate::platform::media::init_thread();
            UserNotificationListener::Current().map(Listener).map_err(|e| format!("lecteur de notifications absent : {e}"))
        }

        /// Demande l'accès (sans paquet, Windows n'affiche pas de fenêtre : il
        /// répond d'après le réglage de confidentialité). Erreur possible hors
        /// du fil de l'interface : le module réessaie alors par `start_request`.
        pub fn request_access(&self) -> Result<Access, String> {
            self.0
                .RequestAccessAsync()
                .and_then(|op| op.get())
                .map(access_of)
                .map_err(|e| format!("demande d'accès refusée : {e}"))
        }

        /// L'état de l'accès, sans rien demander (très léger).
        pub fn access(&self) -> Result<Access, String> {
            self.0.GetAccessStatus().map(access_of).map_err(|e| format!("accès illisible : {e}"))
        }

        /// Les notifications présentes dans le Centre de notifications (bulles seulement).
        pub fn list(&self) -> Result<Vec<Handle>, String> {
            let view = self
                .0
                .GetNotificationsAsync(NotificationKinds::Toast)
                .and_then(|op| op.get())
                .map_err(|e| format!("liste illisible : {e}"))?;
            let n = view.Size().unwrap_or(0);
            Ok((0..n).filter_map(|i| view.GetAt(i).ok()).map(Handle).collect())
        }
    }

    impl Handle {
        pub fn id(&self) -> Option<u32> {
            self.0.Id().ok()
        }

        /// Le contenu : appli et lignes de texte de ToastGeneric (vides si illisibles).
        pub fn read(&self) -> Toast {
            let id = self.0.Id().unwrap_or(0);
            let info = self.0.AppInfo().ok();
            let app_id = info.as_ref().and_then(|i| i.AppUserModelId().ok()).map(|h| h.to_string()).unwrap_or_default();
            let app_name = info
                .as_ref()
                .and_then(|i| i.DisplayInfo().ok())
                .and_then(|d| d.DisplayName().ok())
                .map(|h| h.to_string())
                .unwrap_or_default();
            let texts = (|| -> ::windows::core::Result<Vec<String>> {
                let visual = self.0.Notification()?.Visual()?;
                let binding = visual.GetBinding(&KnownNotificationBindings::ToastGeneric()?)?;
                let elems = binding.GetTextElements()?;
                let n = elems.Size()?;
                Ok((0..n).filter_map(|i| elems.GetAt(i).ok()).filter_map(|t| t.Text().ok()).map(|h| h.to_string()).collect())
            })()
            .unwrap_or_default();
            Toast { id, app_id, app_name, texts }
        }

        /// Le logo de l'appli (octets, type MIME), s'il est simple à obtenir.
        pub fn logo(&self) -> Option<(Vec<u8>, String)> {
            let read = || -> ::windows::core::Result<Option<(Vec<u8>, String)>> {
                let display = self.0.AppInfo()?.DisplayInfo()?;
                let reference = display.GetLogo(Size { Width: 32.0, Height: 32.0 })?;
                let stream = reference.OpenReadAsync()?.get()?;
                let size = stream.Size()?;
                if size == 0 || size > MAX_LOGO_BYTES {
                    return Ok(None);
                }
                let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
                let reader = DataReader::CreateDataReader(&stream.cast::<IInputStream>()?)?;
                let loaded = reader.LoadAsync(size as u32)?.get()?;
                let mut bytes = vec![0u8; loaded as usize];
                reader.ReadBytes(&mut bytes)?;
                Ok(Some((bytes, mime)))
            };
            read().ok().flatten()
        }
    }

    /// Lance la demande d'accès (à appeler sur le fil de l'interface).
    pub fn start_request() -> Result<Pending, String> {
        let op = UserNotificationListener::Current()
            .and_then(|l| l.RequestAccessAsync())
            .map_err(|e| format!("demande d'accès refusée : {e}"))?;
        Ok(Pending(Box::new(move || op.get().map(access_of).map_err(|e| format!("demande d'accès refusée : {e}")))))
    }

    impl Pending {
        /// Attend la réponse (sur un fil de fond).
        pub fn wait(self) -> Result<Access, String> {
            (self.0)()
        }
    }

    /// Retire une notification du Centre de notifications. Erreur : Windows refuse.
    pub fn remove(id: u32) -> Result<(), String> {
        crate::platform::media::init_thread();
        UserNotificationListener::Current()
            .and_then(|l| l.RemoveNotification(id))
            .map_err(|e| format!("retrait refusé : {e}"))
    }

    /// Ouvre l'appli d'une notification (comme un clic dans le Centre de
    /// notifications, sans la notification elle-même) : shell:AppsFolder\AUMID.
    pub fn open_app(app_id: &str) -> Result<(), String> {
        crate::platform::shell_open(&format!("shell:AppsFolder\\{app_id}"))
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Access, Toast};

    pub struct Listener;
    pub struct Handle;
    pub struct Pending;

    impl Listener {
        pub fn open() -> Result<Listener, String> {
            Err("disponible seulement sous Windows".into())
        }
        pub fn request_access(&self) -> Result<Access, String> {
            Ok(Access::Denied)
        }
        pub fn access(&self) -> Result<Access, String> {
            Ok(Access::Denied)
        }
        pub fn list(&self) -> Result<Vec<Handle>, String> {
            Ok(Vec::new())
        }
    }

    impl Handle {
        pub fn id(&self) -> Option<u32> {
            None
        }
        pub fn read(&self) -> Toast {
            Toast::default()
        }
        pub fn logo(&self) -> Option<(Vec<u8>, String)> {
            None
        }
    }

    pub fn start_request() -> Result<Pending, String> {
        Err("disponible seulement sous Windows".into())
    }

    impl Pending {
        pub fn wait(self) -> Result<Access, String> {
            Ok(Access::Denied)
        }
    }

    pub fn remove(_id: u32) -> Result<(), String> {
        Err("disponible seulement sous Windows".into())
    }

    pub fn open_app(_app_id: &str) -> Result<(), String> {
        Err("disponible seulement sous Windows".into())
    }
}

pub use imp::*;
