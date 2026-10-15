// « Parler à Ondine » (1.2.4) : les modèles locaux (Ollama, LM Studio, tout
// serveur compatible OpenAI) et OpenRouter. Tous parlent l'API « Chat
// Completions » d'OpenAI : `POST <adresse>/chat/completions`, et
// `GET <adresse>/models` pour la liste des modèles.
//
// Sécurité :
//   - l'adresse d'un serveur local est vérifiée (`server_base`) : http
//     seulement pour localhost, 127.0.0.1 ou ::1 (le PC lui-même) ; https
//     pour toute autre machine ; pas d'identifiant dans l'adresse, pas de
//     paramètres ; les redirections ne sont pas suivies ;
//   - la clé (OpenRouter, ou celle, facultative, d'un serveur compatible)
//     vient du Gestionnaire d'identifiants et ne sert qu'à l'en-tête ;
//   - la « réflexion » d'un modèle (<think>…</think>, `reasoning_content`)
//     est retirée de la réponse : elle n'est ni montrée ni gardée ;
//   - les outils d'Ondine ne sont proposés qu'aux modèles qui les gèrent : si
//     le serveur refuse les outils pour ce modèle, on refait la demande sans
//     eux (conversation simple) et on s'en souvient pour la suite.

use serde_json::{json, Value};

/// L'adresse d'OpenRouter.
pub const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";
/// L'adresse d'Ollama par défaut (son API compatible OpenAI).
pub const DEFAULT_LOCAL_BASE: &str = "http://localhost:11434/v1";

/// L'hôte est-il ce PC (localhost, 127.0.0.1, ::1) ?
pub fn is_loopback(host: &str) -> bool {
    matches!(host.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "[::1]")
}

/// Une adresse de serveur tapée dans les réglages → l'adresse de base (sans
/// « / » final) et son hôte (« localhost:11434 »), ou pourquoi elle est refusée.
pub fn server_base(raw: &str) -> Result<(String, String), String> {
    let s = raw.trim().trim_end_matches('/');
    let (scheme, rest) = s.split_once("://").ok_or("adresse du serveur invalide : elle doit commencer par http:// ou https://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("adresse du serveur invalide : http:// ou https:// seulement".into());
    }
    if rest.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '@' | '?' | '#' | '\\')) {
        return Err("adresse du serveur invalide : pas d'espace, d'identifiant (@), de « ? » ni de « # »".into());
    }
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    // L'hôte et le port : [::1]:1234, localhost:11434, serveur.exemple.fr.
    let (host, port) = if let Some(end) = authority.strip_prefix('[').and_then(|a| a.find(']')) {
        let host = &authority[..end + 2];
        (host, authority[end + 2..].strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (authority, None),
        }
    };
    let host_ok = !host.is_empty()
        && host.len() <= 253
        && (host.starts_with('[') || host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'))
        && !host.starts_with('.')
        && !host.starts_with('-');
    if !host_ok {
        return Err("adresse du serveur invalide : nom de machine illisible".into());
    }
    if host.starts_with('[') && host != "[::1]" {
        return Err("adresse du serveur invalide : une adresse IPv6 autre que [::1] n'est pas acceptée".into());
    }
    if let Some(p) = port {
        if p.parse::<u16>().ok().filter(|p| *p > 0).is_none() {
            return Err("adresse du serveur invalide : port illisible".into());
        }
    }
    if !path.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.')) || path.contains("..") {
        return Err("adresse du serveur invalide : chemin illisible".into());
    }
    if scheme == "http" && !is_loopback(host) {
        return Err("http:// n'est accepté que pour ce PC (localhost, 127.0.0.1 ou [::1]) : utilisez https:// pour une autre machine".into());
    }
    Ok((format!("{scheme}://{authority}{path}"), authority.to_ascii_lowercase()))
}

/// L'hôte d'une adresse « hôte:port » (« [::1]:8080 » → « [::1] »).
pub fn host_of(authority: &str) -> &str {
    match authority.find(']') {
        Some(end) => &authority[..=end],
        None => authority.split(':').next().unwrap_or(""),
    }
}

/// L'adresse (vérifiée) vise-t-elle ce PC ?
pub fn on_this_pc(url: &str) -> bool {
    server_base(url).is_ok_and(|(_, authority)| is_loopback(host_of(&authority)))
}

/// Un nom de modèle de serveur local ou d'OpenRouter (« llama3.2:3b »,
/// « openai/gpt-oss-20b », « lmstudio-community/qwen3-8b@q4_k_m ») : il part
/// dans le corps de la requête, jamais dans l'adresse.
pub fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 128 && m.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/' | '@' | '+'))
}

