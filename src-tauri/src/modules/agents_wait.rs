// Agents IA : les rappels d'attente. Quand une session « vous attend »
// depuis 10 minutes, une nouvelle notification (« Claude attend toujours votre
// réponse · site-ondine »), puis une autre à 30 minutes, et c'est tout.
// Réglage `remindWaiting` ; rien pendant la concentration (vérifié par le
// module). La mascotte, elle, fait coucou toutes les deux minutes depuis le
// front (src/modules/agents/wait-watch.ts) tant que l'île est en mini-île.

/// Les paliers (ms) des rappels : 10 min, puis 30 min.
pub const STEPS: [u64; 2] = [10 * 60_000, 30 * 60_000];

/// Le rappel à envoyer maintenant pour une session qui attend depuis
/// `waited_ms`, dont `sent` rappels sont déjà partis : le numéro du rappel
/// (1 ou 2), ou None.
pub fn reminder_due(waited_ms: u64, sent: u8) -> Option<u8> {
    let next = sent as usize;
    if next >= STEPS.len() || waited_ms < STEPS[next] {
        return None;
    }
    Some((next + 1) as u8)
}

/// « Claude attend toujours votre réponse », et le projet s'il est connu.
pub fn reminder_text(who: &str, project: &str, waited_ms: u64) -> (String, String) {
    let title = format!("{who} attend toujours votre réponse");
    let minutes = waited_ms / 60_000;
    let body = if project.is_empty() { format!("depuis {minutes} min") } else { format!("depuis {minutes} min · {project}") };
    (title, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_reminders_then_silence() {
        assert_eq!(reminder_due(9 * 60_000, 0), None);
        assert_eq!(reminder_due(10 * 60_000, 0), Some(1));
        assert_eq!(reminder_due(25 * 60_000, 1), None);
        assert_eq!(reminder_due(31 * 60_000, 1), Some(2));
        assert_eq!(reminder_due(5 * 3_600_000, 2), None);
        // Un rappel oublié (île en concentration) : le palier suivant suffit.
        assert_eq!(reminder_due(45 * 60_000, 0), Some(1));
    }

    #[test]
    fn texts() {
        let (t, b) = reminder_text("Claude", "site-ondine", 10 * 60_000 + 30_000);
        assert_eq!((t.as_str(), b.as_str()), ("Claude attend toujours votre réponse", "depuis 10 min · site-ondine"));
        assert_eq!(reminder_text("Codex", "", 30 * 60_000).1, "depuis 30 min");
    }
}
