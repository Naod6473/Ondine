// Module « Mises à jour des logiciels » : la partie pure (sans Windows, testée).
//
// winget n'a pas de sortie JSON pour `winget upgrade` : il écrit un tableau
// en texte, traduit dans la langue de Windows, aux colonnes de largeur
// variable. Exemple (en français) :
//
//   Nom                       ID                     Version   Disponible  Source
//   ---------------------------------------------------------------------------
//   Mozilla Firefox (x64 fr)  Mozilla.Firefox        128.0     129.0.1     winget
//   Visual Studio Code        Microsoft.VisualStud…  1.91.0    1.92.1      winget
//   3 mises à niveau disponibles.
//
// La lecture ne dépend pas de la langue :
//   1. on nettoie la sortie (séquences ANSI, retours chariot de la roue qui
//      tourne et des barres de progression) ;
//   2. la ligne de tirets repère le tableau ; la ligne juste au-dessus donne
//      le DÉBUT de chaque colonne (là où un mot commence après une espace) ;
//   3. chaque ligne est découpée à ces positions, en largeur d'affichage (un
//      caractère chinois compte pour deux colonnes, comme pour winget) ; une
//      ligne doit avoir une espace juste avant chaque colonne, sinon ce n'est
//      pas une ligne du tableau (« 3 mises à niveau disponibles. ») ;
//   4. si le découpage échoue (largeurs mal comptées), on relit la ligne par
//      la droite : source, disponible, version, ID, et le reste est le nom ;
//      seulement si le dernier mot est une source connue, pour ne jamais
//      prendre une phrase de bas de tableau pour une appli.
// Un deuxième tableau (« Les packages suivants ont une mise à niveau
// disponible, mais nécessitent un ciblage explicite ») est lu aussi : ses
// applis sont marquées `explicit` (nous les mettons à jour par leur ID, donc
// ciblées explicitement : elles marchent comme les autres).

use serde::{Deserialize, Serialize};

/// Une appli qui a une mise à jour.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub name: String,
    pub id: String,
    pub version: String,
    pub available: String,
    #[serde(default)]
    pub source: String,
    /// Le nom a été coupé par winget (« Visual Studio Co… »).
    #[serde(default)]
    pub truncated: bool,
    /// Du second tableau : winget demande de la cibler explicitement.
    #[serde(default)]
    pub explicit: bool,
}

/// Les sources de winget que l'on reconnaît sans les avoir vues dans le tableau.
const KNOWN_SOURCES: &[&str] = &["winget", "msstore"];

/// Un ID de package que l'on accepte de passer à winget : lettres et chiffres
/// ASCII, « . - _ + », 1 à 128 caractères, jamais « - » au début (winget le
/// lirait comme une option). Pas d'espace, de guillemet ni de barre : rien
/// qui puisse changer le sens de la ligne de commande.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('-')
        && !id.starts_with('.')
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}

/// Une source (« winget », « msstore ») : lettres, chiffres, « - _ », 32 au plus.
pub fn valid_source(s: &str) -> bool {
    !s.is_empty() && s.len() <= 32 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// Les applis ignorées (« Ne plus proposer ») : le réglage `ignored`, un ID par
/// ligne (virgules et espaces acceptés aussi). Les ID invalides sont oubliés,
/// les doublons aussi (sans tenir compte des majuscules).
pub fn parse_ignored(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for word in text.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
        let w = word.trim();
        if valid_id(w) && !out.iter().any(|o| o.eq_ignore_ascii_case(w)) {
            out.push(w.to_string());
        }
    }
    out
}

/// Le réglage `ignored` avec `id` en plus (ou en moins), un ID par ligne.
pub fn with_ignored(text: &str, id: &str, ignore: bool) -> String {
    let mut list = parse_ignored(text);
    list.retain(|o| !o.eq_ignore_ascii_case(id));
    if ignore && valid_id(id) {
        list.push(id.to_string());
    }
    list.join("\n")
}

pub fn is_ignored(ignored: &[String], id: &str) -> bool {
    ignored.iter().any(|o| o.eq_ignore_ascii_case(id))
}

/// Tous les combien vérifier (réglage `checkEvery`), en secondes ; None = jamais.
pub fn interval_secs(every: &str) -> Option<u64> {
    match every {
        "daily" => Some(24 * 3600),
        "weekly" => Some(7 * 24 * 3600),
        _ => None,
    }
}

