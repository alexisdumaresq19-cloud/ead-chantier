# La fiche App Store d'EAD

Tout ce qu'il faut coller ou téléverser dans App Store Connect (appstoreconnect.apple.com) pour l'application iPhone «&nbsp;EAD&nbsp;», dans l'ordre où les écrans se présentent.

| Fichier                  | Ce qu'il contient                                                       |
| ------------------------ | ----------------------------------------------------------------------- |
| `listing.fr-CA.md`       | Les textes de la fiche, en français, prêts à coller, avec leur longueur |
| `screenshots/6.9/`       | Les 6 captures d'écran pour iPhone 6,9 po (1320 × 2868)                 |
| `screenshots/6.3/`       | Les mêmes captures pour iPhone 6,3 po (1206 × 2622)                     |
| `review-notes.en.md`     | Les informations pour la personne d'Apple qui vérifie l'app, en anglais |
| `unlisted-request.en.md` | Les réponses au formulaire de distribution non répertoriée, en anglais  |
| `sample-photos/`         | Les photos de chantier des captures, avec leurs sources                 |

## Avant de commencer

- L'app pour iPhone seulement&nbsp;: dans Xcode, la cible «&nbsp;App&nbsp;» doit viser l'iPhone seul (Targeted Device Family = iPhone). Si elle accepte aussi l'iPad, App Store Connect exige des captures pour iPad, qui n'existent pas, et il faut envoyer un nouveau build. Vérifiez-le avant l'archive.
- Les phrases d'autorisation&nbsp;: dans le fichier Info.plist de l'app, il faut une phrase pour la caméra et une pour le microphone (par exemple «&nbsp;Pour prendre les photos du chantier.&nbsp;» et «&nbsp;Pour dicter le rapport journalier.&nbsp;»). Sans elles, l'app se ferme dès qu'on prend une photo ou qu'on dicte, et Apple la refuse. Vérifiez-les avant l'archive.
- Le chiffrement&nbsp;: Info.plist dit aussi que l'app n'utilise pas d'autre chiffrement que celui d'iOS (clé ITSAppUsesNonExemptEncryption à NO). Alors App Store Connect ne pose pas la question à chaque build.
- Le compte de démonstration&nbsp;: dans l'application, connecté comme bureau, ouvrez **Équipe**, carte **Compte de démonstration**. Créez-le et choisissez les projets qu'il voit. Choisissez un projet qui peut être montré à Apple, avec des plans, des photos et au moins un rapport. Le compte doit en être le **contremaître**&nbsp;: les rapports et la dictée sont réservés aux contremaîtres et au bureau, et Apple doit pouvoir essayer le microphone. Connectez-vous une fois avec ce compte sur un téléphone et vérifiez que l'onglet **Rapports** et «&nbsp;Dicter le rapport du jour&nbsp;» paraissent. Notez le numéro de cellulaire et le code affichés&nbsp;: ce sont l'identifiant et le mot de passe à donner à Apple. <!-- verify at integration: the demo account's role on its projects -->
- Le build&nbsp;: l'app doit avoir été envoyée depuis Xcode (Product, puis Archive, puis Distribute App). Elle apparaît dans App Store Connect après quelques minutes.
- Les pages d'aide et de confidentialité (https://ead-chantier.vercel.app/soutien et /confidentialite) doivent s'ouvrir&nbsp;: Apple les visite.

## 1. Créer l'app

**Apps**, bouton **+**, **Nouvelle app**.

- Plateforme&nbsp;: iOS
- Nom&nbsp;: `listing.fr-CA.md`, section «&nbsp;Nom de l'app&nbsp;» (et les deux noms de rechange si «&nbsp;EAD&nbsp;» est pris)
- Langue principale&nbsp;: Français (Canada)
- Identifiant de lot (Bundle ID)&nbsp;: `ca.allendumaresq.ead`
- UGS (SKU)&nbsp;: un code à usage interne, par exemple `EAD-IPHONE`
- Accès des utilisateurs&nbsp;: Accès complet

## 2. Informations sur l'app

Menu de gauche, **Informations sur l'app**.

- Sous-titre&nbsp;: `listing.fr-CA.md`, «&nbsp;Sous-titre&nbsp;»
- Catégories&nbsp;: `listing.fr-CA.md`, «&nbsp;Catégories&nbsp;»
- Droits sur le contenu&nbsp;: l'app ne montre aucun contenu d'un tiers. Répondez non.
- Cote d'âge&nbsp;: bouton **Définir** ou **Modifier**, puis les réponses de `listing.fr-CA.md`, «&nbsp;Cote d'âge&nbsp;». Le résultat doit être 4+.

## 3. Confidentialité de l'app

