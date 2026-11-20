# La fiche App Store d'EAD

Tout ce qu'il faut coller ou téléverser dans App Store Connect (appstoreconnect.apple.com) pour l'application iPhone «&nbsp;EAD&nbsp;», dans l'ordre où les écrans se présentent.

| Fichier                  | Ce qu'il contient                                                       |
| ------------------------ | ----------------------------------------------------------------------- |
| `listing.fr-CA.md`       | Les textes de la fiche, en français, prêts à coller, avec leur longueur |
| `screenshots/6.9/`       | Les 6 captures d'écran pour iPhone 6,9 po (1320 × 2868)                 |
| `screenshots/6.3/`       | Les mêmes captures pour iPhone 6,3 po (1206 × 2622)                     |
| `review-notes.en.md`     | Les informations pour la personne d'Apple qui vérifie l'app, en anglais |
| `unlisted-request.en.md` | Les réponses au formulaire de distribution non répertoriée, en anglais  |

## Avant de commencer

- Le compte de démonstration&nbsp;: dans l'application, connecté comme bureau, ouvrez **Équipe**, carte **Compte de démonstration**. Créez-le et choisissez les projets qu'il voit. Choisissez un projet qui peut être montré à Apple, avec des plans, des photos et au moins un rapport. Notez le numéro de cellulaire et le code affichés&nbsp;: ce sont l'identifiant et le mot de passe à donner à Apple.
- Le build&nbsp;: l'app doit avoir été envoyée depuis Xcode (Product, puis Archive, puis Distribute App). Elle apparaît dans App Store Connect après quelques minutes.

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
- Distribution&nbsp;: laissez «&nbsp;Publique&nbsp;» tant qu'Apple n'a pas accepté la demande de distribution non répertoriée (étape 6). Une fois acceptée, choisissez **Non répertoriée**&nbsp;: l'app ne paraît plus dans les recherches, et seul le lien direct permet de l'installer.

## 5. La version 1.0

Menu de gauche, **App iOS**, version **1.0**.

- Aperçus et captures d'écran, **iPhone 6,9 po**&nbsp;: glissez les fichiers de `screenshots/6.9/` dans l'ordre de leur numéro (1 à 6). Apple les réduit lui-même pour les autres iPhone. Si la page offre aussi la taille 6,3 po, glissez ceux de `screenshots/6.3/`.
- Texte promotionnel, Description, Mots-clés&nbsp;: `listing.fr-CA.md`, sections du même nom
- URL d'assistance&nbsp;: `listing.fr-CA.md`, «&nbsp;Adresses&nbsp;» (l'URL marketing reste vide)
- Droits d'auteur&nbsp;: `listing.fr-CA.md`, «&nbsp;Droits d'auteur&nbsp;»
- Nouveautés&nbsp;: `listing.fr-CA.md`, «&nbsp;Nouveautés&nbsp;», si le champ est affiché
- Build&nbsp;: bouton **+** à côté de «&nbsp;Build&nbsp;», choisissez celui envoyé depuis Xcode
- Informations pour la vérification de l'app&nbsp;: `review-notes.en.md`. Cochez «&nbsp;Connexion requise&nbsp;», puis le numéro de cellulaire du compte de démonstration comme nom d'utilisateur et son code comme mot de passe. Vos coordonnées. Les notes&nbsp;: tout le texte de la section «&nbsp;Notes&nbsp;».
- Publication de la version&nbsp;: «&nbsp;Publier manuellement cette version&nbsp;», pour garder la main sur la date.

Puis **Ajouter pour vérification**, et **Soumettre à la vérification de l'app**.

## 6. La demande de distribution non répertoriée

Sur le site d'Apple pour les développeurs, page «&nbsp;Unlisted app distribution&nbsp;» (developer.apple.com/support/unlisted-app-distribution), connecté comme titulaire du compte. Le formulaire demande le numéro Apple de l'app (App Store Connect, **Informations sur l'app**, «&nbsp;Identifiant Apple&nbsp;»)&nbsp;: envoyez-le une fois l'app créée à l'étape 1. Les réponses sont dans `unlisted-request.en.md`&nbsp;; remplacez le nombre d'employés et les coordonnées entre crochets.

## Si App Store Connect demande des captures pour iPad

C'est que le projet Xcode accepte encore l'iPad. L'application est faite pour l'iPhone&nbsp;: demandez qu'on la limite à l'iPhone dans Xcode, puis envoyez un nouveau build. Sur un iPad, elle s'ouvrira quand même, dans le format d'un iPhone.

## Refaire les captures d'écran

Après un changement d'écran, sur un ordinateur de développement, avec la base de données de développement vidée&nbsp;:

```sh
npm run db:fresh
npx next build && node_modules/.bin/next start -p 3265   # avec l'environnement de scripts/e2e.sh
BASE=http://localhost:3265 npm run seed
BASE=http://localhost:3265 npx tsx scripts/store-sample.mts
BASE=http://localhost:3265 npx tsx scripts/store-screenshots.mts
```

Les captures montrent seulement les données d'exemple (projet, personnes, plans, photos et documents fictifs, marqués «&nbsp;EXEMPLE&nbsp;»), vues par la contremaîtresse d'exemple.