/// Une vérification automatique est-elle due ? (`last` = dernière vérification, secondes Unix.)
pub fn check_due(every: &str, last: Option<u64>, now: u64) -> bool {
    match (interval_secs(every), last) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(i), Some(l)) => now.saturating_sub(l) >= i,
    }
}

// ── Nettoyage de la sortie ───────────────────────────────────────────────────

/// Enlève les séquences d'échappement ANSI (couleurs, « effacer la ligne »).
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            // CSI : ESC [ … une lettre finale (0x40 à 0x7E).
            Some('[') => {
                chars.next();
                for d in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&d) {
                        break;
                    }
                }
            }
            // OSC : ESC ] … BEL ou ESC \.
            Some(']') => {
                chars.next();
                while let Some(d) = chars.next() {
                    if d == '\u{7}' {
                        break;
                    }
                    if d == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}

/// La roue qui tourne de winget : un seul signe parmi « - \ | / ».
fn is_spinner(s: &str) -> bool {
    matches!(s.trim(), "-" | "\\" | "|" | "/")
}

/// Une barre de progression : des pavés (█ ▒ ▓ ░ ▏ ▕) suivis d'une taille ou d'un pourcentage.
fn is_progress_bar(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '█' | '▒' | '▓' | '░' | '▏' | '▕'))
}

/// Les lignes telles qu'on les verrait à l'écran : pour une ligne réécrite
/// avec « \r » (roue, barre), le dernier morceau qui a du sens.
pub fn clean_lines(raw: &str) -> Vec<String> {
    let text = strip_ansi(raw);
    text.split('\n')
        .map(|line| {
            let parts: Vec<&str> = line.split('\r').collect();
            let keep = parts.iter().rev().find(|p| !p.trim().is_empty() && !is_spinner(p) && !is_progress_bar(p)).copied().unwrap_or("");
            keep.trim_end().to_string()
        })
        .collect()
}

// ── Largeur d'affichage ──────────────────────────────────────────────────────

/// La largeur d'un caractère à l'écran : 2 pour les caractères « larges »
/// (chinois, japonais, coréen, pleine chasse, la plupart des emojis), 0 pour
/// les accents combinants, 1 sinon. Une table courte, suffisante ici.
pub fn char_width(c: char) -> usize {
    let u = c as u32;
    if matches!(u, 0x0300..=0x036F | 0x200B..=0x200F | 0xFE00..=0xFE0F) {
        return 0;
    }
    let wide = matches!(u,
        0x1100..=0x115F
        | 0x2E80..=0x303E
        | 0x3041..=0x33FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xA000..=0xA4CF
        | 0xAC00..=0xD7A3
        | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F
        | 0xFF00..=0xFF60
        | 0xFFE0..=0xFFE6
        | 0x1F300..=0x1F64F
        | 0x1F900..=0x1F9FF
        | 0x20000..=0x3FFFD);
    if wide {
        2
    } else {
        1
    }
}

/// La ligne en cellules d'écran : (colonne de début, caractère).
fn cells(line: &str) -> Vec<(usize, char)> {
    let mut col = 0;
    line.chars()
        .map(|c| {
            let at = col;
            col += char_width(c);
            (at, c)
        })
        .collect()
}

/// Le texte entre les colonnes d'écran [from, to) (to = None : jusqu'au bout).
fn slice_cols(cells: &[(usize, char)], from: usize, to: Option<usize>) -> String {
    cells.iter().filter(|(at, _)| *at >= from && to.is_none_or(|t| *at < t)).map(|(_, c)| *c).collect::<String>().trim().to_string()
}

/// Le caractère qui occupe la colonne d'écran `col` (None : au-delà de la ligne).
fn char_at(cells: &[(usize, char)], col: usize) -> Option<char> {
    cells.iter().rev().find(|(at, c)| *at <= col && *at + char_width(*c).max(1) > col).map(|(_, c)| *c)
}

// ── Le tableau ───────────────────────────────────────────────────────────────

/// Une ligne de tirets (le trait sous les titres du tableau).
fn is_rule(line: &str) -> bool {
    let t = line.trim();
    t.chars().count() >= 8 && t.chars().all(|c| c == '-' || c == '─')
}

