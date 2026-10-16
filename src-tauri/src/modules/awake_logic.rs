// « Rester éveillé » : la partie pure, sans Windows ni Tauri (testée plus bas).
//
// Deux choses indépendantes :
//   - l'ÉVEIL (`Keep`) : Ondine demande à Windows de ne pas se mettre en veille
//     (et, si on le veut, de garder l'écran allumé) jusqu'à une heure précise,
//     sans limite, jusqu'à la fin du téléchargement en cours ou jusqu'à ce que
//     l'agent IA au travail ait fini ;
//   - l'ARRÊT PROGRAMMÉ (`Plan`) : éteindre, mettre en veille, redémarrer ou
//     verrouiller le PC à une heure précise, ou quand le téléchargement /
//     l'agent a fini. Toujours précédé d'un dernier avertissement de 60 s
//     (`WARN_MS`), même si le PC sort de veille après l'heure prévue.
//
// Les heures sont des millisecondes depuis le 1er janvier 1970 (comme
// `Date.now()` dans le front) : le front calcule « 18 h 30 » dans l'heure
// locale et envoie l'instant ; ici, on ne fait que le vérifier.

use serde_json::{json, Value};

/// Le dernier avertissement avant d'éteindre : 60 s.
pub const WARN_MS: u64 = 60_000;
/// « Encore 15 min » : ce que repousse le bouton du dernier avertissement.
pub const SNOOZE_MIN: u64 = 15;
/// Une durée choisie : de 1 minute à 24 heures.
const MAX_MINUTES: u64 = 24 * 60;
/// « Jusqu'à une heure » ou « à une heure » : au plus dans 48 heures.
const MAX_AHEAD_MS: u64 = 48 * 3_600_000;
/// Un fichier partiel de téléchargement qui n'a pas bougé depuis 5 min ne
/// compte plus (téléchargement abandonné ou en pause).
pub const STALE_PARTIAL_SECS: u64 = 5 * 60;
/// « Fini » : plus aucun téléchargement vu pendant deux tours de suite.
const DOWNLOAD_IDLE_ROUNDS: u8 = 2;

/// Jusqu'à quand le PC reste éveillé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Until {
    /// Jusqu'à cet instant (30 min, 1 h, 2 h, ou une heure choisie).
    At(u64),
    Forever,
    /// Jusqu'à la fin du téléchargement en cours (dossier Téléchargements).
    Download,
    /// Jusqu'à ce que l'agent IA au travail ait fini (module Agents IA).
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keep {
    pub until: Until,
    /// Garder aussi l'écran allumé (ES_DISPLAY_REQUIRED).
    pub display: bool,
    pub since: u64,
}

/// Ce que fait l'arrêt programmé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Power {
    Shutdown,
    Sleep,
    Restart,
    Lock,
}

impl Power {
    pub fn id(self) -> &'static str {
        match self {
            Power::Shutdown => "shutdown",
            Power::Sleep => "sleep",
            Power::Restart => "restart",
            Power::Lock => "lock",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "shutdown" => Some(Power::Shutdown),
            "sleep" => Some(Power::Sleep),
            "restart" => Some(Power::Restart),
            "lock" => Some(Power::Lock),
            _ => None,
        }
    }
}

/// Quand l'arrêt programmé a lieu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum When {
    At(u64),
    Download,
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub action: Power,
    pub when: When,
    /// Le dernier avertissement (60 s avant) a été donné pour l'heure actuelle.
    pub warned: bool,
}

/// Ce que l'arrêt programmé demande à ce tour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Nothing,
    /// Montrer le dernier avertissement : l'action aura lieu à cet instant.
    Warn(u64),
    /// L'heure est passée et l'avertissement a été donné : on y va.
    Fire,
}

/// Ce qu'on sait du PC à ce tour.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Signals {
    /// Un téléchargement est en cours (après lissage, voir `DownloadWatch`).
    pub downloading: bool,
    /// Au moins une session d'agent IA travaille (`agents.busy`).
    pub agent_busy: bool,
}