Menu de gauche, **Confidentialité de l'app**.

- URL de la politique de confidentialité&nbsp;: `listing.fr-CA.md`, «&nbsp;Adresses&nbsp;»
- Questionnaire sur les données (**Commencer**)&nbsp;: `listing.fr-CA.md`, «&nbsp;Confidentialité de l'app&nbsp;». Publiez les réponses à la fin.

## 4. Tarifs et disponibilité

- Prix&nbsp;: gratuit
- Disponibilité&nbsp;: au moins le Canada
- Distribution&nbsp;: laissez «&nbsp;Publique&nbsp;». Quand Apple accepte la demande de distribution non répertoriée (étape 6), il change lui-même ce choix pour **App non répertoriée** (Unlisted App)&nbsp;: l'app ne paraît alors dans aucune recherche ni liste, et seul le lien direct permet de l'installer. Ce choix vaut aussi pour les versions suivantes.

## 5. La version 1.0

Menu de gauche, **App iOS**, version **1.0**.

- Aperçus et captures d'écran, **iPhone 6,9 po**&nbsp;: glissez les fichiers de `screenshots/6.9/` dans l'ordre de leur numéro (1 à 6). Apple les réduit lui-même pour les autres iPhone. Si la page offre aussi la taille 6,3 po, glissez ceux de `screenshots/6.3/`.
- Texte promotionnel, Description, Mots-clés&nbsp;: `listing.fr-CA.md`, sections du même nom
- URL d'assistance&nbsp;: `listing.fr-CA.md`, «&nbsp;Adresses&nbsp;» (l'URL marketing reste vide)
- Droits d'auteur&nbsp;: `listing.fr-CA.md`, «&nbsp;Droits d'auteur&nbsp;»
- Nouveautés&nbsp;: `listing.fr-CA.md`, «&nbsp;Nouveautés&nbsp;», si le champ est affiché
- Build&nbsp;: bouton **+** à côté de «&nbsp;Build&nbsp;», choisissez celui envoyé depuis Xcode. Si App Store Connect pose des questions sur le chiffrement&nbsp;: l'app n'utilise que le chiffrement standard d'iOS (HTTPS). Choisissez la réponse qui dit qu'elle n'utilise aucun des algorithmes nommés («&nbsp;None of the algorithms mentioned above&nbsp;» en anglais).
- Informations pour la vérification de l'app&nbsp;: `review-notes.en.md`. Cochez «&nbsp;Connexion requise&nbsp;», puis le numéro de cellulaire du compte de démonstration comme nom d'utilisateur et son code comme mot de passe. Vos coordonnées. Les notes&nbsp;: tout le texte de la section «&nbsp;Notes&nbsp;».
- Publication de la version&nbsp;: «&nbsp;Publier manuellement cette version&nbsp;». Ne la publiez qu'une fois la demande de l'étape 6 acceptée&nbsp;: sinon l'app paraîtrait d'abord à tout le monde dans l'App Store.

Puis **Ajouter pour vérification**, et **Soumettre à la vérification de l'app**.

## 6. La demande de distribution non répertoriée

Une fois la version 1.0 soumise (étape 5)&nbsp;: Apple refuse la demande d'une app qui n'a pas encore été soumise à la vérification. Formulaire&nbsp;: developer.apple.com/contact/request/unlisted-app/ (expliqué à developer.apple.com/support/unlisted-app-distribution), connecté comme titulaire du compte. Le formulaire demande le numéro Apple de l'app (App Store Connect, **Informations sur l'app**, «&nbsp;Identifiant Apple&nbsp;»). Les réponses sont dans `unlisted-request.en.md`&nbsp;; remplacez le nombre d'employés et les coordonnées entre crochets. Les notes pour Apple (`review-notes.en.md`) disent déjà que l'app sera non répertoriée, comme Apple le demande.

## Refaire les captures d'écran

Après un changement d'écran, demandez à Claude Code de refaire les captures d'écran avec `scripts/store-sample.mts` et `scripts/store-screenshots.mts` (la marche à suivre est dans AGENTS.md). Les captures montrent seulement des données d'exemple&nbsp;: projet, personnes, plans et documents fictifs, marqués «&nbsp;EXEMPLE&nbsp;», vus par la contremaîtresse d'exemple. Les photos de chantier sont de vraies photos d'autres chantiers, libres de droits, marquées «&nbsp;EXEMPLE&nbsp;» (leurs sources sont dans `sample-photos/SOURCES.md`). Des photos des chantiers d'EAD, sans visage ni plaque lisible, les remplaceraient avantageusement&nbsp;: déposez-les dans `sample-photos/` sous les mêmes noms.
