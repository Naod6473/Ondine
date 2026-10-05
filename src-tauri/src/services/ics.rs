// Lecture des fichiers d'agenda .ics (format iCalendar, RFC 5545).
//
// C'est le format qu'exportent Outlook, Google Agenda, Thunderbird, Apple
// Calendrier… Ce fichier ne fait QUE lire du texte : il ne télécharge rien,
// n'exécute rien (les rappels « ALARM » et pièces jointes sont ignorés).
//
// Ce qui est pris en charge (le plus courant) :
//   - les événements (VEVENT) : titre, lieu, début, fin ou durée ;
//   - les journées entières (DTSTART;VALUE=DATE:20261005) ;
//   - les heures UTC (finissant par Z), converties à l'heure de l'ordinateur ;
//   - la répétition RRULE : FREQ=DAILY / WEEKLY / MONTHLY / YEARLY avec
//     INTERVAL, COUNT, UNTIL, BYDAY (« le 1er lundi du mois » compris) ;
//   - les exceptions : EXDATE (une date supprimée) et RECURRENCE-ID (une date
//     déplacée ou annulée) ;
//   - les événements annulés (STATUS:CANCELLED) sont ignorés.
//
// Limite connue : une heure avec un fuseau nommé (DTSTART;TZID=Europe/Paris:…)
// est lue comme une heure locale de l'ordinateur. C'est juste si l'agenda et
// l'ordinateur sont dans le même fuseau (le cas habituel) ; sinon l'heure peut
// être décalée. Lire les fuseaux (VTIMEZONE) demanderait beaucoup plus de code.

use chrono::{Datelike, Duration, Local, Months, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday};

/// Au-delà, on arrête de dérouler une répétition (sécurité contre les boucles sans fin).
const MAX_STEPS: u32 = 5_000;
/// Nombre maximum d'événements lus dans un fichier.
const MAX_EVENTS: usize = 20_000;

/// Un événement tel qu'écrit dans le fichier (avant de dérouler les répétitions).
#[derive(Debug, Clone, Default)]
pub struct Event {
    pub uid: String,
    pub summary: String,
    pub location: String,
    /// Début, à l'heure locale de l'ordinateur.
    pub start: Option<NaiveDateTime>,
    pub end: Option<NaiveDateTime>,
    pub duration: Option<Duration>,
    pub all_day: bool,
    pub cancelled: bool,
    pub rule: Option<Rule>,
    /// Dates supprimées d'une répétition.
    pub exdates: Vec<NaiveDateTime>,
    /// Pour une exception : la date (d'origine) de l'occurrence qu'elle remplace.
    pub recurrence_id: Option<NaiveDateTime>,
}

/// Une règle de répétition (RRULE), réduite à ce qu'on sait dérouler.
#[derive(Debug, Clone, PartialEq)]
pub struct Rule {
    pub freq: Freq,
    pub interval: u32,
    pub count: Option<u32>,
    pub until: Option<NaiveDateTime>,
    /// BYDAY : (rang éventuel, jour). Ex. "1MO" = (Some(1), Lundi), "-1FR" = dernier vendredi.
    pub by_day: Vec<(Option<i32>, Weekday)>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

/// Une occurrence concrète, prête à afficher.
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub summary: String,
    pub location: String,
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
    pub all_day: bool,
}

// ---------------------------------------------------------------------------
// Lecture du texte
// ---------------------------------------------------------------------------

/// Lit tout le texte d'un fichier .ics et renvoie ses événements.
pub fn parse(text: &str) -> Vec<Event> {
    let mut events = Vec::new();
    let mut current: Option<Event> = None;
    // Profondeur des blocs à ignorer à l'intérieur d'un événement (VALARM…).
    let mut skip_depth = 0;

    for line in unfold(text) {
        let Some((name, params, value)) = split_line(&line) else { continue };
        match (name.as_str(), value.trim()) {
            ("BEGIN", "VEVENT") if current.is_none() => current = Some(Event::default()),
            ("END", "VEVENT") if skip_depth == 0 => {
                if let Some(ev) = current.take() {
                    if ev.start.is_some() && events.len() < MAX_EVENTS {
                        events.push(ev);
                    }
                }
            }
            ("BEGIN", _) if current.is_some() => skip_depth += 1,
            ("END", _) if current.is_some() && skip_depth > 0 => skip_depth -= 1,
            _ => {
                if let (Some(ev), 0) = (current.as_mut(), skip_depth) {
                    read_property(ev, &name, &params, &value);
                }
            }
        }
    }
    events
}

