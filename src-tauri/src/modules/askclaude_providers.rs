// « Parler à Ondine » : les trois fournisseurs d'IA (Claude, OpenAI, Gemini).
//
// Une seule forme de conversation (des tours « vous » / « Ondine », avec
// éventuellement un document ou une image joints), traduite ici vers l'API de
// chaque fournisseur, puis la réponse ramenée à une seule forme :
// `{answer, model, truncated, inputTokens, outputTokens, calls, native}`.
//
// Les outils (askclaude_tools.rs) : chaque API a sa façon de les décrire, de
// demander un appel et de recevoir le résultat. `calls` : les appels demandés,
// sous une seule forme ({id, name, args}) ; `native` : la réponse telle que
// l'API veut la relire au tour suivant (`Request.extra`), suivie des résultats
// (`tool_results`).
//
// La clé API arrive du Gestionnaire d'identifiants (voir askclaude.rs) et ne
// sert qu'à l'en-tête de la requête : elle n'est jamais journalisée.

use std::time::Duration;

use serde_json::{json, Value};

/// Les fournisseurs : l'identifiant du réglage, la clé dans le Gestionnaire
/// d'identifiants, et l'adresse montrée avant l'envoi.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    OpenAi,
    Gemini,
}

impl Provider {
    pub const ALL: [Provider; 3] = [Provider::Claude, Provider::OpenAi, Provider::Gemini];

    pub fn from_id(id: &str) -> Provider {
        match id {
            "openai" => Provider::OpenAi,
            "gemini" => Provider::Gemini,
            _ => Provider::Claude,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::OpenAi => "openai",
            Provider::Gemini => "gemini",
        }
    }

    pub fn credential_key(self) -> &'static str {
        match self {
            Provider::Claude => "anthropic-api-key",
            Provider::OpenAi => crate::services::credentials::OPENAI_KEY,
            Provider::Gemini => crate::services::credentials::GEMINI_KEY,
        }
    }

    pub fn destination(self) -> &'static str {
        match self {
            Provider::Claude => "api.anthropic.com",
            Provider::OpenAi => "api.openai.com",
            Provider::Gemini => "generativelanguage.googleapis.com",
        }
    }

    /// Le nom de la clé dans Réglages → Identifiants (pour les messages d'erreur).
    pub fn key_label(self) -> &'static str {
        match self {
            Provider::Claude => "Clé API Anthropic",
            Provider::OpenAi => "Clé API OpenAI",
            Provider::Gemini => "Clé API Gemini",
        }
    }
}

/// Un document ou une image joints à un message.
#[derive(Clone, Debug)]
pub struct Attachment {
    /// Le nom affiché (« texte collé », « app.log »).
    pub name: String,
    pub text: Option<String>,
    /// (type MIME, contenu en base64)
    pub image: Option<(&'static str, String)>,
}

/// Un tour de la conversation.
#[derive(Clone, Debug)]
pub struct Turn {
    /// Vrai : c'est vous ; faux : c'est Ondine.
    pub user: bool,
    pub text: String,
    pub attachment: Option<Attachment>,
    /// Ce qu'Ondine a fait pendant ce tour (fichiers trouvés…), relu par l'IA
    /// aux tours suivants mais pas affiché : « [Fichiers trouvés : #1 …] ».
    pub notes: Option<String>,
}

/// Un outil proposé à l'IA : son nom, ce qu'il fait, ses paramètres (schéma JSON).
pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: Value,
}

/// Un appel d'outil demandé par l'IA.
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub id: String,
    pub name: String,
    pub args: Value,
}

/// Ce qui part : le modèle, la personnalité, la conversation, les outils, et
/// la suite d'un échange en cours (réponses avec appels, puis leurs résultats).
pub struct Request<'a> {
    pub model: &'a str,
    pub max_tokens: u64,
    pub system: &'a str,
    pub turns: &'a [Turn],
    pub tools: &'a [Tool],
    pub extra: &'a [Value],
}

/// GPT et Gemini « réfléchissent » avant de répondre, et cette réflexion compte
/// dans la limite de jetons : sans marge, une réponse courte pourrait arriver
/// vide. Claude ne réfléchit pas ici (pas de « thinking » demandé).
const REASONING_MARGIN: u64 = 2048;

