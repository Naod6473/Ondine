# Tests Windows 1.2.3 : format nano et île-bouche d'Ondine (thème « nanobouche »)

Rien de ce qui suit n'a été vu sur Windows ni dans un navigateur : tout est à
vérifier à l'écran. Les réglages : Réglages → L'île → Apparence → « Forme de
l'île » (Taille de la mini-île : Normale / Nano ; Style de l'île : Classique /
Bouche d'Ondine ; en style bouche : « Quand Ondine est sortie : l'île part avec
elle »). « Toujours en mini » reste activé (réglage par défaut) sauf mention.

## Format nano (style Classique)
- [ ] Taille de la mini-île = Nano : la mini-île devient tout de suite une petite encoche (76 × 34) qui ne montre qu'Ondine, en gelée, sans saut ni décollement du bord.
- [ ] Repasser en Normale : elle redevient la mini-île habituelle.
- [ ] Survoler l'encoche : après un très court instant elle s'élargit en mini-île, SANS clic ; la souris partie, elle revient à l'encoche (environ un tiers de seconde après), en gelée.
- [ ] Passer la souris très vite par-dessus l'encoche : elle ne s'ouvre pas.
- [ ] La souris à 100 px à côté de l'encoche, le long du bord : elle ne s'ouvre pas (seule l'encoche réagit, pas toute la bande du bord).
- [ ] Clic sur l'encoche élargie : l'île s'ouvre ; ▴ ou la souris qui part : retour à l'encoche (pas à la mini-île).
- [ ] Une notification normale (une copie dans le Presse-papiers, un « Annuler ») : l'encoche s'élargit, montre la notification jusqu'à sa fin, puis revient à l'encoche.
- [ ] Notification à deux boutons (question d'un agent) : la mini-île reste ouverte jusqu'à la réponse.
- [ ] Alerte (high / critical) : l'île s'ouvre en alerte comme avant, puis revient à l'encoche.
- [ ] Lancer une musique : la mini-île s'ouvre quelques secondes avec le morceau, puis l'encoche revient avec un point vert à côté.
- [ ] Morceau suivant : elle se rouvre quelques secondes. Pause puis lecture : elle se rouvre un peu moins longtemps. Pause : le point vert s'en va.
- [ ] Démarrer un minuteur : la mini-île s'ouvre ~3 s, puis un point doré reste tant qu'il tourne ; à la sonnerie, elle s'ouvre ~6 s.
- [ ] Un agent IA se met au travail : la mini-île s'ouvre ~2,5 s, puis un point violet ; à la fin (ou s'il attend une réponse), elle s'ouvre ~4,5 s.
- [ ] Parler à Ondine à la voix : la mini-île reste ouverte tant qu'Ondine écoute, puis revient.
- [ ] Musique + minuteur + agent : trois points empilés à droite de l'encoche (à gauche si l'île est dans le coin droit ; en ligne dessous sur un côté de l'écran).
- [ ] Ne rien faire 12 s : Ondine s'endort dans l'encoche. Approcher la souris (sans toucher l'encoche) : elle ouvre un œil (clin d'œil). S'éloigner : elle se rendort. Survoler : elle se réveille et la mini-île s'ouvre.
- [ ] Île en bas, à gauche, à droite, dans un coin : l'encoche est à la bonne place (debout sur un côté), collée au bord.
- [ ] Mode présentation (diaporama plein écran) : l'encoche se cache, puis revient en encoche.
- [ ] Windows → Effets d'animation désactivés : l'encoche et la mini-île changent d'un coup, rien ne rebondit, les points apparaissent sans animation.
- [ ] Mascotte en Calme : l'encoche marche de la même façon.
- [ ] Taille Nano avec « Toujours en mini » coupé : survol du bord → l'île arrive, en mini tant que la souris est dessus, puis se cache.

## Île-bouche (Style de l'île = Bouche d'Ondine)
- [ ] Choisir Bouche d'Ondine : Ondine apparaît suspendue tête en bas au bord haut, la mini-île devient sa bouche entrouverte (corps étiré sur les côtés, yeux aplatis sous la bouche, petite langue rose en haut de la bouche), à 6 px du bord. Comparer avec la maquette (tailles, proportions).
- [ ] La matière : même gomme que la mascotte (dégradé clair en haut à gauche, reflet blanc, petit point brillant, liseré clair, contour plus foncé, ombre douce vers le bas). Pas d'aplat.
- [ ] Réglages → Mascotte → Couleur : rouge, vert, arc-en-ciel, couleur libre : le corps change de couleur aussitôt.
- [ ] Clic : la bouche s'ouvre en grand, en gelée (la largeur et la hauteur partent avec un léger décalage), l'île entière est dans la bouche, Ondine n'est plus qu'un liseré de 4 px avec les yeux étirés en bas ; la langue disparaît.
- [ ] Refermer (▴, Échap, souris partie) : le contenu s'efface, la bouche se referme avec un petit rebond, puis Ondine cligne des yeux.
- [ ] Les reflets des yeux suivent la souris partout sur l'écran.
- [ ] Au repos, Ondine cligne des yeux de temps en temps ; en Calme, plus de clignement.
- [ ] Alerte : la bouche s'ouvre avec un petit saut.
- [ ] Glisser un fichier sur l'île : grande bouche ouverte (les cibles dedans) ; lâcher : elle « avale » (rebond + clignement).
- [ ] Le halo (batterie, agent, musique) et le liseré lumineux entourent tout le corps bleu, pas seulement le noir.
- [ ] Cliquer sur le corps bleu (hors de la bouche) : l'île s'ouvre. Cliquer juste à côté du corps ou sous la pointe : le clic passe à la fenêtre derrière.
- [ ] Le survol du corps compte comme le survol de l'île (elle ne se replie pas quand la souris est sur les yeux).
- [ ] Île en bas : Ondine est tournée (la tête vers le bas de l'écran, les yeux au-dessus de la bouche, la pointe vers le haut). À gauche / à droite : elle est couchée, la tête vers le bord, la bouche debout.
- [ ] Île dans un coin (haut gauche, haut droit) : la lèvre de côté se voit, rien n'est coupé bizarrement.
- [ ] Mode présentation (ou une visite qui cache l'île) : Ondine remonte et passe derrière le bord ; elle revient ensuite.
- [ ] Toujours en mini coupé : île cachée, survol du bord → aperçu : on ne voit que la pointe de la goutte ; puis la bouche arrive.
- [ ] Visites au bord (Réglages → Mascotte → Ondine vient pendre au bord, « Faire venir Ondine ») : en style bouche, pas de seconde goutte ; Ondine s'étire un peu vers le bas et cligne deux fois.
- [ ] Windows → Effets d'animation désactivés : pas de pincement, pas de rebond, pas de clignement ; elle se cache et revient en fondu.
- [ ] Gestionnaire des tâches, île au repos en style bouche : pas plus de CPU qu'en Classique (le dessin s'arrête quand rien ne bouge).
- [ ] Thème Verre, thème clair, Studio : la bouche reste lisible, rien ne dépasse.
- [ ] Revenir en Classique : le corps disparaît, l'île redevient la pilule avec la mascotte dedans.

## Format nano + île-bouche
- [ ] Les deux réglages ensemble : au repos, Ondine à sa taille normale, bouche fermée (petit trait noir de 20 × 7 à 11 px du bord), yeux ronds, pointe de goutte.
- [ ] Survol : elle se pince un court instant puis entrouvre la bouche en mini ; la souris partie, elle la referme (rebond + clignement), sans clic.
- [ ] Points d'état à côté d'elle (musique, agent, minuteur) quand la bouche est fermée.
- [ ] 12 s sans rien : elle ferme les yeux ; la souris approche : un seul œil s'ouvre, celui du côté de la souris.

## Ondine sortie de l'île (style bouche)
- [ ] « L'île part avec elle » activé (défaut), Ondine sur le bureau (Réglages → Mascotte, ou la tirer hors de l'île en style classique) : la bouche du haut de l'écran disparaît ; sur le bureau, Ondine se tient debout, dessinée en gomme, bouche fermée.
- [ ] Survoler Ondine sur le bureau : elle entrouvre la bouche en mini (corps étiré sur le côté où l'écran a de la place), la souris partie, elle la referme.
- [ ] Une notification de l'île : Ondine entrouvre la bouche avec le texte dedans ; une alerte : avec un petit saut ; un clic sur le texte ouvre en grand.
- [ ] Clic sur Ondine : la grande bouche s'ouvre avec ses onglets (ceux de la bulle), liseré fin, yeux en haut ; Échap ou ✕ la referme (rebond + clignement).
- [ ] Ondine près du bord droit, du bord gauche, en haut, en bas de l'écran : la bouche s'ouvre toujours vers l'intérieur, jamais hors de l'écran, sur l'écran où elle se trouve.
- [ ] Zone cliquable : on clique sur ce qui est derrière à côté d'elle, même bouche ouverte ; sur elle et dans la bouche, les clics vont à Ondine.
- [ ] La déplacer (glisser) en nano : ça marche comme avant ; la promenade aussi.
- [ ] Un onglet que la bulle n'a pas (ex. depuis une recherche) : l'île s'ouvre en haut le temps qu'il faut, puis repart.
- [ ] La porter au-dessus de l'endroit de l'île : la bouche du haut réapparaît pour l'accueillir ; la lâcher : elle rentre, la bouche du haut revient avec un petit rebond.
- [ ] « L'île part avec elle » désactivé : Ondine sur le bureau garde sa bulle habituelle ; en haut reste une bouche en gomme vide (mêmes lèvres, sans yeux) qui s'ouvre et se ferme normalement ; Ondine rentrée : les yeux réapparaissent avec un petit rebond.
- [ ] Windows → Effets d'animation désactivés : sur le bureau aussi, la bouche change d'un coup.
- [ ] Écran à 125 % / 150 % et deux écrans : Ondine et sa bouche nettes, à la bonne place.
