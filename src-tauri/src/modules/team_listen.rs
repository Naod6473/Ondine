// Module « Équipe » : « Alex écoute… » (1.2.3).
//
// Réglage « Partager ce que j'écoute » (`shareListening`, ÉTEINT par défaut) :
// le titre et l'artiste du morceau en cours (ce que montre déjà le module
// Musique, lu dans le panneau multimédia de Windows) partent chez les
// collègues en ligne, chiffrés comme le reste. Rien d'autre : ni la pochette,
// ni la position, ni l'historique. Pause, arrêt ou réglage éteint : un
// message « plus rien » (titre vide) efface la ligne chez eux.
//
// Compatibilité : le message `listening` n'existe pas avant la 1.2.3. Une
// Ondine qui le comprend l'annonce dans sa présence (`Hello::features`) ; on
// ne l'envoie qu'à celles-là. Une version plus ancienne ne reçoit donc jamais
// un message qu'elle ne saurait pas lire, et notre présence (avec ce champ en
// plus) reste lisible chez elle.
//
// Chez le collègue, un clic sur « Alex écoute… » ouvre une RECHERCHE du même
// morceau (titre + artiste) dans le navigateur : sur le même service si on le
// reconnaît (Spotify, Deezer, Apple Music, Tidal), sinon sur YouTube Music, ou
// toujours sur le service choisi (réglage `listenOpen`). Aucun compte, aucune
// clé : une simple page de recherche publique. L'adresse est fabriquée ici, à
// partir de ce que le collègue a envoyé (vérifié par `Msg::check`) : le front
// ne peut pas faire ouvrir n'importe quelle adresse.

use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use super::team::{self, Inner, Peer};
use super::team_net;
use super::team_proto::{check_text, Msg, FEATURE_LISTENING, MAX_TRACK};

/// Un morceau : ce qui part chez les collègues.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub(super) struct Track {
    pub title: String,
    pub artist: String,
    /// Le service reconnu (`service_of`), vide si inconnu.
    pub app: String,
}

impl Track {
    pub fn to_msg(t: Option<&Track>) -> Msg {
        match t {
            Some(t) => Msg::Listening { title: t.title.clone(), artist: t.artist.clone(), app: t.app.clone() },
            None => Msg::Listening { title: String::new(), artist: String::new(), app: String::new() },
        }
    }

    /// Le message reçu → le morceau (None : plus rien ne joue).
    pub fn from_msg(title: String, artist: String, app: String) -> Option<Track> {
        if title.trim().is_empty() {
            return None;
        }
        Some(Track { title, artist, app: SERVICES.iter().find(|s| **s == app).map(|s| s.to_string()).unwrap_or_default() })
    }
}

/// Les services dont on sait ouvrir la recherche.
pub const SERVICES: &[&str] = &["spotify", "deezer", "applemusic", "tidal", "youtube"];

/// Le service d'après l'appli qui joue (« Spotify.exe », un identifiant
/// d'appli du Store…). Un navigateur ne dit pas quel site joue : inconnu.
pub fn service_of(app: &str) -> &'static str {
    let a = app.to_ascii_lowercase();
    if a.contains("spotify") {
        "spotify"
    } else if a.contains("deezer") {
        "deezer"
    } else if a.contains("applemusic") || a.contains("apple music") || a.contains("itunes") {
        "applemusic"
    } else if a.contains("tidal") {
        "tidal"
    } else if a.contains("youtube") {
        "youtube"
    } else {
        ""
    }
}

