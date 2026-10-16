# Tests Windows : Home Assistant (nouvelles fonctions du 16/10/2026)

Il faut un Home Assistant sur le réseau local (ou un essai sur une autre
machine) et un compte administrateur. Dans Home Assistant : votre profil →
Sécurité → Jetons d'accès longue durée → Créer un jeton (le copier).

## Où cliquer

Réglages → Modules → Le PC au quotidien → **Home Assistant** (sous-menus
Connexion, Appareils favoris, Voix). L'onglet de l'île apparaît quand le module
est activé.

## Connexion

- [ ] Au premier lancement après la mise à jour, le module est **désactivé** et rien ne part vers Home Assistant (aucun onglet, aucune carte d'Accueil).
- [ ] Activer le module, taper l'adresse (`http://homeassistant.local:8123` ou l'IP), coller le jeton, « Enregistrer » : la pastille dit « ✓ Enregistré » ; le jeton n'est jamais réaffiché.
- [ ] Gestionnaire d'identifiants Windows → Informations d'identification Windows : une entrée `io.github.naod6473.ondine` / `homeassistant-token`.
- [ ] « Tester la connexion » : « ✓ Connecté » avec le nom de la maison et la version.
- [ ] Mauvais jeton : « jeton refusé par Home Assistant… ». Mauvaise adresse : « … injoignable » ou « introuvable sur le réseau ». Adresse sans `http://` : message clair.
- [ ] Adresse `https://` avec un certificat auto-signé : refusé (« certificat refusé ») tant que « Accepter un certificat auto-signé » est coupé ; accepté une fois coché.
- [ ] Le journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`) ne contient jamais le jeton.

## Appareils favoris

- [ ] Appareils favoris → « Afficher les appareils » : la liste arrive, rangée par pièce (compte administrateur) ; avec un compte non administrateur, rangée par type.
- [ ] Chercher un appareil (champ de recherche) ; cocher 6 à 8 favoris dont une lumière réglable, un volet, un thermostat, une scène, une enceinte, une serrure ou un garage.
- [ ] Les serrures, l'alarme, le garage et le portail affichent « Toujours confirmé » ; une prise peut être marquée « Sensible ».
- [ ] Ctrl+Z annule le dernier favori ajouté ; l'export des réglages contient les favoris mais jamais le jeton.

## L'onglet de l'île

- [ ] L'onglet Home Assistant montre les favoris en pastilles rondes par pièce, dans le même verre que Contrôles ; l'état sous chaque nom (« 60 % », « Ouvert 70 % », « 20,5 °C »).
- [ ] Clic sur une lumière : elle s'allume (la pastille s'illumine), un curseur de luminosité apparaît dessous ; le déplacer règle la luminosité.
- [ ] Ondine cligne de l'œil quand une lumière s'allume (réglage « Ondine réagit »).
- [ ] Volet : ⬆ ⏹ ⬇ et la position ; thermostat : − / ＋ par 0,5 °C ; enceinte : ⏮ ⏯ ⏭ et le volume ; scène : se lance.
- [ ] Garage ou serrure : une barre orange « Ouvrir « Garage » ? » apparaît, rien ne bouge avant « Ouvrir » ; « Annuler » ou 30 s sans réponse : rien n'est fait.
- [ ] Changer une lumière depuis l'appli Home Assistant : l'onglet suit en 5 s environ (3 s en Haute, 15 s en Économie).
- [ ] Onglet fermé, île cachée : plus aucune demande (le journal de Home Assistant ou un pare-feu le montre).
- [ ] Accueil de l'île : une carte « Maison » (« 2 lumières allumées ») avec 3 petits boutons (jamais un appareil sensible) ; réglage « Carte sur l'Accueil » pour la retirer.
- [ ] Contrôles : pas de pastilles Home Assistant (voir le rapport : carte d'Accueil à la place).

## La voix

- [ ] Parler à Ondine activé, « Dis Ondine » activé : « Dis Ondine, allume la lumière du salon » → la lumière s'allume, la réponse d'Assist (« Allumé ») s'écrit dans la bulle, aucune IA appelée (pas de clé API nécessaire : essayer sans clé).
- [ ] Pareil en tapant « éteins la cuisine » dans Parler à Ondine.
- [ ] « Écris-moi un poème » : va directement à l'IA (rien vers Assist, cf. journal).
- [ ] Une phrase qu'Assist ne comprend pas (« mets l'ambiance cosy dans le salon ») : sans l'outil IA, l'IA répond normalement sans agir ; avec « L'IA peut commander vos favoris », elle allume ce qu'il faut et une ligne « Maison : allumer « … » » s'affiche.
- [ ] « Ouvre le garage » : jamais envoyé à Assist. Sans l'outil IA : Ondine répond qu'il faut un clic dans l'onglet. Avec l'outil IA : une carte « Ondine voudrait ouvrir « Garage » » avec Faire / Annuler ; rien ne bouge avant « Faire ».
- [ ] « Assist d'abord » coupé : les phrases vont à l'IA.
- [ ] En anglais (Langue : English) : Assist reçoit `language: en` ; les textes du module sont traduits. Au tutoiement : les textes passent au « tu ».

## Règles

- [ ] Règles → nouvelle règle (par ex. « Quand je reviens devant le PC ») → Alors… → « Home Assistant : appeler un service » (seulement si le module est activé) : choisir un favori et « Allumer ». La règle allume la lumière.
- [ ] La même action sur le garage ou une serrure : la règle échoue avec « appareil sensible : une Règle ne peut pas le commander » (rien ne bouge).
