// Le calendrier de contributions GitHub de l'onglet Agents IA : la grille
// 53 × 7 du profil (« 336 contributions in the last year »), relue par l'île.
//
// La SEULE fonction de l'onglet qui parle à Internet, et seulement si un
// identifiant GitHub est saisi dans les réglages. Rien d'autre ne part que cet
// identifiant (et le jeton, s'il y en a un, dans l'en-tête d'autorisation).
//
// Deux sources, selon qu'un jeton est rangé dans le coffre Windows (clé
// « github-token », voir services/credentials.rs) :
//   - sans jeton : la page HTML que GitHub sert pour le calendrier du profil,
//     https://github.com/users/<login>/contributions (les contributions
//     publiques, les mêmes que sur le profil). Un parseur tolérant, à base de
//     recherche de balises (pas de parseur HTML) : des cases `<td … data-date
//     data-level>` et leur bulle `<tool-tip for="…">3 contributions on …`.
//   - avec un jeton (lecture seule, read:user) : l'API GraphQL, qui compte
//     aussi les contributions privées.
//
// Limites : au plus une demande toutes les 30 minutes (par identifiant, en
// mémoire), 10 s, 2 Mo ; aucune demande pendant une présentation ou le mode
// concentration (le calendrier déjà lu est montré). Une copie sur disque
// (github-calendar.json dans le dossier de données) sert d'affichage immédiat
// au démarrage, avant la première demande. Le journal ne reçoit jamais le
// contenu : seulement « calendrier GitHub : lu, N jours ».
//
// Ce fichier ne dépend pas du reste de l'appli (pas de `crate::`) : il se teste
// seul (cargo test dans un crate scratch, voir commun.md).

use std::path::Path;
use std::time::{Duration, Instant};

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// La clé du jeton dans le Gestionnaire d'identifiants Windows.
pub const TOKEN_KEY: &str = "github-token";
/// Au plus une demande toutes les 30 minutes.
pub const REFRESH_EVERY: Duration = Duration::from_secs(30 * 60);
/// Après une erreur (pas d'Internet…) : pas plus d'un essai toutes les 2 minutes.
const RETRY_AFTER_ERROR: Duration = Duration::from_secs(2 * 60);
const TIMEOUT: Duration = Duration::from_secs(10);
/// La page du calendrier fait ~150 Ko ; au-delà de 2 Mo, ce n'est pas elle.
const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// La grille du profil : 53 colonnes de 7 jours (la semaine en cours comprise).
pub const WEEKS: u32 = 53;
/// Un identifiant GitHub : 39 caractères au plus.
const MAX_LOGIN: usize = 39;

const HTML_URL: &str = "https://github.com/users/";
const GRAPHQL_URL: &str = "https://api.github.com/graphql";
const QUERY: &str = "query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } } }";

/// Un jour du calendrier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Day {
    /// « 2025-10-08 »
    pub date: String,
    pub count: u32,
    /// 0 (rien) à 4 (le plus), comme les 5 verts de GitHub.
    pub level: u8,
}

/// Ce que reçoit le front.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub login: String,
    /// Contributions sur la période (le total de GitHub avec un jeton, sinon la somme des cases).
    pub total: u32,
    /// Jours d'affilée avec au moins une contribution, aujourd'hui compris (ou jusqu'à hier si rien encore aujourd'hui).
    pub streak: u32,
    /// Les contributions d'aujourd'hui.
    pub today: u32,
    /// Du dimanche d'il y a 52 semaines à aujourd'hui, sans trou (les jours manquants comptent 0).
    pub days: Vec<Day>,
    /// Quand GitHub a répondu (ms depuis 1970).
    pub fetched_at: u64,
    /// Lu avec un jeton (contributions privées comprises).
    #[serde(default)]
    pub private: bool,
}