/// Les colonnes d'écran où commence chaque titre (« Nom  ID  Version… »).
fn column_starts(header: &str) -> Vec<usize> {
    let cs = cells(header);
    let mut out = Vec::new();
    let mut prev_space = true;
    for (at, c) in cs {
        let space = c.is_whitespace();
        if !space && prev_space {
            out.push(at);
        }
        prev_space = space;
    }
    out
}

/// Ce que la lecture a trouvé.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ListResult {
    pub packages: Vec<Package>,
    /// Lignes du tableau laissées de côté (ID coupé par winget, ou invalide).
    pub skipped: usize,
    /// Au moins un tableau a été trouvé (sinon : « aucune mise à jour », ou une erreur).
    pub found_table: bool,
}

fn build(name: String, id: String, version: String, available: String, source: String, explicit: bool) -> Package {
    let truncated = name.ends_with('…');
    Package { name, id, version, available, source, truncated, explicit }
}

/// Une ligne découpée aux positions des colonnes ; None si elle ne tombe pas juste.
fn row_by_columns(line: &str, starts: &[usize]) -> Option<[String; 5]> {
    let cs = cells(line);
    // Chaque colonne (sauf la première) doit suivre une espace, et commencer par autre chose qu'une espace.
    for &s in &starts[1..] {
        if char_at(&cs, s.saturating_sub(1)).is_some_and(|c| !c.is_whitespace()) {
            return None;
        }
    }
    let mut out: [String; 5] = Default::default();
    for (i, &s) in starts.iter().enumerate().take(5) {
        let end = if i + 1 < starts.len().min(5) { Some(starts[i + 1]) } else { None };
        out[i] = slice_cols(&cs, s, end);
    }
    // Plus de 5 colonnes (un jour) : la dernière s'arrête à la 6e.
    if starts.len() > 5 {
        out[4] = slice_cols(&cs, starts[4], Some(starts[5]));
    }
    // ID, version et version disponible ne contiennent pas d'espace (sauf « < 1.2 »).
    let id_ok = !out[1].is_empty() && !out[1].contains(char::is_whitespace);
    let avail_ok = !out[3].is_empty() && !out[3].contains(char::is_whitespace);
    if out[0].is_empty() || !id_ok || out[2].is_empty() || !avail_ok {
        return None;
    }
    Some(out)
}

/// La ligne relue par la droite (source, disponible, version, ID, nom).
fn row_by_words(line: &str, has_source: bool, sources: &[String]) -> Option<[String; 5]> {
    if !has_source {
        return None;
    }
    let mut words: Vec<&str> = line.split_whitespace().collect();
    if words.len() < 5 {
        return None;
    }
    let source = words.pop()?;
    let known = KNOWN_SOURCES.iter().any(|s| s.eq_ignore_ascii_case(source)) || sources.iter().any(|s| s.eq_ignore_ascii_case(source));
    if !known {
        return None;
    }
    let available = words.pop()?;
    let mut version = words.pop()?.to_string();
    // « < 1.2.3 » : version mal connue, écrite en deux morceaux.
    if words.last().is_some_and(|w| *w == "<" || *w == ">") {
        version = format!("{} {version}", words.pop()?);
    }
    let id = words.pop()?;
    if words.is_empty() {
        return None;
    }
    Some([words.join(" "), id.to_string(), version, available.to_string(), source.to_string()])
}

/// Lit la sortie de `winget upgrade` (liste des mises à jour).
pub fn parse_upgrade_list(raw: &str) -> ListResult {
    let lines = clean_lines(raw);
    let mut result = ListResult::default();
    let mut table = 0usize;
    let mut i = 0;
    while i < lines.len() {
        if !is_rule(&lines[i]) {
            i += 1;
            continue;
        }
        // Le titre : la dernière ligne non vide avant les tirets.
        let Some(header) = lines[..i].iter().rev().find(|l| !l.trim().is_empty()) else {
            i += 1;
            continue;
        };
        let starts = column_starts(header);
        if starts.len() < 4 {
            i += 1;
            continue;
        }
        result.found_table = true;
        let has_source = starts.len() >= 5;
        let explicit = table > 0;
        table += 1;
        let mut sources: Vec<String> = Vec::new();
        i += 1;
        while i < lines.len() {
            let line = &lines[i];
            if line.trim().is_empty() || is_rule(line) {
                break;
            }
            let row = row_by_columns(line, &starts).or_else(|| row_by_words(line, has_source, &sources));
            let Some([name, id, version, available, source]) = row else { break };
            if id.ends_with('…') || !valid_id(&id) {
                result.skipped += 1;
            } else {
                if !source.is_empty() && !sources.contains(&source) {
                    sources.push(source.clone());
                }
                if !result.packages.iter().any(|p| p.id.eq_ignore_ascii_case(&id)) {
                    result.packages.push(build(name, id, version, available, source, explicit));
                }
            }
            i += 1;
        }
    }
    result
}

