import type { Metadata } from "next";

import { officerNamed, phoneHref, type CompanyProfile } from "@/shared/company";
import { POLICY_VERSION, profileForPages } from "@/server/legal/profile";

import {
  Aside,
  CompanyCard,
  LegalPage,
  linkClass,
  longDate,
  Part,
  Point,
  Points,
} from "../_legal/parts";

// The privacy policy of the EAD Chantier application, on the web and in the
// iPhone app. Each sentence says what this code base does, and only that:
// the schema (src/server/db/schema.ts) for what is kept, src/server/auth.ts
// for the one cookie, src/server/signup/door.ts for the network addresses,
// src/server/dictation and src/server/ai for the assistant,
// src/server/people/delete.ts for deleting an account, vercel.json for the
// servers' region. A change to any of them may call for a change here, and a
// new POLICY_VERSION.

export const metadata: Metadata = {
  title: "Politique de confidentialité · EAD Chantier",
  description: "Ce que l'application EAD Chantier fait de vos renseignements personnels.",
};

export default async function PrivacyPage() {
  const profile = await profileForPages();
  const version = longDate(POLICY_VERSION);
  return (
    <LegalPage
      title="Politique de confidentialité"
      lead={
        <>
          <p>
            L&apos;application EAD Chantier sert aux chantiers de l&apos;entreprise {profile.name}
            &nbsp;: plans, documents, photos et rapports journaliers. Voici ce qu&apos;elle garde
            sur vous, à qui elle le montre et ce que vous pouvez demander. Cela vaut pour le site
            Web comme pour l&apos;app EAD sur iPhone.
          </p>
          <p className="mt-3 text-base">Version du {version}</p>
        </>
      }
      company={profile.name}
      other={{ href: "/soutien", label: "Aide et soutien" }}
    >
      <Part title="Qui est responsable" id="responsable">
        <p>
          L&apos;entreprise qui vous a donné accès à l&apos;application est responsable des
          renseignements qu&apos;on y met&nbsp;:
        </p>
        <CompanyCard profile={profile} />
        <Officer profile={profile} />
      </Part>

      <Part title="Ce que l'application garde, et pourquoi" id="renseignements">
        <Points>
          <Point title="Votre compte">
            Votre nom, votre rôle (bureau, contremaître ou travailleur), votre titre au travail, et
            votre numéro de cellulaire et votre courriel s&apos;ils ont été inscrits. Aussi, les
            chantiers où vous avez accès. Ils servent à vous reconnaître, à vous montrer vos
            chantiers et à vous joindre au travail.
          </Point>
          <Point title="Vos appareils connectés">
            Pour chaque appareil, son genre et son navigateur (par exemple «&nbsp;iPhone ·
            Safari&nbsp;»), la date de sa connexion et celle de sa dernière visite. Un seul témoin
            (cookie) garde l&apos;appareil connecté sans mot de passe&nbsp;; il ne sert à rien
            d&apos;autre. Vous voyez vos appareils dans Mon compte et pouvez en déconnecter un.
          </Point>
          <Point title="Ce que vous ajoutez aux chantiers">
            Les photos, les rapports journaliers, les documents et les plans, avec votre nom et la
            date. C&apos;est le travail de l&apos;entreprise, gardé pour ses dossiers de chantier.
            Une photo peut montrer des gens. Avant de garder une photo de chantier,
            l&apos;application retire ses données cachées, dont la position GPS et le modèle du
            téléphone. Les documents et les plans sont gardés tels qu&apos;envoyés, avec ce que le
            fichier contient&nbsp;: une image ajoutée comme document garde ses données cachées.
          </Point>
          <Point title="Ce que d'autres inscrivent à votre sujet">
            Dans le rapport journalier, le contremaître ou le bureau inscrit qui a travaillé ce
            jour-là et combien d&apos;heures. Ces lignes sont gardées avec le rapport, pour les
            dossiers du chantier. Les contremaîtres du chantier et le bureau les voient.
          </Point>
          <Point title="Votre voix, si vous dictez un rapport">
            L&apos;enregistrement part au service de transcription au moment où vous dictez (voir
            plus bas). L&apos;application ne le garde pas&nbsp;: elle garde seulement le texte du
            rapport que vous enregistrez.
          </Point>
          <Point title="Pour protéger l'application">
            Quand quelqu&apos;un essaie de créer un compte avec le code de l&apos;entreprise,
            l&apos;application garde une empreinte chiffrée de son adresse réseau, jamais
            l&apos;adresse elle-même, pour bloquer qui essaie trop de codes. Elle compte aussi les
            demandes de chacun à l&apos;assistant, pour en limiter le nombre. Ces traces servent
            seulement à compter les essais des deux derniers jours.
          </Point>
          <Point title="Sur votre appareil">
            Pour fonctionner sans réseau, l&apos;application garde une copie de ce que vous avez
            consulté, surtout les plans, et vos brouillons de rapport.
          </Point>
        </Points>
        <Aside>
          <p>
            L&apos;application n&apos;a <strong className="font-semibold">aucune publicité</strong>{" "}
            et <strong className="font-semibold">aucun outil de statistiques</strong> ou de suivi.
            Elle ne suit pas votre position. Elle ne vend ni ne loue aucun renseignement.
          </p>
        </Aside>
      </Part>

      <Part title="L'assistant du rapport" id="assistant">
        <p>
          Les contremaîtres et le bureau peuvent dicter le rapport journalier, faire décrire ses
          photos ou mettre son texte au propre. Pour cela, l&apos;assistant envoie à des services
          d&apos;intelligence artificielle l&apos;enregistrement de votre voix, le texte du rapport
          (dont les noms et les heures de l&apos;équipe), ses photos, votre nom et ceux des membres
          du chantier (pour bien les écrire).
        </p>
        <p>
          Ainsi, votre nom et vos heures peuvent partir à ces services quand la personne qui écrit
          le rapport utilise l&apos;assistant, après avoir elle-même accepté.
        </p>
        <p>
          <strong className="font-semibold">Rien n&apos;est envoyé avant votre accord.</strong>{" "}
          L&apos;application vous le demande la première fois que vous ouvrez l&apos;assistant. Sans
          accord, vous remplissez le rapport à la main, comme d&apos;habitude. Vous pouvez retirer
          votre accord en tout temps dans Mon compte. Si ce que l&apos;assistant envoie change,
          l&apos;application vous redemande votre accord.
        </p>
        <p>
          Les demandes passent par la passerelle d&apos;intelligence artificielle de Vercel, qui ne
          garde pas leur contenu. Elle les envoie seulement à Anthropic, qui rédige le rapport et
          décrit les photos, et à OpenAI, qui transcrit la voix. Ces services sont aux États-Unis et
          traitent les données selon leurs propres conditions.
        </p>
      </Part>

      <Part title="Qui voit vos renseignements" id="acces">
        <Points>
          <Point title="Le bureau de l'entreprise">
            Il voit les comptes, les appareils connectés et tous les chantiers.
          </Point>
          <Point title="Les gens de vos chantiers">
            Ils voient votre nom, votre rôle, votre titre et votre cellulaire, ainsi que les plans,
            documents et photos du chantier. Les rapports journaliers sont réservés aux
            contremaîtres du chantier et au bureau.
          </Point>
          <Point title="Les fournisseurs de l'application">
            Vercel héberge l&apos;application, sur des serveurs à Montréal&nbsp;; comme pour tout
            site Web, ses serveurs reçoivent l&apos;adresse réseau de votre appareil à chaque
            visite. Supabase garde la base de données et les fichiers. Anthropic et OpenAI reçoivent
            ce que l&apos;assistant envoie, seulement si vous l&apos;utilisez après avoir accepté.
            Ces fournisseurs peuvent traiter des données hors du Québec, notamment aux États-Unis.
          </Point>
        </Points>
        <p>
          Les photos et les feuilles de plans sont rangées à une adresse impossible à deviner, ce
          qui les fait s&apos;ouvrir vite, même sans réseau. Quiconque a cette adresse peut ouvrir
          la photo ou la feuille sans compte&nbsp;; elle cesse de fonctionner seulement quand la
          photo ou le plan est retiré. Le bouton d&apos;itinéraire d&apos;un chantier ouvre Google
          Maps avec l&apos;adresse du chantier, seulement si vous le touchez.
        </p>
      </Part>

      <Part title="Combien de temps" id="conservation">
        <Points>
          <Point>Votre compte et vos appareils&nbsp;: tant que votre compte existe.</Point>
          <Point>
            Ce que vous avez ajouté aux chantiers&nbsp;: il reste à l&apos;entreprise, avec votre
            nom, comme ses autres dossiers de chantier.
          </Point>
          <Point>
            L&apos;enregistrement de votre voix&nbsp;: l&apos;application ne le garde pas.
          </Point>
        </Points>
      </Part>

      <Part title="Vos droits" id="droits">
        <Points>
          <Point title="Consulter et corriger">
            Vous voyez votre compte et vos appareils dans Mon compte. Pour obtenir une copie de vos
            renseignements ou corriger une erreur (votre nom, votre titre, votre numéro),
            adressez-vous à la personne responsable nommée plus haut, ou au bureau.
          </Point>
          <Point title="Retirer votre accord">
            Dans Mon compte, à Assistant du rapport, touchez «&nbsp;Retirer mon accord&nbsp;».
            L&apos;assistant ne reçoit alors plus rien de vous. Ce qui a déjà été envoyé reste
            soumis aux conditions de ces services.
          </Point>
          <Point title="Supprimer votre compte">
            Dans l&apos;application, à Mon compte, touchez «&nbsp;Supprimer mon compte&nbsp;».
            C&apos;est immédiat&nbsp;: vos appareils sont déconnectés, et votre numéro, votre
            courriel, votre titre, vos liens d&apos;accès, vos accès aux chantiers et votre accord à
            l&apos;assistant sont effacés. Les rapports, photos, documents et plans que vous avez
            ajoutés restent à l&apos;entreprise, avec votre nom seulement. Si vous n&apos;avez rien
            ajouté, votre compte disparaît au complet. Votre nom peut rester dans l&apos;équipe
            d&apos;un rapport écrit par quelqu&apos;un d&apos;autre. Si vous ne pouvez plus entrer
            dans l&apos;application, demandez la suppression à la personne responsable.
          </Point>
        </Points>
      </Part>

      <Part title="Une question ou une plainte" id="plainte">
        <p>
          Écrivez d&apos;abord à la personne responsable de la protection des renseignements
          personnels de l&apos;entreprise (plus haut). Si sa réponse ne vous satisfait pas, vous
          pouvez porter plainte à la{" "}
          <a href="https://www.cai.gouv.qc.ca" className={linkClass}>
            Commission d&apos;accès à l&apos;information du Québec
          </a>
          .
        </p>
        <p className="text-dim text-base">
          Version du {version}. Quand cette politique change, la nouvelle version paraît sur cette
          page, avec sa date.
        </p>
      </Part>
    </LegalPage>
  );
}

