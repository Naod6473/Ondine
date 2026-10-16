# Tests Windows : « Ignorer les clés et jetons » (Presse-papiers, 1.2.4)

Branche `ps-secrets`. Les tests automatiques (Rust et interface) sont verts et
le code Windows compile (`cargo check --target x86_64-pc-windows-msvc`) ; rien
n'a encore tourné sous Windows.

Pour fabriquer les fausses clés sans en mettre de vraies dans un fichier :
ouvrez le Bloc-notes, tapez le début indiqué, puis collez `aB3xK9mQ7pZ2`
autant de fois que demandé, sans espace. Sélectionnez la ligne (Origine,
Maj+Fin) et copiez-la (Ctrl+C).

---

## 1. Le réglage

- [ ] 1.1 Réglages → Presse-papiers : la case « Ignorer les clés et jetons »
  existe, est cochée par défaut, et son aide parle de l'historique, de la
  recherche et des autres PC.
- [ ] 1.2 En anglais (Réglages → Langue) : « Ignore keys and tokens ».

## 2. Les clés ne sont pas gardées

Pour chaque ligne : copiez-la, ouvrez l'île → Presse-papiers → Historique.
Attendu : la copie n'est PAS dans la liste ; une petite notification
« Clé ignorée » apparaît ; en haut de l'historique, une ligne discrète
« 🔒 Clé ignorée · <famille> ».

- [ ] 2.1 `ghp_` + 3 fois le motif → « Jeton GitHub ».
- [ ] 2.2 `sk-ant-api03-` + 3 fois le motif → « Clé Anthropic ».
- [ ] 2.3 `sk-proj-` + 3 fois le motif → « Clé OpenAI ».
- [ ] 2.4 `AKIAIOSFODNN7EXAMPLE` (la clé d'exemple de la doc AWS) → « Clé AWS ».
- [ ] 2.5 `glpat-` + 2 fois le motif → « Jeton GitLab ».
- [ ] 2.6 `ANTHROPIC_API_KEY=sk-ant-api03-` + 3 fois le motif (ligne d'un
  fichier .env) → « Clé Anthropic » aussi.
- [ ] 2.7 `postgres://ondine:Tr0ub4dor3@db.local:5432/prod` → « Adresse avec
  mot de passe ».
- [ ] 2.8 Un fichier de clé privée (ex. `%USERPROFILE%\.ssh\id_ed25519` ouvert
  dans le Bloc-notes, Ctrl+A puis Ctrl+C ; ou une clé de test générée avec
  `ssh-keygen -t ed25519 -f test -N ""`) → « Clé privée ».
- [ ] 2.9 Le jeton d'exemple de jwt.io (en-tête `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`,
  trois parties séparées par des points) → « Jeton JWT », avec un bouton
  « Décoder » sur la ligne discrète.

## 3. Le décodeur de la copie en cours

- [ ] 3.1 Après 2.9, cliquez « Décoder » : l'en-tête et le contenu du JWT
  s'affichent (comme pour une copie de l'historique), avec « Copier ».
- [ ] 3.2 « ‹ Retour » : la ligne « Clé ignorée » est toujours là, le JWT
  n'est toujours pas dans la liste.
- [ ] 3.3 Copiez un texte ordinaire : la ligne « Clé ignorée » disparaît et le
  texte arrive en haut de l'historique.

## 4. Ailleurs

- [ ] 4.1 Lanceur (Alt+Espace ou votre raccourci) : tapez `ghp_` ou `sk-ant` :
  aucune copie du Presse-papiers ne sort.
- [ ] 4.2 Halos (animation « Copié » avec le début du texte, si activée) :
  copier une clé montre « Copié » sans le texte.
- [ ] 4.3 Si vous avez deux PC appairés avec « Presse-papiers partagé » (Équipe) :
  une clé copiée sur l'un n'arrive PAS sur l'autre ; un texte ordinaire, si.
- [ ] 4.4 Le journal (`%LOCALAPPDATA%\Ondine\logs\ondine.log`, en mode
  débogage) dit au plus « copie ressemblant à une clé, ignorée », sans la clé
  ni sa famille.

## 5. Pas de faux positifs

Chacune de ces copies DOIT arriver dans l'historique, sans notification :

- [ ] 5.1 Une phrase : `La clé commence par sk-ant- puis une longue suite.`
- [ ] 5.2 Un lien : `https://www.exemple.fr/articles/une-page?id=42`
- [ ] 5.3 Un hash git (40 caractères hexadécimaux, ex. `git log -1 --format=%H`).
- [ ] 5.4 Un UUID : `123e4567-e89b-12d3-a456-426614174000`
- [ ] 5.5 Une adresse d'exemple : `postgres://user:password@localhost/db`
- [ ] 5.6 Une phrase qui contient une clé au milieu (`Ma clé est ghp_… merci`) :
  gardée, c'est voulu (seules les copies qui SONT une clé sont ignorées).
- [ ] 5.7 Un certificat public (`-----BEGIN CERTIFICATE-----`…) : gardé.

## 6. Réglage désactivé

- [ ] 6.1 Décochez « Ignorer les clés et jetons », recopiez 2.1 : la copie
  arrive dans l'historique, sans notification.
- [ ] 6.2 Recochez-le : les copies suivantes sont de nouveau ignorées (celles
  déjà gardées restent jusqu'à ce que vous les retiriez).
