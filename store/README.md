# La fiche App Store d'EAD

Tout ce qu'il faut coller ou téléverser dans App Store Connect (appstoreconnect.apple.com) pour l'application iPhone «&nbsp;EAD&nbsp;», dans l'ordre où les écrans se présentent.

| Fichier                  | Ce qu'il contient                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `listing.fr-CA.md`       | Les textes de la fiche, en français, prêts à coller, avec leur longueur             |
| `screenshots/6.3/`       | Les 6 captures d'écran pour iPhone 6,3 po (1206 × 2622), la taille qu'Apple exige   |
| `screenshots/6.9/`       | Les mêmes captures pour iPhone 6,9 po (1320 × 2868), en plus si la page les accepte |
| `review-notes.en.md`     | Les informations pour la personne d'Apple qui vérifie l'app, en anglais             |
| `unlisted-request.en.md` | Les réponses au formulaire de distribution non répertoriée, en anglais              |
| `sample-photos/`         | Les photos de chantier des captures, avec leurs sources                             |

Les libellés d'App Store Connect sont donnés en français, avec l'anglais entre parenthèses&nbsp;: Apple ne publie pas d'aide en français pour App Store Connect, et la page peut s'afficher dans l'une ou l'autre langue.

## Avant de commencer

Le projet règle déjà ce que l'app doit déclarer à Apple&nbsp;: l'iPhone seul, sans iPad (`TARGETED_DEVICE_FAMILY = 1` dans `ios/App/App.xcodeproj/project.pbxproj`), les phrases qui demandent l'appareil photo, le micro et l'ajout aux photos, et la déclaration que l'app n'utilise que le chiffrement d'iOS (`ITSAppUsesNonExemptEncryption`)&nbsp;; ces deux derniers points sont dans `ios/App/App/Info.plist`. Rien à vérifier de ce côté.

- Les coordonnées de l'entreprise&nbsp;: sur le site, connecté comme bureau, **Équipe**, carte **Coordonnées de l'entreprise**, **Compléter**. Inscrivez l'adresse, le téléphone et le courriel du bureau, et la personne responsable des renseignements personnels, puis **Enregistrer**. Ouvrez ensuite https://ead-chantier.vercel.app/soutien et /confidentialite sans être connecté (une fenêtre privée)&nbsp;: le téléphone et le courriel doivent y paraître. Sans eux, la page de soutien ne donne aucun moyen de joindre l'entreprise, et Apple la visite.
- Un projet d'exemple pour Apple&nbsp;: la personne d'Apple ne doit voir aucun vrai chantier, ni les noms et les heures de l'équipe, et ce qu'elle ajoute ne doit pas aller dans les dossiers de l'équipe. Le site en ligne en a déjà un, fait par les développeurs&nbsp;: «&nbsp;Projet exemple (données fictives)&nbsp;», numéro EX-001, avec des plans, des photos, un document et un rapport fictifs, et personne de l'équipe. S'il a été supprimé, refaites-en un, sur le site, connecté comme bureau&nbsp;:
  1. **Projets** > **Nouveau projet**, nom `Projet d'exemple pour Apple`. N'y ajoutez personne de l'équipe.
  2. Des plans d'exemple&nbsp;: Claude Code, sur le Mac, fait le fichier avec `npx tsx scripts/make-sample-plans.ts ~/Downloads/plans-exemple.pdf 4` (des feuilles fictives marquées «&nbsp;EXEMPLE&nbsp;»). Dans le projet, **Plans** > **Ajouter des plans**, choisissez ce fichier.
  3. Quelques photos&nbsp;: sur le Mac, onglet **Photos** > **Ajouter des photos**, choisissez trois ou quatre images du dossier `~/ead-chantier/store/sample-photos/` (des photos libres de droits d'autres chantiers).
  4. Un rapport écrit à la main, onglet **Rapports**, avec des noms inventés plutôt que ceux de l'équipe.
- Le compte de démonstration&nbsp;: **Équipe**, carte **Accès de démonstration**. S'il n'existe pas encore, touchez **Créer l'accès de démonstration**, cochez seulement le projet d'exemple, puis **Créer l'accès**. Si la carte montre déjà un accès, vérifiez sous «&nbsp;Projets montrés&nbsp;» qu'il n'y a que ce projet (sinon **Changer les projets**). Le compte voit ce projet comme un contremaître&nbsp;: il ajoute des photos, des documents et des rapports, peut dicter, et ne change que ce qu'il a ajouté lui-même. La carte montre le numéro de cellulaire et le code à donner à Apple, chacun avec son bouton **Copier**.
- Si Apple écrit que le compte de démonstration ne s'ouvre plus&nbsp;: après une suppression, il se refait seul à la connexion suivante, cinq fois par jour au plus. Au-delà, la carte affiche «&nbsp;En pause&nbsp;». Touchez **Changer le code** et donnez le nouveau code à Apple (App Review Information, ou en réponse à son message)&nbsp;: le numéro reste le même, et le compte se rouvre tout de suite.
- Le build&nbsp;: Claude Code l'envoie avec `scripts/ios-release.sh` (guide `docs/ios/MAC.md`, étape 4.7). Il paraît dans l'onglet **TestFlight** quand Apple a fini de le traiter, et un courriel d'Apple le signale.
- Les pages d'aide et de confidentialité (https://ead-chantier.vercel.app/soutien et /confidentialite) doivent s'ouvrir&nbsp;: Apple les visite.

## 1. Créer l'app

Déjà fait à l'étape 4.6, point 3, du guide `docs/ios/MAC.md`&nbsp;: si l'app EAD est dans **Apps**, passez à l'étape 2. Pour mémoire, les valeurs données à **Apps**, bouton **+**, **Nouvelle app** (New App)&nbsp;:

- Plateforme (Platforms)&nbsp;: **iOS**
- Nom (Name)&nbsp;: `EAD`
- Langue principale (Primary Language)&nbsp;: **Français (Canada)**
- Identifiant de lot (Bundle ID)&nbsp;: `ca.allendumaresq.ead`
- SKU&nbsp;: `ead-ios`
- Accès des utilisateurs (User Access)&nbsp;: **Accès complet** (Full Access)

Si «&nbsp;EAD&nbsp;» était pris, la fiche porte un des noms de rechange de `listing.fr-CA.md`, section «&nbsp;Nom de l'app&nbsp;». Le SKU ne peut plus changer une fois l'app créée.

## 2. Informations sur l'app

Menu de gauche, **Informations sur l'app** (App Information).

- Sous-titre (Subtitle)&nbsp;: `listing.fr-CA.md`, «&nbsp;Sous-titre&nbsp;»
- Catégories (Category)&nbsp;: `listing.fr-CA.md`, «&nbsp;Catégories&nbsp;»
- Droits sur le contenu (Content Rights)&nbsp;: l'app ne montre aucun contenu d'un tiers. Répondez non.
- Cote d'âge (Age Ratings)&nbsp;: bouton **Set Up Age Ratings** (Définir la cote d'âge), ou **Edit** (Modifier) en haut de la page s'il a déjà été rempli, puis les réponses de `listing.fr-CA.md`, «&nbsp;Cote d'âge&nbsp;». Le résultat doit être 4+.

