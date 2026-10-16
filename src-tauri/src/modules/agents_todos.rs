// La liste de tâches de l'agent, en barre de progression (onglet Agents IA, 1.2.4).
//
// Quand Claude Code met à jour sa liste de tâches, la carte de sa session
// montre « 3/7 » et la tâche en cours (« Lance les tests »). Idée reprise de
// CodeIsland (wxtsky, MIT), réécrite (voir THIRD-PARTY.md).
//
// Les formes comprises (hook PostToolUse / AfterTool, comme les fichiers en
// direct : agents_live.rs) :
//   - la liste entière, à chaque fois :
//       Claude Code `TodoWrite` { todos: [{content, status, activeForm}] },
//       Codex `update_plan`     { plan:  [{step, status}] },
//       Gemini CLI `write_todos` { todos: [{description, status}] } ;
//   - des tâches par numéro (Claude Code plus récent) :
//       `TaskCreate` { subject, description?, activeForm? } (le numéro est
//       dans la réponse), `TaskUpdate` { taskId, status?, subject?,
//       activeForm? } (status « deleted » = retirée), `TaskList` (la
//       réponse donne la liste entière).
// Tout JSON inattendu est ignoré sans bruit (champ absent, mauvais type…).
//
// « ondine.exe notify » (cli.rs) n'envoie à l'île que le strict nécessaire :
// 50 tâches au plus, chaque texte sur une ligne, coupé à 120 caractères.
// L'île garde les listes en MÉMOIRE seulement (30 sessions au plus), les
// oublie à la fin de la session (SessionEnd, ou quand la session quitte le
// tableau) et n'en écrit rien dans le journal.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

/// Au plus ce nombre de tâches par liste.
pub const MAX_TASKS: usize = 50;
/// Chaque texte (tâche, tâche en cours) coupé à cette longueur.
pub const MAX_TEXT: usize = 120;
/// Au plus ce nombre de listes gardées (une par session).
const MAX_LISTS: usize = 30;

/// Une ligne de texte propre : sans caractères de contrôle, coupée.
fn cut(s: &str) -> String {
    let one: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let t = one.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() <= MAX_TEXT {
        return t;
    }
    let mut c: String = t.chars().take(MAX_TEXT - 1).collect();
    c.push('…');
    c
}

/// Le premier champ texte non vide parmi `keys`.
fn text_of(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v[k].as_str().map(cut).filter(|s| !s.is_empty()))
}

/// L'état d'une tâche, ramené à trois (plus « deleted » et « cancelled »).
/// None : absent ou inconnu.
fn status_of(v: &Value) -> Option<&'static str> {
    let raw = v.as_str()?.trim().to_lowercase().replace(['-', ' '], "_");
    Some(match raw.as_str() {
        "pending" | "todo" | "not_started" | "open" => "pending",
        "in_progress" | "inprogress" | "active" | "running" | "doing" => "in_progress",
        "completed" | "complete" | "done" | "finished" => "completed",
        "deleted" | "removed" => "deleted",
        "cancelled" | "canceled" | "skipped" => "cancelled",
        _ => return None,
    })
}

/// Le numéro d'une tâche : un texte ou un nombre, 40 caractères au plus.
fn id_of(v: &Value) -> Option<String> {
    let s = match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    let s: String = s.chars().filter(|c| !c.is_control()).take(40).collect();
    (!s.is_empty()).then_some(s)
}

/// Une tâche d'une liste entière (TodoWrite, update_plan, write_todos, TaskList).
fn item(v: &Value) -> Option<Value> {
    let text = text_of(v, &["content", "subject", "step", "description", "title", "text"])?;
    let status = v.get("status").and_then(status_of).unwrap_or("pending");
    if matches!(status, "deleted" | "cancelled") {
        return None; // ni comptée ni montrée
    }
    let mut out = json!({ "text": text, "status": status });
    if let Some(a) = text_of(v, &["activeForm", "active_form"]) {
        out["active"] = json!(a);
    }
    if let Some(id) = v.get("id").and_then(id_of) {
        out["id"] = json!(id);
    }
    Some(out)
}

