// La recherche commune à l'île (« Recherche dans l'île », dans le Lanceur).
//
// Chaque module qui a des données à lui (Notes, Presse-papiers, Étagère,
// Capture) a une commande "search" qui se sert de ces fonctions :
//   - `normalize` : minuscules, accents retirés, espaces regroupés
//     (« Éléphant  ROSE » → « elephant rose ») ;
//   - `score` : une note de 0 à 100 selon où la recherche se trouve dans le texte ;
//   - `best` : garde les meilleurs résultats (5 par source), les plus récents
//     d'abord à note égale ;
//   - `excerpt` : un court extrait autour de ce qui a été trouvé.
//
// Rien n'est écrit dans le journal ni envoyé sur le bus : les résultats
// reviennent seulement au front qui les a demandés.

use serde_json::Value;

/// Nombre de résultats par source, par défaut et au plus.
pub const PER_SOURCE: usize = 5;
const MAX_PER_SOURCE: usize = 10;
/// Une recherche plus longue est coupée (personne ne tape 200 caractères).
const MAX_QUERY_CHARS: usize = 100;

/// Une lettre accentuée → sa lettre de base (après passage en minuscules).
/// Les lettres sans accent sont rendues telles quelles.
fn fold(c: char) -> &'static str {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
        'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' => "c",
        'ď' | 'đ' => "d",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
        'ñ' | 'ń' | 'ň' | 'ņ' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
        'ý' | 'ÿ' | 'ŷ' => "y",
        'ś' | 'š' | 'ş' => "s",
        'ź' | 'ż' | 'ž' => "z",
        'ř' => "r",
        'ł' => "l",
        'ğ' => "g",
        'ť' | 'ţ' => "t",
        'œ' => "oe",
        'æ' => "ae",
        'ß' => "ss",
        // Apostrophe courbe → droite : « l’été » se trouve en tapant « l'ete ».
        '\u{2019}' | '\u{2018}' => "'",
        _ => "",
    }
}

/// Les accents « détachés » (une lettre suivie d'un accent à part) : on les retire.
fn is_combining(c: char) -> bool {
    ('\u{0300}'..='\u{036f}').contains(&c)
}

/// Ajoute la forme cherchable de `c` à `out` (rien pour un accent détaché,
/// une seule espace pour une suite de blancs).
fn push_folded(out: &mut String, c: char) {
    if is_combining(c) {
        return;
    }
    if c.is_whitespace() {
        if !out.is_empty() && !out.ends_with(' ') {
            out.push(' ');
        }
        return;
    }
    for low in c.to_lowercase() {
        match fold(low) {
            "" => out.push(low),
            base => out.push_str(base),
        }
    }
}

/// « Éléphant  ROSE » → « elephant rose » : minuscules, sans accents, un seul
/// espace entre deux mots, sans espace au début ni à la fin.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        push_folded(&mut out, c);
    }
    out.trim_end().to_string()
}

/// Ce qui sépare deux mots pour « un mot commence par… ».
fn is_separator(c: char) -> bool {
    !c.is_alphanumeric()
}

/// Les mots d'un texte déjà normalisé.
fn words(n: &str) -> impl Iterator<Item = &str> {
    n.split(is_separator).filter(|w| !w.is_empty())
}

