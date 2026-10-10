# Tests Windows 1.2.2 : danses selon la musique (zone « danses »)

Ce qui ne peut pas être vérifié sous Linux (le tempo est mesuré sur le son de
Windows). Pour voir les danses sans musique : Réglages → Mascotte → Tester les
animations (boutons `danse-rock` … `danse-hochement`, tempo typique du style),
ou Réglages → Général → Captures d'écran → Mode démo, puis « Danses selon la
musique » (île en mini-île).

## Le tempo
1. Lancer un morceau bien rythmé (Spotify, YouTube dans Edge…), île en mini-île. Attendu : Ondine danse tout de suite au tempo typique du style, puis en 4 à 6 s ses pas tombent sur les temps (la tête ou le rebond sur la grosse caisse). Taper du pied pour comparer.
2. Essayer des tempos variés : ballade (~70), rap (~90), pop (~115), électro (~128), rock rapide (~150-170). Attendu : le bon tempo, ou la moitié pour les morceaux très rapides (elle danse alors un temps sur deux), jamais un tempo sans rapport.
3. Passer au morceau suivant d'un tempo très différent : elle se recale en quelques secondes, sans saut brusque (elle accélère ou ralentit un peu).
4. Mettre en pause 2 s puis reprendre : elle repart et se recale.
5. Musique très douce ou sans rythme (piano libre, podcast) : elle danse au tempo du style sans se caler ; rien de bizarre.
6. Gestionnaire des tâches pendant la danse : Ondine ne prend presque rien de plus (lecture du niveau 100 fois par seconde, 50 en économie d'énergie). Danse arrêtée (île ouverte, musique arrêtée) : la lecture s'arrête (au plus 30 s après).
7. Casque Bluetooth branché pendant la lecture : le tempo continue (le périphérique par défaut est relu toutes les 3 s).
8. Vérifier qu'aucune appli ni Windows ne signale qu'Ondine « utilise le micro » ou enregistre : seul l'indicateur de niveau de la sortie est lu.
9. Réglages → Musique → décocher « La mascotte danse au tempo de la musique » : elle danse toujours, mais au tempo typique du style, sans se caler.

## Le style
10. Un lecteur qui donne le genre (Lecteur multimédia / Groove avec des MP3 tagués « Rock », « Hip-Hop », « Reggae »…) : la danse du genre (rock : air guitar ; metal : headbang et cornes ; rap : casquette, bras croisés ; RnB : claquements de doigts ; pop : pas de côté et clap ; électro : bras en l'air ; reggae : balancement ; jazz : ondulation, yeux mi-clos).
11. Spotify (qui ne donne en général pas de genre) : un style deviné d'après le tempo et l'énergie ; il ne change pas toutes les secondes.
12. Réglages → Musique → Style de danse → Metal (puis les autres) : la danse change tout de suite.
13. Les 15 mascottes (Réglages → Mascotte → podium) : chaque danse reste dans sa place (mains, guitare et casquette visibles, rien de coupé), aussi en taille Grande et sur le bureau (Ondine sur le bureau : elle danse aussi).

## Calme, animations réduites, halo
14. Mascotte en Calme : en musique, un simple hochement de tête sur les temps (plus de grande danse).
15. Windows → Accessibilité → Effets d'animation désactivés : une image fixe (hochement), rien ne bouge.
16. Animations de l'île → « Le halo suit la musique » et « Le halo danse avec la mascotte » cochés : pendant la danse, une fois le tempo trouvé, le halo bat sur les mêmes temps que la mascotte (un temps sur deux au-delà de ~133 BPM), un éclat vif pour l'électro. Décocher l'une des deux cases : plus de halo de danse.
17. Sans tempo (réglage du point 9 décoché) avec les deux cases cochées : le halo suit le niveau du son comme en 1.2.1.
