// Module « Home Assistant » : les appareils de la maison en boutons dans
// l'île, et à la voix (« Dis Ondine, allume la lumière du salon »).
//
// COUPÉ PAR DÉFAUT (services/settings.rs, MODULES_OFF_BY_DEFAULT). Rien ne
// part tant que la personne n'a pas donné une adresse et un jeton, puis :
//   - toutes les demandes partent vers CETTE adresse seulement (http ou
//     https, sans proxy, sans suivre de redirection) ; un certificat
//     auto-signé n'est accepté que si l'option « insecure » est cochée ;
//   - le jeton d'accès longue durée est dans le Gestionnaire d'identifiants
//     (`homeassistant-token`), lu ici seulement, jamais renvoyé au front ni
//     écrit au journal ;
//   - l'API REST : `GET /api/config` (Tester la connexion), `GET /api/states`
//     (les appareils, relus seulement quand une vue les montre),
//     `POST /api/services/<domaine>/<service>` (une action),
//     `POST /api/template` (les pièces, facultatif) et
//     `POST /api/conversation/process` (Assist, pour la voix).
//
// Sécurité : seuls les domaines et services de homeassistant_logic.rs
// passent. Les appareils SENSIBLES (serrures, alarmes, garage, portail,
// porte, et ceux que la personne marque) demandent toujours un clic :
// `call` renvoie `{confirm: {id, label}}` et rien n'est fait avant
// `confirm_call {id}` (un bouton de l'île, ou la carte « Faire » de Parler à
// Ondine). Une Règle ne peut pas les commander. Assist ne reçoit jamais une
// phrase qui vise quelque chose de sensible (`mentions_sensitive`) : il
// agirait sans la confirmation d'Ondine.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use super::homeassistant_logic::{self as logic, Entity};
use super::{ModuleContext, RustModule};
use crate::services::credentials;
use crate::sync::LockExt;

pub const ID: &str = "homeassistant";
/// Une réponse de Home Assistant fait au plus ça (une grande maison : /api/states).
const MAX_BYTES: u64 = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
/// Assist répond vite, ou la phrase part à l'IA.
const ASSIST_TIMEOUT: Duration = Duration::from_secs(8);
/// La liste des appareils gardée pour le tri des phrases (noms, sensibles).
const CACHE_FOR: Duration = Duration::from_secs(600);
/// Une confirmation attend au plus ça.
const CONFIRM_FOR: Duration = Duration::from_secs(300);
const MAX_FAVORITES: usize = 60;

/// Où et comment parler à Home Assistant.
pub struct Conn {
    pub base: String,
    pub authority: String,
    pub token: String,
    pub insecure: bool,
}

/// Une action sensible qui attend le clic de la personne.
struct Waiting {
    id: u64,
    at: Instant,
    entity: String,
    service: String,
    data: Value,
    label: String,
}

#[derive(Default)]
pub struct HomeAssistant {
    /// Les appareils lus en dernier (et quand).
    cache: Mutex<Option<(Instant, Vec<Entity>)>>,
    waiting: Mutex<Vec<Waiting>>,
    next: Mutex<u64>,
}

