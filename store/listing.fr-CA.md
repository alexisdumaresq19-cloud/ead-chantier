# Fiche App Store (français, Canada)

Tout ce qui se colle dans App Store Connect pour la version 1.0, champ par champ. Le texte à coller est dans les cadres gris&nbsp;: copiez-le tel quel. À côté de chaque champ, sa longueur et la limite d'Apple (comptées en caractères).

Les textes à coller n'ont volontairement aucun deux-points, sauf dans l'adresse web&nbsp;: App Store Connect ne garde pas l'espace insécable qui doit le précéder en français.

## À vérifier avant de coller

Ces phrases décrivent des fonctions qui étaient en construction quand cette fiche a été écrite. Avant de coller, ouvrez l'app finale (le build envoyé à Apple) et vérifiez chacune. Si une fonction manque, retirez sa phrase&nbsp;: la fiche ne doit promettre que ce que l'app fait (règle 2.3 d'Apple). Chacune porte la marque `<!-- verify at integration -->` dans ce fichier.

1. Texte promotionnel, «&nbsp;même sans réseau&nbsp;»&nbsp;: les plans gardés s'ouvrent en mode avion dans l'app iPhone.
2. Description, «&nbsp;par un code&nbsp;»&nbsp;: l'entrée avec le cellulaire et un code du bureau existe.
3. Description, «&nbsp;Gardez un projet sur l'appareil…&nbsp;»&nbsp;: même vérification que le point 1.
4. Description, «&nbsp;L'assistant demande votre accord…&nbsp;»&nbsp;: l'étape d'accord paraît avant le premier envoi.
5. Description, «&nbsp;Ouvrez un document sur le téléphone ou envoyez-le…&nbsp;»&nbsp;: le visualiseur et le partage d'iOS s'ouvrent.
6. Description, dernière ligne, et la section «&nbsp;Adresses&nbsp;»&nbsp;: les pages /soutien et /confidentialite répondent en production.

Les balises `<!-- … -->` restent en dehors des cadres gris&nbsp;: elles ne se collent pas.

## Nom de l'app

```text
EAD
```

3 caractères sur 30.

La disponibilité du nom ne peut pas être vérifiée d'ici&nbsp;: App Store Connect le dit seulement au moment de créer l'app. Si «&nbsp;EAD&nbsp;» est déjà pris, essayez dans cet ordre&nbsp;:

1. `EAD Chantier` (12 caractères), le nom que l'application porte déjà sur le web.
2. `Chantier EAD` (12 caractères).

Sous l'icône du téléphone, l'app s'appelle «&nbsp;EAD&nbsp;» dans tous les cas&nbsp;: ce nom-là vient du projet Xcode.

## Sous-titre

```text
Plans et rapports de chantier
```

29 caractères sur 30.

## Texte promotionnel

```text
Les plans s'ouvrent vite au chantier, même sans réseau. Le rapport du jour se dicte en quelques phrases. Chaque photo va au bon projet, à la bonne date.
```

<!-- verify at integration: plans offline inside the iPhone app -->

152 caractères sur 170. Ce texte peut changer en tout temps, sans nouvelle version.

## Description

```text
EAD est l'application de chantier de l'équipe des Entreprises Allen Dumaresq. Le bureau, les contremaîtres et les travailleurs y trouvent les plans, les documents, les photos et les rapports journaliers de chaque projet.

Le compte vient de l'entreprise. Le bureau vous donne votre accès par un lien personnel, par un code ou par le code QR du chantier. Sans compte de l'entreprise, l'application ne montre aucun projet.

PLANS
• Les feuilles s'ouvrent sur le téléphone et se zooment du bout des doigts jusqu'au détail.
• La révision en vigueur s'affiche d'abord. Les révisions précédentes restent consultables.
• Cherchez une feuille par son numéro ou son titre.
• Gardez un projet sur l'appareil et ses plans s'ouvrent au chantier, même sans réseau.

PHOTOS
• Prenez une photo à partir de n'importe quel projet. Elle est classée par jour, avec l'heure.
• Ajoutez une description. Dans le rapport, l'assistant peut en proposer une.
• Une photo prise sans réseau attend sur le téléphone et part quand le réseau revient.

RAPPORT JOURNALIER (contremaîtres et bureau)
• Météo, équipe et heures, équipement, travaux réalisés, notes et photos de la journée.
• Racontez votre journée à voix haute et l'assistant remplit le rapport. Vous relisez, puis vous enregistrez.
• L'assistant demande votre accord avant d'envoyer votre voix, votre texte ou vos photos à un service d'intelligence artificielle.
• Le rapport se partage en PDF, avec le logo de l'entreprise et les photos, par texto ou par courriel.

DOCUMENTS
• Contrat et devis, permis, santé et sécurité, fiches techniques, échéancier, essais. Chaque document est classé dans sa catégorie.
• Ouvrez un document sur le téléphone ou envoyez-le à une autre application.

ÉQUIPE
• Le bureau crée les projets et choisit qui y a accès.
• Le contremaître fait entrer ses travailleurs avec le code QR du chantier.
• Les contremaîtres et les travailleurs voient les projets dont ils font partie. Les rapports journaliers sont réservés aux contremaîtres et au bureau.

Besoin d'un compte ou d'aide? Adressez-vous au bureau d'EAD ou visitez https://ead-chantier.vercel.app/soutien
```

<!-- verify at integration: code sign-in (paragraph 2), plans offline, the assistant's agreement step, native viewer and share sheet, /soutien live (see "À vérifier avant de coller") -->

2120 caractères sur 4000.

## Mots-clés

```text
contremaître,génie civil,construction,dessins,feuilles,photos,documents,dictée,hors ligne,équipe
```

96 caractères sur 100 (100 octets, donc accepté même si Apple compte les accents en double). Virgules sans espace. Les mots du nom et du sous-titre (EAD, plans, rapports, chantier) n'y sont pas&nbsp;: Apple les cherche déjà. Une app non répertoriée n'apparaît pas dans les recherches de l'App Store&nbsp;; le champ reste obligatoire.

## Catégories

- Catégorie principale&nbsp;: **Économie et entreprise** (Business)
- Catégorie secondaire&nbsp;: **Productivité** (Productivity)

## Droits d'auteur (Copyright)

Format demandé par Apple&nbsp;: l'année, puis le nom exact du titulaire des droits, sans URL.

```text
2026 Les Entreprises Allen Dumaresq
```

35 caractères. Si la raison sociale enregistrée porte une forme juridique (par exemple «&nbsp;inc.&nbsp;»), ajoutez-la telle qu'elle est enregistrée. Apple ajoute le symbole © lui-même.

## Adresses

| Champ                                                | Adresse                                         |
| ---------------------------------------------------- | ----------------------------------------------- |
| URL d'assistance (Support URL)                       | https://ead-chantier.vercel.app/soutien         |
| URL de la politique de confidentialité (Privacy URL) | https://ead-chantier.vercel.app/confidentialite |
| URL marketing (facultative)                          | à laisser vide                                  |

<!-- verify at integration: both pages answer in production before submitting -->

## Cote d'âge (questionnaire)

Les catégories et les questions ci-dessous suivent la page de référence d'Apple «&nbsp;Age ratings values and definitions&nbsp;» (developer.apple.com, lue le 20 novembre 2026). Les libellés français d'App Store Connect peuvent différer un peu&nbsp;: le libellé anglais est entre parenthèses. Résultat attendu&nbsp;: **4+**.

| Section                                       | Question                                                                    | Réponse |
| --------------------------------------------- | --------------------------------------------------------------------------- | ------- |
| Contrôles dans l'app (In-App Controls)        | Contrôle parental (Parental Controls)                                       | Non     |
| Contrôles dans l'app                          | Vérification de l'âge (Age Assurance)                                       | Non     |
| Fonctions (Capabilities)                      | Accès Web sans restriction (Unrestricted Web Access)                        | Non     |
| Fonctions                                     | Contenu généré par les utilisateurs (User-Generated Content)                | Non     |
| Fonctions                                     | Réseau social (Social Media)                                                | Non     |
| Fonctions                                     | Messagerie et clavardage (Messaging and Chat)                               | Non     |
| Fonctions                                     | Partage de la position (Shared Location)                                    | Non     |
| Fonctions                                     | Publicité (Advertising)                                                     | Non     |
| Thèmes pour adultes (Mature Themes)           | Grossièretés ou humour cru (Profanity or Crude Humor)                       | Aucun   |
| Thèmes pour adultes                           | Horreur ou peur (Horror/Fear Themes)                                        | Aucun   |
| Thèmes pour adultes                           | Alcool, tabac ou drogues (Alcohol, Tobacco, or Drug Use or References)      | Aucun   |
| Thèmes pour adultes                           | Rencontres (Dating and Relationships)                                       | Non     |
| Médical ou bien-être (Medical or Wellness)    | Information médicale ou traitement (Medical or Treatment Information)       | Aucun   |
| Médical ou bien-être                          | Santé ou bien-être (Health or Wellness Topics)                              | Aucun   |
| Sexualité ou nudité (Sexuality or Nudity)     | Thèmes suggestifs, contenu sexuel, nudité (les trois questions)             | Aucun   |
| Violence                                      | Violence de dessin animé, réaliste, prolongée, armes (les quatre questions) | Aucun   |
| Activités de hasard (Chance-Based Activities) | Jeux d'argent, jeux de hasard simulés, concours, coffres à butin            | Aucun   |

Contenu généré par les utilisateurs&nbsp;: Apple le définit comme la diffusion **large** de contenu créé par les utilisateurs. Dans EAD, les photos, rapports et documents restent dans l'équipe d'une seule entreprise, sur des comptes que l'entreprise donne&nbsp;; rien n'est public et personne ne peut écrire à un inconnu. D'où «&nbsp;Non&nbsp;». Selon le même tableau d'Apple, un «&nbsp;Oui&nbsp;» à cette question donnerait quand même 4+. Vérifiez la cote affichée à la fin&nbsp;: elle doit être 4+.

Apple demande aussi si l'app est conçue pour les enfants&nbsp;: **Non**.

## Nouveautés de la version 1.0

```text
Première version de l'application EAD pour iPhone. Les plans, les documents, les photos et les rapports journaliers des chantiers d'EAD, sur votre téléphone.
```

157 caractères sur 4000. Pour une toute première version, App Store Connect n'affiche souvent pas ce champ&nbsp;; gardez alors ce texte pour la version suivante.

## Confidentialité de l'app (questionnaire sur les données)

Ces réponses décrivent ce que l'application garde aujourd'hui. Elles doivent dire la même chose que la page https://ead-chantier.vercel.app/confidentialite. <!-- verify at integration: same facts as the privacy page -->

- Suivi (tracking) d'une app à l'autre&nbsp;: **Non**. Aucune publicité, aucun outil de mesure d'audience.
- Données collectées, toutes **liées à la personne**, pour les **fonctionnalités de l'app** seulement&nbsp;:

| Type de données (libellé d'Apple)           | Ce que c'est dans EAD                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Coordonnées → Nom                           | Le nom de la personne, vu par son équipe                                                    |
| Coordonnées → Numéro de téléphone           | Le cellulaire, pour entrer avec un code du bureau et pour que l'équipe joigne la personne   |
| Coordonnées → Adresse courriel              | Seulement si le bureau l'inscrit                                                            |
| Contenu utilisateur → Photos ou vidéos      | Les photos de chantier (sans leur position GPS&nbsp;: l'app ne la garde pas)                |
| Contenu utilisateur → Données audio         | La dictée du rapport, envoyée au service d'intelligence artificielle, jamais gardée par EAD |
| Contenu utilisateur → Autre contenu         | Les rapports journaliers, les descriptions de photos, les documents ajoutés                 |
| Identifiants → Identifiant de l'utilisateur | Le numéro interne du compte                                                                 |

- Non collectées&nbsp;: localisation, contacts du téléphone, historique de navigation, données de santé, achats, diagnostics.