/** The person responsible for personal information, or what the law says while none is named. */
function Officer({ profile }: { profile: CompanyProfile }) {
  const officer = profile.privacyOfficer;
  if (!officerNamed(officer))
    return (
      <p>
        La personne responsable de la protection des renseignements personnels n&apos;est pas encore
        nommée ici. Selon la loi, c&apos;est la personne qui a la plus haute autorité dans
        l&apos;entreprise. Joignez-la par le bureau de l&apos;entreprise.
      </p>
    );
  const reach = officer.contact
    ? { text: officer.contact, href: hrefFor(officer.contact) }
    : profile.email
      ? { text: profile.email, href: `mailto:${profile.email}` }
      : profile.phone
        ? { text: profile.phone, href: phoneHref(profile.phone) }
        : null;
  return (
    <Aside>
      <p className="text-dim text-sm font-semibold tracking-wide uppercase">
        Responsable de la protection des renseignements personnels
      </p>
      <p className="mt-1 font-semibold">
        {officer.name || officer.title}
        {officer.name && officer.title ? (
          <span className="font-normal">, {officer.title}</span>
        ) : null}
      </p>
      {reach ? (
        <p className="mt-1">
          Pour la joindre&nbsp;:{" "}
          {reach.href ? (
            <a href={reach.href} className={linkClass}>
              {reach.text}
            </a>
          ) : (
            reach.text
          )}
        </p>
      ) : (
        <p className="mt-1">Joignez-la par le bureau de l&apos;entreprise.</p>
      )}
    </Aside>
  );
}

/** A link for what the office typed: an email or a phone number; anything else is shown as text. */
function hrefFor(contact: string): string | null {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  if (/^[+(]?\d[\d\s().-]{6,}/.test(contact)) return phoneHref(contact);
  return null;
}
