# Tests Windows de la 1.2.3

Une liste par partie, 314 cases en tout. Rien de tout cela n'a tourné sous
Windows avant la PR. Les tests automatiques sont verts : interface, Rust, et
clippy pour Windows. L'île-bouche, l'Accueil, le thème Givre et les scènes ont
aussi été vus dans Chromium, en mode démo.

Ordre conseillé, en commençant par ce qui risque le plus de casser :

1. [Format nano et île-bouche](TESTS-1-2-3-nanobouche.md) : Réglages → L'île →
   Apparence → Forme de l'île. La nano qui s'élargit au survol, la bouche
   d'Ondine, et Ondine sur le bureau qui ouvre la bouche.
2. [Accueil](TESTS-1-2-3-accueil.md) : le nouvel onglet en tête. Les cartes
   qu'on glisse, qu'on ouvre sur place et qu'on retire d'un clic droit ; les
   actions rapides ; l'onglet après une mise à jour depuis la 1.2.2.
3. [Ondine se déplace dans l'île](TESTS-1-2-3-scenes.md) : supprimer un
   fichier de l'étagère, une note, changer d'onglet… Le tour complet est dans
   Réglages → Captures d'écran (mode démo).
4. [Design de l'île](TESTS-1-2-3-design.md) : le thème Givre onglet par
   onglet, la molette = volume, le double-clic sur Ondine, le halo de la
   pochette, les reflets sur un deuxième écran.
5. [Sons, écran de veille, débit, Équipe](TESTS-1-2-3-fonctions.md) : il faut
   deux PC pour le QR code et « Alex écoute… ».
6. [Dictée hors ligne et le reste](TESTS-1-2-3-dictee.md) : la dictée hors
   ligne demande la reconnaissance vocale du français installée dans Windows.
   La pancarte, le pont de fichier, la règle « nouvel appareil ».

Correctifs déjà dans la branche (ancienne PR #71) : textes d'aide en anglais,
ligne vous/tu cachée en anglais, notification à deux boutons en mini-île,
visites d'Ondine au bord avec la mini-île.
