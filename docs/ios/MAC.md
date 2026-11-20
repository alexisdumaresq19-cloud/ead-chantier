# L'app iPhone EAD&nbsp;: guide pour le Mac

Ce guide est fait pour Claude Code, sur le MacBook du propriétaire. Le propriétaire le lit en même temps&nbsp;: chaque étape dit qui fait quoi. Claude Code lance les commandes ; le propriétaire clique dans les sites d'Apple et dit oui ou non. Suivez les étapes dans l'ordre, sans en sauter.

## 1. Ce qu'est ce projet

- EAD Chantier est l'app de chantier des Entreprises Allen Dumaresq&nbsp;: plans, documents, photos et rapports journaliers. Elle est en ligne à https://ead-chantier.vercel.app.
- L'app iPhone «&nbsp;EAD&nbsp;» est une coquille native (Capacitor 8, dossier `ios/`) qui affiche ce site en direct dans une vue web. Le site n'est pas copié dans l'app&nbsp;: chaque mise en ligne du site arrive aussi dans l'app.
- L'app ajoute ce qu'un site ne peut pas faire seul&nbsp;: l'icône, le partage et l'ouverture des fichiers par l'iPhone, les liens qui ouvrent l'app, une page «&nbsp;Pas de connexion&nbsp;».
- Elle sera distribuée par l'App Store comme app privée (non listée) pour l'équipe d'EAD, en passant d'abord par TestFlight.
- Ce qui est propre à l'iPhone est expliqué dans `docs/ios/README.md` ; ce guide-ci dit comment la construire, l'essayer et l'envoyer.

## 2. Ce qui ne doit jamais arriver

- **Une clé ou le Team ID dans le dépôt.** Le fichier `.p8`, le Key ID, l'Issuer ID et le Team ID restent sur le Mac, dans `~/.appstoreconnect/` et `~/.zshrc`. Ils ne sont jamais écrits dans un fichier du projet, un commit, un message de commit ou le journal à la fin de ce guide. `scripts/ios-doctor.sh --envoi` le vérifie.
- **Changer l'identifiant de l'app après le premier envoi.** L'identifiant `ca.allendumaresq.ead` devient définitif dès qu'une version est envoyée à App Store Connect. Avant cela seulement, `scripts/ios-set-id.sh` le change partout.
- **Toucher au compte Apple sans le oui du propriétaire.** Créer un identifiant, une app, une clé, inviter des testeurs, accepter une entente&nbsp;: Claude Code explique, le propriétaire décide et clique.
- **Une publication.** Rien n'est soumis à la revue d'Apple ni publié sur l'App Store sans que le propriétaire l'ait demandé clairement. Les envois de ce guide vont dans TestFlight, et seulement là.

## 3. Ce qu'il faut demander au propriétaire au départ

Claude Code demande ces éléments avant toute commande, un à la fois, et attend la réponse.

1. **Xcode installé depuis l'App Store du Mac** (gratuit, plusieurs Go). Une fois installé, l'ouvrir une fois et accepter ce qu'il propose d'installer.
2. **L'accès au dépôt GitHub privé** du projet, depuis ce Mac (le propriétaire est connecté à GitHub, ou il ajoute ce Mac). Claude Code clone le dépôt s'il n'est pas déjà là.
3. **Un compte Apple Developer Program actif** au nom de l'entreprise, et l'accès du propriétaire à App Store Connect comme «&nbsp;Titulaire du compte&nbsp;» (Account Holder) ou «&nbsp;Admin&nbsp;».
4. **La clé d'API d'App Store Connect** (fichier `.p8`), son **Key ID** et l'**Issuer ID**. Le propriétaire clique ainsi&nbsp;:
   1. Ouvrir https://appstoreconnect.apple.com et se connecter.
   2. Cliquer **Utilisateurs et accès** (Users and Access).
   3. Cliquer l'onglet **Intégrations** (Integrations), puis **App Store Connect API** à gauche, puis **Clés d'équipe** (Team Keys).
   4. La première fois seulement, le titulaire du compte clique **Demander l'accès** (Request Access) et accepte les conditions.
   5. Cliquer le bouton **+** (Générer une clé d'API). Nom&nbsp;: `EAD Mac`. Accès&nbsp;: **Admin** (Xcode en a besoin pour créer lui-même le certificat de distribution). Cliquer **Générer**.
   6. Dans la ligne de la nouvelle clé, cliquer **Télécharger la clé d'API**. Apple ne permet de la télécharger **qu'une seule fois**&nbsp;: le fichier `AuthKey_XXXXXXXXXX.p8` arrive dans Téléchargements. Ne pas l'envoyer par courriel ni le mettre dans le dépôt.
   7. Le **Key ID** est dans la colonne «&nbsp;ID de la clé&nbsp;» de cette ligne (10 caractères, aussi dans le nom du fichier).
   8. L'**Issuer ID** est affiché au-dessus de la liste des clés («&nbsp;ID de l'émetteur&nbsp;», un long identifiant avec des tirets), avec un bouton pour le copier.