impl RustModule for HomeAssistant {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/homeassistant/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // Configuré ? (jamais le jeton : seulement s'il existe)
            "status" => {
                let s = ctx.settings();
                let url = s.get("url").and_then(Value::as_str).unwrap_or("");
                let address = logic::base_url(url);
                let token = ctx.credential(credentials::HOMEASSISTANT_TOKEN)?.is_some_and(|t| !t.trim().is_empty());
                Ok(json!({
                    "address": address.as_ref().ok().map(|(_, a)| a),
                    "addressError": if url.trim().is_empty() { None } else { address.err() },
                    "hasToken": token,
                    "configured": token && logic::base_url(url).is_ok(),
                    "favorites": favorites_of(&s).len(),
                }))
            }
            // « Tester la connexion » : GET /api/config.
            "test" => {
                let conn = conn(ctx)?;
                let v = get(&conn, "/api/config", TIMEOUT)?;
                ctx.log_info(format!("connexion vérifiée avec {}", conn.authority));
                Ok(json!({
                    "ok": true,
                    "address": conn.authority,
                    "version": v["version"].as_str().unwrap_or(""),
                    "name": v["location_name"].as_str().unwrap_or(""),
                }))
            }
            // Réglages → Appareils favoris : tous les appareils commandables, avec leur pièce.
            "entities" => {
                let conn = conn(ctx)?;
                let list = self.refresh(&conn)?;
                let areas = areas(&conn);
                let s = ctx.settings();
                let marked = marked_sensitive(&s);
                let items: Vec<Value> = list.iter().map(|e| e.to_json(areas.get(&e.id).map(String::as_str), sensitive(e, &marked))).collect();
                Ok(json!({ "items": items, "areas": !areas.is_empty() }))
            }
            // L'île : les favoris et leur état du moment.
            "favorites" => {
                let s = ctx.settings();
                let favs = favorites_of(&s);
                if favs.is_empty() {
                    return Ok(json!({ "items": [] }));
                }
                let conn = conn(ctx)?;
                let list = self.refresh(&conn)?;
                let marked = marked_sensitive(&s);
                let items: Vec<Value> = favs
                    .iter()
                    .map(|f| match list.iter().find(|e| e.id == f.id) {
                        Some(e) => {
                            let mut v = e.to_json(f.area.as_deref(), sensitive(e, &marked));
                            if let Some(n) = &f.name {
                                v["name"] = json!(n);
                            }
                            v
                        }
                        // Disparu de Home Assistant : montré grisé.
                        None => json!({ "id": f.id, "domain": logic::domain_of(&f.id), "name": f.name.clone().unwrap_or_else(|| f.id.clone()), "area": f.area, "state": "unavailable", "available": false, "sensitive": true }),
                    })
                    .collect();
                Ok(json!({ "items": items }))
            }
            // { entity, service, value?, source? } : une action. Sensible → { confirm }.
            "call" => {
                let source = args.get("source").and_then(Value::as_str).unwrap_or("button");
                self.call(ctx, &args, source)
            }
            // { id } : la personne a cliqué « Confirmer ».
            "confirm_call" => {
                let id = args.get("id").and_then(Value::as_u64).unwrap_or(0);
                let w = {
                    let mut list = self.waiting.locked();
                    list.retain(|w| w.at.elapsed() < CONFIRM_FOR);
                    let at = list.iter().position(|w| w.id == id).ok_or("cette confirmation n'est plus valable : recommencez")?;
                    list.remove(at)
                };
                let conn = conn(ctx)?;
                let state = self.perform(ctx, &conn, &w.entity, &w.service, &w.data)?;
                ctx.log_info(format!("action confirmée : {}.{}", logic::domain_of(&w.entity), w.service));
                Ok(json!({ "ok": true, "label": w.label, "state": state }))
            }
            // { id } : « Annuler » sur une confirmation.
            "cancel_call" => {
                let id = args.get("id").and_then(Value::as_u64).unwrap_or(0);
                self.waiting.locked().retain(|w| w.id != id);
                Ok(Value::Null)
            }
            // { text } : la voix (Parler à Ondine, askclaude.rs). Assist s'en charge ?
            "assist" => self.assist(ctx, args.get("text").and_then(Value::as_str).unwrap_or("")),
            // L'outil « maison » de Parler à Ondine : { entity, service, value? }, favoris seulement.
            "ai_call" => {
                if ctx.settings().get("aiTool").and_then(Value::as_bool) != Some(true) {
                    return Err("l'IA ne peut pas commander la maison (réglage coupé)".into());
                }
                let entity = args.get("entity").and_then(Value::as_str).unwrap_or("");
                if !favorites_of(&ctx.settings()).iter().any(|f| f.id == entity) {
                    return Err(format!("« {entity} » n'est pas dans les favoris"));
                }
                if args.get("service").and_then(Value::as_str) == Some("etat") {
                    let conn = conn(ctx)?;
                    let list = self.refresh(&conn)?;
                    let e = list.iter().find(|e| e.id == entity).ok_or("appareil introuvable")?;
                    return Ok(json!({ "state": e.to_json(None, false) }));
                }
                self.call(ctx, &args, "ai")
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

/// Un favori tel que rangé dans les réglages : { id, name?, area? }.
#[derive(Clone, Debug, PartialEq)]
pub struct Favorite {
    pub id: String,
    pub name: Option<String>,
    pub area: Option<String>,
}

/// Les favoris des réglages (`favorites`, rangés par les Réglages), vérifiés.
pub fn favorites_of(values: &Map<String, Value>) -> Vec<Favorite> {
    let text = |v: &Value, k: &str| v[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.chars().take(80).collect::<String>());
    values
        .get("favorites")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let id = v["id"].as_str()?;
                    logic::valid_entity(id).then(|| Favorite { id: id.to_string(), name: text(v, "name"), area: text(v, "area") })
                })
                .take(MAX_FAVORITES)
                .collect()
        })
        .unwrap_or_default()
}

