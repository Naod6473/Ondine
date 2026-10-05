// Module « Terminal » : ouvre cmd, PowerShell, PowerShell 7 ou Windows
// Terminal, dans un dossier choisi.
//
// Sécurité : on ne lance QUE ces quatre programmes, choisis dans une liste
// fermée. Aucune commande n'est tapée à la place de l'utilisateur ; le seul
// paramètre transmis est le dossier de départ, validé par `check_path`
// (chemin absolu, existant, hors dossiers exclus).

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::{ModuleContext, RustModule};
use crate::services::bus::BusMessage;
use crate::platform;

/// Les terminaux connus. Toute autre valeur est refusée.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Shell {
    Cmd,
    PowerShell,
    Pwsh,
    WindowsTerminal,
}

impl Shell {
    fn parse(name: &str) -> Result<Self, String> {
        match name {
            "cmd" => Ok(Self::Cmd),
            "powershell" => Ok(Self::PowerShell),
            "pwsh" => Ok(Self::Pwsh),
            "wt" => Ok(Self::WindowsTerminal),
            other => Err(format!("terminal inconnu : {other}")),
        }
    }

    fn program(self) -> &'static str {
        match self {
            Self::Cmd => "cmd.exe",
            Self::PowerShell => "powershell.exe",
            Self::Pwsh => "pwsh.exe",
            Self::WindowsTerminal => "wt.exe",
        }
    }

    /// Les paramètres pour une ouverture normale (le dossier est donné à
    /// part, comme dossier de travail du programme).
    fn args(self, dir: &Path) -> Vec<String> {
        match self {
            Self::Cmd => vec![],
            Self::PowerShell | Self::Pwsh => vec!["-NoLogo".into()],
            // Windows Terminal ignore le dossier de travail : on le lui dit avec -d.
            Self::WindowsTerminal => vec!["-d".into(), dir.display().to_string()],
        }
    }

    /// La ligne de paramètres pour une ouverture en administrateur. Là,
    /// Windows démarre dans C:\Windows\System32 : il faut se déplacer soi-même.
    /// Un chemin Windows ne peut pas contenir de « " », donc les guillemets
    /// ci-dessous ne peuvent pas être cassés par le nom du dossier.
    fn admin_params(self, dir: &Path) -> String {
        let mut d = dir.display().to_string();
        // La racine d'un lecteur (« E:\ ») : « \" » serait lu comme un guillemet
        // échappé ; « E:\. » désigne le même dossier sans ce piège.
        if d.ends_with('\\') {
            d.push('.');
        }
        match self {
            Self::Cmd => format!("/k cd /d \"{d}\""),
            // Entre apostrophes, PowerShell ne remplace rien ($, `…) ; une
            // apostrophe dans le nom s'écrit en la doublant.
            Self::PowerShell | Self::Pwsh => {
                format!("-NoLogo -NoExit -Command \"Set-Location -LiteralPath '{}'\"", d.replace('\'', "''"))
            }
            Self::WindowsTerminal => format!("-d \"{d}\""),
        }
    }
}

#[derive(Default)]
pub struct Terminal;

impl RustModule for Terminal {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/terminal/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // { shell?: "cmd"|"powershell"|"pwsh"|"wt", path?: dossier ou fichier, admin?: bool }
            "open" => {
                let settings = ctx.settings();
                let shell_name = args
                    .get("shell")
                    .and_then(Value::as_str)
                    .or_else(|| settings.get("shell").and_then(Value::as_str))
                    .unwrap_or("powershell");
                let shell = Shell::parse(shell_name)?;
                let dir = start_dir(ctx, &args, &settings)?;
                let admin = args.get("admin").and_then(Value::as_bool).unwrap_or(false);

                if admin {
                    platform::run_as_admin(shell.program(), &shell.admin_params(&dir))?;
                } else {
                    platform::spawn_console(shell.program(), &shell.args(&dir), &dir)?;
                }
                // Le journal note quoi et où, rien d'autre.
                ctx.log_info(format!("ouvre {}{} dans {}", shell.program(), if admin { " (administrateur)" } else { "" }, dir.display()));
                Ok(json!({ "dir": dir.display().to_string() }))
            }
            // Le dossier de départ, pour l'afficher dans l'onglet.
            "start_dir" => {
                let dir = start_dir(ctx, &Value::Null, &ctx.settings())?;
                Ok(json!({ "dir": dir.display().to_string() }))
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }

    /// "terminal.open" `{path?}` : une règle demande un terminal (par exemple à
    /// la racine d'une clé USB). Même chemin que le bouton : terminal du
    /// réglage, dossier validé.
    fn on_event(&self, ctx: &ModuleContext, msg: &BusMessage) {
        if msg.topic != "terminal.open" {
            return;
        }
        let args = json!({ "path": msg.payload.get("path").cloned().unwrap_or(Value::Null) });
        if let Err(e) = self.invoke(ctx, "open", args) {
            ctx.log_warn(format!("terminal demandé par une règle : {e}"));
        }
    }
}

/// Le dossier où ouvrir : celui demandé (un fichier déposé → son dossier),
/// sinon le réglage, sinon le dossier de l'utilisateur.
fn start_dir(ctx: &ModuleContext, args: &Value, settings: &serde_json::Map<String, Value>) -> Result<PathBuf, String> {
    let asked = args.get("path").and_then(Value::as_str);
    let from_settings = settings
        .get("folder")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let Some(raw) = asked.or(from_settings) else {
        return Ok(platform::home_dir());
    };
    let path = ctx.check_path(raw)?;
    Ok(folder_of(path))
}

/// Un dossier reste lui-même ; un fichier donne le dossier qui le contient.
fn folder_of(path: PathBuf) -> PathBuf {
    if path.is_dir() {
        return path;
    }
    path.parent().map(Path::to_path_buf).unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_shells() {
        assert_eq!(Shell::parse("cmd").unwrap(), Shell::Cmd);
        assert!(Shell::parse("bash").is_err());
        assert!(Shell::parse("cmd.exe /c del").is_err());
    }

    #[test]
    fn admin_params_quote_the_folder() {
        let dir = Path::new(r"C:\Users\Simon\Mes projets\l'île");
        assert_eq!(Shell::Cmd.admin_params(dir), r#"/k cd /d "C:\Users\Simon\Mes projets\l'île""#);
        assert_eq!(
            Shell::PowerShell.admin_params(dir),
            r#"-NoLogo -NoExit -Command "Set-Location -LiteralPath 'C:\Users\Simon\Mes projets\l''île'""#
        );
    }

    #[test]
    fn drive_root_is_not_an_escaped_quote() {
        assert_eq!(Shell::WindowsTerminal.admin_params(Path::new("E:\\")), r#"-d "E:\.""#);
    }

    #[test]
    fn a_file_opens_in_its_folder() {
        let tmp = std::env::temp_dir();
        assert_eq!(folder_of(tmp.clone()), tmp);
        assert_eq!(folder_of(tmp.join("n-existe-pas.txt")), tmp);
    }
}
