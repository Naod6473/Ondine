# Ce qui vient d'ailleurs

Ondine est sous licence MIT (voir [LICENSE](LICENSE)). Elle s'appuie sur ces
travaux, dont les licences sont respectées :

| Quoi | Où dans Ondine | Licence |
|------|----------------|---------|
| [Coucou](https://github.com/Louis-CFM/coucou) (Louis-CFM) | Astuces Win32 de la fenêtre et du démarrage, reprises et adaptées ; technique de la bande vivante des Réglages (une seule boucle de dessin, fond qui respire, particules écartées par la souris : ici des bulles et nos gouttes), réécrite (`src/settings/hero.ts`) ; carte Musique (aléatoire, répétition et volume du lecteur par sa session audio) ; en 1.2.4, la reconnaissance sur le PC (choix de sherpa-onnx et Parakeet, adresses épinglées des modèles, rééchantillonnage, découpage au calme, mots et tours de parole : `src-tauri/src/services/speech*.rs`), reprise et adaptée ; notes d'appel (1.2.4) : capture du son du PC en « loopback », mots en direct sur les pauses, assemblage des tours de parole (écho du micro, numérotation des voix), lecture du résumé en JSON, export Markdown ; technique de la dictée partout (touche tenue, double appui, collage avec presse-papiers rendu, champ de texte, bandes de fréquences de la pilule), reprises et adaptées ; en 1.2.4, les techniques des limites du forfait (ligne d'état de Claude Code, journaux de Codex) et du calcul des fichiers modifiés en direct (`agents_plan.rs`, `agents_live.rs`), réécrites | MIT |
| [winbar](https://github.com/laurennguyen1304/winbar) (laurennguyen1304) | En 1.2.5, l'idée de ne pas garder dans l'historique du presse-papiers une copie qui ressemble à une clé d'API ou un jeton ; motifs et code réécrits (`src-tauri/src/modules/clipboard_secrets.rs`) | MIT |
| [CodeIsland](https://github.com/wxtsky/CodeIsland) (wxtsky, macOS) | Agents IA (1.2.5) : idées de la liste de tâches de l'agent en barre de progression (`agents_todos.rs`, `todos-logic.ts`) et du silence quand la fenêtre de la session est déjà au premier plan (`agents_discreet.rs`), réécrites pour Windows | MIT |
| [windows-dynamic-island](https://github.com/nazimferragh/windows-dynamic-island) (Nazim Ferragh) | Idée et technique du « trou noir » (1.2.5) : suivre le glisser d'une fenêtre avec les événements MOVESIZESTART / MOVESIZEEND, noter sa place d'avant, la cacher (SW_HIDE) et la réafficher, filet de sécurité sur disque relu au démarrage, tri des fenêtres de Windows (`windowlife_hole.rs`, `platform/winlife.rs`), réécrits | MIT |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (k2-fsa) | Le moteur de la reconnaissance sur le PC (1.2.4), lié dans `ondine.exe` avec ce qu'il contient : [ONNX Runtime](https://github.com/microsoft/onnxruntime) (MIT), kaldi-native-fbank, kaldi-decoder, OpenFst, SentencePiece (Apache-2.0), KISS FFT (BSD-3-Clause), piper-phonemize (MIT) et eSpeak NG (GPL-3.0, partie synthèse vocale de sherpa-onnx qu'Ondine n'appelle pas : voir la note plus bas) | Apache-2.0 |
| [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) (NVIDIA), converti pour sherpa-onnx par k2-fsa | Le modèle de reconnaissance, **téléchargé au clic** (pas livré dans l'installateur) dans `%LOCALAPPDATA%\Ondine\Models` | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) : crédit à NVIDIA, affiché dans les Réglages (bloc « Parakeet sur le PC ») |
| [pyannote segmentation 3.0](https://huggingface.co/pyannote/segmentation-3.0) (pyannote), converti par k2-fsa | Séparation des voix des notes d'appel : qui parle quand. Téléchargé au clic avec Parakeet | MIT |
| [3D-Speaker CAM++](https://github.com/modelscope/3D-Speaker) (`campplus_sv_zh_en_16k-common_advanced`, Alibaba / ModelScope), converti par k2-fsa | Séparation des voix : l'empreinte de chaque voix. Téléchargé au clic avec Parakeet | Apache-2.0 |
| [windows-dynamic-island](https://github.com/nazimferragh/windows-dynamic-island) (Nazim Ferragh) et [PILLAR](https://github.com/warpirate/pillar-dynamic-island-for-windows) (warpirate) | Technique de lecture des notifications des autres applis sans paquet du Store (1.2.5) : `UserNotificationListener`, demande d'accès, relecture régulière du Centre de notifications avec repérage des nouvelles par id, texte du modèle ToastGeneric, logo par `AppInfo.DisplayInfo`, ouverture de l'appli par `shell:AppsFolder` (`platform/winnotifs.rs`, `modules/winnotifs.rs`), réécrite | MIT |
| [Phosphor Icons](https://phosphoricons.com) | Pack d'icônes « Épurées » (`src/assets/icons-line/`, sauf claude, gemini et codex) | MIT ([texte](src/assets/icons-line/LICENSE-phosphor.txt)) |
| [Tauri](https://tauri.app) et ses plugins | Le socle de l'appli | MIT ou Apache-2.0 |
| [windows-rs](https://github.com/microsoft/windows-rs) | Les appels aux API de Windows | MIT ou Apache-2.0 |
| Crates Rust (serde, serde_json, trash, arboard, image, chrono, zip, getrandom, notify, sysinfo, ureq, keyring, qrcode) | Voir `src-tauri/Cargo.toml` | MIT, Apache-2.0 ou les deux |
| Vite, TypeScript | Outils de construction (pas livrés dans l'appli) | MIT, Apache-2.0 |

## Images

- Les icônes en couleur des modules (`src/assets/icons/`) ont été créées pour
  Ondine, avec l'aide d'un générateur d'images.
- Les icônes des agents (Claude, Gemini, Codex) sont des icônes maison, pas les
  logos de ces marques. Claude, Gemini et Codex sont des marques de leurs
  propriétaires (Anthropic, Google, OpenAI) ; Ondine n'est affiliée à aucun d'eux.

## Reconnaissance sur le PC (1.2.4)

- Les modèles ne font pas partie d'Ondine ni de son installateur : ils sont
  téléchargés depuis Hugging Face, à une révision fixe, seulement quand vous
  cliquez sur « Télécharger », puis vérifiés (taille et SHA-256).
- Parakeet est publié par NVIDIA sous licence CC-BY-4.0 : le crédit est
  affiché à côté du bouton de téléchargement.
- La bibliothèque précompilée de sherpa-onnx contient aussi sa synthèse
  vocale, qui s'appuie sur eSpeak NG (GPL-3.0). Ondine n'appelle que la
  reconnaissance et la séparation des voix ; l'éditeur de liens de Windows
  écarte le code qui n'est jamais appelé, mais la présence ou non de morceaux
  d'eSpeak NG dans `ondine.exe` reste à vérifier sur la construction Windows
  (carte de l'édition de liens) avant de publier.