/// La liste entière : au plus MAX_TASKS tâches.
fn whole(list: &[Value]) -> Value {
    json!({ "mode": "replace", "tasks": list.iter().filter_map(item).take(MAX_TASKS).collect::<Vec<_>>() })
}

/// Le numéro donné par Claude Code dans la réponse de TaskCreate :
/// `{task: {id}}`, `{id}`, `{taskId}`, ou un texte « Task #3 created… ».
fn created_id(response: &Value) -> Option<String> {
    if let Some(id) = [&response["task"]["id"], &response["id"], &response["taskId"], &response["task_id"]].into_iter().find_map(id_of) {
        return Some(id);
    }
    let text = response.as_str().or(response["message"].as_str()).or(response["result"].as_str())?;
    let after = text.split('#').nth(1)?;
    let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
    (!digits.is_empty()).then_some(digits)
}

/// La mise à jour de la liste portée par un événement d'outil, sous la forme
/// envoyée à l'île : `{mode: "replace", tasks}` (la liste entière) ou
/// `{mode: "patch", tasks: [{id?, text?, active?, status?}]}` (une tâche par
/// numéro ; sans numéro, l'île lui donne le suivant). None : pas un outil de
/// tâches, ou rien d'exploitable.
pub fn update_of(hook: &Value) -> Option<Value> {
    let event = hook["hook_event_name"].as_str().unwrap_or("");
    if !matches!(event, "PostToolUse" | "AfterTool") {
        return None;
    }
    let tool = hook["tool_name"].as_str().or(hook["toolName"].as_str()).unwrap_or("");
    // Codex donne parfois ses paramètres en texte JSON : on les relit.
    let input = match &hook["tool_input"] {
        Value::String(s) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        v => v.clone(),
    };
    let response = &hook["tool_response"];
    match tool {
        "TodoWrite" | "write_todos" | "update_plan" => {
            let list = input["todos"].as_array().or(input["plan"].as_array())?;
            Some(whole(list))
        }
        "TaskList" => {
            let list = response["tasks"].as_array().or(response.as_array())?;
            Some(whole(list))
        }
        "TaskCreate" => {
            let text = text_of(&input, &["subject", "content", "title", "description"])?;
            let mut t = json!({ "text": text, "status": input.get("status").and_then(status_of).unwrap_or("pending") });
            if let Some(a) = text_of(&input, &["activeForm", "active_form"]) {
                t["active"] = json!(a);
            }
            if let Some(id) = created_id(response) {
                t["id"] = json!(id);
            }
            Some(json!({ "mode": "patch", "tasks": [t] }))
        }
        "TaskUpdate" => {
            let id = [&input["taskId"], &input["task_id"], &input["id"]].into_iter().find_map(id_of)?;
            let mut t = json!({ "id": id });
            if let Some(s) = input.get("status").and_then(status_of) {
                t["status"] = json!(s);
            }
            if let Some(text) = text_of(&input, &["subject", "content", "title"]) {
                t["text"] = json!(text);
            }
            if let Some(a) = text_of(&input, &["activeForm", "active_form"]) {
                t["active"] = json!(a);
            }
            Some(json!({ "mode": "patch", "tasks": [t] }))
        }
        _ => None,
    }
}

/// Ce que « ondine.exe notify » envoie à l'île pour un outil de tâches :
/// la session et la mise à jour, rien d'autre du hook.
pub fn compact(source: &str, hook: &Value) -> Option<Value> {
    let todos = update_of(hook)?;
    Some(json!({
        "v": 1,
        "source": source,
        "hook": { "hook_event_name": hook["hook_event_name"], "session_id": hook["session_id"], "cwd": hook["cwd"] },
        "todos": todos,
    }))
}

// ── Dans l'île ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
struct Task {
    id: Option<String>,
    text: String,
    active: String,
    status: &'static str,
}

/// Ce que la carte de la session montre.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Summary {
    pub done: usize,
    pub total: usize,
    /// La tâche en cours (sa forme « en train de », sinon son texte).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
}

#[derive(Default)]
pub struct Store {
    lists: HashMap<String, (Vec<Task>, Instant)>,
    recent: VecDeque<Instant>,
}

