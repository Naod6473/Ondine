// Agents IA : rester discrète quand vous regardez déjà le terminal (1.2.5).
//
// Quand une session passe « vous attend » ou « a fini » alors que la fenêtre
// au premier plan EST celle de cette session (celle que « Y aller »
// ramènerait), Ondine ne joue pas de son, ne montre ni alerte ni
// notification, ni halo d'appel, ni fête de la mascotte : vous le voyez déjà.
// La carte de la session (tableau « En cours ») est mise à jour quand même,
// et les rappels de 10 / 30 min (agents_wait.rs) suivent leur cours : si
// vous quittez la fenêtre, ils arrivent comme avant.
// Idée reprise de CodeIsland (wxtsky, MIT), réécrite (voir THIRD-PARTY.md).
//
// La recherche de la fenêtre est celle de « Y aller »
// (`platform::agent_windows`, même `pick_agent_window`). Prudence : si une
// AUTRE session connue a la même fenêtre (deux onglets de Windows Terminal,
// par exemple), on ne sait pas quel onglet vous regardez : Ondine prévient
// comme avant. Ici : la logique seule, testée.

/// Faut-il rester discrète pour cet événement ? `watching` n'est appelé
/// (recherche des fenêtres) que si le réglage est actif et que l'événement
/// est « vous attend » ou « a fini ».
pub fn stay_discreet(setting_on: bool, kind: &str, watching: impl FnOnce() -> bool) -> bool {
    setting_on && matches!(kind, "waiting" | "done") && watching()
}

/// La fenêtre au premier plan (`foreground`, 0 = aucune) est-elle celle de
/// cette session (`this`), et d'aucune autre session connue (`others`) ?
pub fn watching(foreground: isize, this: Option<isize>, others: &[Option<isize>]) -> bool {
    foreground != 0 && this == Some(foreground) && !others.contains(&Some(foreground))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_waiting_or_done_with_the_setting() {
        assert!(stay_discreet(true, "waiting", || true));
        assert!(stay_discreet(true, "done", || true));
        assert!(!stay_discreet(true, "done", || false));
        // Réglage coupé, ou un autre événement : on ne cherche même pas la fenêtre.
        assert!(!stay_discreet(false, "done", || panic!("pas de recherche")));
        assert!(!stay_discreet(true, "info", || panic!("pas de recherche")));
        assert!(!stay_discreet(true, "working", || panic!("pas de recherche")));
    }

    #[test]
    fn the_session_window_must_be_in_front_alone() {
        assert!(watching(42, Some(42), &[Some(7), None]));
        // Une autre fenêtre devant, ou rien de trouvé.
        assert!(!watching(7, Some(42), &[]));
        assert!(!watching(42, None, &[]));
        assert!(!watching(0, Some(0), &[]));
        // Deux sessions dans la même fenêtre (onglets) : on prévient.
        assert!(!watching(42, Some(42), &[Some(42)]));
    }
}
