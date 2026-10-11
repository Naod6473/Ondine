//! Fusion des seuls champs modifiés, sous le verrou des réglages.
use super::settings::Settings;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Patch {
    pub path: Vec<String>,
    pub op: Operation,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Set,
    Remove,
}

pub fn apply(current: &Settings, patches: &[Patch]) -> Result<Settings, String> {
    if patches.len() > 256 {
        return Err("trop de changements de réglages".into());
    }
    let mut value = serde_json::to_value(current).map_err(|e| e.to_string())?;
    let mut total = 0usize;
    for patch in patches {
        if patch.path.is_empty()
            || patch.path.len() > 16
            || ![
                "general", "island", "mascot", "privacy", "modules", "profiles",
            ]
            .contains(&patch.path[0].as_str())
            || patch.path.iter().any(|k| {
                k.is_empty()
                    || k.len() > 200
                    || ["__proto__", "prototype", "constructor"].contains(&k.as_str())
            })
        {
            return Err("champ de réglages refusé".into());
        }
        total = total.saturating_add(patch.value.to_string().len());
        if total > 1_000_000 {
            return Err("réglages trop volumineux".into());
        }
        let mut target = &mut value;
        for key in &patch.path[..patch.path.len() - 1] {
            let object = target
                .as_object_mut()
                .ok_or("chemin de réglages invalide")?;
            target = object
                .entry(key)
                .or_insert_with(|| Value::Object(Default::default()));
        }
        let object = target
            .as_object_mut()
            .ok_or("chemin de réglages invalide")?;
        let key = patch.path.last().ok_or("champ de réglages manquant")?;
        match patch.op {
            Operation::Set => {
                object.insert(key.clone(), patch.value.clone());
            }
            Operation::Remove => {
                object.remove(key);
            }
        }
    }
    let mut next: Settings =
        serde_json::from_value(value).map_err(|e| format!("réglages invalides : {e}"))?;
    next.sanitize();
    Ok(next)
}

/// La bulle ne peut ni élargir ses onglets autorisés ni changer les réglages
/// globaux. Elle sauvegarde seulement les valeurs des onglets déjà choisis.
pub fn apply_pet(current: &Settings, patches: &[Patch]) -> Result<Settings, String> {
    if patches.iter().any(|p| {
        p.path.first().map(String::as_str) != Some("modules")
            || p.path
                .get(1)
                .is_none_or(|id| !current.mascot.pet_tabs.contains(id))
    }) {
        return Err("réglage refusé depuis la mascotte".into());
    }
    let next = apply(current, patches)?;
    for patch in patches {
        let id = &patch.path[1];
        let before = current
            .modules
            .get(id)
            .map(|m| m.enabled)
            .unwrap_or(id != "team");
        let after = next
            .modules
            .get(id)
            .map(|m| m.enabled)
            .unwrap_or(id != "team");
        if before != after {
            return Err("activation refusée depuis la mascotte".into());
        }
    }
    Ok(next)
}

/// La mémoire ne change qu'après une écriture réussie. Aussi utilisé par le
/// déplacement de l'île et de la mascotte, qui sont des sauvegardes à part entière.
pub fn commit(
    current: &mut Settings,
    mut next: Settings,
    save: impl FnOnce(&Settings) -> Result<(), String>,
) -> Result<(), String> {
    next.revision = current.revision.saturating_add(1);
    save(&next)?;
    *current = next;
    Ok(())
}