/// Note de 0 (absent) à 100 (le texte commence par la recherche), sans tenir
/// compte des majuscules ni des accents. `query` doit déjà être normalisée.
///   100 → le texte commence par la recherche (« fact » → « Facture EDF »)
///    80 → un mot commence par la recherche (« edf » → « Facture EDF »)
///    70 → chaque mot tapé commence un mot du texte (« fac oct » → « Facture d'octobre »)
///    60 → contenu au milieu d'un mot (« ture » → « Facture »)
///    40 → chaque mot tapé est quelque part dans le texte, dans le désordre
pub fn score(text: &str, query: &str) -> u32 {
    if query.is_empty() {
        return 0;
    }
    let n = normalize(text);
    if n.starts_with(query) {
        return 100;
    }
    // Un mot qui commence par la recherche : la recherche suit un séparateur.
    let mut from = 0;
    let mut contained = false;
    while let Some(pos) = n[from..].find(query) {
        let at = from + pos;
        contained = true;
        if n[..at].chars().next_back().is_some_and(is_separator) {
            return 80;
        }
        from = at + n[at..].chars().next().map_or(1, char::len_utf8);
    }
    let parts: Vec<&str> = query.split(' ').filter(|p| !p.is_empty()).collect();
    if parts.len() > 1 && parts.iter().all(|p| words(&n).any(|w| w.starts_with(p))) {
        return 70;
    }
    if contained {
        return 60;
    }
    if parts.len() > 1 && parts.iter().all(|p| n.contains(p)) {
        return 40;
    }
    0
}

/// La meilleure note entre un titre et un texte plus long : trouver la
/// recherche dans le titre (nom de fichier, première ligne d'une note) compte
/// plus que la trouver dans le reste.
pub fn score_titled(title: &str, body: &str, query: &str) -> u32 {
    let in_title = score(title, query);
    let in_body = score(body, query).saturating_sub(15);
    in_title.max(in_body)
}

/// Un résultat trouvé par un module, avant le tri.
pub struct Hit {
    pub score: u32,
    /// Date (ms depuis 1970) : à note égale, le plus récent passe devant.
    pub at: u64,
    /// Ce que le front reçoit (id, titre, extrait…).
    pub value: Value,
}

/// Les `limit` meilleurs résultats (note décroissante, puis du plus récent au
/// plus ancien). Les résultats à 0 sont écartés.
pub fn best(mut hits: Vec<Hit>, limit: usize) -> Vec<Value> {
    hits.retain(|h| h.score > 0);
    hits.sort_by(|a, b| b.score.cmp(&a.score).then(b.at.cmp(&a.at)));
    hits.into_iter().take(limit).map(|h| h.value).collect()
}

/// La recherche et le nombre de résultats voulus, lus dans les paramètres
/// d'une commande "search" (`{ query, limit }`). La recherche est normalisée.
pub fn args(args: &Value) -> (String, usize) {
    let raw = args.get("query").and_then(Value::as_str).unwrap_or("");
    let cut: String = raw.chars().take(MAX_QUERY_CHARS).collect();
    let limit = args.get("limit").and_then(Value::as_u64).map_or(PER_SOURCE, |n| n as usize).clamp(1, MAX_PER_SOURCE);
    (normalize(&cut), limit)
}

/// Un extrait d'environ `width` caractères autour de la première apparition de
/// `query` (déjà normalisée) dans `text`, sur une seule ligne. Sans
/// apparition : le début du texte.
pub fn excerpt(text: &str, query: &str, width: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    // On normalise caractère par caractère en notant, pour chaque octet du
    // texte normalisé, de quel caractère d'origine il vient.
    let mut norm = String::new();
    let mut origin: Vec<usize> = Vec::new();
    for (i, &c) in chars.iter().enumerate() {
        let before = norm.len();
        push_folded(&mut norm, c);
        origin.extend(std::iter::repeat_n(i, norm.len() - before));
    }
    let hit = if query.is_empty() { None } else { norm.find(query).map(|b| origin[b]) };
    let start = match hit {
        // Un peu de contexte avant ce qui a été trouvé.
        Some(i) => i.saturating_sub(width / 4),
        None => 0,
    };
    let end = (start + width).min(chars.len());
    // Le morceau, avec les retours à la ligne et les suites de blancs remplacés par une espace.
    let mut piece = String::new();
    for &c in &chars[start..end] {
        if c.is_whitespace() {
            if !piece.ends_with(' ') {
                piece.push(' ');
            }
        } else {
            piece.push(c);
        }
    }
    let piece = piece.trim();
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        piece,
        if end < chars.len() { "…" } else { "" }
    )
}