/// Un texte venu du lecteur, rendu sûr : sans caractère de contrôle ni
/// d'inversion de texte, `MAX_TRACK` caractères au plus.
fn clean(s: &str) -> String {
    let out: String = s.chars().filter(|c| !c.is_control() && !matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')).take(MAX_TRACK).collect();
    out.trim().to_string()
}

/// Le morceau qui JOUE d'après un message `media.changed` du module Musique
/// (`{ playing: { title, artist, app, status } | null }`) ; None en pause, à
/// l'arrêt ou sans titre.
pub fn track_from_media(payload: &Value) -> Option<Track> {
    let p = payload.get("playing")?;
    if p.get("status").and_then(Value::as_str) != Some("playing") {
        return None;
    }
    let field = |k: &str| p.get(k).and_then(Value::as_str).map(clean).unwrap_or_default();
    let title = field("title");
    if title.is_empty() {
        return None;
    }
    let t = Track { title, artist: field("artist"), app: service_of(p.get("app").and_then(Value::as_str).unwrap_or("")).to_string() };
    (check_text(&t.title, MAX_TRACK, false).is_ok() && check_text(&t.artist, MAX_TRACK, false).is_ok()).then_some(t)
}

/// Encode un texte pour une adresse (RFC 3986 : tout sauf lettres, chiffres et `-._~`).
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// L'adresse de recherche du morceau. `open_with` : « same » (le service du
/// collègue s'il est connu, sinon YouTube Music) ou un service de `SERVICES`.
pub fn search_url(t: &Track, open_with: &str) -> String {
    let service = if open_with == "same" || !SERVICES.contains(&open_with) {
        if t.app.is_empty() {
            "youtube"
        } else {
            t.app.as_str()
        }
    } else {
        open_with
    };
    let query = if t.artist.is_empty() { t.title.clone() } else { format!("{} {}", t.artist, t.title) };
    let q = encode(&query);
    match service {
        "spotify" => format!("https://open.spotify.com/search/{q}"),
        "deezer" => format!("https://www.deezer.com/search/{q}"),
        "applemusic" => format!("https://music.apple.com/search?term={q}"),
        "tidal" => format!("https://listen.tidal.com/search?q={q}"),
        _ => format!("https://music.youtube.com/search?q={q}"),
    }
}

// ── Envoyer : appelé par l'entretien (team_net.rs), toutes les 2 s ──────────

/// Les collègues en ligne qui comprennent `listening` et n'ont pas encore la
/// bonne version du morceau, avec ce qu'il faut leur envoyer.
fn due(inner: &Inner, share: bool) -> Vec<(Peer, Option<Track>)> {
    let peers = inner.peers();
    let mut st = inner.state.locked();
    let want = if share { st.listen_now.clone() } else { None };
    // Un collègue parti : on oublie ce qu'il avait reçu (il aura la suite à son retour).
    let online: Vec<String> = st.live.iter().filter(|(_, l)| team_net::online(l)).map(|(id, _)| id.clone()).collect();
    st.listen_sent.retain(|id, _| online.contains(id));
    peers
        .into_iter()
        .filter(|p| online.contains(&p.id))
        .filter(|p| st.live.get(&p.id).and_then(|l| l.hello.as_ref()).is_some_and(|h| h.knows(FEATURE_LISTENING)))
        // Jamais rien reçu = « rien ne joue » : pas besoin de le dire.
        .filter(|p| st.listen_sent.get(&p.id).cloned().flatten() != want)
        .map(|p| (p, want.clone()))
        .collect()
}

pub(super) fn sync(app: &AppHandle, inner: &Arc<Inner>, running: &Arc<AtomicBool>) {
    let share = team::settings(app).get("shareListening").and_then(Value::as_bool).unwrap_or(false);
    let todo = due(inner, share);
    if todo.is_empty() || running.swap(true, Ordering::SeqCst) {
        return;
    }
    let (inner, running) = (inner.clone(), running.clone());
    std::thread::spawn(move || {
        for (peer, track) in todo {
            let msg = Track::to_msg(track.as_ref());
            if msg.check().is_err() {
                continue;
            }
            if matches!(team_net::request(&inner, &peer, &msg), Ok(r) if !matches!(r, Msg::Refused { .. })) {
                inner.state.locked().listen_sent.insert(peer.id.clone(), track);
            }
        }
        running.store(false, Ordering::SeqCst);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn players_are_recognized() {
        assert_eq!(service_of("Spotify.exe"), "spotify");
        assert_eq!(service_of("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "spotify");
        assert_eq!(service_of("Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music"), "deezer");
        assert_eq!(service_of("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"), "applemusic");
        assert_eq!(service_of("TIDAL.exe"), "tidal");
        assert_eq!(service_of("msedge.exe"), "");
        assert_eq!(service_of("Chrome"), "");
    }

    #[test]
    fn only_a_playing_track_is_shared() {
        let playing = json!({ "playing": { "title": "Clair de lune", "artist": "Debussy", "app": "Spotify.exe", "status": "playing" } });
        assert_eq!(track_from_media(&playing), Some(Track { title: "Clair de lune".into(), artist: "Debussy".into(), app: "spotify".into() }));
        assert_eq!(track_from_media(&json!({ "playing": { "title": "x", "status": "paused" } })), None);
        assert_eq!(track_from_media(&json!({ "playing": null })), None);
        assert_eq!(track_from_media(&json!({ "playing": { "title": "  ", "status": "playing" } })), None);
        // Caractères de contrôle et d'inversion retirés, longueur bornée.
        let t = track_from_media(&json!({ "playing": { "title": "a\u{202E}b\u{7}c", "artist": "z".repeat(500), "app": "", "status": "playing" } })).unwrap();
        assert_eq!(t.title, "abc");
        assert_eq!(t.artist.chars().count(), MAX_TRACK);
    }

    #[test]
    fn search_links_are_built_here() {
        let t = Track { title: "Clair de lune".into(), artist: "Debussy".into(), app: "spotify".into() };
        assert_eq!(search_url(&t, "same"), "https://open.spotify.com/search/Debussy%20Clair%20de%20lune");
        assert_eq!(search_url(&t, "deezer"), "https://www.deezer.com/search/Debussy%20Clair%20de%20lune");
        let unknown = Track { app: String::new(), ..t.clone() };
        assert_eq!(search_url(&unknown, "same"), "https://music.youtube.com/search?q=Debussy%20Clair%20de%20lune");
        assert_eq!(search_url(&unknown, "n'importe quoi"), "https://music.youtube.com/search?q=Debussy%20Clair%20de%20lune");
        // Rien ne peut s'échapper de la recherche (&, #, /, ?, accents).
        let tricky = Track { title: "Été & co #1 /?x=y".into(), artist: String::new(), app: "applemusic".into() };
        assert_eq!(search_url(&tricky, "same"), "https://music.apple.com/search?term=%C3%89t%C3%A9%20%26%20co%20%231%20%2F%3Fx%3Dy");
    }

    #[test]
    fn received_message_becomes_a_track() {
        assert_eq!(Track::from_msg(String::new(), "x".into(), "spotify".into()), None);
        assert_eq!(Track::from_msg("t".into(), String::new(), "inconnu".into()).unwrap().app, "");
        assert_eq!(Track::to_msg(None), Msg::Listening { title: String::new(), artist: String::new(), app: String::new() });
    }
}
