# App Store Connect: "App Privacy" answers for EAD

## En bref (pour le propriétaire)

Dans App Store Connect, à **App Privacy**, répondez **« Yes, we collect data »**, puis
cochez les types marqués **Collected** dans le tableau plus bas. Pour chacun : le but est
**App Functionality** (le fonctionnement de l'app), il est **lié à la personne** (Linked to
the user), et il ne sert **jamais au pistage** (Tracking : No). L'app n'a ni publicité, ni
outil de statistiques, ni pistage.

Ce que l'app recueille : le nom, le cellulaire et le courriel de la personne, son identifiant
de compte, les photos, les rapports, documents et plans qu'elle ajoute, l'enregistrement de sa
voix quand elle dicte (seulement après son accord), et la date de sa dernière visite.

Avant d'envoyer des renseignements hors du Québec (Vercel, Supabase, Anthropic, OpenAI), la Loi
25 demande à l'entreprise de faire une évaluation des facteurs relatifs à la vie privée. C'est
un document à préparer par l'entreprise elle-même, hors de l'app.

L'adresse de la politique de confidentialité à donner à Apple :
`https://ead-chantier.vercel.app/confidentialite`. Celle du soutien (Support URL) :
`https://ead-chantier.vercel.app/soutien`.

---

## How to read this

Apple's definition: data is **collected** when it leaves the device in a way that lets the
developer or its partners access it for longer than needed to answer the request in real time.
Each line below is derived from the code at the commit that added this file; the "Proof"
column names the file that shows it. When the code changes, this page must change with it.

Answers that apply to every type marked Collected:

- **Purpose**: App Functionality only. There is no advertising, no analytics SDK, no
  personalisation, no marketing (a search of `src/`, `public/`, `package.json` and
  `next.config.ts` finds no analytics, advertising or tracking code).
- **Linked to the user's identity**: Yes. Everything is kept against the person's account
  (`createdBy`, `userId` columns in `src/server/db/schema.ts`).
- **Used for tracking**: No, never. Nothing is shared with data brokers or combined with
  other companies' data; there is no IDFA or third-party SDK in `ios/` or `package.json`.

## Data types

