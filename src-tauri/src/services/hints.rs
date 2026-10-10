// Les « bons moments » pour proposer un onglet (src/core/suggestions.ts) : la
// première clé USB branchée, la première visio. Le module Contrôles le sait
// déjà, mais justement : quand on le propose, il est éteint.
//
// Un fil regarde, toutes les ~6 s (plus lentement en économie d'énergie) :
//   - les lecteurs amovibles (un nouveau depuis le démarrage → "usb") ;
//   - le micro ou la caméra utilisés par une appli (registre de Windows, voir
//     platform/media_use.rs → "visio").
// Il ne regarde que si l'assistant est passé, que les propositions sont
// permises (island.suggestions), que Contrôles est éteint et que ce cas n'a
// pas déjà été proposé (island.suggested). Il prévient l'île par l'événement
// « island-hint » {kind}, une fois par cas et par démarrage ; l'île décide.
// Rien n'est enregistré ni envoyé, et les noms d'applis restent ici.

use std::collections::BTreeSet;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;
use crate::platform;
use crate::services::log;
use crate::services::perf::{self, Loop};
use crate::sync::LockExt;

/// Les cas que ce fil sait voir.
const KINDS: [&str; 2] = ["usb", "visio"];

/// Un lecteur amovible qui n'était pas là au premier regard ?
pub fn new_removable(baseline: &BTreeSet<String>, now: &[(String, bool)]) -> bool {
    now.iter().any(|(root, removable)| *removable && !baseline.contains(root))
}

/// Une visio : la caméra, ou le micro pris par une autre appli qu'Ondine (sa dictée).
pub fn looks_like_call(mic: &[String], cam: &[String]) -> bool {
    !cam.is_empty() || mic.iter().any(|m| !m.to_lowercase().contains("ondine"))
}

pub fn spawn_watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut baseline: Option<BTreeSet<String>> = None;
        let mut sent: BTreeSet<&'static str> = BTreeSet::new();
        loop {
            let step = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tick(&app, &mut baseline, &mut sent)));
            if step.is_err() {
                log::warn("propositions : erreur dans la surveillance des bons moments");
            }
            std::thread::sleep(perf::every(Loop::RulesDrives) * 3);
        }
    });
}

fn tick(app: &AppHandle, baseline: &mut Option<BTreeSet<String>>, sent: &mut BTreeSet<&'static str>) {
    let (wanted, controls_on) = {
        let s = app.state::<crate::Shared>().settings.locked().clone();
        let wanted: Vec<&'static str> = KINDS.iter().copied().filter(|k| !s.island.suggested.iter().any(|x| x == k) && !sent.contains(k)).collect();
        (if s.general.welcomed && s.island.suggestions && !s.general.demo { wanted } else { Vec::new() }, s.module_enabled("controls"))
    };
    if wanted.is_empty() || controls_on {
        *baseline = None; // au retour, on repart des lecteurs présents à ce moment-là
        return;
    }
    if wanted.contains(&"usb") {
        let drives: Vec<(String, bool)> = platform::drives(&[]).into_iter().map(|d| (d.root, d.removable)).collect();
        match baseline {
            None => *baseline = Some(drives.iter().filter(|(_, r)| *r).map(|(root, _)| root.clone()).collect()),
            Some(base) if new_removable(base, &drives) => fire(app, sent, "usb"),
            Some(_) => {}
        }
    }
    if wanted.contains(&"visio") {
        let use_now = platform::media_use::current();
        if looks_like_call(&use_now.mic, &use_now.cam) {
            fire(app, sent, "visio");
        }
    }
}

fn fire(app: &AppHandle, sent: &mut BTreeSet<&'static str>, kind: &'static str) {
    sent.insert(kind);
    log::info(format!("propositions : bon moment « {kind} »"));
    let _ = app.emit_to(WINDOW_LABEL, "island-hint", json!({ "kind": kind }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_removable_drive_is_seen() {
        let base: BTreeSet<String> = ["E:\\".to_string()].into();
        assert!(!new_removable(&base, &[("C:\\".into(), false), ("E:\\".into(), true)]));
        assert!(new_removable(&base, &[("E:\\".into(), true), ("F:\\".into(), true)]));
        // Un disque fixe qui apparaît (disque USB vu comme fixe) ne compte pas.
        assert!(!new_removable(&base, &[("G:\\".into(), false)]));
    }

    #[test]
    fn a_call_is_the_camera_or_someone_else_on_the_mic() {
        assert!(!looks_like_call(&[], &[]));
        assert!(!looks_like_call(&["Ondine".into()], &[]));
        assert!(looks_like_call(&["Zoom".into()], &[]));
        assert!(looks_like_call(&[], &["WindowsCamera".into()]));
    }
}
