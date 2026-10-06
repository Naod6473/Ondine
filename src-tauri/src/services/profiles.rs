// Les profils : « Travail », « Maison »… Un profil change quelques réglages de
// l'île d'un coup : les onglets affichés et leur ordre, la couleur, « Toujours
// en mini ».
//
// Un profil ne garde QUE les réglages qu'il remplace (les autres restent
// `None`). Le principe pour passer d'un profil à l'autre :
//
//   1. On range les réglages actuels : ceux que le profil actif remplace vont
//      dans ce profil (tes retouches faites pendant qu'il était actif sont donc
//      gardées), les autres vont dans `base` (les réglages « hors profil »).
//   2. On repart de `base`, et on pose par-dessus ce que le nouveau profil
//      remplace.
//
// Changement automatique (facultatif, `auto`) : chaque profil peut avoir une
// règle simple, une plage horaire (9 h – 18 h du lundi au vendredi) ou le nom
// du Wi-Fi connecté. Un fil regarde toutes les 30 s quel profil devrait être
// actif, et ne change que quand la réponse change : un choix fait à la main
// (réglages, menu de l'icône) tient jusqu'au prochain changement de situation.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::services::log;
use crate::services::settings::Settings;
use crate::sync::LockExt;

/// Au plus tant de profils.
pub const MAX_PROFILES: usize = 10;
/// Le fil du changement automatique regarde l'heure et le Wi-Fi à ce rythme.
const AUTO_TICK: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profiles {
    /// Les profils, dans l'ordre de la liste (c'est aussi l'ordre de priorité
    /// des règles automatiques).
    pub list: Vec<Profile>,
    /// L'id du profil actif, "" = aucun.
    pub active: String,
    /// Changer de profil tout seul selon les règles.
    pub auto: bool,
    /// Les réglages « hors profil », gardés pendant qu'un profil est actif.
    pub base: ProfileValues,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Ce que le profil remplace (le reste vient des réglages hors profil).
    pub values: ProfileValues,
    pub rule: ProfileRule,
}

/// Les réglages qu'un profil peut remplacer. `None` = pas remplacé.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileValues {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_order: Option<Vec<String>>,
    /// Les onglets affichés : id de module → activé.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modules: Option<BTreeMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub always_mini: Option<bool>,
}

/// Quand activer ce profil tout seul.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileRule {
    /// "none", "hours" (plage horaire) ou "wifi" (nom du Wi-Fi connecté).
    pub kind: String,
    /// Jours de la plage : 1 = lundi … 7 = dimanche.
    pub days: Vec<u8>,
    /// Début et fin de la plage, "HH:MM". Une fin avant le début = la plage
    /// passe minuit (22:00 → 06:00).
    pub start: String,
    pub end: String,
    /// Le nom du Wi-Fi (sans tenir compte des majuscules).
    pub ssid: String,
}

impl Default for ProfileRule {
    fn default() -> Self {
        Self { kind: "none".into(), days: vec![1, 2, 3, 4, 5], start: "09:00".into(), end: "18:00".into(), ssid: String::new() }
    }
}

// ── Vérification des valeurs (fichier modifié à la main, import) ────────────

fn valid_hhmm(text: &str) -> bool {
    parse_hhmm(text).is_some()
}

