# EAD Chantier

Application de chantier des **Entreprises Allen Dumaresq** (génie civil) : les plans, les documents, les photos et les rapports journaliers d'un projet, au même endroit, sur le cellulaire de chaque travailleur.

- **Plans** : un PDF est découpé en feuilles, chaque feuille en tuiles d'image. Une grande feuille s'ouvre tout de suite et reste nette au zoom, même avec peu de réseau. Les révisions remplacent l'ancienne version ; le chantier voit toujours la bonne.
- **Hors ligne** : les plans d'un projet se téléchargent sur l'appareil pour le chantier.
- **Connexion sans mot de passe** : un lien d'invitation personnel ou son code à taper, le code QR du chantier, ou un compte créé avec le code de l'entreprise.
- **App iPhone** : une coquille native (`ios/`) qui affiche le site en direct, distribuée par l'App Store comme app non répertoriée. Voir `docs/ios/`.

## Démarrer en développement

```bash
npm install
npm run db:start      # Postgres local dans .data/pg
npm run db:migrate
npm run dev           # http://localhost:3000
```

La première fois, ouvrir `/demarrer` pour créer le compte du bureau. En développement, le code de démarrage est `dev` (voir `SETUP_CODE` plus bas).

| Commande               | Rôle                                                   |
| ---------------------- | ------------------------------------------------------ |
| `npm run dev`          | Serveur de développement                               |
| `npm run build`        | Build de production                                    |
| `npm run typecheck`    | TypeScript                                             |
| `npm run lint`         | ESLint                                                 |
| `npm run db:generate`  | Crée une migration après un changement du schéma       |
| `npm run db:migrate`   | Applique les migrations                                |
| `npm run db:reset`     | Repart d'une base vide                                 |
| `npm run sample:plans` | Génère un cahier de plans fictif (PDF) pour les essais |

`scripts/smoke-api.mts` vérifie l'API de bout en bout sur une base vide (comptes, invitations, import et publication de plans, droits de chaque rôle, protections des liens, des codes QR et des envois de fichiers).

`npm run e2e` lance les tests de bout en bout (Playwright) contre un build de production, sur sa propre base de données.

## L'app iPhone

L'app iPhone « EAD » ne contient pas le site : elle l'affiche. Une mise en ligne du site arrive donc aussi dans l'app, sans passer par Apple.

- `docs/ios/README.md` : comment l'app est faite, et pourquoi.
- `docs/ios/MAC.md` : le guide, en français, que suit Claude Code sur le Mac du propriétaire pour construire l'app, l'essayer et l'envoyer à Apple (scripts `scripts/ios-*.sh`). Rien de l'app ne se compile ailleurs que sur un Mac.
- `store/` : la fiche App Store (textes à coller, captures d'écran, notes pour la vérification d'Apple, demande de distribution non répertoriée).
- `docs/ios/app-privacy.md` : les réponses au questionnaire de confidentialité d'Apple, chacune avec le fichier qui la prouve.