/// Le texte d'un tour « vous » : le message, puis le document joint, balisé
/// (c'est un document à lire, pas des instructions).
fn user_text(t: &Turn) -> String {
    let mut text = t.text.clone();
    if let Some(doc) = t.attachment.as_ref().and_then(|a| a.text.as_ref().map(|d| (&a.name, d))) {
        text.push_str(&format!("\n\n<document nom=\"{}\">\n{}\n</document>", doc.0.replace('"', "'"), doc.1));
    }
    text
}

/// Le texte d'un tour d'Ondine, avec ses notes.
fn ondine_text(t: &Turn) -> String {
    match &t.notes {
        Some(n) => format!("{}\n\n{}", t.text, n),
        None => t.text.clone(),
    }
}

fn image_of(t: &Turn) -> Option<&(&'static str, String)> {
    t.attachment.as_ref().and_then(|a| a.image.as_ref())
}

/// L'URL et le corps de la requête, selon le fournisseur.
pub fn request(provider: Provider, r: &Request) -> (String, Value) {
    match provider {
        Provider::Claude => {
            let messages: Vec<Value> = r
                .turns
                .iter()
                .map(|t| {
                    if !t.user {
                        return json!({ "role": "assistant", "content": ondine_text(t) });
                    }
                    let mut content: Vec<Value> = Vec::new();
                    if let Some((media, data)) = image_of(t) {
                        content.push(json!({ "type": "image", "source": { "type": "base64", "media_type": media, "data": data } }));
                    }
                    content.push(json!({ "type": "text", "text": user_text(t) }));
                    json!({ "role": "user", "content": content })
                })
                .collect();
            let mut messages = messages;
            messages.extend(r.extra.iter().cloned());
            let mut body = json!({ "model": r.model, "max_tokens": r.max_tokens, "system": r.system, "messages": messages });
            if !r.tools.is_empty() {
                body["tools"] = r.tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.schema })).collect();
            }
            ("https://api.anthropic.com/v1/messages".into(), body)
        }
        // L'API « Responses » d'OpenAI (celle des modèles récents).
        Provider::OpenAi => {
            let input: Vec<Value> = r
                .turns
                .iter()
                .map(|t| {
                    if !t.user {
                        return json!({ "role": "assistant", "content": [{ "type": "output_text", "text": ondine_text(t) }] });
                    }
                    let mut content = vec![json!({ "type": "input_text", "text": user_text(t) })];
                    if let Some((media, data)) = image_of(t) {
                        content.push(json!({ "type": "input_image", "image_url": format!("data:{media};base64,{data}") }));
                    }
                    json!({ "role": "user", "content": content })
                })
                .collect();
            let mut input = input;
            input.extend(r.extra.iter().cloned());
            let mut body = json!({ "model": r.model, "instructions": r.system, "input": input, "max_output_tokens": r.max_tokens + REASONING_MARGIN, "store": false });
            if !r.tools.is_empty() {
                body["tools"] = r.tools.iter().map(|t| json!({ "type": "function", "name": t.name, "description": t.description, "parameters": t.schema })).collect();
                // Sans stockage chez OpenAI, la réflexion doit revenir avec le
                // résultat de l'outil : on la demande chiffrée, et on la renvoie.
                body["include"] = json!(["reasoning.encrypted_content"]);
            }
            ("https://api.openai.com/v1/responses".into(), body)
        }
        Provider::Gemini => {
            let contents: Vec<Value> = r
                .turns
                .iter()
                .map(|t| {
                    if !t.user {
                        return json!({ "role": "model", "parts": [{ "text": ondine_text(t) }] });
                    }
                    let mut parts = vec![json!({ "text": user_text(t) })];
                    if let Some((media, data)) = image_of(t) {
                        parts.push(json!({ "inlineData": { "mimeType": media, "data": data } }));
                    }
                    json!({ "role": "user", "parts": parts })
                })
                .collect();
            let mut contents = contents;
            contents.extend(r.extra.iter().cloned());
            let mut body = json!({
                "systemInstruction": { "parts": [{ "text": r.system }] },
                "contents": contents,
                "generationConfig": { "maxOutputTokens": r.max_tokens + REASONING_MARGIN },
            });
            if !r.tools.is_empty() {
                let decls: Vec<Value> = r.tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "parameters": t.schema })).collect();
                body["tools"] = json!([{ "functionDeclarations": decls }]);
            }
            (
                // Le modèle est vérifié avant (valid_model) : il ne peut pas sortir du chemin.
                format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", r.model),
                body,
            )
        }
    }
}

