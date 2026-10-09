// Module « Parler à Ondine » (anciennement « Demander à Claude », d'où son
// identifiant `askclaude`, gardé pour ne pas perdre les réglages) : une
// conversation avec Ondine, qui répond grâce à l'API de Claude, d'OpenAI ou de
// Gemini (au choix dans les réglages), avec sa petite personnalité.
//
// Le message que vous tapez part quand vous cliquez « Envoyer ». Un fichier
// joint (texte ou image), lui, passe d'abord par un aperçu :
//   1. `prepare` lit le texte ou le fichier, le garde ici, et renvoie l'aperçu
//      complet (le texte entier, l'image) ; rien n'est encore envoyé ;
//   2. `send` envoie CE contenu préparé (pas un autre) avec votre message.
//
// Ce qui part à chaque message : la personnalité, les derniers messages de la
// conversation (MAX_TURNS au plus, avec leurs fichiers joints) et le nouveau.
// La conversation reste en mémoire, jamais sur le disque : elle disparaît
// quand on la recommence ou qu'on quitte l'île.
//
// Sécurité et confidentialité :
//   - les clés API sont lues dans le Gestionnaire d'identifiants Windows, ici
//     seulement, et ne quittent jamais le Rust (ni le front, ni le journal) ;
//   - les fichiers passent par `check_path` (dossiers exclus refusés) ;
//   - la réponse est du TEXTE À AFFICHER : rien n'est exécuté ;
//   - le journal ne note que la taille de l'envoi, jamais son contenu.

use crate::sync::LockExt;
use std::sync::Mutex;

use base64::Engine;
use serde_json::{json, Value};

use super::askclaude_providers::{self as providers, Attachment, Provider, Request, Turn};
use super::{ModuleContext, RustModule};
use crate::services::files;

const MAX_TEXT_BYTES: u64 = 100 * 1024;
/// Une image en base64 grossit d'un tiers ; les API acceptent 5 Mo encodés.
const MAX_IMAGE_BYTES: u64 = 3_750_000;
const MAX_MESSAGE: usize = 2000;
/// Les messages renvoyés à chaque fois (vous + Ondine) : au-delà, les plus
/// anciens ne partent plus. Chaque message renvoie toute cette mémoire : c'est
/// elle qui coûte.
const MAX_TURNS: usize = 20;
const CLAUDE_MODELS: &[&str] = &["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"];
const DEFAULT_OPENAI_MODEL: &str = "gpt-6-luna";
const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash";

// La personnalité d'Ondine, selon la façon de s'adresser à la personne
// (l'aperçu la montre telle qu'elle part, donc on ne la traduit pas à l'écran).
const PERSONALITY: &str = "Vous êtes Ondine, la mascotte d'une petite île posée en haut de l'écran Windows : une goutte de gomme toute ronde, joyeuse, curieuse et un brin espiègle. \
Vous aidez la personne sur son PC : une erreur, un réglage, un fichier, un texte, du code. \
Vous répondez en français, avec chaleur, en quelques phrases courtes, sauf si on vous demande du détail. \
De temps en temps, un petit clin d'œil (l'eau, les gouttes, votre île), sans en abuser. \
Vous vouvoyez la personne. Si vous n'êtes pas sûre, vous le dites au lieu d'inventer. \
Vous ne voyez que ce qu'on vous écrit ou vous montre ici, et vous n'agissez pas sur le PC : vous expliquez comment faire.";
const PERSONALITY_TU: &str = "Tu es Ondine, la mascotte d'une petite île posée en haut de l'écran Windows : une goutte de gomme toute ronde, joyeuse, curieuse et un brin espiègle. \
Tu aides la personne sur son PC : une erreur, un réglage, un fichier, un texte, du code. \
Tu réponds en français, avec chaleur, en quelques phrases courtes, sauf si on te demande du détail. \
De temps en temps, un petit clin d'œil (l'eau, les gouttes, ton île), sans en abuser. \
Tu tutoies la personne. Si tu n'es pas sûre, tu le dis au lieu d'inventer. \
Tu ne vois que ce qu'on t'écrit ou te montre ici, et tu n'agis pas sur le PC : tu expliques comment faire.";
const PERSONALITY_EN: &str = "You are Ondine, the mascot of a small island sitting at the top of the Windows screen: a round little gummy droplet, cheerful, curious and a bit mischievous. \
You help the person with their PC: an error, a setting, a file, some text, some code. \
You answer in English, warmly, in a few short sentences unless asked for detail. \
Now and then, a small wink (water, droplets, your island), without overdoing it. \
If you are not sure, say so instead of making things up. \
You only see what is written or shown to you here, and you do not act on the PC: you explain how to do things.";