/// Le calendrier en mémoire, par identifiant.
#[derive(Default)]
pub struct Cache {
    /// « login:avec-jeton » : si ça change, on repart de zéro.
    key: String,
    calendar: Option<Calendar>,
    /// Dernière réponse de GitHub (None : jamais, ou seulement la copie du disque).
    fetched: Option<Instant>,
    /// Dernier essai raté.
    failed: Option<Instant>,
    disk_read: bool,
}

/// Un identifiant GitHub plausible : lettres, chiffres, tirets, 39 au plus,
/// sans tiret au début (c'est aussi ce qui garantit une adresse propre).
pub fn is_login(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_LOGIN && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Ce que demande l'onglet.
pub struct Request<'a> {
    pub login: &'a str,
    pub token: Option<&'a str>,
    /// Présentation ou concentration en cours : aucune demande à Internet.
    pub busy: bool,
    /// La copie sur disque (affichage immédiat au démarrage).
    pub disk: &'a Path,
}

/// Le calendrier, et s'il vient de la mémoire (vrai : rien n'a été demandé à
/// GitHub, le bouton ↻ dit « déjà à jour »).
pub fn read(cache: &mut Cache, req: Request<'_>) -> Result<(Calendar, bool), String> {
    if !is_login(req.login) {
        return Err("identifiant GitHub refusé : lettres, chiffres et tirets, 39 caractères au plus".into());
    }
    let key = format!("{}:{}", req.login, req.token.is_some());
    if cache.key != key {
        *cache = Cache { key, ..Cache::default() };
    }
    if cache.calendar.is_none() && !cache.disk_read {
        cache.disk_read = true;
        if let Some(cal) = load(req.disk).filter(|c| c.login == req.login && c.private == req.token.is_some()) {
            cache.calendar = Some(cal);
        }
    }
    let fresh = cache.fetched.is_some_and(|t| t.elapsed() < REFRESH_EVERY);
    let just_failed = cache.failed.is_some_and(|t| t.elapsed() < RETRY_AFTER_ERROR);
    if fresh || just_failed || req.busy {
        return match &cache.calendar {
            Some(cal) => Ok((cal.clone(), true)),
            None if req.busy => Err("pas de demande pendant une présentation ou la concentration".into()),
            None => Err("GitHub n'a pas répondu ; nouvel essai dans deux minutes".into()),
        };
    }
    match fetch(req.login, req.token) {
        Ok((days, total)) => {
            let cal = build(req.login, days, total, today(), req.token.is_some(), now_ms());
            cache.fetched = Some(Instant::now());
            cache.failed = None;
            save(req.disk, &cal);
            cache.calendar = Some(cal.clone());
            Ok((cal, false))
        }
        Err(e) => {
            cache.failed = Some(Instant::now());
            Err(e)
        }
    }
}

// ── Les demandes à GitHub ────────────────────────────────────────────────────

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        // Le TLS de Windows et ses certificats (comme la météo).
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .https_only(true)
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT))
        .user_agent("Ondine")
        .build()
        .into()
}

/// Le corps d'une réponse 200, ou une erreur qui ne recopie jamais l'adresse
/// (elle contient l'identifiant) ni le message de ureq.
fn body(mut resp: ureq::http::Response<ureq::Body>) -> Result<String, String> {
    match resp.status().as_u16() {
        200 => resp.body_mut().with_config().limit(MAX_BYTES).read_to_string().map_err(|_| "réponse illisible ou trop grosse".to_string()),
        404 => Err("identifiant inconnu sur GitHub".into()),
        401 => Err("jeton refusé par GitHub".into()),
        403 | 429 => Err("GitHub demande d'attendre (trop de demandes)".into()),
        status => Err(format!("GitHub a répondu {status}")),
    }
}

