// Home Assistant : la partie pure (sans réseau ni Tauri), testée ici.
//
//   - l'adresse donnée par la personne, vérifiée et ramenée à sa forme de base
//     (`base_url`) : http(s)://hôte[:port][/chemin], sans identifiant ni « ? » ;
//   - les appareils lus dans `GET /api/states` (`parse_states`), seulement les
//     domaines qu'Ondine sait commander (DOMAINS) ;
//   - les domaines SENSIBLES (`auto_sensitive`) : serrures, alarmes, volets de
//     classe garage / portail / porte. Ceux-là (et toute entité marquée
//     « sensible » par la personne) demandent TOUJOURS un clic de confirmation ;
//   - les services autorisés et leurs données, bornées (`service_data`) ;
//   - la réponse d'Assist (`POST /api/conversation/process`, `parse_assist`) ;
//   - le petit tri « est-ce un ordre pour la maison ? » (`looks_like_home`) et
//     « vise-t-il quelque chose de sensible ? » (`mentions_sensitive`), pour ne
//     pas envoyer à Assist une question qui n'a rien à voir, ni un ordre
//     qu'Assist ferait sans la confirmation d'Ondine.

use serde_json::{json, Value};

use crate::services::search;

/// Les domaines qu'Ondine sait montrer et commander.
pub const DOMAINS: &[&str] = &["light", "switch", "input_boolean", "fan", "cover", "scene", "script", "climate", "media_player", "lock", "alarm_control_panel"];

/// Les classes de volets qui ouvrent la maison : toujours confirmées.
const SENSITIVE_COVERS: &[&str] = &["garage", "gate", "door"];

/// Un appareil de Home Assistant, tel qu'Ondine le montre.
#[derive(Clone, Debug, PartialEq)]
pub struct Entity {
    pub id: String,
    pub domain: String,
    pub name: String,
    pub state: String,
    pub device_class: Option<String>,
    /// Lumière : la luminosité en %, si elle est allumée et réglable.
    pub brightness: Option<u8>,
    /// Lumière : peut-on régler la luminosité ?
    pub dimmable: bool,
    /// Volet : la position (0 = fermé, 100 = ouvert), s'il la donne.
    pub position: Option<u8>,
    /// Climat : la consigne, la température mesurée, les bornes.
    pub target: Option<f64>,
    pub current: Option<f64>,
    pub min_temp: f64,
    pub max_temp: f64,
    /// Lecteur : le volume en %, et ce qui joue.
    pub volume: Option<u8>,
    pub media_title: Option<String>,
}

impl Entity {
    pub fn to_json(&self, area: Option<&str>, sensitive: bool) -> Value {
        json!({
            "id": self.id,
            "domain": self.domain,
            "name": self.name,
            "state": self.state,
            "area": area,
            "deviceClass": self.device_class,
            "brightness": self.brightness,
            "dimmable": self.dimmable,
            "position": self.position,
            "target": self.target,
            "current": self.current,
            "minTemp": self.min_temp,
            "maxTemp": self.max_temp,
            "volume": self.volume,
            "mediaTitle": self.media_title,
            "sensitive": sensitive,
            "available": self.state != "unavailable" && self.state != "unknown",
        })
    }
}

/// L'adresse de Home Assistant, vérifiée : (base sans « / » final, hôte:port
/// pour l'affichage). Seulement http ou https, jamais d'identifiant dans
/// l'adresse, ni de « ? » ou « # ».
pub fn base_url(raw: &str) -> Result<(String, String), String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("indiquez l'adresse de Home Assistant".into());
    }
    let lower = raw.to_ascii_lowercase();
    let rest = if lower.starts_with("http://") {
        &raw[7..]
    } else if lower.starts_with("https://") {
        &raw[8..]
    } else {
        return Err("l'adresse doit commencer par http:// ou https://".into());
    };
    if raw.chars().any(|c| c.is_whitespace() || c.is_control()) || raw.contains(['?', '#', '@', '\\']) {
        return Err("adresse invalide (pas d'espace, de « ? », de « # » ni d'identifiant)".into());
    }
    let authority = rest.split('/').next().unwrap_or("");
    let host = authority.rsplit_once(':').map(|(h, p)| (h, Some(p))).unwrap_or((authority, None));
    if let (_, Some(port)) = host {
        if port.parse::<u16>().map(|p| p == 0).unwrap_or(true) {
            return Err("numéro de port invalide".into());
        }
    }
    let host_ok = !host.0.is_empty() && host.0.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '[' | ']' | ':'));
    if !host_ok {
        return Err("nom d'hôte invalide".into());
    }
    if raw.len() > 200 {
        return Err("adresse trop longue".into());
    }
    Ok((raw.to_string(), authority.to_string()))
}