/// Une durée en minutes (1 à 1440) lue dans les arguments.
fn minutes_of(args: &Value) -> Result<u64, String> {
    let m = args.get("minutes").and_then(Value::as_f64).filter(|m| m.is_finite()).ok_or("durée manquante")?;
    let m = m.round();
    if !(1.0..=MAX_MINUTES as f64).contains(&m) {
        return Err("durée : de 1 minute à 24 heures".into());
    }
    Ok(m as u64)
}

/// Un instant à venir (au plus dans 48 h) lu dans les arguments.
fn instant_of(args: &Value, now: u64) -> Result<u64, String> {
    let at = args.get("at").and_then(Value::as_f64).filter(|a| a.is_finite() && *a > 0.0).ok_or("heure manquante")? as u64;
    if at <= now + 30_000 {
        return Err("cette heure est déjà passée".into());
    }
    if at - now > MAX_AHEAD_MS {
        return Err("au plus 48 heures à l'avance".into());
    }
    Ok(at)
}

/// La commande `keep` : `{until: "minutes", minutes}`, `{until: "at", at}`,
/// `{until: "forever" | "download" | "agent"}`, `display` facultatif.
/// `signals` : refuse « fin du téléchargement / de l'agent » s'il n'y en a pas.
pub fn parse_keep(args: &Value, now: u64, default_display: bool, signals: Signals) -> Result<Keep, String> {
    let until = match args.get("until").and_then(Value::as_str).unwrap_or("") {
        "minutes" => Until::At(now + minutes_of(args)? * 60_000),
        "at" => Until::At(instant_of(args, now)?),
        "forever" => Until::Forever,
        "download" if signals.downloading => Until::Download,
        "download" => return Err("Aucun téléchargement en cours dans le dossier Téléchargements".into()),
        "agent" if signals.agent_busy => Until::Agent,
        "agent" => return Err("Aucun agent IA ne travaille en ce moment".into()),
        other => return Err(format!("durée inconnue : {other:?}")),
    };
    let display = args.get("display").and_then(Value::as_bool).unwrap_or(default_display);
    Ok(Keep { until, display, since: now })
}

/// La commande `plan`. `confirmed: true` est obligatoire : le front ne
/// l'envoie qu'après le bouton de confirmation (rien d'irréversible sans).
pub fn parse_plan(args: &Value, now: u64, signals: Signals) -> Result<Plan, String> {
    if args.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err("confirmation manquante".into());
    }
    let action = args.get("action").and_then(Value::as_str).and_then(Power::parse).ok_or("action inconnue")?;
    let when = match args.get("when").and_then(Value::as_str).unwrap_or("") {
        "minutes" => When::At(now + minutes_of(args)? * 60_000),
        "at" => When::At(instant_of(args, now)?),
        "download" if signals.downloading => When::Download,
        "download" => return Err("Aucun téléchargement en cours dans le dossier Téléchargements".into()),
        "agent" if signals.agent_busy => When::Agent,
        "agent" => return Err("Aucun agent IA ne travaille en ce moment".into()),
        other => return Err(format!("moment inconnu : {other:?}")),
    };
    Ok(Plan { action, when, warned: false })
}

/// L'éveil est-il fini à ce tour ?
pub fn keep_over(keep: &Keep, now: u64, s: Signals) -> bool {
    match keep.until {
        Until::At(t) => now >= t,
        Until::Forever => false,
        Until::Download => !s.downloading,
        Until::Agent => !s.agent_busy,
    }
}

/// Un tour de l'arrêt programmé. Il n'agit JAMAIS sans avoir d'abord donné
/// le dernier avertissement : si l'heure est déjà passée (PC sorti de veille,
/// fin d'un téléchargement), elle est repoussée de 60 s et l'avertissement part.
pub fn plan_step(plan: &mut Plan, now: u64, s: Signals) -> Step {
    match plan.when {
        When::Download if !s.downloading => warn_at(plan, now + WARN_MS),
        When::Agent if !s.agent_busy => warn_at(plan, now + WARN_MS),
        When::Download | When::Agent => Step::Nothing,
        When::At(t) if now >= t && plan.warned => Step::Fire,
        When::At(t) if now >= t => warn_at(plan, now + WARN_MS),
        When::At(t) if !plan.warned && t - now <= WARN_MS => {
            plan.warned = true;
            Step::Warn(t)
        }
        When::At(_) => Step::Nothing,
    }
}

