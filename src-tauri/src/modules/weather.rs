// Module « Météo » : la température et le temps qu'il fait dans ta ville.
//
// DÉSACTIVÉ PAR DÉFAUT : tant que le réglage « Afficher la météo » n'est pas
// coché et qu'aucune ville n'est saisie, rien ne part sur Internet.
//
// Service : Open-Meteo (gratuit, sans clé, sans compte), en HTTPS seulement :
//   1. geocoding-api.open-meteo.com : le nom de la ville → ses coordonnées
//      (une fois, quand la ville change) ;
//   2. api.open-meteo.com : la météo actuelle à ces coordonnées, ARRONDIES à
//      2 décimales (environ 1 km), au plus toutes les 30 minutes.
// Une erreur (pas d'Internet, service indisponible) est notée dans le journal,
// sans le nom de la ville, et l'île n'affiche simplement rien.
//
// Le front (src/modules/weather/) demande la dernière météo avec `current`
// quand `weather.changed` arrive.

use crate::sync::LockExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::services::log;

const ID: &str = "weather";
const GEOCODE_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
/// Au plus une demande de météo toutes les 30 minutes.
const REFRESH_EVERY: Duration = Duration::from_secs(30 * 60);
/// Après un changement de ville ou d'unité : pas plus d'un essai par minute.
const RETRY_AFTER_CHANGE: Duration = Duration::from_secs(60);
/// Le fil regarde les réglages à ce rythme (sans rien demander à Internet).
const TICK: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(8);
/// Une réponse plus grosse que ça n'est pas une réponse d'Open-Meteo.
const MAX_BYTES: u64 = 256 * 1024;

/// Une ville trouvée par le géocodage.
#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    pub name: String,
    pub country: String,
    pub lat: f64,
    pub lon: f64,
}

/// La météo envoyée au front.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub place: String,
    pub temp: f64,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Vitesse du vent en km/h (mph si l'unité est °F).
    pub wind: Option<f64>,
    /// Code météo WMO (0 = ciel dégagé, 61 = pluie…).
    pub code: u32,
    pub is_day: bool,
    pub icon: String,
    pub label: String,
    /// "c" ou "f".
    pub unit: String,
    /// L'heure de la mesure, "14:00" (heure de la ville).
    pub at: String,
}

#[derive(Default)]
struct State {
    /// La ville saisie (telle quelle) et ce que le géocodage en a trouvé.
    query: String,
    place: Option<Place>,
    unit: String,
    weather: Option<Weather>,
    /// Dernier essai (réussi ou non) : pour ne jamais demander trop souvent.
    last_try: Option<Instant>,
    /// La demande en cours vient d'un changement de réglage (essai permis plus tôt).
    changed: bool,
}

#[derive(Default)]
pub struct WeatherModule {
    state: Arc<Mutex<State>>,
}