Les pages publiques `/confidentialite` et `/soutien` affichent les coordonnées de l'entreprise, que le bureau tient à jour dans l'app (Équipe, carte « Coordonnées de l'entreprise »).

## Comment c'est fait

- **Next.js 16** héberge une application à page unique : la page `/` est servie pour toutes les adresses, et le routeur du navigateur (`src/client`) fait le reste. C'est ce qui permet d'ouvrir l'app sans réseau.
- **API** : `src/app/api`, en JSON. La logique est dans `src/server`.
- **Base de données** : Postgres, schéma dans `src/server/db/schema.ts` (Drizzle), migrations dans `drizzle/`.
- **Fichiers** : `src/server/storage`. En développement, un dossier (`.data/storage`) ; en production, Supabase Storage. Les originaux sont privés ; les tuiles, vignettes et photos sont publiques sous des noms impossibles à deviner, pour être servies vite et gardées hors ligne.
- **Plans** : `src/server/plans`. PDFium dessine chaque page à 200 ppp, sharp la découpe en tuiles WebP (pyramide Deep Zoom).

### Rôles

| Rôle         | Voit             | Peut                                                                |
| ------------ | ---------------- | ------------------------------------------------------------------- |
| Bureau       | tous les projets | tout : projets, personnes, plans, documents                         |
| Contremaître | ses projets      | ajouter plans et documents, rapport journalier, code QR du chantier |
| Travailleur  | ses projets      | consulter, ajouter des photos                                       |

## Variables d'environnement

Voir `.env.example`. En production : `DATABASE_URL` (ou `POSTGRES_URL`), `APP_SECRET`, `SETUP_CODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, et `IOS_APP_ID` une fois l'app iPhone créée chez Apple.

- **`SETUP_CODE`** : le code de démarrage, demandé une seule fois à l'adresse `/demarrer` pour créer le premier compte du bureau. Tant que ce compte n'existe pas, ce code est la seule protection de l'application : en production il doit compter **au moins 16 caractères**, sinon il est ignoré et la configuration reste fermée. Pour en générer un : `openssl rand -base64 24`. Une fois le compte du bureau créé, **retirez la variable** des réglages : elle ne sert plus (le déploiement le rappelle).
- **Stockage des fichiers** : en production, les fichiers vont dans Supabase Storage (`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`). Le dossier sur disque (`STORAGE_DRIVER=fs`) est réservé au développement : un serveur de production le refuse et le déploiement s'arrête si la base de données est configurée sans Supabase. Ne copiez donc pas `STORAGE_DRIVER=fs` en production. Pour un serveur d'essai seulement, `ALLOW_FS_STORAGE=1` l'autorise (les tests de bout en bout s'en servent).
- **`IOS_APP_ID`** : l'identifiant de l'app iPhone tel qu'Apple le nomme, soit le Team ID, un point, puis l'identifiant de l'app (`ABCDE12345.ca.allendumaresq.ead`). Avec lui, le site publie la liste des adresses qui ouvrent l'app (`/.well-known/apple-app-site-association`) ; sans lui, cette adresse répond 404 et les liens s'ouvrent dans le navigateur. Ce n'est pas un secret, mais il reste dans les réglages de l'hébergeur.
- Le déploiement (`scripts/deploy-prepare.ts`) fixe aussi, dans Supabase, la taille maximale d'un fichier (500 Mo) et les types de fichiers acceptés. Si le projet Supabase a une limite globale plus basse, il l'indique et continue : augmentez alors cette limite dans les réglages de stockage de Supabase, sans quoi les gros PDF de plans seront refusés.

## Le bureau n'a plus accès à l'application

Personne n'a de mot de passe : on entre par un lien personnel, que seul un compte du bureau peut créer. Si le bureau perd son dernier appareil connecté (téléphone perdu, navigateur vidé), il faut un nouveau lien, créé directement dans la base de données :

```bash
DATABASE_URL="postgres://…" npx tsx scripts/admin-link.ts https://adresse-du-site "Nom de la personne"
```

- `DATABASE_URL` est l'adresse de la base de production (celle des réglages de l'hébergeur). Sans elle, le script lit `.env.local`.
- Le premier argument est l'adresse du site, telle qu'on l'ouvre dans le navigateur.
- Le second est le nom (ou une partie du nom) ou l'identifiant d'un compte **actif du bureau**. On peut l'omettre si le bureau n'a qu'un compte ; sinon le script affiche la liste des comptes.

Le script affiche un lien `/i/…` à ouvrir sur l'appareil à connecter, et un code de 8 chiffres à taper dans l'app iPhone avec le cellulaire de la personne (« J'ai déjà un compte », puis « Avec un code du bureau »). L'un ou l'autre sert une seule fois, pendant 14 jours, et annule les liens déjà envoyés à cette personne. Ne les transmettez qu'à elle : quiconque s'en sert entre dans l'application à sa place.

À noter : un lien personnel ouvert sur un appareil où **quelqu'un d'autre** est déjà connecté ne remplace plus cette personne. L'écran le dit et propose de déconnecter l'appareil d'abord.
