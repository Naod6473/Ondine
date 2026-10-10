// Les déclencheurs qu'on « sent » en regardant de temps en temps (appelé par
// le thread de surveillance, watch.rs, à chaque tour : 1 à 5 s selon le mode
// de performance) :
//   - l'heure (déclencheur horaire, une fois par jour et par règle) ;
//   - le réseau : Internet coupé ou revenu, VPN branché ou coupé (toutes les
//     10 s, deux lectures de suite pour éviter les faux départs). Rien n'est
//     envoyé : on demande à Windows (platform::netwatch, comme le module Réseau) ;
//   - la batterie (passe sous un seuil) et le secteur (branché / débranché) ;
//   - la session déverrouillée (on revient devant le PC) ;
//   - le presse-papiers (numéro de copie de Windows ; le texte n'est lu que si
//     une règle « presse-papiers » existe, et jamais une copie marquée
//     « sensible » par un gestionnaire de mots de passe).
//
// Chaque capteur ne travaille que si une règle active l'utilise.
// Point d'extension : « un nouvel appareil sur le réseau » se branchera ici
// quand le scanner du module Réseau existera (il publiera un événement, comme
// nettools.internet ; il suffira d'un NetChange de plus).

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use super::model::{self, NetChange, Rule, Subject, Trigger};
use super::{Shared, ID};
use crate::platform;

/// Réseau et batterie : un coup d'œil toutes les 10 s suffit.
const SLOW_EVERY: Duration = Duration::from_secs(10);
/// Au plus ce nombre de fichiers par passage d'une règle horaire sur un dossier.
const MAX_SWEEP: usize = 500;

#[derive(Default)]
pub struct Senses {
    last_slow: Option<Instant>,
    internet: Option<bool>,
    internet_pending: Option<bool>,
    vpns: Option<BTreeSet<String>>,
    plugged: Option<bool>,
    percent: Option<u8>,
    locked: Option<bool>,
    clip_seq: Option<u32>,
    /// Règle horaire → le jour où elle est partie ("2026-10-10").
    done_on: HashMap<u64, String>,
}

impl Senses {
    /// Module désactivé ou en pause : on oublie tout (au retour, la première
    /// lecture sert de point de départ, sans rien déclencher).
    pub fn reset(&mut self) {
        let done_on = std::mem::take(&mut self.done_on);
        *self = Senses { done_on, ..Default::default() };
    }
}