/// Remplit un champ de l'événement à partir d'une ligne « NOM;PARAMS:VALEUR ».
fn read_property(ev: &mut Event, name: &str, params: &str, value: &str) {
    let date_only = params.to_ascii_uppercase().contains("VALUE=DATE") && !params.to_ascii_uppercase().contains("VALUE=DATE-TIME");
    match name {
        "UID" => ev.uid = value.trim().to_string(),
        "SUMMARY" => ev.summary = unescape(value),
        "LOCATION" => ev.location = unescape(value),
        "STATUS" => ev.cancelled = value.trim().eq_ignore_ascii_case("CANCELLED"),
        "DTSTART" => {
            if let Some((t, is_date)) = parse_time(value, date_only) {
                ev.start = Some(t);
                ev.all_day = is_date;
            }
        }
        "DTEND" => ev.end = parse_time(value, date_only).map(|(t, _)| t),
        "DURATION" => ev.duration = parse_duration(value),
        "RRULE" => ev.rule = parse_rule(value),
        // Une ligne EXDATE peut contenir plusieurs dates séparées par des virgules.
        "EXDATE" => ev.exdates.extend(value.split(',').filter_map(|v| parse_time(v, date_only)).map(|(t, _)| t)),
        "RECURRENCE-ID" => ev.recurrence_id = parse_time(value, date_only).map(|(t, _)| t),
        _ => {}
    }
}

/// Les longues lignes d'un .ics sont coupées : une ligne qui commence par un
/// espace ou une tabulation continue la précédente. On les recolle.
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.lines() {
        let raw = raw.trim_end_matches('\r');
        if let Some(rest) = raw.strip_prefix(' ').or_else(|| raw.strip_prefix('\t')) {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(raw.to_string());
    }
    lines
}

/// "DTSTART;TZID=Europe/Paris:20261005T090000" → ("DTSTART", "TZID=Europe/Paris", "20261005T090000").
/// Le premier « : » hors guillemets sépare le nom (et ses paramètres) de la valeur.
fn split_line(line: &str) -> Option<(String, String, String)> {
    let mut in_quotes = false;
    let colon = line.char_indices().find(|&(_, c)| {
        if c == '"' {
            in_quotes = !in_quotes;
        }
        c == ':' && !in_quotes
    })?;
    let (head, value) = (&line[..colon.0], &line[colon.0 + 1..]);
    let (name, params) = match head.split_once(';') {
        Some((n, p)) => (n, p),
        None => (head, ""),
    };
    Some((name.trim().to_ascii_uppercase(), params.to_string(), value.to_string()))
}

/// Le texte d'un .ics est « échappé » : \n = retour à la ligne, \, = virgule…
fn unescape(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push(' '),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out.trim().to_string()
}

/// Lit une date ou une date-heure. Renvoie aussi « c'est une journée entière ».
/// "20261005" → journée ; "20261005T143000" → heure locale ; "…Z" → UTC converti.
fn parse_time(value: &str, date_only: bool) -> Option<(NaiveDateTime, bool)> {
    let v = value.trim();
    if date_only || v.len() == 8 {
        let d = NaiveDate::parse_from_str(v.get(..8)?, "%Y%m%d").ok()?;
        return Some((d.and_time(NaiveTime::MIN), true));
    }
    let utc = v.ends_with('Z') || v.ends_with('z');
    let naive = NaiveDateTime::parse_from_str(v.trim_end_matches(['Z', 'z']), "%Y%m%dT%H%M%S").ok()?;
    if utc {
        Some((utc_to_local(naive), false))
    } else {
        Some((naive, false))
    }
}

fn utc_to_local(naive: NaiveDateTime) -> NaiveDateTime {
    Utc.from_utc_datetime(&naive).with_timezone(&Local).naive_local()
}