impl RustModule for WeatherModule {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/weather/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::spawn(move || loop {
            if catch_unwind(AssertUnwindSafe(|| tick(&app, &state))).is_err() {
                log::warn("météo : erreur dans le fil de fond");
            }
            std::thread::sleep(TICK);
        });
    }

    fn invoke(&self, _ctx: &ModuleContext, command: &str, _args: Value) -> Result<Value, String> {
        match command {
            "current" => Ok(serde_json::to_value(&self.state.locked().weather).unwrap_or(Value::Null)),
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Le fil de fond ───────────────────────────────────────────────────────────

/// Ce que disent les réglages : la ville et l'unité, ou None si la météo est coupée.
fn wanted(ctx: &ModuleContext) -> Option<(String, String)> {
    let values = ctx.settings();
    let on = values.get("on").and_then(Value::as_bool).unwrap_or(false);
    let city = values.get("city").and_then(Value::as_str).unwrap_or("").trim().chars().take(80).collect::<String>();
    let unit = if values.get("unit").and_then(Value::as_str) == Some("f") { "f" } else { "c" };
    (on && !city.is_empty()).then(|| (city, unit.to_string()))
}

fn tick(app: &AppHandle, state: &Mutex<State>) {
    // Module désactivé, ou météo coupée : on oublie tout (et on le dit une fois).
    let Some(Some((city, unit))) = super::with_context(app, ID, wanted) else {
        let had = {
            let mut s = state.locked();
            let had = s.weather.is_some() || s.place.is_some();
            *s = State::default();
            had
        };
        if had {
            super::with_context(app, ID, |ctx| ctx.emit("weather.changed", json!({ "ok": false })));
        }
        return;
    };

    // Est-ce le moment de demander ?
    let need_place = {
        let mut s = state.locked();
        if s.query != city || s.unit != unit {
            if s.query != city {
                s.place = None;
            }
            s.query = city.clone();
            s.unit = unit.clone();
            s.changed = true;
        }
        let wait = if s.changed { RETRY_AFTER_CHANGE } else { REFRESH_EVERY };
        if s.last_try.is_some_and(|t| t.elapsed() < wait) {
            return;
        }
        s.last_try = Some(Instant::now());
        s.changed = false;
        s.place.is_none()
    };

    // 1. La ville → ses coordonnées (seulement quand elle change).
    if need_place {
        match geocode(&city) {
            Ok(Some(place)) => state.locked().place = Some(place),
            Ok(None) => {
                log::warn("météo : ville introuvable");
                return;
            }
            Err(e) => {
                log::warn(format!("météo : géocodage impossible ({e})"));
                return;
            }
        }
    }
    let Some(place) = state.locked().place.clone() else { return };

    // 2. La météo à ces coordonnées.
    match forecast(&place, &unit) {
        Ok(w) => {
            state.locked().weather = Some(w);
            super::with_context(app, ID, |ctx| ctx.emit("weather.changed", json!({ "ok": true })));
        }
        Err(e) => log::warn(format!("météo : demande impossible ({e})")),
    }
}

// ── Les demandes à Open-Meteo ───────────────────────────────────────────────

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        // Le TLS de Windows et ses certificats (comme « Demander à Claude »).
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .https_only(true)
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT))
        .build()
        .into()
}

fn get(request: ureq::RequestBuilder<ureq::typestate::WithoutBody>) -> Result<String, String> {
    // On ne recopie pas le message de ureq : il contient l'adresse (donc la ville).
    let mut resp = request.call().map_err(|_| "injoignable (pas de connexion Internet ?)".to_string())?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(format!("le service a répondu {status}"));
    }
    resp.body_mut().with_config().limit(MAX_BYTES).read_to_string().map_err(|_| "réponse illisible".to_string())
}

/// « Lyon » ou « Lyon, FR » (code pays sur deux lettres) → la première ville trouvée.
fn geocode(city: &str) -> Result<Option<Place>, String> {
    let (name, country) = split_city(city);
    let mut req = agent().get(GEOCODE_URL).query("name", name).query("count", "1").query("language", "fr").query("format", "json");
    if let Some(cc) = country {
        req = req.query("countryCode", cc);
    }
    parse_geocode(&get(req)?)
}

fn forecast(place: &Place, unit: &str) -> Result<Weather, String> {
    let mut req = agent()
        .get(FORECAST_URL)
        .query("latitude", round2(place.lat))
        .query("longitude", round2(place.lon))
        .query("current", "temperature_2m,weather_code,is_day,wind_speed_10m")
        .query("daily", "temperature_2m_max,temperature_2m_min")
        .query("forecast_days", "1")
        .query("timezone", "auto");
    if unit == "f" {
        req = req.query("temperature_unit", "fahrenheit").query("wind_speed_unit", "mph");
    }
    let mut w = parse_forecast(&get(req)?)?;
    w.place = place.name.clone();
    w.unit = unit.to_string();
    Ok(w)
}

// ── Logique pure (testée) ────────────────────────────────────────────────────

/// Coordonnée arrondie à 2 décimales, en texte : 48.85341 → "48.85".
pub fn round2(x: f64) -> String {
    format!("{:.2}", (x * 100.0).round() / 100.0)
}

