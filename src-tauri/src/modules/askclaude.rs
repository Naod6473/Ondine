// Module « Demander à Claude » : tu donnes un texte (une erreur collée), un
// fichier texte ou une image (une capture), tu poses ta question, et Claude
// répond via l'API d'Anthropic.
//
// Deux temps, pour que tu voies EXACTEMENT ce qui part :
//   1. `prepare` lit le texte ou le fichier, le garde ici, et renvoie l'aperçu
//      complet (le texte entier, l'image) ; rien n'est encore envoyé ;
//   2. `send` envoie CE contenu préparé (pas un autre) avec ta question, après
//      ton clic sur « Envoyer à Claude ».
//
// Sécurité et confidentialité :
//   - la clé API est lue dans le Gestionnaire d'identifiants Windows, ici
//     seulement, et ne quitte jamais le Rust (ni le front, ni le journal) ;
//   - les fichiers passent par `check_path` (dossiers exclus refusés) ;
//   - la réponse de Claude est du TEXTE À AFFICHER : rien n'est exécuté ;
//   - le journal ne note que la taille de l'envoi, jamais son contenu.

use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use super::{ModuleContext, RustModule};
use crate::services::files;

const URL: &str = "https://api.anthropic.com/v1/messages";
/// La version de l'API (en-tête obligatoire, stable).
const API_VERSION: &str = "2023-06-01";
const MAX_TEXT_BYTES: u64 = 100 * 1024;
/// Une image en base64 grossit d'un tiers ; l'API accepte 5 Mo encodés.
const MAX_IMAGE_BYTES: u64 = 3_750_000;
const MAX_QUESTION: usize = 2000;
const MODELS: &[&str] = &["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];
const DEFAULT_INSTRUCTION: &str = "Tu aides quelqu'un sur son PC Windows. Réponds en français, simplement et brièvement. Si tu n'es pas sûr, dis-le au lieu d'inventer.";

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "log", "md", "json", "xml", "csv", "yml", "yaml", "toml", "ini", "cfg", "conf", "reg", "ps1", "psm1", "bat", "cmd", "sh", "py", "rs", "ts", "tsx", "js",
    "jsx", "html", "htm", "css", "c", "cpp", "h", "hpp", "cs", "java", "kt", "go", "rb", "php", "sql", "vue", "svelte",
];
const IMAGE_TYPES: &[(&str, &str)] = &[("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")];

