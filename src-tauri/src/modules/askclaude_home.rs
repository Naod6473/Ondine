// « Parler à Ondine » et Home Assistant (module homeassistant.rs) :
//
//   1. Assist d'abord (`assist`) : une phrase dite ou tapée qui ressemble à
//      un ordre pour la maison part à Assist de Home Assistant (local, sans
//      IA) si le module est activé et son réglage « Assist d'abord » aussi.
//      Assist s'en est chargé : sa réponse est montrée, l'IA n'est pas
//      appelée. Sinon la phrase continue vers l'IA comme d'habitude ;
//   2. l'outil `maison` (réglage « L'IA peut commander vos favoris » du
//      module Home Assistant, coupé par défaut) : l'IA reçoit la liste des
//      favoris (noms, pièces, identifiants) dans sa consigne et peut appeler
//      un service autorisé sur l'un d'eux. Un appareil sensible s'arrête sur
//      une carte « Faire / Annuler » (askclaude.rs, `Action::Home`).
//
// Tout passe par les commandes du module Home Assistant (`modules::invoke`,
// qui vérifie qu'il est activé) : ce fichier ne parle jamais au réseau.

use serde_json::{json, Value};

use super::askclaude_providers::{Call, Tool};
use super::homeassistant::{favorites_of, ID};
use super::ModuleContext;
use crate::sync::LockExt;
use tauri::Manager;

pub const TOOL: &str = "maison";

/// Les services que l'IA peut demander (les mêmes noms que Home Assistant).
const SERVICES: &[&str] = &[
    "turn_on", "turn_off", "toggle", "open_cover", "close_cover", "stop_cover", "set_cover_position", "set_temperature", "media_play_pause", "media_next_track",
    "media_previous_track", "volume_set", "lock", "unlock", "alarm_arm_home", "alarm_arm_away", "alarm_disarm", "etat",
];

/// Une action sur la maison qui attend votre clic (confirmation du module).
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    pub id: u64,
    pub label: String,
}

pub enum Step {
    Done(Value, Option<Value>),
    Ask(Order),
}

fn values(ctx: &ModuleContext) -> serde_json::Map<String, Value> {
    let shared = ctx.app.state::<crate::Shared>();
    let s = shared.settings.locked();
    s.modules.get(ID).map(|m| m.values.clone()).unwrap_or_default()
}

/// L'outil est-il proposé ? Module activé ET réglage « aiTool » allumé.
pub fn offered(ctx: &ModuleContext) -> bool {
    super::is_active(ctx.app, ID) && values(ctx).get("aiTool").and_then(Value::as_bool) == Some(true) && !favorites_of(&values(ctx)).is_empty()
}

pub fn tool() -> Tool {
    Tool {
        name: TOOL,
        description: "Commande un appareil favori de la maison de la personne (Home Assistant) : lumière, prise, volet, scène, script, thermostat, lecteur. Utiliser un identifiant de la liste des favoris. « etat » lit l'état sans rien changer. Les serrures, l'alarme, le garage et les portails demandent l'accord de la personne.",
        schema: json!({
            "type": "object",
            "properties": {
                "entite": { "type": "string", "description": "L'identifiant du favori, par exemple light.salon." },
                "service": { "type": "string", "enum": SERVICES },
                "valeur": { "type": "number", "description": "Luminosité ou position en %, consigne en °C, volume en %. Facultative." }
            },
            "required": ["entite", "service"]
        }),
    }
}

/// La consigne en plus : la liste des favoris (sans leur état).
pub fn hint(ctx: &ModuleContext, english: bool) -> Option<String> {
    if !offered(ctx) {
        return None;
    }
    let lines: Vec<String> = favorites_of(&values(ctx))
        .iter()
        .map(|f| {
            let name = f.name.clone().unwrap_or_else(|| f.id.clone());
            match &f.area {
                Some(a) => format!("- {name} ({a}) : {}", f.id),
                None => format!("- {name} : {}", f.id),
            }
        })
        .collect();
    let head = if english {
        "You can control the person's home devices (Home Assistant) with the `maison` tool, only when they ask. Their favourite devices:"
    } else {
        "Vous pouvez commander les appareils de la maison de la personne (Home Assistant) avec l'outil `maison`, seulement quand elle le demande. Ses appareils favoris :"
    };
    Some(format!("{head}\n{}", lines.join("\n")))
}

/// Un appel de l'outil `maison` : fait (lumière, volet…), ou à confirmer (sensible).
pub fn plan(ctx: &ModuleContext, call: &Call) -> Step {
    let entity = call.args.get("entite").and_then(Value::as_str).unwrap_or("");
    let service = call.args.get("service").and_then(Value::as_str).unwrap_or("");
    let mut args = json!({ "entity": entity, "service": service });
    if let Some(v) = call.args.get("valeur").and_then(Value::as_f64) {
        args["value"] = json!(v);
    }
    match super::invoke(ctx.app, ID, "ai_call", args) {
        Ok(v) if v.get("confirm").is_some() => Step::Ask(Order { id: v["confirm"]["id"].as_u64().unwrap_or(0), label: v["confirm"]["label"].as_str().unwrap_or("").to_string() }),
        Ok(v) if v.get("state").is_some() && service == "etat" => Step::Done(v, None),
        Ok(v) => {
            let label = v["label"].as_str().unwrap_or("").to_string();
            Step::Done(json!({ "ok": true, "etat": v["state"]["state"] }), Some(json!({ "kind": "did", "what": "home", "value": label })))
        }
        Err(e) => Step::Done(json!({ "erreur": e }), None),
    }
}

/// La personne a cliqué « Faire » : le module fait l'action confirmée.
pub fn perform(ctx: &ModuleContext, order: &Order) -> Result<(Value, Value), String> {
    if !offered(ctx) {
        return Err("l'IA ne peut plus commander la maison (réglage coupé)".into());
    }
    let v = super::invoke(ctx.app, ID, "confirm_call", json!({ "id": order.id }))?;
    Ok((json!({ "ok": true, "etat": v["state"]["state"] }), json!({ "kind": "did", "what": "home", "value": order.label })))
}

/// Refusé : la confirmation en attente est oubliée.
pub fn cancel(ctx: &ModuleContext, order: &Order) {
    let _ = super::invoke(ctx.app, ID, "cancel_call", json!({ "id": order.id }));
}

/// Assist d'abord : `Some(réponse)` si Home Assistant s'en est chargé.
pub fn assist(ctx: &ModuleContext, text: &str) -> Option<String> {
    if !super::is_active(ctx.app, ID) {
        return None;
    }
    let v = super::invoke(ctx.app, ID, "assist", json!({ "text": text })).ok()?;
    (v["handled"] == true).then(|| v["answer"].as_str().unwrap_or("").to_string()).filter(|a| !a.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tool_is_well_formed() {
        let t = tool();
        assert_eq!(t.name, "maison");
        assert_eq!(t.schema["type"], "object");
        assert_eq!(t.schema["required"], json!(["entite", "service"]));
        // Jamais un service qui redémarre ou supprime quoi que ce soit.
        assert!(!SERVICES.iter().any(|s| s.contains("restart") || s.contains("delete") || s.contains("reload")));
        // Chaque service proposé existe dans un domaine (sauf « etat », une lecture).
        for s in SERVICES.iter().filter(|s| **s != "etat") {
            assert!(super::super::homeassistant_logic::DOMAINS.iter().any(|d| super::super::homeassistant_logic::services(d).contains(s)), "{s}");
        }
    }
}
