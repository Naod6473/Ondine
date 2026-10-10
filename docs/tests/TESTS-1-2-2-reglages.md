# Tests Windows : rangement des Réglages (1.2.2)

À vérifier sur Windows avec un fichier de réglages **d'avant** (1.2.1), pour
s'assurer que rien n'est perdu.

| # | Quoi faire | Résultat attendu |
|---|---|---|
| 1 | Avant la mise à jour, décocher quelques moments du halo (ex. Verr Maj, Clé USB), régler « Halo pendant la charge » sur Jamais, cocher « L'île s'écarte de la fenêtre active ». Mettre à jour, rouvrir les Réglages. | Tous ces choix sont toujours là, aux nouvelles places (Animations et halos, Comportement → Ondine et les fenêtres). |
| 2 | Regarder la barre de gauche. | Cinq groupes : Ondine, L'île, Automatiser, Modules, Sécurité et système. Plus de « Animations de l'île » ni « Ondine et les fenêtres » dans Modules. « Parler à Ondine » est dans Ondine. |
| 3 | Fermer les Réglages sur « Animations de l'île » (version d'avant), mettre à jour, rouvrir. | La fenêtre s'ouvre sur Animations et halos (pas sur une page vide). |
| 4 | Animations et halos → Le PC → couper « Tout ». | Tous les moments et les halos de batterie s'éteignent ; « Halo pendant la charge » passe à Jamais. Brancher le chargeur : aucun halo. Rallumer « Tout » : tout revient, « Halo pendant la charge » sur Quelques secondes. |
| 5 | Animations et halos → Style → couper « Tout ». | Le module Animations de l'île s'arrête (plus de halo ni de liquide), point gris à côté de la page dans la barre. |
| 6 | Désactiver le module Système (Onglets), ouvrir Animations et halos → Le PC. | Le bloc Batterie est grisé avec une phrase qui l'explique. |
| 7 | Désactiver « Ondine et les fenêtres » (Comportement → Ondine et les fenêtres → Activé). | Point gris à côté du sous-menu ; Ondine ne réagit plus aux fenêtres (plein écran, barre de titre…). |
| 8 | Mode Simple : parcourir chaque page et chaque sous-menu de la barre. | Aucune page vide : un sous-menu sans réglage essentiel n'apparaît qu'en Complet ; chaque sous-menu d'Animations et halos montre son « Tout ». |
| 9 | Rechercher « Animations de l'île », « Ondine et les fenêtres », « Halos de batterie », « Mises à jour automatiques », « Niveau du journal ». | Chaque résultat mène à la bonne page et au bon sous-menu (la ligne brille). |
| 10 | Système (Modules → Outils IT) : bouton « Ouvrir Animations et halos ». Apparence : « Régler les animations et halos ». | Les deux ouvrent Animations et halos (Le PC pour le premier). |
| 11 | En anglais (Langue : English) et au tutoiement. | Les nouveaux titres sont traduits (Animations and halos, Behavior, Security and system…) ; « Ton prénom… » au tutoiement. |
| 12 | Sécurité et système → Mises à jour → « Rechercher maintenant » ; À propos → « Voir les nouveautés ». | Fonctionnent comme avant dans Général. |