| Apple category | Data type | Collected? | Why / notes | Proof |
| --- | --- | --- | --- | --- |
| Contact Info | Name | **Collected** | The person's name, shown to their team and on reports, and written by a foreman or the office in a report's crew lines. Sent with the report to the AI service (to spell names right) when someone who agreed uses the assistant. | `users.name` in `src/server/db/schema.ts` |
| Contact Info | Email Address | **Collected** | Optional; entered by the office or the person. | `users.email` in `src/server/db/schema.ts`, `src/server/people/rules.ts` |
| Contact Info | Phone Number | **Collected** | The cell number used to make an account and to reach the person at work. | `users.phone`; `src/app/api/signup/route.ts` |
| Contact Info | Physical Address | No | Project addresses are sites, not the user's address. The company's own address is entered by the office for the policy page. | `projects.address`; `src/server/company/profile.ts` |
| Contact Info | Other User Contact Info | No | | |
| Health & Fitness | Health, Fitness | No | | |
| Financial Info | Payment Info, Credit Info, Other Financial Info | No | No purchases in the app. | |
| Location | Precise Location | No | The app never asks for the device's position. A site photo's EXIF (GPS included) is dropped when the server redraws it; the uploaded original is deleted right after. An image added as a *document* (jpg, png, webp, heic) is kept as sent, with whatever metadata the file holds; the app never reads it. It is user content the person chose to upload, declared under Other User Content. | `src/server/photos/process.ts`, `src/server/photos/changes.ts` (`discardUpload`); `src/shared/documents.ts`, `src/server/documents.ts` |
| Location | Coarse Location | No | Network addresses are kept only as a keyed digest, used only to count the last two days' attempts at account creation; older rows are removed at the next attempt. No location is derived. | `src/server/signup/door.ts` (`addressKey`) |
| Sensitive Info | Sensitive Info | No | | |
| Contacts | Contacts | No | The address book is never read. | |
| User Content | Emails or Text Messages | No | | |
| User Content | Photos or Videos | **Collected** | Site photos the person takes or adds; also sent, made small, to the AI service when the person asks the assistant to describe them (after agreeing). | `photos` table; `src/server/dictation/photos.ts` |
| User Content | Audio Data | **Collected** (conservative) | The recording of a dictated report is sent, through Vercel AI Gateway, to OpenAI for transcription, only after the person's explicit agreement. The app itself does not store it, but the transcription models are outside the gateway's zero-retention routing, so the provider may keep it under its own terms: declare it. | `src/app/api/projects/[id]/reports/dictation/route.ts`, `src/server/dictation/write.ts` (`transcribeDictation`), `src/server/legal/consent.ts` |
| User Content | Gameplay Content | No | | |
| User Content | Customer Support | No | Support is by phone or email with the company, outside the app. | `src/app/soutien/page.tsx` |
| User Content | Other User Content | **Collected** | Daily reports (text, crew names and hours), documents (kept as sent, metadata included) and plan PDFs the person adds, photo descriptions. The report's text, crew lines included, is also sent to the AI service when the assistant is used. | `daily_reports`, `documents`, `plan_imports`, `sheet_revisions` tables |
| Browsing History | Browsing History | No | | |
| Search History | Search History | No | Plan searches are answered and not stored. | `src/app/api/projects/[id]/plans/search/route.ts` |
| Identifiers | User ID | **Collected** | The account's id, made by the app. | `users.id`; `src/server/ids.ts` |
| Identifiers | Device ID | No | A signed-in device holds a random session token in one cookie; only its hash is kept. It is not a device identifier and is not shared. | `src/server/auth.ts` (`SESSION_COOKIE`, `sessions.tokenHash`) |
| Purchases | Purchase History | No | | |
| Usage Data | Product Interaction | **Collected** (conservative) | The date of each device's last visit and of the person's last visit, noted at most every six hours, so the office and the person can recognise and sign out old devices. | `sessions.lastSeenAt`, `users.lastSeenAt`; `sessionRenewal` in `src/server/auth.ts` |
| Usage Data | Advertising Data | No | | |
| Usage Data | Other Usage Data | No | The count of assistant requests per person (rows older than two days are removed at the person's next request; used only to cap the cost) is a technical limit, not usage analytics. | `src/server/ai/usage.ts` |
| Diagnostics | Crash Data, Performance Data, Other Diagnostic Data | No | No crash or performance reporting SDK. Server errors are written to the host's logs without device diagnostics. | `package.json`; `src/server/http.ts` |
| Surroundings | Environment Scanning | No | | |
| Body | Hands, Head | No | | |
| Other Data | Other Data Types | **Collected** (conservative) | The kind of device and browser of each signed-in device ("iPhone · Safari"), shown in the person's device list. | `deviceLabel` in `src/server/auth.ts` |

## Third parties that receive data

These are processors working for the app, not tracking partners; Apple's form does not ask
for them, but the privacy policy names them.

- **Vercel**: hosting (functions in Montréal, `vercel.json` `regions: ["yul1"]`) and AI
  Gateway (`src/server/ai/gateway.ts`).
- **Supabase**: the Postgres database and file storage (`src/server/storage/supabase.ts`).
- **Anthropic** (report writing and photo descriptions) and **OpenAI** (transcription),
  reached through the gateway, only for a person who agreed
  (`src/server/legal/consent.ts`, `src/server/dictation/write.ts`). Each call carries the
  gateway's `only` filter (`CLAUDE_PROVIDERS`, `TRANSCRIPTION_PROVIDERS` in `write.ts`), so the
  gateway never fails over to another company serving the same model (Google Vertex AI,
  Amazon Bedrock).

## Related answers elsewhere in App Store Connect

- **Privacy Policy URL**: `/confidentialite` on the production address.
- **Account deletion** (guideline 5.1.1(v)): Mon compte → Supprimer mon compte
  (`src/client/modules/admin/account.tsx`, `src/server/people/delete.ts`).
- **Third-party AI** (guideline 5.1.2(i)): the assistant asks for explicit permission before
  anything is sent, and the server refuses a dictation without it (error code
  `assistant_consent_required`). Taken back at Mon compte → Assistant du rapport. The question
  names what is sent (voice, report text, photos, the names of the person and of the site's
  people), to whom (Anthropic, OpenAI, through Vercel) and where (United States), and is asked
  again when that changes (`ASSISTANT_TERMS_SINCE` in `src/server/legal/consent.ts`).