/// « Lyon, FR » → ("Lyon", Some("FR")) ; « Saint-Denis, La Réunion » → tout est le nom.
pub fn split_city(city: &str) -> (&str, Option<String>) {
    if let Some((name, cc)) = city.rsplit_once(',') {
        let cc = cc.trim();
        if cc.len() == 2 && cc.chars().all(|c| c.is_ascii_alphabetic()) && !name.trim().is_empty() {
            return (name.trim(), Some(cc.to_ascii_uppercase()));
        }
    }
    (city.trim(), None)
}

#[derive(Deserialize)]
struct GeoResponse {
    #[serde(default)]
    results: Vec<GeoResult>,
}

#[derive(Deserialize)]
struct GeoResult {
    name: String,
    latitude: f64,
    longitude: f64,
    #[serde(default)]
    country: String,
}

/// La réponse du géocodage → la première ville (None : rien trouvé).
pub fn parse_geocode(text: &str) -> Result<Option<Place>, String> {
    let r: GeoResponse = serde_json::from_str(text).map_err(|_| "réponse du géocodage illisible".to_string())?;
    Ok(r
        .results
        .into_iter()
        .find(|g| g.latitude.is_finite() && g.longitude.is_finite())
        .map(|g| Place { name: g.name.chars().take(60).collect(), country: g.country, lat: g.latitude, lon: g.longitude }))
}

#[derive(Deserialize)]
struct ForecastResponse {
    current: Current,
    #[serde(default)]
    daily: Option<Daily>,
}

#[derive(Deserialize)]
struct Current {
    #[serde(default)]
    time: String,
    temperature_2m: f64,
    #[serde(default)]
    weather_code: u32,
    #[serde(default)]
    is_day: Option<u8>,
    #[serde(default)]
    wind_speed_10m: Option<f64>,
}

#[derive(Deserialize)]
struct Daily {
    #[serde(default)]
    temperature_2m_max: Vec<Option<f64>>,
    #[serde(default)]
    temperature_2m_min: Vec<Option<f64>>,
}

/// La réponse de la météo → `Weather` (sans la ville ni l'unité, ajoutées après).
pub fn parse_forecast(text: &str) -> Result<Weather, String> {
    let r: ForecastResponse = serde_json::from_str(text).map_err(|_| "réponse de la météo illisible".to_string())?;
    let c = r.current;
    if !c.temperature_2m.is_finite() {
        return Err("température absente".into());
    }
    let is_day = c.is_day.unwrap_or(1) != 0;
    let (icon, label) = describe(c.weather_code, is_day);
    let first = |v: Option<&Vec<Option<f64>>>| v.and_then(|v| v.first().copied().flatten());
    // "2026-10-06T14:00" → "14:00"
    let at = c.time.split_once('T').map(|(_, t)| t.chars().take(5).collect()).unwrap_or_default();
    Ok(Weather {
        place: String::new(),
        temp: c.temperature_2m,
        min: first(r.daily.as_ref().map(|d| &d.temperature_2m_min)),
        max: first(r.daily.as_ref().map(|d| &d.temperature_2m_max)),
        wind: c.wind_speed_10m,
        code: c.weather_code,
        is_day,
        icon: icon.to_string(),
        label: label.to_string(),
        unit: "c".into(),
        at,
    })
}

