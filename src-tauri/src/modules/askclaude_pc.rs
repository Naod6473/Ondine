// « Parler à Ondine » : ses outils pour le PC et les onglets de l'île,
// proposés à l'IA quand le réglage « Ondine peut agir sur le PC » est activé
// (les outils de fichiers sont dans askclaude_tools.rs).
//
//   - regarder (fait tout de suite, le résultat part vers l'IA) : l'état du
//     PC, l'agenda, la météo, la musique en cours, le son et l'écran, les
//     notes qui correspondent à une recherche ;
//   - agir, tout de suite (vous l'avez demandé, et tout se défait d'un
//     clic) : volume, son coupé, luminosité, mode sombre, musique, minuteur,
//     note, expression de la mascotte ;
//   - agir APRÈS votre accord (askclaude.rs, `pending`) : ouvrir une
//     application ou un site, poser un fichier sur l'Étagère, allumer ou
//     couper le Wi-Fi ou le Bluetooth (couper le Wi-Fi coupe aussi Ondine).
//
// Jamais : supprimer, lancer une commande, ouvrir le terminal. Chaque action
// passe par la commande du module concerné (`modules::invoke`, qui vérifie
// qu'il est activé) ou par son sujet du bus, comme le ferait son onglet.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::agents_mcp_extra::web_url;
use super::askclaude_providers::{Call, Tool};
use super::askclaude_tools::Found;
use super::ModuleContext;
use crate::services::search;

/// Ce qu'un outil renvoie à l'IA au plus (un état du PC peut être long).
const MAX_RESULT_CHARS: usize = 6000;
const MAX_NOTE_CHARS: usize = 2000;
const MAX_TIMER_MIN: u64 = 180;

/// Une action à faire après votre accord : ce qui est montré, et ce qui sera fait.
#[derive(Clone, Debug, PartialEq)]
pub struct Act {
    /// Le genre d'action (le front en fait une phrase) et sa précision.
    pub what: &'static str,
    pub value: String,
    op: Op,
}

