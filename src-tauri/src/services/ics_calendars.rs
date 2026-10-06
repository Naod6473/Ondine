// Les calendriers du module Agenda (depuis la version 1.2) : plusieurs fichiers
// .ics ou liens iCal, chacun avec un nom et une couleur.
//
// Dans les réglages (settings.json), le module range sous "calendars" une liste :
//   { "id": "k3f9", "name": "Travail", "color": "#4fb8ff", "kind": "file", "path": "C:\\…\\travail.ics" }
//   { "id": "p2x7", "name": "Perso",   "color": "#ff8a65", "kind": "link" }
// Un calendrier « link » n'a PAS son adresse ici : elle est dans le Gestionnaire
// d'identifiants, sous la clé « agenda-ical-url-<id> » (voir credentials.rs).
//
// Ce fichier ne contient que de la logique pure (testée plus bas) :
//   - lire et nettoyer cette liste (un fichier abîmé ne doit rien casser) ;
//   - fabriquer la liste à partir des anciens réglages (avant 1.2 : des
//     fichiers "icsFiles" + UN lien iCal sous la clé « agenda-ical-url ») ;
//   - fusionner les rendez-vous de tous les calendriers, triés par heure.

use serde_json::{json, Map, Value};

use super::credentials::is_calendar_id;
use super::ics::Occurrence;

/// Au plus ce nombre de calendriers.
pub const MAX_CALENDARS: usize = 10;
/// Au plus ce nombre de caractères pour un nom.
const MAX_NAME: usize = 60;
/// Les couleurs proposées (et données dans l'ordre aux calendriers sans couleur).
pub const PALETTE: &[&str] = &["#4fb8ff", "#ff8a65", "#7bd88f", "#c792ea", "#ffd166", "#ff6b9a", "#5eead4", "#a3a3ff"];
/// L'identifiant donné au lien iCal unique des anciens réglages.
pub const LEGACY_LINK_ID: &str = "lien";
/// Le nom donné à ce lien (c'était « Agenda en ligne » dans les messages).
const LEGACY_LINK_NAME: &str = "Agenda en ligne";

/// D'où viennent les rendez-vous d'un calendrier.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    /// Un fichier .ics sur le disque (chemin tel que choisi).
    File(String),
    /// Un lien iCal, rangé dans le Gestionnaire d'identifiants.
    Link,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: String,
    pub source: Source,
}

/// Lit la liste "calendars" des réglages. Ce qui est invalide est ignoré
/// (identifiant bizarre ou en double, fichier sans chemin…) ou corrigé
/// (nom trop long, couleur inconnue).
pub fn parse_list(value: &Value) -> Vec<Calendar> {
    let mut out: Vec<Calendar> = Vec::new();
    for item in value.as_array().map(Vec::as_slice).unwrap_or_default() {
        if out.len() >= MAX_CALENDARS {
            break;
        }
        let text = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string();
        let id = text("id");
        if !is_calendar_id(&id) || out.iter().any(|c| c.id == id) {
            continue;
        }
        let source = match text("kind").as_str() {
            "file" => {
                let path = text("path");
                if path.is_empty() || path.len() >= 1000 {
                    continue;
                }
                Source::File(path)
            }
            "link" => Source::Link,
            _ => continue,
        };
        let color = text("color").to_ascii_lowercase();
        let color = if is_color(&color) { color } else { PALETTE[out.len() % PALETTE.len()].to_string() };
        let mut name: String = text("name").chars().take(MAX_NAME).collect();
        if name.is_empty() {
            name = match &source {
                Source::File(path) => file_stem(path),
                Source::Link => LEGACY_LINK_NAME.to_string(),
            };
        }
        out.push(Calendar { id, name, color, source });
    }
    out
}

/// Les réglages n'ont pas encore de liste "calendars" : ce sont ceux d'avant 1.2.
pub fn needs_migration(values: &Map<String, Value>) -> bool {
    !values.contains_key("calendars")
}

