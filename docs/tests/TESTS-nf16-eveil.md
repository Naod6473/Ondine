# Tests sur Windows : Rester éveillé et arrêt programmé

Pour vérifier ce que Windows a enregistré : PowerShell **en administrateur**,
`powercfg /requests` (Ondine doit apparaître sous SYSTEM, et sous DISPLAY si
« écran allumé », pendant un éveil, puis disparaître).

## 1. Où cliquer

- [ ] Réglages → Modules → **Le PC au quotidien** → **Rester éveillé** : la
  page existe, coupée par défaut, avec deux sous-menus **Éveil** et **Arrêt
  programmé** (fil d'Ariane, recherche Ctrl+K « caféine » ou « éveillé »).
- [ ] Activer le module : l'onglet ☀️ « Rester éveillé » apparaît dans l'île.
  Activé, rien ne se passe tant qu'on ne clique pas (`powercfg /requests` vide).
- [ ] La pastille « Modifié », Annuler (Ctrl+Z) et l'export des réglages
  marchent sur ses réglages comme pour les autres modules.

## 2. Éveil

- [ ] Onglet → Éveil → « 30 min » : la carte « Le PC reste éveillé · Jusqu'à
  HH:MM · Encore 29:59 » ; `powercfg /requests` montre Ondine sous SYSTEM.
- [ ] La mini-île montre « ☕ Éveillé · 29:58 » et **Arrêter** ; Ondine tient
  une petite tasse de café qui fume (mini-île et île ouverte).
- [ ] « Arrêter » (mini-île ou onglet) : la tasse disparaît en fondu,
  `powercfg /requests` ne montre plus Ondine.
- [ ] « Garder aussi l'écran allumé » coché puis « 1 h » : Ondine sous SYSTEM
  **et** DISPLAY. Décocher pendant l'éveil : DISPLAY disparaît, la durée reste.
- [ ] Mettre la mise en veille de Windows à 1 min (Paramètres → Système →
  Alimentation), lancer « Sans limite », ne plus toucher le PC 3 min : pas de
  veille. L'écran s'éteint (sans l'option) mais le PC reste allumé.
- [ ] « Jusqu'à cette heure » avec une heure dans 2 min : l'éveil s'arrête tout
  seul à l'heure ; une heure déjà passée vise le lendemain.
- [ ] Lancer un gros téléchargement dans Edge ou Chrome (dossier
  Téléchargements) : « ⬇️ Fin du téléchargement » devient cliquable (rouvrir
  l'onglet) ; l'éveil s'arrête quelques secondes après la fin du téléchargement.
  Sans téléchargement, le bouton est grisé.
- [ ] Un agent Claude Code au travail (hooks d'Ondine installés) : « 🤖 Fin de
  l'agent IA » cliquable ; l'éveil s'arrête quand l'agent a fini (même si
  « La mascotte suit les agents » est coupé dans Agents IA).
- [ ] Désactiver le module pendant un éveil : relâché dans la seconde.
- [ ] Quitter Ondine (menu de l'icône) pendant un éveil : `powercfg /requests`
  vide. Tuer ondine.exe dans le Gestionnaire des tâches : vide aussi.
- [ ] Lanceur : taper « caféine » → « Rester éveillé » (la durée d'un clic des
  réglages, 1 h par défaut) ; retaper → « Ne plus rester éveillé ».
- [ ] Réglages → Mascotte → Double-clic sur Ondine → « Rester éveillé » :
  double-clic sur Ondine dans la mini-île active, puis coupe.
- [ ] Réglage « Ondine boit un café » coupé : plus de tasse, l'éveil continue.
  Réglage « Le temps restant dans la mini-île » coupé : plus de pilule.
- [ ] « Réduire les animations » de Windows : la tasse est là, la vapeur ne
  bouge pas. Mascotte → « Calme » : la tasse est là aussi.
- [ ] L'écran de veille d'Ondine activé (Écran de veille, 1 min) pendant un
  éveil : il s'affiche quand même à l'heure ; il se ferme à la souris ;
  l'éveil continue (les deux cohabitent).
- [ ] Une règle « Quand : un raccourci → Alors : Garder le PC éveillé 5 min » :
  le raccourci lance l'éveil (module activé) ; module coupé : rien, sans erreur.

## 3. Arrêt programmé (enregistrer son travail avant !)

- [ ] Onglet → Arrêt programmé → 🔒 Verrouiller → Dans 2 min → « Programmer… » :
  la question « Verrouiller le PC dans 2 min ? » et « Confirmer » / « Annuler ».
  « Annuler » ne programme rien.
- [ ] « Confirmer » : la mini-île montre « 🔒 Verrouillage · 1:59 » et
  **Annuler** (passe avant la musique et le minuteur).
- [ ] À 60 s : alerte « Verrouillage du PC dans 60 s », les secondes défilent,
  boutons « Annuler » et « Encore 15 min ». Même en mode présentation.
- [ ] « Encore 15 min » : le compte à rebours repart de 15:59, nouvelle alerte
  60 s avant.
- [ ] Laisser aller jusqu'au bout : la session se verrouille (comme Win+L).
- [ ] 🌙 Mettre en veille dans 2 min : le PC se met en veille ; à la reprise,
  plus d'arrêt programmé ni d'éveil.
- [ ] 📴 Éteindre dans 2 min avec un Bloc-notes **non enregistré** ouvert :
  Windows montre « Ces applications empêchent l'arrêt » (aucune fermeture
  forcée) ; « Annuler » de Windows : le PC reste allumé.
- [ ] 🔄 Redémarrer dans 2 min (tout enregistré) : le PC redémarre.
- [ ] « À » 23:00 : la mini-île compte jusqu'à 23:00 ; « Annuler » de la
  mini-île annule.
- [ ] À la fin du téléchargement : le dernier avertissement de 60 s part
  quelques secondes après la fin, puis l'action.
- [ ] À la fin de l'agent IA : idem quand l'agent a fini.
- [ ] Mettre le PC en veille à la main pendant un arrêt programmé, le réveiller
  après l'heure : pas d'arrêt immédiat, d'abord l'alerte de 60 s.
- [ ] Quitter Ondine avec un arrêt programmé : rien ne se passe ensuite, et il
  n'est plus là au redémarrage d'Ondine.
- [ ] Lanceur : « éteindre » → « Programmer l'arrêt du PC » ouvre l'onglet.

## 4. Langues

- [ ] Anglais : onglet, mini-île (« Awake · 29:58 », « Shutdown · 1:59 »),
  alerte, confirmation, réglages traduits.
- [ ] Tutoiement : « Enregistre ton travail… », « Tape une heure comme 18:30. »
