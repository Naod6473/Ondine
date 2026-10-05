// Module d'exemple « hello » : il prouve que tout le circuit fonctionne.
//
//   - commande "greet"      : le front appelle du Rust et reçoit une réponse ;
//   - commande "count"      : reçoit des chemins glissés sur l'île, ne lit RIEN,
//                             renvoie juste les noms (aucune permission requise) ;
//   - commande "bump"       : change un compteur et propose « Annuler » ;
//   - commande "crash"      : panique exprès, pour montrer que l'île survit ;
//   - écoute "hello.ping"   : répond "hello.pong" sur le bus.
//
// Le manifeste est le même fichier que celui du front (src/modules/hello/manifest.json).

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::{ModuleContext, RustModule};
use crate::services::bus::BusMessage;
use crate::services::undo::DEFAULT_WINDOW;

#[derive(Default)]
pub struct Hello {
    /// Partagé avec la fonction d'annulation, d'où l'Arc.
    counter: Arc<AtomicI64>,
}

impl RustModule for Hello {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/hello/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            "greet" => {
                // Le nom vient du front : on le limite, et on ne le met pas dans le journal.
                let name: String = args
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("toi")
                    .chars()
                    .take(40)
                    .collect();
                let message = format!("Bonjour, {name} ! Le Rust te répond.");
                ctx.emit("hello.greeted", json!({ "message": message }));
                ctx.log_info("salutation envoyée");
                Ok(json!({ "message": message }))
            }
            "count" => {
                let paths = args.get("paths").and_then(Value::as_array).cloned().unwrap_or_default();
                let names: Vec<String> = paths
                    .iter()
                    .filter_map(Value::as_str)
                    .filter_map(|p| std::path::Path::new(p).file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .collect();
                ctx.emit("task.finished", json!({ "label": format!("{} élément(s) reçu(s)", names.len()) }));
                Ok(json!({ "count": names.len(), "names": names }))
            }
            "bump" => {
                let value = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
                let counter = self.counter.clone();
                let id = ctx.offer_undo(
                    &format!("Compteur passé à {value}"),
                    DEFAULT_WINDOW,
                    Box::new(move || {
                        counter.fetch_sub(1, Ordering::Relaxed);
                        Ok(())
                    }),
                );
                Ok(json!({ "value": value, "undoId": id }))
            }
            "value" => Ok(json!({ "value": self.counter.load(Ordering::Relaxed) })),
            "crash" => panic!("plantage volontaire du module hello"),
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic == "hello.ping" {
            ctx.emit("hello.pong", json!({ "counter": self.counter.load(Ordering::Relaxed) }));
        }
    }
}