## 3. Confidentialité de l'app

Menu de gauche, **Confidentialité de l'app** (App Privacy).

- URL de la politique de confidentialité (Privacy Policy URL)&nbsp;: `listing.fr-CA.md`, «&nbsp;Adresses&nbsp;»
- Questionnaire sur les données (**Commencer**, Get Started)&nbsp;: `listing.fr-CA.md`, «&nbsp;Confidentialité de l'app&nbsp;». Publiez les réponses à la fin (**Publier**, Publish).

## 4. Tarifs et disponibilité

Menu de gauche, **Tarifs et disponibilité** (Pricing and Availability).

- Prix (Price)&nbsp;: gratuit
- Disponibilité (Availability)&nbsp;: au moins le Canada
- Distribution (App Distribution Methods)&nbsp;: laissez «&nbsp;Publique&nbsp;» (Public). Quand Apple accepte la demande de distribution non répertoriée (étape 6), il change lui-même ce choix pour **App non répertoriée** (Unlisted App)&nbsp;: l'app ne paraît alors dans aucune recherche ni liste, et seul le lien direct permet de l'installer. Ce choix vaut aussi pour les versions suivantes.

## 5. La version 1.0

Menu de gauche, **App iOS** (iOS App), version **1.0**.

- Aperçus et captures d'écran (Previews and Screenshots)&nbsp;: glissez d'abord les 6 fichiers de `screenshots/6.3/` dans la case de l'iPhone 6,3 po (iPhone with Dynamic Island, medium display), dans l'ordre de leur numéro (1 à 6)&nbsp;: c'est la taille qu'Apple exige. Si la page offre aussi la case 6,9 po (large display), glissez-y ceux de `screenshots/6.9/`. À partir d'avril 2027, Apple exige aussi des captures iPhone Duo (1398 × 2034 et 2007 × 2853) pour une app compilée avec le SDK d'iOS 27.1 ou plus récent (Xcode 27.1 et suivants)&nbsp;: si la soumission a lieu après cette date et que la page les demande, demandez-les à Claude Code.
- Texte promotionnel (Promotional Text), Description, Mots-clés (Keywords)&nbsp;: `listing.fr-CA.md`, sections du même nom
- URL d'assistance (Support URL)&nbsp;: `listing.fr-CA.md`, «&nbsp;Adresses&nbsp;» (l'URL marketing reste vide)
- Droits d'auteur (Copyright)&nbsp;: `listing.fr-CA.md`, «&nbsp;Droits d'auteur&nbsp;»
- Nouveautés (What's New in This Version)&nbsp;: ce champ n'existe pas pour la première version&nbsp;; le texte de `listing.fr-CA.md` sert à la suivante.
- Build&nbsp;: bouton **+** à côté de «&nbsp;Build&nbsp;», choisissez celui envoyé par `scripts/ios-release.sh` (son numéro est la date et l'heure, par exemple `20261120.1945`). Si App Store Connect ne le propose pas parce que la version de la fiche (1.0) n'est pas celle du build (1.0.0), écrivez `1.0.0` dans le champ de version en haut de la page, puis recommencez. Si App Store Connect pose des questions sur le chiffrement&nbsp;: l'app n'utilise que le chiffrement standard d'iOS (HTTPS). Choisissez la réponse qui dit qu'elle n'utilise aucun des algorithmes nommés («&nbsp;None of the algorithms mentioned above&nbsp;»).
- Informations pour la vérification de l'app (App Review Information)&nbsp;: `review-notes.en.md`. Cochez «&nbsp;Connexion requise&nbsp;» (Sign-in required), puis le numéro de cellulaire du compte de démonstration comme nom d'utilisateur (User name) et son code comme mot de passe (Password)&nbsp;: sur la carte **Accès de démonstration**, le bouton **Copier** à côté de **Cellulaire**, puis celui à côté de **Code**, et collez chacun dans son champ. Vos coordonnées (Contact Information), le téléphone au format international avec le +. Les notes (Notes)&nbsp;: tout le texte de la section «&nbsp;Notes&nbsp;», de sa première ligne à sa dernière, sans rien y ajouter&nbsp;: le champ est limité à 4&nbsp;000 octets.
- Publication de la version (Version Release)&nbsp;: «&nbsp;Publier manuellement cette version&nbsp;» (Manually release this version). Ne la publiez qu'une fois la demande de l'étape 6 acceptée&nbsp;: sinon l'app paraîtrait d'abord à tout le monde dans l'App Store.

Puis **Ajouter pour vérification** (Add for Review), et **Soumettre pour vérification** (Submit for Review) dans le panneau qui s'ouvre (Draft Submissions).

## 6. La demande de distribution non répertoriée

Une fois la version 1.0 soumise (étape 5)&nbsp;: Apple refuse la demande d'une app qui n'a pas encore été soumise à la vérification. Formulaire&nbsp;: developer.apple.com/contact/request/unlisted-app/ (expliqué à developer.apple.com/support/unlisted-app-distribution), connecté comme titulaire du compte. Le formulaire demande le numéro Apple de l'app (App Store Connect, **Informations sur l'app**, «&nbsp;Identifiant Apple&nbsp;», Apple ID). Les réponses sont dans `unlisted-request.en.md`&nbsp;; remplacez ce qui est entre chevrons (`<…>`)&nbsp;: le nombre d'employés, les coordonnées et l'identifiant Apple de l'app. Les notes pour Apple (`review-notes.en.md`) disent déjà que l'app sera non répertoriée, comme Apple le demande.

Quand Apple accepte, il donne le lien direct de l'app (dans son courriel, ou App Store Connect, **Informations sur l'app**, **Afficher sur l'App Store**)&nbsp;: aucune recherche ne trouve l'app, seul ce lien l'installe. Envoyez-le aux développeurs&nbsp;: ils l'inscrivent sur Vercel sous `IOS_APP_STORE_URL`, sans nouvelle version. Le texto que le bureau envoie avec un code commence alors par ce lien, et la page de soutien le donne. D'ici là, la page de soutien dit de demander le lien au bureau.

## Ensuite, chaque année

- L'abonnement au programme Apple Developer se renouvelle chaque année, par le titulaire du compte (developer.apple.com/account, **Membership details**). Gardez le renouvellement automatique et une carte valide&nbsp;: sans abonnement, Apple retire l'app de l'App Store, et personne de nouveau ne peut l'installer.
- Les changements du site arrivent seuls dans l'app, sans passer par Apple. Une nouvelle version de l'app elle-même (rare) se fait sur le Mac avec Claude Code&nbsp;: `docs/ios/MAC.md`, section 7.

## Refaire les captures d'écran

Après un changement d'écran, demandez à Claude Code de refaire les captures d'écran avec `scripts/store-sample.mts` et `scripts/store-screenshots.mts` (la marche à suivre est dans AGENTS.md). Les captures montrent seulement des données d'exemple&nbsp;: projet, personnes, plans et documents fictifs, marqués «&nbsp;EXEMPLE&nbsp;», vus par la contremaîtresse d'exemple. Les photos de chantier sont de vraies photos d'autres chantiers, libres de droits, marquées «&nbsp;EXEMPLE&nbsp;» (leurs sources sont dans `sample-photos/SOURCES.md`). Des photos des chantiers d'EAD, sans visage ni plaque lisible, les remplaceraient avantageusement&nbsp;: déposez-les dans `sample-photos/` sous les mêmes noms.
