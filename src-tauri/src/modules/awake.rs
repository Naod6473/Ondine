// Module « Rester éveillé » (id `awake`), côté Rust : garder le PC éveillé
// (façon Caffeine) et l'arrêt programmé. Désactivé par défaut
// (MODULES_OFF_BY_DEFAULT) ; activé, il ne fait rien tant qu'on ne clique pas.
//
// UN fil à lui (`run`) fait tout le travail, parce que la demande faite à
// Windows (SetThreadExecutionState, platform/power.rs) appartient au fil qui
// l'a faite :
//   - il applique ce que veut l'état (rester éveillé, avec ou sans l'écran) et
//     le relâche dès que l'éveil finit (durée écoulée, téléchargement ou agent
//     fini, « Arrêter », module désactivé, Ondine qui se ferme : `release_now`
//     depuis lib.rs ; et si Ondine plante, Windows l'oublie avec le fil) ;
//   - il fait avancer l'arrêt programmé : dernier avertissement 60 s avant
//     (`awake.warn`, l'île montre « Annuler » et « Encore 15 min »), puis
//     l'action (awake_logic.rs décide, ici on agit).
// Le fil dort tant que rien n'est en cours (aucun tour) ; une commande le
// réveille tout de suite. Pendant un éveil ou un arrêt programmé : un tour par
// seconde (un verrou et quelques comparaisons), et le dossier Téléchargements
// lu toutes les 3 s seulement si on attend la fin d'un téléchargement.
//
// La fin d'un agent : le module Agents IA publie `agents.busy {working}` quand
// le nombre de sessions au travail change (et répond à `agents.busy-ask`).
//
// Rien de ceci n'est gardé sur le disque : un arrêt programmé ne survit pas à
// un redémarrage d'Ondine (le plus sûr).

use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::AppHandle;

use super::awake_logic::{self as logic, DownloadWatch, Keep, Plan, Power, Signals, Step, Until, When};
use super::{ModuleContext, RustModule};
use crate::platform;
use crate::services::bus::{self, BusMessage};
use crate::services::log;
use crate::sync::LockExt;

const ID: &str = "awake";
/// Un tour par seconde pendant un éveil ou un arrêt programmé.
const TICK: Duration = Duration::from_secs(1);
/// Le dossier Téléchargements : un coup d'œil toutes les 3 s (quand on l'attend).
const DOWNLOAD_EVERY: u32 = 3;

#[derive(Default)]
struct State {
    keep: Option<Keep>,
    plan: Option<Plan>,
    signals: Signals,
    downloads: DownloadWatch,
    /// Agents IA a déjà été interrogé (`agents.busy-ask`).
    asked_agents: bool,
}

type Shared = Arc<Mutex<State>>;

/// Ce qu'on peut dire au fil.
enum Wake {
    /// L'état a changé : refaire un tour tout de suite.
    Now,
    /// Ondine se ferme : tout relâcher, puis répondre.
    Exit(Sender<()>),
}

/// Le canal vers le fil (posé au démarrage du module).
static WAKE: OnceLock<Mutex<Sender<Wake>>> = OnceLock::new();

fn wake() {
    if let Some(tx) = WAKE.get() {
        let _ = tx.locked().send(Wake::Now);
    }
}

/// Ondine se ferme (lib.rs, RunEvent::Exit) : le fil relâche sa demande à
/// Windows avant la fin (au plus 500 ms d'attente). Sans le module, rien.
pub fn release_now() {
    let Some(tx) = WAKE.get() else { return };
    let (done_tx, done_rx) = channel();
    if tx.locked().send(Wake::Exit(done_tx)).is_ok() {
        let _ = done_rx.recv_timeout(Duration::from_millis(500));
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Default)]
pub struct Awake {
    state: Shared,
}

