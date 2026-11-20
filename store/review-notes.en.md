# App Review Information

What goes in App Store Connect, version 1.0, section "App Review Information". In English, for Apple's reviewer.

Every sentence below was checked against the app as it is now. Three things can only be proven on an iPhone and are tried in `docs/ios/MAC.md`, étape 4.9, before anything is sent to Apple: the share sheet and the document viewer, plans opened in airplane mode, and links that open the app. If one of them does not work in the build that goes to Apple, take its line out of "NATIVE CAPABILITIES" and recount.

## Sign-in information

- Sign-in required: **yes**
- User name: `<DEMO_PHONE>`
- Password: `<DEMO_CODE>`

The owner reads both in the app, signed in as the office: **Équipe** (the team screen), card **Accès de démonstration**. Its button **Copier pour Apple** copies both, with the way in. The code keeps working as long as the office does not change it, so it stays valid for the whole review and the reviews of later versions.

## Contact information

- First name, last name, phone number, email: the person at EAD who answers Apple during the review (filled in by the owner; never committed here). The phone number goes in international format with the plus sign, for example +1 418 …; the field does not take digits alone.

## Notes

Paste the text below, from "EAD is" to "Thank you.", into the "Notes" field (3,891 bytes of the 4,000 bytes allowed; recount after any change).

EAD is the private field app of Les Entreprises Allen Dumaresq, a civil-engineering contractor in Quebec, Canada. The office, the foremen and the site workers of the company use it to open construction plans on site, read project documents, take site photos and write daily reports. The interface is in Canadian French only.

ACCOUNTS
There is no public sign-up. Employees get their account from the company: a personal link, the QR code of their site, or a code that the office gives them. That company code is not given to Apple. Instead, a demonstration account is provided. It sees the projects the office chose for it, as a foreman does. It can add photos, documents and reports, changes only what it added itself, and cannot manage the team.

HOW TO SIGN IN

1. Open the app. On the first screen, tap "J'ai déjà un compte" (I already have an account).
2. Tap "Avec un code du bureau" (With a code from the office).
3. Type the phone number under "Cellulaire" and the code under "Code du bureau", then tap "Entrer".
4. Tap a project in the list.

WHERE THINGS ARE
Inside a project, the tabs at the bottom are Accueil (home), Plans, Documents, Photos and Rapports (daily reports).

- Plans: tap Plans, then a sheet. Pinch to zoom; the arrows at the bottom go to the next sheet; "Rév." shows earlier revisions.
- Photos: the Photos tab shows the site's photos by day. Tap one to see it full screen.
- Daily reports: the Rapports tab lists them. Tap one to read it. "PDF" makes the report as a PDF with its photos: "Ouvrir" shows it, "Partager" opens the share sheet.
- Documents: the Documents tab lists them by category. Tap one to open it.

CAMERA
Tap "Prendre une photo" on a project's home or in the Photos tab. iOS asks for camera access the first time. The photo is added to the project; a window offers to add a description. On a device without a camera, "De la galerie" picks a photo from the library instead.

MICROPHONE (dictation of the daily report)
On the project's home, tap "Dicter le rapport du jour", then "Dicter le rapport". Before the first use, the app says what goes to an AI service (the voice, the report's text, its photos, the names of the site's people) and to which companies, and asks for agreement ("J'accepte"). Nothing is sent before the person agrees; the agreement can be withdrawn under "Mon compte". iOS then asks for microphone access. Read aloud, for example: "Soleil, moins deux degrés. Marc Lévesque, dix heures. On a posé la conduite d'aqueduc." Then tap the microphone again to stop. The report fills itself; nothing is saved until "Enregistrer" is tapped. "Écrire" sends typed text instead of the voice.

ACCOUNT DELETION
Tap the round initials at the top right (or "Mon compte" on the projects list), scroll down to "Supprimer mon compte" and confirm. The account is deleted at once. Signing in again with the same number and code makes a new demonstration account.

PRIVACY AND SUPPORT
The privacy policy and the support page are linked at the bottom of the first screen and of "Mon compte".

DISTRIBUTION
The app is for the company's team only. It will be distributed as an unlisted app; a request for unlisted distribution is filed separately.

NATIVE CAPABILITIES
The app is a native shell around the company's own web app, and it uses the device for what a site needs:

- the camera, to take site photos from any project;
- the microphone, to dictate the daily report;
- the iOS share sheet, to send a daily report's PDF, a photo or a document by text message, email or another app;
- the iOS document viewer, to open PDFs and office documents inside the app;
- plans kept on the device for use without a network: on a project's home, "Garder sur cet appareil", then the plans open in airplane mode;
- links that open the app: a personal invitation link or a site's QR code opens the app directly instead of the browser.

Thank you.

## Attachment

None needed.
