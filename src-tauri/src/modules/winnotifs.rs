// Module « Notifications de Windows » : les bulles des autres applis dans l'île.
//
// Désactivé par défaut (services/settings.rs, MODULES_OFF_BY_DEFAULT) : il lit
// le contenu des notifications des autres applis. Une fois activé, un thread :
//   1. ouvre le lecteur de notifications de Windows (platform/winnotifs.rs) ;
//      absent (Windows 10 d'avant 2016) : état `unavailable`, on n'insiste pas ;
//   2. demande l'accès ; refusé (réglage de confidentialité de Windows) : état
//      `denied`, regardé de nouveau toutes les 10 s (léger) pour repartir dès
//      que la personne coche la case dans Paramètres ;
//   3. relit la liste du Centre de notifications à intervalle régulier
//      (perf::Loop::WinNotifs : 1 / 1,5 / 4 s ; l'événement NotificationChanged
//      de Windows demande une appli du Store) et repère les nouvelles par leur
//      id. Celles déjà là au démarrage (ou à la réactivation) ne s'affichent
//      pas : seulement ce qui arrive ensuite ;
//   4. pour chaque nouvelle, lit l'appli (nom, logo s'il est simple à lire) et
//      le texte du modèle ToastGeneric, applique les filtres (applis ignorées,
//      « seulement ces applis ») et publie `winnotifs.new` sur le bus. Le front
//      en fait une notification de l'île (file api.notify : concentration,
//      présentation et mode Calme s'appliquent comme aux autres).
//
// Confidentialité : le texte des notifications passe par la mémoire seulement
// (le bus, l'onglet), jamais sur le disque ni dans le journal ; le journal ne
// reçoit que des états (« accès refusé ») et des erreurs de Windows. Un logo
// d'appli est gardé en mémoire le temps de la session (64 applis au plus).
//
// « Retirer du Centre de notifications une fois montrée » (coupé par défaut) :
// RemoveNotification sans paquet n'est pas garanti. Le module le vérifie de
// lui-même : une notification retirée qui est encore là à la lecture suivante
// (ou une erreur de Windows) = refusé, l'état `remove: "refused"` le dit au
// front et le module n'essaie plus jusqu'au redémarrage.

use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use super::{ModuleContext, RustModule};
use crate::platform::winnotifs::{self as wn, Access, Toast};
use crate::services::log;
use crate::services::perf::{self, Loop};
use crate::sync::LockExt;

const ID: &str = "winnotifs";

/// Module coupé : on regarde s'il est rallumé toutes les…
const IDLE: Duration = Duration::from_secs(3);
/// Accès refusé : on regarde de nouveau (GetAccessStatus, très léger) toutes les…
const DENIED_RECHECK: Duration = Duration::from_secs(10);
/// API absente ou en panne : on réessaie (rarement) toutes les…
const BROKEN_RETRY: Duration = Duration::from_secs(5 * 60);
/// Au plus ce nombre de nouvelles montrées d'un coup (sortie de veille, rafale) ;
/// les autres sont notées comme vues, sans bruit.
const MAX_BURST: usize = 5;
/// Logos gardés en mémoire (une entrée par appli).
const MAX_APPS: usize = 64;
/// Longueurs gardées : titre, corps (en caractères), lignes du corps.
const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 400;
const MAX_BODY_LINES: usize = 4;

// ── L'état partagé (thread ↔ commandes) ──────────────────────────────────────

/// Ce que le front sait de l'accès (commande `status`, événement `winnotifs.status`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Status {
    /// off · starting · allowed · denied · unavailable · error
    pub state: &'static str,
    /// Le retrait du Centre de notifications : unknown · ok · refused.
    pub remove: &'static str,
}

impl Default for Status {
    fn default() -> Self {
        Status { state: "off", remove: "unknown" }
    }
}

/// Une appli vue : son AUMID (pour l'ouvrir) et son logo en data URL.
struct App {
    app_id: String,
    logo: Option<String>,
}

#[derive(Default)]
struct Inner {
    status: Status,
    /// Clé courte (app_key) → appli. Jamais de contenu de notification ici.
    apps: HashMap<String, App>,
    /// Retraits demandés, à vérifier à la lecture suivante.
    removing: Vec<(u32, Instant)>,
    /// Le front demande de relancer la demande d'accès (« Vérifier de nouveau »).
    recheck: bool,
}