/// Ce qui partira à l'envoi (préparé, montré, puis envoyé tel quel).
#[derive(Clone)]
struct Prepared {
    id: u64,
    /// Le nom affiché (« erreur collée », « app.log »).
    name: String,
    text: Option<String>,
    /// (type, contenu en base64)
    image: Option<(&'static str, String)>,
}

#[derive(Default)]
pub struct AskClaude {
    prepared: Mutex<Option<Prepared>>,
    next: Mutex<u64>,
}

impl RustModule for AskClaude {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/askclaude/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // Y a-t-il une clé ? (oui / non, jamais la clé) et quel modèle.
            "status" => Ok(json!({ "hasKey": ctx.credential("anthropic-api-key")?.is_some(), "model": model(ctx) })),
            // { text } ou { path } → l'aperçu complet de ce qui partira.
            "prepare" => {
                let (name, text, image) = match (args.get("text").and_then(Value::as_str), args.get("path").and_then(Value::as_str)) {
                    (Some(t), _) => {
                        let t = t.trim();
                        if t.is_empty() {
                            return Err("le texte est vide".into());
                        }
                        if t.len() as u64 > MAX_TEXT_BYTES {
                            return Err("texte trop long (100 Ko au plus)".into());
                        }
                        ("texte collé".to_string(), Some(t.to_string()), None)
                    }
                    (None, Some(p)) => read_file(ctx, p)?,
                    (None, None) => return Err("rien à préparer".into()),
                };
                let id = {
                    let mut n = self.next.lock().unwrap();
                    *n += 1;
                    *n
                };
                let prepared = Prepared { id, name, text, image };
                let preview = preview(&prepared, ctx);
                *self.prepared.lock().unwrap() = Some(prepared);
                Ok(preview)
            }
            // { id, question } : envoie le contenu préparé n° id.
            "send" => {
                ctx.require("claude-api")?;
                let id = args.get("id").and_then(Value::as_u64).ok_or("rien de préparé")?;
                let prepared = self.prepared.lock().unwrap().clone().filter(|p| p.id == id).ok_or("l'aperçu a changé : vérifie ce qui part, puis renvoie")?;
                let question: String = args.get("question").and_then(Value::as_str).unwrap_or("").trim().chars().take(MAX_QUESTION).collect();
                let key = ctx.credential("anthropic-api-key")?.ok_or("Pas de clé API Anthropic : ajoute-la dans Réglages → Identifiants.")?;
                let body = request_body(&prepared, &question, &model(ctx), max_tokens(ctx), &instruction(ctx));
                ctx.log_info(format!("demande envoyée à Claude ({} octets)", body.to_string().len()));
                let answer = call_api(&key, &body)?;
                Ok(answer)
            }
            // { text } : copie la réponse.
            "copy" => {
                ctx.require("clipboard")?;
                files::copy_text(args.get("text").and_then(Value::as_str).unwrap_or(""))?;
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

fn model(ctx: &ModuleContext) -> String {
    let m = ctx.settings().get("model").and_then(Value::as_str).unwrap_or("").to_string();
    if MODELS.contains(&m.as_str()) { m } else { MODELS[0].to_string() }
}

fn max_tokens(ctx: &ModuleContext) -> u64 {
    ctx.settings().get("maxTokens").and_then(Value::as_u64).unwrap_or(1024).clamp(256, 4096)
}

fn instruction(ctx: &ModuleContext) -> String {
    let s = ctx.settings().get("instruction").and_then(Value::as_str).unwrap_or("").trim().chars().take(500).collect::<String>();
    if s.is_empty() { DEFAULT_INSTRUCTION.to_string() } else { s }
}

/// Lit un fichier déposé : du texte (UTF-8) ou une image, avec des limites de taille.
fn read_file(ctx: &ModuleContext, raw: &str) -> Result<(String, Option<String>, Option<(&'static str, String)>), String> {
    let path = ctx.check_path(raw)?; // refuse les dossiers exclus
    if !path.is_file() {
        return Err("ce n'est pas un fichier".into());
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if let Some((_, media)) = IMAGE_TYPES.iter().find(|(e, _)| *e == ext) {
        if size > MAX_IMAGE_BYTES {
            return Err("image trop lourde (3,7 Mo au plus)".into());
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        return Ok((name, None, Some((media, base64::engine::general_purpose::STANDARD.encode(bytes)))));
    }
    if !TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("« .{ext} » n'est pas pris en charge : un fichier texte (.txt, .log, code…) ou une image (.png, .jpg)"));
    }
    if size > MAX_TEXT_BYTES {
        return Err("fichier trop long (100 Ko au plus)".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "ce fichier n'est pas du texte UTF-8".to_string())?;
    Ok((name, Some(text), None))
}

/// L'aperçu : tout ce qui partira, en entier.
fn preview(p: &Prepared, ctx: &ModuleContext) -> Value {
    json!({
        "id": p.id,
        "name": p.name,
        "text": p.text,
        "image": p.image.as_ref().map(|(media, data)| format!("data:{media};base64,{data}")),
        "bytes": p.text.as_ref().map(|t| t.len()).unwrap_or(0) + p.image.as_ref().map(|(_, d)| d.len() * 3 / 4).unwrap_or(0),
        "model": model(ctx),
        "instruction": instruction(ctx),
        "destination": "api.anthropic.com",
    })
}

/// Le corps de la requête (API Messages d'Anthropic).
fn request_body(p: &Prepared, question: &str, model: &str, max_tokens: u64, system: &str) -> Value {
    let mut content: Vec<Value> = Vec::new();
    if let Some((media, data)) = &p.image {
        content.push(json!({ "type": "image", "source": { "type": "base64", "media_type": media, "data": data } }));
    }
    let question = if question.is_empty() { "Explique-moi ceci." } else { question };
    let mut text = question.to_string();
    if let Some(t) = &p.text {
        // Le contenu est balisé : c'est un document à lire, pas des instructions.
        text.push_str(&format!("\n\n<document nom=\"{}\">\n{t}\n</document>", p.name.replace('"', "'")));
    }
    content.push(json!({ "type": "text", "text": text }));
    json!({ "model": model, "max_tokens": max_tokens, "system": system, "messages": [{ "role": "user", "content": content }] })
}

/// Appelle l'API ; renvoie `{answer, model, inputTokens, outputTokens}`.
fn call_api(key: &str, body: &Value) -> Result<Value, String> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let agent: ureq::Agent = ureq::Agent::config_builder()
        // Le TLS de Windows et ses certificats (voir Cargo.toml).
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .http_status_as_error(false) // on lit le message d'erreur de l'API
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into();
    let mut resp = agent
        .post(URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .send_json(body)
        .map_err(|e| format!("impossible de joindre l'API : {e}"))?;
    let status = resp.status().as_u16();
    let v: Value = resp.body_mut().with_config().limit(2 * 1024 * 1024).read_json().map_err(|_| format!("réponse illisible de l'API (code {status})"))?;
    if status != 200 {
        return Err(api_error(status, &v));
    }
    Ok(parse_answer(&v))
}

fn api_error(status: u16, v: &Value) -> String {
    let detail = v["error"]["message"].as_str().unwrap_or("");
    let what = match status {
        401 => "clé API refusée (vérifie-la dans Réglages → Identifiants)",
        403 => "accès refusé par l'API",
        413 => "envoi trop gros",
        429 => "trop de demandes : réessaie dans un moment",
        529 => "l'API est surchargée : réessaie dans un moment",
        _ => "l'API a refusé la demande",
    };
    if detail.is_empty() { format!("{what} (code {status})") } else { format!("{what} (code {status}) : {}", detail.chars().take(200).collect::<String>()) }
}

fn parse_answer(v: &Value) -> Value {
    let answer: Vec<&str> = v["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
    json!({
        "answer": answer.join("\n\n"),
        "model": v["model"],
        "truncated": v["stop_reason"] == "max_tokens",
        "inputTokens": v["usage"]["input_tokens"],
        "outputTokens": v["usage"]["output_tokens"],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_marks_the_document() {
        let p = Prepared { id: 1, name: "a\"b.log".into(), text: Some("Erreur 42".into()), image: Some(("image/png", "QUJD".into())) };
        let b = request_body(&p, "", "claude-sonnet-5-5", 1024, "sys");
        let content = b["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content[0]["source"]["media_type"], "image/png");
        let text = content[1]["text"].as_str().unwrap();
        assert!(text.starts_with("Explique-moi ceci."));
        assert!(text.contains("<document nom=\"a'b.log\">\nErreur 42\n</document>"));
        assert_eq!((b["model"].as_str(), b["max_tokens"].as_u64(), b["system"].as_str()), (Some("claude-sonnet-5-5"), Some(1024), Some("sys")));
    }

    #[test]
    fn answers_and_errors() {
        let v = json!({ "model": "m", "stop_reason": "end_turn", "content": [{ "type": "text", "text": "Bonjour" }, { "type": "text", "text": "!" }], "usage": { "input_tokens": 3, "output_tokens": 2 } });
        let a = parse_answer(&v);
        assert_eq!((a["answer"].as_str(), a["truncated"].as_bool()), (Some("Bonjour\n\n!"), Some(false)));
        assert!(api_error(401, &json!({ "error": { "message": "invalid x-api-key" } })).starts_with("clé API refusée"));
        assert_eq!(api_error(500, &json!({})), "l'API a refusé la demande (code 500)");
    }

    /// Un vrai appel avec une fausse clé : vérifie le chemin réseau, le TLS et
    /// la lecture de l'erreur. Réseau requis : `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn real_call_with_a_wrong_key() {
        let p = Prepared { id: 1, name: "t".into(), text: Some("x".into()), image: None };
        let err = call_api("sk-ant-fausse", &request_body(&p, "", MODELS[0], 16, "s")).unwrap_err();
        assert!(err.starts_with("clé API refusée"), "{err}");
    }
}
