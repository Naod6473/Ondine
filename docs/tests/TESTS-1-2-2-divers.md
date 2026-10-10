# Tests 1.2.2 — branche `v122-divers` (règles, Bluetooth, télécommande, services IA, bureau propre)

Pour tester :

```
git fetch
git checkout v122-divers
npm install
npm run tauri dev
```

Coche chaque ligne qui marche ; pour les autres, note ce que tu vois (ou une
capture). Les lignes **⚠** utilisent une API Windows ou une adresse Internet
que je n'ai pas pu vérifier (développé sous Linux, sans accès au réseau) :
à regarder en premier.

---

## 1. Règles : les nouveautés

Réglages → Règles → « Nouvelle règle ». Pour chaque test, crée la règle,
active-la, puis vérifie l'historique de l'onglet Règles de l'île.

1. ☐ **Heure fixe** : déclencheur « À une heure », mets l'heure actuelle + 2
   min et le jour d'aujourd'hui, action « Notification ». La notification
   arrive à l'heure (au plus une fois par jour). Un autre jour coché seul :
   rien.
2. ☐ **Heure fixe + dossier** : modèle « Vieux téléchargements » ; change
   l'heure pour dans 2 min et mets « plus vieux que 0 jour ». À l'heure, les
   fichiers du dossier partent à la Corbeille (pas supprimés) et **un seul**
   « Annuler » les ramène tous.
3. ☐ **⚠ Déverrouillage** : déclencheur « Au déverrouillage » + notification.
   Win+L puis reconnecte-toi : la notification arrive dans les 2 s.
4. ☐ **Presse-papiers** : déclencheur « Copie d'un lien » + notification
   contenant `{texte}`. Copie une adresse web : notification. Copie du texte
   simple : rien. Copie un mot de passe depuis un gestionnaire (KeePass,
   Bitwarden) : rien, et l'historique dit « presse-papiers », jamais le texte.
5. ☐ **Réseau** : déclencheur « Internet coupé » (modèle « Internet coupé ») ;
   coupe le Wi-Fi : notification et Ondine inquiète en 10 à 20 s. « Internet
   revenu » à la reconnexion. VPN : connecte / déconnecte un VPN.
6. ☐ **Batterie / secteur** (portable) : « Batterie sous 90 % » se déclenche
   une fois en passant le seuil ; « Branché sur secteur » au branchement.
7. ☐ **Agent** : modèle « Agent fini → danse » ; à la fin d'une tâche Claude
   Code suivie par Ondine, Ondine danse ~8 s. « Attend une réponse » marche
   aussi.
8. ☐ **Musique** : déclencheur « La musique démarre » + notification ; lance
   Spotify : une notification, pas une par morceau.
9. ☐ **Ajouter une note / tâche** : action « Ajouter une tâche » avec
   `{nom}` : la tâche apparaît dans l'onglet Notes.
10. ☐ **Décompresser** : règle « Téléchargements, extension zip →
    Décompresser ». Télécharge un zip : un dossier du même nom apparaît à
    côté, rien n'est écrasé (un 2e zip identique donne « nom (2) »).
    « Annuler » envoie le dossier extrait à la Corbeille. Un zip contenant
    `..\\x.txt` : ce fichier est ignoré.
11. ☐ **Copier le chemin** : action « Copier le chemin » (et « nom seul ») :
    le presse-papiers contient le chemin complet (ou le nom).