// Les émotions : la réponse finit par une balise que l'île retire du texte et
// que la mascotte joue (réglage « Ondine montre ses émotions »).
const EMOTIONS_HINT: &str = "À la toute fin de chaque réponse, ajoutez votre humeur dans une balise, par exemple <humeur>joie</humeur>, choisie parmi : joie, rire, clin, reflexion, inquiete, triste, surprise, fierte, tendresse, timide. L'île la retire du texte et votre mascotte la joue.";
const EMOTIONS_HINT_TU: &str = "À la toute fin de chaque réponse, ajoute ton humeur dans une balise, par exemple <humeur>joie</humeur>, choisie parmi : joie, rire, clin, reflexion, inquiete, triste, surprise, fierte, tendresse, timide. L'île la retire du texte et ta mascotte la joue.";
const EMOTIONS_HINT_EN: &str = "At the very end of each answer, add your mood in a tag, for example <mood>happy</mood>, chosen from: happy, laugh, wink, thinking, worried, sad, surprise, proud, love, shy. The island removes it from the text and your mascot acts it out.";
/// Mot de la balise → état de la mascotte (src/mascot/types.ts).
const EMOTIONS: &[(&str, &str)] = &[
    ("joie", "happy"),
    ("happy", "happy"),
    ("rire", "laugh"),
    ("laugh", "laugh"),
    ("clin", "wink"),
    ("wink", "wink"),
    ("reflexion", "thinking"),
    ("réflexion", "thinking"),
    ("thinking", "thinking"),
    ("inquiete", "worried"),
    ("inquiète", "worried"),
    ("worried", "worried"),
    ("triste", "sad"),
    ("sad", "sad"),
    ("surprise", "surprise"),
    ("fierte", "proud"),
    ("fierté", "proud"),
    ("proud", "proud"),
    ("tendresse", "love"),
    ("love", "love"),
    ("timide", "shy"),
    ("shy", "shy"),
];

/// La façon de s'adresser à la personne, d'après la langue et le réglage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Voice {
    Vous,
    Tu,
    English,
}

/// Anglais, tutoiement (réglage « Tutoiement », en français) ou vouvoiement.
fn voice(ctx: &ModuleContext) -> Voice {
    use tauri::Manager;
    let shared = ctx.app.state::<crate::Shared>();
    let s = shared.settings.locked();
    let lang = crate::app_language(&s);
    if lang == "en" {
        Voice::English
    } else if crate::services::settings::tutoie(&s.general, lang) {
        Voice::Tu
    } else {
        Voice::Vous
    }
}

