// Pas de console en version finale : l'île et l'icône de notification sont toute l'interface.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    island_lib::run()
}
