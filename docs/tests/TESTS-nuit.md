# Tests de la branche `nuit-ondine`

Pour tester :

```
git fetch
git checkout nuit-ondine
npm install
npm run tauri dev
```

Coche chaque ligne qui marche. Pour celles qui ne marchent pas, note ce que tu
vois (ou une capture). Les lignes marquées **⚠** utilisent une API que je n'ai
pas pu vérifier sous Linux. Ce sont celles à regarder en premier.

---

## 1. L'île elle-même

1. ☐ **Étirer** : tire le bas de l'île vers le bas. Elle s'étire comme une
   gelée, puis revient avec un rebond quand tu lâches. Tirée de côté, elle se
   penche.
2. ☐ **⚠ Déplacer** : attrape l'île par le bord collé à l'écran et emmène-la
   ailleurs. Au lâcher, elle s'aimante au bord le plus proche (haut, gauche ou
   droite), à un coin ou au centre.
3. ☐ Sur un **côté**, les petites formes sont verticales et l'île s'ouvre vers
   le centre de l'écran. Le réglage « Bord de l'écran » (Général) fait la même
   chose.
4. ☐ **⚠ Ondine pendue** : cache l'île et ne touche plus à rien pendant au
   moins 20 s. Ondine descend du bord, se balance et suit la souris.
   - Un clic sur elle ouvre l'île.
   - Hors d'Ondine, les clics passent bien à travers vers les fenêtres
     dessous.
   - Le bouton « Essayer » (Réglages → Mascotte) la fait venir tout de suite.
5. ☐ **Thèmes** (Réglages → Apparence) : les 7 thèmes s'appliquent. La couleur
   personnalisée est assombrie si elle est trop claire.
6. ☐ **⚠ Sons** : de petits « plop » à l'ouverture et sur les boutons. On peut
   les couper et régler le volume.
7. ☐ **Raccourci global** : Ctrl+Alt+O ouvre et ferme l'île. Tu peux le
   changer dans Général. S'il est déjà pris par un autre logiciel, un message
   s'affiche.

## 2. Micro, caméra, son

1. ☐ **⚠ Point de confidentialité** : ouvre Teams ou l'appareil photo.
   - Un point orange (micro) ou vert (caméra) apparaît sur l'île en moins de
     2 s.
   - Quand l'île est cachée, c'est une petite barre de couleur.
2. ☐ **⚠ Ctrl+Alt+M** coupe le micro, même île fermée. Ondine porte un badge
   « micro coupé ». La touche Pause est aussi proposée dans les réglages, à
   tester.
3. ☐ **⚠ Sortie audio** : Contrôles → « Son ▾ », puis choisis casque ou
   haut-parleurs. Le son bascule vraiment. Cette fonction utilise une
   interface Windows non documentée, donc c'est le test le plus incertain.
4. ☐ **⚠ Épingler** : clique sur une fenêtre (Bloc-notes), puis sur la tuile
   « Épingler ». Elle reste au-dessus des autres. Un 2ᵉ clic la libère.

## 3. Batterie et humeur (portable)

1. ☐ Sous le seuil (Réglages → Système), une alerte
   « batterie faible » s'affiche et Ondine est inquiète.
2. ☐ Une fois la batterie à 100 % sur secteur, « Batterie chargée »
   s'affiche (option).
3. ☐ **Humeur** : avec le CPU très chargé (au-dessus de 85 % pendant 20 s),
   Ondine transpire. Tard le soir, elle a les paupières lourdes.

## 4. Réseau

1. ☐ **⚠ Coupe le Wi-Fi** : « Internet coupé » s'affiche. Rallume-le :
   « Internet revenu ».
2. ☐ **⚠ VPN** : connecte ton VPN. Il est reconnu, et « VPN déconnecté »
   s'affiche quand il tombe.
3. ☐ **Serveurs surveillés** (Réglages → Réseau) : ajoute un nom qui
   n'existe pas. Une alerte arrive après environ 2 minutes.
4. ☐ L'**IP publique** (désactivée par défaut) s'affiche dans l'onglet Réseau
   une fois l'option activée.

## 5. Presse-papiers

1. ☐ Copie un lien avec `?utm_source=…` ou `fbclid`. Le lien collé est
   propre, et une notification propose « Remettre ».
2. ☐ Le bouton « Aa » passe le texte copié en MAJUSCULES, minuscules,
   Majuscule initiale…
3. ☐ **⚠ Mot de passe** (onglet 🔑) :
   - génère un mot de passe et copie-le ;
   - il **n'apparaît pas** dans l'historique Windows (Win+V) ;
   - il est effacé du presse-papiers au bout de 30 s.

## 6. Étagère

1. ☐ Dépose des images sur la cible « Images… » : convertis en JPEG avec une
   largeur max. Les copies sont créées à côté des originaux, qui ne sont pas
   modifiés.
2. ☐ Dépose plusieurs fichiers sur la cible « Renommer… » avec le modèle
   `Photo {n}` :
   - l'aperçu s'affiche ;
   - il faut deux clics pour confirmer ;
   - « Annuler » remet les anciens noms.
3. ☐ **Téléchargements** (option de l'étagère) : télécharge un fichier dans le
   navigateur. Il est posé tout seul sur l'étagère une fois fini, jamais
   pendant le téléchargement.

## 7. Travail

1. ☐ **⚠ Mode présentation** : lance un PowerPoint en plein écran ou une
   vidéo YouTube en plein écran.
   - L'île se cache.
   - Les notifications attendent, et un résumé s'affiche à la sortie.
   - On peut aussi le forcer dans Général.
   - Le partage d'écran Teams n'est pas détecté par Windows, c'est attendu.
2. ☐ **Ticket de support** (onglet Système → « 🎫 Préparer un ticket ») :
   - un dossier Documents\Ondine\Tickets\… s'ouvre avec ticket.txt et la
     capture ;
   - le texte est copié.
3. ☐ **Pauses** : mets 1 minute dans les réglages du module. Le rappel arrive,
   et il ne s'affiche pas pendant un appel.
4. ☐ **Récap du soir** (Agenda, 18 h par défaut) : « Demain : N rendez-vous »
   s'affiche et Ondine bâille. Pour tester, mets l'heure actuelle.

## 8. Langues

1. ☐ Réglages → Général → **Langue** → English. L'île et les réglages se
   rechargent en anglais.
   - Des phrases fabriquées à la volée peuvent rester en français. Note-les
     et je les ajoute.
   - Les messages d'erreur venant de Rust restent en français pour
     l'instant, comme la fenêtre d'annotation de capture.
2. ☐ Le menu de l'icône (zone de notification) passe en anglais au prochain
   lancement.
3. ☐ **⚠ Installateur** :
   - lance `npm run tauri build`, puis l'installateur NSIS ;
   - il demande la langue ;
   - choisir English met Ondine en anglais si la langue est sur
     « Automatique ».

---

## Ce que je dois savoir

- 1.2 et 1.4 : le déplacement et le clic à travers Ondine pendue.
- 2.1 : le point apparaît-il, et pour quelle appli ?
- 2.3 : la sortie audio bascule-t-elle vraiment ?
- 2.4 : l'épingle marche-t-elle (sauf sur les fenêtres administrateur,
  c'est normal) ?
- 4.1 et 4.2 : les alertes Internet et VPN.
- 5.3 : le mot de passe est-il absent de Win+V ?
- 8.3 : la question de la langue dans l'installateur.