/// Une tâche reçue de « ondine.exe notify », revérifiée (le canal ne fait pas confiance).
fn task_from(v: &Value) -> (Option<String>, Option<String>, Option<String>, Option<&'static str>) {
    let id = v.get("id").and_then(id_of);
    let text = v["text"].as_str().map(cut).filter(|s| !s.is_empty());
    let active = v["active"].as_str().map(cut).filter(|s| !s.is_empty());
    let status = v.get("status").and_then(status_of);
    (id, text, active, status)
}

impl Store {
    /// Au plus 20 mises à jour par seconde (au-delà : ignorées).
    pub fn allow(&mut self) -> bool {
        self.recent.retain(|t| t.elapsed() < Duration::from_secs(1));
        if self.recent.len() >= 20 {
            return false;
        }
        self.recent.push_back(Instant::now());
        true
    }

    /// Applique une mise à jour (`{mode, tasks}`) à la liste de la session.
    /// Faux : rien de compris.
    pub fn apply(&mut self, session: &str, update: &Value) -> bool {
        let Some(items) = update["tasks"].as_array() else { return false };
        let old = self.lists.get(session).map(|(l, _)| l.clone()).unwrap_or_default();
        let list = match update["mode"].as_str() {
            Some("replace") => {
                let mut list = Vec::new();
                for v in items.iter().take(MAX_TASKS) {
                    let (id, text, active, status) = task_from(v);
                    let Some(text) = text else { continue };
                    if matches!(status, Some("deleted" | "cancelled")) {
                        continue;
                    }
                    // TaskList ne redonne pas toujours la forme « en train de » : on garde l'ancienne.
                    let kept = id.as_ref().and_then(|i| old.iter().find(|t| t.id.as_ref() == Some(i))).map(|t| t.active.clone());
                    list.push(Task { id, text, active: active.or(kept).unwrap_or_default(), status: status.unwrap_or("pending") });
                }
                list
            }
            Some("patch") => {
                let mut list = old;
                for v in items.iter().take(MAX_TASKS) {
                    let (id, text, active, status) = task_from(v);
                    let pos = id.as_ref().and_then(|i| list.iter().position(|t| t.id.as_ref() == Some(i)));
                    match (pos, status) {
                        (Some(p), Some("deleted" | "cancelled")) => {
                            list.remove(p);
                        }
                        (Some(p), _) => {
                            let t = &mut list[p];
                            if let Some(s) = status {
                                t.status = s;
                            }
                            if let Some(x) = text {
                                t.text = x;
                            }
                            if let Some(a) = active {
                                t.active = a;
                            }
                        }
                        (None, Some("deleted" | "cancelled")) => {}
                        // Une tâche inconnue : seulement si elle a un texte (sinon rien à montrer).
                        (None, _) => {
                            let Some(text) = text else { continue };
                            if list.len() >= MAX_TASKS {
                                continue;
                            }
                            // Sans numéro donné, le suivant (Claude Code numérote 1, 2, 3…).
                            let id = id.or_else(|| Some((list.iter().filter_map(|t| t.id.as_deref()?.parse::<u64>().ok()).max().unwrap_or(0) + 1).to_string()));
                            list.push(Task { id, text, active: active.unwrap_or_default(), status: status.unwrap_or("pending") });
                        }
                    }
                }
                list
            }
            _ => return false,
        };
        if !self.lists.contains_key(session) && self.lists.len() >= MAX_LISTS {
            let oldest = self.lists.iter().min_by_key(|(_, (_, at))| *at).map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                self.lists.remove(&k);
            }
        }
        self.lists.insert(session.to_string(), (list, Instant::now()));
        true
    }

    /// Ce que la carte montre (None : pas de liste, ou liste vide).
    pub fn summary(&self, session: &str) -> Option<Summary> {
        let (list, _) = self.lists.get(session)?;
        if list.is_empty() {
            return None;
        }
        let current = list.iter().find(|t| t.status == "in_progress").map(|t| if t.active.is_empty() { t.text.clone() } else { t.active.clone() });
        Some(Summary { done: list.iter().filter(|t| t.status == "completed").count(), total: list.len(), current })
    }

    /// La fin de la session : sa liste est oubliée.
    pub fn forget(&mut self, session: &str) {
        self.lists.remove(session);
    }

    /// Garde les listes des sessions encore au tableau, et celles reçues
    /// depuis moins de `grace` (une session pas encore vue par un autre hook).
    pub fn retain(&mut self, known: impl Fn(&str) -> bool, grace: Duration) {
        self.lists.retain(|k, (_, at)| known(k) || at.elapsed() < grace);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(tool: &str, input: Value, response: Value) -> Value {
        json!({ "hook_event_name": "PostToolUse", "session_id": "s", "cwd": "C:\\p", "tool_name": tool, "tool_input": input, "tool_response": response })
    }

    fn apply(s: &mut Store, hook: Value) -> Option<Summary> {
        let u = update_of(&hook).expect("compris");
        assert!(s.apply("claude-code:s", &u));
        s.summary("claude-code:s")
    }

    #[test]
    fn todowrite_gives_progress_and_current_task() {
        let mut s = Store::default();
        let todos = json!({ "todos": [
            { "content": "Lire le code", "status": "completed", "activeForm": "Lit le code" },
            { "content": "Écrire les tests", "status": "in_progress", "activeForm": "Écrit les tests" },
            { "content": "Lancer cargo", "status": "pending", "activeForm": "Lance cargo" },
        ] });
        let sum = apply(&mut s, post("TodoWrite", todos, Value::Null)).unwrap();
        assert_eq!(sum, Summary { done: 1, total: 3, current: Some("Écrit les tests".into()) });
        // Une nouvelle liste remplace l'ancienne.
        let sum = apply(&mut s, post("TodoWrite", json!({ "todos": [{ "content": "Fin", "status": "completed" }] }), Value::Null)).unwrap();
        assert_eq!((sum.done, sum.total, sum.current), (1, 1, None));
        // Liste vidée : plus rien à montrer.
        assert!(apply(&mut s, post("TodoWrite", json!({ "todos": [] }), Value::Null)).is_none());
    }

    #[test]
    fn task_tools_by_id() {
        let mut s = Store::default();
        apply(&mut s, post("TaskCreate", json!({ "subject": "Analyser", "activeForm": "Analyse" }), json!({ "task": { "id": "1", "subject": "Analyser" } })));
        apply(&mut s, post("TaskCreate", json!({ "subject": "Corriger" }), json!("Task #2 created successfully: Corriger")));
        // Sans numéro dans la réponse : le suivant.
        apply(&mut s, post("TaskCreate", json!({ "subject": "Vérifier" }), json!({ "ok": true })));
        let sum = apply(&mut s, post("TaskUpdate", json!({ "taskId": "1", "status": "in_progress" }), json!({ "success": true }))).unwrap();
        assert_eq!(sum, Summary { done: 0, total: 3, current: Some("Analyse".into()) });
        apply(&mut s, post("TaskUpdate", json!({ "taskId": "1", "status": "completed" }), Value::Null));
        let sum = apply(&mut s, post("TaskUpdate", json!({ "taskId": 3, "status": "in_progress", "activeForm": "Vérifie" }), Value::Null)).unwrap();
        assert_eq!(sum, Summary { done: 1, total: 3, current: Some("Vérifie".into()) });
        // Retirée.
        let sum = apply(&mut s, post("TaskUpdate", json!({ "taskId": "2", "status": "deleted" }), Value::Null)).unwrap();
        assert_eq!((sum.done, sum.total), (1, 2));
        // TaskList : la liste entière, la forme « en train de » gardée.
        let list = json!({ "tasks": [{ "id": "1", "subject": "Analyser", "status": "completed" }, { "id": "3", "subject": "Vérifier", "status": "in_progress" }] });
        let sum = apply(&mut s, post("TaskList", json!({}), list)).unwrap();
        assert_eq!(sum, Summary { done: 1, total: 2, current: Some("Vérifie".into()) });
        // Mise à jour d'une tâche inconnue sans texte : ignorée.
        let sum = apply(&mut s, post("TaskUpdate", json!({ "taskId": "99", "status": "completed" }), Value::Null)).unwrap();
        assert_eq!(sum.total, 2);
    }

    #[test]
    fn codex_and_gemini_plans() {
        let mut s = Store::default();
        let plan = json!({ "explanation": "x", "plan": [{ "step": "Explorer", "status": "completed" }, { "step": "Coder", "status": "in_progress" }] });
        let sum = apply(&mut s, post("update_plan", plan.clone(), Value::Null)).unwrap();
        assert_eq!(sum, Summary { done: 1, total: 2, current: Some("Coder".into()) });
        // Paramètres donnés en texte JSON.
        let sum = apply(&mut s, post("update_plan", json!(plan.to_string()), Value::Null)).unwrap();
        assert_eq!(sum.total, 2);
        let gemini = json!({ "hook_event_name": "AfterTool", "tool_name": "write_todos", "tool_input": { "todos": [{ "description": "A", "status": "cancelled" }, { "description": "B", "status": "in_progress" }] } });
        let sum = apply(&mut s, gemini).unwrap();
        assert_eq!(sum, Summary { done: 0, total: 1, current: Some("B".into()) });
    }

    #[test]
    fn unexpected_json_is_ignored() {
        assert!(update_of(&post("TodoWrite", json!({ "todos": "pas une liste" }), Value::Null)).is_none());
        assert!(update_of(&post("TaskUpdate", json!({ "status": "completed" }), Value::Null)).is_none());
        assert!(update_of(&post("TaskCreate", json!({}), Value::Null)).is_none());
        assert!(update_of(&post("Bash", json!({ "command": "ls" }), Value::Null)).is_none());
        assert!(update_of(&json!({ "hook_event_name": "Stop", "tool_name": "TodoWrite" })).is_none());
        // Éléments bizarres : sautés, statut inconnu = à faire.
        let u = update_of(&post("TodoWrite", json!({ "todos": [42, { "content": "" }, { "content": "ok", "status": "???" }] }), Value::Null)).unwrap();
        assert_eq!(u["tasks"], json!([{ "text": "ok", "status": "pending" }]));
        let mut s = Store::default();
        assert!(!s.apply("x", &json!({ "mode": "autre", "tasks": [] })));
        assert!(!s.apply("x", &json!({ "mode": "replace" })));
    }

    #[test]
    fn only_the_minimum_is_sent() {
        let long = "é".repeat(500);
        let todos: Vec<Value> = (0..80).map(|i| json!({ "content": format!("{i} {long}\n"), "status": "pending", "activeForm": long })).collect();
        let m = compact("claude-code", &post("TodoWrite", json!({ "todos": todos }), json!({ "oldTodos": [], "newTodos": [] }))).unwrap();
        let tasks = m["todos"]["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), MAX_TASKS);
        assert!(tasks.iter().all(|t| t["text"].as_str().unwrap().chars().count() <= MAX_TEXT && !t["text"].as_str().unwrap().contains('\n')));
        assert!(m["hook"].get("tool_input").is_none() && m["hook"].get("tool_response").is_none());
        assert!(m.to_string().len() < crate::cli::MAX_MESSAGE);
    }

    #[test]
    fn lists_are_forgotten() {
        let mut s = Store::default();
        s.apply("a", &json!({ "mode": "replace", "tasks": [{ "text": "x" }] }));
        s.apply("b", &json!({ "mode": "replace", "tasks": [{ "text": "y" }] }));
        s.forget("a");
        assert!(s.summary("a").is_none() && s.summary("b").is_some());
        s.retain(|_| false, Duration::from_secs(3600));
        assert!(s.summary("b").is_some()); // reçue il y a moins d'une heure
        s.retain(|_| false, Duration::ZERO);
        assert!(s.summary("b").is_none());
        for i in 0..40 {
            s.apply(&format!("s{i}"), &json!({ "mode": "replace", "tasks": [{ "text": "x" }] }));
        }
        assert_eq!(s.lists.len(), MAX_LISTS);
    }
}