// ── Pendant une mise à jour ──────────────────────────────────────────────────

/// Où en est une mise à jour, lu dans la sortie au fil de l'eau.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// winget cherche l'appli, lit sa source.
    Prepare,
    /// L'installateur se télécharge.
    Download,
    /// L'installateur tourne.
    Install,
}

fn unit_factor(unit: &str) -> Option<f64> {
    let u = unit.trim().to_ascii_lowercase();
    match u.as_str() {
        "b" | "o" | "bytes" | "octets" => Some(1.0),
        "kb" | "ko" | "kib" | "kio" => Some(1024.0),
        "mb" | "mo" | "mib" | "mio" => Some(1024.0 * 1024.0),
        "gb" | "go" | "gib" | "gio" => Some(1024.0 * 1024.0 * 1024.0),
        _ => None,
    }
}

/// Un nombre écrit « 12.5 » ou « 12,5 ».
fn number(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse::<f64>().ok().filter(|n| n.is_finite() && *n >= 0.0)
}

/// Le pourcentage d'une barre de progression de winget, dans un morceau de
/// sortie : « ███▒▒▒  12.0 MB / 48.5 MB » ou « ███▒▒▒  42% ».
pub fn progress_pct(segment: &str) -> Option<f64> {
    let s = strip_ansi(segment);
    // « 42% » ou « 42 % »
    if let Some(p) = s.find('%') {
        let before: String = s[..p].trim_end().chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect::<Vec<_>>().into_iter().rev().collect();
        if let Some(n) = number(&before) {
            return Some(n.clamp(0.0, 100.0));
        }
    }
    // « 12.0 MB / 48.5 MB »
    let (left, right) = s.split_once('/')?;
    let lw: Vec<&str> = left.split_whitespace().collect();
    let rw: Vec<&str> = right.split_whitespace().collect();
    if lw.len() < 2 || rw.len() < 2 {
        return None;
    }
    let done = number(lw[lw.len() - 2])? * unit_factor(lw[lw.len() - 1])?;
    let total = number(rw[0])? * unit_factor(rw[1])?;
    if total <= 0.0 {
        return None;
    }
    Some((done / total * 100.0).clamp(0.0, 100.0))
}

/// La phase annoncée par une ligne de winget (dans toutes les langues qu'on
/// sait reconnaître ; sinon None et la phase ne change pas).
pub fn phase_of(line: &str) -> Option<Phase> {
    let l = line.to_lowercase();
    if is_progress_bar(line) || l.contains("download") || l.contains("téléchargement") || l.contains("herunterladen") || l.contains("descargando") {
        return Some(Phase::Download);
    }
    if l.contains("install") || l.contains("instalando") {
        return Some(Phase::Install);
    }
    None
}

// ── Le résultat ──────────────────────────────────────────────────────────────

/// Comment une mise à jour s'est terminée. Le front écrit la phrase (traduite).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Ok,
    /// Réussie, mais l'appli demande de redémarrer le PC.
    Reboot,
    /// Rien à faire : déjà à jour.
    UpToDate,
    /// Il faut les droits d'administrateur.
    Admin,
    /// Annulée (fenêtre de l'administrateur refusée, installateur fermé).
    Cancelled,
    /// L'appli est ouverte : la fermer puis réessayer.
    InUse,
    /// Une autre installation est en cours.
    Busy,
    DiskFull,
    Network,
    /// Le fichier téléchargé ne correspond pas à l'empreinte attendue.
    Hash,
    /// Bloquée par une stratégie de l'entreprise.
    Policy,
    /// Pas d'installateur pour ce PC (architecture, version de Windows).
    NoInstaller,
    /// winget ne trouve plus l'appli.
    NotFound,
    /// L'appli doit se mettre à jour elle-même (ou par une autre technique d'installation).
    Unsupported,
    /// Trop long : winget a été arrêté.
    Timeout,
    Failed,
}