pub fn tick(app: &AppHandle, state: &Shared, senses: &mut Senses) {
    let rules = super::active_rules(state);
    if rules.is_empty() {
        senses.reset();
        return;
    }
    let has = |f: fn(&Trigger) -> bool| rules.iter().any(|r| f(&r.trigger));
    let now = super::Now::local();

    // ── L'heure ──
    for r in &rules {
        if let Trigger::Schedule { time, days, folder } = &r.trigger {
            let done = senses.done_on.get(&r.id).is_some_and(|d| *d == now.date);
            if model::schedule_due(time, days, now.weekday, now.minutes, done) {
                senses.done_on.insert(r.id, now.date.clone());
                if folder.trim().is_empty() {
                    fire(app, state, r, None, "");
                } else {
                    sweep(app, state, r, folder);
                }
            }
        }
    }

    // ── La session déverrouillée ──
    if has(|t| matches!(t, Trigger::Unlock)) {
        if let Some(locked) = platform::session::locked() {
            let was = senses.locked.replace(locked);
            if was == Some(true) && !locked {
                fire_all(app, state, &rules, |t| matches!(t, Trigger::Unlock), "");
            }
        }
    } else {
        senses.locked = None;
    }

    // ── Le presse-papiers ──
    if has(|t| matches!(t, Trigger::Clipboard { .. })) {
        let seq = platform::clipboard_sequence();
        let before = senses.clip_seq.replace(seq);
        if before.is_some_and(|b| b != seq) && !platform::clipboard_is_sensitive() {
            if let Some(text) = read_clipboard() {
                for r in &rules {
                    if let Trigger::Clipboard { kind, text: needle } = &r.trigger {
                        if let Some(found) = model::clip_match(*kind, needle, &text) {
                            fire(app, state, r, None, &found);
                        }
                    }
                }
            }
        }
    } else {
        senses.clip_seq = None;
    }

    // ── Réseau, batterie, secteur (plus rarement) ──
    if senses.last_slow.is_some_and(|t| t.elapsed() < SLOW_EVERY) {
        return;
    }
    senses.last_slow = Some(Instant::now());

    if has(|t| matches!(t, Trigger::Network { change: NetChange::InternetDown | NetChange::InternetUp })) {
        if let Some(up) = platform::netwatch::internet() {
            if senses.internet.is_none() {
                senses.internet = Some(up);
            } else if senses.internet != Some(up) {
                // Deux lectures de suite avant d'y croire (un Wi-Fi qui hésite).
                if senses.internet_pending == Some(up) {
                    senses.internet = Some(up);
                    senses.internet_pending = None;
                    let change = if up { NetChange::InternetUp } else { NetChange::InternetDown };
                    let label = if up { "Internet revenu" } else { "Internet coupé" };
                    fire_all(app, state, &rules, |t| *t == Trigger::Network { change }, label);
                } else {
                    senses.internet_pending = Some(up);
                }
            } else {
                senses.internet_pending = None;
            }
        }
    } else {
        senses.internet = None;
        senses.internet_pending = None;
    }

    if has(|t| matches!(t, Trigger::Network { change: NetChange::VpnUp | NetChange::VpnDown })) {
        let now_vpns: BTreeSet<String> = platform::netwatch::vpns_up().into_iter().collect();
        if let Some(before) = senses.vpns.replace(now_vpns.clone()) {
            for name in now_vpns.difference(&before) {
                fire_all(app, state, &rules, |t| *t == Trigger::Network { change: NetChange::VpnUp }, name);
            }
            for name in before.difference(&now_vpns) {
                fire_all(app, state, &rules, |t| *t == Trigger::Network { change: NetChange::VpnDown }, name);
            }
        }
    } else {
        senses.vpns = None;
    }

    if has(|t| matches!(t, Trigger::Battery { .. } | Trigger::Power { .. })) {
        if let Some(b) = platform::battery() {
            if let Some(was) = senses.plugged.replace(b.plugged) {
                if was != b.plugged {
                    let label = if b.plugged { "secteur branché" } else { "secteur débranché" };
                    fire_all(app, state, &rules, |t| *t == Trigger::Power { plugged: b.plugged }, label);
                }
            }
            if let Some(pct) = b.percent {
                if let Some(was) = senses.percent.replace(pct) {
                    for r in &rules {
                        // Passe sous le seuil (en se déchargeant).
                        if let Trigger::Battery { below } = r.trigger {
                            if was >= below && pct < below && !b.plugged {
                                fire(app, state, r, None, &format!("{pct} %"));
                            }
                        }
                    }
                }
            }
        }
    } else {
        senses.plugged = None;
        senses.percent = None;
    }
}

fn fire_all(app: &AppHandle, state: &Shared, rules: &[Rule], wanted: impl Fn(&Trigger) -> bool, label: &str) {
    for r in rules.iter().filter(|r| wanted(&r.trigger)) {
        fire(app, state, r, None, label);
    }
}

fn fire(app: &AppHandle, state: &Shared, rule: &Rule, subject: Option<PathBuf>, label: &str) {
    crate::modules::with_context(app, ID, |ctx| super::fire(ctx, state, rule, subject, label));
}

/// Règle horaire sur un dossier : chaque fichier (pas les sous-dossiers) qui
/// remplit les conditions, en un seul passage (un seul « Annuler » pour tout).
fn sweep(app: &AppHandle, state: &Shared, rule: &Rule, folder: &str) {
    crate::modules::with_context(app, ID, |ctx| {
        let Ok(dir) = ctx.check_path(folder) else {
            super::set_error(state, rule.id, Some("dossier exclu ou introuvable".into()));
            return;
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            super::set_error(state, rule.id, Some(format!("dossier introuvable ou inaccessible : {}", dir.display())));
            return;
        };
        let now = std::time::SystemTime::now();
        let mut found = Vec::new();
        for e in entries.flatten() {
            let path = e.path();
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || model::is_temporary(&path) {
                continue;
            }
            let name = super::file_name(&path);
            let ext = path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            let age = meta.modified().ok().and_then(|m| now.duration_since(m).ok()).map(|d| d.as_secs() / 86_400);
            if !model::matches(&rule.conditions, &Subject { name: &name, ext: &ext, size: Some(meta.len()), age_days: age }) {
                continue;
            }
            // Un sous-élément exclu dans Confidentialité : on n'y touche pas.
            if let Ok(p) = ctx.check_path(&path.display().to_string()) {
                found.push(p);
            }
            if found.len() >= MAX_SWEEP {
                break;
            }
        }
        super::set_error(state, rule.id, None);
        super::fire_batch(ctx, state, rule, found);
    });
}

fn read_clipboard() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    clipboard.get_text().ok()
}
