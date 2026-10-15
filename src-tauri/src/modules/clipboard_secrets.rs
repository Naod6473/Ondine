// Presse-papiers → « Ignorer les clés et jetons » (1.2.5) : reconnaître une
// copie qui ressemble à une clé d'API, un jeton ou une clé privée, pour ne pas
// la garder dans l'historique (ni donc dans la recherche du Lanceur), ni
// l'envoyer sur mes autres PC (Équipe), ni l'afficher dans un halo.
//
// Idée reprise de winbar (laurennguyen1304, MIT) ; motifs et code réécrits ici,
// sans le crate `regex` : chaque famille est une petite fonction (préfixe,
// longueur minimale, alphabet), ce qui se lit et se teste facilement.
//
// Règle contre les faux positifs : on ne regarde que la copie ENTIÈRE, une
// fois retirés les emballages courants (espaces autour, `export `, `NOM=`,
// `"nom": "…",`, `Authorization: Bearer …`, guillemets). S'il reste des espaces,
// c'est du texte normal : on garde la copie, même si une clé est au milieu
// d'une phrase. Seule exception : un bloc « -----BEGIN … PRIVATE KEY----- »
// suivi d'un vrai contenu, où qu'il soit dans la copie.
//
// Cette logique est pure (pas d'accès au presse-papiers) et ne renvoie que la
// FAMILLE reconnue, jamais le texte : c'est tout ce qui peut aller dans une
// notification ; rien ne va dans le journal.

/// Ce que la copie semble être.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    Anthropic,
    OpenAi,
    GitHub,
    GitLab,
    Aws,
    Google,
    Slack,
    Stripe,
    Npm,
    HuggingFace,
    Jwt,
    PrivateKey,
    Connection,
}

impl SecretKind {
    /// Identifiant stable pour le front (pas de texte copié dedans).
    pub fn id(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
            Self::GitHub => "github",
            Self::GitLab => "gitlab",
            Self::Aws => "aws",
            Self::Google => "google",
            Self::Slack => "slack",
            Self::Stripe => "stripe",
            Self::Npm => "npm",
            Self::HuggingFace => "huggingface",
            Self::Jwt => "jwt",
            Self::PrivateKey => "private-key",
            Self::Connection => "connection",
        }
    }

    /// Le front sait-il décoder ce genre de copie (decode.ts) ? Seulement le JWT.
    pub fn decodable(self) -> bool {
        self == Self::Jwt
    }
}

/// La copie ressemble-t-elle à une clé ou un jeton ? Laquelle ?
pub fn detect(text: &str) -> Option<SecretKind> {
    if has_private_key_block(text) {
        return Some(SecretKind::PrivateKey);
    }
    let t = unwrap(text)?;
    if anthropic(t) {
        Some(SecretKind::Anthropic)
    } else if openai(t) {
        Some(SecretKind::OpenAi)
    } else if github(t) {
        Some(SecretKind::GitHub)
    } else if gitlab(t) {
        Some(SecretKind::GitLab)
    } else if aws(t) {
        Some(SecretKind::Aws)
    } else if google(t) {
        Some(SecretKind::Google)
    } else if slack(t) {
        Some(SecretKind::Slack)
    } else if stripe(t) {
        Some(SecretKind::Stripe)
    } else if npm(t) {
        Some(SecretKind::Npm)
    } else if huggingface(t) {
        Some(SecretKind::HuggingFace)
    } else if jwt(t) {
        Some(SecretKind::Jwt)
    } else if connection(t) {
        Some(SecretKind::Connection)
    } else {
        None
    }
}

// ── L'emballage ──────────────────────────────────────────────────────────────

/// Au-delà, ce n'est plus « une clé » (un JWT très chargé fait quelques Ko).
const MAX_TOKEN: usize = 16_384;

/// Le jeton seul, débarrassé de ce qui l'entoure souvent quand on le copie
/// depuis un fichier .env, du JSON, du YAML ou un en-tête HTTP. None : il reste
/// des espaces (du texte normal), ou rien.
fn unwrap(text: &str) -> Option<&str> {
    let mut t = text.trim();
    if t.is_empty() || t.len() > MAX_TOKEN || t.contains('\n') {
        return None;
    }
    t = t.strip_prefix("export ").map(str::trim_start).unwrap_or(t);
    t = t.trim_end_matches([',', ';']);
    // NOM=valeur, NOM: valeur, "nom": "valeur" (le deux-points doit être suivi
    // d'une espace : sinon « postgres://… » perdrait son schéma).
    if let Some(rest) = assignment_value(t) {
        t = rest;
    }
    t = strip_quotes(t);
    for bearer in ["Bearer ", "bearer ", "BEARER ", "token ", "Token "] {
        if let Some(rest) = t.strip_prefix(bearer) {
            t = rest.trim_start();
            break;
        }
    }
    t = strip_quotes(t);
    (!t.is_empty() && !t.chars().any(char::is_whitespace)).then_some(t)
}

