// Agents IA : les outils MCP en plus (« ondine.exe mcp », voir cli.rs) :
//   - ondine_note    : un texte (2000 caractères au plus) → une note du module Notes ;
//   - ondine_shelf   : un fichier existant → déposé sur l'étagère, seulement
//                      s'il est sous le dossier de la session de l'agent ou
//                      sous le dossier utilisateur ;
//   - ondine_capture : l'agent demande une capture d'écran ; l'île te le
//                      demande (« Capturer » / « Refuser »), la capture est
//                      prise par le module Capture après TON clic, et son
//                      chemin est rendu à l'agent ; sans clic en 60 s : refus ;
//   - ondine_open    : une adresse http(s) ou un fichier existant, ouvert
//                      seulement après ton clic sur « Ouvrir » (un fichier
//                      n'est jamais exécuté : il est ouvert par le programme
//                      associé, comme « Ouvrir » de l'étagère).
//
// Ce fichier ne contient que les vérifications (testées plus bas) ; le
// module (agents.rs) reçoit les demandes, affiche et répond.

use std::path::Path;

/// La longueur maximale d'une note dictée par un agent.
pub const MAX_NOTE: usize = 2000;
/// La longueur maximale d'une adresse à ouvrir.
pub const MAX_URL: usize = 2000;
/// Le temps laissé pour cliquer « Capturer » / « Ouvrir ».
pub const CLICK_SECS: u64 = 60;
/// Après le clic, le temps laissé à l'outil de capture de Windows (il attend
/// lui-même 2 min au plus).
pub const CAPTURE_SECS: u64 = 150;

/// Le texte d'une note : retours à la ligne gardés, autres caractères de
/// contrôle retirés, 2000 caractères au plus (sinon None : refus, pas de coupe
/// silencieuse).
pub fn note_text(raw: &str) -> Option<String> {
    let text: String = raw.chars().filter(|c| !c.is_control() || matches!(c, '\n' | '\t')).collect::<String>().trim().to_string();
    if text.is_empty() || text.chars().count() > MAX_NOTE {
        return None;
    }
    Some(text)
}

/// Une adresse web acceptable : http(s), sans espace ni caractère de
/// contrôle, pas trop longue. Tout le reste (file:, javascript:, chemins
/// UNC…) est refusé.
pub fn web_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    let lower = url.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("http://") || lower.starts_with("https://");
    let chars_ok = url.chars().all(|c| !c.is_control() && !c.is_whitespace());
    let host_ok = url.split("://").nth(1).is_some_and(|rest| rest.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '['));
    (scheme_ok && chars_ok && host_ok && url.len() <= MAX_URL).then(|| url.to_string())
}

/// Une adresse ressemble-t-elle à un lien (plutôt qu'à un chemin de fichier) ?
pub fn looks_like_url(raw: &str) -> bool {
    let lower = raw.trim().to_ascii_lowercase();
    lower.contains("://")
}

/// Un agent ne peut déposer sur l'étagère (ou ouvrir) qu'un fichier sous le
/// dossier de sa session (`cwd`, s'il est connu) ou sous le dossier
/// utilisateur. `real` est déjà validé par `check_path` (absolu, existant,
/// canonisé) ; les dossiers sont comparés sans tenir compte de la casse.
pub fn under_allowed(real: &Path, cwd: Option<&Path>, home: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase();
    let file = norm(real);
    let inside = |dir: &Path| {
        let d = norm(dir);
        !d.is_empty() && (file == d || file.starts_with(&format!("{d}\\")))
    };
    inside(home) || cwd.is_some_and(inside)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn notes_are_bounded_and_clean() {
        assert_eq!(note_text("  Penser à\nrelancer les tests\u{7}  ").as_deref(), Some("Penser à\nrelancer les tests"));
        assert_eq!(note_text("   "), None);
        assert!(note_text(&"a".repeat(MAX_NOTE)).is_some());
        assert_eq!(note_text(&"a".repeat(MAX_NOTE + 1)), None);
    }

    #[test]
    fn only_web_urls_open() {
        assert_eq!(web_url(" https://example.org/doc?x=1 ").as_deref(), Some("https://example.org/doc?x=1"));
        assert!(web_url("HTTP://example.org").is_some());
        for bad in ["file:///C:/x", "javascript:alert(1)", "ftp://x", "https://", "https://exa mple.org", "example.org", "https://x\n.org"] {
            assert_eq!(web_url(bad), None, "{bad}");
        }
        assert_eq!(web_url(&format!("https://e.org/{}", "a".repeat(MAX_URL))), None);
        assert!(looks_like_url("https://x.org") && !looks_like_url("C:\\x\\y.pdf"));
    }

    #[test]
    fn shelf_files_must_be_under_the_session_or_home() {
        let home = PathBuf::from(r"C:\Users\Simon");
        let cwd = PathBuf::from(r"D:\Projets\api");
        assert!(under_allowed(Path::new(r"C:\Users\Simon\Documents\a.pdf"), None, &home));
        assert!(under_allowed(Path::new(r"d:\projets\API\out\rapport.md"), Some(&cwd), &home));
        assert!(!under_allowed(Path::new(r"D:\Projets\apiX\x.txt"), Some(&cwd), &home)); // un voisin au nom proche
        assert!(!under_allowed(Path::new(r"C:\Windows\System32\cmd.exe"), Some(&cwd), &home));
        assert!(!under_allowed(Path::new(r"D:\Projets\api\x.txt"), None, &home)); // session inconnue
        assert!(!under_allowed(Path::new(r"C:\x"), None, Path::new("")));
    }
}
