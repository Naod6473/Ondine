// Outils de développeur, pour le module Agents IA :
//   - lancer un petit programme (git) sans fenêtre, avec un délai maximum ;
//   - trouver et ouvrir Visual Studio Code dans un dossier.
//
// Les programmes sont toujours lancés par leur CHEMIN COMPLET (trouvé dans le
// PATH par `find_program`, ou à l'endroit où VS Code s'installe), jamais par
// un nom à chercher dans le dossier courant, et le dossier est passé comme
// UN paramètre, jamais collé dans une ligne de commande d'un shell.
//
// `run_with_timeout` marche aussi sous Linux (les tests lancent le vrai git) ;
// VS Code n'est cherché et ouvert que sous Windows.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Au plus ce que l'on garde de la sortie d'un programme (le reste est lu et jeté).
const MAX_OUTPUT: usize = 4 * 1024 * 1024;

/// Lance `program` (chemin complet) dans `dir`, sans fenêtre, sans rien sur
/// son entrée, et rend ce qu'il a écrit (sortie standard) s'il a fini avec
/// succès avant `timeout`. Trop long : il est arrêté, et c'est une erreur.
/// `envs` : quelques variables d'environnement en plus.
pub fn run_with_timeout(program: &Path, args: &[&str], dir: &Path, envs: &[(&str, &str)], timeout: Duration) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    for (k, v) in envs {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Pas de fenêtre de console qui clignote.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("lancement impossible : {e}"))?;
    let mut out = child.stdout.take().ok_or("sortie indisponible")?;
    // La sortie est lue dans un fil à part : un programme qui écrit beaucoup
    // ne reste pas bloqué parce que personne ne lit.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        while let Ok(n) = out.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if kept.len() < MAX_OUTPUT {
                kept.extend_from_slice(&chunk[..n.min(MAX_OUTPUT - kept.len())]);
            }
        }
        let _ = tx.send(kept);
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // Fini : on attend la fin de la lecture (jamais au-delà du délai).
                let left = deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(200));
                let output = rx.recv_timeout(left).map_err(|_| "sortie incomplète".to_string())?;
                return if status.success() { Ok(output) } else { Err(format!("a répondu par une erreur ({status})")) };
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(15)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("trop long : arrêté".into());
            }
        }
    }
}

/// Visual Studio Code, s'il est installé : `Code.exe` à côté du `code.cmd`
/// trouvé dans le PATH (sinon ce `code.cmd` lui-même), ou aux endroits où
/// son installateur le met (pour l'utilisateur, ou pour tous).
#[cfg(windows)]
pub fn find_vscode() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(cmd) = super::find_program("code") {
        // …\Microsoft VS Code\bin\code.cmd → …\Microsoft VS Code\Code.exe
        if let Some(root) = cmd.parent().and_then(Path::parent) {
            candidates.push(root.join("Code.exe"));
        }
        candidates.push(cmd);
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs").join("Microsoft VS Code").join("Code.exe"));
    }
    if let Some(programs) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(programs).join("Microsoft VS Code").join("Code.exe"));
    }
    candidates.into_iter().find(|p| p.is_absolute() && p.is_file())
}

#[cfg(not(windows))]
pub fn find_vscode() -> Option<PathBuf> {
    None
}

/// Ouvre VS Code (chemin complet, trouvé par `find_vscode`) sur le dossier
/// `dir`, donné comme un seul paramètre. `Code.exe` est lancé directement,
/// comme le fait le menu « Ouvrir avec Code » de l'Explorateur. Un `code.cmd`
/// passe par cmd.exe : Rust y échappe lui-même le paramètre (et refuse ce
/// qu'il ne sait pas échapper), et `dir` est un chemin absolu validé.
#[cfg(windows)]
pub fn open_in_vscode(program: &Path, dir: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = Command::new(program);
    cmd.arg(dir);
    // Démarré depuis son propre dossier, jamais depuis celui du projet.
    if let Some(home) = program.parent() {
        cmd.current_dir(home);
    }
    let is_script = program.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    if is_script {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("VS Code ne s'ouvre pas : {e}"))
}

#[cfg(not(windows))]
pub fn open_in_vscode(_program: &Path, _dir: &Path) -> Result<(), String> {
    Err("disponible seulement sous Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le git du système, s'il y en a un (sinon le test ne vérifie rien).
    fn system_git() -> Option<PathBuf> {
        let name = if cfg!(windows) { "git.exe" } else { "git" };
        std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file()))
    }

    #[test]
    fn runs_and_reads_the_output() {
        let Some(git) = system_git() else { return };
        let out = run_with_timeout(&git, &["--version"], &std::env::temp_dir(), &[], Duration::from_secs(10)).unwrap();
        assert!(String::from_utf8_lossy(&out).starts_with("git version"));
        // Une erreur du programme (option inconnue) : une erreur, pas une sortie.
        assert!(run_with_timeout(&git, &["--option-qui-n-existe-pas"], &std::env::temp_dir(), &[], Duration::from_secs(10)).is_err());
    }

    #[test]
    fn a_missing_program_is_an_error() {
        let missing = std::env::temp_dir().join("ondine-programme-absent.exe");
        assert!(run_with_timeout(&missing, &[], &std::env::temp_dir(), &[], Duration::from_secs(1)).is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn too_long_is_stopped() {
        let sleep = Path::new("/bin/sleep");
        if !sleep.is_file() {
            return;
        }
        let start = Instant::now();
        let r = run_with_timeout(sleep, &["5"], Path::new("/"), &[], Duration::from_millis(300));
        assert_eq!(r, Err("trop long : arrêté".to_string()));
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