#[derive(Clone, Debug, PartialEq)]
enum Op {
    App(u64),
    Site(String),
    Shelf(PathBuf),
    Radio(&'static str, bool),
}

/// Un appel d'outil du PC : fait (résultat pour l'IA, ligne d'activité
/// éventuelle) ou à faire après votre accord.
pub enum Step {
    Done(Value, Option<Value>),
    Ask(Act),
}

fn tool(name: &'static str, description: &'static str, schema: Value) -> Tool {
    Tool { name, description, schema }
}

fn none() -> Value {
    json!({ "type": "object", "properties": {} })
}

fn one(key: &str, kind: &str, description: &str) -> Value {
    json!({ "type": "object", "properties": { key: { "type": kind, "description": description } }, "required": [key] })
}

/// Les outils, tels que l'IA les voit.
pub fn tools() -> Vec<Tool> {
    vec![
        tool("etat_pc", "L'état du PC : processeur, mémoire, disques, batterie, réseau, temps depuis le démarrage.", none()),
        tool("agenda", "Les prochains rendez-vous de l'agenda de la personne.", none()),
        tool("meteo", "La météo actuelle là où se trouve la personne.", none()),
        tool("musique_en_cours", "Le morceau en cours de lecture (titre, artiste, lecture ou pause).", none()),
        tool("etat_son_ecran", "Le volume, le micro, la luminosité des écrans, le mode sombre, le Wi-Fi et le Bluetooth.", none()),
        tool("chercher_notes", "Cherche dans les notes et les tâches de la personne (onglet Notes).", one("requete", "string", "Quelques mots à chercher.")),
        tool("regler_volume", "Règle le volume des haut-parleurs.", one("niveau", "integer", "De 0 à 100.")),
        tool("couper_son", "Coupe ou rétablit le son.", one("coupe", "boolean", "true pour couper, false pour rétablir.")),
        tool("regler_luminosite", "Règle la luminosité de tous les écrans.", one("niveau", "integer", "De 0 à 100.")),
        tool("mode_sombre", "Passe Windows en mode sombre ou en mode clair.", one("actif", "boolean", "true pour le mode sombre.")),
        tool(
            "controler_musique",
            "Met la musique en lecture ou en pause, ou passe au morceau suivant ou précédent.",
            json!({ "type": "object", "properties": { "action": { "type": "string", "enum": ["lecture_pause", "suivant", "precedent"] } }, "required": ["action"] }),
        ),
        tool("lancer_minuteur", "Lance un minuteur dans l'île.", one("minutes", "integer", "De 1 à 180.")),
        tool("creer_note", "Ajoute une note dans l'onglet Notes.", one("texte", "string", "Le texte de la note (2000 caractères au plus).")),
        tool(
            "jouer_expression",
            "Fait jouer une expression à la mascotte d'Ondine.",
            json!({ "type": "object", "properties": { "expression": { "type": "string", "enum": ["happy", "laugh", "wink", "thinking", "surprise", "proud", "love", "shy", "sad"] } }, "required": ["expression"] }),
        ),
        tool("ouvrir_application", "Ouvre une application du menu Démarrer ou un outil de Windows, par son nom. La personne doit accepter.", one("nom", "string", "Le nom de l'application, par exemple « Calculatrice » ou « Spotify ».")),
        tool("ouvrir_site", "Ouvre une adresse web (http ou https) dans le navigateur. La personne doit accepter.", one("adresse", "string", "L'adresse complète, par exemple https://www.meteo.fr.")),
        tool("poser_sur_etagere", "Pose sur l'Étagère de l'île un fichier trouvé par chercher_fichiers. La personne doit accepter.", one("numero", "integer", "Le numéro du fichier.")),
        tool(
            "regler_radio",
            "Allume ou coupe le Wi-Fi ou le Bluetooth. La personne doit accepter. Couper le Wi-Fi peut couper la conversation.",
            json!({ "type": "object", "properties": { "radio": { "type": "string", "enum": ["wifi", "bluetooth"] }, "actif": { "type": "boolean" } }, "required": ["radio", "actif"] }),
        ),
    ]
}

/// Vrai si `name` est un outil d'ici.
pub fn owns(name: &str) -> bool {
    tools().iter().any(|t| t.name == name)
}

/// Le résultat d'une commande de module, raccourci pour l'IA.
fn short(v: Value) -> Value {
    let text = v.to_string();
    if text.chars().count() <= MAX_RESULT_CHARS {
        return v;
    }
    json!({ "extrait": text.chars().take(MAX_RESULT_CHARS).collect::<String>(), "coupe": true })
}

fn level(call: &Call) -> Result<u64, String> {
    match call.args.get("niveau").and_then(Value::as_u64) {
        Some(n) if n <= 100 => Ok(n),
        _ => Err("niveau de 0 à 100".into()),
    }
}

fn flag(call: &Call, key: &str) -> Result<bool, String> {
    call.args.get(key).and_then(Value::as_bool).ok_or(format!("« {key} » doit valoir true ou false"))
}

fn did(what: &str, value: impl Into<String>) -> Option<Value> {
    Some(json!({ "kind": "did", "what": what, "value": value.into() }))
}

/// Traite un appel d'outil du PC. `found` : les fichiers déjà numérotés.
pub fn plan(ctx: &ModuleContext, call: &Call, found: &Found) -> Step {
    match run(ctx, call, found) {
        Ok(step) => step,
        Err(e) => Step::Done(json!({ "erreur": e }), None),
    }
}

fn invoke(ctx: &ModuleContext, module: &str, command: &str, args: Value) -> Result<Value, String> {
    super::invoke(ctx.app, module, command, args)
}

fn run(ctx: &ModuleContext, call: &Call, found: &Found) -> Result<Step, String> {
    let ok = || json!({ "ok": true });
    Ok(match call.name.as_str() {
        // ── Regarder ──
        "etat_pc" => Step::Done(short(invoke(ctx, "system", "snapshot", json!({}))?), None),
        "agenda" => Step::Done(short(invoke(ctx, "agenda", "upcoming", json!({}))?), None),
        "meteo" => Step::Done(short(invoke(ctx, "weather", "current", json!({}))?), None),
        "musique_en_cours" => {
            let mut v = invoke(ctx, "media", "state", json!({}))?;
            // La pochette (une image) ne sert à rien à l'IA.
            if let Some(o) = v.as_object_mut() {
                o.remove("artwork");
            }
            Step::Done(short(v), None)
        }
        "etat_son_ecran" => {
            let mut v = serde_json::Map::new();
            for (key, command) in [("son", "state"), ("ecrans", "screens"), ("theme", "theme"), ("radios", "radios")] {
                v.insert(key.into(), invoke(ctx, "controls", command, json!({})).unwrap_or_else(|e| json!({ "erreur": e })));
            }
            Step::Done(short(Value::Object(v)), None)
        }
        "chercher_notes" => {
            let query = call.args.get("requete").and_then(Value::as_str).unwrap_or("");
            Step::Done(short(invoke(ctx, "notes", "search", json!({ "query": query, "limit": 8 }))?), None)
        }
        // ── Agir tout de suite ──
        "regler_volume" => {
            let n = level(call)?;
            invoke(ctx, "controls", "set_volume", json!({ "device": "speakers", "volume": n }))?;
            Step::Done(ok(), did("volume", n.to_string()))
        }
        "couper_son" => {
            let muted = flag(call, "coupe")?;
            invoke(ctx, "controls", "set_muted", json!({ "device": "speakers", "muted": muted }))?;
            Step::Done(ok(), did(if muted { "mute" } else { "unmute" }, ""))
        }
        "regler_luminosite" => {
            let n = level(call)?;
            let screens = invoke(ctx, "controls", "screens", json!({}))?;
            let ids: Vec<String> = screens.as_array().into_iter().flatten().filter_map(|s| s["id"].as_str().map(str::to_string)).collect();
            if ids.is_empty() {
                return Err("aucun écran réglable trouvé".into());
            }
            for id in &ids {
                invoke(ctx, "controls", "set_brightness", json!({ "id": id, "brightness": n }))?;
            }
            Step::Done(ok(), did("brightness", n.to_string()))
        }
        "mode_sombre" => {
            let on = flag(call, "actif")?;
            invoke(ctx, "controls", "set_dark", json!({ "on": on }))?;
            Step::Done(ok(), did(if on { "dark" } else { "light" }, ""))
        }
        "controler_musique" => {
            let (command, what) = match call.args.get("action").and_then(Value::as_str) {
                Some("suivant") => ("next", "next"),
                Some("precedent") => ("previous", "previous"),
                Some("lecture_pause") => ("toggle", "playpause"),
                _ => return Err("action : lecture_pause, suivant ou precedent".into()),
            };
            invoke(ctx, "media", command, json!({}))?;
            Step::Done(ok(), did(what, ""))
        }
        "lancer_minuteur" => {
            let minutes = call.args.get("minutes").and_then(Value::as_u64).filter(|m| (1..=MAX_TIMER_MIN).contains(m)).ok_or("minutes de 1 à 180")?;
            if !super::is_active(ctx.app, "timer") {
                return Err("le module Minuteur est désactivé".into());
            }
            ctx.emit("timer.start", json!({ "minutes": minutes }));
            Step::Done(ok(), did("timer", minutes.to_string()))
        }
        "creer_note" => {
            let text = call.args.get("texte").and_then(Value::as_str).unwrap_or("").trim();
            if text.is_empty() || text.chars().count() > MAX_NOTE_CHARS {
                return Err("il faut un texte de 1 à 2000 caractères".into());
            }
            if !super::is_active(ctx.app, "notes") {
                return Err("le module Notes est désactivé".into());
            }
            ctx.emit("notes.add", json!({ "text": text }));
            Step::Done(ok(), did("note", text.chars().take(40).collect::<String>()))
        }
        "jouer_expression" => {
            let e = call.args.get("expression").and_then(Value::as_str).unwrap_or("");
            const MOODS: &[&str] = &["happy", "laugh", "wink", "thinking", "surprise", "proud", "love", "shy", "sad"];
            if !MOODS.contains(&e) {
                return Err("expression inconnue".into());
            }
            ctx.emit("mascot.emote", json!({ "emotion": e }));
            Step::Done(ok(), None)
        }
        // ── Agir après votre accord ──
        "ouvrir_application" => {
            let name = call.args.get("nom").and_then(Value::as_str).unwrap_or("");
            let (id, label) = find_app(ctx, name)?;
            Step::Ask(Act { what: "app", value: label, op: Op::App(id) })
        }
        "ouvrir_site" => {
            let url = web_url(call.args.get("adresse").and_then(Value::as_str).unwrap_or("")).ok_or("adresse refusée : http:// ou https:// seulement")?;
            Step::Ask(Act { what: "site", value: url.clone(), op: Op::Site(url) })
        }
        "poser_sur_etagere" => {
            let numero = call.args.get("numero").and_then(Value::as_u64).unwrap_or(0);
            let path = found.get(numero).cloned().ok_or(format!("pas de fichier n° {numero} : cherchez-le d'abord"))?;
            let path = ctx.check_path(&path.display().to_string())?;
            if !path.is_file() {
                return Err("seul un fichier peut aller sur l'Étagère".into());
            }
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            Step::Ask(Act { what: "shelf", value: name, op: Op::Shelf(path) })
        }
        "regler_radio" => {
            let on = flag(call, "actif")?;
            let (kind, what) = match (call.args.get("radio").and_then(Value::as_str), on) {
                (Some("wifi"), true) => ("wifi", "wifi-on"),
                (Some("wifi"), false) => ("wifi", "wifi-off"),
                (Some("bluetooth"), true) => ("bluetooth", "bluetooth-on"),
                (Some("bluetooth"), false) => ("bluetooth", "bluetooth-off"),
                _ => return Err("radio : wifi ou bluetooth".into()),
            };
            Step::Ask(Act { what, value: String::new(), op: Op::Radio(kind, on) })
        }
        other => return Err(format!("outil inconnu : {other}")),
    })
}

/// L'application du Lanceur dont le nom ressemble le plus à `name`.
fn find_app(ctx: &ModuleContext, name: &str) -> Result<(u64, String), String> {
    let query = search::normalize(name);
    if query.chars().count() < 2 {
        return Err("nom d'application trop court".into());
    }
    let entries = invoke(ctx, "launcher", "entries", json!({}))?;
    let list = entries.get("items").or(Some(&entries)).and_then(Value::as_array).cloned().unwrap_or_default();
    best_app(&list, &query).ok_or(format!("aucune application « {name} » dans le menu Démarrer"))
}

/// Parmi les entrées du Lanceur (applications et outils, pas les fichiers
/// récents), la mieux notée.
fn best_app(list: &[Value], query: &str) -> Option<(u64, String)> {
    list.iter()
        .filter(|e| matches!(e["kind"].as_str(), Some("app" | "tool")))
        .filter_map(|e| {
            let name = e["name"].as_str()?;
            let id = e["id"].as_u64()?;
            let score = search::score(name, query);
            (score > 0).then(|| (score, id, name.to_string()))
        })
        .max_by_key(|(score, _, _)| *score)
        .map(|(_, id, name)| (id, name))
}

/// Fait une action acceptée. Renvoie le résultat pour l'IA et la ligne d'activité.
pub fn perform(ctx: &ModuleContext, act: &Act) -> Result<(Value, Value), String> {
    match &act.op {
        Op::App(id) => {
            invoke(ctx, "launcher", "launch", json!({ "id": id }))?;
        }
        Op::Site(url) => {
            crate::platform::forget_previous_foreground();
            crate::platform::shell_open(url)?;
        }
        Op::Shelf(path) => {
            if !super::is_active(ctx.app, "shelf") {
                return Err("le module Étagère est désactivé".into());
            }
            ctx.emit("shelf.add", json!({ "paths": [path.display().to_string()] }));
        }
        Op::Radio(kind, on) => {
            invoke(ctx, "controls", "set_radio", json!({ "kind": kind, "on": on }))?;
        }
    }
    Ok((json!({ "ok": true }), json!({ "kind": "did", "what": act.what, "value": act.value })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_has_an_object_schema() {
        let t = tools();
        assert!(t.len() >= 15);
        for tool in &t {
            assert_eq!(tool.schema["type"], "object", "{}", tool.name);
            assert!(tool.name.chars().all(|c| c.is_ascii_lowercase() || c == '_'), "{}", tool.name);
        }
        let mut names: Vec<&str> = t.iter().map(|t| t.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), t.len(), "noms en double");
        assert!(owns("regler_volume") && !owns("chercher_fichiers"));
        // Jamais d'outil qui supprime ou lance une commande.
        assert!(!t.iter().any(|t| ["supprimer", "commande", "terminal", "executer"].iter().any(|w| t.name.contains(w))));
    }

    #[test]
    fn apps_are_matched_by_name() {
        let list = vec![
            json!({ "id": 1, "name": "Calculatrice", "kind": "app" }),
            json!({ "id": 2, "name": "calcul-impots.xlsx", "kind": "recent" }),
            json!({ "id": 3, "name": "Gestionnaire des tâches", "kind": "tool" }),
        ];
        assert_eq!(best_app(&list, &search::normalize("calculatrice")), Some((1, "Calculatrice".into())));
        assert_eq!(best_app(&list, &search::normalize("gestionnaire")), Some((3, "Gestionnaire des tâches".into())));
        assert_eq!(best_app(&list, &search::normalize("impots")), None);
    }

    #[test]
    fn long_results_are_cut() {
        let v = json!({ "x": "a".repeat(MAX_RESULT_CHARS * 2) });
        assert_eq!(short(v)["coupe"], true);
        assert_eq!(short(json!({ "x": 1 })), json!({ "x": 1 }));
    }
}