impl Outcome {
    /// Une réussite (même avec redémarrage, ou déjà à jour) : l'appli sort de la liste.
    pub fn success(self) -> bool {
        matches!(self, Outcome::Ok | Outcome::Reboot | Outcome::UpToDate)
    }
}

/// Le code de sortie de winget (un HRESULT, négatif en i32) et sa sortie → le résultat.
pub fn outcome(code: Option<i32>, output: &str) -> Outcome {
    let Some(code) = code else { return Outcome::Failed };
    let c = code as u32;
    let text = output.to_lowercase();
    let says_reboot = ["restart", "reboot", "redémarr", "neustart", "reinici"].iter().any(|w| text.contains(w));
    match c {
        0 if says_reboot => Outcome::Reboot,
        0 => Outcome::Ok,
        // Codes MSI : redémarrage nécessaire / lancé.
        3010 | 1641 => Outcome::Reboot,
        0x8A15_0109..=0x8A15_010B => Outcome::Reboot,
        0x8A15_002B | 0x8A15_010D => Outcome::UpToDate,
        0x8A15_0019 | 0x8007_02E4 | 0x8007_0005 => Outcome::Admin,
        0x8A15_010C | 0x8007_04C7 | 0x8A15_0005 => Outcome::Cancelled,
        0x8A15_0101 | 0x8A15_0103 | 0x8A15_0111 => Outcome::InUse,
        0x8A15_0102 => Outcome::Busy,
        0x8A15_0105 | 0x8007_0070 => Outcome::DiskFull,
        0x8A15_0107 | 0x8A15_0008 => Outcome::Network,
        0x8A15_0011 => Outcome::Hash,
        0x8A15_010F | 0x8A15_001B | 0x8A15_001C => Outcome::Policy,
        0x8A15_0010 | 0x8A15_0113 => Outcome::NoInstaller,
        0x8A15_0014 => Outcome::NotFound,
        0x8A15_0114 => Outcome::Unsupported,
        _ if text.contains("administra") => Outcome::Admin,
        _ => Outcome::Failed,
    }
}

/// Le code tel que winget le documente (« 0x8A150101 »), pour le journal et l'infobulle.
pub fn code_hex(code: Option<i32>) -> String {
    code.map(|c| format!("0x{:08X}", c as u32)).unwrap_or_default()
}

