# Ce qui vient d'ailleurs

Ondine est sous licence MIT (voir [LICENSE](LICENSE)). Elle s'appuie sur ces
travaux, dont les licences sont respectées :

| Quoi | Où dans Ondine | Licence |
|------|----------------|---------|
| [Coucou](https://github.com/Louis-CFM/coucou) (Louis-CFM) | Astuces Win32 de la fenêtre et du démarrage, reprises et adaptées | MIT |
| [Phosphor Icons](https://phosphoricons.com) | Pack d'icônes « Épurées » (`src/assets/icons-line/`, sauf claude, gemini et codex) | MIT ([texte](src/assets/icons-line/LICENSE-phosphor.txt)) |
| [Tauri](https://tauri.app) et ses plugins | Le socle de l'appli | MIT ou Apache-2.0 |
| [windows-rs](https://github.com/microsoft/windows-rs) | Les appels aux API de Windows | MIT ou Apache-2.0 |
| Crates Rust (serde, serde_json, trash, arboard, image, chrono, zip, getrandom, notify, sysinfo, ureq, keyring) | Voir `src-tauri/Cargo.toml` | MIT, Apache-2.0 ou les deux |
| Vite, TypeScript | Outils de construction (pas livrés dans l'appli) | MIT, Apache-2.0 |

## Images

- Les icônes en couleur des modules (`src/assets/icons/`) et les poses de la
  mascotte (`mascots/goutte/`) ont été créées pour Ondine, avec l'aide d'un
  générateur d'images.
- Les icônes des agents (Claude, Gemini, Codex) sont des icônes maison, pas les
  logos de ces marques. Claude, Gemini et Codex sont des marques de leurs
  propriétaires (Anthropic, Google, OpenAI) ; Ondine n'est affiliée à aucun d'eux.