/// La liste "calendars" fabriquée à partir des anciens réglages : un calendrier
/// par fichier de "icsFiles" (identifiants f1, f2…), plus un calendrier
/// « Agenda en ligne » (identifiant `LEGACY_LINK_ID`) si un lien était enregistré.
/// Toujours le même résultat pour les mêmes réglages : on peut la refaire sans risque.
pub fn legacy_list(values: &Map<String, Value>, has_link: bool) -> Vec<Value> {
    let mut out = Vec::new();
    let files = values.get("icsFiles").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let mut seen: Vec<&str> = Vec::new();
    for path in files.iter().filter_map(Value::as_str).map(str::trim) {
        if path.is_empty() || seen.contains(&path) || out.len() >= MAX_CALENDARS - 1 {
            continue;
        }
        seen.push(path);
        let n = out.len();
        out.push(json!({
            "id": format!("f{}", n + 1),
            "name": file_stem(path),
            "color": PALETTE[n % PALETTE.len()],
            "kind": "file",
            "path": path,
        }));
    }
    if has_link {
        let n = out.len();
        out.push(json!({ "id": LEGACY_LINK_ID, "name": LEGACY_LINK_NAME, "color": PALETTE[n % PALETTE.len()], "kind": "link" }));
    }
    out
}

/// Les calendriers à lire : la liste des réglages, ou, si elle n'existe pas
/// encore, celle fabriquée à partir des anciens réglages.
pub fn effective(values: &Map<String, Value>, has_legacy_link: bool) -> Vec<Calendar> {
    if needs_migration(values) {
        parse_list(&Value::Array(legacy_list(values, has_legacy_link)))
    } else {
        parse_list(values.get("calendars").unwrap_or(&Value::Null))
    }
}

/// Fusionne les rendez-vous de chaque calendrier (dans l'ordre de la liste) :
/// (numéro du calendrier, rendez-vous), triés par heure, puis titre, puis
/// ordre des calendriers.
pub fn merge(per_calendar: Vec<Vec<Occurrence>>) -> Vec<(usize, Occurrence)> {
    let mut all: Vec<(usize, Occurrence)> = per_calendar.into_iter().enumerate().flat_map(|(i, occ)| occ.into_iter().map(move |o| (i, o))).collect();
    // Tri stable : à égalité complète, l'ordre des calendriers est gardé.
    all.sort_by(|(_, a), (_, b)| a.start.cmp(&b.start).then_with(|| a.summary.cmp(&b.summary)));
    all
}

