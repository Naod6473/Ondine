// « Parler à Ondine » : les commandes rapides, comprises ici, sans IA ni clé
// (instantané, gratuit, rien ne part sur Internet). Écrites ou dites :
//
//   « minuteur 10 minutes », « timer 5 min », « set a timer for 1 hour »
//   « volume 30 », « mets le volume à 30 % », « coupe le son », « unmute »
//   « luminosité 50 », « brightness 70 »
//   « musique suivante », « morceau précédent », « pause », « next song »
//   « note : acheter du pain », « take a note: call Paul »
//   « mode sombre », « light mode »
//
// Une commande devient un appel d'outil du PC (`Call`), fait par
// askclaude_pc.rs (`plan`) comme si Ondine l'avait demandé : mêmes
// vérifications, mêmes actions, rien n'est dupliqué. Une question (« ? »)
// n'est jamais une commande ; ce qui ne ressemble pas exactement à une
// commande part à l'IA comme d'habitude.

use serde_json::json;

use super::askclaude_providers::Call;
use crate::services::search;

/// Une note dictée fait au plus ça.
const MAX_NOTE: usize = 2000;

fn call(name: &str, args: serde_json::Value) -> Call {
    Call { id: "rapide".into(), name: name.into(), args }
}

/// Un nombre écrit en chiffres ou en lettres (les plus courants, FR et EN).
fn number(word: &str) -> Option<u64> {
    if let Ok(n) = word.parse::<u64>() {
        return Some(n);
    }
    const WORDS: &[(&str, u64)] = &[
        ("un", 1), ("une", 1), ("deux", 2), ("trois", 3), ("quatre", 4), ("cinq", 5), ("six", 6), ("sept", 7), ("huit", 8), ("neuf", 9), ("dix", 10),
        ("quinze", 15), ("vingt", 20), ("trente", 30), ("quarante", 40), ("cinquante", 50), ("soixante", 60), ("cent", 100),
        ("one", 1), ("a", 1), ("an", 1), ("two", 2), ("three", 3), ("four", 4), ("five", 5), ("six", 6), ("seven", 7), ("eight", 8), ("nine", 9), ("ten", 10),
        ("fifteen", 15), ("twenty", 20), ("thirty", 30), ("forty", 40), ("fifty", 50), ("sixty", 60), ("hundred", 100),
    ];
    WORDS.iter().find(|(w, _)| *w == word).map(|(_, n)| *n)
}

/// Les mots de la phrase (normalisée : minuscules, sans accents), sans les
/// petits mots qui ne changent rien au sens.
fn words(norm: &str) -> Vec<String> {
    const FILLER: &[&str] = &[
        "ondine", "s'il", "te", "plait", "stp", "svp", "vous", "please", "mets", "met", "mettre", "regle", "regler", "lance", "lancer", "demarre", "le", "la", "l", "les", "un",
        "de", "du", "a", "au", "sur", "pour", "set", "the", "to", "for", "start", "put", "turn", "my", "percent", "pourcent", "pour-cent", "%", "et", "and", "moi", "me",
    ];
    norm.split(|c: char| c.is_whitespace() || c == '\'' || c == ',' || c == '.' || c == '!')
        .filter(|w| !w.is_empty())
        .map(|w| w.trim_end_matches('%').to_string())
        .filter(|w| !w.is_empty() && !FILLER.contains(&w.as_str()))
        .collect()
}

/// Le premier nombre (0 à 100) de la phrase.
fn level(ws: &[String]) -> Option<u64> {
    ws.iter().filter_map(|w| number(w)).find(|n| *n <= 100)
}

/// La durée d'un minuteur, en minutes (« 10 minutes », « 1 heure », « 90 s » arrondi).
fn duration(ws: &[String]) -> Option<u64> {
    let mut total = 0u64;
    let mut found = false;
    for (i, w) in ws.iter().enumerate() {
        let Some(n) = number(w) else { continue };
        let unit = ws.get(i + 1).map(String::as_str).unwrap_or("min");
        let minutes = match unit {
            "h" | "heure" | "heures" | "hour" | "hours" | "hr" => n * 60,
            "s" | "sec" | "seconde" | "secondes" | "second" | "seconds" => n.div_ceil(60),
            _ => n,
        };
        total += minutes;
        found = true;
    }
    (found && (1..=180).contains(&total)).then_some(total)
}