/// "PT1H30M", "P1D", "P2W", "-PT15M" → une durée.
fn parse_duration(value: &str) -> Option<Duration> {
    let v = value.trim();
    let (negative, v) = match v.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, v.strip_prefix('+').unwrap_or(v)),
    };
    let v = v.strip_prefix('P')?;
    let mut total = Duration::zero();
    let mut number = String::new();
    let mut in_time = false;
    for c in v.chars() {
        if c.is_ascii_digit() {
            number.push(c);
            continue;
        }
        if c == 'T' {
            in_time = true;
            continue;
        }
        let n: i64 = number.parse().ok()?;
        number.clear();
        // Les versions « try_ » renvoient None au lieu de planter sur une
        // valeur démesurée (un .ics piégé avec « P99999999999999W »).
        let part = match (c, in_time) {
            ('W', false) => Duration::try_weeks(n),
            ('D', false) => Duration::try_days(n),
            ('H', true) => Duration::try_hours(n),
            ('M', true) => Duration::try_minutes(n),
            ('S', true) => Duration::try_seconds(n),
            _ => return None,
        }?;
        total = total.checked_add(&part)?;
    }
    Some(if negative { -total } else { total })
}

/// "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T000000Z" → Rule.
/// Une fréquence qu'on ne sait pas dérouler (HOURLY…) → None : seule la
/// première occurrence sera affichée.
fn parse_rule(value: &str) -> Option<Rule> {
    let mut rule = Rule { freq: Freq::Daily, interval: 1, count: None, until: None, by_day: Vec::new() };
    let mut freq = None;
    for part in value.trim().split(';') {
        let Some((key, val)) = part.split_once('=') else { continue };
        match key.to_ascii_uppercase().as_str() {
            "FREQ" => {
                freq = match val.to_ascii_uppercase().as_str() {
                    "DAILY" => Some(Freq::Daily),
                    "WEEKLY" => Some(Freq::Weekly),
                    "MONTHLY" => Some(Freq::Monthly),
                    "YEARLY" => Some(Freq::Yearly),
                    _ => None,
                }
            }
            "INTERVAL" => rule.interval = val.parse().unwrap_or(1).max(1),
            "COUNT" => rule.count = val.parse().ok(),
            "UNTIL" => rule.until = parse_time(val, false).map(|(t, is_date)| if is_date { end_of_day(t) } else { t }),
            "BYDAY" => rule.by_day = val.split(',').filter_map(parse_by_day).collect(),
            _ => {}
        }
    }
    rule.freq = freq?;
    Some(rule)
}

/// "MO" → (None, Lundi) ; "-1FR" → (Some(-1), Vendredi).
fn parse_by_day(text: &str) -> Option<(Option<i32>, Weekday)> {
    let text = text.trim();
    let split = text.len().checked_sub(2)?;
    let (rank, day) = text.split_at(split);
    let day = match day.to_ascii_uppercase().as_str() {
        "MO" => Weekday::Mon,
        "TU" => Weekday::Tue,
        "WE" => Weekday::Wed,
        "TH" => Weekday::Thu,
        "FR" => Weekday::Fri,
        "SA" => Weekday::Sat,
        "SU" => Weekday::Sun,
        _ => return None,
    };
    let rank = if rank.is_empty() { None } else { Some(rank.trim_start_matches('+').parse().ok()?) };
    Some((rank, day))
}

fn end_of_day(t: NaiveDateTime) -> NaiveDateTime {
    t.date().and_time(NaiveTime::MIN) + Duration::days(1) - Duration::seconds(1)
}

// ---------------------------------------------------------------------------
// Dérouler les répétitions
// ---------------------------------------------------------------------------

/// Toutes les occurrences qui touchent la période [from, to), triées par début.
pub fn occurrences(events: &[Event], from: NaiveDateTime, to: NaiveDateTime) -> Vec<Occurrence> {
    let mut out = Vec::new();
    for ev in events {
        let Some(start) = ev.start else { continue };
        let length = event_length(ev, start);

        // Une exception (RECURRENCE-ID) : elle est affichée telle quelle, sauf si annulée.
        if ev.recurrence_id.is_some() {
            if !ev.cancelled {
                push_if_visible(&mut out, ev, start, length, from, to);
            }
            continue;
        }
        if ev.cancelled {
            continue;
        }

        // Les dates de cet événement remplacées par une exception.
        let replaced: Vec<NaiveDateTime> = events
            .iter()
            .filter(|o| !ev.uid.is_empty() && o.uid == ev.uid)
            .filter_map(|o| o.recurrence_id)
            .collect();

        match &ev.rule {
            None => push_if_visible(&mut out, ev, start, length, from, to),
            Some(rule) => {
                let skip_before = from.checked_sub_signed(length).unwrap_or(start);
                for s in expand(rule, start, skip_before, to) {
                    if ev.exdates.contains(&s) || replaced.contains(&s) {
                        continue;
                    }
                    push_if_visible(&mut out, ev, s, length, from, to);
                }
            }
        }
    }
    out.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.summary.cmp(&b.summary)));
    out
}

