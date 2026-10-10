# Tests Windows 1.2.2 : chat Équipe

Il faut **deux PC Windows appairés** (onglet Équipe, voir TESTS-1-2-2-reseau.md),
idéalement un troisième pour le salon. Le protocole et l'historique chiffré sont
testés sur Linux (`cargo test team`) ; ici, ce qui touche Windows et l'île.

| # | À faire | Résultat attendu |
|---|---------|------------------|
| 1 | Onglet Équipe sur A : bouton 💬 de l'en-tête. | La liste : « 👥 Toute l'équipe » (avec « N en ligne »), puis B avec sa pastille de présence. |
| 2 | Ouvrir B, taper « Salut », Entrée. | La bulle part à droite. Chez B : notification dans l'île compacte « 💬 A · Salut » avec **Répondre** et **Ouvrir**, sans « Accepter ». La pastille rouge sur 💬 compte 1. |
| 3 | Chez B : **Répondre**. | Une alerte s'ouvre avec les deux derniers messages et une zone de saisie qui a le clavier. Taper « Coucou », Entrée : « Envoyé » remplace l'alerte, et le clavier revient à l'appli d'avant (taper dans le Bloc-notes marche tout de suite). |
| 4 | Chez A, pendant que B tape (sans envoyer). | « B écrit… » avec trois gouttes, qui s'efface quelques secondes après l'arrêt de la frappe. |
| 5 | Chez B, ouvrir la conversation avec A. | Chez A, « Lu » apparaît sous son dernier message. |
| 6 | Survoler une bulle de B chez A, cliquer 😂. | Chez B : la mascotte de l'île rit ; la bulle montre 😂. Recliquer 😂 chez A l'enlève. |
| 7 | B : statut « Concentration » (ou un Pomodoro en cours). A envoie un message et une réaction. | Chez B : notification discrète (île compacte, ~4 s, pas d'alerte), la mascotte ne joue pas la réaction. |
| 8 | B : réglage « Calme » de la mascotte, ou « Effets d'animation » de Windows éteints. | Pas de sautillement des gouttes de « … écrit », pas d'animation d'arrivée des bulles, la mascotte ne joue pas les réactions. |
| 9 | A envoie « Regarde https://exemple.fr ». | Chez B, le lien est un bouton 🔗 ; **rien ne s'ouvre** tant qu'on ne clique pas ; un clic l'ouvre dans le navigateur par défaut. Un texte « file:///C:/Windows/System32/calc.exe » ou « ms-settings:privacy » reste du texte, sans bouton. |
| 10 | Conversation avec B ouverte chez A ; glisser un fichier de l'Explorateur sur l'île. | La première cible est « 💬 B ». Chez B : « Fichier proposé » à accepter (comme avant) ; les deux fils montrent une ligne 📤 / 📥 avec le nom du fichier. |
| 11 | Salon « Toute l'équipe » avec 3 PC : A écrit. | B et C le reçoivent, avec le nom de A en couleur au-dessus de la bulle. |
| 12 | Éteindre B, puis A lui écrit. | « Message non envoyé : B ne répond pas… » ; le texte reste dans la zone de saisie. Hors ligne, la zone est grisée. |
| 13 | Quitter Ondine sur A, la relancer. | Réglage par défaut : les conversations ont disparu. Aucun fichier `%APPDATA%\Ondine\team-chat.bin`. |
| 14 | Réglages → Équipe → Chat → « Garder l'historique du chat 7 jours » ; écrire ; quitter et relancer Ondine. | Les conversations sont revenues. `team-chat.bin` existe et ne contient aucun texte lisible (l'ouvrir dans le Bloc-notes). Gestionnaire d'identifiants : entrée `team-chat-key`. |
| 15 | Éteindre ce réglage. | En quelques secondes, `team-chat.bin` disparaît et l'entrée `team-chat-key` du Gestionnaire d'identifiants aussi ; les conversations en cours restent en mémoire. |
| 16 | Réglages → Équipe → Chat → éteindre « Montrer « … écrit » et « Lu » » sur B. | Ni « B écrit… » ni « Lu » chez A ; et B ne voit plus ceux de A. |
| 17 | 🧹 dans un fil. | La conversation est vidée (de ce PC seulement). |
| 18 | Tutoiement et anglais (Réglages → Général). | Les textes du chat suivent (« Discuter avec tes collègues », « Team chat », « … is typing… »). |
| 19 | Mode démo + onglet Équipe → 💬 → Léa ; écrire un message. Puis Réglages → scène « Message d'une collègue ». | Une fausse conversation avec Léa (un lien, une réaction ❤️, « Lu ») ; après l'envoi, « Léa écrit… » puis sa réponse. La scène montre la notification avec « Répondre ». Aucun réseau utilisé. |