/// 6, 10, 2026 → « 6 octobre 2026 » : pour trouver une capture en tapant le mois.
pub fn french_date(year: i32, month: u32, day: u32) -> String {
    const MONTHS: [&str; 12] = [
        "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    ];
    let name = MONTHS.get(month.saturating_sub(1) as usize).copied().unwrap_or("");
    format!("{day} {name} {year}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accents_and_case_are_ignored() {
        assert_eq!(normalize("Éléphant ROSE"), "elephant rose");
        assert_eq!(normalize("  Noël à Würzburg  "), "noel a wurzburg");
        assert_eq!(normalize("Œuvre, cœur, Straße"), "oeuvre, coeur, strasse");
        // Accent « détaché » (e + accent aigu à part) : même résultat.
        assert_eq!(normalize("e\u{0301}te\u{0301}"), "ete");
        // Les blancs (retours à la ligne, tabulations) deviennent une seule espace.
        assert_eq!(normalize("ligne 1\n\n\tligne 2"), "ligne 1 ligne 2");
        assert_eq!(normalize("L’été"), "l'ete");
    }

    #[test]
    fn query_matches_whatever_the_accents() {
        let q = normalize("ETE");
        assert!(score("Vacances d'été", &q) > 0);
        assert!(score("Résumé", &normalize("resume")) > 0);
        assert!(score("resume", &normalize("Résumé")) > 0);
        assert_eq!(score("Hiver", &q), 0);
    }

    #[test]
    fn ranking_order() {
        let q = "fact";
        let start = score("Facture EDF", q);
        let word = score("Ma facture EDF", q);
        let inside = score("Artefact", q);
        assert_eq!(start, 100);
        assert_eq!(word, 80);
        assert_eq!(inside, 60);
        // Plusieurs mots : chacun commence un mot, ou est quelque part.
        assert_eq!(score("Facture d'octobre", "fac oct"), 70);
        assert_eq!(score("Artefact d'automne", "fact tomn"), 40);
        assert_eq!(score("Facture", "fac zzz"), 0);
        assert_eq!(score("Facture", ""), 0);
    }

    #[test]
    fn title_counts_more_than_body() {
        let q = "devis";
        assert!(score_titled("Devis cuisine", "", q) > score_titled("Courses", "penser au devis", q));
        assert_eq!(score_titled("Courses", "rien", q), 0);
    }

    #[test]
    fn best_keeps_top_results_then_most_recent() {
        let hit = |id: u64, score: u32, at: u64| Hit { score, at, value: json!(id) };
        let hits = vec![hit(1, 60, 10), hit(2, 100, 5), hit(3, 0, 99), hit(4, 60, 20), hit(5, 80, 1), hit(6, 60, 30)];
        let top = best(hits, 3);
        assert_eq!(top, vec![json!(2), json!(5), json!(6)]);
    }

    #[test]
    fn args_are_bounded() {
        let (q, n) = args(&json!({ "query": "  Élan ", "limit": 500 }));
        assert_eq!((q.as_str(), n), ("elan", MAX_PER_SOURCE));
        let (q, n) = args(&json!({}));
        assert_eq!((q.as_str(), n), ("", PER_SOURCE));
        let (q, _) = args(&json!({ "query": "x".repeat(1000) }));
        assert_eq!(q.len(), MAX_QUERY_CHARS);
    }

    #[test]
    fn excerpt_around_the_match() {
        let text = "Liste de courses\nPain, lait, œufs\nAppeler le garage à 14 h pour la révision";
        let e = excerpt(text, &normalize("revision"), 30);
        assert!(e.contains("révision"), "{e}");
        assert!(e.starts_with('…'));
        assert!(!e.contains('\n'));
        assert_eq!(excerpt("court", "zzz", 30), "court");
        assert_eq!(excerpt("abcdef", "", 3), "abc…");
    }

    #[test]
    fn dates_in_french() {
        assert_eq!(french_date(2026, 10, 6), "6 octobre 2026");
        assert!(score(&french_date(2026, 8, 15), &normalize("aout")) > 0);
    }
}