/// La durée d'un événement : DTEND - DTSTART, sinon DURATION, sinon une
/// journée (journée entière) ou zéro (rendez-vous ponctuel).
fn event_length(ev: &Event, start: NaiveDateTime) -> Duration {
    if let Some(end) = ev.end.filter(|e| *e >= start) {
        return end - start;
    }
    if let Some(d) = ev.duration.filter(|d| *d >= Duration::zero()) {
        return d;
    }
    if ev.all_day {
        Duration::days(1)
    } else {
        Duration::zero()
    }
}

fn push_if_visible(out: &mut Vec<Occurrence>, ev: &Event, start: NaiveDateTime, length: Duration, from: NaiveDateTime, to: NaiveDateTime) {
    // Une durée démesurée qui dépasserait les dates possibles : ignorée.
    let Some(end) = start.checked_add_signed(length) else { return };
    // Visible si l'occurrence n'est pas finie au début de la période et commence avant sa fin.
    // (Un rendez-vous sans durée est visible tant que son heure n'est pas passée.)
    let not_over = if length.is_zero() { end >= from } else { end > from };
    if not_over && start < to {
        out.push(Occurrence {
            summary: if ev.summary.is_empty() { "(sans titre)".into() } else { ev.summary.clone() },
            location: ev.location.clone(),
            start,
            end,
            all_day: ev.all_day,
        });
    }
}

/// Les débuts successifs d'une répétition, jusqu'à `to` (au plus).
/// Respecte COUNT et UNTIL. Le premier est toujours DTSTART lui-même.
/// `skip_before` : sans COUNT, on peut sauter directement les périodes déjà
/// passées (un rendez-vous quotidien qui dure depuis 2010, par exemple).
fn expand(rule: &Rule, start: NaiveDateTime, skip_before: NaiveDateTime, to: NaiveDateTime) -> Vec<NaiveDateTime> {
    let mut out = Vec::new();
    let time = start.time();
    let mut produced = 0u32;

    // Combien de périodes entières sauter (une de marge, pour ne rien rater).
    let first_step = if rule.count.is_none() && skip_before > start {
        let days = (skip_before - start).num_days();
        let periods = match rule.freq {
            Freq::Daily => days,
            Freq::Weekly => days / 7,
            Freq::Monthly => days / 31,
            Freq::Yearly => days / 366,
        };
        (periods / rule.interval as i64 - 1).clamp(0, u32::MAX as i64 / 2) as u32
    } else {
        0
    };

    // Pour chaque « période » (jour, semaine, mois ou année n° step), les jours retenus.
    // Tous les calculs sont « checked » : un INTERVAL énorme (un .ics piégé)
    // dépasse les dates possibles, et on s'arrête au lieu de planter.
    for step in first_step..first_step.saturating_add(MAX_STEPS) {
        let Some(n) = step.checked_mul(rule.interval) else { break };
        let mut days: Vec<NaiveDate> = match rule.freq {
            Freq::Daily => match add_days(start.date(), n as i64) {
                Some(d) => vec![d],
                None => break,
            },
            Freq::Weekly => {
                // Semaine commençant le lundi (WKST=MO, la valeur par défaut).
                let offset = start.weekday().num_days_from_monday() as i64;
                let Some(monday) = add_days(start.date(), -offset).and_then(|d| add_days(d, (n as i64).checked_mul(7)?)) else { break };
                if rule.by_day.is_empty() {
                    add_days(monday, offset).into_iter().collect()
                } else {
                    rule.by_day.iter().filter_map(|(_, d)| add_days(monday, d.num_days_from_monday() as i64)).collect()
                }
            }
            Freq::Monthly => {
                let Some(first) = first_of_month(start.date(), n) else { break };
                if rule.by_day.is_empty() {
                    first.with_day(start.day()).into_iter().collect() // le 31 n'existe pas tous les mois : sauté
                } else {
                    rule.by_day.iter().flat_map(|&(rank, day)| weekdays_in_month(first, rank, day)).collect()
                }
            }
            Freq::Yearly => {
                let Some(first) = n.checked_mul(12).and_then(|m| first_of_month(start.date(), m)) else { break };
                first.with_day(start.day()).into_iter().collect() // le 29 février : seulement les années bissextiles
            }
        };
        days.sort();
        days.dedup();

        for day in days {
            let s = day.and_time(time);
            if s < start {
                continue; // avant le tout premier rendez-vous
            }
            if rule.until.is_some_and(|u| s > u) || rule.count.is_some_and(|c| produced >= c) || s >= to {
                return out;
            }
            produced += 1;
            out.push(s);
        }
    }
    out
}