/// La valeur de `NOM=…`, `NOM: …` ou `"NOM": …` (NOM : lettres, chiffres, _ . -).
fn assignment_value(t: &str) -> Option<&str> {
    let (name, rest) = match t.strip_prefix(['"', '\'']) {
        Some(inner) => {
            let end = inner.find(['"', '\''])?;
            (&inner[..end], &inner[end + 1..])
        }
        None => {
            let end = t.find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')))?;
            (&t[..end], &t[end..])
        }
    };
    let first = name.chars().next()?;
    if !(first.is_ascii_alphabetic() || first == '_') || !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')) {
        return None;
    }
    let rest = rest.trim_start();
    if let Some(v) = rest.strip_prefix('=') {
        return Some(v.trim_start());
    }
    let v = rest.strip_prefix(':')?;
    v.starts_with(char::is_whitespace).then(|| v.trim_start())
}

/// Retire une paire de guillemets (", ' ou `) autour du texte.
fn strip_quotes(t: &str) -> &str {
    for q in ['"', '\'', '`'] {
        if t.len() >= 2 && t.starts_with(q) && t.ends_with(q) {
            return &t[1..t.len() - 1];
        }
    }
    t
}

// ── Petits tests de caractères ───────────────────────────────────────────────

fn all(s: &str, ok: impl Fn(char) -> bool) -> bool {
    s.chars().all(ok)
}
fn alnum(c: char) -> bool {
    c.is_ascii_alphanumeric()
}
/// Lettres, chiffres, _ et - (Base64 « URL »).
fn url_safe(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}
fn has_digit(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_digit())
}
fn has_letter(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_alphabetic())
}
/// Mélange de minuscules, majuscules et chiffres : ce qu'a un vrai jeton tiré au
/// hasard, et pas un identifiant ou un mot composé.
fn random_looking(s: &str) -> bool {
    has_digit(s) && s.chars().any(|c| c.is_ascii_lowercase()) && s.chars().any(|c| c.is_ascii_uppercase())
}

// ── Les familles ─────────────────────────────────────────────────────────────
// Les longueurs minimales sont prises un peu sous celles des vraies clés, pour
// suivre les variantes, mais assez haut pour ne pas prendre un mot.

/// sk-ant-api03-… (Anthropic) : au moins 32 caractères après « sk-ant- ».
fn anthropic(t: &str) -> bool {
    t.strip_prefix("sk-ant-").is_some_and(|b| b.len() >= 32 && all(b, url_safe) && has_digit(b) && has_letter(b))
}

/// sk-proj-…, sk-svcacct-…, sk-admin-… (OpenAI), ou l'ancien sk-… (48 caractères).
fn openai(t: &str) -> bool {
    for prefix in ["sk-proj-", "sk-svcacct-", "sk-admin-"] {
        if let Some(b) = t.strip_prefix(prefix) {
            return b.len() >= 32 && all(b, url_safe) && has_digit(b) && has_letter(b);
        }
    }
    // Préfixe court : on exige en plus un vrai mélange (pas « sk-learn-… »).
    t.strip_prefix("sk-").is_some_and(|b| b.len() >= 32 && all(b, url_safe) && random_looking(b))
}

/// ghp_ gho_ ghu_ ghs_ ghr_ + 36 caractères, ou github_pat_ + au moins 40.
fn github(t: &str) -> bool {
    if let Some(b) = t.strip_prefix("github_pat_") {
        return b.len() >= 40 && all(b, |c| alnum(c) || c == '_') && has_digit(b);
    }
    ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"]
        .iter()
        .any(|p| t.strip_prefix(p).is_some_and(|b| (36..=255).contains(&b.len()) && all(b, alnum) && has_letter(b)))
}

/// glpat- + au moins 20 caractères (GitLab).
fn gitlab(t: &str) -> bool {
    t.strip_prefix("glpat-").is_some_and(|b| b.len() >= 20 && all(b, url_safe))
}