/// Un nom de modèle tapé à la main (OpenAI, Gemini) : lettres, chiffres, « . - _ : ».
pub fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 64 && m.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
}

/// Appelle l'API ; renvoie la réponse sous la forme commune.
pub fn call(provider: Provider, key: &str, url: &str, body: &Value) -> Result<Value, String> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let agent: ureq::Agent = ureq::Agent::config_builder()
        // Le TLS de Windows et ses certificats (voir Cargo.toml).
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .http_status_as_error(false) // on lit le message d'erreur de l'API
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into();
    let req = agent.post(url);
    let req = match provider {
        Provider::Claude => req.header("x-api-key", key).header("anthropic-version", "2023-06-01"),
        Provider::OpenAi => req.header("authorization", &format!("Bearer {key}")),
        Provider::Gemini => req.header("x-goog-api-key", key),
    };
    let mut resp = req.send_json(body).map_err(|e| format!("impossible de joindre l'API : {e}"))?;
    let status = resp.status().as_u16();
    let v: Value = resp.body_mut().with_config().limit(2 * 1024 * 1024).read_json().map_err(|_| format!("réponse illisible de l'API (code {status})"))?;
    if status != 200 {
        return Err(api_error(provider, status, &v));
    }
    Ok(parse(provider, &v))
}

pub fn api_error(provider: Provider, status: u16, v: &Value) -> String {
    let detail = v["error"]["message"].as_str().unwrap_or("");
    // Gemini répond 400 (et non 401) à une clé invalide.
    let bad_key = status == 401 || (provider == Provider::Gemini && detail.contains("API key"));
    let what = match status {
        _ if bad_key => format!("clé API refusée (vérifiez la {} dans Réglages → Identifiants)", provider.key_label()),
        403 => "accès refusé par l'API".into(),
        404 => "modèle introuvable : vérifiez son nom dans les réglages du module".into(),
        413 => "envoi trop gros".into(),
        429 => "trop de demandes, ou plus de crédit : réessayez dans un moment".into(),
        500..=599 => "l'API est surchargée ou en panne : réessayez dans un moment".into(),
        _ => "l'API a refusé la demande".into(),
    };
    if detail.is_empty() { format!("{what} (code {status})") } else { format!("{what} (code {status}) : {}", detail.chars().take(200).collect::<String>()) }
}

