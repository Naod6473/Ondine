// Pas de console en version finale : l'île et l'icône de notification sont toute l'interface.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // « island.exe notify … » : un outil (hook de Claude Code…) prévient l'île
    // déjà ouverte. On n'ouvre PAS une deuxième île : on envoie et on s'arrête.
    match std::env::args().nth(1).as_deref() {
        Some("notify") => return island_lib::notify_cli(),
        // « island.exe mcp » : un agent (Claude Code, Codex, Gemini) nous parle en MCP.
        Some("mcp") => return island_lib::mcp_cli(),
        _ => {}
    }
    island_lib::run()
}
