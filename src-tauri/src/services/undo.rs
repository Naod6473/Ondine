// Le service d'annulation.
//
// Règle de l'île : toute action destructive ou qui déplace des fichiers passe par
// ici. Le module fait l'action, puis enregistre « comment la défaire ». L'île
// affiche alors « Annuler » pendant quelques secondes. Passé ce délai, l'action
// devient définitive (et on oublie comment la défaire).
//
// Rappel : jamais de suppression définitive. Supprimer = envoyer à la Corbeille
// (voir services/files.rs).

use crate::sync::LockExt;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::AppHandle;

use crate::services::{bus, log};

/// Délai par défaut pendant lequel « Annuler » reste proposé.
pub const DEFAULT_WINDOW: Duration = Duration::from_secs(8);

/// La fonction qui défait l'action. Elle ne sera appelée qu'une fois au plus.
pub type UndoFn = Box<dyn FnOnce() -> Result<(), String> + Send>;

struct Pending {
    label: String,
    module: String,
    expires: Instant,
    undo: UndoFn,
}

#[derive(Default)]
pub struct UndoService {
    next_id: Mutex<u64>,
    pending: Mutex<HashMap<u64, Pending>>,
}

impl UndoService {
    /// Enregistre une action annulable et prévient l'île (sujet "undo.offered").
    pub fn offer(&self, app: &AppHandle, module: &str, label: &str, window: Duration, undo: UndoFn) -> u64 {
        self.forget_expired(app);
        let id = {
            let mut next = self.next_id.locked();
            *next += 1;
            *next
        };
        self.pending.locked().insert(
            id,
            Pending { label: label.into(), module: module.into(), expires: Instant::now() + window, undo },
        );
        bus::emit(
            app,
            module,
            "undo.offered",
            json!({ "id": id, "label": label, "expiresInMs": window.as_millis() as u64 }),
        );
        // Un petit minuteur oublie l'action à l'échéance, même si personne ne clique.
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(window + Duration::from_millis(50));
            use tauri::Manager;
            if let Some(service) = handle.try_state::<UndoService>() {
                service.forget_expired(&handle);
            }
        });
        id
    }

    /// Défait l'action `id` si elle est encore dans son délai.
    pub fn run(&self, app: &AppHandle, id: u64) -> Result<String, String> {
        let pending = self.pending.locked().remove(&id);
        let Some(p) = pending else {
            return Err("trop tard : l'action n'est plus annulable".into());
        };
        if Instant::now() > p.expires {
            return Err("trop tard : l'action n'est plus annulable".into());
        }
        // Une fonction d'annulation qui panique ne doit pas faire tomber l'île.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(p.undo))
            .unwrap_or_else(|_| Err("l'annulation a planté".into()));
        match &result {
            Ok(()) => {
                log::info(format!("annulé : {} ({})", p.label, p.module));
                bus::emit(app, &p.module, "undo.done", json!({ "id": id, "label": p.label }));
            }
            Err(e) => log::warn(format!("annulation impossible : {} ({}) : {e}", p.label, p.module)),
        }
        result.map(|_| p.label)
    }

    fn forget_expired(&self, app: &AppHandle) {
        let now = Instant::now();
        // On retire d'abord les actions expirées, PUIS on prévient le bus, verrou
        // relâché : un module qui réagit à "undo.expired" peut ainsi rappeler `offer`.
        let expired: Vec<u64> = {
            let mut pending = self.pending.locked();
            let ids: Vec<u64> = pending.iter().filter(|(_, p)| p.expires <= now).map(|(id, _)| *id).collect();
            for id in &ids {
                pending.remove(id);
            }
            ids
        };
        for id in expired {
            bus::emit(app, "island", "undo.expired", json!({ "id": id }));
        }
    }
}