/// Comprend une commande rapide, ou None (le message part alors à l'IA).
pub fn parse(text: &str) -> Option<Call> {
    let raw = text.trim();
    if raw.is_empty() || raw.ends_with('?') || raw.chars().count() > MAX_NOTE + 40 {
        return None;
    }
    // La note garde le texte tel quel (majuscules, accents).
    if let Some(note) = note_text(raw) {
        return Some(call("creer_note", json!({ "texte": note })));
    }
    let norm = search::normalize(raw);
    let ws = words(&norm);
    let has = |w: &str| ws.iter().any(|x| x == w);
    let only = |allowed: &[&str]| ws.iter().all(|x| allowed.contains(&x.as_str()) || number(x).is_some());
    // Une commande est courte : au-delà, c'est une vraie question pour l'IA.
    if ws.is_empty() || ws.len() > 6 {
        return None;
    }

    // ── Minuteur ──
    const TIMER: &[&str] = &["minuteur", "timer", "compte", "rebours", "minute", "minutes", "min", "mn", "m", "heure", "heures", "h", "hour", "hours", "s", "sec", "seconde", "secondes", "second", "seconds", "nouveau", "new"];
    if (has("minuteur") || has("timer") || (has("compte") && has("rebours"))) && only(TIMER) {
        return duration(&ws).map(|m| call("lancer_minuteur", json!({ "minutes": m })));
    }
    // ── Volume et son ──
    const VOLUME: &[&str] = &["volume", "son", "sound"];
    if (has("volume") || has("son")) && only(VOLUME) {
        return level(&ws).map(|n| call("regler_volume", json!({ "niveau": n })));
    }
    if only(&["coupe", "couper", "son", "mute", "silence", "sourdine"]) && (has("coupe") || has("couper") || has("mute") || has("sourdine")) {
        return Some(call("couper_son", json!({ "coupe": true })));
    }
    if only(&["remets", "remettre", "retablis", "retablir", "son", "unmute", "sound", "back", "on"]) && (has("remets") || has("retablis") || has("unmute") || has("remettre") || has("retablir")) {
        return Some(call("couper_son", json!({ "coupe": false })));
    }
    // ── Luminosité ──
    if (has("luminosite") || has("brightness")) && only(&["luminosite", "brightness", "ecran", "screen"]) {
        return level(&ws).map(|n| call("regler_luminosite", json!({ "niveau": n })));
    }
    // ── Musique ──
    const MUSIC: &[&str] = &["musique", "morceau", "chanson", "titre", "piste", "music", "song", "track", "suivant", "suivante", "precedent", "precedente", "next", "previous", "skip", "pause", "lecture", "play", "reprends", "reprendre", "resume", "joue"];
    if only(MUSIC) {
        let music = has("musique") || has("morceau") || has("chanson") || has("titre") || has("piste") || has("music") || has("song") || has("track");
        if has("suivant") || has("suivante") || has("next") || has("skip") {
            if music || ws.len() == 1 {
                return Some(call("controler_musique", json!({ "action": "suivant" })));
            }
        } else if has("precedent") || has("precedente") || has("previous") {
            if music || ws.len() == 1 {
                return Some(call("controler_musique", json!({ "action": "precedent" })));
            }
        } else if has("pause") || has("lecture") || has("play") || has("reprends") || has("reprendre") || has("resume") || (has("joue") && music) {
            return Some(call("controler_musique", json!({ "action": "lecture_pause" })));
        }
        return None;
    }
    // ── Mode sombre ou clair ──
    if only(&["mode", "sombre", "clair", "dark", "light", "active", "activer", "passe", "passer", "en", "theme"]) && (has("mode") || has("theme")) {
        if has("sombre") || has("dark") {
            return Some(call("mode_sombre", json!({ "actif": true })));
        }
        if has("clair") || has("light") {
            return Some(call("mode_sombre", json!({ "actif": false })));
        }
    }
    None
}