/// Les messages au format Chat Completions : la consigne, puis la conversation
/// (déjà mise en forme par askclaude_providers.rs), puis la suite d'un
/// échange (réponse avec appels d'outils, résultats).
pub fn body(model: &str, max_tokens: u64, system: &str, messages: Vec<Value>, extra: &[Value], tools: &[(&str, &str, &Value)]) -> Value {
    let mut all = vec![json!({ "role": "system", "content": system })];
    all.extend(messages);
    all.extend(extra.iter().cloned());
    let mut b = json!({ "model": model, "messages": all, "max_tokens": max_tokens, "stream": false });
    if !tools.is_empty() {
        b["tools"] = tools.iter().map(|(name, description, schema)| json!({ "type": "function", "function": { "name": name, "description": description, "parameters": schema } })).collect();
    }
    b
}

/// Retire la réflexion du modèle : les blocs <think>…</think> (et <thinking>),
/// même non refermés (réponse coupée : tout ce qui suit est de la réflexion).
pub fn strip_thinking(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(start) = ["<think>", "<thinking>"].iter().filter_map(|t| lower.find(t).map(|i| (i, *t))).min() else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start.0]);
        let close = if start.1 == "<think>" { "</think>" } else { "</thinking>" };
        match lower[start.0..].find(close) {
            Some(end) => rest = &rest[start.0 + end + close.len()..],
            None => break,
        }
    }
    out.trim().to_string()
}

/// Une réponse Chat Completions → la forme commune de Parler à Ondine
/// (`{answer, model, truncated, inputTokens, outputTokens, calls, native}`).
pub fn parse(v: &Value) -> Value {
    let msg = &v["choices"][0]["message"];
    let answer = strip_thinking(msg["content"].as_str().unwrap_or(""));
    let calls: Vec<Value> = msg["tool_calls"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            let name = c["function"]["name"].as_str().unwrap_or("");
            // Les arguments arrivent en texte JSON (parfois déjà en objet).
            let args = match &c["function"]["arguments"] {
                Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
                other => other.clone(),
            };
            json!({ "id": c["id"].as_str().filter(|i| !i.is_empty()).unwrap_or(name), "name": name, "args": args })
        })
        .collect();
    // À relire au tour suivant : le message de l'assistant, SANS sa réflexion.
    let native = if calls.is_empty() {
        vec![]
    } else {
        vec![json!({ "role": "assistant", "content": msg["content"].as_str().map(strip_thinking).unwrap_or_default(), "tool_calls": msg["tool_calls"] })]
    };
    json!({
        "answer": answer,
        "model": v["model"],
        "truncated": v["choices"][0]["finish_reason"] == "length",
        "inputTokens": v["usage"]["prompt_tokens"],
        "outputTokens": v["usage"]["completion_tokens"],
        "calls": calls,
        "native": native,
    })
}

/// Les résultats des outils, au format Chat Completions.
pub fn tool_results(results: &[(String, Value)]) -> Vec<Value> {
    results.iter().map(|(id, r)| json!({ "role": "tool", "tool_call_id": id, "content": r.to_string() })).collect()
}

/// Le serveur a-t-il refusé les outils pour ce modèle ? (Ollama : « does not
/// support tools » ; d'autres : « tools are not supported », « tool_choice »…)
pub fn refuses_tools(status: u16, v: &Value) -> bool {
    if !(400..500).contains(&status) {
        return false;
    }
    let text = v["error"]["message"].as_str().or_else(|| v["error"].as_str()).unwrap_or("").to_lowercase();
    text.contains("tool") && (text.contains("support") || text.contains("not allowed") || text.contains("unsupported"))
}