/// "09:30" → 570 minutes depuis minuit.
pub fn parse_hhmm(text: &str) -> Option<u32> {
    let (h, m) = text.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Remet les profils dans les clous (appelé par `Settings::sanitize`).
pub fn sanitize(p: &mut Profiles) {
    p.list.truncate(MAX_PROFILES);
    let mut seen = BTreeSet::new();
    p.list.retain(|x| !x.id.is_empty() && x.id.len() <= 40 && seen.insert(x.id.clone()));
    for x in &mut p.list {
        x.name = x.name.chars().filter(|c| !c.is_control()).take(40).collect();
        if x.name.trim().is_empty() {
            x.name = "Profil".into();
        }
        let r = &mut x.rule;
        if !["none", "hours", "wifi"].contains(&r.kind.as_str()) {
            r.kind = "none".into();
        }
        r.days.retain(|d| (1..=7).contains(d));
        r.days.sort_unstable();
        r.days.dedup();
        if !valid_hhmm(&r.start) {
            r.start = "09:00".into();
        }
        if !valid_hhmm(&r.end) {
            r.end = "18:00".into();
        }
        r.ssid = r.ssid.chars().filter(|c| !c.is_control()).take(32).collect();
    }
    if !p.active.is_empty() && !p.list.iter().any(|x| x.id == p.active) {
        p.active.clear();
    }
}

// ── Passer d'un profil à l'autre ─────────────────────────────────────────────

/// Les réglages actuels, pour chaque champ qu'un profil peut remplacer.
fn read_current(s: &Settings, module_ids: &BTreeSet<String>) -> ProfileValues {
    ProfileValues {
        tab_order: Some(s.island.tab_order.clone()),
        modules: Some(module_ids.iter().map(|id| (id.clone(), s.module_enabled(id))).collect()),
        theme: Some(s.island.theme.clone()),
        color: Some(s.island.color.clone()),
        always_mini: Some(s.island.always_mini),
    }
}

/// Écrit dans les réglages chaque champ présent (`Some`).
fn write(s: &mut Settings, v: &ProfileValues) {
    if let Some(x) = &v.tab_order {
        s.island.tab_order = x.clone();
    }
    if let Some(map) = &v.modules {
        for (id, on) in map {
            s.modules.entry(id.clone()).or_default().enabled = *on;
        }
    }
    if let Some(x) = &v.theme {
        s.island.theme = x.clone();
    }
    if let Some(x) = &v.color {
        s.island.color = x.clone();
    }
    if let Some(x) = v.always_mini {
        s.island.always_mini = x;
    }
}

/// Range un champ : dans le profil actif s'il le remplace, sinon dans `base`.
fn stash<T: Clone>(current: &Option<T>, profile: &mut Option<T>, base: &mut Option<T>) {
    if profile.is_some() {
        *profile = current.clone();
    } else {
        *base = current.clone();
    }
}

/// `base`, avec par-dessus ce que `profile` remplace.
fn overlay(base: &ProfileValues, profile: &ProfileValues) -> ProfileValues {
    let modules = match (&base.modules, &profile.modules) {
        (None, None) => None,
        (b, p) => {
            let mut map = b.clone().unwrap_or_default();
            map.extend(p.clone().unwrap_or_default());
            Some(map)
        }
    };
    ProfileValues {
        tab_order: profile.tab_order.clone().or_else(|| base.tab_order.clone()),
        modules,
        theme: profile.theme.clone().or_else(|| base.theme.clone()),
        color: profile.color.clone().or_else(|| base.color.clone()),
        always_mini: profile.always_mini.or(base.always_mini),
    }
}

/// Active le profil `to` ("" = aucun) dans `s`. Renvoie false si rien n'a
/// changé (déjà actif, ou profil inconnu).
pub fn switch(s: &mut Settings, to: &str) -> bool {
    if s.profiles.active == to || (!to.is_empty() && !s.profiles.list.iter().any(|p| p.id == to)) {
        return false;
    }
    // Tous les modules dont un profil (ou la base) parle, plus ceux des réglages.
    let mut ids: BTreeSet<String> = s.modules.keys().cloned().collect();
    for v in s.profiles.list.iter().map(|p| &p.values).chain([&s.profiles.base]) {
        ids.extend(v.modules.iter().flat_map(|m| m.keys().cloned()));
    }
    let cur = read_current(s, &ids);

    // 1. Ranger les réglages actuels.
    let p = &mut s.profiles;
    let active = p.active.clone();
    match p.list.iter_mut().find(|x| x.id == active) {
        None => p.base = cur,
        Some(prof) => {
            let (v, b) = (&mut prof.values, &mut p.base);
            stash(&cur.tab_order, &mut v.tab_order, &mut b.tab_order);
            stash(&cur.theme, &mut v.theme, &mut b.theme);
            stash(&cur.color, &mut v.color, &mut b.color);
            stash(&cur.always_mini, &mut v.always_mini, &mut b.always_mini);
            let base_modules = b.modules.get_or_insert_with(BTreeMap::new);
            for (id, on) in cur.modules.unwrap_or_default() {
                match v.modules.as_mut().filter(|m| m.contains_key(&id)) {
                    Some(m) => {
                        m.insert(id, on);
                    }
                    None => {
                        base_modules.insert(id, on);
                    }
                }
            }
        }
    }

    // 2. Repartir de la base, avec par-dessus le nouveau profil.
    let target = match p.list.iter().find(|x| x.id == to) {
        Some(prof) => overlay(&p.base, &prof.values),
        None => p.base.clone(),
    };
    p.active = to.to_string();
    write(s, &target);
    true
}

// ── Le choix automatique ─────────────────────────────────────────────────────

/// La règle s'applique-t-elle maintenant ? `weekday` : 1 = lundi … 7 = dimanche ;
/// `minutes` : depuis minuit ; `ssid` : le Wi-Fi connecté, s'il y en a un.
pub fn rule_matches(rule: &ProfileRule, weekday: u8, minutes: u32, ssid: Option<&str>) -> bool {
    match rule.kind.as_str() {
        "wifi" => {
            let want = rule.ssid.trim();
            !want.is_empty() && ssid.is_some_and(|s| s.trim().eq_ignore_ascii_case(want))
        }
        "hours" => {
            let (Some(start), Some(end)) = (parse_hhmm(&rule.start), parse_hhmm(&rule.end)) else { return false };
            let day_on = |d: u8| rule.days.contains(&d);
            if start == end {
                return false; // plage vide
            }
            if start < end {
                day_on(weekday) && minutes >= start && minutes < end
            } else {
                // La plage passe minuit : le soir du jour coché, ou le matin du lendemain.
                let yesterday = if weekday == 1 { 7 } else { weekday - 1 };
                (day_on(weekday) && minutes >= start) || (day_on(yesterday) && minutes < end)
            }
        }
        _ => false,
    }
}

/// Le profil qui devrait être actif maintenant, ou None si aucune règle ne
/// s'applique. Une règle Wi-Fi (plus précise) passe avant une plage horaire ;
/// à égalité, le premier de la liste gagne.
pub fn pick(list: &[Profile], weekday: u8, minutes: u32, ssid: Option<&str>) -> Option<String> {
    let first = |kind: &str| {
        list.iter()
            .find(|p| p.rule.kind == kind && rule_matches(&p.rule, weekday, minutes, ssid))
            .map(|p| p.id.clone())
    };
    first("wifi").or_else(|| first("hours"))
}

// ── Dans l'appli ─────────────────────────────────────────────────────────────

/// Active un profil ("" = aucun), enregistre et prévient les fenêtres.
pub fn activate(app: &AppHandle, id: &str) -> Result<(), String> {
    let shared = app.state::<crate::Shared>();
    let mut next = shared.settings.locked().clone();
    if !switch(&mut next, id) {
        return Ok(());
    }
    let name = next.profiles.list.iter().find(|p| p.id == id).map(|p| p.name.clone()).unwrap_or_else(|| "aucun".into());
    crate::apply_settings(app, &shared, next)?;
    log::info(format!("profil activé : {name}"));
    Ok(())
}

/// Le fil du changement automatique.
pub fn spawn_auto(app: AppHandle) {
    std::thread::spawn(move || {
        // Ce que les règles disaient au tour d'avant (None = pas encore regardé).
        let mut last: Option<Option<String>> = None;
        loop {
            let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| auto_tick(&app, &mut last)));
            if step.is_err() {
                log::warn("profils : erreur dans le changement automatique");
            }
            std::thread::sleep(AUTO_TICK);
        }
    });
}