5. **Le Team ID**&nbsp;: ouvrir https://developer.apple.com/account, se connecter, cliquer **Membership details** (Détails de l'adhésion) ; le Team ID est la valeur de 10 caractères sur la ligne «&nbsp;Team ID&nbsp;».

Le propriétaire colle le Key ID, l'Issuer ID et le Team ID dans le terminal quand Claude Code les demande à l'étape 4.2, jamais dans un fichier du projet.

## 4. Les étapes

### 4.1 Le dépôt et la branche de travail

```bash
git clone <adresse du dépôt privé> ead-chantier   # si le dépôt n'est pas déjà sur le Mac
cd ead-chantier
git checkout main && git pull
git checkout -b ios-mac
```

Toutes les corrections faites sur le Mac vont dans cette branche `ios-mac` (section 6).

### 4.2 Le docteur

```bash
scripts/ios-doctor.sh
```

Il vérifie macOS, Xcode (assez récent pour qu'Apple accepte l'envoi), sa licence, ses composants, un simulateur d'iPhone, Node.js 22 ou plus et git. Chaque ligne «&nbsp;À FAIRE&nbsp;» dit quoi faire. Une commande avec `sudo` demande le mot de passe du Mac&nbsp;: c'est le propriétaire qui le tape. Relancer jusqu'à «&nbsp;Tout est prêt.&nbsp;» (la ligne «&nbsp;Modules du projet&nbsp;» se règle à l'étape 4.4).

Si Node.js manque&nbsp;: le propriétaire installe la version LTS depuis https://nodejs.org (paquet pour macOS).

L'Xcode minimum est écrit en haut du script (`MIN_XCODE`)&nbsp;: c'est ce qu'Apple exigeait à l'écriture de ce guide. Vérifier sur https://developer.apple.com/news/upcoming-requirements/ ; si Apple exige maintenant une version plus récente, mettre la nouvelle valeur dans le script (commit sur `ios-mac`).

### 4.3 La clé, hors du dépôt

```bash
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/
chmod 700 ~/.appstoreconnect ~/.appstoreconnect/private_keys
chmod 600 ~/.appstoreconnect/private_keys/AuthKey_*.p8
ls -l ~/.appstoreconnect/private_keys/
```

Puis ajouter ces quatre lignes à la fin de `~/.zshrc`, avec les valeurs données par le propriétaire (Claude Code les écrit dans ce fichier du Mac, jamais dans le projet)&nbsp;:

```bash
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export ASC_TEAM_ID=XXXXXXXXXX
export ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8"
```

Ouvrir un nouveau terminal (ou `source ~/.zshrc`), revenir dans le projet, puis&nbsp;:

```bash
scripts/ios-doctor.sh --envoi
```

### 4.4 Les modules du projet

```bash
npm ci
```

Jamais `npm install` ni `npm update`&nbsp;: ils changeraient `package-lock.json`.

### 4.5 La préparation du projet Xcode

```bash
scripts/ios-sync.sh
```

Il copie les pages de l'app (`ios-shell/`), puis lance `npx cap sync ios`. Les autres scripts le lancent eux-mêmes ; on le relance à la main après un changement de `capacitor.config.ts`.

### 4.6 Premier essai dans le simulateur

