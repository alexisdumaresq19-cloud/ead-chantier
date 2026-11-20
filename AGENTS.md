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
- **Getting in, without a password**: the office sends someone a personal
  link (`/i/<token>`), which comes with an 8-digit code to type with one's
  cell number (`/bienvenue/code`, for the iPhone app, where a link in a text
  message would open the browser); a foreman shows a site's QR code
  (`/j/<token>`, which puts a worker on that project); or the person makes
  their own account with the company's code. That last way is the office's
  to open (Équipe → Code d'entreprise; the `app_settings` row
  `company_code`, null while closed):
  `/inscription` (`POST /api/signup`, `src/server/signup`) creates a worker on
  no project, `unreviewed`, signed in for `UNREVIEWED_SESSION_DAYS`, whom the
  office then confirms and adds to projects. The office's link carries the
  code in the fragment (`/inscription#code=…`), never in the query.
- **The door of account creation** (`src/server/signup/door.ts`): one
  transaction under the advisory lock `ead:signup` (`holdDoor`, a 5 s wait,
  then a 429) counts the tries, compares the code, records the try and makes
  the account; never count outside it. Networks are keyed by `networkOf`
  (IPv4 as it is, IPv6 by /64) and stored as a keyed digest. Wrong codes and
  accounts are counted per day since the current code was set, so a new code
  lifts both pauses; `GET /api/company/code` shows a pause to the office.
- **Signing in with a typed code** (`src/server/access-code`): the code and
  the link are one invitation, with one use, one end date, replaced together;
  only `invites.code_hash` is kept, a keyed digest bound to the invitation.
  `POST /api/sessions/code {phone, code}` answers every wrong pair the same
  way and in the same time, whether or not the number is anyone's. Its door
  (`access-code/door.ts`) counts wrong tries in `signup_attempts` under its
  own outcomes and its own locks (per network, then per number, always in
  that order): `ACCESS_TRIES_PER_HOUR` per network, and
  `ACCESS_WRONG_PER_NUMBER` per number a day since that number's newest
  code, of which one network fills a third at most. So no single network
  locks a person out, and a new link from the office reopens a number. The
  text the office sends (`inviteMessage`) gives the code first and the link
  last: a link opened in an iPhone's browser uses up the code the app needs.
- **The demonstration access** (`access-code/demo.ts`, `/api/company/demo`,
  Équipe → Accès de démonstration) is what the office hands to Apple's
  reviewer. The `app_settings` row `demo_access` keeps `{phone, code,
projectIds}` readable, since the office reads it again; the number is
  fictional and nobody of the team may be given it (`isDemoPhone`). Behind
  it is one account (`users.demo`, shown to the screens as `me.demo`): a
  foreman on the chosen projects, signed in for a day at a time, who adds
  photos, documents and reports, changes only what it added itself, and
  never the plans or the team (`refuseDemoUnlessAuthor`, `refuseDemoOnPlans`
  in `access-code/rules.ts`). A new route that changes a project's content
  calls one of them, a new route about the team checks `user.demo`, and the
  screens hide what the server would refuse. Its visitor may delete the
  account, as Apple asks; the next sign-in makes it again, a few times a day
  at most. Its number is counted per network only, because its code is
  handed out.
- **Deleting one's account** (`DELETE /api/me`, `src/server/people/delete.ts`):
  someone whose id is the author of reports, photos, documents, plans or
  projects keeps a `users` row with the name only and `deleted_at` set;
  everyone else is removed. The last active office account is refused, and
  Mon compte says so before offering anything.
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
- **The assistant's agreement and who receives what**: nothing reaches an AI
  service before the person agrees (`users.assistant_consent_at`). The
  dictation window asks once and names what is sent
  (`modules/reports/dictation/consent-step.tsx`); Mon compte lets the person
  take it back. The server refuses without it (`assertAssistantConsent` in
  `src/server/legal/consent.ts`, 403 `assistant_consent_required`): a new
  route that calls an AI service calls it too. Every gateway call is held to
  one company with `providerOptions.gateway.only` (`CLAUDE_PROVIDERS`,
  `TRANSCRIPTION_PROVIDERS` in `dictation/write.ts`): without it the gateway
  fails over to other companies serving the same model, which the policy
  does not name. A new model, a new provider or anything more sent means a
  new policy text, a later `ASSISTANT_TERMS_SINCE` (an agreement older than
  it is asked again) and a new answer in `docs/ios/app-privacy.md`.