impl RustModule for Awake {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/awake/manifest.json")
    }

    fn start(&self, app: &AppHandle) {
        let (tx, rx) = channel();
        if WAKE.set(Mutex::new(tx)).is_err() {
            return; // déjà lancé
        }
        let (app, state) = (app.clone(), self.state.clone());
        std::thread::Builder::new().name("ondine-awake".into()).spawn(move || run(app, state, rx)).ok();
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        let settings = ctx.settings();
        let now = now_ms();
        let result = match command {
            "status" => {
                self.ask_agents_once(ctx);
                // Le front choisit ce qu'il propose (« fin du téléchargement ») : on regarde maintenant.
                let seen = downloads_seen();
                let mut st = self.state.locked();
                st.signals.downloading = st.downloads.step(seen) || seen;
                return Ok(json_of(&st, &settings));
            }
            "keep" => {
                self.ask_agents_once(ctx);
                let signals = self.signals_now();
                let keep = logic::parse_keep(&args, now, setting_bool(&settings, "display", false), signals)?;
                ctx.log_info(format!("rester éveillé : {:?}{}", keep.until, if keep.display { ", écran allumé" } else { "" }));
                self.state.locked().keep = Some(keep);
                Ok(())
            }
            "toggle" => {
                let mut st = self.state.locked();
                if st.keep.take().is_none() {
                    st.keep = Some(default_keep(&settings, now));
                }
                Ok(())
            }
            "stop" => {
                self.state.locked().keep = None;
                Ok(())
            }
            "plan" => {
                self.ask_agents_once(ctx);
                let signals = self.signals_now();
                let plan = logic::parse_plan(&args, now, signals)?;
                ctx.log_info(format!("arrêt programmé : {} ({:?})", plan.action.id(), plan.when));
                self.state.locked().plan = Some(plan);
                Ok(())
            }
            "cancel_plan" => {
                if self.state.locked().plan.take().is_some() {
                    ctx.log_info("arrêt programmé annulé");
                }
                Ok(())
            }
            "snooze_plan" => {
                let mut st = self.state.locked();
                let plan = st.plan.as_mut().ok_or("aucun arrêt programmé")?;
                logic::snooze(plan, now, logic::SNOOZE_MIN);
                Ok(())
            }
            other => Err(format!("commande inconnue : {other}")),
        };
        result?;
        let state = json_of(&self.state.locked(), &settings);
        ctx.emit("awake.state", state.clone());
        wake();
        Ok(state)
    }

    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        match msg.topic.as_str() {
            "agents.busy" => {
                let busy = msg.payload.get("working").and_then(Value::as_u64).unwrap_or(0) > 0;
                self.state.locked().signals.agent_busy = busy;
                wake();
            }
            // Le Lanceur, la mini-île (double-clic sur Ondine), une règle.
            "awake.toggle" => self.run_from_bus(ctx, "toggle", Value::Null),
            "awake.stop" => self.run_from_bus(ctx, "stop", Value::Null),
            // Une règle : `minutes` (0 ou absent = la durée d'un clic). Jamais d'arrêt.
            "awake.start" => {
                let minutes = msg.payload.get("minutes").and_then(Value::as_f64).unwrap_or(0.0);
                let args = if minutes > 0.0 {
                    json!({ "until": "minutes", "minutes": minutes })
                } else {
                    match default_keep(&ctx.settings(), 0).until {
                        Until::At(ms) => json!({ "until": "minutes", "minutes": ms / 60_000 }),
                        _ => json!({ "until": "forever" }),
                    }
                };
                self.run_from_bus(ctx, "keep", args);
            }
            _ => {}
        }
    }
}

impl Awake {
    fn run_from_bus(&self, ctx: &ModuleContext, command: &str, args: Value) {
        if let Err(e) = self.invoke(ctx, command, args) {
            ctx.log_warn(format!("rester éveillé ({command}) : {e}"));
            ctx.emit("awake.error", json!({ "message": e }));
        }
    }

    /// La première fois : demande à Agents IA si une session travaille (sa
    /// réponse `agents.busy` arrive tout de suite, par on_event : aucun verrou
    /// n'est tenu ici).
    fn ask_agents_once(&self, ctx: &ModuleContext) {
        let first = !std::mem::replace(&mut self.state.locked().asked_agents, true);
        if first {
            ctx.emit("agents.busy-ask", Value::Null);
        }
    }

    /// Ce qu'on sait maintenant (le dossier Téléchargements est relu).
    fn signals_now(&self) -> Signals {
        let seen = downloads_seen();
        let mut st = self.state.locked();
        st.signals.downloading = st.downloads.step(seen) || seen;
        st.signals
    }
}

