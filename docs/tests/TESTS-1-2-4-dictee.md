# Tests 1.2.4 — version 1.2.4 (la dictée partout, la pilule, les pages Voix)

Pour tester :

```
git fetch
git checkout version-1-2-4
npm install
npm run tauri dev
```

Coche chaque ligne qui marche ; pour les autres, note ce que tu vois (ou une
capture). Tout ce qui touche à Windows (crochet clavier, UI Automation,
collage, pilule, micro) a été écrit sous Linux et compilé pour Windows, mais
**n'a jamais tourné sur un vrai Windows** : les lignes **⚠** sont à regarder
en premier.

Avant de commencer : Réglages → Voix → Dictée → allumer « Dictée partout »
(coupée par défaut). Ouvre le Bloc-notes pour avoir un champ de texte.

---

## 1. Coupée par défaut

1. ☐ Sur une installation neuve (ou un profil sans réglage pour la dictée), la
   dictée est coupée : maintenir Ctrl droit ne fait rien, aucune pilule à
   l'écran, aucun point rouge.
2. ☐ La page Dictée dit « La dictée est coupée : rien n'écoute le clavier ni
   le micro. » et l'historique est vide.

## 2. La touche ⚠

1. ☐ **Maintenir** Ctrl droit dans le Bloc-notes, dire une phrase, relâcher :
   la pilule passe en écoute (goutte concentrée, point rouge, neuf bulles qui
   bougent avec la voix), puis « J'écris… », puis la phrase est collée là où
   était le curseur.
2. ☐ Les bulles : les graves (voix grave, « oooh ») font bouger surtout
   celles de gauche, les aigus (« sss », « iii ») celles de droite.
3. ☐ **Double appui** rapide sur Ctrl droit : mains libres. On peut lâcher la
   touche et parler ; la pilule montre Annuler et Coller. Un nouvel appui
   (ou « Coller ») colle ; « Annuler » ou Échap ne colle rien.
4. ☐ **Échap** pendant qu'on tient la touche : rien n'est collé, la pilule
   revient au repos.
5. ☐ **Raccourci** : tenir Ctrl droit + C (copier) dans le Bloc-notes : la
   copie marche normalement et aucune dictée ne part (annulée).
6. ☐ Un appui très court (taper Ctrl droit une fois) : rien n'est collé.
7. ☐ Réglage « Touche à maintenir » = Alt droit (Alt Gr), puis Maj droite,
   puis Ctrl + Windows : chacune marche ; avec Ctrl + Windows, le menu
   Démarrer **ne s'ouvre pas** au relâchement.
8. ☐ Alt Gr garde son usage pour taper @ # € quand la touche choisie est Ctrl
   droit.

## 3. Le collage et le presse-papiers ⚠

1. ☐ Copier « AAA » avant de dicter : après le collage de la dictée, Ctrl+V
   colle de nouveau « AAA » (le presse-papiers est rendu).
2. ☐ Win+V (historique de Windows) : la dictée **n'y est pas**.
3. ☐ L'onglet Presse-papiers d'Ondine : la dictée **n'y est pas**.
4. ☐ Dicter avec le bureau au premier plan (clic sur le fond d'écran) : rien
   n'est tapé, la pilule dit « Aucun champ de texte : votre dictée est dans
   le presse-papiers. » et Ctrl+V la colle ailleurs.
5. ☐ Même chose avec l'Explorateur (un fichier sélectionné) et avec une
   fenêtre d'Ondine au premier plan.
6. ☐ Le collage marche dans : Word, Outlook, Chrome / Edge (champ d'une
   page), Teams ou Slack, Windows Terminal, VS Code.
7. ☐ Raccourci « recoller » (Ctrl+Alt+Maj+V par défaut) : la dernière dictée
   est recollée. Sans dictée encore : « Pas encore de dictée à recoller. »

## 4. Les moteurs ⚠

1. ☐ Automatique sans Parakeet : la dictée de Windows est utilisée (la page
   Dictée dit « Reconnaissance : la dictée de Windows (en ligne). »).
2. ☐ « Reconnaissance vocale en ligne » coupée dans Paramètres Windows : la
   pilule montre l'erreur et un bouton « Ouvrir les Paramètres Windows » qui
   ouvre la bonne page.
3. ☐ Windows hors ligne : marche avec la voix installée (sinon message clair).
4. ☐ Parakeet choisi alors qu'il n'est pas installé : la pilule dit « La
   reconnaissance sur le PC n'est pas encore installée. » avec « Ouvrir les
   Réglages ».
5. ☐ API avec une clé OpenAI (Réglages → Identifiants) : la dictée est
   transcrite ; sans clé : « Pas de clé OpenAI ou Gemini pour la
   transcription par l'API. » ; le journal note l'envoi (destination, taille).
6. ☐ API avec seulement une clé Gemini : marche aussi.

## 5. La pilule ⚠

1. ☐ Au repos : une petite barre de verre en bas au centre ; les clics
   **à côté** passent aux fenêtres en dessous (la barre des tâches, une page).
2. ☐ Survol : la barre s'ouvre (Dicter, Enregistrer un appel si Notes d'appel
   est allumé, Réglages de la dictée), chaque bouton a son infobulle.