pub fn parse(provider: Provider, v: &Value) -> Value {
    let (texts, truncated, input, output): (Vec<&str>, bool, &Value, &Value) = match provider {
        Provider::Claude => (
            v["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect(),
            v["stop_reason"] == "max_tokens",
            &v["usage"]["input_tokens"],
            &v["usage"]["output_tokens"],
        ),
        Provider::OpenAi => (
            v["output"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|o| o["type"] == "message")
                .flat_map(|o| o["content"].as_array().into_iter().flatten())
                .filter(|c| c["type"] == "output_text")
                .filter_map(|c| c["text"].as_str())
                .collect(),
            v["status"] == "incomplete",
            &v["usage"]["input_tokens"],
            &v["usage"]["output_tokens"],
        ),
        Provider::Gemini => (
            v["candidates"][0]["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                // Les « pensées » du modèle ne sont pas la réponse.
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect(),
            v["candidates"][0]["finishReason"] == "MAX_TOKENS",
            &v["usageMetadata"]["promptTokenCount"],
            &v["usageMetadata"]["candidatesTokenCount"],
        ),
    };
    let model = match provider {
        Provider::Gemini => &v["modelVersion"],
        _ => &v["model"],
    };
    let (calls, native) = calls_of(provider, v);
    let calls: Vec<Value> = calls.into_iter().map(|c| json!({ "id": c.id, "name": c.name, "args": c.args })).collect();
    json!({ "answer": texts.join("\n\n").trim(), "model": model, "truncated": truncated, "inputTokens": input, "outputTokens": output, "calls": calls, "native": native })
}

/// Les appels d'outils d'une réponse, et la réponse telle que l'API veut la
/// relire au tour suivant (vide s'il n'y a pas d'appel).
fn calls_of(provider: Provider, v: &Value) -> (Vec<Call>, Vec<Value>) {
    let calls: Vec<Call> = match provider {
        Provider::Claude => v["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == "tool_use")
            .map(|b| Call { id: b["id"].as_str().unwrap_or("").into(), name: b["name"].as_str().unwrap_or("").into(), args: b["input"].clone() })
            .collect(),
        Provider::OpenAi => v["output"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|o| o["type"] == "function_call")
            .map(|o| Call {
                id: o["call_id"].as_str().unwrap_or("").into(),
                name: o["name"].as_str().unwrap_or("").into(),
                // Les arguments arrivent en texte JSON.
                args: o["arguments"].as_str().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null),
            })
            .collect(),
        Provider::Gemini => v["candidates"][0]["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p.get("functionCall"))
            .map(|f| {
                let name = f["name"].as_str().unwrap_or("").to_string();
                Call { id: f["id"].as_str().map(str::to_string).unwrap_or_else(|| name.clone()), name, args: f["args"].clone() }
            })
            .collect(),
    };
    if calls.is_empty() {
        return (calls, Vec::new());
    }
    let native = match provider {
        Provider::Claude => vec![json!({ "role": "assistant", "content": v["content"] })],
        // Tout ce qui est sorti (réflexion chiffrée, appels, texte) repart tel quel.
        Provider::OpenAi => v["output"].as_array().cloned().unwrap_or_default(),
        // Le contenu entier, avec ses « signatures de pensée ».
        Provider::Gemini => vec![v["candidates"][0]["content"].clone()],
    };
    (calls, native)
}

/// Les appels de la forme commune ({id, name, args}) renvoyée par `parse`.
pub fn calls_from(answer: &Value) -> Vec<Call> {
    answer["calls"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| Call { id: c["id"].as_str().unwrap_or("").into(), name: c["name"].as_str().unwrap_or("").into(), args: c["args"].clone() })
        .collect()
}

/// Les résultats des outils, dans la forme que l'API attend après ses appels.
pub fn tool_results(provider: Provider, results: &[(Call, Value)]) -> Vec<Value> {
    match provider {
        Provider::Claude => {
            let blocks: Vec<Value> = results.iter().map(|(c, r)| json!({ "type": "tool_result", "tool_use_id": c.id, "content": r.to_string() })).collect();
            vec![json!({ "role": "user", "content": blocks })]
        }
        Provider::OpenAi => results.iter().map(|(c, r)| json!({ "type": "function_call_output", "call_id": c.id, "output": r.to_string() })).collect(),
        Provider::Gemini => {
            let parts: Vec<Value> = results
                .iter()
                .map(|(c, r)| {
                    // La réponse doit être un objet.
                    let response = if r.is_object() { r.clone() } else { json!({ "resultat": r }) };
                    let mut f = json!({ "name": c.name, "response": response });
                    if c.id != c.name {
                        f["id"] = json!(c.id);
                    }
                    json!({ "functionResponse": f })
                })
                .collect();
            vec![json!({ "role": "user", "parts": parts })]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turns() -> Vec<Turn> {
        vec![
            Turn { user: true, text: "Bonjour".into(), attachment: Some(Attachment { name: "a\"b.log".into(), text: Some("Erreur 42".into()), image: Some(("image/png", "QUJD".into())) }), notes: None },
            Turn { user: false, text: "Coucou !".into(), attachment: None, notes: Some("[Fichiers trouvés : #1 a.txt]".into()) },
            Turn { user: true, text: "Et ça ?".into(), attachment: None, notes: None },
        ]
    }

    #[test]
    fn claude_body() {
        let t = turns();
        let (url, b) = request(Provider::Claude, &Request { model: "claude-sonnet-5-5", max_tokens: 1024, system: "sys", turns: &t, tools: &[], extra: &[] });
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert_eq!((b["system"].as_str(), b["max_tokens"].as_u64()), (Some("sys"), Some(1024)));
        let m = b["messages"].as_array().unwrap();
        assert_eq!(m.len(), 3);
        assert_eq!(m[0]["content"][0]["source"]["media_type"], "image/png");
        assert!(m[0]["content"][1]["text"].as_str().unwrap().contains("<document nom=\"a'b.log\">\nErreur 42\n</document>"));
        assert_eq!((m[1]["role"].as_str(), m[1]["content"].as_str()), (Some("assistant"), Some("Coucou !\n\n[Fichiers trouvés : #1 a.txt]")));
        assert!(b.get("tools").is_none());
    }

    #[test]
    fn openai_body() {
        let t = turns();
        let (url, b) = request(Provider::OpenAi, &Request { model: "gpt-6-luna", max_tokens: 1024, system: "sys", turns: &t, tools: &[], extra: &[] });
        assert_eq!(url, "https://api.openai.com/v1/responses");
        assert_eq!((b["instructions"].as_str(), b["max_output_tokens"].as_u64(), b["store"].as_bool()), (Some("sys"), Some(1024 + REASONING_MARGIN), Some(false)));
        assert_eq!(b["input"][0]["content"][1]["image_url"], "data:image/png;base64,QUJD");
        assert_eq!(b["input"][1]["content"][0]["type"], "output_text");
    }

    #[test]
    fn gemini_body() {
        let t = turns();
        let (url, b) = request(Provider::Gemini, &Request { model: "gemini-3.8-flash", max_tokens: 1024, system: "sys", turns: &t, tools: &[], extra: &[] });
        assert_eq!(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
        assert_eq!(b["systemInstruction"]["parts"][0]["text"], "sys");
        assert_eq!(b["contents"][0]["parts"][1]["inlineData"]["mimeType"], "image/png");
        assert_eq!(b["contents"][1]["role"], "model");
    }

    #[test]
    fn model_names() {
        assert!(valid_model("gemini-3.8-flash") && valid_model("gpt-6.1-sol"));
        assert!(!valid_model("") && !valid_model("../x") && !valid_model("a/b") && !valid_model("a?b"));
    }

    #[test]
    fn answers() {
        let c = parse(Provider::Claude, &json!({ "model": "m", "stop_reason": "end_turn", "content": [{ "type": "text", "text": "Bonjour" }], "usage": { "input_tokens": 3, "output_tokens": 2 } }));
        assert_eq!((c["answer"].as_str(), c["truncated"].as_bool(), c["inputTokens"].as_u64()), (Some("Bonjour"), Some(false), Some(3)));
        let o = parse(
            Provider::OpenAi,
            &json!({ "model": "g", "status": "completed", "output": [{ "type": "reasoning" }, { "type": "message", "content": [{ "type": "output_text", "text": "Salut" }] }], "usage": { "input_tokens": 5, "output_tokens": 7 } }),
        );
        assert_eq!((o["answer"].as_str(), o["outputTokens"].as_u64()), (Some("Salut"), Some(7)));
        let g = parse(
            Provider::Gemini,
            &json!({ "modelVersion": "gem", "candidates": [{ "finishReason": "MAX_TOKENS", "content": { "parts": [{ "text": "hmm", "thought": true }, { "text": "Hello" }] } }], "usageMetadata": { "promptTokenCount": 4, "candidatesTokenCount": 1 } }),
        );
        assert_eq!((g["answer"].as_str(), g["truncated"].as_bool(), g["model"].as_str()), (Some("Hello"), Some(true), Some("gem")));
    }

    #[test]
    fn errors() {
        assert!(api_error(Provider::Claude, 401, &json!({ "error": { "message": "invalid x-api-key" } })).starts_with("clé API refusée (vérifiez la Clé API Anthropic"));
        assert!(api_error(Provider::Gemini, 400, &json!({ "error": { "message": "API key not valid." } })).starts_with("clé API refusée (vérifiez la Clé API Gemini"));
        assert!(api_error(Provider::OpenAi, 404, &json!({})).starts_with("modèle introuvable"));
        assert_eq!(api_error(Provider::OpenAi, 400, &json!({})), "l'API a refusé la demande (code 400)");
    }

    fn tools() -> Vec<Tool> {
        vec![Tool { name: "chercher_fichiers", description: "Cherche", schema: json!({ "type": "object", "properties": { "requete": { "type": "string" } }, "required": ["requete"] }) }]
    }

    #[test]
    fn tools_are_described_for_each_api() {
        let t = turns();
        let tl = tools();
        let extra = vec![json!({ "x": 1 })];
        let r = |model| Request { model, max_tokens: 1024, system: "sys", turns: &t, tools: &tl, extra: &extra };
        let (_, c) = request(Provider::Claude, &r("claude-sonnet-5-5"));
        assert_eq!(c["tools"][0]["input_schema"]["required"][0], "requete");
        assert_eq!(c["messages"].as_array().unwrap().last().unwrap(), &json!({ "x": 1 }));
        let (_, o) = request(Provider::OpenAi, &r("gpt-6-luna"));
        assert_eq!((o["tools"][0]["type"].as_str(), o["tools"][0]["name"].as_str()), (Some("function"), Some("chercher_fichiers")));
        assert_eq!(o["include"][0], "reasoning.encrypted_content");
        assert_eq!(o["input"].as_array().unwrap().last().unwrap(), &json!({ "x": 1 }));
        let (_, g) = request(Provider::Gemini, &r("gemini-3.8-flash"));
        assert_eq!(g["tools"][0]["functionDeclarations"][0]["name"], "chercher_fichiers");
        assert_eq!(g["contents"].as_array().unwrap().last().unwrap(), &json!({ "x": 1 }));
    }

    #[test]
    fn tool_calls_and_results() {
        let want = Call { id: "c1".into(), name: "chercher_fichiers".into(), args: json!({ "requete": "facture" }) };
        // Claude
        let v = json!({ "content": [{ "type": "text", "text": "Je cherche." }, { "type": "tool_use", "id": "c1", "name": "chercher_fichiers", "input": { "requete": "facture" } }], "stop_reason": "tool_use", "usage": {} });
        let a = parse(Provider::Claude, &v);
        assert_eq!(calls_from(&a), vec![want.clone()]);
        assert_eq!(a["native"][0]["role"], "assistant");
        let r = tool_results(Provider::Claude, &[(want.clone(), json!({ "ok": true }))]);
        assert_eq!((r[0]["role"].as_str(), r[0]["content"][0]["tool_use_id"].as_str()), (Some("user"), Some("c1")));
        // OpenAI : arguments en texte, tout l'output repart.
        let v = json!({ "output": [{ "type": "reasoning", "encrypted_content": "zz" }, { "type": "function_call", "call_id": "c1", "name": "chercher_fichiers", "arguments": "{\"requete\":\"facture\"}" }], "usage": {} });
        let a = parse(Provider::OpenAi, &v);
        assert_eq!(calls_from(&a), vec![want.clone()]);
        assert_eq!(a["native"].as_array().unwrap().len(), 2);
        let r = tool_results(Provider::OpenAi, &[(want.clone(), json!([1]))]);
        assert_eq!((r[0]["type"].as_str(), r[0]["output"].as_str()), (Some("function_call_output"), Some("[1]")));
        // Gemini : sans id, le nom sert d'id ; la réponse devient un objet.
        let v = json!({ "candidates": [{ "content": { "role": "model", "parts": [{ "functionCall": { "name": "chercher_fichiers", "args": { "requete": "facture" } }, "thoughtSignature": "sig" }] } }] });
        let a = parse(Provider::Gemini, &v);
        let g = Call { id: "chercher_fichiers".into(), ..want.clone() };
        assert_eq!(calls_from(&a), vec![g.clone()]);
        assert_eq!(a["native"][0]["parts"][0]["thoughtSignature"], "sig");
        let r = tool_results(Provider::Gemini, &[(g, json!([1]))]);
        assert_eq!(r[0]["parts"][0]["functionResponse"]["response"], json!({ "resultat": [1] }));
        assert!(r[0]["parts"][0]["functionResponse"].get("id").is_none());
        // Pas d'appel : rien à relire.
        assert_eq!(parse(Provider::Claude, &json!({ "content": [{ "type": "text", "text": "ok" }] }))["native"], json!([]));
    }

    /// De vrais appels avec de fausses clés : vérifie le chemin réseau, le TLS
    /// et la lecture de l'erreur. Réseau requis : `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn real_calls_with_wrong_keys() {
        let t = vec![Turn { user: true, text: "x".into(), attachment: None, notes: None }];
        for (p, model) in [(Provider::Claude, "claude-sonnet-5-5"), (Provider::OpenAi, "gpt-6-luna"), (Provider::Gemini, "gemini-3.8-flash")] {
            let (url, body) = request(p, &Request { model, max_tokens: 16, system: "s", turns: &t, tools: &[], extra: &[] });
            let err = call(p, "fausse-cle", &url, &body).unwrap_err();
            assert!(err.starts_with("clé API refusée"), "{p:?} : {err}");
        }
    }
}