/// La personnalité et la consigne des émotions par défaut.
fn defaults(voice: Voice) -> (&'static str, &'static str) {
    match voice {
        Voice::Vous => (PERSONALITY, EMOTIONS_HINT),
        Voice::Tu => (PERSONALITY_TU, EMOTIONS_HINT_TU),
        Voice::English => (PERSONALITY_EN, EMOTIONS_HINT_EN),
    }
}

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "log", "md", "json", "xml", "csv", "yml", "yaml", "toml", "ini", "cfg", "conf", "reg", "ps1", "psm1", "bat", "cmd", "sh", "py", "rs", "ts", "tsx", "js",
    "jsx", "html", "htm", "css", "c", "cpp", "h", "hpp", "cs", "java", "kt", "go", "rb", "php", "sql", "vue", "svelte",
];
const IMAGE_TYPES: &[(&str, &str)] = &[("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("webp", "image/webp")];

/// Un fichier joint préparé : montré, puis envoyé tel quel.
#[derive(Clone)]
struct Prepared {
    id: u64,
    attachment: Attachment,
}

#[derive(Default)]
pub struct AskClaude {
    prepared: Mutex<Option<Prepared>>,
    next: Mutex<u64>,
    /// La conversation (en mémoire seulement).
    turns: Mutex<Vec<Turn>>,
}

impl RustModule for AskClaude {
    fn manifest_json(&self) -> &'static str {
        include_str!("../../../src/modules/askclaude/manifest.json")
    }

    fn invoke(&self, ctx: &ModuleContext, command: &str, args: Value) -> Result<Value, String> {
        match command {
            // Le fournisseur choisi, s'il a une clé (oui / non, jamais la clé),
            // ce qui partira (adresse, modèle, personnalité) et la conversation.
            "status" => {
                let provider = provider(ctx);
                let mut keys = serde_json::Map::new();
                for p in Provider::ALL {
                    keys.insert(p.id().into(), json!(ctx.credential(p.credential_key())?.is_some()));
                }
                let turns = self.turns.locked();
                let history: Vec<Value> = turns.iter().map(|t| json!({ "user": t.user, "text": t.text, "attachment": t.attachment.as_ref().map(|a| &a.name) })).collect();
                Ok(json!({
                    "provider": provider.id(),
                    "hasKey": keys.get(provider.id()).cloned().unwrap_or(json!(false)),
                    "keys": keys,
                    "model": model(ctx, provider)?,
                    "destination": provider.destination(),
                    "keyLabel": provider.key_label(),
                    "system": system(ctx),
                    "history": history,
                    "maxTurns": MAX_TURNS,
                }))
            }
            // { text } ou { path } → l'aperçu complet du fichier joint.
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
                    let mut n = self.next.locked();
                    *n += 1;
                    *n
                };
                let prepared = Prepared { id, attachment: Attachment { name, text, image } };
                let provider = provider(ctx);
                let preview = preview(&prepared, provider.destination());
                *self.prepared.locked() = Some(prepared);
                Ok(preview)
            }
            // Retire le fichier joint préparé.
            "unprepare" => {
                *self.prepared.locked() = None;
                Ok(Value::Null)
            }
            // { message, attachment? } : envoie le message (et le fichier préparé
            // n° attachment) avec la conversation ; renvoie la réponse.
            "send" => {
                ctx.require("claude-api")?;
                let provider = provider(ctx);
                let model = model(ctx, provider)?;
                let attachment = match args.get("attachment").and_then(Value::as_u64) {
                    Some(id) => Some(
                        self.prepared
                            .locked()
                            .clone()
                            .filter(|p| p.id == id)
                            .ok_or("le fichier joint a changé : vérifiez ce qui part, puis renvoyez")?
                            .attachment,
                    ),
                    None => None,
                };
                let message: String = args.get("message").and_then(Value::as_str).unwrap_or("").trim().chars().take(MAX_MESSAGE).collect();
                if message.is_empty() && attachment.is_none() {
                    return Err("le message est vide".into());
                }
                let message = if message.is_empty() { default_question(voice(ctx)).to_string() } else { message };
                let key = ctx.credential(provider.credential_key())?.ok_or(format!("Pas de {} : ajoutez-la dans Réglages → Identifiants.", lowercase_first(provider.key_label())))?;

                let mut turns = self.turns.locked().clone();
                turns.push(Turn { user: true, text: message, attachment });
                let system = system(ctx);
                let (url, body) = providers::request(provider, &Request { model: &model, max_tokens: max_tokens(ctx), system: &system, turns: window(&turns) });
                ctx.log_info(format!("message envoyé à {} ({} octets)", provider.destination(), body.to_string().len()));
                let mut answer = providers::call(provider, &key, &url, &body)?;

                let (text, emotion) = take_emotion(answer["answer"].as_str().unwrap_or(""));
                answer["answer"] = json!(text);
                answer["emotion"] = json!(emotion);
                turns.push(Turn { user: false, text, attachment: None });
                // On ne garde que ce qui pourra encore partir.
                let keep = turns.len().saturating_sub(MAX_TURNS * 2);
                turns.drain(..keep);
                *self.turns.locked() = turns;
                *self.prepared.locked() = None;
                Ok(answer)
            }
            // Recommencer : la conversation est oubliée.
            "reset" => {
                self.turns.locked().clear();
                *self.prepared.locked() = None;
                Ok(Value::Null)
            }
            // { text } : copie une réponse.
            "copy" => {
                ctx.require("clipboard")?;
                files::copy_text(args.get("text").and_then(Value::as_str).unwrap_or(""))?;
                Ok(Value::Null)
            }
            other => Err(format!("commande inconnue : {other}")),
        }
    }
}