fn setting_bool(settings: &serde_json::Map<String, Value>, key: &str, default: bool) -> bool {
    settings.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// Un clic (mini-île, Lanceur) : la durée réglée (`clickDuration`, en minutes ; 0 = sans limite).
fn default_keep(settings: &serde_json::Map<String, Value>, now: u64) -> Keep {
    let minutes = settings.get("clickDuration").and_then(Value::as_str).and_then(|s| s.parse::<u64>().ok()).unwrap_or(60).min(24 * 60);
    let until = if minutes == 0 { Until::Forever } else { Until::At(now + minutes * 60_000) };
    Keep { until, display: setting_bool(settings, "display", false), since: now }
}

fn json_of(st: &State, settings: &serde_json::Map<String, Value>) -> Value {
    logic::state_json(st.keep.as_ref(), st.plan.as_ref(), st.signals, setting_bool(settings, "coffee", true))
}

/// Un téléchargement en cours dans le dossier Téléchargements (un fichier
/// partiel modifié il y a moins de 5 min). Seulement les noms et les dates.
fn downloads_seen() -> bool {
    let Some(dir) = platform::downloads_dir() else { return false };
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    let now = SystemTime::now();
    entries.flatten().take(5000).any(|e| {
        let Ok(meta) = e.metadata() else { return false };
        let age = meta.modified().ok().and_then(|m| now.duration_since(m).ok()).map(|d| d.as_secs()).unwrap_or(0);
        meta.is_file() && logic::is_in_progress(&e.file_name().to_string_lossy(), age)
    })
}

/// Le fil du module (voir l'en-tête).
fn run(app: AppHandle, state: Shared, rx: Receiver<Wake>) {
    // Ce qui est demandé à Windows en ce moment (None : rien).
    let mut held: Option<bool> = None;
    let mut round: u32 = 0;
    loop {
        // Rien en cours : on dort jusqu'à la prochaine commande.
        let busy = {
            let st = state.locked();
            st.keep.is_some() || st.plan.is_some()
        };
        let got = if busy { rx.recv_timeout(TICK) } else { rx.recv().map_err(|_| RecvTimeoutError::Disconnected) };
        match got {
            Ok(Wake::Exit(done)) => {
                if held.is_some() {
                    let _ = platform::power::hold(None);
                    log::info("rester éveillé : relâché (Ondine se ferme)");
                }
                let _ = done.send(());
                return;
            }
            Err(RecvTimeoutError::Disconnected) => return,
            Ok(Wake::Now) | Err(RecvTimeoutError::Timeout) => {}
        }
        round = round.wrapping_add(1);
        let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tick(&app, &state, &mut held, round)));
        if step.is_err() {
            log::warn("rester éveillé : erreur inattendue, tout est relâché");
            let _ = platform::power::hold(None);
            held = None;
            let mut st = state.locked();
            st.keep = None;
            st.plan = None;
        }
    }
}

/// Un tour : vérifie le module, les fins d'éveil, l'arrêt programmé, puis
/// met à jour la demande faite à Windows.
fn tick(app: &AppHandle, state: &Shared, held: &mut Option<bool>, round: u32) {
    let active = super::is_active(app, ID);
    let now = now_ms();
    // Le dossier Téléchargements, seulement si on attend la fin d'un téléchargement.
    let watch_downloads = {
        let st = state.locked();
        matches!(st.keep.map(|k| k.until), Some(Until::Download)) || matches!(st.plan.map(|p| p.when), Some(When::Download))
    };
    let seen = if watch_downloads && round.is_multiple_of(DOWNLOAD_EVERY) { Some(downloads_seen()) } else { None };

    let mut changed = false;
    let mut fire: Option<Power> = None;
    let mut warn: Option<(Power, u64)> = None;
    let want = {
        let mut st = state.locked();
        if !active {
            // Module désactivé (ou mis à l'écart) : tout s'arrête, sans rien faire.
            changed = st.keep.take().is_some() | st.plan.take().is_some();
        } else {
            if let Some(seen) = seen {
                st.signals.downloading = st.downloads.step(seen);
            }
            let signals = st.signals;
            if st.keep.is_some_and(|k| logic::keep_over(&k, now, signals)) {
                st.keep = None;
                changed = true;
            }
            if let Some(plan) = st.plan.as_mut() {
                match logic::plan_step(plan, now, signals) {
                    Step::Nothing => {}
                    Step::Warn(at) => {
                        warn = Some((plan.action, at));
                        changed = true;
                    }
                    Step::Fire => {
                        fire = Some(plan.action);
                        st.plan = None;
                        // Éteindre, redémarrer, mettre en veille : l'éveil n'a plus de sens.
                        if fire != Some(Power::Lock) {
                            st.keep = None;
                        }
                        changed = true;
                    }
                }
            }
        }
        logic::wanted(st.keep.as_ref())
    };

    if want != *held {
        match platform::power::hold(want) {
            Ok(()) => {
                log::info(match want {
                    None => "rester éveillé : relâché".to_string(),
                    Some(display) => format!("rester éveillé : demandé à Windows{}", if display { " (écran allumé)" } else { "" }),
                });
                *held = want;
            }
            Err(e) => log::warn(format!("rester éveillé : {e}")),
        }
    }
    if let Some((action, at)) = warn {
        bus::emit(app, ID, "awake.warn", json!({ "action": action.id(), "at": at }));
    }
    if changed {
        let settings = super::with_context(app, ID, |ctx| ctx.settings()).unwrap_or_default();
        bus::emit(app, ID, "awake.state", json_of(&state.locked(), &settings));
    }
    if let Some(action) = fire {
        log::info(format!("arrêt programmé : {}", action.id()));
        if let Err(e) = platform::power::act(action.id()) {
            log::warn(format!("arrêt programmé : {e}"));
            bus::emit(app, ID, "awake.error", json!({ "message": e }));
        }
    }
}