fn warn_at(plan: &mut Plan, at: u64) -> Step {
    plan.when = When::At(at);
    plan.warned = true;
    Step::Warn(at)
}

/// « Encore 15 min » : repousse l'heure (au moins 15 min à partir de maintenant).
pub fn snooze(plan: &mut Plan, now: u64, minutes: u64) {
    let base = match plan.when {
        When::At(t) => t.max(now),
        When::Download | When::Agent => now,
    };
    plan.when = When::At(base + minutes.clamp(1, 120) * 60_000);
    plan.warned = false;
}

/// Ce qu'il faut demander à Windows : rien (None), ou ne pas dormir, avec
/// l'écran allumé ou non (Some(display)).
pub fn wanted(keep: Option<&Keep>) -> Option<bool> {
    keep.map(|k| k.display)
}

/// Un nom du dossier Téléchargements est-il un téléchargement en cours ?
/// (Chrome et Edge : .crdownload ; Firefox : .part ; Opera : .opdownload…)
/// `age_secs` : depuis quand le fichier n'a pas été modifié.
pub fn is_in_progress(name: &str, age_secs: u64) -> bool {
    let n = name.to_lowercase();
    let partial = [".crdownload", ".part", ".partial", ".download", ".opdownload"].iter().any(|e| n.ends_with(e));
    partial && age_secs < STALE_PARTIAL_SECS
}

/// Lisse ce qu'on voit du dossier Téléchargements : un navigateur renomme son
/// fichier partiel à la fin (et peut en créer un nouveau juste après) ; « fini »
/// = plus rien vu pendant deux tours de suite.
#[derive(Debug, Default)]
pub struct DownloadWatch {
    active: bool,
    idle: u8,
}

impl DownloadWatch {
    /// Un tour : `seen` = un fichier partiel récent est là. Renvoie l'état lissé.
    pub fn step(&mut self, seen: bool) -> bool {
        if seen {
            self.active = true;
            self.idle = 0;
        } else if self.active {
            self.idle += 1;
            if self.idle >= DOWNLOAD_IDLE_ROUNDS {
                self.active = false;
                self.idle = 0;
            }
        }
        self.active
    }
}