/// « note : acheter du pain », « nouvelle note, appeler Paul », « take a
/// note: … » → le texte de la note (tel qu'il a été écrit ou dit).
fn note_text(raw: &str) -> Option<String> {
    const STARTS: &[&str] = &["prends note", "prenez note", "nouvelle note", "ajoute une note", "ajoutez une note", "crée une note", "créer une note", "take a note", "new note", "add a note", "note"];
    let lower = raw.to_lowercase();
    let start = STARTS.iter().find(|s| lower.starts_with(*s))?;
    let rest = &raw[start.len()..];
    // « note » doit être suivi d'un signe (« : », « , », « - ») ou de « que » / « that ».
    let rest_trim = rest.trim_start();
    let body = if let Some(r) = rest_trim.strip_prefix([':', ',', '-', '—']) {
        r
    } else {
        let low = rest_trim.to_lowercase();
        let after = ["que ", "qu'", "that "].iter().find(|w| low.starts_with(*w))?;
        &rest_trim[after.len()..]
    };
    let body = body.trim();
    (!body.is_empty() && body.chars().count() <= MAX_NOTE).then(|| body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(text: &str) -> Option<(String, serde_json::Value)> {
        parse(text).map(|c| (c.name, c.args))
    }

    #[test]
    fn timers() {
        assert_eq!(name("minuteur 10 minutes"), Some(("lancer_minuteur".into(), json!({ "minutes": 10 }))));
        assert_eq!(name("Lance un minuteur de 25 min"), Some(("lancer_minuteur".into(), json!({ "minutes": 25 }))));
        assert_eq!(name("Minuteur dix minutes."), Some(("lancer_minuteur".into(), json!({ "minutes": 10 }))));
        assert_eq!(name("set a timer for 1 hour"), Some(("lancer_minuteur".into(), json!({ "minutes": 60 }))));
        assert_eq!(name("timer 5"), Some(("lancer_minuteur".into(), json!({ "minutes": 5 }))));
        assert_eq!(name("minuteur 500 minutes"), None);
    }

    #[test]
    fn volume_and_brightness() {
        assert_eq!(name("volume 30"), Some(("regler_volume".into(), json!({ "niveau": 30 }))));
        assert_eq!(name("Mets le volume à 30 %"), Some(("regler_volume".into(), json!({ "niveau": 30 }))));
        assert_eq!(name("set volume to 45 percent"), Some(("regler_volume".into(), json!({ "niveau": 45 }))));
        assert_eq!(name("luminosité 50"), Some(("regler_luminosite".into(), json!({ "niveau": 50 }))));
        assert_eq!(name("brightness 70"), Some(("regler_luminosite".into(), json!({ "niveau": 70 }))));
        assert_eq!(name("coupe le son"), Some(("couper_son".into(), json!({ "coupe": true }))));
        assert_eq!(name("unmute"), Some(("couper_son".into(), json!({ "coupe": false }))));
        assert_eq!(name("volume 300"), None);
    }

    #[test]
    fn music_and_theme() {
        assert_eq!(name("musique suivante").map(|c| c.1), Some(json!({ "action": "suivant" })));
        assert_eq!(name("Morceau précédent").map(|c| c.1), Some(json!({ "action": "precedent" })));
        assert_eq!(name("pause").map(|c| c.1), Some(json!({ "action": "lecture_pause" })));
        assert_eq!(name("next song").map(|c| c.1), Some(json!({ "action": "suivant" })));
        assert_eq!(name("mode sombre"), Some(("mode_sombre".into(), json!({ "actif": true }))));
        assert_eq!(name("light mode"), Some(("mode_sombre".into(), json!({ "actif": false }))));
    }

    #[test]
    fn notes_keep_their_text() {
        assert_eq!(name("note : Acheter du pain"), Some(("creer_note".into(), json!({ "texte": "Acheter du pain" }))));
        assert_eq!(name("Nouvelle note, appeler Paul à 15 h"), Some(("creer_note".into(), json!({ "texte": "appeler Paul à 15 h" }))));
        assert_eq!(name("take a note: call the bank"), Some(("creer_note".into(), json!({ "texte": "call the bank" }))));
        assert_eq!(name("note que le serveur redémarre"), Some(("creer_note".into(), json!({ "texte": "le serveur redémarre" }))));
        // « notes » ou « note de frais » ne sont pas des commandes.
        assert_eq!(name("notes de la réunion d'hier"), None);
        assert_eq!(name("note"), None);
    }

    #[test]
    fn questions_and_sentences_go_to_the_ai() {
        assert_eq!(name("Pourquoi le volume est à 30 ?"), None);
        assert_eq!(name("Peux-tu m'expliquer comment régler le volume de mon casque bluetooth"), None);
        assert_eq!(name("Bonjour Ondine"), None);
        assert_eq!(name("suivant"), Some(("controler_musique".into(), json!({ "action": "suivant" }))));
        assert_eq!(name("le mode avion"), None);
        assert_eq!(name(""), None);
    }
}