/// Les entités que la personne a marquées « sensible ».
fn marked_sensitive(values: &Map<String, Value>) -> Vec<String> {
    values.get("sensitive").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

fn sensitive(e: &Entity, marked: &[String]) -> bool {
    logic::auto_sensitive(&e.domain, e.device_class.as_deref()) || marked.contains(&e.id)
}

fn english(ctx: &ModuleContext) -> bool {
    use tauri::Manager;
    crate::app_language(&ctx.app.state::<crate::Shared>().settings.locked()) == "en"
}

/// Le réglage « S'adresser à moi » : tutoiement (en français).
fn tutoie(ctx: &ModuleContext) -> bool {
    use tauri::Manager;
    let shared = ctx.app.state::<crate::Shared>();
    let s = shared.settings.locked();
    crate::services::settings::tutoie(&s.general, crate::app_language(&s))
}

/// L'adresse et le jeton, ou une erreur claire.
fn conn(ctx: &ModuleContext) -> Result<Conn, String> {
    let s = ctx.settings();
    let (base, authority) = logic::base_url(s.get("url").and_then(Value::as_str).unwrap_or(""))?;
    let token = ctx.credential(credentials::HOMEASSISTANT_TOKEN)?.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).ok_or("ajoutez le jeton d'accès (Réglages → Home Assistant → Connexion)")?;
    Ok(Conn { base, authority, token, insecure: s.get("insecure").and_then(Value::as_bool) == Some(true) })
}

impl HomeAssistant {
    /// Relit les appareils (et les garde pour le tri des phrases).
    fn refresh(&self, conn: &Conn) -> Result<Vec<Entity>, String> {
        let list = logic::parse_states(&get(conn, "/api/states", TIMEOUT)?);
        *self.cache.locked() = Some((Instant::now(), list.clone()));
        Ok(list)
    }

    /// Les appareils gardés s'ils sont récents, sinon relus (au mieux).
    fn known(&self, conn: &Conn) -> Vec<Entity> {
        if let Some((at, list)) = self.cache.locked().as_ref() {
            if at.elapsed() < CACHE_FOR {
                return list.clone();
            }
        }
        self.refresh(conn).unwrap_or_default()
    }

    fn call(&self, ctx: &ModuleContext, args: &Value, source: &str) -> Result<Value, String> {
        let entity = args.get("entity").and_then(Value::as_str).unwrap_or("").trim();
        let service = args.get("service").and_then(Value::as_str).unwrap_or("").trim();
        let value = args.get("value").and_then(Value::as_f64);
        if !logic::valid_entity(entity) {
            return Err("appareil inconnu".into());
        }
        let conn = conn(ctx)?;
        let s = ctx.settings();
        // L'état du moment : la classe du volet (garage ?), les bornes du thermostat, le nom.
        let current = get(&conn, &format!("/api/states/{entity}"), TIMEOUT).ok().and_then(|v| logic::parse_entity(&v));
        let bounds = current.as_ref().map(|e| (e.min_temp, e.max_temp));
        let data = logic::service_data(entity, service, value, bounds)?;
        let name = favorites_of(&s).into_iter().find(|f| f.id == entity).and_then(|f| f.name).or(current.as_ref().map(|e| e.name.clone())).unwrap_or_else(|| entity.to_string());
        let label = logic::action_label(service, &name, value, english(ctx));
        // Un volet qu'on n'a pas pu lire : prudence, comme un garage.
        let is_sensitive = match &current {
            Some(e) => sensitive(e, &marked_sensitive(&s)),
            None => logic::auto_sensitive(logic::domain_of(entity), None) || logic::domain_of(entity) == "cover" || marked_sensitive(&s).iter().any(|m| m == entity),
        };
        if is_sensitive {
            if source == "rule" {
                return Err("appareil sensible : une Règle ne peut pas le commander (confirmation par clic obligatoire)".into());
            }
            let id = {
                let mut n = self.next.locked();
                *n += 1;
                *n
            };
            let mut list = self.waiting.locked();
            list.retain(|w| w.at.elapsed() < CONFIRM_FOR);
            if list.len() >= 8 {
                list.remove(0);
            }
            list.push(Waiting { id, at: Instant::now(), entity: entity.to_string(), service: service.to_string(), data, label: label.clone() });
            return Ok(json!({ "confirm": { "id": id, "label": label } }));
        }
        let state = self.perform(ctx, &conn, entity, service, &data)?;
        ctx.log_info(format!("action ({source}) : {}.{service}", logic::domain_of(entity)));
        Ok(json!({ "ok": true, "label": label, "state": state }))
    }

