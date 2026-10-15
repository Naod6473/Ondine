# Tests Windows de la 1.2.4

Une liste par partie, environ 210 cases en tout. Rien de tout cela n'a tourné
sous Windows avant la PR. Les tests automatiques sont verts : interface, Rust,
et clippy pour Windows. Les Réglages, la carte Musique et les pages Voix ont
aussi été vus dans Chromium, en mode démo.

Pour tester :

```
git fetch
git checkout version-1-2-4
npm.cmd install
npm.cmd run tauri dev
```

Ordre conseillé, en commençant par ce qui risque le plus de casser :

1. [Parakeet sur le PC](TESTS-1-2-4-parole.md) : Réglages → Parler à Ondine →
   Voix et sons → Télécharger (environ 700 Mo). La première chose à essayer :
   si l'appli ne démarre pas ou plante au premier mot dicté, c'est la
   bibliothèque de reconnaissance.
2. [Dictée partout](TESTS-1-2-4-dictee.md) : Réglages → Voix → Dictée, activer,
   puis maintenir Ctrl droit dans le Bloc-notes, Word, un navigateur. La
   pilule, le collage, le presse-papiers rendu, les mains libres.
3. [Notes d'appel](TESTS-1-2-4-notes.md) : Réglages → Voix → Notes d'appel.
   Un appel test avec une vidéo YouTube qui parle et votre micro.
4. [Réglages et bandes vivantes](TESTS-1-2-4-fenetre.md) : chaque page, le
   thème clair, « Réduire les animations », le mode éco.
5. [Carte Musique](TESTS-1-2-4-musique.md) : avec Spotify, puis un navigateur
   (YouTube), puis un lecteur du Store.
6. [Les 4 extras](TESTS-1-2-4-extras.md) : limites du forfait (Claude Code et
   Codex), fichiers modifiés en direct (réinstaller les hooks une fois),
   modèle local (Ollama ou LM Studio), vos propres sons.

Déjà dans la branche depuis main : l'éclosion de l'île (#76).