/// Les effets Windows suivent uniquement les réglages qui les concernent.
/// Un glisser sur une couleur ne réinscrit pas le démarrage ni les raccourcis.
pub struct Effects {
    pub autostart: bool,
    pub log: bool,
    pub hotkey: bool,
    pub geometry: bool,
    pub pet: bool,
    pub perf: bool,
    pub dodge: bool,
}
impl Effects {
    pub fn between(before: &Settings, after: &Settings) -> Self {
        let geometry = before.general.screen != after.general.screen
            || before.island.edge != after.island.edge
            || before.island.align != after.island.align
            || before.island.offset != after.island.offset;
        Self {
            autostart: before.general.autostart != after.general.autostart,
            log: before.general.log_level != after.general.log_level,
            hotkey: before.island.hotkey != after.island.hotkey,
            geometry,
            pet: before.mascot.enabled != after.mascot.enabled
                || before.mascot.pet != after.mascot.pet
                || before.mascot.pet_on_top != after.mascot.pet_on_top
                || before.mascot.pet_hotkey != after.mascot.pet_hotkey,
            perf: before.general.perf_mode != after.general.perf_mode
                || before.general.eco_on_battery != after.general.eco_on_battery,
            dodge: geometry
                || before.island.avoid_settings != after.island.avoid_settings
                || before.mascot.calm != after.mascot.calm,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn patch(path: &[&str], value: Value) -> Patch {
        Patch {
            path: path.iter().map(|k| k.to_string()).collect(),
            op: Operation::Set,
            value,
        }
    }
    #[test]
    fn windows_merge_their_fields_without_losing_other_changes() {
        let mut settings = Settings::default();
        let a = apply(
            &settings,
            &[patch(&["general", "language"], Value::from("en"))],
        )
        .unwrap();
        commit(&mut settings, a, |_| Ok(())).unwrap();
        let b = apply(
            &settings,
            &[patch(&["island", "theme"], Value::from("custom"))],
        )
        .unwrap();
        commit(&mut settings, b, |_| Ok(())).unwrap();
        assert_eq!(settings.general.language, "en");
        assert_eq!(settings.island.theme, "custom");
        assert_eq!(settings.revision, 2);
    }
    #[test]
    fn failure_keeps_memory_and_revision_unchanged() {
        let mut settings = Settings::default();
        let before = serde_json::to_value(&settings).unwrap();
        let next = apply(
            &settings,
            &[patch(&["general", "language"], Value::from("en"))],
        )
        .unwrap();
        assert!(commit(&mut settings, next, |_| Err("disque plein".into())).is_err());
        assert_eq!(serde_json::to_value(settings).unwrap(), before);
    }
    #[test]
    fn protected_paths_and_invalid_types_are_rejected() {
        for path in [
            vec![],
            vec!["revision"],
            vec!["modules", "__proto__"],
            vec!["version"],
        ] {
            assert!(apply(&Settings::default(), &[patch(&path, Value::from(1))]).is_err());
        }
        assert!(apply(
            &Settings::default(),
            &[patch(&["general", "language"], Value::from(1))]
        )
        .is_err());
    }
    #[test]
    fn visual_changes_do_not_repeat_unrelated_windows_effects() {
        let before = Settings::default();
        let mut after = before.clone();
        after.island.theme = "custom".into();
        let effects = Effects::between(&before, &after);
        assert!(
            !effects.autostart
                && !effects.log
                && !effects.hotkey
                && !effects.geometry
                && !effects.pet
                && !effects.perf
                && !effects.dodge
        );
        after.general.perf_mode = "eco".into();
        assert!(Effects::between(&before, &after).perf);
        after.island.offset += 1.0;
        let effects = Effects::between(&before, &after);
        assert!(effects.geometry && effects.dodge);
    }
    #[test]
    fn pet_cannot_expand_its_policy_or_touch_other_modules() {
        let current = Settings::default();
        for path in [
            vec!["mascot", "petTabs"],
            vec!["privacy"],
            vec!["modules"],
            vec!["modules", "terminal"],
        ] {
            assert!(apply_pet(&current, &[patch(&path, Value::from(true))]).is_err());
        }
        assert!(apply_pet(
            &current,
            &[patch(
                &["modules", "askclaude"],
                serde_json::json!({ "enabled": true, "values": { "voiceEngine": "api" } })
            )]
        )
        .is_ok());
        assert!(apply_pet(
            &current,
            &[patch(
                &["modules", "askclaude", "enabled"],
                Value::from(false)
            )]
        )
        .is_err());
    }
}