- **Public pages and the company's details**: `/confidentialite` and
  `/soutien` are the only Next pages besides the app's own (server
  components in `src/app`, sharing `src/app/_legal/parts.tsx`): no account,
  no JavaScript, left alone by the service worker and by the links that open
  the iPhone app. They show the company's details, which the office keeps
  (Équipe → Coordonnées de l'entreprise, the `app_settings` row
  `company_profile`, `GET`/`PUT /api/company/profile`). Every sentence of
  the policy states what the code does: a change to what is stored, sent or
  deleted (schema, auth, the doors, dictation, deletion, the host's
  settings) changes the policy and `POLICY_VERSION` with it.
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
- **The iPhone app** (`ios/`, `capacitor.config.ts`, `ios-shell/`; Capacitor
  8, Swift packages) is a shell around the live site (`server.url`) and
  carries none of it: a deployment reaches the app at once, and only a
  change to those files or to the `@capacitor/*` packages needs a new upload
  to Apple. `docs/ios/README.md` says how it is put together and why.
  `docs/ios/MAC.md` is the French guide an agent follows on the owner's Mac
  with `scripts/ios-*.sh` (bash 3.2, French messages): nothing of the app
  can be compiled here, so every claim about it rests on Capacitor's and
  WebKit's sources, and the guide says how to prove each on the Mac. The
  site's host is written in `capacitor.config.ts`, `Info.plist`
  (`WKAppBoundDomains`), `App.entitlements` and `src/client/native/links.ts`:
  they change together. Links to the site open the app through
  `/.well-known/apple-app-site-association` (from `IOS_APP_ID`; 404 without
  it). `guide.test.ts`, beside that route, holds the guide to the rest: its
  step pointers, the screen labels it quotes ("Mon compte", "Se déconnecter",
  "Supprimer mon compte", `/moi`) and the values it shares with
  `store/README.md`.
- **The App Store listing** (`store/`): the French texts to paste, the
  review notes and the request for unlisted distribution (both in English,
  for Apple), and the screenshots. A screen or a feature that changes takes
  the description, the review notes and `docs/ios/app-privacy.md` with it.
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
- **Inside the iPhone app** (`isNativeApp()`, `src/client/native`): a new tab
  or `window.open` leaves for Safari, where nobody is signed in; a `blob:`
  address, a download link and `window.print()` do nothing. So `openFile()`
  or `openFileAt()` shows a file in the system's viewer, `shareFile()` and
  `shareLinkInApp()` open the share sheet (which also saves and prints), and
  no "Télécharger" or "Imprimer" button is offered there. Plugin code is
  never imported statically: a screen does `await import("../../native/…")`
  behind `isNativeApp()`, so browsers never download it, and a loader in
  `native/plugins.ts` returns the module, never the plugin (a plugin is a
  Proxy that answers `then`: a promise resolved with it calls the native
  side). Links that open the app arrive by `appUrlOpen` only; never ask
  `App.getLaunchUrl`, which answers the last link for ever. A plugin used
  from a tap that must work offline is fetched ahead in `warmPlugins()`.
  `/diagnostic` (public, linked from nowhere) says what the shell gives the
  page; the Mac guide reads it, and support asks for a screenshot of it.

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
screen or a route comes with a test that would fail without it. The test
server holds the door of account creation with its own limits
(`scripts/e2e.sh`); a test that makes an account uses `deviceAt()` from
`e2e/support.ts`, so that each has its own network address.

The iPhone app is tested without a Mac by giving Chromium what the shell
gives the page: `asNativeApp(context)` from `e2e/nativeweb-support.ts` injects
Capacitor's real `native-bridge.js` over a fake native side that records the
calls and keeps its state across page loads, as the real one does
(`nativeCalls`, `answerNative`, `emitNative`, `openedByLink`);
`src/client/native/fake-bridge.ts` does the same for unit tests, once per
test file. Screenshots with a notch: CDP `Emulation.setSafeAreaInsetsOverride`.
A sheet ignores taps for 350 ms after it opens: a test waits before tapping
inside one.

The App Store screenshots are taken from the sample data, on a production
build over a fresh database, in this order: the seed, `scripts/store-sample.mts`
(real public-domain site photos marked "EXEMPLE" and believable documents in
place of the seed's drawn ones), then `scripts/store-screenshots.mts` (it
draws the iPhone's status bar and insets itself, and fails if a screen shows
through under the bottom bar). Their headers say how to run them; look at
the twelve images before committing them.
