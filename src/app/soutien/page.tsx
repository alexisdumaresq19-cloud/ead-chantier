/* eslint-disable @next/next/no-html-link-for-pages -- "/" is the app's own page: it opens with a full load, as a fresh visit would */
import type { Metadata } from "next";
import { headers } from "next/headers";

import { phoneHref, type CompanyProfile } from "@/shared/company";
import { profileForPages } from "@/server/legal/profile";

import { Aside, LegalPage, linkClass, Part, Point, Points } from "../_legal/parts";

// The help page: how to get in, where to get the app, which devices work,
// how to delete one's account, and whom to ask. Public, like the policy.

export const metadata: Metadata = {
  title: "Aide et soutien · EAD Chantier",
  description: "Comment entrer dans l'application EAD Chantier, et qui joindre pour de l'aide.",
};

/** The address the person reached this page at: the same one opens the app. */
async function siteAddress(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "ead-chantier.vercel.app";
  return host.split(",")[0].trim();
}

export default async function SupportPage() {
  const [profile, host] = await Promise.all([profileForPages(), siteAddress()]);
  return (
    <LegalPage
      title="Aide et soutien"
      lead={
        <p>
          EAD Chantier rassemble les plans, les documents, les photos et les rapports journaliers
          des chantiers de {profile.name}. Voici comment y entrer et qui joindre au besoin.
        </p>
      }
      other={{ href: "/confidentialite", label: "Politique de confidentialité" }}
    >
      <Part title="Entrer dans l'application" id="entrer">
        <p>Il n&apos;y a pas de mot de passe. Il y a quatre façons d&apos;entrer&nbsp;:</p>
        <Points>
          <Point title="Avec le code de l'entreprise">
            Touchez «&nbsp;Créer mon compte&nbsp;», puis inscrivez le code que le bureau vous a
            donné, votre nom et votre cellulaire. Le bureau vous ajoute ensuite à vos chantiers.
          </Point>
          <Point title="Avec un lien personnel">
            Le bureau vous envoie un lien par texto ou par courriel. Ouvrez-le sur votre téléphone
            et vous êtes connecté. Un lien sert une seule fois&nbsp;: pour un autre appareil,
            demandez-en un nouveau.
          </Point>
          <Point title="Avec un code à taper">
            Dans l&apos;app, touchez «&nbsp;J&apos;ai déjà un compte&nbsp;» et inscrivez votre
            cellulaire et le code que le bureau vous a donné.
          </Point>
          <Point title="Avec le code QR d'un chantier">
            Visez le code QR affiché au chantier avec l&apos;appareil photo du téléphone. Vous
            entrez dans ce chantier, et le contremaître ou le bureau confirme votre accès.
          </Point>
        </Points>
        <p>
          Une fois connecté, l&apos;appareil le reste. Vous pouvez déconnecter un appareil perdu
          dans Mon compte.
        </p>
      </Part>

      <Part title="Obtenir l'application" id="obtenir">
        <Points>
          <Point title="Sur iPhone">
            Installez l&apos;app <strong className="font-semibold">EAD</strong> à partir de
            l&apos;App Store.
          </Point>
          <Point title="Sur tout autre appareil">
            Ouvrez{" "}
            <a href="/" className={linkClass}>
              {host}
            </a>{" "}
            dans le navigateur. Sur un téléphone, ajoutez-la à l&apos;écran d&apos;accueil pour
            l&apos;ouvrir comme une app.
          </Point>
        </Points>
      </Part>

      <Part title="Appareils qui fonctionnent" id="appareils">
        <Points>
          <Point>Un iPhone avec iOS 15 ou plus récent, pour l&apos;app EAD.</Point>
          <Point>
            Un navigateur récent (Safari, Chrome, Edge ou Firefox) sur un téléphone, une tablette ou
            un ordinateur.
          </Point>
        </Points>
        <p>
          Les plans déjà ouverts, ou gardés sur l&apos;appareil, restent lisibles sans réseau. La
          dictée du rapport demande du réseau.
        </p>
      </Part>

      <Part title="Supprimer votre compte" id="supprimer">
        <p>
          Dans l&apos;application, allez à Mon compte et touchez «&nbsp;Supprimer mon compte&nbsp;».
          C&apos;est immédiat. Ce que vous avez ajouté aux chantiers reste à l&apos;entreprise, avec
          votre nom. Le détail est dans la{" "}
          <a href="/confidentialite#droits" className={linkClass}>
            politique de confidentialité
          </a>
          .
        </p>
      </Part>

      <Part title="Nous joindre" id="joindre">
        <Contact profile={profile} />
        <p>
          Pour vos renseignements personnels, lisez la{" "}
          <a href="/confidentialite" className={linkClass}>
            politique de confidentialité
          </a>
          .
        </p>
      </Part>
    </LegalPage>
  );
}

function Contact({ profile }: { profile: CompanyProfile }) {
  if (!profile.phone && !profile.email)
    return (
      <p>
        Pour de l&apos;aide, adressez-vous au bureau de votre entreprise. Il peut vous envoyer un
        nouveau lien, corriger votre nom ou vous ajouter à un chantier.
      </p>
    );
  return (
    <Aside>
      <p className="font-display text-lg font-bold">{profile.name}</p>
      <p className="text-dim mt-0.5">
        Le bureau peut vous envoyer un nouveau lien, corriger votre nom ou vous ajouter à un
        chantier.
      </p>
      <p className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
        {profile.phone ? (
          <span>
            Téléphone&nbsp;:{" "}
            <a href={phoneHref(profile.phone)} className={linkClass}>
              {profile.phone}
            </a>
          </span>
        ) : null}
        {profile.email ? (
          <span>
            Courriel&nbsp;:{" "}
            <a href={`mailto:${profile.email}`} className={linkClass}>
              {profile.email}
            </a>
          </span>
        ) : null}
      </p>
    </Aside>
  );
}