/// Les jours (et le total, avec un jeton) lus chez GitHub.
fn fetch(login: &str, token: Option<&str>) -> Result<(Vec<Day>, Option<u32>), String> {
    let unreachable = |_| "github.com injoignable (pas de connexion Internet ?)".to_string();
    match token {
        Some(token) => {
            let payload = json!({ "query": QUERY, "variables": { "login": login } });
            let resp = agent()
                .post(GRAPHQL_URL)
                .header("Authorization", format!("bearer {}", token.trim()))
                .header("Content-Type", "application/json")
                .send(payload.to_string().as_bytes())
                .map_err(unreachable)?;
            let (days, total) = parse_graphql(&body(resp)?)?;
            Ok((days, Some(total)))
        }
        None => {
            let resp = agent().get(format!("{HTML_URL}{login}/contributions")).header("Accept", "text/html").call().map_err(unreachable)?;
            Ok((parse_html(&body(resp)?)?, None))
        }
    }
}

// ── Logique pure (testée) ────────────────────────────────────────────────────

/// La valeur d'un attribut dans le texte d'une balise : `attr(tag, "data-date")`.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(i) = tag[from..].find(name) {
        let at = from + i;
        let before_ok = at == 0 || tag.as_bytes()[at - 1].is_ascii_whitespace();
        let rest = &tag[at + name.len()..];
        if before_ok && rest.starts_with("=\"") {
            return rest[2..].split('"').next();
        }
        from = at + name.len();
    }
    None
}

/// Les balises `<name …>` du texte, l'une après l'autre (leur contenu entre `<` et `>`).
fn tags<'a>(html: &'a str, name: &str) -> impl Iterator<Item = (usize, &'a str)> {
    let open = format!("<{name}");
    let mut from = 0;
    std::iter::from_fn(move || {
        let i = from + html[from..].find(&open)?;
        let start = i + open.len();
        // Une balise dont le nom continue (« <tool-tips ») n'est pas la nôtre.
        if !html[start..].starts_with(|c: char| c.is_ascii_whitespace() || c == '>' || c == '/') {
            from = start;
            return Some((i, ""));
        }
        let end = start + html[start..].find('>')?;
        from = end + 1;
        Some((end + 1, &html[start..end]))
    })
}

