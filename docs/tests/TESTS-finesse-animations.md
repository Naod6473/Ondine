# Tests Windows : finesse des animations

Avant de commencer : quitter toutes les Ondine (Gestionnaire des tâches), puis
`npm.cmd run tauri dev`. Tester en Classique ET en Studio (Réglages → L'île →
Animations).

1. **Changer d'onglet** dans l'île ouverte, plusieurs fois de suite et vite :
   le contenu glisse d'un bloc dans le sens de la pastille, en environ 0,25 s.
   Plus de cascade élément par élément, rien ne clignote ni ne reste flou.
2. **Ouvrir l'île** depuis la pilule : la cascade d'arrivée est toujours là
   (c'est le seul endroit où elle reste).
3. **Lanceur (Alt+Espace)** : l'île s'ouvre, les résultats sont là tout de
   suite, sans arrivée en cascade ; on peut taper immédiatement.
4. **Menus de choix en verre** (Réglages, par exemple Voix → Dictée → Touche à
   tenir) : ouverture rapide (0,2 s) depuis le coin du bouton, sans rebond.
   Cliquer deux fois très vite sur le bouton : le menu ne saute pas. Même
   chose pour les menus caméra / micro du miroir avant la visio.
5. **Pages des Réglages** : passer d'une page à l'autre, la page glisse en
   moins de 0,3 s. La première fois qu'on ouvre une page, sa cascade est là ;
   en y revenant, plus de cascade.
6. **Bouton pressé** : des clics très rapides sur un bouton de l'île (par
   exemple dans Contrôles) : il s'enfonce et revient sans à-coup.
7. **Barres** : Système (barres des disques), Eau (jauge et colonnes de la
   semaine), carte Musique de l'Accueil (progression) : elles se remplissent
   comme avant, bords arrondis intacts.
8. **Réduire les animations** (Paramètres Windows → Accessibilité → Effets
   visuels → Effets d'animation : désactivé) : plus rien ne glisse ni ne
   rebondit, mais changer d'onglet, ouvrir l'île ou changer de page des
   Réglages fait un fondu court au lieu d'un changement sec.
9. **Studio sur un PC modeste** : ouvrir et changer d'onglet doit rester
   fluide (moins de flou qu'avant).
