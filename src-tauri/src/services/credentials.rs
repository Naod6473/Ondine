// Les identifiants (clé API Anthropic, jetons…) vivent UNIQUEMENT dans le
// Gestionnaire d'identifiants Windows, jamais sur disque ni dans le journal.
//
// Ce que le front peut faire : demander si une clé existe, en enregistrer une
// (depuis la fenêtre de réglages), en effacer une. Il ne peut JAMAIS la relire.
// Seul le code Rust d'un module ayant la permission "credentials" peut la lire,
// via ModuleContext::credential (voir modules/mod.rs).

/// Toutes les clés que l'île accepte de stocker. Les autres sont refusées.
pub const KNOWN_KEYS: &[&str] = &["anthropic-api-key"];

/// Nom sous lequel les clés apparaissent dans le Gestionnaire d'identifiants.
#[cfg(windows)]
const SERVICE: &str = "io.github.naod6473.ondine";
/// L'ancien nom (quand l'appli s'appelait « Island ») : une clé enregistrée
/// avant le renommage est recopiée sous le nouveau nom à la première lecture.
#[cfg(windows)]
const OLD_SERVICE: &str = "io.github.naod6473.island";

fn check_key(key: &str) -> Result<(), String> {
    if KNOWN_KEYS.contains(&key) {
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
    store::set(key, value)
}

pub fn delete(key: &str) -> Result<(), String> {
    check_key(key)?;
    store::delete(key)
}