fn auto_tick(app: &AppHandle, last: &mut Option<Option<String>>) {
    let profiles = app.state::<crate::Shared>().settings.locked().profiles.clone();
    let has_rules = profiles.list.iter().any(|p| p.rule.kind != "none");
    if !profiles.auto || !has_rules {
        *last = None; // au rallumage, on applique tout de suite ce que disent les règles
        return;
    }
    use chrono::{Datelike, Timelike};
    let now = chrono::Local::now();
    let weekday = now.weekday().number_from_monday() as u8;
    let minutes = now.hour() * 60 + now.minute();
    // On ne lit le Wi-Fi que si une règle en a besoin.
    let ssid = if profiles.list.iter().any(|p| p.rule.kind == "wifi") { crate::platform::wifi::current_ssid() } else { None };
    let wanted = pick(&profiles.list, weekday, minutes, ssid.as_deref());
    let first = last.is_none();
    if last.as_ref() == Some(&wanted) {
        return; // rien n'a changé depuis le tour d'avant : on respecte un choix manuel
    }
    *last = Some(wanted.clone());
    // Au premier regard, « aucune règle » ne défait pas le profil choisi à la main.
    let target = match wanted {
        Some(id) => id,
        None if first => return,
        None => String::new(),
    };
    if target != profiles.active {
        if let Err(e) = activate(app, &target) {
            log::warn(format!("profils : changement automatique impossible ({e})"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hours(days: &[u8], start: &str, end: &str) -> ProfileRule {
        ProfileRule { kind: "hours".into(), days: days.to_vec(), start: start.into(), end: end.into(), ssid: String::new() }
    }

    fn wifi(ssid: &str) -> ProfileRule {
        ProfileRule { kind: "wifi".into(), ssid: ssid.into(), ..ProfileRule::default() }
    }

    fn profile(id: &str, rule: ProfileRule) -> Profile {
        Profile { id: id.into(), name: id.into(), values: ProfileValues::default(), rule }
    }

    const MON: u8 = 1;
    const FRI: u8 = 5;
    const SAT: u8 = 6;
    const SUN: u8 = 7;
    const fn at(h: u32, m: u32) -> u32 {
        h * 60 + m
    }

    #[test]
    fn hhmm_is_read() {
        assert_eq!(parse_hhmm("09:30"), Some(570));
        assert_eq!(parse_hhmm(" 0:05 "), Some(5));
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("9h"), None);
    }

    #[test]
    fn office_hours_on_weekdays() {
        let r = hours(&[1, 2, 3, 4, 5], "09:00", "18:00");
        assert!(rule_matches(&r, MON, at(9, 0), None));
        assert!(rule_matches(&r, FRI, at(17, 59), None));
        assert!(!rule_matches(&r, FRI, at(18, 0), None), "la fin est exclue");
        assert!(!rule_matches(&r, MON, at(8, 59), None));
        assert!(!rule_matches(&r, SAT, at(10, 0), None), "pas le week-end");
    }

    #[test]
    fn a_range_can_pass_midnight() {
        let r = hours(&[5], "22:00", "06:00"); // vendredi soir
        assert!(rule_matches(&r, FRI, at(23, 0), None));
        assert!(rule_matches(&r, SAT, at(5, 0), None), "samedi matin = suite du vendredi");
        assert!(!rule_matches(&r, SAT, at(23, 0), None));
        assert!(!rule_matches(&r, FRI, at(5, 0), None), "vendredi matin = suite du jeudi, pas coché");
        let sunday = hours(&[7], "22:00", "06:00");
        assert!(rule_matches(&sunday, MON, at(1, 0), None), "lundi matin = suite du dimanche");
    }

    #[test]
    fn wifi_ignores_case_and_needs_a_network() {
        let r = wifi("Bureau-5G");
        assert!(rule_matches(&r, MON, 0, Some("bureau-5g")));
        assert!(!rule_matches(&r, MON, 0, Some("Maison")));
        assert!(!rule_matches(&r, MON, 0, None));
        assert!(!rule_matches(&wifi(""), MON, 0, Some("")), "un nom vide ne correspond à rien");
    }

    #[test]
    fn pick_prefers_wifi_then_list_order() {
        let list = vec![
            profile("travail", hours(&[1, 2, 3, 4, 5], "09:00", "18:00")),
            profile("soir", hours(&[1, 2, 3, 4, 5, 6, 7], "08:00", "23:00")),
            profile("maison", wifi("Freebox-1234")),
            profile("manuel", ProfileRule::default()),
        ];
        assert_eq!(pick(&list, MON, at(10, 0), None).as_deref(), Some("travail"));
        assert_eq!(pick(&list, MON, at(10, 0), Some("Freebox-1234")).as_deref(), Some("maison"));
        assert_eq!(pick(&list, SUN, at(10, 0), None).as_deref(), Some("soir"));
        assert_eq!(pick(&list, SUN, at(23, 30), Some("Autre")), None);
    }

    fn settings_with(profiles: Vec<Profile>) -> Settings {
        let mut s = Settings::default();
        s.profiles.list = profiles;
        s
    }

    #[test]
    fn switching_keeps_base_and_profile_edits() {
        let travail = Profile {
            id: "travail".into(),
            name: "Travail".into(),
            values: ProfileValues {
                theme: Some("ocean".into()),
                modules: Some(BTreeMap::from([("media".to_string(), false)])),
                ..Default::default()
            },
            rule: ProfileRule::default(),
        };
        let mut s = settings_with(vec![travail]);
        s.island.theme = "nuit".into();

        assert!(switch(&mut s, "travail"));
        assert_eq!(s.island.theme, "ocean");
        assert!(!s.module_enabled("media"));
        assert!(!switch(&mut s, "travail"), "déjà actif");
        assert!(!switch(&mut s, "inconnu"));

        // Pendant le profil : une retouche de ce qu'il remplace (le thème) et
        // d'un réglage qu'il ne touche pas (« Toujours en mini »).
        s.island.theme = "prune".into();
        s.island.always_mini = true;

        assert!(switch(&mut s, ""));
        assert_eq!(s.island.theme, "nuit", "la base revient");
        assert!(s.module_enabled("media"));
        assert!(s.island.always_mini, "le réglage hors profil est gardé");

        assert!(switch(&mut s, "travail"));
        assert_eq!(s.island.theme, "prune", "la retouche du profil est gardée");
        assert!(s.island.always_mini);
    }

    #[test]
    fn switching_between_two_profiles() {
        let a = Profile { id: "a".into(), name: "A".into(), values: ProfileValues { always_mini: Some(true), ..Default::default() }, rule: ProfileRule::default() };
        let b = Profile { id: "b".into(), name: "B".into(), values: ProfileValues { tab_order: Some(vec!["notes".into()]), ..Default::default() }, rule: ProfileRule::default() };
        let mut s = settings_with(vec![a, b]);
        switch(&mut s, "a");
        assert!(s.island.always_mini);
        switch(&mut s, "b");
        assert!(!s.island.always_mini, "B ne remplace pas « mini » : valeur hors profil");
        assert_eq!(s.island.tab_order, ["notes"]);
        switch(&mut s, "");
        assert!(s.island.tab_order.is_empty());
    }

    #[test]
    fn sanitize_cleans_up() {
        let mut p = Profiles {
            list: vec![profile("x", ProfileRule { kind: "??".into(), days: vec![0, 3, 3, 9], start: "25:00".into(), ..ProfileRule::default() }), profile("x", ProfileRule::default())],
            active: "gone".into(),
            ..Default::default()
        };
        sanitize(&mut p);
        assert_eq!(p.list.len(), 1, "ids en double retirés");
        assert_eq!(p.list[0].rule.kind, "none");
        assert_eq!(p.list[0].rule.days, [3]);
        assert_eq!(p.list[0].rule.start, "09:00");
        assert!(p.active.is_empty());
    }
}
