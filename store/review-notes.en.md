# App Review Information

What goes in App Store Connect, version 1.0, section "App Review Information". In English, for Apple's reviewer.

Every sentence below was checked against the app as it is now. Three things can only be proven on an iPhone and are tried in `docs/ios/MAC.md`, étape 4.9, before anything is sent to Apple: the share sheet and the document viewer, plans opened in airplane mode, and links that open the app. If one of them does not work in the build that goes to Apple, take its line out of "NATIVE CAPABILITIES" and recount.

## Sign-in information

- Sign-in required: **yes**
- User name: `<DEMO_PHONE>`
- Password: `<DEMO_CODE>`

The owner reads both in the app, signed in as the office: **Équipe** (the team screen), card **Accès de démonstration**. The **Copier** button beside **Cellulaire** copies the user name, the one beside **Code** the password: paste each in its own field. Nothing of that card goes in the Notes below, which already say how to sign in. The code keeps working as long as the office does not change it, so it stays valid for the whole review and the reviews of later versions.

The account shows only the sample project the office made for Apple (`store/README.md`, «&nbsp;Avant de commencer&nbsp;»): nobody of the team works on it, so the reviewer sees no real site, name or hours, and nothing the reviewer adds reaches the team's records.

## Contact information

- First name, last name, phone number, email: the person at EAD who answers Apple during the review (filled in by the owner; never committed here). The phone number goes in international format with the plus sign, for example +1 418 …; the field does not take digits alone.

## Notes

Paste the text below, from its first line to its last, into the "Notes" field, and nothing else: no line of the demonstration card, which would take the field past Apple's limit. 3,940 bytes of the 4,000 bytes allowed; `src/app/.well-known/apple-app-site-association/guide.test.ts` counts them, and fails when this number or the limit is wrong.

EAD is the private field app of Les Entreprises Allen Dumaresq, a civil-engineering contractor in Quebec, Canada. Its office, foremen and site workers use it to open construction plans on site, read project documents, take site photos and write daily reports. The interface is in Canadian French only.

ACCOUNTS
There is no public sign-up: employees get their account from the company (a personal link, their site's QR code, or a code from the office). Apple gets a demonstration account instead. It sees a sample project the office set up for it, as a foreman does. It can add photos, documents and reports, changes only what it added itself, and cannot manage the team.

HOW TO SIGN IN

1. Open the app and tap "Avec un code du bureau" (With a code from the office). If the first screen shows "Créer mon compte" instead (it needs the company's code), tap "J'ai déjà un compte" (I already have an account) first.
2. Type the phone number under "Cellulaire" and the code under "Code du bureau", then tap "Entrer".
3. Tap the project in the list.

WHERE THINGS ARE
Inside a project, the tabs at the bottom are Accueil (home), Plans, Documents, Photos and Rapports (daily reports).

- Plans: tap Plans, then a sheet. Pinch to zoom; the arrows at the bottom go to the next sheet; "Rév." shows earlier revisions.
- Photos: the Photos tab shows the site's photos by day. Tap one to see it full screen.
- Daily reports: the Rapports tab lists them. Tap one to read it. "PDF" makes the report as a PDF with its photos: "Ouvrir" shows it, "Partager" opens the share sheet.
- Documents: the Documents tab lists them by category. Tap one to open it.

CAMERA
Tap "Prendre une photo" on a project's home or in the Photos tab. iOS asks for camera access the first time. The photo is added to the project, with an optional description. Without a camera, "De la galerie" picks one from the library.

MICROPHONE (dictation of the daily report)
On the project's home, tap "Dicter le rapport du jour". Once today's report is saved, use "Dicter" in the Rapports tab. The first time, the app says what goes to an AI service (the voice, the report's text, its photos, the names of the site's people) and to which companies, and asks for agreement ("J'accepte"). Nothing is sent before the person agrees; the agreement can be withdrawn under "Mon compte". Recording then starts at once (iOS asks for microphone access the first time). Read aloud, for example: "Soleil, moins deux degrés. Marc Lévesque, dix heures. On a posé la conduite d'aqueduc." Then tap the round red button to stop. The report fills itself. "Écrire" sends typed text instead of the voice. Close the window ("Terminé" or ✕), then tap "Enregistrer".

ACCOUNT DELETION
Tap the round initials at the top right (or "Mon compte" on the projects list), scroll down to "Supprimer mon compte" and confirm. The account, its phone number, devices and AI agreement are erased at once. What it added stays in the project under its name only, as the privacy policy says. Deleting signs out every device using this account. The same number and code open it again, five times a day at most.

PRIVACY AND SUPPORT
The privacy policy and the support page are linked at the bottom of the first screen and of "Mon compte".

DISTRIBUTION
The app is for the company's team only and will be an unlisted app; the request for unlisted distribution is filed separately.

NATIVE CAPABILITIES
Around the company's web app, the native shell uses the device for what a site needs:

- the camera, to take site photos from any project;
- the microphone, to dictate the daily report;
- the iOS share sheet, to send a report's PDF, a photo or a document;
- the iOS document viewer, to open PDFs and office documents inside the app;
- plans kept on the device ("Garder sur cet appareil" on a project's home) open in airplane mode;
- a personal invitation link or a site's QR code opens the app directly.

Thank you.

## Attachment

None needed.
