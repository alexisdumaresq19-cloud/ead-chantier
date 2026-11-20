# L'app iPhone EAD&nbsp;: guide pour le Mac

Ce guide est fait pour Claude Code, sur le MacBook du propriétaire. Le propriétaire le lit en même temps&nbsp;: chaque étape dit qui fait quoi. Claude Code lance les commandes ; le propriétaire clique dans les sites d'Apple et de GitHub, tape les mots de passe et dit oui ou non. Suivez les étapes dans l'ordre, sans en sauter.

Si ce guide a été donné à Claude Code avant que le projet soit sur le Mac, commencer quand même par la section 3, puis l'étape 4.1 le met sur le Mac.

## 1. Ce qu'est ce projet

- EAD Chantier est l'app de chantier des Entreprises Allen Dumaresq&nbsp;: plans, documents, photos et rapports journaliers. Elle est en ligne à https://ead-chantier.vercel.app.
- L'app iPhone «&nbsp;EAD&nbsp;» est une coquille native (Capacitor 8, dossier `ios/`) qui affiche ce site en direct dans une vue web. Le site n'est pas copié dans l'app&nbsp;: chaque mise en ligne du site arrive aussi dans l'app.
- L'app ajoute ce qu'un site ne peut pas faire seul&nbsp;: l'icône, le partage et l'ouverture des fichiers par l'iPhone, les liens qui ouvrent l'app, une page «&nbsp;Pas de connexion&nbsp;».
- Elle sera distribuée par l'App Store comme app privée (non listée) pour l'équipe d'EAD, en passant d'abord par TestFlight.
- Ce qui est propre à l'iPhone est expliqué dans `docs/ios/README.md` ; ce guide-ci dit comment la construire, l'essayer et l'envoyer.

## 2. Ce qui ne doit jamais arriver

- **Une clé ou le Team ID dans le dépôt.** Le fichier `.p8`, le Key ID, l'Issuer ID et le Team ID restent sur le Mac, dans `~/.appstoreconnect/`. Ils ne sont jamais écrits dans un fichier du projet, un commit, un message de commit ou le journal à la fin de ce guide. `scripts/ios-doctor.sh --envoi` le vérifie.
- **Changer l'identifiant de l'app après le premier envoi.** L'identifiant `ca.allendumaresq.ead` devient définitif dès qu'une version est envoyée à App Store Connect. Avant cela seulement, `scripts/ios-set-id.sh` le change partout.
- **Toucher au compte Apple sans le oui du propriétaire.** Créer un identifiant, une app, une clé, enregistrer un appareil, inviter des testeurs, accepter un contrat&nbsp;: Claude Code explique, le propriétaire décide et clique.
- **Une publication.** Rien n'est soumis à la revue d'Apple ni publié sur l'App Store sans que le propriétaire l'ait demandé clairement. Les envois de ce guide vont dans TestFlight, et seulement là.

## 3. Ce qu'il faut demander au propriétaire au départ

Claude Code demande ces éléments avant toute commande, un à la fois, et attend la réponse.

