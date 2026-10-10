# Tests Windows 1.2.2 : module Équipe (réseau local)

Il faut **deux PC Windows sur le même réseau** (Wi-Fi ou câble), avec cette version.
Le protocole est testé sur Linux (`cargo test team`) ; ici, seulement ce qui touche Windows.

| # | À faire | Résultat attendu |
|---|---------|------------------|
| 1 | Installer, ne rien toucher. Réglages → Modules → Outils IT → Équipe. | Le module est **désactivé**. `netstat -ano \| findstr 4782` : rien n'écoute. |
| 2 | Activer Équipe sur les deux PC. | Le pare-feu de Windows demande l'autorisation pour Ondine (réseaux privés) : accepter. Un onglet 🤝 Équipe apparaît. `netstat` montre TCP 47821 et UDP 47820. |
| 3 | PC B : « 🔢 Mon code ». PC A : « ＋ Ajouter », taper l'adresse IP de B (affichée sous le code) et le code. | Les deux voient « Nouveau collègue » ; B apparaît dans la liste de A et A dans celle de B, avec une pastille verte (en moins d'une minute). |
| 4 | Refaire l'appairage avec un **code faux**. | « Appairage refusé » ; le code de B ne marche plus (un seul essai) : il faut cliquer de nouveau sur « Mon code ». |
| 5 | Allumer « 👁 Visible » sur B, « 🔎 Chercher sur le réseau » sur un 3e PC non appairé. | B apparaît dans « À proximité » (si le réseau n'isole pas les clients). |
| 6 | Gestionnaire d'identifiants Windows → Informations d'identification Windows. | Une entrée `io.github.naod6473.ondine` / `team-identity-key`. Redémarrer Ondine : les collègues sont toujours là et répondent (la clé a été relue). |
| 7 | A → fiche de B → 👋 Coucou, 👍, ☕. | Sur B : notification « 👋 Coucou ! » et la mascotte fait le geste. |
| 8 | A → « 🔔 Tu es dispo ? ». B répond « Dans 5 min ». | Alerte sur B avec 3 boutons ; A reçoit « Dans 5 min ». |
| 9 | A → « 🫧 Visite d'Ondine » avec un mot. | Sur B : alerte où la mascotte de A (à sa couleur) traverse et fait coucou, puis le mot. Avec « Calme » ou « Réduire les animations » de Windows : posée directement au milieu. |
| 10 | Glisser un fichier de l'Explorateur sur l'île de A, cible « B ». | Sur B : « Fichier proposé » avec Accepter / Refuser. Accepter : progression, puis « Fichier reçu » ; le fichier est dans `Téléchargements\Ondine`. Propriétés du fichier : « Ce fichier provient d'un autre ordinateur » (marque du Web). |
| 11 | Renvoyer le même fichier, l'accepter. | Nouveau nom « nom (2).ext », rien n'est écrasé. |
| 12 | « 📁 Dossier… » d'un petit dossier. | B reçoit `Dossier.zip` (rien n'est décompressé ni ouvert). |
| 13 | Taper un texte, « 💬 Envoyer le texte ». B accepte. | Le texte est dans le presse-papiers de B (Ctrl+V). |
| 14 | Changer son statut sur B (« En réunion ») ; lancer un Pomodoro sur B. | Chez A, la pastille de B change en moins d'une minute (orange, puis violet « Concentration »). |
| 15 | ☕ Café dans 5 min, 📊 Sondage (3 choix), 🍅 Pomodoro d'équipe, 📣 Annonce. | Chaque collègue en ligne reçoit l'alerte ; votes et réponses reviennent chez l'envoyeur ; « Rejoindre » lance le Minuteur. |
| 16 | IT : A → « 🛠️ État du PC » ; B clique « Autoriser ». | A voit processeur, mémoire, disques, redémarrage en attente dans la fiche de B. Si B refuse : rien ne part. |
| 17 | IT : A → « 🖥️ Bureau à distance » ; B autorise. | Chez A, la connexion Bureau à distance (mstsc) s'ouvre vers l'IP de B (B doit avoir le Bureau à distance activé). |
| 18 | B : réglage « Partager l'inventaire » + marquer A « Collègue IT » ; A : « 🛠️ Inventaire ». | Seul B répond (versions, disques presque pleins, redémarrage en attente). |
| 19 | Appairage avec « C'est un de mes PC » ; allumer « Presse-papiers partagé » des deux côtés ; copier un texte sur A. | Le texte arrive dans le presse-papiers de B ; un mot de passe copié depuis un gestionnaire (élément « sensible ») ne passe pas. La batterie du portable apparaît dans la liste. |
| 20 | « Même mascotte sur mes PC » des deux côtés ; changer de mascotte sur A. | B prend la même mascotte (et couleur) en quelques secondes. |
| 21 | Désactiver Équipe. | Les ports 47820 et 47821 se ferment (`netstat`), plus rien n'est envoyé. |
| 22 | Mode démo + Réglages → scène « Visite d'une collègue ». | La visite de Léa s'affiche (aucun réseau utilisé). |