/// Un modèle de la liste du serveur : son nom, et s'il gère les outils (quand
/// le serveur le dit : OpenRouter, `supported_parameters`).
pub fn models(v: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = v["data"]
        .as_array()
        .or_else(|| v["models"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["id"].as_str().or_else(|| m["name"].as_str())?.trim();
            if !valid_model(id) {
                return None;
            }
            let tools = m["supported_parameters"].as_array().map(|p| p.iter().any(|x| x == "tools"));
            Some(json!({ "id": id, "tools": tools }))
        })
        .take(500)
        .collect();
    out.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses() {
        assert_eq!(server_base("http://localhost:11434/v1/").unwrap(), ("http://localhost:11434/v1".into(), "localhost:11434".into()));
        assert!(server_base("http://127.0.0.1:1234/v1").is_ok());
        assert!(server_base("http://[::1]:8080/v1").is_ok());
        assert!(server_base("https://llm.exemple.fr/v1").is_ok());
        assert!(server_base("HTTPS://openrouter.ai/api/v1").is_ok());
        // http vers une autre machine : refusé (le texte partirait en clair).
        assert!(server_base("http://192.168.1.20:11434/v1").unwrap_err().contains("https://"));
        assert!(server_base("http://serveur.local/v1").is_err());
        assert!(server_base("http://127.0.0.1.evil.com/v1").is_err());
        assert!(server_base("http://localhost@evil.com/v1").is_err());
        assert!(server_base("http://localhost:11434/v1?x=1").is_err());
        assert!(server_base("http://[::2]:80").is_err());
        assert!(server_base("ftp://localhost").is_err());
        assert!(server_base("localhost:11434").is_err());
        assert!(server_base("http://localhost:99999").is_err());
        assert!(server_base("http://localhost/../x").is_err());
        assert!(server_base("http://").is_err());
        assert!(on_this_pc("http://localhost:11434/v1/chat/completions") && on_this_pc("http://[::1]:8080/v1"));
        assert!(!on_this_pc("https://openrouter.ai/api/v1") && !on_this_pc("http://localhost.evil.com/v1"));
        assert_eq!(host_of("[::1]:8080"), "[::1]");
    }

    #[test]
    fn model_names() {
        assert!(valid_model("llama3.2:3b") && valid_model("openai/gpt-oss-20b") && valid_model("qwen3-8b@q4_k_m"));
        assert!(!valid_model("") && !valid_model("a b") && !valid_model("a\"b") && !valid_model(&"x".repeat(200)));
    }

    #[test]
    fn thinking_is_hidden() {
        assert_eq!(strip_thinking("<think>je réfléchis</think>\nBonjour !"), "Bonjour !");
        assert_eq!(strip_thinking("A<THINKING>x</THINKING>B<think>y</think>C"), "ABC");
        assert_eq!(strip_thinking("Début <think>coupé sans fin"), "Début");
        assert_eq!(strip_thinking("Sans réflexion"), "Sans réflexion");
    }

    #[test]
    fn request_and_answer() {
        let schema = json!({ "type": "object" });
        let b = body("llama3.2", 512, "sys", vec![json!({ "role": "user", "content": "Salut" })], &[json!({ "role": "tool", "tool_call_id": "1", "content": "{}" })], &[("chercher_fichiers", "Cherche", &schema)]);
        assert_eq!(b["messages"][0], json!({ "role": "system", "content": "sys" }));
        assert_eq!(b["messages"].as_array().unwrap().len(), 3);
        assert_eq!((b["stream"].as_bool(), b["tools"][0]["function"]["name"].as_str()), (Some(false), Some("chercher_fichiers")));
        let a = parse(&json!({ "model": "llama3.2", "choices": [{ "finish_reason": "stop", "message": { "content": "<think>hmm</think>Coucou", "reasoning_content": "secret" } }], "usage": { "prompt_tokens": 9, "completion_tokens": 3 } }));
        assert_eq!((a["answer"].as_str(), a["inputTokens"].as_u64(), a["truncated"].as_bool()), (Some("Coucou"), Some(9), Some(false)));
        assert!(!a.to_string().contains("secret"));
        let a = parse(&json!({ "choices": [{ "finish_reason": "tool_calls", "message": { "content": "<think>x</think>", "tool_calls": [{ "id": "c1", "type": "function", "function": { "name": "meteo", "arguments": "{\"ville\":\"Lyon\"}" } }] } }] }));
        assert_eq!(a["calls"][0], json!({ "id": "c1", "name": "meteo", "args": { "ville": "Lyon" } }));
        assert_eq!(a["native"][0]["content"], "");
        assert_eq!(tool_results(&[("c1".into(), json!({ "ok": true }))])[0]["role"], "tool");
    }

    #[test]
    fn tools_refused_and_model_lists() {
        assert!(refuses_tools(400, &json!({ "error": { "message": "registry.ollama.ai/library/gemma:2b does not support tools" } })));
        assert!(refuses_tools(400, &json!({ "error": "tools are not supported for this model" })));
        assert!(!refuses_tools(401, &json!({ "error": { "message": "bad key" } })));
        assert!(!refuses_tools(500, &json!({ "error": { "message": "tool not supported" } })));
        let list = models(&json!({ "data": [{ "id": "z/model", "supported_parameters": ["tools", "max_tokens"] }, { "id": "a-model" }, { "id": "bad name" }] }));
        assert_eq!(list, vec![json!({ "id": "a-model", "tools": null }), json!({ "id": "z/model", "tools": true })]);
    }
}