    /// Appelle le service ; renvoie le nouvel état de l'entité (s'il est revenu).
    fn perform(&self, ctx: &ModuleContext, conn: &Conn, entity: &str, service: &str, data: &Value) -> Result<Value, String> {
        let domain = logic::domain_of(entity);
        let changed = post(conn, &format!("/api/services/{domain}/{service}"), data, TIMEOUT)?;
        let mine = changed.as_array().and_then(|a| a.iter().find(|v| v["entity_id"] == entity)).and_then(logic::parse_entity);
        if let Some(e) = &mine {
            if let Some((_, list)) = self.cache.locked().as_mut() {
                if let Some(old) = list.iter_mut().find(|x| x.id == e.id) {
                    *old = e.clone();
                }
            }
        }
        react(ctx, domain, service, mine.as_ref().map(|e| e.state.as_str()));
        Ok(mine.map(|e| e.to_json(None, false)).unwrap_or(Value::Null))
    }

    /// La voix : Assist d'abord (si c'est réglé ainsi et que la phrase
    /// ressemble à un ordre pour la maison). `{handled, answer?}`.
    fn assist(&self, ctx: &ModuleContext, text: &str) -> Result<Value, String> {
        let s = ctx.settings();
        let not = |why: &str| Ok(json!({ "handled": false, "why": why }));
        if s.get("assistFirst").and_then(Value::as_bool) == Some(false) {
            return not("off");
        }
        let text: String = text.trim().chars().take(300).collect();
        let Ok(conn) = conn(ctx) else { return not("not-configured") };
        let favs = favorites_of(&s);
        let marked = marked_sensitive(&s);
        // Le tri avec ce qui est déjà connu (rien ne part pour une phrase sans rapport).
        let mut names: Vec<String> = favs.iter().flat_map(|f| [f.name.clone(), f.area.clone()]).flatten().collect();
        names.extend(self.cache.locked().iter().flat_map(|(_, list)| list.iter().map(|e| e.name.clone())));
        if !logic::looks_like_home(&text, &names) {
            return not("not-home");
        }
        let known = self.known(&conn);
        let sensitive_names: Vec<String> = known.iter().filter(|e| sensitive(e, &marked)).map(|e| e.name.clone()).chain(favs.iter().filter(|f| marked.contains(&f.id)).filter_map(|f| f.name.clone())).collect();
        if logic::mentions_sensitive(&text, &sensitive_names) {
            // Assist agirait sans la confirmation d'Ondine. Avec l'outil
            // « maison », l'IA proposera une carte « Faire / Annuler » ;
            // sinon, on dit où confirmer.
            if s.get("aiTool").and_then(Value::as_bool) == Some(true) {
                return not("sensitive");
            }
            let answer = if english(ctx) {
                "For safety, locks, alarms, garage doors and gates are never controlled by voice without a click: use the button in the Home Assistant tab."
            } else if tutoie(ctx) {
                "Par sécurité, les serrures, l'alarme, le garage et les portails ne se commandent jamais à la voix sans un clic : utilise le bouton dans l'onglet Home Assistant."
            } else {
                "Par sécurité, les serrures, l'alarme, le garage et les portails ne se commandent jamais à la voix sans un clic : utilisez le bouton dans l'onglet Home Assistant."
            };
            return Ok(json!({ "handled": true, "answer": answer, "sensitive": true }));
        }
        let lang = if english(ctx) { "en" } else { "fr" };
        let v = match post(&conn, "/api/conversation/process", &json!({ "text": text, "language": lang }), ASSIST_TIMEOUT) {
            Ok(v) => v,
            Err(e) => {
                ctx.log_warn(format!("Assist : {e}"));
                return not("error");
            }
        };
        let a = logic::parse_assist(&v);
        if !a.handled {
            return not("no-match");
        }
        ctx.log_info(format!("Assist s'en est chargé ({} appareil(s))", a.targets.len()));
        // La réaction d'Ondine : une lumière allumée la fait cligner de l'œil.
        if let Some(light) = a.targets.iter().find(|t| logic::domain_of(t) == "light") {
            let state = get(&conn, &format!("/api/states/{light}"), Duration::from_secs(3)).ok().and_then(|v| v["state"].as_str().map(str::to_string));
            react(ctx, "light", "assist", state.as_deref());
        } else if let Some(t) = a.targets.first() {
            react(ctx, logic::domain_of(t), "assist", None);
        }
        let answer = if a.speech.is_empty() { if lang == "en" { "Done!".to_string() } else { "C'est fait !".to_string() } } else { a.speech };
        Ok(json!({ "handled": true, "answer": answer }))
    }
}

