// Réseau → « Surveiller les services IA » : Claude, ChatGPT et Gemini
// marchent-ils ? (réglage aiStatus, DÉSACTIVÉ par défaut : il contacte des
// sites extérieurs).
//
// On lit les pages d'état publiques des éditeurs, rien d'autre ne part (pas
// de clé, pas d'identifiant) :
//   - Claude  : https://status.anthropic.com/api/v2/status.json
//   - ChatGPT : https://status.openai.com/api/v2/status.json
//     Ces deux pages suivent le format « Statuspage » :
//     { "status": { "indicator": "none" | "minor" | "major" | "critical" |
//       "maintenance", "description": "All Systems Operational" } }
//   - Gemini  : https://status.cloud.google.com/incidents.json, la liste des
//     incidents de Google Cloud ; on garde ceux en cours (sans « end ») dont un
//     produit touché parle de Gemini, et leur gravité (« status_impact » :
//     SERVICE_OUTAGE = panne, SERVICE_DISRUPTION = perturbé).
// (Ces adresses et formats sont ceux documentés par Atlassian Statuspage et
// Google Cloud ; à vérifier sur Windows, voir docs/tests/TESTS-1-2-2-divers.md.)
//
// Toutes les 5 minutes au plus, jamais pendant une présentation ni pendant la
// concentration (timer.focus, agents.quiet), et pas quand Internet est coupé.
// Une panne qui commence ou finit : "nettools.ai-status" (l'onglet prévient,
// la mascotte grimace puis soupire de soulagement). L'historique des pannes
// des 7 derniers jours est gardé dans %APPDATA%\Ondine\ai-status.json (que
// des noms de services et des heures).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::platform;

/// Toutes les… au plus.
pub const EVERY: Duration = Duration::from_secs(5 * 60);
/// On garde l'historique de ces jours-là.
const HISTORY_DAYS: u64 = 7;
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    /// Tout marche.
    Ok,
    /// Perturbé (lenteurs, une partie en panne, maintenance).
    Degraded,
    /// En panne.
    Down,
    /// Pas pu savoir (page injoignable, réponse illisible).
    Unknown,
}

impl Level {
    /// Le service a-t-il un problème ? (une lecture ratée n'en est pas un)
    pub fn bad(self) -> bool {
        matches!(self, Level::Degraded | Level::Down)
    }
}

/// Un service surveillé.
pub struct Service {
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    kind: Kind,
}

enum Kind {
    Statuspage,
    GoogleCloud { word: &'static str },
}

pub const SERVICES: &[Service] = &[
    Service { id: "claude", name: "Claude", url: "https://status.anthropic.com/api/v2/status.json", kind: Kind::Statuspage },
    Service { id: "chatgpt", name: "ChatGPT", url: "https://status.openai.com/api/v2/status.json", kind: Kind::Statuspage },
    Service { id: "gemini", name: "Gemini", url: "https://status.cloud.google.com/incidents.json", kind: Kind::GoogleCloud { word: "gemini" } },
];

/// L'état d'un service au dernier coup d'œil.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub id: &'static str,
    pub name: &'static str,
    pub level: Level,
    /// Ce que dit la page (« Partial outage », titre de l'incident…), 160 caractères au plus.
    pub description: String,
    pub checked_at: u64,
}

/// Une panne (ou perturbation) : début, fin (None = en cours), le pire niveau vu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outage {
    pub id: String,
    pub from: u64,
    pub to: Option<u64>,
    pub level: Level,
}

/// Format « Statuspage » → niveau et description.
pub fn parse_statuspage(v: &Value) -> Option<(Level, String)> {
    let status = v.get("status")?;
    let level = match status.get("indicator")?.as_str()? {
        "none" => Level::Ok,
        "minor" | "maintenance" => Level::Degraded,
        "major" | "critical" => Level::Down,
        _ => return None,
    };
    let text = status.get("description").and_then(Value::as_str).unwrap_or("");
    Some((level, short(text)))
}

/// La liste d'incidents de Google Cloud → le pire incident en cours qui
/// touche un produit dont le nom contient `word`.
pub fn parse_google(v: &Value, word: &str) -> Option<(Level, String)> {
    let list = v.as_array()?;
    let mut worst = (Level::Ok, String::new());
    for inc in list {
        let ongoing = inc.get("end").is_none_or(Value::is_null);
        let touches = inc
            .get("affected_products")
            .and_then(Value::as_array)
            .is_some_and(|ps| ps.iter().any(|p| p.get("title").and_then(Value::as_str).is_some_and(|t| t.to_lowercase().contains(word))));
        if !ongoing || !touches {
            continue;
        }
        let level = match inc.get("status_impact").and_then(Value::as_str) {
            Some("SERVICE_OUTAGE") => Level::Down,
            Some("SERVICE_INFORMATION") => continue, // simple information
            _ => match inc.get("severity").and_then(Value::as_str) {
                Some("high") => Level::Down,
                _ => Level::Degraded,
            },
        };
        if worst.0 != Level::Down {
            let text = inc.get("external_desc").and_then(Value::as_str).unwrap_or("");
            worst = (level, short(text));
        }
    }
    Some(worst)
}

fn short(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() > 160 { format!("{}…", t.chars().take(159).collect::<String>()) } else { t.to_string() }
}