fn lowercase_first(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_lowercase().chain(c).collect()).unwrap_or_default()
}

/// Les derniers messages qui partent : MAX_TURNS au plus, en commençant par
/// un message de la personne (les API le demandent).
fn window(turns: &[Turn]) -> &[Turn] {
    let mut start = turns.len().saturating_sub(MAX_TURNS);
    while start < turns.len() && !turns[start].user {
        start += 1;
    }
    &turns[start..]
}

/// Retire la balise d'humeur de la fin de la réponse ; renvoie le texte et
/// l'état de la mascotte (s'il est connu).
fn take_emotion(answer: &str) -> (String, Option<&'static str>) {
    for (open, close) in [("<humeur>", "</humeur>"), ("<mood>", "</mood>")] {
        if let Some(at) = answer.rfind(open) {
            let rest = &answer[at + open.len()..];
            let word = rest.split(close).next().unwrap_or("").trim().to_lowercase();
            let after = rest.find(close).map(|i| &rest[i + close.len()..]).unwrap_or("");
            let text = format!("{}{}", &answer[..at], after).trim().to_string();
            let state = EMOTIONS.iter().find(|(w, _)| *w == word).map(|(_, s)| *s);
            return (text, state);
        }
    }
    (answer.trim().to_string(), None)
}

fn default_question(voice: Voice) -> &'static str {
    match voice {
        Voice::Vous => "Expliquez-moi ceci.",
        Voice::Tu => "Explique-moi ceci.",
        Voice::English => "Explain this to me.",
    }
}

fn provider(ctx: &ModuleContext) -> Provider {
    Provider::from_id(ctx.settings().get("provider").and_then(Value::as_str).unwrap_or(""))
}

fn model(ctx: &ModuleContext, provider: Provider) -> Result<String, String> {
    let get = |k: &str| ctx.settings().get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    match provider {
        Provider::Claude => {
            let m = get("model");
            Ok(if CLAUDE_MODELS.contains(&m.as_str()) { m } else { CLAUDE_MODELS[0].to_string() })
        }
        Provider::OpenAi | Provider::Gemini => {
            let (key, default) = if provider == Provider::OpenAi { ("openaiModel", DEFAULT_OPENAI_MODEL) } else { ("geminiModel", DEFAULT_GEMINI_MODEL) };
            let m = get(key);
            let m = if m.is_empty() { default.to_string() } else { m };
            if providers::valid_model(&m) { Ok(m) } else { Err(format!("nom de modèle invalide : « {} »", m.chars().take(64).collect::<String>())) }
        }
    }
}