/// Ondine réagit, sobrement : une lumière qui s'allume, elle cligne de
/// l'œil ; une scène, un petit sourire. Réglage « react ».
fn react(ctx: &ModuleContext, domain: &str, service: &str, state: Option<&str>) {
    if ctx.settings().get("react").and_then(Value::as_bool) == Some(false) {
        return;
    }
    let emotion = match (domain, state) {
        ("light", Some("on")) => "wink",
        ("scene", _) => "happy",
        _ if service == "turn_on" && domain == "light" => "wink",
        _ => return,
    };
    ctx.emit("mascot.emote", json!({ "emotion": emotion }));
}

/// Les pièces (facultatif : il faut un compte administrateur pour /api/template).
fn areas(conn: &Conn) -> HashMap<String, String> {
    match request(conn, "POST", "/api/template", Some(&json!({ "template": logic::AREAS_TEMPLATE })), TIMEOUT) {
        Ok(text) => logic::parse_areas(&text),
        Err(_) => HashMap::new(),
    }
}

// ── Les demandes à Home Assistant ────────────────────────────────────────────

fn agent(insecure: bool, timeout: Duration) -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        // Le TLS de Windows ; un certificat auto-signé seulement si la personne l'a coché.
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).disable_verification(insecure).build())
        .http_status_as_error(false)
        .timeout_global(Some(timeout))
        // L'adresse donnée, rien d'autre : pas de proxy, pas de redirection suivie.
        .proxy(None)
        .max_redirects(0)
        .user_agent("Ondine")
        .build()
        .into()
}

/// Une demande ; renvoie le texte d'une réponse 200 / 201. Les erreurs ne
/// recopient jamais le jeton ni le message brut de ureq.
fn request(conn: &Conn, method: &str, path: &str, body: Option<&Value>, timeout: Duration) -> Result<String, String> {
    let url = format!("{}{path}", conn.base);
    let auth = format!("Bearer {}", conn.token);
    let agent = agent(conn.insecure, timeout);
    let unreachable = |e: ureq::Error| match e {
        ureq::Error::Timeout(_) => format!("{} ne répond pas (délai dépassé)", conn.authority),
        ureq::Error::HostNotFound => format!("{} introuvable sur le réseau (vérifiez le nom, ou essayez l'adresse IP)", conn.authority),
        ureq::Error::Tls(_) | ureq::Error::NativeTls(_) => format!("{} : certificat refusé (auto-signé ? cochez l'option dans Connexion)", conn.authority),
        _ if conn.base.starts_with("https") => format!("{} injoignable (vérifiez l'adresse, le port et le certificat)", conn.authority),
        _ => format!("{} injoignable (vérifiez l'adresse et le port)", conn.authority),
    };
    let resp = match (method, body) {
        ("POST", Some(b)) => agent.post(&url).header("Authorization", &auth).header("Content-Type", "application/json").send(b.to_string().as_bytes()),
        _ => agent.get(&url).header("Authorization", &auth).call(),
    };
    let mut resp = resp.map_err(unreachable)?;
    match resp.status().as_u16() {
        200 | 201 => resp.body_mut().with_config().limit(MAX_BYTES).read_to_string().map_err(|_| "réponse illisible ou trop grosse".to_string()),
        401 | 403 => Err("jeton refusé par Home Assistant (créez un jeton d'accès longue durée dans votre profil)".into()),
        404 => Err("introuvable chez Home Assistant (appareil ou service inconnu ?)".into()),
        400 => Err("Home Assistant a refusé la demande".into()),
        300..=399 => Err("Home Assistant répond par une redirection : vérifiez l'adresse (http ou https ?)".into()),
        status => Err(format!("Home Assistant a répondu {status}")),
    }
}