#[derive(Default)]
pub struct WinNotifs {
    state: Arc<Mutex<Inner>>,
}

impl RustModule for WinNotifs {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/winnotifs/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let app = app.clone();
        let state = self.state.clone();
        std::thread::spawn(move || run(app, state));
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let key = || args.get("key").and_then(Value::as_str).unwrap_or_default().to_string();
        match command {
            // (Appelée seulement module activé : « off » veut dire que le fil n'a pas encore vu l'activation.)
            "status" => {
                let mut status = self.state.locked().status.clone();
                if status.state == "off" {
                    status.state = "starting";
                }
                Ok(json!(status))
            }
            // « Vérifier de nouveau » : le thread redemande l'accès à son prochain tour.
            "recheck" => {
                self.state.locked().recheck = true;
                Ok(Value::Null)
            }
            // Paramètres → Confidentialité → Notifications.
            "open_settings" => {
                crate::platform::shell_open("ms-settings:privacy-notifications")?;
                Ok(Value::Null)
            }
            "icon" => Ok(json!({ "url": self.state.locked().apps.get(&key()).and_then(|a| a.logo.clone()) })),
            // « Ouvrir » : l'appli de la notification (son AUMID, gardé ici, jamais envoyé au front).
            "open_app" => {
                let app_id = self.state.locked().apps.get(&key()).map(|a| a.app_id.clone()).ok_or("appli inconnue")?;
                if !aumid_ok(&app_id) {
                    return Err("cette appli ne s'ouvre pas d'ici".into());
                }
                wn::open_app(&app_id)?;
                Ok(Value::Null)
            }
            // Retirer une notification montrée du Centre de notifications (réglage coupé par défaut).
            "remove" => {
                let id = args.get("id").and_then(Value::as_u64).ok_or("notification manquante")? as u32;
                let mut st = self.state.locked();
                if st.status.remove == "refused" {
                    return Ok(json!({ "removed": false }));
                }
                match wn::remove(id) {
                    Ok(()) => {
                        st.removing.push((id, Instant::now()));
                        Ok(json!({ "removed": true }))
                    }
                    Err(e) => {
                        log::warn(format!("notifications de Windows : {e}"));
                        st.status.remove = "refused";
                        ctx.emit("winnotifs.status", json!(st.status));
                        Ok(json!({ "removed": false }))
                    }
                }
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

// ── Réglages ─────────────────────────────────────────────────────────────────

/// Les réglages du module, avec leurs valeurs par défaut (celles du manifeste).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Prefs {
    pub show_body: bool,
    pub ignore: Vec<String>,
    pub only: Vec<String>,
}

impl Prefs {
    pub fn from(s: &Map<String, Value>) -> Prefs {
        let text = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or_default();
        Prefs {
            show_body: s.get("showBody").and_then(Value::as_bool).unwrap_or(true),
            ignore: split_list(text("ignoreApps")),
            only: split_list(text("onlyApps")),
        }
    }
}

// ── Les calculs (testés) ─────────────────────────────────────────────────────

/// Les ids nouveaux de la liste `current` (dans son ordre). `seen` garde les
/// ids présents : ceux qui ont disparu sont oubliés (une notification republiée
/// avec le même id se montrera de nouveau). `primed` faux (premier tour) : tout
/// est noté comme vu, rien n'est nouveau.
pub fn fresh_ids(seen: &mut HashSet<u32>, current: &[u32], primed: bool) -> Vec<u32> {
    let mut fresh = Vec::new();
    for &id in current {
        if seen.insert(id) && primed && !fresh.contains(&id) {
            fresh.push(id);
        }
    }
    let now: HashSet<u32> = current.iter().copied().collect();
    seen.retain(|id| now.contains(id));
    fresh
}

/// « Outlook, Teams ; Slack » → ["outlook", "teams", "slack"] (minuscules, sans
/// doublon, deux caractères au moins, 50 noms au plus).
pub fn split_list(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in raw.split([',', ';', '\n']) {
        let name = part.trim().to_lowercase();
        if name.chars().count() >= 2 && !out.contains(&name) && out.len() < 50 {
            out.push(name);
        }
    }
    out
}

/// L'appli passe-t-elle les filtres ? Un nom de la liste correspond s'il est
/// contenu dans le nom affiché ou l'identifiant de l'appli (« teams » trouve
/// « Microsoft Teams »). `only` vide : toutes, sauf celles de `ignore`.
pub fn app_allowed(app_name: &str, app_id: &str, ignore: &[String], only: &[String]) -> bool {
    let name = app_name.to_lowercase();
    let id = app_id.to_lowercase();
    let hit = |list: &[String]| list.iter().any(|w| name.contains(w.as_str()) || id.contains(w.as_str()));
    !hit(ignore) && (only.is_empty() || hit(only))
}

/// Coupe un texte à `max` caractères (avec « … »).
pub fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out = out.trim_end().to_string();
    out.push('…');
    out
}

/// Une ligne propre : sans caractères de contrôle ni espaces en trop.
fn tidy(line: &str) -> String {
    line.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Titre et corps d'une notification, d'après ses lignes ToastGeneric : la
/// première ligne non vide est le titre, les suivantes (4 au plus) le corps.
/// None : rien à montrer (notification sans texte).
pub fn extract(texts: &[String]) -> Option<(String, String)> {
    let mut lines = texts.iter().map(|t| tidy(t)).filter(|t| !t.is_empty());
    let title = lines.next()?;
    let body: Vec<String> = lines.take(MAX_BODY_LINES).collect();
    Some((clip(&title, MAX_TITLE), clip(&body.join("\n"), MAX_BODY)))
}

/// Une clé courte et stable pour une appli (FNV-1a de son identifiant) : le
/// front l'utilise pour le logo et « Ouvrir », sans jamais voir l'AUMID.
pub fn app_key(app_id: &str, app_name: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in app_id.bytes().chain([0u8]).chain(app_name.bytes()) {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{h:08x}")
}

/// Un AUMID qu'on peut ouvrir par shell:AppsFolder\… : lettres, chiffres et
/// quelques signes (« Microsoft.Office.OUTLOOK.EXE.15 »,
/// « {6D809377-6AF0-444B-8957-A3773F02200E}\Notepad++\notepad++.exe »,
/// « MSTeams_8wekyb3d8bbwe!MSTeams »). Rien qui ressemble à une commande.
pub fn aumid_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 260
        && !s.contains("..")
        && s.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '!' | '{' | '}' | '\\' | ' ' | '+'))
}