```bash
scripts/ios-sim.sh /diagnostic ~/Desktop/ead-diagnostic.png
```

Le script compile l'app pour le simulateur (sans signature), démarre un iPhone simulé, installe l'app et l'ouvre directement à la page `/diagnostic` du site. Après 8 secondes, il enregistre une capture d'écran. La première compilation est longue&nbsp;: Xcode télécharge les paquets Swift de Capacitor depuis GitHub.

Claude Code ouvre la capture (`~/Desktop/ead-diagnostic.png`) et la lit. La page `/diagnostic` dit trois choses&nbsp;:

1. si la page tourne **dans l'app iPhone** ou dans un navigateur ;
2. si un **service worker** contrôle la page (c'est lui qui ouvre les plans gardés sans réseau) ;
3. quels **modules natifs** répondent (partage, fichiers, visionneuse, écran de lancement, app).

Le service worker s'installe à la première ouverture et ne prend la page qu'à l'ouverture suivante. **Lancer donc le script une deuxième fois** (même commande) avant de conclure.

Ensuite, selon la deuxième capture&nbsp;:

| Ce que dit `/diagnostic`                                                   | Ce que ça veut dire                                                                             | Quoi faire                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dans l'app&nbsp;: oui. Service worker&nbsp;: oui. Modules&nbsp;: tous répondent.          | Tout marche, avec les domaines liés à l'app (App-Bound Domains).                                | Rien. Garder `appBoundDomains = true` dans `capacitor.config.ts`.                                                                                                                                                                                                                                                                                                 |
| Dans l'app&nbsp;: oui. Modules&nbsp;: répondent. Service worker&nbsp;: non.               | Le pont natif marche, mais WebKit ne donne pas de service worker.                               | Vérifier que `ios/App/App/Info.plist` liste exactement `ead-chantier.vercel.app` et `localhost` sous `WKAppBoundDomains`, et que l'app a été ouverte deux fois. Si c'est le cas&nbsp;: mettre `appBoundDomains = false`, relancer `scripts/ios-sim.sh /diagnostic …` deux fois, et noter au journal que les plans gardés ne s'ouvrent pas sans réseau dans l'app. |
| Dans l'app&nbsp;: non, ou aucun module ne répond.                               | Le pont de Capacitor n'est pas injecté dans la page&nbsp;: les domaines liés à l'app le bloquent.    | Mettre `appBoundDomains = false` dans `capacitor.config.ts`, relancer deux fois. Si «&nbsp;dans l'app&nbsp;» passe à oui&nbsp;: garder `false` et noter au journal ce que dit le service worker. Si rien ne change&nbsp;: le problème est ailleurs, voir «&nbsp;Dépannage&nbsp;».                                                                                                                |
| La page «&nbsp;Pas de connexion&nbsp;» s'affiche.                                    | La vue web n'a pas pu charger le site.                                                          | Vérifier que le Mac a Internet et que https://ead-chantier.vercel.app/diagnostic s'ouvre dans Safari. Si oui&nbsp;: avec `appBoundDomains = true`, le site est refusé par WebKit ; vérifier `WKAppBoundDomains`, sinon essayer `false`.                                                                                                                              |
| `/diagnostic` montre la page «&nbsp;adresse inconnue&nbsp;» de l'app, ou un écran noir. | La version du site en ligne n'a pas encore cette page, ou la page n'a pas fini de charger. | Relancer avec `EAD_SIM_WAIT=20`. Si la page n'existe pas en ligne, le dire au propriétaire&nbsp;: il faut d'abord mettre en ligne la version du site qui contient l'app iPhone.                                                                                                                                                                                         |

Le réglage `appBoundDomains` est une seule ligne de `capacitor.config.ts` ; `docs/ios/README.md` explique ce qu'il change. Tout changement est un commit sur `ios-mac`, avec la raison au journal.

Puis regarder l'écran d'accueil de l'app&nbsp;:

```bash
scripts/ios-sim.sh "" ~/Desktop/ead-accueil.png
```

Attendu&nbsp;: le logo EAD sur fond noir au lancement, puis l'accueil du site, texte de la barre d'état en blanc sur la barre noire du haut, rien de caché sous l'encoche ni sous la barre du bas.

Enfin, faire un commit des fichiers qu'Xcode a créés et qui doivent être suivis, en particulier `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` (les versions exactes des paquets Swift). Vérifier avec `git status` qu'aucun autre fichier n'a changé sans raison.

### 4.7 Avant le premier envoi&nbsp;: l'identifiant et la fiche de l'app (le propriétaire)

Dernière occasion de changer l'identifiant `ca.allendumaresq.ead`. Le demander au propriétaire. S'il en veut un autre&nbsp;: `scripts/ios-set-id.sh nouvel.identifiant`, `npm test`, commit.

Puis le propriétaire clique, avec Claude Code qui guide&nbsp;:

1. **L'identifiant chez Apple.** https://developer.apple.com/account > **Certificates, IDs & Profiles** > **Identifiers** > bouton **+** > **App IDs** > **Continue** > **App** > **Continue**. Description&nbsp;: `EAD`. Bundle ID&nbsp;: **Explicit**, `ca.allendumaresq.ead`. Dans la liste Capabilities, cocher **Associated Domains**. **Continue**, puis **Register**.
2. **La fiche de l'app.** https://appstoreconnect.apple.com > **Apps** > bouton **+** > **Nouvelle app** (New App). Plateforme&nbsp;: **iOS**. Nom&nbsp;: `EAD`. Langue principale&nbsp;: **Français (Canada)**. Identifiant de lot (Bundle ID)&nbsp;: celui de l'étape précédente. SKU&nbsp;: `ead-ios`. Accès des utilisateurs&nbsp;: **Accès complet**. Cliquer **Créer**.
   - Le nom d'une app doit être unique sur tout l'App Store. Si `EAD` est déjà pris, le propriétaire choisit un autre nom pour la fiche (par exemple `EAD Chantier`). Le nom sous l'icône de l'iPhone reste «&nbsp;EAD&nbsp;»&nbsp;: il vient du projet (`CFBundleDisplayName`).
3. Si App Store Connect affiche des ententes à accepter (bannière en haut, section **Ententes**), c'est au titulaire du compte de les lire et de les accepter.

### 4.8 Le premier envoi

```bash
scripts/ios-release.sh
```

Le script refuse de partir si des fichiers ne sont pas dans un commit. Il vérifie le Mac (`ios-doctor.sh --envoi`), prépare le projet, construit l'archive signée (Xcode crée lui-même le certificat et le profil avec la clé d'API), puis l'envoie à App Store Connect. Le numéro de build est la date et l'heure (UTC), par exemple `20261120.1945`.

