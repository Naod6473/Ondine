# Tests Windows 1.2.3 : Ondine se déplace dans l'île (zone « scènes »)

Vu seulement dans un navigateur sous Linux (npm run dev, mode démo, captures
d'écran) : rien n'a encore tourné dans l'appli Windows. À regarder en premier :
la fluidité des sauts dans WebView2, et qu'Ondine ne cache jamais un texte.

Le plus rapide pour tout voir : Réglages → Général → Captures d'écran → Mode
démo, puis « Ondine se déplace (toutes les scènes) » (le tour dure environ
2 min 30), ou « Une scène d'Ondine » pour en jouer une seule.

## Le moteur
- [ ] Une scène : Ondine quitte sa case en petits sauts (elle se tasse avant de sauter, s'étire en l'air, s'écrase à l'atterrissage et sa gomme tremble), plus petite qu'au repos, puis revient dans sa case en sautant.
- [ ] En route, elle passe DERRIÈRE le contenu de l'île (le texte reste lisible par-dessus elle) ; arrivée, elle ne passe devant que si sa place ne cache aucun texte.
- [ ] Un clic n'importe où dans l'île pendant une scène : elle s'arrête et revient tout de suite (les objets qu'elle tenait disparaissent en fondu).
- [ ] Un clic sur elle pendant une scène : même chose.
- [ ] Une autre scène pendant une scène : elle repart d'où elle est vers la nouvelle (pas de retour à la case entre les deux).
- [ ] L'île se replie (souris partie, Échap, ▴) pendant une scène : elle est remise dans sa case d'un coup, rien ne reste décalé à la réouverture.
- [ ] Pendant un déplacement, la tirer hors de l'île (Ondine sur le bureau) marche comme avant.
- [ ] Ses yeux regardent où elle va ; la souris reprend la main un instant après.
- [ ] Réglages → Animations et halos → Style → « Ondine se déplace dans l'île » (activé par défaut) : décoché, plus aucun déplacement, seulement un petit geste dans sa case (pousse, tapote, coucou…).
- [ ] Réglages → Mascotte → « Calme » : un simple geste à la place, et aucune scène spontanée (promenade, ouverture de l'île, météo, soir, nage).
- [ ] Paramètres Windows → Accessibilité → Effets visuels → Effets d'animation désactivés : aucune scène, aucun geste de scène.
- [ ] Mode de performance « Économie d'énergie » : un simple geste à la place.
- [ ] Ondine sur le bureau (pas dans l'île) : aucune scène, rien ne casse.
- [ ] Mascotte en taille Petite puis Grande (Réglages → Mascotte → Taille) : les sauts restent à l'échelle, elle ne sort jamais de l'île.
- [ ] Île sur le bord du bas, de gauche, de droite : les scènes restent dans l'île (ou ne se voient pas, sans erreur).

## Les 22 scènes (avec de vraies données, mode démo éteint)
- [ ] 1. Étagère, × « Retirer de l'étagère » : elle va à gauche de la ligne, la pousse, la ligne glisse puis tombe hors de l'île.
- [ ] 1. Un fichier arrive sur l'étagère (glisser sur la cible Étagère, ou un téléchargement), onglet Étagère ouvert : la ligne tombe à sa place, Ondine bras levés à côté.
- [ ] 2. Notes → À faire, × d'une tâche : elle froisse la ligne en boule et la lance hors de l'île. Pareil avec « Supprimer » dans une note ouverte.
- [ ] 2. Modifier une note puis « ← Notes » : elle tape la carte de la note et un tampon ✓ apparaît dans son coin.
- [ ] 3. Minuteur lancé, onglet Minuteur ouvert : elle s'assoit sur le bord de l'anneau tant qu'il tourne (jambes qui se balancent) ; pause ou remise à zéro : elle revient.
- [ ] 3. Fin du minuteur, onglet ouvert : petite cloche 🔔 qui se balance, bras levés.
- [ ] 4. Musique, onglet ouvert, piste suivante (bouton ou touche du clavier) : elle saute sur « ⏭ », puis danse sur la pochette.
- [ ] 5. Copier un texte, onglet Presse-papiers ouvert : la nouvelle ligne arrive en haut, Ondine la pousse en place.
- [ ] 6. Contrôles, glisser le volume ou touches de volume : elle grimpe à côté du curseur ; au-dessus de 80 % elle se bouche les oreilles (moufles).
- [ ] 7. Agents IA, onglet ouvert : un agent a fini → elle tape sur sa carte ; un agent attend → elle agite le bras à côté.
- [ ] 8. Lanceur : taper une recherche : elle arrive avec une loupe 🔍 près du premier résultat, puis le pousse vers vous.
- [ ] 9. Capture réussie, onglet Capture ouvert : appareil photo 📷 et flash blanc sur l'île. En mini-île : flash et petit geste fier.
- [ ] 10. Équipe : un fichier envoyé → elle porte une lettre ✉️ jusqu'au collègue ; un fichier reçu → elle traîne le fichier 📄 du collègue jusqu'à sa case.
- [ ] 11. Changer d'onglet (clic) : elle saute d'icône en icône dans la barre jusqu'au nouvel onglet (rapide même avec beaucoup d'onglets), puis revient.
- [ ] 12. Une règle s'exécute (ex. une règle sur un téléchargement), onglet Règles ouvert : elle tourne une manivelle ⚙️ à côté de la ligne.
- [ ] 13. Ouvrir l'île depuis la mini-île : elle pousse les bords depuis le milieu, puis saute à sa place (au plus une fois toutes les 2 min).
- [ ] 14. Empreinte d'un gros fichier (Étagère → Empreinte, plus de 64 Mo) ou envoi à un collègue, île ouverte : elle court le long du bas de l'île, sa place suit le pourcentage ; à 100 % bras levés.
- [ ] 15. Glisser un fichier de l'Explorateur sur l'île : elle court à côté de la cible survolée, bras ouverts ; change de cible quand on change de cible ; lâcher : elle mange (comme avant) et revient.
- [ ] 16. Étagère → « Vider » (onglet ouvert) ou Presse-papiers → « Vider » : elle passe le balai 🧹 sur toute la largeur.
- [ ] 17. Une alerte (ex. un agent attend votre permission) : la bannière est roulée, Ondine la tire depuis le bord droit jusqu'à sa case et elle se déroule derrière elle.
- [ ] 18. Île ouverte, souris immobile dessus 25 s : elle va s'asseoir à côté d'un bouton, regarde une icône, bâille, revient. Bouger la souris l'arrête.
- [ ] 19. Pomodoro, pendant une pause (onglet ouvert ou non, île ouverte) : elle s'étire à un bord puis à l'autre.
- [ ] 20. L'île remplie de liquide (Animations et halos → Le liquide, ex. minuteur qui se remplit), île ouverte : elle nage d'un bord à l'autre tant qu'elle flotte.
- [ ] 21. Météo qui passe à la pluie : à la prochaine ouverture de l'île, elle traverse sous son parapluie ; au soleil, elle s'éponge au milieu. Une fois par changement de temps.
- [ ] 22. Ouvrir l'île le soir (après l'heure de départ des halos, sinon 19 h) : elle tire l'interrupteur 💡, l'île s'assombrit doucement, elle s'endort dans le coin. Bouger la souris ou cliquer : la lumière revient. Une seule fois par jour.

## Île-bouche (si la branche nano-bouche est fusionnée)
- [ ] Réglages : style de l'île « bouche » : aucune scène ne se joue, sauf × sur l'étagère : la ligne file vers Ondine et disparaît, elle mange.

## Pour les autres zones
- [ ] `mascot.look-at {x, y}` (l'Accueil s'en sert) : elle regarde ce point de l'île environ 1,5 s, puis suit de nouveau la souris.
- [ ] `mascot.walk {active}` est publié au départ et au retour de chaque déplacement (journal du bus, ou console du navigateur en npm run dev : `ondineBus.on("mascot.walk", console.log)`).

## Mode démo
- [ ] « Ondine se déplace (toutes les scènes) » : les scènes s'enchaînent, chaque onglet s'ouvre avant sa scène ; Équipe et Agents IA doivent être activés pour leurs scènes. La scène 15 n'est pas dans le tour (il faut un vrai glisser).
- [ ] « Une scène d'Ondine » : chaque entrée joue sa scène ; en démo, la ligne retirée ou supprimée revient après la scène (rien n'est supprimé pour de vrai).