/// Met l'historique à jour avec un nouveau niveau. Renvoie true si une panne
/// commence ou finit (il faut prévenir).
pub fn track(history: &mut Vec<Outage>, id: &str, before: Option<Level>, now: Level, at: u64) -> bool {
    if now == Level::Unknown {
        return false; // on ne sait pas : rien ne change
    }
    let open = history.iter_mut().find(|o| o.id == id && o.to.is_none());
    let changed = match (open, now.bad()) {
        (Some(o), true) => {
            if now == Level::Down {
                o.level = Level::Down;
            }
            false
        }
        (Some(o), false) => {
            o.to = Some(at);
            true
        }
        (None, true) => {
            history.push(Outage { id: id.to_string(), from: at, to: None, level: now });
            // Première lecture depuis le démarrage : on note, sans alerter.
            before.is_some()
        }
        (None, false) => false,
    };
    // Plus vieux que 7 jours : oublié.
    let limit = at.saturating_sub(HISTORY_DAYS * 86_400_000);
    history.retain(|o| o.to.is_none_or(|t| t >= limit));
    changed
}

/// Lit une page d'état (HTTPS seulement, 10 s au plus, 2 Mo au plus).
pub fn fetch(service: &Service, at: u64) -> Reading {
    let (level, description) = read(service).unwrap_or((Level::Unknown, String::new()));
    Reading { id: service.id, name: service.name, level, description, checked_at: at }
}

fn read(service: &Service) -> Option<(Level, String)> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .timeout_global(Some(Duration::from_secs(10)))
        .https_only(true)
        // Une page d'état peut avoir déménagé (status.anthropic.com → …) : quelques redirections, en HTTPS.
        .max_redirects(3)
        .user_agent("Ondine")
        .build()
        .into();
    let mut resp = agent.get(service.url).call().ok()?;
    let text = resp.body_mut().with_config().limit(MAX_BYTES).read_to_string().ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    match service.kind {
        Kind::Statuspage => parse_statuspage(&v),
        Kind::GoogleCloud { word } => parse_google(&v, word),
    }
}

fn file() -> std::path::PathBuf {
    platform::config_dir().join("ai-status.json")
}

pub fn load_history() -> Vec<Outage> {
    std::fs::read_to_string(file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save_history(history: &[Outage]) {
    let dir = platform::config_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(json) = serde_json::to_string(history) {
        let tmp = dir.join("ai-status.json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, file());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn statuspage_levels() {
        let v = |i: &str| json!({ "page": { "id": "x" }, "status": { "indicator": i, "description": "All Systems Operational" } });
        assert_eq!(parse_statuspage(&v("none")).unwrap().0, Level::Ok);
        assert_eq!(parse_statuspage(&v("minor")).unwrap().0, Level::Degraded);
        assert_eq!(parse_statuspage(&v("maintenance")).unwrap().0, Level::Degraded);
        assert_eq!(parse_statuspage(&v("major")).unwrap().0, Level::Down);
        assert_eq!(parse_statuspage(&v("critical")).unwrap(), (Level::Down, "All Systems Operational".into()));
        assert_eq!(parse_statuspage(&v("autre")), None);
        assert_eq!(parse_statuspage(&json!({ "oops": 1 })), None);
    }

    #[test]
    fn google_incidents_about_gemini() {
        let v = json!([
            { "external_desc": "BigQuery lent", "end": null, "status_impact": "SERVICE_OUTAGE", "affected_products": [{ "title": "BigQuery" }] },
            { "external_desc": "Ancien incident", "end": "2026-10-01T10:00:00Z", "status_impact": "SERVICE_OUTAGE", "affected_products": [{ "title": "Vertex Gemini API" }] },
            { "external_desc": "Erreurs 503 sur Gemini", "status_impact": "SERVICE_DISRUPTION", "affected_products": [{ "title": "Vertex Gemini API" }] }
        ]);
        assert_eq!(parse_google(&v, "gemini").unwrap(), (Level::Degraded, "Erreurs 503 sur Gemini".into()));
        let calm = json!([{ "end": "2026-10-01T10:00:00Z", "affected_products": [{ "title": "Gemini" }] }]);
        assert_eq!(parse_google(&calm, "gemini").unwrap().0, Level::Ok);
        let info = json!([{ "end": null, "status_impact": "SERVICE_INFORMATION", "affected_products": [{ "title": "Gemini" }] }]);
        assert_eq!(parse_google(&info, "gemini").unwrap().0, Level::Ok);
        assert_eq!(parse_google(&json!({}), "gemini"), None);
    }

    #[test]
    fn outages_are_tracked_for_seven_days() {
        let mut h = Vec::new();
        // Premier coup d'œil : déjà en panne, on note sans alerter.
        assert!(!track(&mut h, "claude", None, Level::Degraded, 1_000));
        assert_eq!(h.len(), 1);
        // S'aggrave : même panne, pire niveau, pas de nouvelle alerte.
        assert!(!track(&mut h, "claude", Some(Level::Degraded), Level::Down, 2_000));
        assert_eq!(h[0].level, Level::Down);
        // Lecture ratée : rien ne change.
        assert!(!track(&mut h, "claude", Some(Level::Down), Level::Unknown, 3_000));
        assert_eq!(h[0].to, None);
        // Revient : la panne se ferme, on prévient.
        assert!(track(&mut h, "claude", Some(Level::Down), Level::Ok, 4_000));
        assert_eq!(h[0].to, Some(4_000));
        // Une nouvelle panne : on prévient.
        assert!(track(&mut h, "chatgpt", Some(Level::Ok), Level::Down, 5_000));
        // 8 jours plus tard : la panne finie de Claude est oubliée, celle en cours reste.
        let later = 4_000 + 8 * 86_400_000;
        assert!(!track(&mut h, "gemini", Some(Level::Ok), Level::Ok, later));
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].id, "chatgpt");
    }
}
