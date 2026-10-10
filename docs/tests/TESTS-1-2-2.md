# Tests Windows de la 1.2.2

Une liste par partie. Rien de tout ça n'a pu tourner sous Windows avant
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

Ajouts après votre premier test :

7. [Retours du premier test](TESTS-1-2-2-ui2.md) : icônes épurées et couleur,
   barre de défilement discrète, bulle d'Ondine sur le bureau.
8. [Rangement des Réglages](TESTS-1-2-2-reglages.md) : les 5 groupes, la page
   « Animations et halos », ouvrir avec des réglages de la 1.2.1.
9. [Premier lancement](TESTS-1-2-2-accueil.md) : l'assistant (Réglages →
   Général → Refaire l'assistant) et les propositions d'onglets.
10. [Le liquide dans l'île](TESTS-1-2-2-liquide.md) : minuteur, charge,
    téléchargement, réglages de couleur et de matière.
11. [Danses](TESTS-1-2-2-danses.md) : lancer de la musique de styles variés.
12. [Chat Équipe](TESTS-1-2-2-chat.md) : deux PC sur le même réseau.

Le mode démo (Réglages → Général) a de nouvelles scènes pour tout voir sans
matériel : Halos de batterie, Autres halos, Parler à Ondine, Ondine parle,
Visite d'une collègue, Panne d'un service IA, L'île s'écarte.
