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
  new joins them. A project tells the screens two things: `canManage` (its
  foreman or the office: reads what only they read, such as the reports,
  archived or not) and `canChange` (`canManage` on a project that is open, or
  the office): adding, editing and the QR code are offered on `canChange`. A route that changes a project's content uses
  `projectToChange` (instead of `projectToManage`) or, where any member may
  add (photos), `projectToAddTo`; a route that first finds a record and then
  its project calls `assertOpen(user, project)`. Reading stays on
  `projectFor` / `projectToManage`.
- **Uploads** are bounded per person (unfinished and per day; a refusal is a
  429 with code `too_many_uploads`: wait, do not retry in a loop). An upload
  link writes once and must carry exactly the announced type. A module that
  no longer needs an upload's file drops it with `discardUpload()`
  (`src/server/uploads.ts`), never by deleting from storage or from the
  uploads table itself: the row stays a day, marked, because it is what the
  day's allowance is counted from. The module removes its own row that refers
  to the upload first.
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
- **AI (the report's assistant)**: through Vercel AI Gateway, with no key to
  manage: on Vercel the deployment signs in by itself (`src/server/ai/gateway.ts`).
  Claude is called with the official Anthropic SDK pointed at the gateway;
  the recording is turned into text with the `ai` package. One call to the
  model per request (`src/server/dictation/write.ts`), every call ended by a
  deadline shorter than the route's own. The model never rewrites a report:
  it returns a small patch that the server merges
  (`src/server/dictation/patch.ts`), so nothing already written is lost, and
  nothing of the report is saved by the assistant. It also sees the report's
  photos: the screen sends them as it numbers them, the server looks their
  ids up among the project's photos only, and gives the model the ones
  without a description, eight at most, made small
  (`src/server/dictation/photos.ts`); the descriptions that come back are
  applied by the window at once (they are the photos' own) and its undo puts
  the former ones back. Two tasks run without a dictation: `describe` (the
  photos) and `tidy` (a clean copy of the texts, accepted only if every
  figure is kept and none is added: `keepsTheFacts`). What is said, what a
  photo shows and what is written on it are data, never instructions. Every
  request is counted against a per-person allowance first (`countDictation`,
  429 `too_many_dictations`). `AI_FAKE=1` (set by the end-to-end tests)
  answers with fixed rules and calls nothing. A screen offers the assistant
  only when `GET /api/assistant` says so.
- **A daily report and its photos**: a report names the photos that go with
  it (`photoIds`, saved with the rest of the report, 40 at most); the photos
  themselves stay the project's (`photos` table, gallery, descriptions). The
  API hands a report back with `photos`, those of its list the project holds,
  oldest first; an id not found (a photo still on its way from a phone, or
  removed since) simply does not show. On screen, `useReportPhotos()`
  (`modules/reports/photos.ts`) finds each photo where it is: still on the
  device (the outbox) or in the project; the form of a saved report hands it
  the photos the report came with, so they show without a network. A form
  coming back from an earlier moment (the assistant's answer, an undo) keeps
  the photos the report has now (`keepingPhotos`).
- **A report's PDF** (`GET /api/reports/:id/pdf`, `src/server/reports/pdf`) is
  drawn with pdfkit, directly: no browser, no layout engine, so it is ready in
  a fraction of a second. The module places every line itself (`lines.ts`,
  `pen.ts`): a part's title keeps two lines with it, no line of a paragraph
  is left alone on a page, a list breaks as one block. Typed text is set the
  French way before it is drawn (`typeset()` in `words.ts`), and a character
  the typefaces lack is left out, never printed as a box (`glyphs.ts`).
  Photos are laid out in rows of one height that fill the width, never
  cropped or squeezed (`layout.ts`, a pure function). The typefaces and the
  logo are read from disk at run time; `next.config.ts` names them in that
  route's trace (`outputFileTracingIncludes`), and a path built at run time
  carries a `turbopackIgnore` mark, or the bundler traces the whole project.
- **Shapes shared by both sides** are in `src/shared` (one file per module).

## The browser side (`src/client`)

- `routes.tsx` lists every address. Each module owns the addresses under its
  part of a project through its own `modules/<module>/routes.tsx` (a
  `<Switch>` with full paths, e.g. `/projets/:projectId/plans/import/:importId`).
- Inside a project (`/projets/:projectId/…`) the project and the person are
  already loaded: `useCurrentProject()`, `useCurrentUser()`
  (`lib/session.ts`). `project.canChange` says whether to offer adding and
  editing (`canManage`: what only managers read, archived or not); the server
  decides again on every request.
- Every screen starts with `<Page title=… back=… actions=…>` (`shell/page.tsx`).
  Building blocks come from `@/client/ui` (`Button`, `ButtonLink`,
  `IconButton`, `Card`, `Badge`, `Sheet`, `confirmAction`, `Field`, `Input`,
  `Textarea`, `Select`, `SearchInput`, `FormError`, `EmptyState`,
  `ErrorState`, `QueryState`, `Skeleton`, `Spinner`, `ProgressBar`, `Avatar`,
  `toast`). Reuse them; add a block there only when two modules need it.
- On a phone there is one way back: the top bar's chevron goes where the
  screen's `back` prop says, and the in-page back link shows on computers
  only. Form screens (listed in `shell/shell.tsx`) hide the bottom tabs. The
  frame sets `--ead-tabs` on `<html>` (the height the tabs take, `0px` when
  hidden or on a computer): a bar stuck to the bottom of a screen sits at
  `bottom: var(--ead-tabs)` and adds the safe area itself when it is `0px`.
- Photos are taken from any screen with `TakePhotoButton`
  (`modules/photos/take.tsx`): it keeps the photo and opens its window on the
  same screen. The button holds that window: when its use must stop, hide its
  face, never unmount it. A window is drawn outside its screen's own
  elements, but React still hands its key and submit events to the screen's
  form: a form that holds windows ignores events that do not come from its
  own elements (`modules/reports/editor.tsx`). The plan sheets and projects opened last are in
  `lib/recents.ts` (on the device, cleared at sign-out).
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
`foreman.json`, `worker.json`) and the ids in `.data/dev/seed.json`. The
older of its two daily reports has sample photos; the other has none. Check
screens in a real browser at phone size (390 px wide) and on a desktop, as
each role.

`npm run e2e` builds the app, starts it on its own database, seeds it and runs
the Playwright tests of `e2e/` at phone and desktop sizes, each size on fresh
sample data, since tests change it (`E2E_PORT` and
`E2E_DB` let two runs coexist). Every module has a spec there; a change to a
screen or a route comes with a test that would fail without it.