/// `date` + `days` jours, ou None si on sort des dates possibles.
fn add_days(date: NaiveDate, days: i64) -> Option<NaiveDate> {
    date.checked_add_signed(Duration::try_days(days)?)
}

/// Le 1er du mois, `months` mois après celui de `date`.
fn first_of_month(date: NaiveDate, months: u32) -> Option<NaiveDate> {
    date.with_day(1)?.checked_add_months(Months::new(months))
}

/// Les jours `day` du mois commençant à `first`. Avec un rang : seulement le
/// n-ième (1 = premier, -1 = dernier).
fn weekdays_in_month(first: NaiveDate, rank: Option<i32>, day: Weekday) -> Vec<NaiveDate> {
    let mut all = Vec::new();
    let mut d = first;
    while d.month() == first.month() {
        if d.weekday() == day {
            all.push(d);
        }
        d += Duration::days(1);
    }
    match rank {
        None => all,
        Some(r) if r > 0 => all.get(r as usize - 1).copied().into_iter().collect(),
        Some(r) if r < 0 => all.len().checked_sub((-r) as usize).and_then(|i| all.get(i).copied()).into_iter().collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    fn cal(body: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n")
    }

    fn starts(occ: &[Occurrence]) -> Vec<String> {
        occ.iter().map(|o| o.start.format("%Y-%m-%d %H:%M").to_string()).collect()
    }

    #[test]
    fn simple_event_with_folded_and_escaped_text() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Réunion d'équipe\\, salle\r\n  B\r\nLOCATION:Paris\\nBureau\r\n\
             DTSTART:20261006T093000\r\nDTEND:20261006T103000\r\nEND:VEVENT\r\n",
        );
        let events = parse(&text);
        assert_eq!(events.len(), 1);
        let occ = occurrences(&events, dt("2026-10-01 00:00"), dt("2026-11-01 00:00"));
        assert_eq!(occ.len(), 1);
        assert_eq!(occ[0].summary, "Réunion d'équipe, salle B");
        assert_eq!(occ[0].location, "Paris Bureau");
        assert_eq!(occ[0].end, dt("2026-10-06 10:30"));
    }

    #[test]
    fn all_day_and_duration() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Férié\r\nDTSTART;VALUE=DATE:20261101\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Appel\r\nDTSTART:20261101T140000\r\nDURATION:PT1H30M\r\nEND:VEVENT\r\n",
        );
        let occ = occurrences(&parse(&text), dt("2026-11-01 00:00"), dt("2026-11-02 00:00"));
        assert_eq!(occ.len(), 2);
        assert!(occ[0].all_day);
        assert_eq!(occ[0].end, dt("2026-11-02 00:00"));
        assert_eq!(occ[1].end, dt("2026-11-01 15:30"));
    }

    #[test]
    fn alarms_inside_events_are_ignored() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Dentiste\r\nDTSTART:20261010T100000\r\n\
             BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:autre chose\r\nEND:VALARM\r\nEND:VEVENT\r\n",
        );
        let events = parse(&text);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].summary, "Dentiste");
    }

    #[test]
    fn utc_time_is_converted_to_local() {
        let text = cal("BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261006T120000Z\r\nEND:VEVENT\r\n");
        let events = parse(&text);
        assert_eq!(events[0].start, Some(utc_to_local(dt("2026-10-06 12:00"))));
    }

    #[test]
    fn weekly_rule_with_days_count_and_exdate() {
        // Tous les lundis et mercredis à 9 h, 5 fois, sauf le mercredi 7 octobre.
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Sport\r\nDTSTART:20261005T090000\r\n\
             RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5\r\nEXDATE:20261007T090000\r\nEND:VEVENT\r\n",
        );
        let occ = occurrences(&parse(&text), dt("2026-10-01 00:00"), dt("2027-01-01 00:00"));
        assert_eq!(starts(&occ), ["2026-10-05 09:00", "2026-10-12 09:00", "2026-10-14 09:00", "2026-10-19 09:00"]);
    }

    #[test]
    fn a_trapped_ics_does_not_panic() {
        let text = "BEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261005T080000\r\nDURATION:P99999999999999W\r\n\
                    RRULE:FREQ=WEEKLY;INTERVAL=100000000\r\nEND:VEVENT\r\n\
                    BEGIN:VEVENT\r\nUID:y\r\nDTSTART:20261005T080000\r\nRRULE:FREQ=YEARLY;INTERVAL=4000000000\r\nEND:VEVENT\r\n\
                    BEGIN:VEVENT\r\nUID:z\r\nDTSTART:20261005T080000\r\nRRULE:FREQ=DAILY;INTERVAL=4000000000\r\nEND:VEVENT\r\n";
        let events = parse(text);
        let _ = occurrences(&events, dt("2026-10-01 00:00"), dt("2030-01-01 00:00"));
        assert_eq!(parse_duration("P99999999999999W"), None);
    }

    #[test]
    fn daily_rule_with_interval_and_until() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261005T080000\r\nRRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261011\r\nEND:VEVENT\r\n",
        );
        let occ = occurrences(&parse(&text), dt("2026-10-01 00:00"), dt("2027-01-01 00:00"));
        assert_eq!(starts(&occ), ["2026-10-05 08:00", "2026-10-07 08:00", "2026-10-09 08:00", "2026-10-11 08:00"]);
    }

    #[test]
    fn monthly_first_monday_and_last_friday() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261005T100000\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261030T170000\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2\r\nEND:VEVENT\r\n",
        );
        let occ = occurrences(&parse(&text), dt("2026-10-01 00:00"), dt("2026-12-31 00:00"));
        assert_eq!(
            starts(&occ),
            ["2026-10-05 10:00", "2026-10-30 17:00", "2026-11-02 10:00", "2026-11-27 17:00", "2026-12-07 10:00"]
        );
    }

    #[test]
    fn monthly_on_the_31st_skips_short_months_and_yearly_works() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261031T090000\r\nRRULE:FREQ=MONTHLY;COUNT=3\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Anniv\r\nDTSTART;VALUE=DATE:20200315\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\n",
        );
        let occ = occurrences(&parse(&text), dt("2026-10-01 00:00"), dt("2027-04-01 00:00"));
        assert_eq!(starts(&occ), ["2026-10-31 09:00", "2026-12-31 09:00", "2027-01-31 09:00", "2027-03-15 00:00"]);
    }

    #[test]
    fn moved_and_cancelled_occurrences() {
        let text = cal(
            "BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Point\r\nDTSTART:20261005T100000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Point (déplacé)\r\nRECURRENCE-ID:20261006T100000\r\nDTSTART:20261006T150000\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:r\r\nRECURRENCE-ID:20261007T100000\r\nDTSTART:20261007T100000\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n\
             BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Annulé\r\nDTSTART:20261005T120000\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n",
        );
        let occ = occurrences(&parse(&text), dt("2026-10-01 00:00"), dt("2026-11-01 00:00"));
        assert_eq!(starts(&occ), ["2026-10-05 10:00", "2026-10-06 15:00"]);
        assert_eq!(occ[1].summary, "Point (déplacé)");
    }

    #[test]
    fn endless_rule_stops_at_the_window() {
        // Commencé il y a très longtemps : on ne déroule pas 30 ans de jours.
        let text = cal("BEGIN:VEVENT\r\nUID:a\r\nDTSTART:19900101T090000\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\n");
        let occ = occurrences(&parse(&text), dt("2026-10-05 00:00"), dt("2026-10-08 00:00"));
        assert_eq!(starts(&occ), ["2026-10-05 09:00", "2026-10-06 09:00", "2026-10-07 09:00"]);
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(Duration::minutes(90)));
        assert_eq!(parse_duration("P1W"), Some(Duration::weeks(1)));
        assert_eq!(parse_duration("-PT15M"), Some(Duration::minutes(-15)));
        assert_eq!(parse_duration("P1DT2H"), Some(Duration::hours(26)));
        assert_eq!(parse_duration("1H"), None);
    }

    #[test]
    fn garbage_does_not_panic() {
        assert!(parse("n'importe quoi\r\nBEGIN:VEVENT\r\nDTSTART:pas une date\r\nEND:VEVENT").is_empty());
        assert!(parse_rule("FREQ=SECONDLY").is_none());
        assert!(parse_by_day("X").is_none());
    }
}
