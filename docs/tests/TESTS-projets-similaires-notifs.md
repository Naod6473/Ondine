# Tests Windows 1.2.5 : notifications de Windows dans l'île (zone « notifs »)

Rien de ce qui touche Windows n'a tourné sur un vrai PC : le code a été
compilé pour Windows (cargo clippy, cible msvc) et la logique pure est testée
(`cargo test winnotifs`, `npm test` : tests/front/winnotifs.test.ts). Pour
envoyer une notification de test : un message Teams / WhatsApp / Outlook, ou
dans PowerShell :
`New-BurntToastNotification -Text "Titre", "Texte"` (module BurntToast), ou un
rappel de l'appli Horloge / Alarmes.

## Activation et accès
- [ ] Nouvelle installation : le module « Notifications de Windows » est désactivé (Réglages → Le PC au quotidien), aucun onglet 🔔 dans l'île.
- [ ] L'activer : l'onglet 🔔 apparaît. Paramètres Windows → Confidentialité → Notifications, « Autoriser les applications à accéder à vos notifications » cochée : l'onglet dit « Ondine reçoit les nouvelles notifications de Windows. »
- [ ] Les notifications déjà dans le Centre de notifications au moment de l'activation ne s'affichent PAS dans l'île.
- [ ] Décocher la case dans Paramètres Windows, puis désactiver / réactiver le module : notification « Windows ne laisse pas Ondine lire vos notifications » avec « Ouvrir les réglages de Windows » ; le bouton ouvre bien la page Confidentialité → Notifications. (Noter ici si Windows répond « refusé » ou si l'accès marche quand même : c'est le point clé.)
- [ ] Recocher la case : en 10 s au plus (ou tout de suite avec « Vérifier de nouveau » dans l'onglet ou dans Réglages → Notifications de Windows → Accès de Windows), l'état repasse à « Ondine reçoit… ».
- [ ] Journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) : seulement des lignes « notifications de Windows : allowed / denied … », jamais un titre ni un texte de notification.

## Dans l'île
- [ ] Recevoir un message (Teams, WhatsApp, Outlook…) : dans 1 à 2 s, l'île montre « Teams · Alex » et le texte, avec le logo de l'appli (sinon la cloche) ; la bulle de Windows apparaît aussi, c'est normal.
- [ ] Bouton « Ouvrir » : l'appli passe au premier plan.
- [ ] Plusieurs notifications d'affilée : elles passent l'une après l'autre (file de l'île), aucune en double.
- [ ] Pomodoro en cours avec la concentration (Minuteur) : rien ne s'affiche ; à la fin de la séance, elles arrivent avec « N notifications pendant votre concentration ».
- [ ] Mode présentation (PowerPoint en diaporama, vidéo plein écran) : rien ne s'affiche pendant, puis résumé.
- [ ] Économie d'énergie (Réglages → Performances) : les notifications arrivent toujours, en 4 s au plus.
- [ ] Mettre le PC en veille avec des notifications qui arrivent pendant (téléphone lié, mails) : au réveil, au plus 5 s'affichent, pas une avalanche.

## Réglages
- [ ] « Montrer le texte du message » décoché : seulement « Appli · Titre », plus de texte (dans l'île et l'onglet).
- [ ] « Applis à ignorer » : `Teams` → plus rien de Teams (même « Microsoft Teams »). Les autres applis passent.
- [ ] « Seulement ces applis » : `Outlook` → seules les notifications d'Outlook passent.
- [ ] « Garder les 20 dernières dans l'onglet » : l'onglet liste les dernières (logo, appli, « il y a 2 min », titre, texte) ; clic sur une ligne = ouvre l'appli ; « Effacer la liste » vide. Décocher le réglage : la liste est vidée tout de suite. Quitter Ondine et relancer : liste vide.
- [ ] « Retirer la notification du Centre de notifications une fois montrée » coché : après la notification de l'île (fin du temps, ×, ou « Ouvrir »), elle disparaît du Centre de notifications de Windows (Win + N). **Noter si ça marche.** Si Windows refuse : l'onglet et Réglages → Notifications de Windows disent « Windows ne laisse pas Ondine retirer les notifications du Centre de notifications : elles y restent. »

## Autres
- [ ] Anglais (Réglages → Langue) : textes de l'onglet et des réglages traduits ; les titres des notifications des autres applis restent tels quels.
- [ ] Désactiver le module : l'onglet disparaît, plus aucune notification, et la réactivation ne remontre pas les anciennes.