12. ☐ **Mascotte** : action « Mascotte → émotion » : Ondine change de tête ;
    « pancarte » : une notification 🪧 avec le texte (la pancarte dessinée
    n'existe pas encore, voir rapport).
13. ☐ **Calme** : modèle « Pause déjeuner » (heure dans 2 min) : les
    notifications de l'île sont en pause 45 min, Ondine calme ; elles
    reviennent ensuite toutes seules.
14. ☐ **Conditions** : sur une règle de fichier, coche seulement samedi /
    dimanche, ou « de 09:00 à 12:00 » : hors de la plage, la règle ne fait
    rien.
15. ☐ **Compteur** : la liste affiche « déclenchée N fois cette semaine »
    après quelques déclenchements ; le compteur repart le lundi.
16. ☐ **Renommer** `{date}` / `{heure}` : toujours bons.
17. ☐ Les 4 nouveaux modèles s'ouvrent dans l'éditeur sans erreur ; une
    règle « décompresser dans le dossier surveillé lui-même » est refusée
    (boucle).

## 2. Contrôles : batteries Bluetooth

1. ☐ **⚠** Avec un casque / des écouteurs / une souris BLE dont Windows
   affiche la batterie (Paramètres → Bluetooth et appareils) : l'onglet
   Contrôles montre « Batteries Bluetooth » avec le même pourcentage (à
   quelques % près, relu toutes les 30 s).
2. ☐ Un appareil appairé mais éteint : **⚠** marqué « (éteint) » et grisé (si
   Windows le dit ; sinon il garde son dernier niveau).
3. ☐ Sans appareil qui donne sa batterie : « Aucun appareil ne donne sa
   batterie » (ou la bande cachée si les autres boutons le sont aussi).
4. ☐ Alerte : mets le réglage « Prévenir quand un appareil Bluetooth passe sous » à 50 % : en
   moins de 5 min, notification « Batterie faible : … ». Pas de répétition
   tant que le niveau ne remonte pas de 5 %. À 0 : jamais d'alerte.

## 3. Contrôles : bureau propre

1. ☐ **⚠** « Cacher les icônes du bureau » : les icônes disparaissent (comme
   clic droit → Affichage → Afficher les icônes du bureau). Le bouton devient
   « Montrer les icônes du bureau » et les ramène.
2. ☐ Change l'option par le menu du bureau : le bouton suit en ~2 s.
3. ☐ Aucun fichier du bureau n'est déplacé ni supprimé.

## 4. Télécommande sur le téléphone

1. ☐ Par défaut : pas de bouton « 📱 Télécommande ». Active le réglage
   « Télécommande sur le téléphone » (Contrôles) : le bouton apparaît.
2. ☐ **⚠** Clic : QR code + adresse `http://192.168.x.x:port/t/…`. Windows
   peut demander l'autorisation du pare-feu (réseau privé) : accepter.
3. ☐ Scanne avec le téléphone (même Wi-Fi) : la page s'ouvre ; notification
   « Téléphone connecté ». Lecture / pause, suivant, précédent, volume +/−,
   muet marchent.
4. ☐ Minuteur 5 / 10 / 25 min : le minuteur d'Ondine démarre.
5. ☐ **⚠** PowerPoint en diaporama au premier plan : « Diapo suivante /
   précédente » change de diapositive.
6. ☐ Un 2e téléphone avec la même adresse : refusé.
7. ☐ L'adresse sans le jeton, ou avec un jeton modifié : 404.
8. ☐ 10 min sans toucher la page : arrêt, notification « Télécommande arrêtée
   (10 minutes sans s'en servir) ». « ⏹ Arrêter » coupe tout de suite ;
   désactiver le réglage aussi (en quelques secondes).
9. ☐ Sans adresse de réseau local privée (ex. seulement en 4G partagée hors réseau privé) : refus avec un message clair.

## 5. Réseau : services IA

1. ☐ Par défaut : rien n'est contacté (pas de carte « Services IA » active).
   Active « Surveiller Claude, ChatGPT et Gemini » (réglages du module Réseau).
2. ☐ **⚠** Dans les 5 s : Claude, ChatGPT, Gemini en vert (ou orange / rouge
   si incident réel) ; comparer avec status.anthropic.com,
   status.openai.com, status.cloud.google.com. Si l'un reste « inconnu »,
   l'adresse ou le format a changé : le noter.
3. ☐ Démo : mode démo → scène `ai-outage` : carte rouge,
   point rouge sur la mini-île, notification, Ondine grimace ; au retour,
   notification « … fonctionne de nouveau », Ondine soulagée.
4. ☐ Pendant un incident Claude, un événement d'agent (fin / attente) affiche
   « Claude a un incident en cours » (une fois par 30 min au plus).
5. ☐ Historique 7 jours visible sous la carte après une panne ; il survit à
   un redémarrage d'Ondine.
6. ☐ Pendant une session de concentration, une présentation, ou Internet
   coupé : pas de lecture (vérifier dans le journal qu'aucune requête ne
   part).
7. ☐ Désactive le réglage : le point rouge disparaît, plus aucune requête.
