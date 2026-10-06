// Les identifiants (clé API Anthropic, jetons…) vivent UNIQUEMENT dans le
// Gestionnaire d'identifiants Windows, jamais sur disque ni dans le journal.
//
// Ce que le front peut faire : demander si une clé existe, en enregistrer une
// (depuis la fenêtre de réglages), en effacer une. Il ne peut JAMAIS la relire.
// Seul le code Rust d'un module ayant la permission "credentials" peut la lire,
// via ModuleContext::credential (voir modules/mod.rs).

/// Toutes les clés que l'île accepte de stocker. Les autres sont refusées
/// (sauf celles des agendas en ligne, voir `calendar_key`).
pub const KNOWN_KEYS: &[&str] = &["anthropic-api-key", ICAL_URL];

/// L'adresse secrète iCal d'un agenda en ligne (Google Agenda…) : c'est un
/// mot de passe déguisé (qui l'a peut lire tout l'agenda), donc rangée ici.
/// C'est l'ANCIENNE clé (un seul agenda en ligne, avant la version 1.2) : elle
/// ne sert plus qu'à la migration (voir modules/agenda.rs).
pub const ICAL_URL: &str = "agenda-ical-url";

/// Depuis la version 1.2, chaque agenda en ligne a sa propre clé :
/// « agenda-ical-url-<id> », où <id> est l'identifiant du calendrier dans les
/// réglages du module Agenda.
pub fn calendar_key(id: &str) -> String {
    format!("{ICAL_URL}-{id}")
}

/// Un identifiant de calendrier valide : 1 à 16 lettres minuscules ou chiffres.
pub fn is_calendar_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 16 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// Est-ce une clé d'agenda en ligne (l'ancienne ou celle d'un calendrier) ?
fn is_ical_key(key: &str) -> bool {
    key == ICAL_URL || key.strip_prefix(ICAL_URL).and_then(|rest| rest.strip_prefix('-')).is_some_and(is_calendar_id)
}

/// Nom sous lequel les clés apparaissent dans le Gestionnaire d'identifiants.
#[cfg(windows)]
const SERVICE: &str = "io.github.naod6473.ondine";
/// L'ancien nom (quand l'appli s'appelait « Island ») : une clé enregistrée
/// avant le renommage est recopiée sous le nouveau nom à la première lecture.
#[cfg(windows)]
const OLD_SERVICE: &str = "io.github.naod6473.island";

fn check_key(key: &str) -> Result<(), String> {
    if KNOWN_KEYS.contains(&key) || is_ical_key(key) {
        Ok(())
    } else {
        Err(format!("clé inconnue : {key}"))
    }
}

#[cfg(windows)]
mod store {
    use keyring::Entry;

    fn entry(key: &str) -> Result<Entry, String> {
        Entry::new(super::SERVICE, key).map_err(|e| e.to_string())
    }

    fn old_entry(key: &str) -> Result<Entry, String> {
        Entry::new(super::OLD_SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Option<String> {
        if let Some(v) = entry(key).ok()?.get_password().ok().filter(|v| !v.is_empty()) {
            return Some(v);
        }
        // Pas encore sous le nouveau nom : on regarde sous l'ancien, et on recopie.
        let old = old_entry(key).ok()?.get_password().ok().filter(|v| !v.is_empty())?;
        let _ = set(key, &old);
        Some(old)
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        // Les deux noms : sinon l'ancienne copie « reviendrait » à la lecture.
        for e in [entry(key)?, old_entry(key)?] {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod store {
    pub fn get(_key: &str) -> Option<String> {
        None
    }
    pub fn set(_key: &str, _value: &str) -> Result<(), String> {
        Err("le Gestionnaire d'identifiants n'existe que sous Windows".into())
    }
    pub fn delete(_key: &str) -> Result<(), String> {
        Ok(())
    }
}

/// La clé existe-t-elle ? (la seule question que le front peut poser)
pub fn exists(key: &str) -> bool {
    check_key(key).is_ok() && store::get(key).is_some()
}

#[allow(dead_code)] // utilisée par ModuleContext::credential
/// Lecture réservée au Rust. Ne JAMAIS renvoyer la valeur au front ni la journaliser.
pub fn get(key: &str) -> Option<String> {
    check_key(key).ok()?;
    store::get(key)
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    check_key(key)?;
    let value = value.trim();
    if value.is_empty() {
        return delete(key);
    }
    if is_ical_key(key) {
        // Outlook et Apple donnent parfois « webcal:// » : c'est du https.
        let url = match value.get(..9) {
            Some(p) if p.eq_ignore_ascii_case("webcal://") => format!("https://{}", &value[9..]),
            _ => value.to_string(),
        };
        check_ical_url(&url)?;
        return store::set(key, &url);
    }
    store::set(key, value)
}

/// Une adresse d'agenda : https seulement, sans espace, de longueur raisonnable.
/// Le message d'erreur ne répète jamais l'adresse (elle est secrète).
pub fn check_ical_url(url: &str) -> Result<(), String> {
    let ok = url.len() <= 2000
        && url.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://"))
        && url.len() > 8
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok {
        Ok(())
    } else {
        Err("adresse refusée : il faut un lien qui commence par https:// (l'adresse secrète iCal de ton agenda)".into())
    }
}

pub fn delete(key: &str) -> Result<(), String> {
    check_key(key)?;
    store::delete(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ical_url_must_be_https() {
        assert!(check_ical_url("https://calendar.google.com/calendar/ical/x/private-y/basic.ics").is_ok());
        assert!(check_ical_url("HTTPS://exemple.fr/a.ics").is_ok());
        for bad in ["http://exemple.fr/a.ics", "https://", "file:///C:/a.ics", "https://a b", "webcal://x"] {
            assert!(check_ical_url(bad).is_err(), "{bad}");
        }
        // Le message ne recopie jamais l'adresse.
        assert!(!check_ical_url("http://secret-token").unwrap_err().contains("secret-token"));
    }

    #[test]
    fn one_key_per_calendar() {
        assert_eq!(calendar_key("ab12"), "agenda-ical-url-ab12");
        assert!(check_key(&calendar_key("ab12")).is_ok());
        assert!(check_key(ICAL_URL).is_ok());
        // Un identifiant bizarre ne permet pas de ranger n'importe quelle clé.
        for bad in ["agenda-ical-url-", "agenda-ical-url-AB", "agenda-ical-url-a/b", "agenda-ical-url-12345678901234567", "agenda-ical-urlx"] {
            assert!(check_key(bad).is_err(), "{bad}");
        }
    }
}