fn get(conn: &Conn, path: &str, timeout: Duration) -> Result<Value, String> {
    serde_json::from_str(&request(conn, "GET", path, None, timeout)?).map_err(|_| "réponse illisible".to_string())
}

fn post(conn: &Conn, path: &str, body: &Value, timeout: Duration) -> Result<Value, String> {
    let text = request(conn, "POST", path, Some(body), timeout)?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|_| "réponse illisible".to_string())
}

#[cfg(test)]
mod tests {
    //! Un faux Home Assistant local (127.0.0.1, un port libre) : les vraies
    //! demandes HTTP d'Ondine, et des réponses copiées d'un vrai serveur.
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    /// Le jeton des tests, construit en morceaux (jamais un jeton littéral).
    fn token() -> String {
        ["essai", "jeton", "local"].join("-")
    }

    /// Lance le faux serveur ; renvoie sa base et le journal des demandes (« GET /api/states »).
    fn fake(n: usize) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(n) {
                let mut s = stream.unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                // Les en-têtes, puis le corps (Content-Length).
                let (head, mut body) = loop {
                    let k = s.read(&mut chunk).unwrap();
                    buf.extend_from_slice(&chunk[..k]);
                    if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break (String::from_utf8_lossy(&buf[..at]).to_string(), buf[at + 4..].to_vec());
                    }
                };
                let len = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                while body.len() < len {
                    let k = s.read(&mut chunk).unwrap();
                    body.extend_from_slice(&chunk[..k]);
                }
                let line = head.lines().next().unwrap_or("").to_string();
                let path = line.split_whitespace().nth(1).unwrap_or("").to_string();
                let authorized = head.lines().any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {}", token())));
                log.lock().unwrap().push(format!("{} {}", line.split_whitespace().next().unwrap_or(""), path));
                let body = String::from_utf8_lossy(&body).to_string();
                let (status, reply) = if !authorized {
                    (401, r#"{"message":"Invalid authentication"}"#.to_string())
                } else {
                    route(&path, &body)
                };
                let text = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
                let _ = s.write_all(text.as_bytes());
            }
        });
        (base, seen)
    }

    fn route(path: &str, body: &str) -> (u16, String) {
        match path {
            "/api/config" => (200, r#"{"location_name":"Maison","version":"2026.10.1","language":"fr","unit_system":{"temperature":"°C"}}"#.into()),
            "/api/states" => (
                200,
                r#"[{"entity_id":"light.salon","state":"off","attributes":{"friendly_name":"Lampe du salon","supported_color_modes":["brightness"],"brightness":null}},
                    {"entity_id":"cover.garage","state":"closed","attributes":{"friendly_name":"Porte du garage","device_class":"garage"}},
                    {"entity_id":"sensor.x","state":"1","attributes":{}}]"#
                    .into(),
            ),
            "/api/states/light.salon" => (200, r#"{"entity_id":"light.salon","state":"off","attributes":{"friendly_name":"Lampe du salon","supported_color_modes":["brightness"]}}"#.into()),
            "/api/states/cover.garage" => (200, r#"{"entity_id":"cover.garage","state":"closed","attributes":{"friendly_name":"Porte du garage","device_class":"garage"}}"#.into()),
            "/api/services/light/turn_on" => {
                assert!(body.contains("\"brightness_pct\":40"), "{body}");
                (200, r#"[{"entity_id":"light.salon","state":"on","attributes":{"friendly_name":"Lampe du salon","brightness":102,"supported_color_modes":["brightness"]}}]"#.into())
            }
            "/api/conversation/process" if body.contains("cuisine") => (
                200,
                r#"{"response":{"response_type":"error","language":"fr","data":{"code":"no_valid_targets"},"speech":{"plain":{"speech":"Aucune zone nommée cuisine","extra_data":null}}},"conversation_id":null,"continue_conversation":false}"#.into(),
            ),
            "/api/conversation/process" => (
                200,
                r#"{"response":{"response_type":"action_done","language":"fr","data":{"targets":[],"success":[{"name":"Lampe du salon","type":"entity","id":"light.salon"}],"failed":[]},"speech":{"plain":{"speech":"Allumé","extra_data":null}}},"conversation_id":"01J9","continue_conversation":false}"#.into(),
            ),
            "/api/redirect" => (302, "".into()),
            _ => (404, r#"{"message":"Not found"}"#.into()),
        }
    }

    fn conn(base: &str, token: String) -> Conn {
        let (base, authority) = logic::base_url(base).unwrap();
        Conn { base, authority, token, insecure: false }
    }

    #[test]
    fn talks_to_a_local_home_assistant() {
        let (base, seen) = fake(7);
        let c = conn(&base, token());
        // Tester la connexion.
        let cfg = get(&c, "/api/config", TIMEOUT).unwrap();
        assert_eq!(cfg["version"], "2026.10.1");
        // Les appareils (le capteur est laissé de côté).
        let list = logic::parse_states(&get(&c, "/api/states", TIMEOUT).unwrap());
        assert_eq!(list.len(), 2);
        assert!(logic::auto_sensitive(&list[1].domain, list[1].device_class.as_deref()));
        // Une action : le nouvel état revient.
        let data = logic::service_data("light.salon", "turn_on", Some(40.0), None).unwrap();
        let changed = post(&c, "/api/services/light/turn_on", &data, TIMEOUT).unwrap();
        assert_eq!(logic::parse_entity(&changed[0]).unwrap().brightness, Some(40));
        // Assist : action faite, puis « rien à commander » (la phrase ira à l'IA).
        let done = logic::parse_assist(&post(&c, "/api/conversation/process", &json!({ "text": "allume le salon", "language": "fr" }), ASSIST_TIMEOUT).unwrap());
        assert!(done.handled && done.speech == "Allumé");
        let miss = logic::parse_assist(&post(&c, "/api/conversation/process", &json!({ "text": "allume la cuisine", "language": "fr" }), ASSIST_TIMEOUT).unwrap());
        assert!(!miss.handled);
        // Inconnu, redirection : des erreurs claires.
        assert!(get(&c, "/api/nope", TIMEOUT).unwrap_err().contains("introuvable"));
        assert!(get(&c, "/api/redirect", TIMEOUT).unwrap_err().contains("redirection"));
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen[0], "GET /api/config");
        assert_eq!(seen[2], "POST /api/services/light/turn_on");
    }

    #[test]
    fn a_wrong_token_is_explained_and_never_shown() {
        let (base, _) = fake(1);
        let bad = ["mauvais", "jeton"].join("-");
        let err = get(&conn(&base, bad.clone()), "/api/config", TIMEOUT).unwrap_err();
        assert!(err.contains("jeton refusé"), "{err}");
        assert!(!err.contains(&bad));
    }

    #[test]
    fn an_unreachable_server_is_explained() {
        // Un port fermé : le listener est lâché tout de suite.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = get(&conn(&format!("http://127.0.0.1:{port}"), token()), "/api/config", Duration::from_secs(3)).unwrap_err();
        assert!(err.contains("injoignable") || err.contains("ne répond pas"), "{err}");
        assert!(!err.contains(&token()));
    }

    #[test]
    fn favorites_are_checked() {
        let values: Map<String, Value> = serde_json::from_value(json!({
            "favorites": [
                { "id": "light.salon", "name": "Salon", "area": "Séjour" },
                { "id": "homeassistant.restart" },
                { "id": "switch.prise", "name": "  " },
                "n'importe quoi"
            ],
            "sensitive": ["switch.prise"]
        }))
        .unwrap();
        let favs = favorites_of(&values);
        assert_eq!(favs.len(), 2);
        assert_eq!(favs[0], Favorite { id: "light.salon".into(), name: Some("Salon".into()), area: Some("Séjour".into()) });
        assert_eq!(favs[1].name, None);
        assert_eq!(marked_sensitive(&values), vec!["switch.prise".to_string()]);
        let prise = logic::parse_entity(&json!({ "entity_id": "switch.prise", "state": "on", "attributes": {} })).unwrap();
        assert!(sensitive(&prise, &marked_sensitive(&values)));
    }
}