/// « #4fb8ff » : une couleur valide (6 chiffres hexadécimaux).
fn is_color(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// « C:\Users\moi\Travail.ics » → « Travail » (les deux sortes de barres,
/// pour que les tests tournent aussi hors de Windows).
fn file_stem(path: &str) -> String {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = match name.len().checked_sub(4) {
        Some(i) if name.is_char_boundary(i) && name[i..].eq_ignore_ascii_case(".ics") => &name[..i],
        _ => name,
    };
    let stem: String = stem.chars().take(MAX_NAME).collect();
    if stem.is_empty() {
        "Agenda".into()
    } else {
        stem
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    fn values(json: Value) -> Map<String, Value> {
        json.as_object().cloned().unwrap()
    }

    fn occ(title: &str, start: &str) -> Occurrence {
        let start = NaiveDateTime::parse_from_str(start, "%Y-%m-%d %H:%M").unwrap();
        Occurrence { summary: title.into(), location: String::new(), start, end: start, all_day: false, link: None }
    }

    #[test]
    fn migration_from_old_settings_keeps_files_and_link() {
        let old = values(json!({
            "icsFiles": ["C:\\Users\\moi\\Travail.ics", "D:/Agendas/perso.ICS", "C:\\Users\\moi\\Travail.ics"],
            "reminderMin": 10
        }));
        assert!(needs_migration(&old));
        let list = legacy_list(&old, true);
        assert_eq!(
            Value::Array(list.clone()),
            json!([
                { "id": "f1", "name": "Travail", "color": PALETTE[0], "kind": "file", "path": "C:\\Users\\moi\\Travail.ics" },
                { "id": "f2", "name": "perso", "color": PALETTE[1], "kind": "file", "path": "D:/Agendas/perso.ICS" },
                { "id": "lien", "name": "Agenda en ligne", "color": PALETTE[2], "kind": "link" }
            ])
        );
        // Refaire la migration donne exactement la même chose (mêmes identifiants).
        assert_eq!(legacy_list(&old, true), list);
        // Et la liste migrée se relit sans rien perdre.
        let cals = parse_list(&Value::Array(list));
        assert_eq!(cals.len(), 3);
        assert_eq!(cals[0].source, Source::File("C:\\Users\\moi\\Travail.ics".into()));
        assert_eq!(cals[2].source, Source::Link);
        assert_eq!(effective(&old, true), cals);
    }

    #[test]
    fn migration_without_link_or_files() {
        assert!(legacy_list(&values(json!({})), false).is_empty());
        let only_link = legacy_list(&values(json!({ "icsFiles": [] })), true);
        assert_eq!(only_link.len(), 1);
        assert_eq!(only_link[0]["id"], "lien");
        // Déjà migré (même vers une liste vide) : on ne refait rien.
        let done = values(json!({ "calendars": [], "icsFiles": ["C:\\a.ics"] }));
        assert!(!needs_migration(&done));
        assert!(effective(&done, true).is_empty());
    }

    #[test]
    fn invalid_entries_are_ignored_or_fixed() {
        let list = parse_list(&json!([
            { "id": "a1", "name": "  Travail  ", "color": "#ABCDEF", "kind": "file", "path": "C:\\t.ics" },
            { "id": "a1", "name": "doublon", "kind": "link" },
            { "id": "../x", "kind": "link" },
            { "id": "b2", "kind": "file" },
            { "id": "c3", "kind": "ftp" },
            { "id": "d4", "name": "", "color": "rouge", "kind": "link" },
            { "id": "e5", "name": "x".repeat(200), "kind": "file", "path": "/home/moi/cours.ics" },
            "n'importe quoi"
        ]));
        let ids: Vec<&str> = list.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["a1", "d4", "e5"]);
        assert_eq!(list[0].name, "Travail");
        assert_eq!(list[0].color, "#abcdef");
        assert_eq!(list[1].name, "Agenda en ligne");
        assert_eq!(list[1].color, PALETTE[1]);
        assert_eq!(list[2].name.chars().count(), 60);
        assert!(parse_list(&json!("pas une liste")).is_empty());
        // Pas plus de MAX_CALENDARS.
        let many: Vec<Value> = (0..30).map(|i| json!({ "id": format!("c{i}"), "kind": "link" })).collect();
        assert_eq!(parse_list(&Value::Array(many)).len(), MAX_CALENDARS);
    }

    #[test]
    fn events_of_all_calendars_are_merged_and_sorted() {
        let work = vec![occ("Point", "2026-10-06 09:00"), occ("Revue", "2026-10-06 14:00")];
        let home = vec![occ("Dentiste", "2026-10-06 08:00"), occ("Point", "2026-10-06 09:00"), occ("Cinéma", "2026-10-07 20:00")];
        let merged = merge(vec![work, Vec::new(), home]);
        let got: Vec<(usize, &str)> = merged.iter().map(|(i, o)| (*i, o.summary.as_str())).collect();
        assert_eq!(got, [(2, "Dentiste"), (0, "Point"), (2, "Point"), (0, "Revue"), (2, "Cinéma")]);
    }

    #[test]
    fn file_names() {
        assert_eq!(file_stem("C:\\Users\\moi\\Mon agenda.ics"), "Mon agenda");
        assert_eq!(file_stem("/tmp/x.ICS"), "x");
        assert_eq!(file_stem("C:\\.ics"), "Agenda");
        assert_eq!(file_stem("é.ics"), "é");
    }
}