3. ☐ « Dicter » : mains libres ; parler, « Coller » : collé dans l'appli qui
   avait le clavier (la pilule ne prend jamais le focus).
4. ☐ « Réglages de la dictée » ouvre Réglages → Voix → Dictée.
5. ☐ « Place de la pilule » = À gauche / À droite : elle se met debout contre
   le bord, au milieu ; la goutte, les bulles et les boutons sont verticaux.
6. ☐ Deux écrans : la pilule s'ouvre sur l'écran où est la souris.
7. ☐ « Montrer la pilule au repos » coupé : rien à l'écran au repos, elle
   apparaît pendant la dictée seulement.
8. ☐ « Discrète en présentation » : PowerPoint en diaporama ou une vidéo en
   plein écran → la pilule au repos se cache ; elle revient pendant une
   dictée.
9. ☐ Gestionnaire des tâches : au repos, la pilule (WebView « Ondine ») est à
   0 % de processeur.
10. ☐ Windows → « Afficher les animations » coupé (ou réglage Calme de la
    mascotte) : les bulles sautent sans glisser, rien ne pulse.
11. ☐ Notes d'appel : « Enregistrer un appel » démarre l'enregistrement ; la
    pilule passe au corail avec le chronomètre ; « Arrêter » l'arrête.
    (Dépend de la branche Notes d'appel.)

## 6. Historique, dictionnaire, styles, statistiques

1. ☐ Page Dictée : « Bonjour <prénom> » (Réglages → Général → prénom), la
   touche choisie dans la phrase, les dictées du jour sous « Aujourd'hui »
   avec l'heure et l'appli.
2. ☐ Recherche dans l'historique, Copier (✓ un instant), Supprimer, « Effacer
   l'historique » (les statistiques restent).
3. ☐ « Garder l'historique » = Ne pas garder : rien n'est ajouté, mais le
   raccourci « recoller » marche encore et les statistiques comptent.
4. ☐ `%APPDATA%\Ondine\dictation.json` existe, rien d'autre n'est écrit.
5. ☐ Dictionnaire : ajouter « Supabase », dicter « supabase » → écrit
   « Supabase ». Remplacement « cloud code » → « Claude Code » : dicter
   « j'utilise cloud code » → « j'utilise Claude Code ».
6. ☐ Snippets à la voix : créer un snippet « signature » dans l'onglet
   Presse-papiers ; dicter « merci signature » → « merci » suivi du texte du
   snippet tel quel.
7. ☐ Styles : Outlook en Soigné, Slack en Naturel ; « Ajouter une appli
   ouverte… » liste les applis ouvertes.
8. ☐ Remise au propre coupée (défaut) : rien ne part vers l'IA (journal).
   Allumée avec une clé : « euh, alors, je, je voulais dire » devient une
   phrase propre dans Outlook ; Tel quel ne change rien ; sans réseau, le
   texte brut est collé au bout de 8 s au plus.
9. ☐ Statistiques : Semaine / Mois / Tout, mots, temps gagné, vitesse,
   dictées (dont mains libres), jours d'affilée, mots par jour sur 30 jours,
   « Où vous dictez » avec les applis.

## 7. Langue et tutoiement

1. ☐ Interface en anglais : pilule, messages, pages Voix et réglages du module
   en anglais.
2. ☐ « S'adresser à moi » = tu : « Maintiens Ctrl droit n'importe où, parle,
   relâche : c'est collé. », « Aucun champ de texte : ta dictée est dans le
   presse-papiers. »