Après «&nbsp;Envoyée&nbsp;», Apple **traite** la version&nbsp;: il vérifie le paquet, prépare l'installation et la rend disponible pour TestFlight. Cela prend en général de 5 à 30 minutes, parfois plus. Pendant ce temps, la version apparaît dans **App Store Connect > Apps > EAD > TestFlight** avec l'état «&nbsp;Traitement&nbsp;» (Processing). Un courriel d'Apple arrive quand elle est prête, ou s'il y a un problème (il nomme alors une erreur `ITMS-…`&nbsp;: voir «&nbsp;Dépannage&nbsp;»).

Aucune question sur le chiffrement ne devrait être posée&nbsp;: le projet déclare déjà que l'app n'utilise que le chiffrement standard d'iOS (`ITSAppUsesNonExemptEncryption`).

### 4.9 Les liens qui ouvrent l'app (le propriétaire, sur Vercel)

Quand la version du site qui contient l'app iPhone est en ligne, le propriétaire ajoute une variable sur Vercel&nbsp;: projet **ead-chantier** > **Settings** > **Environment Variables** > nom `IOS_APP_ID`, valeur `TEAMID.ca.allendumaresq.ead` (son Team ID, un point, l'identifiant), environnement **Production** > **Save**, puis **Redeploy** de la dernière version.

Vérifier&nbsp;:

```bash
curl -sI https://ead-chantier.vercel.app/.well-known/apple-app-site-association
```

