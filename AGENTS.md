<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# EAD Chantier

A custom app for Les Entreprises Allen Dumaresq (EAD), a civil engineering
contractor: the plans, documents, site photos and daily reports of each
project, on the phone of everyone at the site. Plans are the reason it exists:
they must open fast, on a phone, with a bad signal or none. Users are site
workers, foremen and the office; most are not comfortable with software.
The interface is in Québec French only.

## How it is built

- **One page, drawn in the browser.** Next.js serves `src/app/page.tsx` for
  every address that is not an API route or a file (`rewrites` in
  `next.config.ts`). `src/client` is a single-page app: `wouter` for the
  addresses, TanStack Query for data. This is what lets a service worker open
  any screen offline. Do not add Next pages, server components or server
  actions for screens.
- **API**: route handlers under `src/app/api`, each wrapped in `route()` from
  `src/server/http.ts` (JSON in and out, errors as
  `{ error: { code, message } }` with a French message fit to show to the
  person, same-origin check on writes). Inputs are validated with zod through
  `body()`. Throw `badRequest()`, `forbidden()`, `notFound()`.
- **Who may do what**: `requireUser` / `requireAdmin` (`src/server/auth.ts`),
  then `projectFor(user, projectId)` (member or office, else 404) or
  `projectToManage(user, projectId)` (foreman of the project or office) from
  `src/server/access.ts`. Every route that touches a project goes through one
  of them; a record's project is looked up from the record, never trusted from
  the request. Roles are in `src/shared/roles.ts`: `admin` (shown as
  "Bureau"), `contremaitre`, `travailleur`. Daily reports are for foremen and
  the office only.
- **Archived projects** are read-only for everyone but the office, and nobody
  new joins them. A route that changes a project's content uses
  `projectToChange` (instead of `projectToManage`) or, where any member may
  add (photos), `projectToAddTo`; a route that first finds a record and then
  its project calls `assertOpen(user, project)`. Reading stays on
  `projectFor` / `projectToManage`.
- **Uploads** are bounded per person (unfinished and per day; a refusal is a
  429 with code `too_many_uploads`: wait, do not retry in a loop). An upload
  link writes once and must carry exactly the announced type. A module that
  no longer needs an upload's file drops it with `discardUpload()`
  (`src/server/uploads.ts`), never by deleting from storage itself.
- **Database**: Postgres with Drizzle (`src/server/db/schema.ts`, migrations
  in `drizzle/`, generated with `npm run db:generate`). Ids are made by the
  app (`newId()`).
- **Files**: `storage()` from `src/server/storage` (a folder in development,
  Supabase Storage in production). Originals (PDFs, documents) are private and
  reached through short-lived signed links (`downloadUrl`). What must load
  fast and offline (plan tiles, thumbnails, photos) is public, under an
  unguessable prefix (`newPublicKey()`), and never changes once written.
  Uploads go straight to storage: `beginUpload` → the browser PUTs the file →
  `completeUpload`, then the module's own endpoint takes the upload with
  `takeUpload()` (`src/server/uploads.ts`).
- **Shapes shared by both sides** are in `src/shared` (one file per module).

## The browser side (`src/client`)

- `routes.tsx` lists every address. Each module owns the addresses under its
  part of a project through its own `modules/<module>/routes.tsx` (a
  `<Switch>` with full paths, e.g. `/projets/:projectId/plans/import/:importId`).
- Inside a project (`/projets/:projectId/…`) the project and the person are
  already loaded: `useCurrentProject()`, `useCurrentUser()`
  (`lib/session.ts`). `project.canManage` says whether to show management
  buttons; the server decides again on every request.
- Every screen starts with `<Page title=… back=… actions=…>` (`shell/page.tsx`).
  Building blocks come from `@/client/ui` (`Button`, `ButtonLink`,
  `IconButton`, `Card`, `Badge`, `Sheet`, `confirmAction`, `Field`, `Input`,
  `Textarea`, `Select`, `SearchInput`, `FormError`, `EmptyState`,
  `ErrorState`, `QueryState`, `Skeleton`, `Spinner`, `ProgressBar`, `Avatar`,
  `toast`). Reuse them; add a block there only when two modules need it.
- Data: `api<T>(path, { method, body })` (`lib/api.ts`) inside `useQuery` /
  `useMutation`. Query keys of a project's data start with
  `keys.project(projectId)` (e.g. `[...keys.project(id), "documents"]`), so
  invalidating the project refreshes everything, counts included. Render
  queries with `<QueryState>`: it shows what the device already holds when
  the network fails. Everything fetched is kept on the device for offline
  use; mark searches and signed links with `meta: { persist: false }`.
- Navigation: `<Link href>` and `useLocation()` from `wouter`, or
  `navigate()` from `lib/location.ts`. Never `next/link` or `next/navigation`.
- Files are sent with `uploadFile()` (`lib/upload.ts`), which reports progress.
- Images are plain `<img>` (with `crossOrigin="anonymous"` for anything from
  storage, so the service worker can keep it), never `next/image`.
- Dates, sizes and counts: `lib/format.ts`.

## Look and wording

- Light screens for sunlight, black bars, EAD's blue. Colours and fonts are
  tokens in `src/app/globals.css` (`bg-canvas`, `bg-surface`, `text-dim`,
  `border-line`, `bg-ead-dark` for buttons, `text-ead-dark` for links, `ead`
  for accents and on black). The logo is drawn for black backgrounds only.
- Touch targets are at least 44 px; the main action of a screen is a large
  button within reach of the thumb. Works from a 360 px phone to a desktop:
  phones get the tabs at the bottom, wide screens the sidebar.
- Text is Québec French, plain and short, as a foreman would say it: "feuille"
  for a plan sheet, "chantier", "bureau", "contremaître". No space before "?"
  and "!", a non-breaking space before ":". Say what happened and what to do;
  no jargon, no English, no "oups". Avoid sentences built as "X, pas Y".
- Sample data is fictional and says so on plans ("EXEMPLE"). Never invent
  facts about EAD.

## Working on it

```
npm run db:start        # local Postgres (kept in .data/pg)
npm run db:fresh        # empty the database named by DATABASE_URL, apply migrations
npm run dev             # http://localhost:3000 (-- -p 3200 for another port)
BASE=http://localhost:3200 npm run seed   # fictional projects, plans, three signed-in roles
npm run typecheck && npm run lint && npm test
```

`npm run seed` leaves Playwright sessions in `.data/dev/` (`admin.json`,
`foreman.json`, `worker.json`) and the ids in `.data/dev/seed.json`. Check
screens in a real browser at phone size (390 px wide) and on a desktop, as
each role.

`npm run e2e` builds the app, starts it on its own database, seeds it and runs
the Playwright tests of `e2e/` at phone and desktop sizes (`E2E_PORT` and
`E2E_DB` let two runs coexist). Every module has a spec there; a change to a
screen or a route comes with a test that would fail without it.
