# Tests Windows 1.2.3 : design (verre clair, molette, double-clic, halo pochette, multi-écrans)

Ce qui ne peut pas être vérifié sous Linux : rien de tout ça n'a encore tourné
sur Windows. Cocher chaque ligne une fois le geste vérifié.

## Île en verre clair (thème Givre)
- [ ] Réglages → L'île → Apparence → Thème : la pastille « Givre » existe ; un clic rend l'île blanche dépolie (léger grain, reflet en haut à gauche, fin liseré), sans recharger.
- [ ] Mini-île en Givre : la mascotte, le titre de la musique et l'heure se lisent bien (texte sombre).
- [ ] Île ouverte en Givre : passer chaque onglet (Étagère, Presse-papiers, Capture, Minuteur, Notes, Agenda, Terminal, Système, Accès distants, Réseau, Contrôles, Équipe, Agents IA, Parler à Ondine, Lanceur, Météo) : aucun texte blanc sur blanc, les boutons, pastilles et cases ont un fond visible, les erreurs restent rouges et lisibles.
- [ ] Givre + Réglages → Icônes → « Épurées » (au trait) : les icônes sont sombres et nettes ; en « Couleur », elles restent jolies sur le blanc.
- [ ] Givre : le bouton principal (« Envoyer », « Copier »…) est bleu foncé avec un texte clair ; au survol, il reste lisible.
- [ ] Givre : une notification normale puis une alerte (mode démo) : le texte se lit, le point micro / caméra se voit.
- [ ] Givre sur un fond d'écran noir puis sur une page blanche plein écran derrière l'île : le texte reste lisible dans les deux cas.
- [ ] Givre + halo (mode démo, « Autres halos ») sur le contour et à l'intérieur : couleurs plus foncées, bien visibles sur le blanc.
- [ ] Givre + liquide (Minuteur avec le liquide coché) : le liquide est clair et le texte au-dessus reste lisible.
- [ ] Revenir à « Nuit » : tout redevient comme avant (aucun reste de blanc).
- [ ] Givre avec Ondine sur le bureau : la bulle d'Ondine est aussi en verre clair, lisible.
- [ ] Givre avec le style « Bouche d'Ondine » (si la branche île-bouche est fusionnée) : l'île reste sombre (le verre clair n'y a pas d'effet).

## Molette = volume
- [ ] Mini-île, sans cliquer dessus, la souris posée dessus : tourner la molette vers le haut monte le son de 2 % par cran, vers le bas le baisse ; la petite capsule (haut-parleur + jauge) apparaît en gelée, puis s'efface ~1 s après le dernier cran.
- [ ] Le volume suit bien celui de Windows (icône de la barre des tâches) ; le volet de volume de Windows n'apparaît pas.
- [ ] Son coupé, molette vers le haut : le son est rétabli.
- [ ] Île ouverte : la molette fait toujours défiler les listes ; sur la mascotte seulement, elle règle le volume.
- [ ] Format nano (si fusionné) : la molette règle aussi le volume, la jauge seule apparaît.
- [ ] Pavé tactile à deux doigts : le volume change doucement, sans à-coups ; un défilement horizontal ne change rien.
- [ ] Windows → Paramètres → Souris → « Faire défiler les fenêtres inactives… » DÉSACTIVÉ : noter si la molette marche encore sur l'île (sinon, le dire : il faudrait un crochet souris).
- [ ] Réglages → Contrôles → décocher « Molette sur l'île = volume » : la molette ne fait plus rien sur la mini-île. Module Contrôles désactivé : idem.
- [ ] Réduire les animations (Windows) : la capsule apparaît et disparaît en fondu, sans rebond.
- [ ] Île sur le bord gauche / droit / bas : la capsule se pose contre le bord intérieur.

