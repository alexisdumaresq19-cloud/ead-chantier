# App Review Information

What goes in App Store Connect, version 1.0, section "App Review Information". In English, for Apple's reviewer.

Sentences followed by `<!-- verify at integration -->` describe work that was being finished in parallel when this was written (signing in with a code, the demonstration account, the privacy pages and the assistant's agreement step, the native file viewer and sharing, links that open the app). Check each against the build that goes to Apple, fix the wording if needed, then delete the marker. The markers do not show when this file is viewed rendered; they must not be pasted.

## Sign-in information

- Sign-in required: **yes**
- User name: `<DEMO_PHONE>`
- Password: `<DEMO_CODE>`

The owner reads both in the app, signed in as the office: **Équipe** (the team screen), card **Compte de démonstration**. <!-- verify at integration --> The code keeps working as long as the office does not change it, so it stays valid for the whole review and the reviews of later versions. <!-- verify at integration -->

## Contact information

- First name, last name, phone number, email: the person at EAD who answers Apple during the review (filled in by the owner; never committed here).

## Notes

Paste the text below, from "EAD is" to "Thank you.", into the "Notes" field (3,715 characters of the 4,000 allowed, comments excluded; recount after any change).

EAD is the private field app of Les Entreprises Allen Dumaresq, a civil-engineering contractor in Quebec, Canada. The office, the foremen and the site workers of the company use it to open construction plans on site, read project documents, take site photos and write daily reports. The interface is in Canadian French only.

ACCOUNTS
There is no public sign-up. Employees get their account from the company: a personal link, the QR code of their site, or a code that the office gives them. That company code is not given to Apple. Instead, a demonstration account is provided. It sees the projects the office chose for it, as a foreman does, and cannot manage the team. <!-- verify at integration -->

HOW TO SIGN IN

1. Open the app. On the first screen, tap "J'ai déjà un compte" (I already have an account).
2. Tap "Avec un code du bureau" (With a code from the office). <!-- verify at integration -->
3. Enter the phone number and the code given in the Sign-in information, then confirm. <!-- verify at integration -->
4. Tap a project in the list.

WHERE THINGS ARE
Inside a project, the tabs at the bottom are Accueil (home), Plans, Documents, Photos and Rapports (daily reports).

- Plans: tap Plans, then a sheet. Pinch to zoom; the arrows at the bottom go to the next sheet; "Rév." shows earlier revisions.
- Photos: the Photos tab shows the site's photos by day. Tap one to see it full screen.
- Daily reports: the Rapports tab lists them. Tap one to read it; "PDF" creates the report as a PDF with its photos.
- Documents: the Documents tab lists them by category. Tap one to open it.

CAMERA
Tap "Prendre une photo" on a project's home or in the Photos tab. iOS asks for camera access the first time. The photo is added to the project; a window offers to add a description. On a device without a camera, "De la galerie" picks a photo from the library instead.

MICROPHONE (dictation of the daily report)
In the Rapports tab, tap the report of the day (or, on the project's home, "Dicter le rapport du jour"), then "Dicter le rapport". Before the first use, the app explains that the voice, the text and the report's photos are sent to an AI service, and asks for agreement. Nothing is sent before the person agrees; the agreement can be withdrawn under "Mon compte". <!-- verify at integration --> iOS then asks for microphone access. Read aloud, for example: "Soleil, moins deux degrés. Marc Lévesque, dix heures. On a posé la conduite d'aqueduc." Then tap the microphone again to stop. The report fills itself; nothing is saved until "Enregistrer" is tapped. "Écrire" sends typed text instead of the voice.

ACCOUNT DELETION
Tap the round initials at the top right (or "Mon compte" on the projects list), scroll down to "Supprimer mon compte" and confirm. The account is deleted at once. If the demonstration account is deleted, the office can create a new one. <!-- verify at integration -->

PRIVACY AND SUPPORT
The privacy policy and the support page are linked at the bottom of the first screen and of "Mon compte". <!-- verify at integration -->

DISTRIBUTION
The app is for the company's team only. It will be distributed as an unlisted app; a request for unlisted distribution is filed separately.

NATIVE CAPABILITIES
The app is a native shell around the company's own web app, and it uses the device for what a site needs:

- the camera, to take site photos from any project;
- the microphone, to dictate the daily report;
- the iOS share sheet, to send a daily report's PDF or a document by text message, email or another app; <!-- verify at integration -->
- the iOS document viewer, to open PDFs and office documents inside the app; <!-- verify at integration -->
- plans kept on the device for use without a network: on a project's home, "Garder sur cet appareil", then the plans open in airplane mode; <!-- verify at integration -->
- links that open the app: a personal invitation link or a site's QR code opens the app directly instead of the browser. <!-- verify at integration -->

Thank you.

## Attachment

None needed.