/// AKIA / ASIA + 16 majuscules ou chiffres (identifiant de clé AWS), avec au
/// moins un chiffre (« ASIAPACIFICREGIONSXY » n'en est pas une).
fn aws(t: &str) -> bool {
    t.len() == 20
        && (t.starts_with("AKIA") || t.starts_with("ASIA"))
        && all(&t[4..], |c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && has_digit(&t[4..])
}

/// AIza + 35 caractères (clé d'API Google).
fn google(t: &str) -> bool {
    t.strip_prefix("AIza").is_some_and(|b| b.len() == 35 && all(b, url_safe))
}

/// xoxa- xoxb- xoxp- xoxr- xoxs- (Slack) : des groupes de chiffres et de lettres.
fn slack(t: &str) -> bool {
    let Some(rest) = t.strip_prefix("xox") else { return false };
    let mut chars = rest.chars();
    matches!(chars.next(), Some('a' | 'b' | 'p' | 'r' | 's'))
        && chars.next() == Some('-')
        && {
            let b = &rest[2..];
            b.len() >= 20 && all(b, |c| alnum(c) || c == '-') && has_digit(b)
        }
}

/// sk_live_ / rk_live_ + au moins 24 caractères (Stripe, clés réelles).
fn stripe(t: &str) -> bool {
    ["sk_live_", "rk_live_"].iter().any(|p| t.strip_prefix(p).is_some_and(|b| b.len() >= 24 && all(b, alnum)))
}

/// npm_ + 36 caractères (jeton npm).
fn npm(t: &str) -> bool {
    t.strip_prefix("npm_").is_some_and(|b| (36..=64).contains(&b.len()) && all(b, alnum) && has_letter(b))
}

/// hf_ + au moins 30 lettres (Hugging Face), majuscules et minuscules mêlées
/// (pas « hf_hub_download »).
fn huggingface(t: &str) -> bool {
    t.strip_prefix("hf_").is_some_and(|b| {
        b.len() >= 30 && all(b, alnum) && b.chars().any(|c| c.is_ascii_lowercase()) && b.chars().any(|c| c.is_ascii_uppercase())
    })
}

/// eyJ….eyJ….signature : un JWT signé (en-tête et contenu sont du JSON en
/// Base64 URL, d'où « eyJ » = « {" »).
fn jwt(t: &str) -> bool {
    let parts: Vec<&str> = t.split('.').collect();
    let &[head, body, sig] = parts.as_slice() else { return false };
    head.starts_with("eyJ")
        && body.starts_with("eyJ")
        && head.len() >= 16
        && body.len() >= 16
        && sig.len() >= 16
        && [head, body, sig].iter().all(|p| all(p, url_safe))
}

/// Mots de passe d'exemple : une adresse de documentation n'est pas un secret.
const PLACEHOLDERS: &[&str] = &["password", "pass", "passwd", "pwd", "secret", "motdepasse", "mdp", "changeme"];

/// schema://utilisateur:motdepasse@hôte… (base de données, file de messages,
/// lien avec identifiants). Il faut un vrai mot de passe, pas « password » ni
/// « ${DB_PASS} ».
fn connection(t: &str) -> bool {
    let Some((scheme, rest)) = t.split_once("://") else { return false };
    let mut sc = scheme.chars();
    if scheme.len() < 2 || !sc.next().is_some_and(|c| c.is_ascii_alphabetic()) || !sc.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
        return false;
    }
    let authority = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
    let Some(at) = authority.rfind('@') else { return false };
    let (userinfo, host) = (&authority[..at], &authority[at + 1..]);
    let Some((_user, pass)) = userinfo.split_once(':') else { return false };
    let host_ok = !host.is_empty() && host.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '[');
    let placeholder = PLACEHOLDERS.contains(&pass.to_ascii_lowercase().as_str())
        || pass.starts_with(['$', '<', '{', '['])
        || pass.chars().all(|c| c == '*' || c == 'x' || c == 'X' || c == '.');
    host_ok && !pass.is_empty() && !placeholder
}

