# Tests Windows 1.2.2 : voix, île épurée, recherche web

À faire sur Windows (rien de ceci ne peut tourner dans le conteneur Linux).

## Île épurée
1. ☐ Ouvrir Parler à Ondine : plus aucune note sous le champ, plus de « Voir la personnalité ».
2. ☐ Réglages → Parler à Ondine → Général : bloc « Ce qui part » (destination, 20 messages, noms de fichiers, outils du PC, voix).
3. ☐ Réglages → Parler à Ondine → Personnalité et affichage : « Voir la consigne exacte » montre la consigne complète (personnalité + humeurs + outils).

## Recherche web
4. ☐ Lanceur (Alt+Espace), taper « météo lyon » : dernière ligne « Rechercher « météo lyon » sur Google ». ↓ jusqu'à elle puis Entrée : le navigateur par défaut ouvre `https://www.google.com/search?q=m%C3%A9t%C3%A9o+lyon`.
5. ☐ Réglages → Lanceur → Moteur de recherche = DuckDuckGo, Bing, Qwant, Ecosia : la ligne et l'adresse suivent.
6. ☐ Taper un texte qui ne trouve rien : « Rien trouvé. » puis la ligne de recherche web, Entrée l'ouvre directement.
7. ☐ Demander à Ondine « cherche sur le web les horaires de la piscine » : carte « Ondine voudrait chercher « … » sur le web » ; Faire ouvre le navigateur, Annuler n'ouvre rien.

## Voix (reconnaissance de Windows)
8. ☐ Paramètres Windows → Confidentialité → Voix : « Reconnaissance vocale en ligne » ACTIVÉE ; Microphone : « applications de bureau » autorisées.
9. ☐ Ctrl+Alt+V (île fermée) : l'île s'ouvre sur Parler à Ondine, la mascotte sursaute puis tend l'oreille, point rouge + bulle « J'écoute… », les mots s'écrivent en direct ; au silence la question part et Ondine répond.
10. ☐ Pendant l'écoute, Échap : rien ne part, la bulle disparaît.
11. ☐ Réglages → Mode du micro = Maintenir pour parler : garder Ctrl+Alt+V enfoncé en parlant, relâcher → la question part.
12. ☐ « Reconnaissance vocale en ligne » COUPÉE dans Windows : Ctrl+Alt+V → message clair (activer le réglage Windows ou choisir l'API), pas de plantage.
13. ☐ Langue de l'appli en anglais : la dictée comprend l'anglais (si la voix anglaise est installée), sinon celle de Windows.
14. ☐ Bouton 🎙️ Parler dans l'onglet : même écoute ; « ⏹ Terminer » arrête et envoie.
15. ☐ Le halo : vérifier que `voice.level` arrive (journal du bus ou halo branché par la zone halos) et retombe à 0 à la fin.

## Voix (transcription par l'API)
16. ☐ Reconnaissance = API, fournisseur GPT avec clé OpenAI : parler → « J'écris ce que vous avez dit… » puis la question part. Personne ne parle 6 s : « Je n'ai rien entendu. » et rien n'est envoyé.
17. ☐ Fournisseur Gemini (clé Gemini) : idem.
18. ☐ Fournisseur Claude sans clé OpenAI ni Gemini : message « Claude n'écoute pas l'audio… ».

## Réponse en « plop plip »
19. ☐ Une réponse s'écrit petit à petit avec des petits sons de gouttes ; plus graves sur une réponse triste, plus aigus joyeuse.
20. ☐ Changer de mascotte (Guimauve, Dragée, Flamme, Nuage) : le timbre change.
21. ☐ Réglages : couper les petits sons, ou volume 0 → muet ; volume 100 → plus fort.
22. ☐ Windows « Effets d'animation » coupés, ou mascotte Calme : le texte s'affiche d'un coup.
23. ☐ La bouche bouge pendant l'écriture si la zone mascottes a branché `mascot.talk` (sinon rien ne casse).

## Commandes rapides, mains libres, Regarde ça, discrétion
24. ☐ Dire ou écrire « volume 30 », « minuteur 10 minutes », « musique suivante », « pause », « note : acheter du pain », « luminosité 50 », « mode sombre » : fait tout de suite, sans clé, bulle « C'est fait ! » avec la ligne ⚡.
25. ☐ « Pourquoi le volume est à 30 ? » part bien à l'IA (pas une commande).
26. ☐ Mains libres activé : après une réponse à une question dite à voix haute, le micro se rallume ~4 s ; personne ne parle → il se coupe.
27. ☐ Raccourci « Regarde ça » = Ctrl+Alt+G, dans une autre fenêtre : l'image de CETTE fenêtre est jointe (aperçu), le texte dit est dans le champ, rien ne part avant « Envoyer ».
28. ☐ En visio (Teams/Zoom qui utilise le micro), en présentation (PowerPoint plein écran) ou pendant un Pomodoro : Ctrl+Alt+V → « Ondine reste discrète », le micro ne s'ouvre pas, pas de plops.
29. ☐ Ondine sur le bureau avec l'onglet Parler à Ondine dans sa bulle : Ctrl+Alt+V ouvre SA bulle (pas l'île), une seule question part.
30. ☐ Raccourci déjà pris par un autre logiciel : notification claire.
31. ☐ Aucun fichier audio ou image n'apparaît sur le disque (%APPDATA%\Ondine, %TEMP%) après ces tests.