## Double-clic sur Ondine
- [ ] Double-clic sur Ondine dans la mini-île : « Parler à Ondine » s'ouvre (après un tout petit délai) ; Ondine rit au deuxième clic comme avant.
- [ ] Un seul clic : elle sourit, l'île ne s'ouvre pas sur Parler à Ondine.
- [ ] Trois clics rapides : elle s'agace, rien ne s'ouvre ; six clics : étourdie ; la surprise « split » (série de clics) marche toujours.
- [ ] Réglages → Mascotte → Humeur → « Double-clic sur Ondine » = Lanceur : le Lanceur s'ouvre, prêt à taper.
- [ ] = Capture : l'outil de capture de Windows s'ouvre.
- [ ] = Note rapide : l'onglet Notes s'ouvre sur une note neuve, le curseur dedans ; taper puis Échap : la note est enregistrée.
- [ ] = Rien : le double-clic ne lance rien (Ondine rit quand même).
- [ ] Action choisie mais son module désactivé (ex. Lanceur coupé) : une ligne « Module « Lanceur » désactivé » s'affiche dans l'île.
- [ ] Ondine tient la pancarte « ? » (un agent attend) : un clic ouvre toujours Agents IA, pas l'action du double-clic.
- [ ] Attraper Ondine et la tirer hors de l'île (Ondine sur le bureau) : aucun double-clic parasite.
- [ ] En anglais (Langue : English) et au « tu » : les textes du réglage et de la ligne « module désactivé » sont traduits.

## Halo aux couleurs de la pochette
- [ ] Réglages → L'île → Animations et halos → Son et clavier : cocher « Le halo suit la musique » ; « Couleurs de la pochette » est coché par défaut.
- [ ] Lancer un morceau avec une pochette très colorée (Spotify, YouTube Music dans Edge) : le halo prend les couleurs de la pochette (deux ou trois teintes qui tournent).
- [ ] Passer au morceau suivant (autre pochette) : les couleurs changent sans que le halo s'éteigne.
- [ ] Pochette en noir et blanc : le halo garde ses couleurs « musique » (rose, violet, cyan).
- [ ] Mascotte qui danse (« Le halo danse avec la mascotte ») : la lumière de la danse prend aussi les couleurs de la pochette.
- [ ] Décocher « Couleurs de la pochette » : le halo reprend ses couleurs habituelles.
- [ ] Réglages → halos → Couleurs « Arc-en-ciel » ou « Couleur de ma mascotte » : ce choix l'emporte sur la pochette.

## Multi-écrans : reflets de l'île
- [ ] Deux écrans, Réglages → L'île → Comportement → « Reflet sur les autres écrans » coché : dans la seconde, une petite encoche avec Ondine endormie (qui respire doucement) apparaît en haut au centre de l'autre écran ; jamais de rectangle blanc.
- [ ] Le reflet laisse passer les clics (on clique « à travers » sur la fenêtre derrière) et n'apparaît pas dans Alt+Tab ni la barre des tâches.
- [ ] Approcher la souris du reflet : l'île vient sur cet écran en mini-île, le reflet disparaît de cet écran et un reflet apparaît sur l'écran quitté.
- [ ] Revenir toucher le reflet du premier écran : l'île y revient.
- [ ] Île au bord bas / gauche / droit : les reflets sont au même bord, à la même place, posés sur la barre des tâches en bas.
- [ ] Écrans à des échelles différentes (100 % et 150 %) : reflets nets, bien collés au bord, l'île garde sa taille en changeant d'écran.
- [ ] Changer de thème (Givre, Prune…) : les reflets prennent la couleur dans la seconde.
- [ ] Mascotte cachée ou Ondine sur le bureau : le reflet montre un petit point à la place d'Ondine.
- [ ] Débrancher un écran : son reflet disparaît, l'île revient sur un écran présent. Rebrancher : le reflet revient.
- [ ] Présentation / plein écran (avec « Mode présentation ») : les reflets se cachent, puis reviennent.
- [ ] Décocher le réglage : les reflets disparaissent ; l'île revient sur l'écran réglé (principal) en moins d'une seconde.
- [ ] « Sur quel écran ? » = Suit la souris + reflets : l'île suit la souris comme avant, les reflets restent sur les autres écrans.
- [ ] Gestionnaire des tâches : avec le réglage coupé, aucune fenêtre ni processus de plus ; coché, noter la mémoire ajoutée par reflet (attendu : petite, une page fixe).
- [ ] Réduire les animations (Windows) : Ondine du reflet ne respire plus (immobile).