/// Ce que le front reçoit pour une nouvelle notification (`winnotifs.new`).
pub fn payload(t: &Toast, prefs: &Prefs, has_icon: bool) -> Option<Value> {
    let (title, body) = extract(&t.texts)?;
    let app = clip(&tidy(&t.app_name), 60);
    Some(json!({
        "id": t.id,
        "app": if app.is_empty() { "Windows".to_string() } else { app },
        "key": app_key(&t.app_id, &t.app_name),
        "icon": has_icon,
        "title": title,
        "body": if prefs.show_body { body } else { String::new() },
    }))
}

// ── Le thread ────────────────────────────────────────────────────────────────

fn set_status(app: &AppHandle, state: &Arc<Mutex<Inner>>, new_state: &'static str) {
    let status = {
        let mut st = state.locked();
        if st.status.state == new_state {
            return;
        }
        st.status.state = new_state;
        st.status.clone()
    };
    // Seulement l'état, jamais un contenu.
    log::info(format!("notifications de Windows : {new_state}"));
    emit_status(app, &status);
}

fn emit_status(app: &AppHandle, status: &Status) {
    let _ = super::with_context(app, ID, |ctx| ctx.emit("winnotifs.status", json!(status)));
}

/// L'accès : demandé sur ce fil ; si Windows refuse de répondre hors du fil de
/// l'interface, la demande est relancée sur celui-ci et attendue ici.
fn request(app: &AppHandle, listener: &wn::Listener) -> Result<Access, String> {
    match listener.request_access() {
        Ok(a) => Ok(a),
        Err(first) => {
            let (tx, rx) = std::sync::mpsc::channel();
            let sent = app.run_on_main_thread(move || {
                let _ = tx.send(wn::start_request());
            });
            if sent.is_err() {
                return listener.access().map_err(|_| first);
            }
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(pending)) => pending.wait(),
                _ => listener.access().map_err(|_| first),
            }
        }
    }
}