/// winget est-il trop ancien pour `--disable-interactivity` ? (Arguments refusés.)
pub fn rejects_arguments(code: Option<i32>) -> bool {
    code.map(|c| c as u32) == Some(0x8A15_0002)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FR: &str = "\
   - \r   \\ \r   | \r                                                                                                                        \r\
Nom                                    ID                                Version        Disponible     Source\r\n\
--------------------------------------------------------------------------------------------------------------\r\n\
Mozilla Firefox (x64 fr)               Mozilla.Firefox                   128.0          129.0.1        winget\r\n\
Microsoft Visual Studio Code (User)    Microsoft.VisualStudioCode        1.91.0         1.92.1         winget\r\n\
7-Zip 23.01 (x64)                      7zip.7zip                         23.01          24.08          winget\r\n\
Notepad++ (64-bit x64)                 Notepad++.Notepad++               8.6.8          8.6.9          winget\r\n\
Microsoft Edge WebView2 Runtime        Microsoft.EdgeWebView2Runtime     < 127.0.2651   127.0.2651.98  winget\r\n\
5 mises à niveau disponibles.\r\n\
1 package(s) ont des numéros de version qui ne peuvent pas être déterminés. Utilisez --include-unknown pour afficher tous les résultats.\r\n";

    const EN_NARROW: &str = "\
Name                         Id                           Version    Available  Source\n\
--------------------------------------------------------------------------------------\n\
Visual Studio Community 2022 Microsoft.VisualStudio.2022… 17.10.4    17.10.5    winget\n\
Git                          Git.Git                      2.45.2     2.46.0     winget\n\
PowerToys (Preview) x64      Microsoft.PowerToys          0.82.1     0.83.0     winget\n\
Adobe Acrobat Reader DC (64… Adobe.Acrobat.Reader.64-bit  24.002.20… 24.002.21… winget\n\
4 upgrades available.\n\
\n\
The following packages have an upgrade available, but require explicit targeting for upgrade:\n\
Name     Id          Version Available Source\n\
---------------------------------------------\n\
Discord  Discord.Discord 1.0.9152 1.0.9156 winget\n";

    #[test]
    fn reads_a_french_list_with_spinner_and_footer() {
        let r = parse_upgrade_list(FR);
        assert!(r.found_table);
        let ids: Vec<&str> = r.packages.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["Mozilla.Firefox", "Microsoft.VisualStudioCode", "7zip.7zip", "Notepad++.Notepad++", "Microsoft.EdgeWebView2Runtime"]);
        let ff = &r.packages[0];
        assert_eq!((ff.name.as_str(), ff.version.as_str(), ff.available.as_str(), ff.source.as_str()), ("Mozilla Firefox (x64 fr)", "128.0", "129.0.1", "winget"));
        assert_eq!(r.packages[2].name, "7-Zip 23.01 (x64)");
        assert_eq!(r.packages[4].version, "< 127.0.2651");
        assert!(r.packages.iter().all(|p| !p.explicit && !p.truncated));
    }

    #[test]
    fn reads_an_english_list_with_cut_names_and_explicit_table() {
        let r = parse_upgrade_list(EN_NARROW);
        let ids: Vec<&str> = r.packages.iter().map(|p| p.id.as_str()).collect();
        // L'ID coupé (« Microsoft.VisualStudio.2022… ») est laissé de côté.
        assert_eq!(ids, ["Git.Git", "Microsoft.PowerToys", "Adobe.Acrobat.Reader.64-bit", "Discord.Discord"]);
        assert_eq!(r.skipped, 1);
        let adobe = &r.packages[2];
        assert!(adobe.truncated);
        assert_eq!(adobe.version, "24.002.20…");
        // Le second tableau, aux colonnes mal alignées : relu par la droite.
        let discord = &r.packages[3];
        assert!(discord.explicit);
        assert_eq!((discord.name.as_str(), discord.version.as_str(), discord.available.as_str()), ("Discord", "1.0.9152", "1.0.9156"));
    }

    #[test]
    fn wide_characters_count_twice() {
        // Le nom chinois prend 2 colonnes par caractère, comme chez winget.
        let text = "名称            ID              版本    可用    源\n\
--------------------------------------------------\n\
微信            Tencent.WeChat  3.9.10  3.9.11  winget\n";
        let r = parse_upgrade_list(text);
        assert_eq!(r.packages.len(), 1);
        assert_eq!(r.packages[0].name, "微信");
        assert_eq!(r.packages[0].id, "Tencent.WeChat");
    }

    #[test]
    fn no_upgrade_and_errors_give_an_empty_list() {
        for text in [
            "Aucun package installé ne correspond aux critères d'entrée.\r\n",
            "No installed package found matching input criteria.\n",
            "Failed in attempting to update the source: winget\nAn unexpected error occurred while executing the command:\n0x8a15000f : Data required by the source is missing\n",
            "",
        ] {
            let r = parse_upgrade_list(text);
            assert!(r.packages.is_empty(), "{text}");
            assert!(!r.found_table);
        }
    }

    #[test]
    fn footer_sentences_are_never_packages() {
        // Un tableau sans source connue au bout : la phrase n'est pas relue par les mots.
        let text = "Name Id      Version Available Source\n------------------------------------\nGit  Git.Git 2.40    2.41      winget\n2 package(s) have version numbers that cannot be determined winget-ish\n";
        let r = parse_upgrade_list(text);
        assert_eq!(r.packages.len(), 1);
    }

    #[test]
    fn ansi_and_carriage_returns_are_cleaned() {
        assert_eq!(strip_ansi("\u{1b}[2K\u{1b}[0GName\u{1b}[0m"), "Name");
        assert_eq!(strip_ansi("\u{1b}]0;titre\u{7}ok"), "ok");
        assert_eq!(clean_lines("  ██▒▒ 1 MB / 2 MB\r  ███▒ 2 MB / 2 MB\rSuccessfully installed"), vec!["Successfully installed"]);
        assert_eq!(clean_lines("Found Git [Git.Git]\r - \r"), vec!["Found Git [Git.Git]"]);
    }

    #[test]
    fn ids_are_checked() {
        for ok in ["Git.Git", "Notepad++.Notepad++", "7zip.7zip", "9NBLGGH4NNS1", "Adobe.Acrobat.Reader.64-bit", "Python.Python.3_12"] {
            assert!(valid_id(ok), "{ok}");
        }
        for bad in ["", "-h", "--all", ".git", "Git Git", "a;calc", "a&b", "a|b", "a\"b", "C:\\x", "a/b", "é.x", &"a".repeat(129)] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(valid_source("winget") && valid_source("msstore") && !valid_source("--x") && !valid_source("a b"));
    }

    #[test]
    fn ignored_list() {
        assert_eq!(parse_ignored("Git.Git\nMozilla.Firefox, git.git\n\n-bad x;y"), vec!["Git.Git", "Mozilla.Firefox", "x", "y"]);
        assert_eq!(with_ignored("Git.Git", "Mozilla.Firefox", true), "Git.Git\nMozilla.Firefox");
        assert_eq!(with_ignored("Git.Git\nMozilla.Firefox", "git.git", false), "Mozilla.Firefox");
        assert_eq!(with_ignored("", "--all", true), "");
        assert!(is_ignored(&parse_ignored("Git.Git"), "GIT.git"));
    }

    #[test]
    fn schedule() {
        assert!(!check_due("off", None, 1000));
        assert!(check_due("daily", None, 1000));
        assert!(!check_due("daily", Some(1000), 1000 + 3600));
        assert!(check_due("daily", Some(1000), 1000 + 24 * 3600));
        assert!(!check_due("weekly", Some(1000), 1000 + 6 * 24 * 3600));
        assert!(check_due("weekly", Some(1000), 1000 + 7 * 24 * 3600));
        assert!(!check_due("weird", Some(0), u64::MAX));
    }

    #[test]
    fn progress_is_read() {
        assert_eq!(progress_pct("  ██████▒▒▒▒▒▒  12.0 MB / 48.0 MB"), Some(25.0));
        assert_eq!(progress_pct("  ██▒▒  512 KB / 1,00 MB"), Some(50.0));
        assert_eq!(progress_pct("  ███████▒▒▒  70%"), Some(70.0));
        assert_eq!(progress_pct("  ███████▒▒▒  70 %"), Some(70.0));
        assert_eq!(progress_pct("Found Git [Git.Git] Version 2.46.0"), None);
        assert_eq!(progress_pct("a / b"), None);
        assert_eq!(phase_of("Téléchargement en cours https://…"), Some(Phase::Download));
        assert_eq!(phase_of("Downloading https://github.com/…"), Some(Phase::Download));
        assert_eq!(phase_of("Démarrage de l'installation du package..."), Some(Phase::Install));
        assert_eq!(phase_of("Starting package install..."), Some(Phase::Install));
        assert_eq!(phase_of("Found Git [Git.Git]"), None);
    }

    #[test]
    fn outcomes() {
        let neg = |c: u32| Some(c as i32);
        assert_eq!(outcome(Some(0), "Successfully installed"), Outcome::Ok);
        assert_eq!(outcome(Some(0), "Installé correctement. Redémarrez l'application pour terminer la mise à niveau."), Outcome::Reboot);
        assert_eq!(outcome(Some(0), "Restart your PC to finish installation."), Outcome::Reboot);
        assert_eq!(outcome(Some(3010), ""), Outcome::Reboot);
        assert_eq!(outcome(neg(0x8A15_0109), ""), Outcome::Reboot);
        assert_eq!(outcome(neg(0x8A15_002B), ""), Outcome::UpToDate);
        assert_eq!(outcome(neg(0x8A15_0019), ""), Outcome::Admin);
        assert_eq!(outcome(neg(0x8007_04C7), ""), Outcome::Cancelled);
        assert_eq!(outcome(neg(0x8A15_0101), ""), Outcome::InUse);
        assert_eq!(outcome(neg(0x8A15_0107), ""), Outcome::Network);
        assert_eq!(outcome(neg(0x8A15_0011), ""), Outcome::Hash);
        assert_eq!(outcome(neg(0x8A15_010F), ""), Outcome::Policy);
        assert_eq!(outcome(neg(0x8A15_0014), ""), Outcome::NotFound);
        assert_eq!(outcome(neg(0x1234), "Le programme d'installation demande des droits d'administrateur"), Outcome::Admin);
        assert_eq!(outcome(neg(0x1234), "oops"), Outcome::Failed);
        assert_eq!(outcome(None, ""), Outcome::Failed);
        assert!(Outcome::Reboot.success() && Outcome::UpToDate.success() && !Outcome::Admin.success());
        assert_eq!(code_hex(neg(0x8A15_0101)), "0x8A150101");
        assert!(rejects_arguments(neg(0x8A15_0002)));
    }
}