/// L'état tel que le front l'affiche (sujet `awake.state`, commande `status`).
pub fn state_json(keep: Option<&Keep>, plan: Option<&Plan>, s: Signals, coffee: bool) -> Value {
    let keep = keep.map(|k| {
        let (until, at) = match k.until {
            Until::At(t) => ("at", Some(t)),
            Until::Forever => ("forever", None),
            Until::Download => ("download", None),
            Until::Agent => ("agent", None),
        };
        json!({ "until": until, "at": at, "display": k.display, "since": k.since })
    });
    let plan = plan.map(|p| {
        let (when, at) = match p.when {
            When::At(t) => ("at", Some(t)),
            When::Download => ("download", None),
            When::Agent => ("agent", None),
        };
        json!({ "action": p.action.id(), "when": when, "at": at, "warned": p.warned })
    });
    json!({ "keep": keep, "plan": plan, "downloading": s.downloading, "agentBusy": s.agent_busy, "coffee": coffee })
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000_000;
    const IDLE: Signals = Signals { downloading: false, agent_busy: false };
    const BOTH: Signals = Signals { downloading: true, agent_busy: true };

    #[test]
    fn keep_durations() {
        let k = parse_keep(&json!({ "until": "minutes", "minutes": 30 }), NOW, false, IDLE).unwrap();
        assert_eq!(k.until, Until::At(NOW + 30 * 60_000));
        assert!(!k.display);
        let k = parse_keep(&json!({ "until": "forever", "display": true }), NOW, false, IDLE).unwrap();
        assert_eq!(k.until, Until::Forever);
        assert!(k.display);
        // L'écran : le réglage, sauf si la commande dit autre chose.
        assert!(parse_keep(&json!({ "until": "forever" }), NOW, true, IDLE).unwrap().display);
        assert!(parse_keep(&json!({ "until": "minutes", "minutes": 0 }), NOW, false, IDLE).is_err());
        assert!(parse_keep(&json!({ "until": "minutes", "minutes": 1441 }), NOW, false, IDLE).is_err());
        assert!(parse_keep(&json!({ "until": "minutes" }), NOW, false, IDLE).is_err());
        assert!(parse_keep(&json!({ "until": "toujours" }), NOW, false, IDLE).is_err());
    }

    #[test]
    fn keep_until_a_time() {
        let at = NOW + 3 * 3_600_000;
        assert_eq!(parse_keep(&json!({ "until": "at", "at": at }), NOW, false, IDLE).unwrap().until, Until::At(at));
        assert!(parse_keep(&json!({ "until": "at", "at": NOW - 1 }), NOW, false, IDLE).is_err(), "passée");
        assert!(parse_keep(&json!({ "until": "at", "at": NOW + 49 * 3_600_000 }), NOW, false, IDLE).is_err(), "trop loin");
    }

    #[test]
    fn download_and_agent_need_something_running() {
        assert!(parse_keep(&json!({ "until": "download" }), NOW, false, IDLE).is_err());
        assert!(parse_keep(&json!({ "until": "agent" }), NOW, false, IDLE).is_err());
        assert_eq!(parse_keep(&json!({ "until": "download" }), NOW, false, BOTH).unwrap().until, Until::Download);
        assert_eq!(parse_keep(&json!({ "until": "agent" }), NOW, false, BOTH).unwrap().until, Until::Agent);
    }

    #[test]
    fn keep_ends_at_the_right_moment() {
        let k = Keep { until: Until::At(NOW + 1000), display: false, since: NOW };
        assert!(!keep_over(&k, NOW, IDLE));
        assert!(keep_over(&k, NOW + 1000, IDLE));
        let k = Keep { until: Until::Forever, display: false, since: NOW };
        assert!(!keep_over(&k, NOW + 10 * 86_400_000, IDLE));
        let k = Keep { until: Until::Download, display: false, since: NOW };
        assert!(!keep_over(&k, NOW, BOTH));
        assert!(keep_over(&k, NOW, IDLE));
        let k = Keep { until: Until::Agent, display: true, since: NOW };
        assert!(!keep_over(&k, NOW, BOTH));
        assert!(keep_over(&k, NOW, Signals { downloading: true, agent_busy: false }));
    }

    #[test]
    fn what_windows_is_asked() {
        assert_eq!(wanted(None), None);
        assert_eq!(wanted(Some(&Keep { until: Until::Forever, display: false, since: 0 })), Some(false));
        assert_eq!(wanted(Some(&Keep { until: Until::Forever, display: true, since: 0 })), Some(true));
    }

    #[test]
    fn a_plan_needs_confirmation() {
        let args = json!({ "action": "shutdown", "when": "minutes", "minutes": 60 });
        assert!(parse_plan(&args, NOW, IDLE).is_err());
        let mut ok = args.clone();
        ok["confirmed"] = json!(true);
        let p = parse_plan(&ok, NOW, IDLE).unwrap();
        assert_eq!((p.action, p.when, p.warned), (Power::Shutdown, When::At(NOW + 3_600_000), false));
        assert!(parse_plan(&json!({ "action": "format", "when": "minutes", "minutes": 5, "confirmed": true }), NOW, IDLE).is_err());
        assert!(parse_plan(&json!({ "action": "sleep", "when": "download", "confirmed": true }), NOW, IDLE).is_err());
        assert_eq!(parse_plan(&json!({ "action": "lock", "when": "agent", "confirmed": true }), NOW, BOTH).unwrap().when, When::Agent);
        for a in ["shutdown", "sleep", "restart", "lock"] {
            let p = parse_plan(&json!({ "action": a, "when": "minutes", "minutes": 5, "confirmed": true }), NOW, IDLE).unwrap();
            assert_eq!(p.action.id(), a);
        }
    }

    #[test]
    fn always_warned_60_s_before() {
        let mut p = Plan { action: Power::Shutdown, when: When::At(NOW + 5 * 60_000), warned: false };
        assert_eq!(plan_step(&mut p, NOW, IDLE), Step::Nothing);
        // 60 s avant : l'avertissement, une seule fois.
        let t = NOW + 4 * 60_000;
        assert_eq!(plan_step(&mut p, t, IDLE), Step::Warn(NOW + 5 * 60_000));
        assert_eq!(plan_step(&mut p, t + 1000, IDLE), Step::Nothing);
        assert_eq!(plan_step(&mut p, NOW + 5 * 60_000, IDLE), Step::Fire);
    }

    #[test]
    fn past_deadline_without_warning_is_pushed_back() {
        // Le PC sort de veille longtemps après l'heure : pas d'arrêt d'un coup.
        let mut p = Plan { action: Power::Restart, when: When::At(NOW), warned: false };
        let late = NOW + 3_600_000;
        assert_eq!(plan_step(&mut p, late, IDLE), Step::Warn(late + WARN_MS));
        assert_eq!(plan_step(&mut p, late + 30_000, IDLE), Step::Nothing);
        assert_eq!(plan_step(&mut p, late + WARN_MS, IDLE), Step::Fire);
    }

    #[test]
    fn download_or_agent_finished_then_warning() {
        let mut p = Plan { action: Power::Sleep, when: When::Download, warned: false };
        assert_eq!(plan_step(&mut p, NOW, BOTH), Step::Nothing);
        assert_eq!(plan_step(&mut p, NOW + 1000, IDLE), Step::Warn(NOW + 1000 + WARN_MS));
        assert_eq!(p.when, When::At(NOW + 1000 + WARN_MS));
        let mut p = Plan { action: Power::Lock, when: When::Agent, warned: false };
        assert_eq!(plan_step(&mut p, NOW, Signals { downloading: false, agent_busy: true }), Step::Nothing);
        assert!(matches!(plan_step(&mut p, NOW, IDLE), Step::Warn(_)));
    }

    #[test]
    fn snooze_adds_15_minutes_and_rearms_the_warning() {
        let mut p = Plan { action: Power::Shutdown, when: When::At(NOW + 30_000), warned: true };
        snooze(&mut p, NOW, SNOOZE_MIN);
        assert_eq!(p.when, When::At(NOW + 30_000 + 15 * 60_000));
        assert!(!p.warned);
        // Déjà passée : à partir de maintenant.
        let mut p = Plan { action: Power::Shutdown, when: When::At(NOW - 5000), warned: true };
        snooze(&mut p, NOW, SNOOZE_MIN);
        assert_eq!(p.when, When::At(NOW + 15 * 60_000));
    }

    #[test]
    fn partial_download_names() {
        assert!(is_in_progress("film.mkv.crdownload", 2));
        assert!(is_in_progress("Unconfirmed 123456.crdownload", 0));
        assert!(is_in_progress("iso.iso.PART", 10));
        assert!(is_in_progress("a.opdownload", 10));
        assert!(!is_in_progress("film.mkv", 0));
        assert!(!is_in_progress(".DS_Store", 0));
        assert!(!is_in_progress("setup.tmp", 0), "les .tmp ne disent rien");
        // Abandonné depuis longtemps : ne garde pas le PC éveillé pour toujours.
        assert!(!is_in_progress("vieux.part", STALE_PARTIAL_SECS));
    }

    #[test]
    fn download_watch_waits_two_rounds() {
        let mut w = DownloadWatch::default();
        assert!(!w.step(false));
        assert!(w.step(true));
        assert!(w.step(false), "le navigateur renomme : encore en cours");
        assert!(w.step(true), "un deuxième fichier commence");
        assert!(w.step(false));
        assert!(!w.step(false), "deux tours sans rien : fini");
    }

    #[test]
    fn state_for_the_front() {
        let k = Keep { until: Until::At(NOW + 1), display: true, since: NOW };
        let p = Plan { action: Power::Sleep, when: When::Agent, warned: false };
        let v = state_json(Some(&k), Some(&p), BOTH, true);
        assert_eq!(v["keep"]["until"], "at");
        assert_eq!(v["keep"]["at"], NOW + 1);
        assert_eq!(v["keep"]["display"], true);
        assert_eq!(v["plan"]["action"], "sleep");
        assert_eq!(v["plan"]["when"], "agent");
        assert!(v["plan"]["at"].is_null());
        assert_eq!(v["coffee"], true);
        let v = state_json(None, None, IDLE, false);
        assert!(v["keep"].is_null() && v["plan"].is_null());
    }
}