fn run(app: AppHandle, state: Arc<Mutex<Inner>>) {
    // Le lecteur, ouvert à la première activation (None : pas encore, ou absent).
    let mut listener: Option<wn::Listener> = None;
    let mut seen: HashSet<u32> = HashSet::new();
    let mut primed = false;
    let mut allowed = false;
    // L'accès a-t-il déjà été demandé (une fois par activation) ?
    let mut asked = false;
    // La dernière erreur de lecture journalisée (pas la même toutes les 10 s).
    let mut last_err = String::new();
    loop {
        let Some(prefs) = super::with_context(&app, ID, |ctx| Prefs::from(&ctx.settings())) else {
            // Module coupé : on oublie tout, la réactivation repartira de zéro
            // (les notifications déjà là ne s'afficheront pas).
            if primed || allowed || asked {
                seen.clear();
                primed = false;
                allowed = false;
                asked = false;
                state.locked().apps.clear();
            }
            set_status(&app, &state, "off");
            std::thread::sleep(IDLE);
            continue;
        };

        // « Vérifier de nouveau » (commande `recheck`) : pris une fois par tour.
        let recheck = std::mem::take(&mut state.locked().recheck);

        // 1. Le lecteur de Windows.
        if listener.is_none() {
            set_status(&app, &state, "starting");
            match wn::Listener::open() {
                Ok(l) => listener = Some(l),
                Err(e) => {
                    log::warn(format!("notifications de Windows : {e}"));
                    set_status(&app, &state, "unavailable");
                    sleep_unless_recheck(&state, BROKEN_RETRY);
                    continue;
                }
            }
        }
        let Some(l) = listener.as_ref() else { continue };

        // 2. L'accès : demandé une fois (et à chaque « Vérifier de nouveau »),
        //    sinon seulement regardé.
        if !allowed || recheck {
            let access = if recheck || !asked {
                asked = true;
                request(&app, l)
            } else {
                l.access()
            };
            match access {
                Ok(Access::Allowed) => {
                    allowed = true;
                    primed = false;
                    set_status(&app, &state, "allowed");
                }
                Ok(_) => {
                    allowed = false;
                    set_status(&app, &state, "denied");
                    sleep_unless_recheck(&state, DENIED_RECHECK);
                    continue;
                }
                Err(e) => {
                    log::warn(format!("notifications de Windows : {e}"));
                    allowed = false;
                    set_status(&app, &state, "error");
                    sleep_unless_recheck(&state, DENIED_RECHECK);
                    continue;
                }
            }
        }

        // 3. Un tour de lecture ; un tour qui panique ne tue pas le thread.
        match catch_unwind(AssertUnwindSafe(|| tick(&app, &state, l, &prefs, &mut seen, primed))) {
            Ok(Ok(())) => {
                primed = true;
                last_err.clear();
            }
            Ok(Err(e)) => {
                // La liste ne se lit plus : l'accès a peut-être été retiré entre-temps.
                if e != last_err {
                    log::warn(format!("notifications de Windows : {e}"));
                    last_err = e;
                }
                allowed = !matches!(l.access(), Ok(Access::Denied | Access::Unspecified));
                if !allowed {
                    set_status(&app, &state, "denied");
                }
                std::thread::sleep(DENIED_RECHECK);
                continue;
            }
            Err(_) => {
                log::warn("notifications de Windows : un tour a planté");
                std::thread::sleep(Duration::from_secs(5));
            }
        }
        sleep_unless_recheck(&state, perf::every(Loop::WinNotifs));
    }
}

/// Dort `total`, mais se réveille tout de suite si le front demande « Vérifier de nouveau ».
fn sleep_unless_recheck(state: &Arc<Mutex<Inner>>, total: Duration) {
    let end = Instant::now() + total;
    while Instant::now() < end {
        if state.locked().recheck {
            return;
        }
        std::thread::sleep(Duration::from_millis(250).min(end.saturating_duration_since(Instant::now())));
    }
}