Attendu&nbsp;: `HTTP/2 200` et `content-type: application/json`, sans redirection. Apple garde sa propre copie et la rafraîchit lui-même, parfois après plusieurs heures ; ce qu'il a en ce moment se lit avec `curl -s https://app-site-association.cdn-apple.com/a/v1/ead-chantier.vercel.app`.

### 4.10 Les essais sur un vrai iPhone, par TestFlight

Le propriétaire&nbsp;:

1. Dans **App Store Connect > Apps > EAD > TestFlight**, section **Tests internes** (Internal Testing), cliquer **+**, créer le groupe `Bureau`, y ajouter les personnes du compte qui testeront, et cocher la version envoyée.
2. Sur l'iPhone, installer l'app **TestFlight** depuis l'App Store, ouvrir le courriel d'invitation, puis **Installer** EAD.

Puis, sur l'iPhone, dans cet ordre. Noter chaque résultat (fonctionne, ou ce qui se passe) pour le journal.

1. **Créer un compte avec le code de l'entreprise**&nbsp;: sur l'écran de bienvenue, suivre la création de compte avec le code d'entreprise donné par le bureau. Le compte est créé et l'accueil s'affiche.
2. **Se connecter avec un code tapé**&nbsp;: se déconnecter (onglet Moi), puis «&nbsp;J'ai déjà un compte&nbsp;» > «&nbsp;Avec un code du bureau&nbsp;», taper le numéro de cellulaire et le code à 8 chiffres donnés par le bureau. L'accueil s'affiche.
3. **L'appareil photo**&nbsp;: dans un projet, prendre une photo. iOS demande l'accès avec la phrase «&nbsp;L'appareil photo sert à prendre les photos du chantier.&nbsp;» ; accepter ; la photo s'ajoute au projet.
4. **La dictée et son accord**&nbsp;: dans un rapport journalier, lancer l'assistant. L'app demande d'abord l'accord de la personne avant d'envoyer la voix, le texte et les photos au service d'IA ; puis iOS demande le micro avec «&nbsp;Le micro sert à dicter le rapport journalier.&nbsp;». Dicter quelques phrases&nbsp;: le rapport se remplit.
5. **Le PDF d'un rapport**&nbsp;: ouvrir le PDF d'un rapport. Il s'ouvre dans la visionneuse de l'iPhone ; le bouton de partage propose Mail, Messages, Fichiers. Partager une photo du chantier et choisir «&nbsp;Enregistrer l'image&nbsp;»&nbsp;: iOS demande l'accès avec «&nbsp;L'app enregistre dans vos photos celles du chantier que vous choisissez de garder.&nbsp;».
6. **Le mode Avion avec un projet gardé**&nbsp;: garder un projet sur le téléphone, ouvrir quelques feuilles de plan, quitter l'app (glisser vers le haut), activer le mode Avion, rouvrir l'app. Les plans gardés s'ouvrent. Ouvrir une page qui n'a jamais été vue&nbsp;: l'app le dit sans planter.
7. **Quitter et rouvrir**&nbsp;: quitter l'app complètement, la rouvrir le lendemain ou après quelques heures&nbsp;: la personne est toujours connectée.
8. **Supprimer le compte**&nbsp;: avec un compte d'essai, onglet Moi > supprimer le compte. Le compte disparaît et l'app revient à l'écran de bienvenue.
9. **Glisser pour revenir**&nbsp;: dans un projet, ouvrir un plan, puis glisser du bord gauche de l'écran vers la droite&nbsp;: l'écran précédent revient.
10. **Les liens** (après l'étape 4.9)&nbsp;: dans Notes, écrire `https://ead-chantier.vercel.app/projets`, toucher le lien&nbsp;: l'app EAD s'ouvre directement à cette page.
11. **L'apparence**&nbsp;: texte de la barre d'état blanc sur noir, rien sous l'encoche ni sous la barre du bas, boutons d'iOS en français (Annuler, Partager…).

Un essai qui échoue&nbsp;: Claude Code cherche la cause dans «&nbsp;Dépannage&nbsp;», corrige sur `ios-mac`, renvoie une version (étape 4.8), et le propriétaire refait l'essai.

## 5. Dépannage

**Signature et profils** (pendant `ios-release.sh`)

- `No Account for Team`, `No signing certificate "iOS Distribution" found`, `Cloud signing permission error`&nbsp;: la clé d'API n'a pas l'accès **Admin**. Le propriétaire crée une nouvelle clé avec l'accès Admin (section 3) ; mettre à jour les variables, relancer.
- `requires a development team`&nbsp;: `ASC_TEAM_ID` est vide ou faux. Relancer `scripts/ios-doctor.sh --envoi`.
- `No profiles for 'ca.allendumaresq.ead' were found`&nbsp;: l'identifiant n'existe pas chez Apple, ou le script n'a pas pu le créer. Faire l'étape 4.7, point 1, puis relancer.
- `Authentication failed`, `invalid key`&nbsp;: le Key ID, l'Issuer ID et le fichier `.p8` ne vont pas ensemble, ou la clé a été révoquée.

**Le droit «&nbsp;Associated Domains&nbsp;»**

- `Provisioning profile … doesn't include the com.apple.developer.associated-domains entitlement` ou `doesn't support the Associated Domains capability`&nbsp;: sur developer.apple.com > Identifiers > `ca.allendumaresq.ead`, cocher **Associated Domains**, **Save** (le propriétaire), puis relancer&nbsp;: Xcode refait le profil. Le simulateur compile sans signature et ne montre jamais cette erreur.

**Paquets Swift qui ne se résolvent pas**

- `Could not resolve package dependencies`, `no such module 'Capacitor'`&nbsp;: vérifier l'accès à github.com depuis le Mac, que `node_modules/@capacitor/` existe (`npm ci`), puis&nbsp;:

  ```bash
  rm -rf ios/App/build ~/Library/Caches/org.swift.swiftpm
  xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
  ```

- Les paquets des modules Capacitor sont lus dans `node_modules/` (chemins `../../../node_modules/@capacitor/…` dans `ios/App/CapApp-SPM/Package.swift`)&nbsp;: ne jamais déplacer ce dossier.

**Erreurs de compilation Swift**

- Dans `ios/App/App/EADViewController.swift` (le seul code Swift propre au projet, écrit sans Mac)&nbsp;: lire l'erreur, corriger au plus simple, commit. Si `NavigationFilter` refuse de compiler et que la correction n'est pas évidente, le retirer (supprimer la classe, son extension, la propriété `navigationFilter` et les trois lignes qui l'installent dans `capacitorDidLoad`)&nbsp;: l'app marche sans lui, la page «&nbsp;Pas de connexion&nbsp;» peut alors apparaître un instant quand un chargement est interrompu. Noter au journal.
- `@UIApplicationMain` signalé comme dépassé dans `AppDelegate.swift`&nbsp;: le remplacer par `@main` règle l'avertissement.

**Le cycle de vie par scènes (Xcode 27 et suivants)**

- Apple exige les scènes (`UIScene`) pour les apps compilées avec les nouveaux SDK. Le projet les utilise déjà&nbsp;: `SceneDelegate.swift` et `UIApplicationSceneManifest` dans `Info.plist`. Si Xcode signale tout de même que l'app n'adopte pas le cycle de vie par scènes, vérifier que la clé `UISceneDelegateClassName` vaut `$(PRODUCT_MODULE_NAME).SceneDelegate` et que la classe compile dans la cible App.

**Rejets à l'envoi (courriel d'Apple ou journal)**

- `ITMS-90717: Invalid App Store Icon … alpha channel`&nbsp;: l'icône a de la transparence. `node scripts/ios-assets.mjs` la refait sans transparence ; vérifier avec `sips -g hasAlpha ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (attendu `hasAlpha: no`).
- `ITMS-90683: Missing purpose string in Info.plist`&nbsp;: un module utilise une fonction protégée que `Info.plist` ne décrit pas. Ajouter la clé nommée, avec une seule phrase simple en français qui dit à quoi elle sert vraiment dans l'app, puis renvoyer. Ne jamais décrire un usage que l'app n'a pas.
- `ITMS-91053: Missing API declaration`&nbsp;: ajouter dans `ios/App/App/PrivacyInfo.xcprivacy` la catégorie et la raison que le courriel nomme (voir `docs/ios/README.md`).
- `The bundle version must be higher than the previously uploaded version`&nbsp;: vérifier l'heure du Mac, puis relancer (le numéro vient de l'heure).
- `This bundle is invalid. The value for key CFBundleShortVersionString … must contain a higher version`&nbsp;: la version 1.0.0 est déjà publiée ; voir section 7.