/// Un bloc « -----BEGIN … PRIVATE KEY----- » suivi d'au moins 64 caractères
/// Base64 (une ligne de documentation qui ne fait que citer l'en-tête ne compte
/// pas).
fn has_private_key_block(text: &str) -> bool {
    let mut rest = text;
    while let Some(i) = rest.find("-----BEGIN ") {
        let after = &rest[i + 11..];
        let Some(end) = after.find("-----") else { return false };
        let label = &after[..end];
        let body = &after[end + 5..];
        if label.len() <= 60 && label.contains("PRIVATE KEY") {
            let content = &body[..body.find("-----END").unwrap_or(body.len())];
            // Les lignes « Proc-Type: … » d'une clé chiffrée à l'ancienne ne comptent pas.
            let b64 = content
                .lines()
                .filter(|l| !l.contains(':'))
                .flat_map(str::chars)
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
                .count();
            if b64 >= 64 {
                return true;
            }
        }
        rest = body;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use SecretKind::*;

    // Les fausses clés sont fabriquées ici, morceau par morceau : aucune ne
    // figure en entier dans le code source (les analyseurs de secrets des
    // forges ne s'en inquiètent pas, et ce ne sont pas de vraies clés).
    fn rnd(n: usize) -> String {
        "aB3xK9mQ7pZ2".chars().cycle().take(n).collect()
    }
    fn k(prefix: &str, n: usize) -> String {
        format!("{prefix}{}", rnd(n))
    }
    fn jwt_sample() -> String {
        // {"alg":"HS256","typ":"JWT"} . {"sub":"1234567890","name":"Simon"} . signature
        format!("{}.{}.{}", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlNpbW9uIn0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")
    }
    fn pem(label: &str, lines: usize) -> String {
        let body: Vec<String> = (0..lines).map(|_| rnd(64)).collect();
        format!("-----BEGIN {label}-----\n{}\n-----END {label}-----", body.join("\n"))
    }

    #[test]
    fn recognizes_each_family() {
        let cases = [
            (k("sk-ant-api03-", 93), Anthropic),
            (k("sk-proj-", 120), OpenAi),
            (k("sk-svcacct-", 60), OpenAi),
            (k("sk-", 48), OpenAi),
            (k("ghp_", 36), GitHub),
            (k("gho_", 36), GitHub),
            (k("ghu_", 36), GitHub),
            (k("ghs_", 36), GitHub),
            (k("ghr_", 36), GitHub),
            (format!("github_pat_{}_{}", rnd(22), rnd(59)), GitHub),
            (k("glpat-", 20), GitLab),
            (format!("AKIA{}", "IOSFODNN7EXAMPLE"), Aws),
            (format!("ASIA{}", "Y34FZKBOKMUTVV7A"), Aws),
            (k("AIza", 35), Google),
            (format!("xoxb-{}-{}-{}", "1234567890", "0987654321", rnd(24)), Slack),
            (format!("xoxp-{}-{}", "123456789012", rnd(32)), Slack),
            (k("sk_live_", 24), Stripe),
            (k("rk_live_", 99), Stripe),
            (k("npm_", 36), Npm),
            (format!("hf_{}", "AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGh"), HuggingFace),
            (jwt_sample(), Jwt),
            (format!("postgres://ondine:{}@db.exemple.fr:5432/prod", "Tr0ub4dor&3"), Connection),
            (format!("mongodb+srv://admin:{}@cluster0.abcd.mongodb.net/?retryWrites=true", "s3cr3tP4ss"), Connection),
            (format!("redis://:{}@localhost:6379/0", "Zx81Spectrum"), Connection),
            (format!("https://simon:{}@intranet.local/", "hunter22"), Connection),
            (pem("RSA PRIVATE KEY", 4), PrivateKey),
            (pem("OPENSSH PRIVATE KEY", 3), PrivateKey),
            (pem("PRIVATE KEY", 2), PrivateKey),
            (pem("EC PRIVATE KEY", 2), PrivateKey),
        ];
        for (text, kind) in cases {
            assert_eq!(detect(&text), Some(kind), "{kind:?} attendu");
        }
    }

    #[test]
    fn unwraps_common_wrappers() {
        let key = k("sk-ant-api03-", 93);
        for text in [
            format!("  {key}\n"),
            format!("\"{key}\""),
            format!("'{key}'"),
            format!("`{key}`"),
            format!("ANTHROPIC_API_KEY={key}"),
            format!("export ANTHROPIC_API_KEY=\"{key}\""),
            format!("ANTHROPIC_API_KEY = {key}"),
            format!("\"api_key\": \"{key}\","),
            format!("api_key: {key}"),
            format!("x-api-key: {key}"),
        ] {
            assert_eq!(detect(&text), Some(Anthropic), "emballage non retiré");
        }
        let jwt = jwt_sample();
        assert_eq!(detect(&format!("Bearer {jwt}")), Some(Jwt));
        assert_eq!(detect(&format!("Authorization: Bearer {jwt}")), Some(Jwt));
        assert_eq!(detect(&format!("DATABASE_URL=postgres://u:{}@h/db", "Kq8!zz91")), Some(Connection));
    }

    #[test]
    fn private_key_block_anywhere() {
        let text = format!("Voici la clé du serveur :\n\n{}\n\nMerci de ne pas la diffuser.", pem("RSA PRIVATE KEY", 3));
        assert_eq!(detect(&text), Some(PrivateKey));
        // Clé chiffrée à l'ancienne : en-têtes puis contenu.
        let enc = format!("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,ABCDEF\n\n{}\n-----END RSA PRIVATE KEY-----", rnd(128));
        assert_eq!(detect(&enc), Some(PrivateKey));
    }

    #[test]
    fn ordinary_text_is_kept() {
        let long_b64_png = format!("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk{}", "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        let not_secrets = [
            // Phrases (même avec une clé au milieu : pas « essentiellement » la clé).
            "Bonjour Simon, on se voit demain à 14 h ?".to_string(),
            "La clé commence par sk-ant- puis une longue suite de caractères.".to_string(),
            format!("Ma clé est {} mais ne la partage pas", k("sk-ant-api03-", 93)),
            "Mot de passe : password".to_string(),
            // Adresses ordinaires.
            "https://www.exemple.fr/articles/2026/10/une-page?id=42#haut".to_string(),
            "https://user@github.com/simon/ondine.git".to_string(),
            "ssh://git@github.com/simon/ondine.git".to_string(),
            "git@github.com:simon/ondine.git".to_string(),
            "https://exemple.fr/chemin?q=a:b@c".to_string(),
            "postgres://user:password@localhost:5432/db".to_string(),
            "postgres://user:${DB_PASSWORD}@localhost/db".to_string(),
            "mysql://root:****@127.0.0.1/test".to_string(),
            "C:\\Users\\Simon\\Documents\\clé.txt".to_string(),
            // Identifiants qui ressemblent de loin.
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_string(), // hash git
            "787a144".to_string(),
            "123e4567-e89b-12d3-a456-426614174000".to_string(), // UUID
            "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08".to_string(),
            long_b64_png,
            "SGVsbG8gZGUgbGEgcGFydCBkJ09uZGluZSAh".to_string(), // Base64 de texte
            "sk-learn-is-a-python-library-for-machine-learning".to_string(),
            "sk-1234".to_string(),
            "ghp_court".to_string(),
            "ghp_".to_string(),
            "hf_hub_download".to_string(),
            "hf_".to_string() + "abcdefghijklmnopqrstuvwxyzabcdefgh", // pas de majuscule
            "AKIA".to_string(),
            "ASIAPACIFICREGIONSXY".to_string(), // 20 caractères mais sans chiffre
            "AKIA".to_string() + "IOSFODNN7EXAMPL",  // 19 caractères
            "AIzaTropCourt".to_string(),
            "xoxb-123".to_string(),
            "sk_test_".to_string() + &rnd(24), // clé de test Stripe : pas dans la liste
            "npm_install_package".to_string(),
            "eyJhbGciOiJIUzI1NiJ9".to_string(), // un en-tête seul
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.".to_string(), // pas de signature
            "fichier.version.2026".to_string(),
            "-----BEGIN RSA PRIVATE KEY-----".to_string(), // l'en-tête cité seul
            "-----BEGIN CERTIFICATE-----\n".to_string() + &rnd(256) + "\n-----END CERTIFICATE-----",
            "-----BEGIN PUBLIC KEY-----\n".to_string() + &rnd(256) + "\n-----END PUBLIC KEY-----",
            "TOKEN=".to_string(),
            "".to_string(),
            "   ".to_string(),
        ];
        for text in &not_secrets {
            assert_eq!(detect(text), None, "faux positif sur une copie de {} caractères", text.len());
        }
    }

    #[test]
    fn multi_line_text_is_not_a_token() {
        let key = k("ghp_", 36);
        assert_eq!(detect(&format!("{key}\nautre ligne")), None);
        assert_eq!(detect(&format!("{key}\n")), Some(GitHub));
    }

    #[test]
    fn ids_and_decodable() {
        assert_eq!(Jwt.id(), "jwt");
        assert!(Jwt.decodable());
        assert!(!GitHub.decodable());
        assert_eq!(PrivateKey.id(), "private-key");
    }
}
