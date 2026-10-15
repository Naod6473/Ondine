# Tests 1.2.4 — branche `v124-notes` (Notes d'appel)

Pour tester :

```
git fetch
git checkout v124-notes
npm install
npm run tauri dev
```

Coche chaque ligne qui marche ; pour les autres, note ce que tu vois (ou une
capture). Les lignes **⚠** utilisent une API Windows (son du PC en
« loopback » WASAPI, fenêtre « Enregistrer sous ») que je n'ai pas pu lancer :
développé sous Linux, seul clippy Windows a tourné. À regarder en premier.

La page « Notes d'appel » est dans le groupe Voix des Réglages. Elle n'est
branchée qu'une fois la branche de la fenêtre des Réglages fusionnée (liste
`VOICE_PAGES`) : teste après cette fusion. Parakeet (sur le PC) n'écrit pour de
vrai qu'une fois la branche Parakeet fusionnée ; avant, le moteur « API » est
le seul qui produit du texte.

---

## 1. Démarrer, le point rouge, le rappel

1. ☐ Réglages → Voix → Notes d'appel : en haut, le bandeau de la page et le
   bouton « Enregistrer un appel ». À gauche la liste, à droite la note choisie.
2. ☐ Module désactivé : la page dit de l'activer (interrupteur en bas de la
   page) ; un clic sur « Enregistrer un appel » n'écoute rien.
3. ☐ Moteur « Parakeet » non téléchargé : « Enregistrer un appel » refuse avec
   un message clair qui renvoie au téléchargement de Parakeet. Rien n'écoute.
4. ☐ Moteur « API » sans clé OpenAI ou Gemini : refus clair, rien n'écoute.
5. ☐ **⚠** Un démarrage valide : l'île montre une pilule avec un **point rouge**
   qui respire, le temps qui avance et « Arrêter ». La notification
   « Prévenez les participants que vous enregistrez » s'affiche (à chaque
   début, pas seulement la première fois).
6. ☐ Le point rouge reste visible pendant tout l'appel, même en ouvrant un
   autre module de l'île. Réglage « Réduire les animations » : le point est fixe.
7. ☐ La page des Réglages montre aussi un bandeau rouge « Enregistrement » avec
   le temps écoulé.
8. ☐ « Arrêter » (île ou page) : le point rouge disparaît tout de suite ; la
   note passe à « La transcription s'écrit… ».
9. ☐ Pilule / bus : un `callnotes.start` puis `callnotes.stop` (depuis une
   règle ou la pilule de la branche dictée) démarre et arrête pareil.

## 2. Mic + son du PC

10. ☐ **⚠** Pendant un appel (Teams, Meet, Discord, ou une vidéo YouTube qui
    parle), ta voix ET le son du PC sont écrits. Casque ou haut-parleurs :
    les deux marchent.
11. ☐ **⚠** PC silencieux pendant de longues minutes puis quelqu'un parle :
    les heures des répliques restent justes (pas de décalage avec les tiennes).
12. ☐ **⚠** Sortie audio débranchée ou introuvable : l'enregistrement démarre
    quand même avec le micro seul, et la note dit que le son du PC manquait.
13. ☐ **⚠** Micro débranché pendant l'appel : l'enregistrement s'arrête seul
    et la note s'écrit avec ce qui a été entendu.

## 3. Mots en direct et transcription

14. ☐ Avec Parakeet : les mots apparaissent en direct dans la note pendant
    l'appel (par petits morceaux, à chaque pause).
15. ☐ Avec l'API : pas de mots en direct (l'audio ne part qu'une fois, à la
    fin) ; la page le dit.
16. ☐ À la fin : la transcription personne par personne. Ta voix = « Vous » ;
    les voix du PC = « Personne 2 », « Personne 3 »… (avec Parakeet ; avec
    l'API, les voix du PC ne sont pas séparées : toutes en « Personne 2 »).
    Pendant l'appel, les mots en direct du PC portent « Le PC ».
17. ☐ Clic sur une personne → renommer (« Marc ») : toutes ses répliques et
    ses tâches suivent. Nom vide ou de plus de 40 caractères : refusé.
18. ☐ Clic sur le titre → renommer. Un résumé écrit ensuite ne l'écrase pas.
19. ☐ L'audio est effacé dès que la transcription est écrite : dossier
    `%TEMP%\Ondine-callnotes` vide après coup.
20. ☐ Ondine fermée pendant un appel puis relancée : avec Parakeet, la note
    s'écrit toute seule ; avec l'API, elle est marquée « À réessayer » et
    « Réessayer » l'écrit.

## 4. Résumé, tâches, export

21. ☐ Réglage « Résumé automatique » désactivé par défaut. Bouton « Écrire le
    résumé » : résumé, points clés et tâches (avec qui) par l'IA de Parler à
    Ondine. La page dit avant ce qui part (le texte, jamais l'audio, vers quel
    service).
22. ☐ « Résumé automatique » activé : le résumé s'écrit seul après la
    transcription.
23. ☐ Cocher une tâche : elle est barrée, et le reste après réouverture.
24. ☐ « Copier » : le Markdown (titre, date, personnes, résumé, points, tâches,
    transcription) est dans le presse-papiers.
25. ☐ **⚠** « Exporter » : la fenêtre « Enregistrer sous » s'ouvre avec un nom
    `.md` ; le fichier est écrit. Un dossier exclu dans Confidentialité :
    refusé.
26. ☐ « Envoyer vers Notes » : une note et une note par tâche ouverte
    apparaissent dans le module Notes.
27. ☐ « Supprimer » : la note part à la Corbeille, avec « Annuler » qui la
    rend.
28. ☐ Les notes sont dans `%APPDATA%\Ondine\callnotes\` (un JSON par note).

## 5. Langues

29. ☐ Réglages → Langue en anglais : page, pilule et rappel en anglais ;
    « You », « Person 2 ».
30. ☐ Tutoiement : « Préviens les participants que tu enregistres », « Toi ».
