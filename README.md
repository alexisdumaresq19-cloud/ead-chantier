# EAD Chantier

Application de chantier des **Entreprises Allen Dumaresq** (génie civil) : les plans, les documents, les photos et les rapports journaliers d'un projet, au même endroit, sur le cellulaire de chaque travailleur.

- **Plans** : un PDF est découpé en feuilles, chaque feuille en tuiles d'image. Une grande feuille s'ouvre tout de suite et reste nette au zoom, même avec peu de réseau. Les révisions remplacent l'ancienne version ; le chantier voit toujours la bonne.
- **Hors ligne** : les plans d'un projet se téléchargent sur l'appareil pour le chantier.
- **Connexion sans mot de passe** : un lien d'invitation personnel, ou le code QR du chantier.

## Démarrer en développement

```bash
npm install
npm run db:start      # Postgres local dans .data/pg
npm run db:migrate
npm run dev           # http://localhost:3000
```

La première fois, ouvrir `/demarrer?code=dev` pour créer le compte du bureau.

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

`scripts/smoke-api.mts` vérifie l'API de bout en bout sur une base vide (comptes, invitations, import et publication de plans, droits de chaque rôle).

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

Voir `.env.example`. En production : `DATABASE_URL` (ou `POSTGRES_URL`), `APP_SECRET`, `SETUP_CODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