/// Code météo WMO → icône et description.
pub fn describe(code: u32, is_day: bool) -> (&'static str, &'static str) {
    match code {
        0 => (if is_day { "☀️" } else { "🌙" }, "Ciel dégagé"),
        1 => (if is_day { "🌤️" } else { "🌙" }, "Plutôt dégagé"),
        2 => ("⛅", "Partiellement nuageux"),
        3 => ("☁️", "Couvert"),
        45 | 48 => ("🌫️", "Brouillard"),
        51 | 53 | 55 => ("🌦️", "Bruine"),
        56 | 57 | 66 | 67 => ("🌧️", "Pluie verglaçante"),
        61 | 63 | 65 => ("🌧️", "Pluie"),
        71 | 73 | 75 | 77 => ("🌨️", "Neige"),
        80..=82 => ("🌦️", "Averses"),
        85 | 86 => ("🌨️", "Averses de neige"),
        95 => ("⛈️", "Orage"),
        96 | 99 => ("⛈️", "Orage avec grêle"),
        _ => ("🌡️", "Météo"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Des réponses réelles d'Open-Meteo, raccourcies et figées ici.
    const GEOCODE: &str = r#"{"results":[{"id":2988507,"name":"Paris","latitude":48.85341,"longitude":2.3488,"elevation":42.0,"feature_code":"PPLC","country_code":"FR","admin1_id":3012874,"timezone":"Europe/Paris","population":2138551,"country_id":3017382,"country":"France","admin1":"Île-de-France"}],"generationtime_ms":0.7}"#;
    const FORECAST: &str = r#"{"latitude":48.86,"longitude":2.3399997,"generationtime_ms":0.05,"utc_offset_seconds":7200,"timezone":"Europe/Paris","timezone_abbreviation":"GMT+2","elevation":43.0,"current_units":{"time":"iso8601","interval":"seconds","temperature_2m":"°C","weather_code":"wmo code","is_day":"","wind_speed_10m":"km/h"},"current":{"time":"2026-10-06T14:00","interval":900,"temperature_2m":17.3,"weather_code":3,"is_day":1,"wind_speed_10m":12.4},"daily_units":{"time":"iso8601","temperature_2m_max":"°C","temperature_2m_min":"°C"},"daily":{"time":["2026-10-06"],"temperature_2m_max":[19.1],"temperature_2m_min":[10.2]}}"#;

    #[test]
    fn geocode_response_is_read() {
        let p = parse_geocode(GEOCODE).unwrap().unwrap();
        assert_eq!(p.name, "Paris");
        assert_eq!(p.country, "France");
        assert_eq!(round2(p.lat), "48.85");
        assert_eq!(round2(p.lon), "2.35");
    }

    #[test]
    fn unknown_city_gives_nothing() {
        // Open-Meteo ne met pas de « results » quand il ne trouve rien.
        assert_eq!(parse_geocode(r#"{"generationtime_ms":0.3}"#).unwrap(), None);
        assert!(parse_geocode("<html>").is_err());
    }

    #[test]
    fn forecast_response_is_read() {
        let w = parse_forecast(FORECAST).unwrap();
        assert_eq!(w.temp, 17.3);
        assert_eq!(w.code, 3);
        assert_eq!(w.label, "Couvert");
        assert!(w.is_day);
        assert_eq!(w.min, Some(10.2));
        assert_eq!(w.max, Some(19.1));
        assert_eq!(w.wind, Some(12.4));
        assert_eq!(w.at, "14:00");
    }

    #[test]
    fn forecast_without_daily_or_with_nulls() {
        let text = r#"{"current":{"time":"2026-10-06T23:15","temperature_2m":-2.0,"weather_code":0,"is_day":0},"daily":{"temperature_2m_max":[null],"temperature_2m_min":[]}}"#;
        let w = parse_forecast(text).unwrap();
        assert_eq!(w.icon, "🌙");
        assert_eq!(w.min, None);
        assert_eq!(w.max, None);
        assert_eq!(w.wind, None);
        assert!(parse_forecast(r#"{"error":true,"reason":"Latitude must be in range"}"#).is_err());
    }

    #[test]
    fn coordinates_are_rounded() {
        assert_eq!(round2(45.764043), "45.76");
        assert_eq!(round2(-0.005), "-0.01");
        assert_eq!(round2(4.0), "4.00");
    }

    #[test]
    fn city_with_country_code() {
        assert_eq!(split_city("Lyon, fr"), ("Lyon", Some("FR".to_string())));
        assert_eq!(split_city(" Lyon "), ("Lyon", None));
        assert_eq!(split_city("Saint-Denis, La Réunion"), ("Saint-Denis, La Réunion", None));
    }

    #[test]
    fn weather_codes_have_a_label() {
        assert_eq!(describe(61, true).1, "Pluie");
        assert_eq!(describe(95, false).0, "⛈️");
        assert_eq!(describe(1234, true).1, "Météo");
    }
}
