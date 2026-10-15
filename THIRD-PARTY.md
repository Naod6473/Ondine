# Ce qui vient d'ailleurs

Ondine est sous licence MIT (voir [LICENSE](LICENSE)). Elle s'appuie sur ces
travaux, dont les licences sont respectées :

| Quoi | Où dans Ondine | Licence |
|------|----------------|---------|
| [Coucou](https://github.com/Louis-CFM/coucou) (Louis-CFM) | Astuces Win32 de la fenêtre et du démarrage, reprises et adaptées ; technique de la bande vivante des Réglages (une seule boucle de dessin, fond qui respire, particules écartées par la souris : ici des bulles et nos gouttes), réécrite (`src/settings/hero.ts`) ; carte Musique (aléatoire, répétition et volume du lecteur par sa session audio) ; en 1.2.4, la reconnaissance sur le PC (choix de sherpa-onnx et Parakeet, adresses épinglées des modèles, rééchantillonnage, découpage au calme, mots et tours de parole : `src-tauri/src/services/speech*.rs`), reprise et adaptée | MIT |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (k2-fsa) | Le moteur de la reconnaissance sur le PC (1.2.4), lié dans `ondine.exe` avec ce qu'il contient : [ONNX Runtime](https://github.com/microsoft/onnxruntime) (MIT), kaldi-native-fbank, kaldi-decoder, OpenFst, SentencePiece (Apache-2.0), KISS FFT (BSD-3-Clause), piper-phonemize (MIT) et eSpeak NG (GPL-3.0, partie synthèse vocale de sherpa-onnx qu'Ondine n'appelle pas : voir la note plus bas) | Apache-2.0 |
| [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) (NVIDIA), converti pour sherpa-onnx par k2-fsa | Le modèle de reconnaissance, **téléchargé au clic** (pas livré dans l'installateur) dans `%LOCALAPPDATA%\Ondine\Models` | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) : crédit à NVIDIA, affiché dans les Réglages (bloc « Parakeet sur le PC ») |
| [pyannote segmentation 3.0](https://huggingface.co/pyannote/segmentation-3.0) (pyannote), converti par k2-fsa | Séparation des voix des notes d'appel : qui parle quand. Téléchargé au clic avec Parakeet | MIT |
| [3D-Speaker CAM++](https://github.com/modelscope/3D-Speaker) (`campplus_sv_zh_en_16k-common_advanced`, Alibaba / ModelScope), converti par k2-fsa | Séparation des voix : l'empreinte de chaque voix. Téléchargé au clic avec Parakeet | Apache-2.0 |
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
