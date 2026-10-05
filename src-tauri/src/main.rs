// Pas de console en version finale : l'île et l'icône de notification sont toute l'interface.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // « island.exe notify … » : un outil (hook de Claude Code…) prévient l'île
    // déjà ouverte. On n'ouvre PAS une deuxième île : on envoie et on s'arrête.
    if std::env::args().nth(1).as_deref() == Some("notify") {
        island_lib::notify_cli();
        return;
    }
    island_lib::run()
}