/// « 2025-10-08 », rien d'autre.
fn is_date(s: &str) -> bool {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

/// La page HTML du calendrier → les jours trouvés (dans l'ordre de la page).
///
/// Chaque case est un `<td id="contribution-day-component-X-Y" data-date="…"
/// data-level="N" …>` ; son nombre est dans `<tool-tip for="…id…">3
/// contributions on October 8th.</tool-tip>` (« No contributions » = 0), ou
/// dans un ancien `data-count`. Sans bulle, le niveau sert de nombre.
pub fn parse_html(html: &str) -> Result<Vec<Day>, String> {
    // 1. Les bulles : id de la case → nombre.
    let mut counts: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    for (after, tag) in tags(html, "tool-tip") {
        let Some(id) = attr(tag, "for") else { continue };
        let text = html[after..].split('<').next().unwrap_or("");
        if let Some(n) = count_in(text) {
            counts.insert(id, n);
        }
    }
    // 2. Les cases.
    let mut days = Vec::new();
    for (_, tag) in tags(html, "td") {
        let (Some(date), Some(level)) = (attr(tag, "data-date"), attr(tag, "data-level")) else { continue };
        if !is_date(date) {
            continue;
        }
        let level = level.trim().parse::<u8>().unwrap_or(0).min(4);
        let count = attr(tag, "data-count")
            .and_then(|c| c.trim().parse().ok())
            .or_else(|| attr(tag, "id").and_then(|id| counts.get(id).copied()))
            .unwrap_or(u32::from(level));
        days.push(Day { date: date.to_string(), count, level });
    }
    if days.is_empty() {
        return Err("page du calendrier illisible (GitHub l'a peut-être changée)".into());
    }
    Ok(days)
}

/// « 3 contributions on October 8th. » → 3 ; « No contributions on … » → 0.
fn count_in(text: &str) -> Option<u32> {
    let text = text.trim();
    let first = text.split_whitespace().next()?;
    if first.eq_ignore_ascii_case("no") {
        return Some(0);
    }
    // GitHub écrit « 1,234 contributions » au-delà de 999.
    first.replace(',', "").parse().ok()
}

#[derive(Deserialize)]
struct GraphQl {
    #[serde(default)]
    data: Option<GqlData>,
    #[serde(default)]
    errors: Vec<Value>,
}
#[derive(Deserialize)]
struct GqlData {
    user: Option<GqlUser>,
}
#[derive(Deserialize)]
struct GqlUser {
    #[serde(rename = "contributionsCollection")]
    collection: GqlCollection,
}
#[derive(Deserialize)]
struct GqlCollection {
    #[serde(rename = "contributionCalendar")]
    calendar: GqlCalendar,
}
#[derive(Deserialize)]
struct GqlCalendar {
    #[serde(rename = "totalContributions")]
    total: u32,
    weeks: Vec<GqlWeek>,
}
#[derive(Deserialize)]
struct GqlWeek {
    #[serde(rename = "contributionDays")]
    days: Vec<GqlDay>,
}
#[derive(Deserialize)]
struct GqlDay {
    date: String,
    #[serde(rename = "contributionCount")]
    count: u32,
    #[serde(rename = "contributionLevel", default)]
    level: String,
}

/// La réponse GraphQL → (les jours, le total annoncé par GitHub).
pub fn parse_graphql(text: &str) -> Result<(Vec<Day>, u32), String> {
    let r: GraphQl = serde_json::from_str(text).map_err(|_| "réponse GraphQL illisible".to_string())?;
    let user = r.data.and_then(|d| d.user).ok_or_else(|| {
        // Le message de GitHub n'est pas recopié (il répète l'identifiant).
        let not_found = r.errors.iter().any(|e| e.get("type").and_then(Value::as_str) == Some("NOT_FOUND"));
        if not_found {
            "identifiant inconnu sur GitHub".to_string()
        } else {
            "GitHub a refusé la demande (jeton sans le droit read:user ?)".to_string()
        }
    })?;
    let calendar = user.collection.calendar;
    let days = calendar
        .weeks
        .into_iter()
        .flat_map(|w| w.days)
        .filter(|d| is_date(&d.date))
        .map(|d| Day { level: level_from_name(&d.level), date: d.date, count: d.count })
        .collect();
    Ok((days, calendar.total))
}

/// « THIRD_QUARTILE » → 3.
fn level_from_name(name: &str) -> u8 {
    match name {
        "FIRST_QUARTILE" => 1,
        "SECOND_QUARTILE" => 2,
        "THIRD_QUARTILE" => 3,
        "FOURTH_QUARTILE" => 4,
        _ => 0,
    }
}

/// Le premier jour de la grille : le dimanche d'il y a 52 semaines (53 colonnes, la semaine en cours comprise).
pub fn grid_start(today: NaiveDate) -> NaiveDate {
    let this_sunday = today - chrono::Days::new(u64::from(today.weekday().num_days_from_sunday()));
    this_sunday - chrono::Days::new(u64::from((WEEKS - 1) * 7))
}

/// Les jours lus → le calendrier complet : la grille sans trou, le total, la série.
pub fn build(login: &str, days: Vec<Day>, total: Option<u32>, today: NaiveDate, private: bool, fetched_at: u64) -> Calendar {
    let mut by_date: std::collections::BTreeMap<String, Day> = std::collections::BTreeMap::new();
    for d in days {
        by_date.insert(d.date.clone(), d);
    }
    let start = grid_start(today);
    let mut out = Vec::new();
    let mut date = start;
    while date <= today {
        let key = date.format("%Y-%m-%d").to_string();
        out.push(by_date.remove(&key).unwrap_or(Day { date: key, count: 0, level: 0 }));
        date = date + chrono::Days::new(1);
    }
    let today_count = out.last().map(|d| d.count).unwrap_or(0);
    Calendar {
        login: login.to_string(),
        total: total.unwrap_or_else(|| out.iter().map(|d| d.count).sum()),
        streak: streak(&out),
        today: today_count,
        days: out,
        fetched_at,
        private,
    }
}

/// Les jours d'affilée avec une contribution, en partant de la fin (le dernier
/// jour est aujourd'hui) ; une journée encore vide aujourd'hui ne casse pas la série.
pub fn streak(days: &[Day]) -> u32 {
    let mut it = days.iter().rev().peekable();
    if it.peek().is_some_and(|d| d.count == 0) {
        it.next();
    }
    it.take_while(|d| d.count > 0).count() as u32
}

fn today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ── La copie sur disque ─────────────────────────────────────────────────────

/// Relit la copie (un fichier abîmé ou absent : rien, sans bruit).
fn load(path: &Path) -> Option<Calendar> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Enregistre via un fichier temporaire renommé (jamais de fichier à moitié écrit).
fn save(path: &Path, cal: &Calendar) {
    let Some(dir) = path.parent() else { return };
    let tmp = path.with_extension("json.tmp");
    let ok = std::fs::create_dir_all(dir).is_ok()
        && serde_json::to_string(cal).ok().and_then(|json| std::fs::write(&tmp, json).ok()).is_some()
        && std::fs::rename(&tmp, path).is_ok();
    if !ok {
        let _ = std::fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un extrait de la page https://github.com/users/<login>/contributions,
    /// d'après la structure connue de la page (à vérifier sous Windows avec la
    /// vraie page : voir le rapport).
    const HTML: &str = r#"<div class="js-yearly-contributions"><h2 class="f4 text-normal mb-2">
336 contributions
        in the last year
</h2>
<table class="ContributionCalendar-grid js-calendar-graph-table">
<thead><tr style="height: 13px"><td style="width: 28px"><span class="sr-only">Day of Week</span></td>
<td class="ContributionCalendar-label" colspan="4"><span class="sr-only">October</span><span aria-hidden="true" style="position: absolute; top: 0">Oct</span></td></tr></thead>
<tbody><tr style="height: 10px">
<td class="ContributionCalendar-label" style="position: relative"><span class="sr-only">Sunday</span></td>
<td tabindex="0" data-ix="0" aria-selected="false" aria-describedby="contribution-graph-legend-level-0" style="width: 10px" data-date="2025-10-05" id="contribution-day-component-0-40" data-level="0" role="gridcell" class="ContributionCalendar-day" aria-labelledby="tooltip-6e7c"></td>
<td tabindex="-1" data-ix="1" aria-selected="false" aria-describedby="contribution-graph-legend-level-2" style="width: 10px" data-date="2025-10-06" id="contribution-day-component-1-40" data-level="2" role="gridcell" class="ContributionCalendar-day"></td>
<td tabindex="-1" data-ix="2" data-date="2025-10-07" id="contribution-day-component-2-40" data-level="4" role="gridcell" class="ContributionCalendar-day"></td>
<td tabindex="-1" data-ix="3" data-date="2025-10-08" id="contribution-day-component-3-40" data-level="2" role="gridcell" class="ContributionCalendar-day"></td>
<td tabindex="-1" data-ix="4" data-date="2025-10-09" id="contribution-day-component-4-40" data-level="1" role="gridcell" class="ContributionCalendar-day" data-count="1"></td>
<td class="ContributionCalendar-day" data-date="pas-une-date" data-level="3"></td>
</tr></tbody></table>
<tool-tip id="tooltip-6e7c" for="contribution-day-component-0-40" popover="manual" data-direction="n" data-type="label" data-view-component="true" class="sr-only position-absolute">No contributions on October 5th.</tool-tip>
<tool-tip for="contribution-day-component-1-40" popover="manual" data-direction="n" class="sr-only position-absolute">3 contributions on October 6th.</tool-tip>
<tool-tip for="contribution-day-component-2-40" popover="manual" class="sr-only position-absolute">1,024 contributions on October 7th.</tool-tip>
<tool-tip for="contribution-day-component-3-40" class="sr-only position-absolute">3 contributions on October 8th.</tool-tip>
<tool-tips for="rien">bruit</tool-tips>
</div>"#;

    const GRAPHQL: &str = r#"{"data":{"user":{"contributionsCollection":{"contributionCalendar":{"totalContributions":336,"weeks":[{"contributionDays":[{"date":"2025-10-05","contributionCount":0,"contributionLevel":"NONE"},{"date":"2025-10-06","contributionCount":3,"contributionLevel":"SECOND_QUARTILE"},{"date":"2025-10-07","contributionCount":12,"contributionLevel":"FOURTH_QUARTILE"}]},{"contributionDays":[{"date":"2025-10-08","contributionCount":2,"contributionLevel":"FIRST_QUARTILE"}]}]}}}}}"#;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn html_page_is_read() {
        let days = parse_html(HTML).unwrap();
        assert_eq!(days.len(), 5, "la case sans date valide est ignorée");
        assert_eq!(days[0], Day { date: "2025-10-05".into(), count: 0, level: 0 });
        assert_eq!(days[1], Day { date: "2025-10-06".into(), count: 3, level: 2 });
        // « 1,024 contributions »
        assert_eq!(days[2].count, 1024);
        assert_eq!(days[3], Day { date: "2025-10-08".into(), count: 3, level: 2 });
        // data-count direct, sans bulle.
        assert_eq!(days[4].count, 1);
    }

    #[test]
    fn html_without_tooltips_falls_back_on_level() {
        let html = r#"<td data-date="2025-01-02" data-level="3"></td><td data-date="2025-01-03" data-level="0"></td>"#;
        let days = parse_html(html).unwrap();
        assert_eq!(days[0].count, 3);
        assert_eq!(days[1].count, 0);
        // Un niveau farfelu est ramené à 4.
        assert_eq!(parse_html(r#"<td data-date="2025-01-02" data-level="9">"#).unwrap()[0].level, 4);
    }

    #[test]
    fn html_without_calendar_is_an_error() {
        assert!(parse_html("<html><body>Not Found</body></html>").is_err());
        assert!(parse_html("").is_err());
        assert!(parse_html(r#"<td data-date="2025-01-02">"#).is_err(), "pas de niveau");
    }

    #[test]
    fn attributes_are_found_whole_words_only() {
        let tag = r#" data-ix="4" xdata-date="non" data-date="2025-10-09" id="a-b""#;
        assert_eq!(attr(tag, "data-date"), Some("2025-10-09"));
        assert_eq!(attr(tag, "id"), Some("a-b"));
        assert_eq!(attr(tag, "data-level"), None);
        assert_eq!(count_in(" No contributions on May 1st."), Some(0));
        assert_eq!(count_in("12 contributions on May 1st."), Some(12));
        assert_eq!(count_in("Loading"), None);
    }

    #[test]
    fn graphql_response_is_read() {
        let (days, total) = parse_graphql(GRAPHQL).unwrap();
        assert_eq!(total, 336);
        assert_eq!(days.len(), 4);
        assert_eq!(days[1], Day { date: "2025-10-06".into(), count: 3, level: 2 });
        assert_eq!(days[2].level, 4);
        assert_eq!(days[3].level, 1);
    }

    #[test]
    fn graphql_errors_do_not_repeat_the_login() {
        let text = r#"{"data":{"user":null},"errors":[{"type":"NOT_FOUND","path":["user"],"message":"Could not resolve to a User with the login of 'simon-x'."}]}"#;
        let err = parse_graphql(text).unwrap_err();
        assert_eq!(err, "identifiant inconnu sur GitHub");
        let other = parse_graphql(r#"{"errors":[{"message":"Bad credentials"}]}"#).unwrap_err();
        assert!(!other.contains("Bad credentials"));
        assert!(parse_graphql("<html>").is_err());
    }

    #[test]
    fn grid_covers_53_weeks_ending_this_week() {
        // Le 8 octobre 2025 est un mercredi : le dimanche de la semaine est le 5.
        assert_eq!(grid_start(d(2025, 10, 8)), d(2024, 10, 6));
        // Un dimanche : la semaine commence ce jour-là.
        assert_eq!(grid_start(d(2025, 10, 5)), d(2024, 10, 6));
        assert_eq!(grid_start(d(2025, 10, 4)), d(2024, 9, 29));
    }

    #[test]
    fn calendar_is_filled_without_holes() {
        let days = vec![Day { date: "2025-10-07".into(), count: 2, level: 1 }, Day { date: "2025-10-08".into(), count: 3, level: 2 }, Day { date: "2030-01-01".into(), count: 9, level: 4 }];
        let cal = build("simon", days, None, d(2025, 10, 8), false, 42);
        // Du 6 octobre 2024 au 8 octobre 2025, bornes comprises : 368 jours.
        assert_eq!(cal.days.len(), 368);
        assert_eq!(cal.days[0].date, "2024-10-06");
        assert_eq!(cal.days.last().unwrap().date, "2025-10-08");
        assert_eq!(cal.total, 5, "la date hors grille est écartée");
        assert_eq!(cal.today, 3);
        assert_eq!(cal.streak, 2);
        assert_eq!(cal.fetched_at, 42);
        assert!(!cal.private);
        // Avec un jeton, le total est celui de GitHub.
        assert_eq!(build("simon", vec![], Some(336), d(2025, 10, 8), true, 0).total, 336);
    }

    #[test]
    fn streak_counts_from_today_or_yesterday() {
        let day = |count: u32| Day { date: String::new(), count, level: 0 };
        assert_eq!(streak(&[day(1), day(2), day(3)]), 3);
        assert_eq!(streak(&[day(0), day(2), day(3)]), 2);
        // Rien encore aujourd'hui : la série d'hier tient toujours.
        assert_eq!(streak(&[day(1), day(2), day(0)]), 2);
        assert_eq!(streak(&[day(1), day(0), day(0)]), 0);
        assert_eq!(streak(&[]), 0);
        assert_eq!(streak(&[day(0)]), 0);
    }

    #[test]
    fn logins_are_checked() {
        for ok in ["simon", "simon-victor", "a", "x1", &"a".repeat(39)] {
            assert!(is_login(ok), "{ok}");
        }
        for bad in ["", "-simon", "simon victor", "simon/..", "sí", &"a".repeat(40)] {
            assert!(!is_login(bad), "{bad}");
        }
    }

    #[test]
    fn memory_cache_and_disk_copy() {
        let dir = std::env::temp_dir().join(format!("ondine-github-test-{}", std::process::id()));
        let path = dir.join("github-calendar.json");
        let cal = build("simon", vec![Day { date: "2025-10-08".into(), count: 3, level: 2 }], None, d(2025, 10, 8), false, 7);
        save(&path, &cal);
        assert_eq!(load(&path), Some(cal.clone()));
        // Au démarrage, la copie du disque s'affiche sans rien demander (occupé : aucune demande).
        let mut cache = Cache::default();
        let req = |busy: bool| Request { login: "simon", token: None, busy, disk: &path };
        let (got, from_cache) = read(&mut cache, req(true)).unwrap();
        assert!(from_cache);
        assert_eq!(got.fetched_at, 7);
        // Un autre identifiant : la copie ne sert pas, et occupé = refus.
        let other = Request { login: "autre", token: None, busy: true, disk: &path };
        assert!(read(&mut cache, other).is_err());
        // Un identifiant refusé.
        let bad = Request { login: "-x", token: None, busy: true, disk: &path };
        assert!(read(&mut cache, bad).unwrap_err().contains("refusé"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
