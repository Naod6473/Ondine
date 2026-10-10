# Tests Windows de la 1.2.2

Six listes, une par partie. Rien de tout ça n'a pu tourner sous Windows avant
la PR : les tests automatiques (front, Rust, clippy pour Windows) sont verts.

Ordre conseillé (ce qui risque le plus de casser d'abord) :

1. [Île et fenêtres](TESTS-1-2-2-fenetres.md) : l'île qui s'écarte des
   réglages, le bord du bas, l'île qui suit le texte, « Ondine et les fenêtres ».
2. [Voix et Parler à Ondine](TESTS-1-2-2-voix.md) : Ctrl+Alt+V, les plops,
   l'île épurée, la recherche web. La dictée de Windows demande « Reconnaissance
   vocale en ligne » activée dans Windows.
3. [Halos](TESTS-1-2-2-halos.md) : brancher / débrancher le chargeur, batterie
   faible et critique, les autres moments.
4. [Mascottes](TESTS-1-2-2-mascottes.md) : les 15 nouvelles expressions
   (Réglages → Mascotte → Tester les animations), le podium.
5. [Règles, matériel et divers](TESTS-1-2-2-divers.md) : les 17 règles, la
   batterie Bluetooth, la télécommande, la surveillance IA, le bureau propre.
6. [Équipe](TESTS-1-2-2-reseau.md) : il faut deux PC sur le même réseau.

Le mode démo (Réglages → Général) a de nouvelles scènes pour tout voir sans
matériel : Halos de batterie, Autres halos, Parler à Ondine, Ondine parle,
Visite d'une collègue, Panne d'un service IA, L'île s'écarte.