**Dans le simulateur**

- Écran blanc ou noir qui reste&nbsp;: `ios/App/App/capacitor.config.json` manque ; relancer `scripts/ios-sync.sh`. Pour voir ce que fait la page, le propriétaire peut ouvrir Safari > Réglages > Avancés > «&nbsp;Afficher les fonctionnalités pour les développeurs web&nbsp;», puis le menu Développement > Simulator > EAD (les versions de débogage s'inspectent).
- L'ancien écran de lancement reste affiché&nbsp;: iOS le garde en cache. `xcrun simctl uninstall booted ca.allendumaresq.ead`, puis relancer `scripts/ios-sim.sh`.
- Journaux de l'app&nbsp;: `xcrun simctl spawn booted log stream --predicate 'process == "App"' --level debug`.

## 6. Rendre compte

- Chaque correction est un commit sur la branche `ios-mac`, avec un message clair en anglais qui dit ce qui change et pourquoi.
- À la fin, ajouter une entrée dans «&nbsp;Journal&nbsp;» ci-dessous&nbsp;: la date, la version de macOS et d'Xcode, ce que disait `/diagnostic` et la décision prise pour `appBoundDomains`, le numéro de build envoyé, le résultat de chaque essai de 4.10, et chaque fichier changé avec la raison. Jamais de clé, de Key ID, d'Issuer ID ni de Team ID.
- Puis&nbsp;:

  ```bash
  git add docs/ios/MAC.md && git commit -m "Record the first build on the Mac"
  git push -u origin ios-mac
  ```

- Ne pas fusionner dans `main`&nbsp;: les développeurs relisent la branche.

## 7. Envoyer une mise à jour plus tard

- **Un changement du site** (écrans, textes, fonctions) n'a besoin d'aucun envoi&nbsp;: l'app affiche le site en ligne.
- **Un changement de l'app elle-même** (fichiers de `ios/`, `ios-shell/`, `capacitor.config.ts`, modules `@capacitor/…`) demande un nouvel envoi&nbsp;:
  1. `git checkout main && git pull`, puis `npm ci`.
  2. Si la version précédente a été publiée sur l'App Store, monter la version&nbsp;: `const version` dans `capacitor.config.ts` et `MARKETING_VERSION` (Debug et Release) dans `ios/App/App.xcodeproj/project.pbxproj`, la même valeur aux deux endroits (par exemple `1.0.1`), puis commit. Pour un simple nouvel essai dans TestFlight, garder la version&nbsp;: seul le numéro de build change, tout seul.
  3. `scripts/ios-sim.sh /diagnostic ~/Desktop/ead-diagnostic.png`, deux fois, et vérifier comme en 4.6.
  4. `scripts/ios-release.sh`.
- Une version dans TestFlight expire après 90 jours&nbsp;: tant que l'app reste en TestFlight, renvoyer une version avant l'échéance (TestFlight affiche les jours restants).
- **Apple et Xcode évoluent.** Avant un envoi, `scripts/ios-doctor.sh --envoi` ; si Apple exige un Xcode plus récent, mettre Xcode à jour et `MIN_XCODE` dans le script.

## Journal

Chaque passage sur le Mac ajoute une entrée ici, la plus récente en haut.

<!-- Modèle&nbsp;:
### AAAA-MM-JJ&nbsp;: premier essai et premier envoi
- macOS … ; Xcode …
- /diagnostic&nbsp;: dans l'app …, service worker …, modules … ; appBoundDomains = …
- Build envoyé&nbsp;: …
- Essais 4.10&nbsp;: 1 … ; 2 … ; …
- Fichiers changés&nbsp;: … (pourquoi)
-->