1. **Un Mac assez récent pour Xcode.** Le propriétaire clique le menu Pomme (en haut à gauche) > **À propos de ce Mac** et lit la version de macOS. La version d'Xcode offerte par l'App Store demande un macOS minimum, écrit sur https://developer.apple.com/xcode/system-requirements/ (en novembre 2026&nbsp;: Xcode 27.2, qui demande macOS Tahoe 26.6 ou plus récent). Si le Mac est plus ancien&nbsp;: le propriétaire le met à jour d'abord (menu Pomme > **Réglages système** > **Général** > **Mise à jour logicielle**). Si la mise à jour ne propose pas macOS Tahoe 26.6 (Mac trop ancien pour lui), mais que le Mac a macOS Sequoia 15.6 ou plus récent&nbsp;: installer Xcode 26.3 à la place de celui de l'App Store, car Apple accepte encore les envois faits avec Xcode 26 (`MIN_XCODE` dans `scripts/ios-doctor.sh`). Le propriétaire ouvre https://developer.apple.com/download/all/, se connecte, cherche «&nbsp;Xcode 26.3&nbsp;», télécharge le fichier `.xip`, l'ouvre dans Téléchargements (macOS le décompresse), puis glisse Xcode dans **Applications**. Plus ancien que macOS Sequoia 15.6&nbsp;: arrêter et le dire au propriétaire&nbsp;; ce Mac ne peut pas construire l'app.
2. **Xcode installé depuis l'App Store du Mac** (gratuit, plusieurs Go). Une fois installé, l'ouvrir une fois et accepter ce qu'il propose d'installer (le simulateur d'iPhone compris)&nbsp;; il peut demander le mot de passe du Mac pour installer ses composants. Xcode apporte aussi git, dont l'étape 4.1 a besoin pour GitHub. Si, avant qu'Xcode soit installé, une fenêtre propose d'installer les «&nbsp;outils de ligne de commande&nbsp;», cliquer **Annuler** et finir d'abord Xcode&nbsp;: il les contient.
3. **L'accès au dépôt GitHub privé du projet.** Le propriétaire ouvre https://github.com, se connecte, clique son avatar (en haut à droite) > **Your repositories** et vérifie que le dépôt `ead-chantier` est dans la liste. S'il n'y est pas&nbsp;: le compte qui a créé le dépôt l'invite (dépôt > **Settings** > **Collaborators** > **Add people**). L'étape 4.1 connecte ce Mac à GitHub.
4. **Un compte Apple Developer Program actif** au nom de l'entreprise, et l'accès du propriétaire à App Store Connect comme «&nbsp;Titulaire du compte&nbsp;» (Account Holder) ou «&nbsp;Admin&nbsp;». S'il n'y a pas de compte&nbsp;: **arrêter ici.** Le propriétaire s'inscrit comme organisation sur https://developer.apple.com/programs/enroll/ ; Apple demande le numéro D-U-N-S de l'entreprise et met en général plusieurs jours à accepter. Reprendre ce guide quand Apple a confirmé l'inscription par courriel. Le titulaire du compte est la personne qui a inscrit l'entreprise chez Apple.
5. **La clé d'API d'App Store Connect** (fichier `.p8`), son **Key ID** et l'**Issuer ID**. Le propriétaire clique ainsi&nbsp;:
   1. Ouvrir https://appstoreconnect.apple.com et se connecter.
   2. Cliquer **Utilisateurs et accès** (Users and Access).
   3. Cliquer l'onglet **Intégrations** (Integrations), puis **App Store Connect API** à gauche, puis **Clés d'équipe** (Team Keys).
   4. La première fois seulement, le titulaire du compte clique **Request Access** (Demander l'accès), coche la case des conditions et clique **Submit** (Envoyer). Apple examine chaque demande&nbsp;: si le bouton pour créer une clé n'apparaît pas tout de suite, passer en attendant au Team ID et à l'iPhone (points 6 et 7 ci-dessous), puis revenir ici plus tard dans la journée.
   5. Cliquer **Generate API Key** (Générer une clé d'API), ou le bouton **+** s'il y a déjà une clé. Nom&nbsp;: `EAD Mac`. Sous **Access** (Accès)&nbsp;: **Admin** (Xcode en a besoin pour créer lui-même le certificat de distribution). Cliquer **Generate** (Générer).
   6. Dans la ligne de la nouvelle clé, cliquer le lien **Download API Key** (Télécharger la clé d'API). Apple ne permet de la télécharger **qu'une seule fois**&nbsp;: le lien disparaît ensuite. Le fichier `AuthKey_XXXXXXXXXX.p8` arrive dans Téléchargements. Ne pas l'envoyer par courriel ni le mettre dans le dépôt.
   7. Le **Key ID** est dans la colonne des clés actives (**Active**)&nbsp;: en passant la souris à côté, un lien **Copy Key ID** le copie (10 caractères, aussi dans le nom du fichier).
   8. L'**Issuer ID** est affiché en haut de la page (un long identifiant avec des tirets), avec un bouton **Copy** pour le copier.
6. **Le Team ID**&nbsp;: ouvrir https://developer.apple.com/account, se connecter, cliquer **Membership details** (Détails de l'abonnement) ; le Team ID est la valeur de 10 caractères sur la ligne **Team ID** (Identifiant d'équipe).
7. **Un iPhone de l'entreprise et son câble**, pour l'enregistrer une fois dans le compte (étape 4.6). Il servira aussi aux essais par TestFlight.

Le propriétaire donne le Key ID, l'Issuer ID et le Team ID à Claude Code quand il les demande à l'étape 4.3. Claude Code les écrit dans un fichier du Mac hors du projet, jamais dans un fichier du projet.

**Les commandes avec `sudo` et les connexions.** Claude Code ne peut pas taper de mot de passe&nbsp;: ses commandes n'ont pas de terminal. Quand une commande demande le mot de passe du Mac (`sudo …`) ou une connexion (`gh auth login`), Claude Code l'affiche ; le propriétaire ouvre **Terminal** (Finder > **Applications** > **Utilitaires** > **Terminal**), colle la commande, appuie sur Entrée, tape ce qu'elle demande (le mot de passe ne s'affiche pas pendant qu'on le tape), puis dit à Claude Code de continuer.

## 4. Les étapes

### 4.1 Le dépôt, la branche de travail et les modules

Si le dépôt est déjà sur le Mac, aller dans son dossier et passer directement au bloc «&nbsp;La branche&nbsp;».

**GitHub sur ce Mac.** Xcode doit être installé et ouvert une fois avant ce bloc (section 3, point 2)&nbsp;: la connexion à GitHub se sert de git, qui vient avec Xcode. Vérifier si l'outil GitHub est là&nbsp;: `gh --version`. S'il manque, Claude Code l'installe lui-même dans le dossier personnel, sans mot de passe (le paquet `.pkg` du site de GitHub n'est pas signé, et macOS refuse de l'ouvrir)&nbsp;:

```bash
arch=$(uname -m); [ "$arch" = x86_64 ] && arch=amd64
v=2.105.0   # ou la plus récente, lue sur https://github.com/cli/cli/releases/latest
mkdir -p ~/.local/bin
(cd /tmp && curl -fsSLO "https://github.com/cli/cli/releases/download/v$v/gh_${v}_macOS_$arch.zip" \
  && unzip -oq "gh_${v}_macOS_$arch.zip" && cp "gh_${v}_macOS_$arch/bin/gh" ~/.local/bin/)
grep -q '.local/bin' ~/.zshrc 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
~/.local/bin/gh --version
```

Les commandes de Claude Code ne lisent pas `~/.zshrc`&nbsp;: les siennes commencent par `export PATH="$HOME/.local/bin:$PATH"`, comme dans les blocs ci-dessous. Le propriétaire, lui, quitte Terminal (Commande + Q) et le rouvre, puis y colle&nbsp;:

```bash
gh auth login --hostname github.com --git-protocol https --web
```

Il appuie sur Entrée. Terminal demande d'abord «&nbsp;Authenticate Git with your GitHub credentials? (Y/n)&nbsp;»&nbsp;: il appuie sur Entrée (c'est oui). Une ligne qui commence par «&nbsp;! Did you know&nbsp;» peut s'afficher avant&nbsp;: l'ignorer. Terminal affiche ensuite «&nbsp;! First copy your one-time code:&nbsp;» suivi d'un code de la forme `ABCD-1234`. Le propriétaire le sélectionne à la souris, fait Commande + C, puis appuie sur Entrée&nbsp;: la page de GitHub s'ouvre. Il y colle le code (Commande + V), clique **Continue** puis **Authorize**. Si Terminal répond que git manque&nbsp;: Xcode n'est pas encore installé ou n'a pas été ouvert (section 3, point 2). Ensuite, Claude Code&nbsp;:

```bash
export PATH="$HOME/.local/bin:$PATH"
gh auth setup-git
gh auth status
gh repo list --limit 100 | grep ead-chantier
```

La dernière ligne donne le nom complet du dépôt (`compte/ead-chantier`). Si elle ne donne rien (le dépôt appartient à un autre compte GitHub qui y a invité le propriétaire)&nbsp;: le propriétaire ouvre le dépôt sur https://github.com, et son adresse `github.com/compte/ead-chantier` donne le nom complet. Puis&nbsp;:

```bash
export PATH="$HOME/.local/bin:$PATH"
gh repo clone compte/ead-chantier ~/ead-chantier   # le nom complet donné ci-dessus
cd ~/ead-chantier
```

Si GitHub répond `Could not resolve to a Repository` ou `Repository not found`&nbsp;: le compte connecté n'a pas accès au dépôt. Le propriétaire vérifie le point 3 de la section 3, puis relance `gh auth login` avec le bon compte.

**La branche.** Les commits portent un nom et un courriel. Si `git config user.name` ne répond rien, Claude Code demande au propriétaire le nom et le courriel à y mettre, puis lance `git config --global user.name "…"` et `git config --global user.email "…"` avec ses réponses.

```bash
git fetch origin
git checkout main && git merge --ff-only origin/main
git checkout ios-mac 2>/dev/null || git checkout -b ios-mac
if git rev-parse -q --verify origin/ios-mac >/dev/null; then git merge origin/ios-mac; fi
git merge main
```

Toutes les corrections faites sur le Mac vont dans cette branche `ios-mac` (section 6). Si elle existe déjà (un passage précédent), ces lignes la reprennent avec ce qu'elle a sur GitHub, puis y ajoutent les nouveautés de `main`&nbsp;: les corrections d'un passage précédent ne se perdent pas, même si les développeurs ne les ont pas encore fusionnées. Un conflit à une fusion&nbsp;: arrêter et le dire au propriétaire ; un développeur doit d'abord régler la branche.

**Node.js et les modules.** Vérifier `node -v`&nbsp;: il faut `v22` ou plus. Sinon, le propriétaire installe la version LTS depuis https://nodejs.org (paquet pour macOS), puis&nbsp;:

```bash
npm ci
```

Jamais `npm install` ni `npm update`&nbsp;: ils changeraient `package-lock.json`.

### 4.2 Le docteur

```bash
scripts/ios-doctor.sh
```

Il vérifie macOS, Xcode (assez récent pour qu'Apple accepte l'envoi), sa licence, ses composants, un simulateur d'iPhone, Node.js 22 ou plus, git et les modules du projet. Chaque ligne «&nbsp;À FAIRE&nbsp;» dit quoi faire ; une commande avec `sudo` est tapée par le propriétaire dans Terminal (section 3, dernier paragraphe). Régler les lignes dans l'ordre et relancer jusqu'à «&nbsp;Tout est prêt.&nbsp;»

L'Xcode minimum est écrit en haut du script (`MIN_XCODE`)&nbsp;: c'est ce qu'Apple exigeait à l'écriture de ce guide (Xcode 26, vérifié le 20 novembre 2026). Vérifier sur https://developer.apple.com/news/upcoming-requirements/ ; si Apple exige maintenant une version plus récente, mettre la nouvelle valeur dans le script (commit sur `ios-mac`).

### 4.3 La clé, hors du dépôt

```bash
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/
chmod 700 ~/.appstoreconnect ~/.appstoreconnect/private_keys
chmod 600 ~/.appstoreconnect/private_keys/AuthKey_*.p8
ls -l ~/.appstoreconnect/private_keys/
```

macOS peut demander si l'app de Claude Code a le droit d'ouvrir le dossier Téléchargements&nbsp;: le propriétaire clique **Autoriser** (ou glisse lui-même le fichier `.p8` dans `~/.appstoreconnect/private_keys/` avec le Finder, menu **Aller** > **Aller au dossier**).

Puis Claude Code écrit le fichier `~/.appstoreconnect/ead.env` avec ces quatre lignes et les valeurs données par le propriétaire (ce fichier est sur le Mac, hors du projet)&nbsp;:

```bash
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export ASC_TEAM_ID=XXXXXXXXXX
export ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8"
```

Et&nbsp;:

```bash
chmod 600 ~/.appstoreconnect/ead.env
grep -q 'appstoreconnect/ead.env' ~/.zshrc 2>/dev/null || echo '[ -f ~/.appstoreconnect/ead.env ] && . ~/.appstoreconnect/ead.env' >> ~/.zshrc
scripts/ios-doctor.sh --envoi
```

Les scripts lisent eux-mêmes `~/.appstoreconnect/ead.env`&nbsp;: rien à recharger, ni nouveau terminal à ouvrir. La ligne ajoutée à `~/.zshrc` donne les mêmes variables dans le Terminal du propriétaire. Relancer `scripts/ios-doctor.sh --envoi` jusqu'à «&nbsp;Tout est prêt.&nbsp;»

### 4.4 La préparation du projet Xcode

```bash
scripts/ios-sync.sh
```

Il copie les pages de l'app (`ios-shell/`), puis lance `npx cap sync ios`. Les autres scripts le lancent eux-mêmes ; on le relance à la main après un changement de `capacitor.config.ts`.

### 4.5 Premier essai dans le simulateur

```bash
scripts/ios-sim.sh /diagnostic ios/App/build/ead-diagnostic.png
```

Le script compile l'app pour le simulateur (sans signature), démarre un iPhone simulé, installe l'app et l'ouvre directement à la page `/diagnostic` du site. Après 8 secondes, il enregistre une capture d'écran dans `ios/App/build/` (dossier ignoré par git). La première compilation est longue&nbsp;: Xcode télécharge les paquets Swift de Capacitor depuis GitHub.

Claude Code ouvre la capture (`ios/App/build/ead-diagnostic.png`) et la lit. La page `/diagnostic` dit trois choses&nbsp;:

1. si la page tourne **dans l'app iPhone** ou dans un navigateur ;
2. si un **service worker** contrôle la page (c'est lui qui ouvre les plans gardés sans réseau) ;
3. quels **modules natifs** répondent (partage, fichiers, visionneuse, écran de lancement, app).

Le service worker s'installe à la première ouverture et ne prend la page qu'à l'ouverture suivante. **Lancer donc le script une deuxième fois** (même commande) avant de conclure.

Ce qu'il faut savoir pour lire le tableau (vérifié dans le code de WebKit, voir `docs/ios/README.md`)&nbsp;: dans une app, WebKit ne donne un service worker que si `appBoundDomains = true`. Mettre `false` ne peut donc jamais faire apparaître le service worker ; cela ne sert que si le pont natif ne marche pas avec `true`.

Ensuite, selon la deuxième capture&nbsp;:

| Ce que dit `/diagnostic`                                                                   | Ce que ça veut dire                                                                             | Quoi faire                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dans l'app&nbsp;: oui. Service worker&nbsp;: oui. Modules&nbsp;: tous répondent.                          | Tout marche, avec les domaines liés à l'app (App-Bound Domains).                                | Rien. Garder `appBoundDomains = true` dans `capacitor.config.ts`.                                                                                                                                                                                                                                                                                                                                                                                      |
| Dans l'app&nbsp;: oui. Modules&nbsp;: répondent. Service worker&nbsp;: non.                               | Le pont natif marche ; le service worker ne s'installe pas.                                     | Garder `true`. Vérifier que `ios/App/App/Info.plist` liste exactement `ead-chantier.vercel.app` et `localhost` sous `WKAppBoundDomains`, et que l'app a été ouverte deux fois. Ouvrir aussi https://ead-chantier.vercel.app/diagnostic dans Safari du simulateur&nbsp;: si le service worker manque là aussi, c'est le site qui ne l'installe pas. Noter au journal ; l'app marche, mais les plans gardés ne s'ouvrent pas sans réseau tant que ce n'est pas réglé. |
| Dans l'app&nbsp;: non, ou aucun module ne répond.                                               | Le pont de Capacitor n'est pas injecté dans la page&nbsp;: WebKit ne compte pas le site comme lié à l'app. | Vérifier `WKAppBoundDomains` comme ci-dessus. S'il est juste&nbsp;: mettre `appBoundDomains = false`, relancer deux fois. Si «&nbsp;dans l'app&nbsp;» passe à oui&nbsp;: garder `false` et noter au journal que, sans service worker, les plans gardés ne s'ouvrent pas sans réseau dans l'app. Si rien ne change&nbsp;: remettre `true` ; le problème est ailleurs, voir «&nbsp;Dépannage&nbsp;».                                                                                               |
| La page «&nbsp;Pas de connexion&nbsp;» s'affiche.                                                    | La vue web n'a pas pu charger le site.                                                          | Vérifier que le Mac a Internet et que https://ead-chantier.vercel.app/diagnostic s'ouvre dans Safari. Si oui&nbsp;: avec `appBoundDomains = true`, WebKit refuse le site&nbsp;: vérifier `WKAppBoundDomains`, sinon essayer `false` et noter au journal.                                                                                                                                                                                                         |
| `/diagnostic` montre la page «&nbsp;adresse inconnue&nbsp;» de l'app, ou un écran noir.                 | La version du site en ligne n'a pas encore cette page, ou la page n'a pas fini de charger.      | Relancer avec `EAD_SIM_WAIT=20`. Si la page n'existe pas en ligne, le dire au propriétaire&nbsp;: il faut d'abord mettre en ligne la version du site qui contient l'app iPhone.                                                                                                                                                                                                                                                                              |

Le réglage `appBoundDomains` est une seule ligne de `capacitor.config.ts` ; `docs/ios/README.md` explique ce qu'il change. Tout changement est un commit sur `ios-mac`, avec la raison au journal.

Puis regarder l'écran d'accueil de l'app&nbsp;:

```bash
scripts/ios-sim.sh "" ios/App/build/ead-accueil.png
```

Attendu&nbsp;: le logo EAD sur fond noir au lancement, puis l'accueil du site, texte de la barre d'état en blanc sur la barre noire du haut, rien de caché sous l'encoche ni sous la barre du bas.

Deux vérifications, avec l'inspecteur de Safari (pour l'ouvrir&nbsp;: «&nbsp;Dans le simulateur&nbsp;», sous «&nbsp;Dépannage&nbsp;»)&nbsp;:

1. **Une seule vue web.** Pendant que l'app est ouverte dans le simulateur, le menu **Développement** > (le simulateur) > doit lister une seule page sous EAD. Deux pages&nbsp;: UIKit construit aussi l'écran de `Main.storyboard` en plus de celui de `SceneDelegate.swift`. Retirer alors les clés `UISceneStoryboardFile` et `UIMainStoryboardFile` de `ios/App/App/Info.plist` (`SceneDelegate.swift` fait déjà la fenêtre), relancer `scripts/ios-sim.sh` et vérifier qu'il n'en reste qu'une, puis commit.
2. **La page «&nbsp;Pas de connexion&nbsp;» au premier lancement sans réseau.** Le propriétaire coupe le Wi-Fi du Mac (et débranche son câble réseau s'il en a un). Claude Code lance&nbsp;:

   ```bash
   xcrun simctl uninstall booted ca.allendumaresq.ead   # sans cela, le service worker répondrait
   scripts/ios-sim.sh "" ios/App/build/ead-hors-ligne.png
   ```

   Attendu&nbsp;: la capture montre «&nbsp;Pas de connexion&nbsp;», et l'adresse de la page dans l'inspecteur est `capacitor://localhost/offline.html#/` (avec `#/`). Sans `#/`&nbsp;: la vue web ne dit pas quelle adresse a échoué, et «&nbsp;Réessayer&nbsp;» ramène toujours à l'accueil&nbsp;; l'app marche, le noter au journal. Le propriétaire remet le Wi-Fi et clique **Réessayer** dans le simulateur&nbsp;: l'accueil du site revient.

Enfin, faire un commit des fichiers qu'Xcode a créés et qui doivent être suivis, en particulier `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` (les versions exactes des paquets Swift). Vérifier avec `git status --short` qu'aucun autre fichier n'a changé sans raison. Un fichier qu'Xcode crée pour lui seul (par exemple sous `ios/App/CapApp-SPM/.swiftpm/`) va dans `ios/.gitignore`, dans le même commit&nbsp;: `scripts/ios-release.sh` refuse de partir tant qu'un fichier n'est pas dans un commit.

### 4.6 Avant le premier envoi&nbsp;: l'identifiant, un iPhone enregistré et la fiche de l'app (le propriétaire)

Dernière occasion de changer l'identifiant `ca.allendumaresq.ead`. Le demander au propriétaire. S'il en veut un autre&nbsp;: `scripts/ios-set-id.sh nouvel.identifiant`, `npm test`, commit.

Puis le propriétaire clique, avec Claude Code qui guide&nbsp;:

1. **L'identifiant chez Apple.** https://developer.apple.com/account > **Certificates, Identifiers & Profiles** (Certificats, identifiants et profils) > **Identifiers** (Identifiants) > bouton **+** > **App IDs** > **Continue** (Continuer) > **App** > **Continue**. Description&nbsp;: `EAD`. Bundle ID&nbsp;: **Explicit**, `ca.allendumaresq.ead`. Dans la liste Capabilities, cocher **Associated Domains**. **Continue**, puis **Register** (Enregistrer).
2. **Un iPhone enregistré dans le compte.** Pour signer l'archive, Xcode fait d'abord un profil de développement, et Apple n'en fait que si le compte a au moins un appareil enregistré. À faire une seule fois&nbsp;:
   1. Brancher l'iPhone au Mac avec son câble, le déverrouiller ; s'il demande «&nbsp;Faire confiance à cet ordinateur&nbsp;?&nbsp;», toucher **Se fier** et taper son code.
   2. Dans le Finder, cliquer l'iPhone sous **Emplacements** (Locations), dans la barre de gauche&nbsp;; si un bouton **Se fier** (Trust) apparaît, le cliquer et confirmer sur l'iPhone. Sous le nom de l'iPhone, cliquer deux fois la ligne grise (le modèle) jusqu'à voir l'UDID, puis Contrôle-clic sur l'UDID > **Copier l'UDID** (Copy UDID). (Autre façon, dans Xcode 27&nbsp;: menu **Xcode** > **Open Developer Tool** > **Device Hub**, choisir l'iPhone à gauche, bouton **Info** en haut à droite, champ **UDID**&nbsp;; s'il manque, **Edit Visibility** en bas, activer UDID. Dans Xcode 26&nbsp;: menu **Window** > **Devices and Simulators**, ligne **Identifier**.)
   3. https://developer.apple.com/account > **Certificates, Identifiers & Profiles** > **Devices** (Appareils) > bouton **+**. Platform&nbsp;: **iOS**. Device Name&nbsp;: par exemple `iPhone bureau`. Device ID (UDID)&nbsp;: coller. **Continue**, puis **Register**.
3. **La fiche de l'app.** D'abord les contrats&nbsp;: Apple ne laisse créer aucune app tant que le titulaire du compte n'a pas accepté le dernier contrat. Dans App Store Connect, une bannière en haut de page le signale&nbsp;; sinon, **Business** en haut de la page, onglet **Agreements** (Contrats). Le titulaire du compte lit et accepte ce qui attend. Sans cela, le bouton **New App** ne crée rien. Puis&nbsp;: https://appstoreconnect.apple.com > **Apps** > bouton **+** > **New App** (Nouvelle app). Valeurs, les mêmes que dans `store/README.md`&nbsp;:
   - Plateforme (Platforms)&nbsp;: **iOS**
   - Nom (Name)&nbsp;: `EAD`
   - Langue principale (Primary Language)&nbsp;: **Français (Canada)**
   - Identifiant de lot (Bundle ID)&nbsp;: `ca.allendumaresq.ead`
   - SKU&nbsp;: `ead-ios`
   - Accès des utilisateurs (User Access)&nbsp;: **Accès complet** (Full Access)

   Cliquer **Create** (Créer). Le nom d'une app doit être unique sur tout l'App Store. Si `EAD` est déjà pris, le propriétaire choisit un autre nom pour la fiche (`store/listing.fr-CA.md` en propose deux). Le nom sous l'icône de l'iPhone reste «&nbsp;EAD&nbsp;»&nbsp;: il vient du projet (`CFBundleDisplayName`).

### 4.7 Le premier envoi

```bash
scripts/ios-release.sh
```

Le script lit `~/.appstoreconnect/ead.env` et refuse de partir si des fichiers ne sont pas dans un commit. Il vérifie le Mac (`ios-doctor.sh --envoi`), prépare le projet, construit l'archive signée (Xcode crée lui-même le certificat et les profils avec la clé d'API), puis l'envoie à App Store Connect. Le numéro de build est la date et l'heure (UTC), par exemple `20261120.1945`.

Après «&nbsp;Envoyée&nbsp;», Apple **traite** la version&nbsp;: il vérifie le paquet, prépare l'installation et la rend disponible pour TestFlight. Cela prend en général de 5 à 30 minutes, parfois plus. Pendant ce temps, la version apparaît dans **App Store Connect > Apps > EAD > TestFlight**, **iOS** à gauche, section **Build Uploads**, avec l'état «&nbsp;Processing&nbsp;» (Traitement), puis «&nbsp;Complete&nbsp;». Un courriel d'Apple arrive quand elle est prête, ou s'il y a un problème (il nomme alors une erreur `ITMS-…`&nbsp;: voir «&nbsp;Dépannage&nbsp;»). Plus de 24 heures en Processing&nbsp;: écrire à Apple (https://developer.apple.com/contact/).

Aucune question sur le chiffrement ne devrait être posée&nbsp;: le projet déclare déjà que l'app n'utilise que le chiffrement standard d'iOS (`ITSAppUsesNonExemptEncryption`).

### 4.8 Les liens qui ouvrent l'app (le propriétaire, sur Vercel)

Les développeurs ont peut-être déjà mis la variable sur le site, une fois que le propriétaire leur a donné son Team ID. Claude Code vérifie d'abord&nbsp;:

```bash
curl -sI https://ead-chantier.vercel.app/.well-known/apple-app-site-association
```

S'il répond `HTTP/2 200` avec `content-type: application/json`, sans redirection, la variable est déjà là. Claude Code vérifie qu'elle porte le bon Team ID (la commande n'affiche qu'un nombre)&nbsp;:

```bash
. ~/.appstoreconnect/ead.env; curl -s https://ead-chantier.vercel.app/.well-known/apple-app-site-association | grep -c "$ASC_TEAM_ID.ca.allendumaresq.ead"
```

`1` (ou plus)&nbsp;: il n'y a rien d'autre à faire, passer au dernier paragraphe. `0`&nbsp;: la variable a une autre valeur&nbsp;; le propriétaire la corrige comme ci-dessous.

Sinon (en général `HTTP/2 404`), quand la version du site qui contient l'app iPhone est en ligne, le propriétaire ajoute une variable sur Vercel&nbsp;: projet **ead-chantier** > **Settings** > **Environment Variables** > nom `IOS_APP_ID`, valeur `TEAMID.ca.allendumaresq.ead` (son Team ID, un point, l'identifiant), environnement **Production** > **Save**, puis **Redeploy** de la dernière version. Puis Claude Code relance les deux commandes ci-dessus&nbsp;: attendu `HTTP/2 200`, `content-type: application/json`, sans redirection, et `1`.

Apple garde sa propre copie et la rafraîchit lui-même, parfois après plusieurs heures ; ce qu'il a en ce moment se lit avec `curl -s https://app-site-association.cdn-apple.com/a/v1/ead-chantier.vercel.app`.

### 4.9 Les essais sur un vrai iPhone, par TestFlight

Le propriétaire&nbsp;:

1. Dans **App Store Connect > Apps > EAD > TestFlight**, cliquer **+** à côté de **Internal Testing** (Tests internes), nommer le groupe `Bureau`, cocher **Enable automatic distribution**, puis **Create**. Puis **Invite Testers**, cocher les personnes qui testeront (des utilisateurs du compte App Store Connect), **Add**. Puis **Add Builds**, choisir la version envoyée, écrire une phrase dans **What to Test** (par exemple «&nbsp;Premier essai de l'app EAD&nbsp;»), **Add**.
2. Sur l'iPhone, installer l'app **TestFlight** depuis l'App Store, ouvrir le courriel d'invitation, puis **Installer** EAD.

Puis, sur l'iPhone, dans cet ordre. Noter chaque résultat (fonctionne, ou ce qui se passe) pour le journal.

1. **Créer un compte avec le code de l'entreprise**&nbsp;: sur l'écran de bienvenue, suivre la création de compte avec le code d'entreprise donné par le bureau. Le compte est créé et l'accueil s'affiche.
2. **Se connecter avec un code tapé**&nbsp;: se déconnecter (onglet **Mon compte** > **Se déconnecter**), puis «&nbsp;J'ai déjà un compte&nbsp;» > «&nbsp;Avec un code du bureau&nbsp;», taper le numéro de cellulaire et le code à 8 chiffres donnés par le bureau. L'accueil s'affiche.
3. **L'appareil photo**&nbsp;: dans un projet, prendre une photo. iOS demande l'accès avec la phrase «&nbsp;L'appareil photo sert à prendre les photos du chantier.&nbsp;» ; accepter ; la photo s'ajoute au projet.
4. **La dictée et son accord**&nbsp;: dans un rapport journalier, lancer l'assistant. L'app demande d'abord l'accord de la personne avant d'envoyer la voix, le texte et les photos au service d'IA ; puis iOS demande le micro avec «&nbsp;Le micro sert à dicter le rapport journalier.&nbsp;». Dicter quelques phrases&nbsp;: le rapport se remplit.
5. **Le PDF d'un rapport**&nbsp;: ouvrir le PDF d'un rapport. Il s'ouvre dans la visionneuse de l'iPhone ; le bouton de partage propose Mail, Messages, Fichiers. Partager une photo du chantier et choisir «&nbsp;Enregistrer l'image&nbsp;»&nbsp;: iOS demande l'accès avec «&nbsp;L'app enregistre dans vos photos celles du chantier que vous choisissez de garder.&nbsp;».
6. **Le mode Avion avec un projet gardé**&nbsp;: garder un projet sur le téléphone, ouvrir quelques feuilles de plan, quitter l'app (glisser vers le haut), activer le mode Avion, rouvrir l'app. Les plans gardés s'ouvrent. Ouvrir une page qui n'a jamais été vue&nbsp;: l'app le dit sans planter. Puis, toujours en mode Avion, quitter l'app (glisser vers le haut) et toucher dans Notes un lien vers un projet (copié depuis l'app avec le bouton de partage)&nbsp;: c'est le lien qui démarre l'app. Si la page «&nbsp;Pas de connexion&nbsp;» s'affiche, couper le mode Avion et toucher «&nbsp;Réessayer&nbsp;»&nbsp;: l'app ouvre directement ce projet (après l'étape 4.8 seulement, comme au point 10).
7. **Quitter et rouvrir**&nbsp;: quitter l'app complètement, la rouvrir le lendemain ou après quelques heures&nbsp;: la personne est toujours connectée.
8. **Supprimer le compte**&nbsp;: avec un compte d'essai, onglet **Mon compte** > **Supprimer mon compte**, et confirmer. Le compte disparaît et l'app revient à l'écran de bienvenue.
9. **Glisser pour revenir**&nbsp;: dans un projet, ouvrir un plan, puis glisser du bord gauche de l'écran vers la droite&nbsp;: l'écran précédent revient.
10. **Les liens** (après l'étape 4.8)&nbsp;: dans Notes, écrire `https://ead-chantier.vercel.app/moi`, toucher le lien&nbsp;: l'app EAD s'ouvre directement à l'écran «&nbsp;Mon compte&nbsp;». Refaire avec un lien vers un projet copié depuis l'app.
11. **L'apparence**&nbsp;: texte de la barre d'état blanc sur noir, rien sous l'encoche ni sous la barre du bas, boutons d'iOS en français (Annuler, Partager…).
12. **Un fichier que l'iPhone n'affiche pas**&nbsp;: dans les documents d'un projet, toucher un fichier `.zip` ou `.dwg` s'il y en a un. Attendu&nbsp;: la visionneuse ou le partage de l'iPhone s'ouvre. Si rien ne se passe, le noter au journal&nbsp;: la vue web ne sait pas l'afficher, et c'est au site d'ouvrir ces fichiers avec la visionneuse ou le partage quand il tourne dans l'app.

Un essai qui échoue&nbsp;: Claude Code cherche la cause dans «&nbsp;Dépannage&nbsp;», corrige sur `ios-mac`, renvoie une version (étape 4.7), et le propriétaire refait l'essai.

## 5. Dépannage

**Signature et profils** (pendant `ios-release.sh`)

- `Your team has no devices from which to generate a provisioning profile`, ou `No profiles for 'ca.allendumaresq.ead' were found` alors que l'identifiant existe déjà chez Apple&nbsp;: aucun iPhone n'est enregistré dans le compte. Faire l'étape 4.6, point 2, puis relancer. Le script le dit aussi quand il reconnaît ces messages.
- `No profiles for 'ca.allendumaresq.ead' were found` alors que l'identifiant **n'est pas** dans developer.apple.com/account > **Certificates, Identifiers & Profiles** > **Identifiers**&nbsp;: faire l'étape 4.6, point 1, puis relancer.
- `No Account for Team`, `No signing certificate "iOS Distribution" found`, `Cloud signing permission error`&nbsp;: la clé d'API n'a pas l'accès **Admin**. Le propriétaire crée une nouvelle clé avec l'accès Admin (section 3, point 5) ; mettre à jour `~/.appstoreconnect/ead.env`, relancer.
- `requires a development team`&nbsp;: `ASC_TEAM_ID` est vide ou faux. Relancer `scripts/ios-doctor.sh --envoi`.
- `Authentication failed`, `invalid key`&nbsp;: le Key ID, l'Issuer ID et le fichier `.p8` ne vont pas ensemble, ou la clé a été révoquée.

**Le droit «&nbsp;Associated Domains&nbsp;»**

- `Provisioning profile … doesn't include the com.apple.developer.associated-domains entitlement` ou `doesn't support the Associated Domains capability`&nbsp;: sur developer.apple.com/account > **Certificates, Identifiers & Profiles** > **Identifiers** > `ca.allendumaresq.ead`, cocher **Associated Domains**, **Save** (le propriétaire), puis relancer&nbsp;: Xcode refait le profil. Le simulateur compile sans signature et ne montre jamais cette erreur.

**Paquets Swift qui ne se résolvent pas**

- `Could not resolve package dependencies`, `no such module 'Capacitor'`&nbsp;: vérifier l'accès à github.com depuis le Mac, que `node_modules/@capacitor/` existe (`npm ci`), puis&nbsp;:

  ```bash
  rm -rf ios/App/build ~/Library/Caches/org.swift.swiftpm
  xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
  ```

- Les paquets des modules Capacitor sont lus dans `node_modules/` (chemins `../../../node_modules/@capacitor/…` dans `ios/App/CapApp-SPM/Package.swift`)&nbsp;: ne jamais déplacer ce dossier.

**Erreurs de compilation Swift**

- Dans `ios/App/App/EADViewController.swift` (le seul code Swift propre au projet, écrit sans Mac)&nbsp;: lire l'erreur, corriger au plus simple, commit. Si seule l'attente de 15 secondes (`watch`, `settle`, `giveUp`) refuse de compiler et que la correction n'est pas évidente&nbsp;: retirer ces deux fonctions, leurs appels et les deux propriétés `watched` et `giveUp`&nbsp;; un chargement sans réponse laisse alors l'écran noir jusqu'à une minute. Si tout `NavigationFilter` refuse de compiler, le retirer (supprimer la classe, son extension, la propriété `navigationFilter` et les lignes qui l'installent dans `capacitorDidLoad`)&nbsp;: l'app marche sans lui ; la page «&nbsp;Pas de connexion&nbsp;» peut alors apparaître un instant quand un chargement est interrompu, et «&nbsp;Réessayer&nbsp;» ramène toujours à l'accueil. Noter au journal.

**Le cycle de vie par scènes (Xcode 27 et suivants)**

- Apple exige les scènes (`UIScene`) pour les apps compilées avec les nouveaux SDK. Le projet les utilise déjà&nbsp;: `SceneDelegate.swift` et `UIApplicationSceneManifest` dans `Info.plist`. Si Xcode signale tout de même que l'app n'adopte pas le cycle de vie par scènes, vérifier que la clé `UISceneDelegateClassName` vaut `$(PRODUCT_MODULE_NAME).SceneDelegate` et que la classe compile dans la cible App.

**Rejets à l'envoi (courriel d'Apple ou journal)**

- `ITMS-90717: Invalid App Store Icon … alpha channel`&nbsp;: l'icône a de la transparence. `node scripts/ios-assets.mjs` la refait sans transparence ; vérifier avec `sips -g hasAlpha ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (attendu `hasAlpha: no`).
- `ITMS-90683: Missing purpose string in Info.plist`&nbsp;: un module utilise une fonction protégée que `Info.plist` ne décrit pas. Ajouter la clé nommée, avec une seule phrase simple en français qui dit à quoi elle sert vraiment dans l'app, puis renvoyer. Ne jamais décrire un usage que l'app n'a pas.
- `ITMS-91053: Missing API declaration`&nbsp;: ajouter dans `ios/App/App/PrivacyInfo.xcprivacy` la catégorie et la raison que le courriel nomme (voir `docs/ios/README.md`).
- `The bundle version must be higher than the previously uploaded version`&nbsp;: vérifier l'heure du Mac, puis relancer (le numéro vient de l'heure).
- Un refus qui vise la forme du numéro de build (`CFBundleVersion`)&nbsp;: relancer avec un simple nombre, `EAD_BUILD_NUMBER=1 scripts/ios-release.sh` (puis 2, 3… aux envois suivants, toujours plus grand), et le noter au journal pour que les développeurs changent la règle dans le script.
- `This bundle is invalid. The value for key CFBundleShortVersionString … must contain a higher version`&nbsp;: la version 1.0.0 a déjà été approuvée par Apple (publiée ou non)&nbsp;; voir section 7.

**Dans le simulateur**

- Écran blanc ou noir qui reste&nbsp;: `ios/App/App/capacitor.config.json` manque ; relancer `scripts/ios-sync.sh`. Pour voir ce que fait la page, le propriétaire peut ouvrir Safari > Réglages > Avancés > «&nbsp;Afficher les fonctionnalités pour les développeurs web&nbsp;» (Show features for web developers), puis le menu **Développement** (Develop) > le simulateur > EAD (les versions de débogage s'inspectent).
- L'app refuse de s'installer ou de s'ouvrir à cause de sa signature (`code signature`, `CodeSign`)&nbsp;: la compilation pour le simulateur se fait sans signature (`CODE_SIGNING_ALLOWED=NO` dans `scripts/ios-sim.sh`). Remplacer cette ligne du script par `CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO` (signature locale, sans compte), relancer, et le noter au journal.
- L'ancien écran de lancement reste affiché&nbsp;: iOS le garde en cache. `xcrun simctl uninstall booted ca.allendumaresq.ead`, puis relancer `scripts/ios-sim.sh`.
- Journaux de l'app&nbsp;: les lignes de Capacitor (`⚡️ …`) et du projet (`EAD: …`) vont sur la sortie de l'app, pas dans le journal du système. Pour les lire, relancer l'app ainsi&nbsp;: `xcrun simctl launch --console-pty --terminate-running-process booted ca.allendumaresq.ead` (la commande ne rend pas la main&nbsp;: la lancer en arrière-plan, ou l'arrêter avec Ctrl+C). Le reste (WebKit, système)&nbsp;: `xcrun simctl spawn booted log stream --predicate 'process == "App"' --level debug`.

## 6. Rendre compte

- Chaque correction est un commit sur la branche `ios-mac`, avec un message clair en anglais qui dit ce qui change et pourquoi.
- À la fin, ajouter une entrée dans «&nbsp;Journal&nbsp;» ci-dessous&nbsp;: la date, la version de macOS et d'Xcode, ce que disait `/diagnostic` et la décision prise pour `appBoundDomains`, le numéro de build envoyé, le résultat de chaque essai de 4.9, et chaque fichier changé avec la raison. Jamais de clé, de Key ID, d'Issuer ID ni de Team ID.
- Puis&nbsp;:

  ```bash
  git add docs/ios/MAC.md && git commit -m "Record the first build on the Mac"
  git push -u origin ios-mac
  ```

- Ne pas fusionner dans `main`&nbsp;: les développeurs relisent la branche.

## 7. Envoyer une mise à jour plus tard

- **Un changement du site** (écrans, textes, fonctions) n'a besoin d'aucun envoi&nbsp;: l'app affiche le site en ligne.
- **Un changement de l'app elle-même** (fichiers de `ios/`, `ios-shell/`, `capacitor.config.ts`, modules `@capacitor/…`) demande un nouvel envoi&nbsp;:
  1. Reprendre la branche `ios-mac` avec les nouveautés de `main`, exactement comme à l'étape 4.1, bloc «&nbsp;La branche&nbsp;». Elle garde ainsi les corrections des passages précédents, fusionnées ou non. Pour le journal&nbsp;: `git branch -r --merged origin/main | grep -q 'origin/ios-mac$' && echo fusionnée || echo "pas encore fusionnée"`.
  2. `npm ci`.
  3. Si la version précédente a été approuvée par Apple (publiée, ou en attente de publication, «&nbsp;Pending Developer Release&nbsp;»), monter la version&nbsp;: `const version` dans `capacitor.config.ts` et `MARKETING_VERSION` (Debug et Release) dans `ios/App/App.xcodeproj/project.pbxproj`, la même valeur aux deux endroits (par exemple `1.0.1`), puis commit. Pour un simple nouvel essai dans TestFlight avant toute approbation, garder la version&nbsp;: seul le numéro de build change, tout seul.
  4. `scripts/ios-sim.sh /diagnostic ios/App/build/ead-diagnostic.png`, deux fois, et vérifier comme en 4.5.
  5. `scripts/ios-release.sh` (il lit lui-même `~/.appstoreconnect/ead.env`).
  6. Pousser la branche et ajouter une entrée au journal, comme en section 6.
- Une version dans TestFlight expire 90 jours après son envoi&nbsp;: tant que l'app reste en TestFlight, renvoyer une version avant l'échéance (le numéro de build, noté au journal, est la date de l'envoi).
- **Apple et Xcode évoluent.** Avant un envoi, `scripts/ios-doctor.sh --envoi` ; si Apple exige un Xcode plus récent, mettre Xcode à jour et `MIN_XCODE` dans le script.

## Journal

Chaque passage sur le Mac ajoute une entrée ici, la plus récente en haut.

<!-- Modèle&nbsp;:
### AAAA-MM-JJ&nbsp;: premier essai et premier envoi
- macOS … ; Xcode …
- /diagnostic&nbsp;: dans l'app …, service worker …, modules … ; appBoundDomains = …
- Build envoyé&nbsp;: …
- Essais 4.9&nbsp;: 1 … ; 2 … ; …
- Fichiers changés&nbsp;: … (pourquoi)
-->