/// Un identifiant d'entité bien formé (« light.salon ») d'un domaine connu.
pub fn valid_entity(id: &str) -> bool {
    let Some((domain, object)) = id.split_once('.') else { return false };
    DOMAINS.contains(&domain) && !object.is_empty() && id.len() <= 120 && object.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub fn domain_of(id: &str) -> &str {
    id.split('.').next().unwrap_or("")
}

fn percent(v: Option<f64>, max: f64) -> Option<u8> {
    v.filter(|x| x.is_finite()).map(|x| ((x / max) * 100.0).round().clamp(0.0, 100.0) as u8)
}

/// Une entité lue dans la réponse de Home Assistant (un élément de /api/states).
pub fn parse_entity(v: &Value) -> Option<Entity> {
    let id = v["entity_id"].as_str()?.to_string();
    if !valid_entity(&id) {
        return None;
    }
    let domain = domain_of(&id).to_string();
    let a = &v["attributes"];
    let name = a["friendly_name"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| id.split('.').nth(1).unwrap_or("").replace('_', " "));
    let state = v["state"].as_str().unwrap_or("unknown").to_string();
    let modes: Vec<&str> = a["supported_color_modes"].as_array().map(|m| m.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let dimmable = domain == "light" && (a.get("brightness").is_some_and(|b| !b.is_null()) || modes.iter().any(|m| *m != "onoff"));
    Some(Entity {
        name: name.chars().take(80).collect(),
        device_class: a["device_class"].as_str().map(str::to_string),
        brightness: if domain == "light" { percent(a["brightness"].as_f64(), 255.0) } else { None },
        dimmable,
        position: if domain == "cover" { a["current_position"].as_f64().map(|p| p.clamp(0.0, 100.0) as u8) } else { None },
        target: if domain == "climate" { a["temperature"].as_f64() } else { None },
        current: if domain == "climate" { a["current_temperature"].as_f64() } else { None },
        min_temp: a["min_temp"].as_f64().unwrap_or(7.0),
        max_temp: a["max_temp"].as_f64().unwrap_or(35.0),
        volume: if domain == "media_player" { percent(a["volume_level"].as_f64(), 1.0) } else { None },
        media_title: a["media_title"].as_str().map(|t| t.chars().take(80).collect()),
        id,
        domain,
        state,
    })
}

/// Toutes les entités commandables de `GET /api/states`, triées par nom.
pub fn parse_states(v: &Value) -> Vec<Entity> {
    let mut list: Vec<Entity> = v.as_array().map(|a| a.iter().filter_map(parse_entity).collect()).unwrap_or_default();
    list.sort_by_key(|a| a.name.to_lowercase());
    list
}

/// Sensible d'office : serrure, alarme, volet de garage / portail / porte.
pub fn auto_sensitive(domain: &str, device_class: Option<&str>) -> bool {
    match domain {
        "lock" | "alarm_control_panel" => true,
        "cover" => device_class.is_some_and(|c| SENSITIVE_COVERS.contains(&c)),
        _ => false,
    }
}

/// Les services qu'Ondine accepte d'appeler, par domaine.
pub fn services(domain: &str) -> &'static [&'static str] {
    match domain {
        "light" => &["turn_on", "turn_off", "toggle"],
        "switch" | "input_boolean" | "fan" => &["turn_on", "turn_off", "toggle"],
        "cover" => &["open_cover", "close_cover", "stop_cover", "set_cover_position"],
        "scene" | "script" => &["turn_on"],
        "climate" => &["set_temperature", "turn_on", "turn_off"],
        "media_player" => &["media_play_pause", "media_next_track", "media_previous_track", "volume_set", "turn_on", "turn_off"],
        "lock" => &["lock", "unlock"],
        "alarm_control_panel" => &["alarm_arm_home", "alarm_arm_away", "alarm_disarm"],
        _ => &[],
    }
}

/// Les données du service (avec l'entité), bornées. `value` : luminosité ou
/// position en %, consigne en °C, volume en %.
pub fn service_data(entity: &str, service: &str, value: Option<f64>, bounds: Option<(f64, f64)>) -> Result<Value, String> {
    let domain = domain_of(entity);
    if !valid_entity(entity) {
        return Err("appareil inconnu".into());
    }
    if !services(domain).contains(&service) {
        return Err(format!("action « {service} » refusée pour cet appareil"));
    }
    let mut data = json!({ "entity_id": entity });
    let need = |v: Option<f64>| v.filter(|x| x.is_finite()).ok_or_else(|| "il manque la valeur".to_string());
    match (domain, service) {
        ("light", "turn_on") => {
            if let Some(v) = value.filter(|x| x.is_finite()) {
                data["brightness_pct"] = json!(v.round().clamp(1.0, 100.0) as u8);
            }
        }
        ("cover", "set_cover_position") => data["position"] = json!(need(value)?.round().clamp(0.0, 100.0) as u8),
        ("climate", "set_temperature") => {
            let (lo, hi) = bounds.unwrap_or((7.0, 35.0));
            let v = need(value)?;
            if v < lo || v > hi {
                return Err(format!("consigne de {lo} à {hi} °C"));
            }
            data["temperature"] = json!((v * 2.0).round() / 2.0);
        }
        ("media_player", "volume_set") => data["volume_level"] = json!(need(value)?.clamp(0.0, 100.0).round() / 100.0),
        _ => {}
    }
    Ok(data)
}

/// La phrase d'une action, à l'infinitif (« ouvrir « Garage » »), pour la
/// confirmation et la ligne d'activité.
pub fn action_label(service: &str, name: &str, value: Option<f64>, english: bool) -> String {
    let v = value.map(|x| if x.fract() == 0.0 { format!("{x:.0}") } else { format!("{x:.1}") }).unwrap_or_default();
    if english {
        return match service {
            "turn_on" if !v.is_empty() => format!("set “{name}” to {v} %"),
            "turn_on" => format!("turn on “{name}”"),
            "turn_off" => format!("turn off “{name}”"),
            "toggle" => format!("switch “{name}”"),
            "open_cover" => format!("open “{name}”"),
            "close_cover" => format!("close “{name}”"),
            "stop_cover" => format!("stop “{name}”"),
            "set_cover_position" => format!("set “{name}” to {v} %"),
            "set_temperature" => format!("set “{name}” to {v} °C"),
            "media_play_pause" => format!("play or pause “{name}”"),
            "media_next_track" => format!("next track on “{name}”"),
            "media_previous_track" => format!("previous track on “{name}”"),
            "volume_set" => format!("set the volume of “{name}” to {v} %"),
            "lock" => format!("lock “{name}”"),
            "unlock" => format!("unlock “{name}”"),
            "alarm_arm_home" => format!("arm “{name}” (home)"),
            "alarm_arm_away" => format!("arm “{name}” (away)"),
            "alarm_disarm" => format!("disarm “{name}”"),
            other => format!("{other} “{name}”"),
        };
    }
    match service {
        "turn_on" if !v.is_empty() => format!("régler « {name} » à {v} %"),
        "turn_on" => format!("allumer « {name} »"),
        "turn_off" => format!("éteindre « {name} »"),
        "toggle" => format!("basculer « {name} »"),
        "open_cover" => format!("ouvrir « {name} »"),
        "close_cover" => format!("fermer « {name} »"),
        "stop_cover" => format!("arrêter « {name} »"),
        "set_cover_position" => format!("régler « {name} » à {v} %"),
        "set_temperature" => format!("régler « {name} » à {v} °C"),
        "media_play_pause" => format!("lecture ou pause sur « {name} »"),
        "media_next_track" => format!("morceau suivant sur « {name} »"),
        "media_previous_track" => format!("morceau précédent sur « {name} »"),
        "volume_set" => format!("régler le volume de « {name} » à {v} %"),
        "lock" => format!("verrouiller « {name} »"),
        "unlock" => format!("déverrouiller « {name} »"),
        "alarm_arm_home" => format!("armer « {name} » (présence)"),
        "alarm_arm_away" => format!("armer « {name} » (absence)"),
        "alarm_disarm" => format!("désarmer « {name} »"),
        other => format!("{other} « {name} »"),
    }
}

// ── Assist (l'API de conversation de Home Assistant) ─────────────────────────

/// Ce qu'Assist a répondu.
#[derive(Clone, Debug, PartialEq)]
pub struct Assist {
    /// Assist s'en est chargé : sa réponse est montrée, l'IA n'est pas appelée.
    pub handled: bool,
    pub speech: String,
    /// Les entités touchées (data.success), pour la réaction d'Ondine.
    pub targets: Vec<String>,
}

/// `POST /api/conversation/process` → Assist. Assist s'en charge sauf s'il
/// n'a rien compris (`no_intent_match`) ou rien trouvé à commander
/// (`no_valid_targets`) : alors la phrase continue vers Parler à Ondine.
pub fn parse_assist(v: &Value) -> Assist {
    let r = &v["response"];
    let kind = r["response_type"].as_str().unwrap_or("");
    let code = r["data"]["code"].as_str().unwrap_or("");
    let speech = r["speech"]["plain"]["speech"].as_str().unwrap_or("").trim().chars().take(400).collect::<String>();
    let handled = match kind {
        "action_done" | "query_answer" => true,
        "error" => !matches!(code, "no_intent_match" | "no_valid_targets" | ""),
        _ => false,
    };
    let targets = r["data"]["success"].as_array().map(|a| a.iter().filter_map(|t| t["id"].as_str().map(str::to_string)).collect()).unwrap_or_default();
    Assist { handled, speech, targets }
}

/// Les mots qui font d'une phrase un ordre pour la maison (minuscules, sans
/// accents, comme `search::normalize`).
const HOME_WORDS: &[&str] = &[
    // verbes
    "allume", "allumer", "allumez", "eteins", "eteindre", "eteignez", "ouvre", "ouvrir", "ouvrez", "ferme", "fermer", "fermez", "monte", "monter", "montez", "baisse",
    "baisser", "baissez", "descends", "descendre", "remonte", "active", "activer", "activez", "desactive", "desactiver", "lance", "lancer", "verrouille", "verrouiller",
    "deverrouille", "arme", "armer", "desarme", "chauffe", "tamise", "turn", "switch", "open", "close", "dim", "lock", "unlock", "arm", "disarm", "activate", "raise",
    "lower",
    // choses
    "lumiere", "lumieres", "lampe", "lampes", "plafonnier", "eclairage", "volet", "volets", "store", "stores", "rideau", "rideaux", "prise", "prises", "chauffage",
    "radiateur", "thermostat", "clim", "climatisation", "ventilateur", "scene", "garage", "portail", "porte", "serrure", "alarme", "light", "lights", "lamp", "blind",
    "blinds", "shutter", "shutters", "curtain", "plug", "heating", "heater", "fan", "door", "gate", "alarm", "temperature", "maison",
];

fn words(text: &str) -> Vec<String> {
    search::normalize(text).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// Un nom (« Lampe du salon ») cité dans la phrase ? Ses mots de 3 lettres ou
/// plus, tous présents (« salon », « lampe »).
fn names_in(ws: &[String], name: &str) -> bool {
    let mine: Vec<String> = words(name).into_iter().filter(|w| w.chars().count() >= 3 && !["the", "les", "des", "une"].contains(&w.as_str())).collect();
    !mine.is_empty() && mine.iter().all(|w| ws.contains(w))
}

/// Faut-il demander à Assist ? Une phrase courte qui contient un mot de la
/// maison, ou le nom d'un appareil ou d'une pièce connus. Le reste (« écris
/// un poème », « pourquoi mon PC rame ») va directement à l'IA.
pub fn looks_like_home(text: &str, known: &[String]) -> bool {
    let ws = words(text);
    if ws.is_empty() || ws.len() > 16 {
        return false;
    }
    ws.iter().any(|w| HOME_WORDS.contains(&w.as_str())) || known.iter().any(|n| names_in(&ws, n))
}

/// Les mots qui visent quelque chose de sensible (serrure, alarme, garage, portail, porte).
const SENSITIVE_WORDS: &[&str] = &[
    "serrure", "serrures", "verrou", "verrouille", "verrouiller", "deverrouille", "deverrouiller", "alarme", "arme", "armer", "desarme", "desarmer", "garage", "portail",
    "portillon", "porte", "lock", "unlock", "alarm", "arm", "disarm", "garage", "gate", "door",
];

/// La phrase vise-t-elle un appareil sensible (par un mot, ou par son nom) ?
/// Assist agirait sans la confirmation d'Ondine : la phrase ne lui est pas envoyée.
pub fn mentions_sensitive(text: &str, sensitive_names: &[String]) -> bool {
    let ws = words(text);
    ws.iter().any(|w| SENSITIVE_WORDS.contains(&w.as_str())) || sensitive_names.iter().any(|n| names_in(&ws, n))
}

/// Le modèle qui donne la pièce de chaque entité (`POST /api/template`).
/// Facultatif : sans droits d'administration, Ondine range par type d'appareil.
pub const AREAS_TEMPLATE: &str = "{% set ns = namespace(out={}) %}{% for s in states %}{% set a = area_name(s.entity_id) %}{% if a %}{% set ns.out = dict(ns.out, **{s.entity_id: a}) %}{% endif %}{% endfor %}{{ ns.out | tojson }}";

/// La réponse du modèle des pièces : { "light.salon": "Salon", … }.
pub fn parse_areas(text: &str) -> std::collections::HashMap<String, String> {
    serde_json::from_str::<serde_json::Map<String, Value>>(text.trim())
        .map(|m| m.into_iter().filter_map(|(k, v)| v.as_str().map(|a| (k, a.chars().take(60).collect()))).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn states() -> Value {
        // Un extrait réaliste de GET /api/states (Home Assistant 2025).
        json!([
            { "entity_id": "light.salon", "state": "on", "attributes": { "friendly_name": "Lampe du salon", "brightness": 128, "supported_color_modes": ["brightness"], "color_mode": "brightness" }, "last_changed": "2026-10-16T18:02:11.000000+00:00" },
            { "entity_id": "light.couloir", "state": "off", "attributes": { "friendly_name": "Couloir", "supported_color_modes": ["onoff"], "brightness": null } },
            { "entity_id": "switch.cafetiere", "state": "off", "attributes": { "friendly_name": "Cafetière" } },
            { "entity_id": "cover.garage", "state": "closed", "attributes": { "friendly_name": "Porte du garage", "device_class": "garage", "supported_features": 3 } },
            { "entity_id": "cover.salon", "state": "open", "attributes": { "friendly_name": "Volet du salon", "device_class": "shutter", "current_position": 70 } },
            { "entity_id": "climate.sejour", "state": "heat", "attributes": { "friendly_name": "Thermostat", "temperature": 20.5, "current_temperature": 19.8, "min_temp": 7, "max_temp": 30 } },
            { "entity_id": "media_player.salon", "state": "playing", "attributes": { "friendly_name": "Enceinte", "volume_level": 0.35, "media_title": "Clair de lune" } },
            { "entity_id": "lock.entree", "state": "locked", "attributes": { "friendly_name": "Serrure d'entrée" } },
            { "entity_id": "sensor.temperature", "state": "21.3", "attributes": { "friendly_name": "Température" } },
            { "entity_id": "scene.cinema", "state": "2026-10-15T20:00:00+00:00", "attributes": { "friendly_name": "Cinéma" } },
            { "entity_id": "Light.Bad", "state": "on", "attributes": {} }
        ])
    }

    #[test]
    fn addresses_are_checked() {
        assert_eq!(base_url("http://homeassistant.local:8123/").unwrap(), ("http://homeassistant.local:8123".into(), "homeassistant.local:8123".into()));
        assert_eq!(base_url(" https://192.168.1.20:8123 ").unwrap().1, "192.168.1.20:8123");
        assert_eq!(base_url("https://maison.example.org/ha").unwrap().0, "https://maison.example.org/ha");
        for bad in ["", "homeassistant.local:8123", "ftp://x", "http://user:pw@x:8123", "http://x:8123/?a=1", "http://x y", "http://:8123", "http://x:0", "http://x:99999", "file:///c:/"] {
            assert!(base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn states_are_parsed() {
        let list = parse_states(&states());
        let ids: Vec<&str> = list.iter().map(|e| e.id.as_str()).collect();
        // Pas de capteur, pas d'identifiant mal formé ; trié par nom.
        assert_eq!(ids, ["switch.cafetiere", "scene.cinema", "light.couloir", "media_player.salon", "light.salon", "cover.garage", "lock.entree", "climate.sejour", "cover.salon"]);
        let salon = list.iter().find(|e| e.id == "light.salon").unwrap();
        assert_eq!((salon.brightness, salon.dimmable, salon.name.as_str()), (Some(50), true, "Lampe du salon"));
        let couloir = list.iter().find(|e| e.id == "light.couloir").unwrap();
        assert!(!couloir.dimmable && couloir.brightness.is_none());
        let volet = list.iter().find(|e| e.id == "cover.salon").unwrap();
        assert_eq!(volet.position, Some(70));
        let clim = list.iter().find(|e| e.id == "climate.sejour").unwrap();
        assert_eq!((clim.target, clim.current, clim.max_temp), (Some(20.5), Some(19.8), 30.0));
        let media = list.iter().find(|e| e.id == "media_player.salon").unwrap();
        assert_eq!((media.volume, media.media_title.as_deref()), (Some(35), Some("Clair de lune")));
        assert_eq!(salon.to_json(Some("Salon"), false)["area"], "Salon");
    }

    #[test]
    fn locks_alarms_and_garages_are_sensitive() {
        assert!(auto_sensitive("lock", None));
        assert!(auto_sensitive("alarm_control_panel", None));
        for c in ["garage", "gate", "door"] {
            assert!(auto_sensitive("cover", Some(c)), "{c}");
        }
        assert!(!auto_sensitive("cover", Some("shutter")));
        assert!(!auto_sensitive("cover", None));
        assert!(!auto_sensitive("light", None));
    }

    #[test]
    fn services_are_limited_and_bounded() {
        assert_eq!(service_data("light.salon", "turn_on", Some(40.0), None).unwrap(), json!({ "entity_id": "light.salon", "brightness_pct": 40 }));
        assert_eq!(service_data("light.salon", "turn_on", Some(400.0), None).unwrap()["brightness_pct"], 100);
        assert_eq!(service_data("light.salon", "turn_off", None, None).unwrap(), json!({ "entity_id": "light.salon" }));
        assert_eq!(service_data("cover.salon", "set_cover_position", Some(33.4), None).unwrap()["position"], 33);
        assert!(service_data("cover.salon", "set_cover_position", None, None).is_err());
        assert_eq!(service_data("climate.sejour", "set_temperature", Some(20.3), Some((7.0, 30.0))).unwrap()["temperature"], 20.5);
        assert!(service_data("climate.sejour", "set_temperature", Some(40.0), Some((7.0, 30.0))).is_err());
        assert_eq!(service_data("media_player.salon", "volume_set", Some(25.0), None).unwrap()["volume_level"], 0.25);
        // Jamais un service hors liste, ni un domaine inconnu.
        assert!(service_data("light.salon", "delete", None, None).is_err());
        assert!(service_data("homeassistant.restart", "turn_on", None, None).is_err());
        assert!(service_data("lock.entree", "open", None, None).is_err());
        assert!(service_data("light.salon/../x", "turn_on", None, None).is_err());
    }

    #[test]
    fn actions_have_a_sentence() {
        assert_eq!(action_label("open_cover", "Garage", None, false), "ouvrir « Garage »");
        assert_eq!(action_label("set_temperature", "Thermostat", Some(20.5), false), "régler « Thermostat » à 20.5 °C");
        assert_eq!(action_label("turn_on", "Lamp", Some(40.0), true), "set “Lamp” to 40 %");
    }

    #[test]
    fn assist_answers_are_read() {
        // Réponses réelles de POST /api/conversation/process.
        let done = json!({ "continue_conversation": false, "conversation_id": "01J", "response": {
            "response_type": "action_done", "language": "fr",
            "data": { "targets": [], "success": [{ "name": "Lampe du salon", "type": "entity", "id": "light.salon" }], "failed": [] },
            "speech": { "plain": { "speech": "Allumé", "extra_data": null } }, "card": {} } });
        assert_eq!(parse_assist(&done), Assist { handled: true, speech: "Allumé".into(), targets: vec!["light.salon".into()] });
        let no_match = json!({ "response": { "response_type": "error", "language": "fr", "data": { "code": "no_intent_match" },
            "speech": { "plain": { "speech": "Désolé, je n'ai pas compris", "extra_data": null } } } });
        assert!(!parse_assist(&no_match).handled);
        let no_target = json!({ "response": { "response_type": "error", "data": { "code": "no_valid_targets" }, "speech": { "plain": { "speech": "Aucune zone nommée cuisine" } } } });
        assert!(!parse_assist(&no_target).handled);
        // Compris, mais échec chez Home Assistant : sa réponse est montrée.
        let failed = json!({ "response": { "response_type": "error", "data": { "code": "failed_to_handle" }, "speech": { "plain": { "speech": "Une erreur inattendue s'est produite" } } } });
        assert!(parse_assist(&failed).handled);
        let answer = json!({ "response": { "response_type": "query_answer", "data": { "success": [], "failed": [] }, "speech": { "plain": { "speech": "La lampe est allumée" } } } });
        assert!(parse_assist(&answer).handled);
        assert!(!parse_assist(&json!({})).handled);
    }

    #[test]
    fn only_home_orders_go_to_assist() {
        let known = vec!["Lampe du salon".to_string(), "Cuisine".to_string()];
        assert!(looks_like_home("Allume la lumière du salon", &known));
        assert!(looks_like_home("éteins tout dans la cuisine", &known));
        assert!(looks_like_home("Turn off the kitchen lights", &known));
        assert!(looks_like_home("cuisine à 50 %", &known));
        assert!(!looks_like_home("Écris-moi un poème sur la mer", &known));
        assert!(!looks_like_home("Pourquoi mon PC est lent ?", &known));
        assert!(!looks_like_home("", &known));
        assert!(!looks_like_home(&"allume ".repeat(30), &known));
    }

    #[test]
    fn sensitive_orders_never_go_to_assist() {
        let names = vec!["Entrée principale".to_string()];
        assert!(mentions_sensitive("Ouvre le garage", &names));
        assert!(mentions_sensitive("déverrouille la porte", &names));
        assert!(mentions_sensitive("Unlock the front door", &names));
        assert!(mentions_sensitive("désarme l'alarme", &names));
        assert!(mentions_sensitive("ouvre l'entrée principale", &names));
        assert!(!mentions_sensitive("allume la lampe du salon", &names));
    }

    #[test]
    fn areas_are_read() {
        let m = parse_areas(r#"{"light.salon": "Salon", "switch.x": 3}"#);
        assert_eq!(m.get("light.salon").map(String::as_str), Some("Salon"));
        assert_eq!(m.len(), 1);
        assert!(parse_areas("pas du json").is_empty());
    }
}