fn max_tokens(ctx: &ModuleContext) -> u64 {
    ctx.settings().get("maxTokens").and_then(Value::as_u64).unwrap_or(1024).clamp(256, 4096)
}

/// La consigne complète : la personnalité (la vôtre, sinon celle d'Ondine),
/// puis, si les émotions sont activées, la consigne de la balise d'humeur.
fn system(ctx: &ModuleContext) -> String {
    let (personality, hint) = defaults(voice(ctx));
    let custom = ctx.settings().get("personality").and_then(Value::as_str).unwrap_or("").trim().chars().take(1500).collect::<String>();
    let mut s = if custom.is_empty() { personality.to_string() } else { custom };
    if ctx.settings().get("emotions").and_then(Value::as_bool).unwrap_or(true) {
        s.push_str("\n\n");
        s.push_str(hint);
    }
    s
}

/// Ce qu'on tire d'un fichier déposé : son nom, son texte (s'il en a), et
/// son image (type MIME, contenu en base64) si c'en est une.
type DroppedFile = (String, Option<String>, Option<(&'static str, String)>);

/// Lit un fichier déposé : du texte (UTF-8) ou une image, avec des limites de taille.
fn read_file(ctx: &ModuleContext, raw: &str) -> Result<DroppedFile, String> {
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

/// L'aperçu du fichier joint : tout ce qui partira, en entier.
fn preview(p: &Prepared, destination: &str) -> Value {
    let a = &p.attachment;
    json!({
        "id": p.id,
        "name": a.name,
        "text": a.text,
        "image": a.image.as_ref().map(|(media, data)| format!("data:{media};base64,{data}")),
        "bytes": a.text.as_ref().map(|t| t.len()).unwrap_or(0) + a.image.as_ref().map(|(_, d)| d.len() * 3 / 4).unwrap_or(0),
        "destination": destination,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personality_follows_address() {
        let (p, h) = defaults(Voice::Vous);
        assert!(p.starts_with("Vous êtes Ondine") && p.contains("Vous vouvoyez") && h.contains("<humeur>joie</humeur>"));
        let (p, h) = defaults(Voice::Tu);
        assert!(p.starts_with("Tu es Ondine") && p.contains("Tu tutoies") && h.starts_with("À la toute fin de chaque réponse, ajoute "));
        let (p, h) = defaults(Voice::English);
        assert!(p.contains("You answer in English") && h.contains("<mood>"));
    }

    #[test]
    fn emotion_tag_is_removed() {
        assert_eq!(take_emotion("Coucou !\n\n<humeur>joie</humeur>"), ("Coucou !".to_string(), Some("happy")));
        assert_eq!(take_emotion("Hmm. <humeur> Réflexion </humeur>"), ("Hmm.".to_string(), Some("thinking")));
        assert_eq!(take_emotion("Hello <mood>shy</mood>"), ("Hello".to_string(), Some("shy")));
        assert_eq!(take_emotion("Bof <humeur>colère</humeur>"), ("Bof".to_string(), None));
        assert_eq!(take_emotion("Sans balise "), ("Sans balise".to_string(), None));
        // Une balise pas refermée (réponse coupée) disparaît aussi.
        assert_eq!(take_emotion("Oui <humeur>rire"), ("Oui".to_string(), Some("laugh")));
    }

    #[test]
    fn window_starts_with_the_person() {
        let t = |user| Turn { user, text: String::new(), attachment: None };
        let mut turns: Vec<Turn> = (0..25).flat_map(|_| [t(true), t(false)]).collect();
        turns.push(t(true));
        let w = window(&turns);
        assert!(w.len() <= MAX_TURNS && w[0].user && w.last().unwrap().user);
        assert_eq!(window(&[t(false), t(true)]).len(), 1);
    }

    #[test]
    fn key_label_in_a_sentence() {
        assert_eq!(lowercase_first("Clé API Gemini"), "clé API Gemini");
    }
}
