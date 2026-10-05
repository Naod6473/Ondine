// Verrous qui survivent à une erreur.
//
// En Rust, si un fil plante pendant qu'il tient un `Mutex`, le verrou devient
// « empoisonné » : chaque `lock().unwrap()` suivant plante à son tour, et le
// module concerné ne marche plus jusqu'au redémarrage de l'île.
//
// `locked()` reprend le verrou quand même. Les données sont celles laissées par
// le fil qui a planté : chez nous ce sont des listes et des réglages, toujours
// utilisables, et c'est bien mieux qu'un module mort.

use std::sync::{Mutex, MutexGuard};

pub trait LockExt<T> {
    /// Comme `lock().unwrap()`, mais sans planter sur un verrou empoisonné.
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_poisoned_lock_still_works() {
        let m = Arc::new(Mutex::new(1));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("plantage voulu");
        })
        .join();
        assert!(m.is_poisoned());
        *m.locked() += 1;
        assert_eq!(*m.locked(), 2);
    }
}