/// Un tour : relit la liste, publie les nouvelles, vérifie les retraits.
fn tick(app: &AppHandle, state: &Arc<Mutex<Inner>>, l: &wn::Listener, prefs: &Prefs, seen: &mut HashSet<u32>, primed: bool) -> Result<(), String> {
    let handles = l.list()?;
    let ids: Vec<u32> = handles.iter().filter_map(|h| h.id()).collect();

    // Les retraits demandés : encore là = Windows refuse (sans paquet), on arrête d'essayer.
    let changed = {
        let mut st = state.locked();
        let before = st.status.remove;
        let checks: Vec<(u32, Instant)> = std::mem::take(&mut st.removing);
        for (id, at) in checks {
            if ids.contains(&id) {
                if at.elapsed() > Duration::from_millis(800) {
                    if st.status.remove != "refused" {
                        log::warn("notifications de Windows : Windows ne laisse pas retirer les notifications");
                    }
                    st.status.remove = "refused";
                } else {
                    st.removing.push((id, at));
                }
            } else if st.status.remove == "unknown" {
                st.status.remove = "ok";
            }
        }
        (st.status.remove != before).then(|| st.status.clone())
    };
    if let Some(status) = changed {
        emit_status(app, &status);
    }

    let mut fresh = fresh_ids(seen, &ids, primed);
    // Une rafale (sortie de veille) : seulement les dernières.
    if fresh.len() > MAX_BURST {
        fresh.drain(..fresh.len() - MAX_BURST);
    }
    for id in fresh {
        let Some(h) = handles.iter().find(|h| h.id() == Some(id)) else { continue };
        let toast = h.read();
        if !app_allowed(&toast.app_name, &toast.app_id, &prefs.ignore, &prefs.only) {
            continue;
        }
        let key = app_key(&toast.app_id, &toast.app_name);
        let has_icon = {
            let known = state.locked().apps.get(&key).map(|a| a.logo.is_some());
            match known {
                Some(has) => has,
                None => {
                    let logo = h.logo().map(|(bytes, mime)| {
                        let mime = if mime.starts_with("image/") { mime } else { "image/png".into() };
                        format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
                    });
                    let has = logo.is_some();
                    let mut st = state.locked();
                    if st.apps.len() >= MAX_APPS {
                        st.apps.clear();
                    }
                    st.apps.insert(key.clone(), App { app_id: toast.app_id.clone(), logo });
                    has
                }
            }
        };
        if let Some(p) = payload(&toast, prefs, has_icon) {
            let _ = super::with_context(app, ID, |ctx| ctx.emit("winnotifs.new", p));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_reading_shows_nothing_then_only_new_ones() {
        let mut seen = HashSet::new();
        // Au démarrage : 3 notifications déjà là, aucune n'est « nouvelle ».
        assert!(fresh_ids(&mut seen, &[1, 2, 3], false).is_empty());
        // Ensuite : seulement celles qui arrivent.
        assert_eq!(fresh_ids(&mut seen, &[1, 2, 3, 7], true), vec![7]);
        assert!(fresh_ids(&mut seen, &[1, 2, 3, 7], true).is_empty());
        // L'ordre de la liste est gardé, sans doublon.
        assert_eq!(fresh_ids(&mut seen, &[1, 9, 8, 9], true), vec![9, 8]);
    }

    #[test]
    fn a_dismissed_id_is_forgotten() {
        let mut seen = HashSet::new();
        fresh_ids(&mut seen, &[1, 2], false);
        // 1 fermée dans le Centre de notifications : oubliée…
        assert!(fresh_ids(&mut seen, &[2], true).is_empty());
        assert!(!seen.contains(&1));
        // … et si Windows republie le même id, elle se montre de nouveau.
        assert_eq!(fresh_ids(&mut seen, &[2, 1], true), vec![1]);
    }

    #[test]
    fn lists_are_split_and_cleaned() {
        assert_eq!(split_list(" Outlook, Teams ;slack\nTEAMS, x, "), vec!["outlook", "teams", "slack"]);
        assert!(split_list("").is_empty());
    }

    #[test]
    fn filters_ignore_and_only() {
        let ignore = split_list("teams");
        let none: Vec<String> = Vec::new();
        assert!(!app_allowed("Microsoft Teams", "MSTeams_8wekyb3d8bbwe!MSTeams", &ignore, &none));
        assert!(app_allowed("Outlook", "Microsoft.Office.OUTLOOK.EXE.15", &ignore, &none));
        // « Seulement ces applis » : le reste est ignoré.
        let only = split_list("outlook, whatsapp");
        assert!(app_allowed("Outlook", "Microsoft.Office.OUTLOOK.EXE.15", &none, &only));
        assert!(!app_allowed("Discord", "com.squirrel.Discord.Discord", &none, &only));
        // L'identifiant compte aussi (nom affiché vide).
        assert!(app_allowed("", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App", &none, &only));
        // Ignorée ET dans la liste : ignorée.
        assert!(!app_allowed("Outlook", "", &split_list("outlook"), &only));
    }

    #[test]
    fn text_is_extracted_from_toastgeneric_lines() {
        let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(extract(&t(&["Alex", "On mange à midi ?"])), Some(("Alex".into(), "On mange à midi ?".into())));
        // Lignes vides et espaces ignorés, contrôles retirés.
        assert_eq!(extract(&t(&["  ", "Réunion\u{7}  maintenant ", "", "Salle 2", "Lien"])), Some(("Réunion maintenant".into(), "Salle 2\nLien".into())));
        // Rien à montrer.
        assert_eq!(extract(&t(&["", " "])), None);
        assert_eq!(extract(&[]), None);
        // Trop long : coupé avec « … ».
        let long = "a".repeat(500);
        let (title, body) = extract(&[long.clone(), long]).unwrap();
        assert_eq!(title.chars().count(), MAX_TITLE);
        assert!(title.ends_with('…'));
        assert_eq!(body.chars().count(), MAX_BODY);
        // Au plus 4 lignes de corps.
        let (_, body) = extract(&t(&["T", "1", "2", "3", "4", "5"])).unwrap();
        assert_eq!(body, "1\n2\n3\n4");
    }

    #[test]
    fn clip_counts_characters_not_bytes() {
        assert_eq!(clip("éééé", 4), "éééé");
        assert_eq!(clip("ééééé", 4), "ééé…");
    }

    #[test]
    fn app_keys_are_short_and_stable() {
        let a = app_key("Microsoft.Office.OUTLOOK.EXE.15", "Outlook");
        assert_eq!(a.len(), 8);
        assert_eq!(a, app_key("Microsoft.Office.OUTLOOK.EXE.15", "Outlook"));
        assert_ne!(a, app_key("MSTeams_8wekyb3d8bbwe!MSTeams", "Microsoft Teams"));
    }

    #[test]
    fn only_plain_aumids_can_be_opened() {
        assert!(aumid_ok("Microsoft.Office.OUTLOOK.EXE.15"));
        assert!(aumid_ok("MSTeams_8wekyb3d8bbwe!MSTeams"));
        assert!(aumid_ok("{6D809377-6AF0-444B-8957-A3773F02200E}\\Notepad++\\notepad++.exe"));
        assert!(!aumid_ok(""));
        assert!(!aumid_ok("..\\..\\Windows\\System32\\cmd.exe"));
        assert!(!aumid_ok("x\" & calc"));
        assert!(!aumid_ok("https://exemple.fr/x"));
    }

    #[test]
    fn payload_respects_show_body() {
        let toast = Toast { id: 42, app_id: "App.Id".into(), app_name: "Messagerie".into(), texts: vec!["Alex".into(), "Coucou".into()] };
        let mut prefs = Prefs { show_body: true, ..Default::default() };
        let p = payload(&toast, &prefs, true).unwrap();
        assert_eq!(p["id"], 42);
        assert_eq!(p["app"], "Messagerie");
        assert_eq!(p["title"], "Alex");
        assert_eq!(p["body"], "Coucou");
        assert_eq!(p["icon"], true);
        // L'AUMID ne part jamais vers le front.
        assert!(!p.to_string().contains("App.Id"));
        prefs.show_body = false;
        assert_eq!(payload(&toast, &prefs, false).unwrap()["body"], "");
        // Sans nom d'appli : « Windows ».
        let anon = Toast { app_name: String::new(), ..toast };
        assert_eq!(payload(&anon, &prefs, false).unwrap()["app"], "Windows");
    }

    #[test]
    fn prefs_defaults() {
        let p = Prefs::from(&Map::new());
        assert!(p.show_body);
        assert!(p.ignore.is_empty() && p.only.is_empty());
        let mut m = Map::new();
        m.insert("showBody".into(), json!(false));
        m.insert("ignoreApps".into(), json!("Teams, Slack"));
        let p = Prefs::from(&m);
        assert!(!p.show_body);
        assert_eq!(p.ignore, vec!["teams", "slack"]);
    }
}
