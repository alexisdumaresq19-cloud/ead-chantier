import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, QrCode } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Redirect, useParams } from "wouter";

import type { InvitePreview } from "@/shared/api";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { enterApp, signOut, useMe } from "../../lib/session";
import { PublicLayout } from "../../shell/public-layout";
import { Button, ButtonLink, Field, FormError, Input, Spinner } from "../../ui";

/** What a name needs before it is sent: the server asks for two letters at least. */
const NAME_MISSING = "Inscrivez votre prénom et votre nom.";
const nameMissing = (name: string) => name.trim().length < 2;

/** Puts the cursor in the field that needs something, with its message under it. */
function focusField(event: FormEvent<HTMLFormElement>, name: string) {
  const field = event.currentTarget.elements.namedItem(name);
  if (field instanceof HTMLElement) field.focus();
}

// The screens seen before signing in. Nobody has a password: a person comes
// in with the personal link the office sent, or with a site's QR code.

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-2xl leading-tight font-bold tracking-tight text-balance">
        {title}
      </h1>
      {children ? <div className="text-dim mt-2 text-[15px] text-pretty">{children}</div> : null}
    </>
  );
}

export function WelcomeScreen() {
  const me = useMe();
  const setup = useQuery({
    queryKey: ["setup"],
    queryFn: () => api<{ needed: boolean }>("/api/setup"),
    meta: { persist: false },
  });
  if (me.data) return <Redirect to="/" replace />;

  return (
    <PublicLayout>
      <Heading title="Bienvenue">
        Les plans, les documents, les photos et les rapports de vos chantiers, au même endroit.
      </Heading>
      <ul className="mt-6 space-y-4">
        <Way icon={<QrCode aria-hidden />} title="Au chantier">
          Scannez le code QR de votre contremaître avec l&apos;appareil photo de votre téléphone.
        </Way>
        <Way icon={<Link2 aria-hidden />} title="Par lien personnel">
          Ouvrez le lien que le bureau vous a envoyé par texto ou par courriel.
        </Way>
      </ul>
      <p className="border-line text-dim mt-6 border-t pt-4 text-sm">
        Nouveau téléphone ou lien expiré? Demandez un nouveau lien au bureau.
      </p>
      {setup.data?.needed ? (
        <div className="mt-5">
          <ButtonLink href="/demarrer" variant="secondary" block>
            Première utilisation&nbsp;: configurer l&apos;application
          </ButtonLink>
        </div>
      ) : null}
    </PublicLayout>
  );
}

function Way({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6">
        {icon}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-dim mt-0.5 text-sm text-pretty">{children}</p>
      </div>
    </li>
  );
}

/** Creates the office's first account, once, with the code set at installation. */
export function SetupScreen() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState(false);
  const setup = useQuery({
    queryKey: ["setup"],
    queryFn: () => api<{ needed: boolean }>("/api/setup"),
    meta: { persist: false },
  });
  const create = useMutation({
    mutationFn: () => api("/api/setup", { method: "POST", body: { name, code } }),
    onSuccess: () => enterApp("/"),
  });

  if (setup.data && !setup.data.needed && !create.isSuccess && !create.isPending) {
    return (
      <PublicLayout>
        <Heading title="L'application est déjà configurée">
          Pour entrer, utilisez votre lien personnel ou le code QR d&apos;un chantier.
        </Heading>
        <div className="mt-6">
          <ButtonLink href="/bienvenue" block>
            Retour
          </ButtonLink>
        </div>
      </PublicLayout>
    );
  }

  const nameError = checked && nameMissing(name) ? "Inscrivez votre nom." : null;
  const codeError = checked && !code.trim() ? "Inscrivez le code de démarrage." : null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (nameMissing(name)) return focusField(event, "name");
    if (!code.trim()) return focusField(event, "code");
    create.mutate();
  };
  return (
    <PublicLayout>
      <Heading title="Configurer l'application">
        Créez le premier compte du bureau. Vous inviterez ensuite votre équipe à partir de
        l&apos;application.
      </Heading>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <Field label="Votre nom" error={nameError}>
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={80}
            aria-invalid={Boolean(nameError) || undefined}
          />
        </Field>
        <Field
          label="Code de démarrage"
          hint="Le code fourni à l'installation de l'application."
          error={codeError}
        >
          <Input
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(codeError) || undefined}
          />
        </Field>
        <FormError>{create.isError ? errorMessage(create.error) : null}</FormError>
        <Button type="submit" size="lg" block loading={create.isPending || create.isSuccess}>
          Créer mon compte
        </Button>
      </form>
    </PublicLayout>
  );
}

/** What a personal link (/i/…) or a site QR code (/j/…) opens. */
export function InviteScreen() {
  const { token } = useParams<{ token: string }>();
  const me = useMe();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [checked, setChecked] = useState(false);
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<InvitePreview>(`/api/invites/${token}`),
    meta: { persist: false },
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      api<{ projectId?: string }>(`/api/invites/${token}`, {
        method: "POST",
        body: { name: name.trim() || undefined, phone: phone.trim() || undefined },
      }),
    onSuccess: (result) => enterApp(result.projectId ? `/projets/${result.projectId}` : "/"),
  });
  const busy = accept.isPending || accept.isSuccess;
  // Only a site's code asks for a name, and only of someone not signed in.
  const asksName = invite.data?.kind === "project" && !invite.data.signedInAs;
  const nameError = asksName && checked && nameMissing(name) ? NAME_MISSING : null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (asksName && nameMissing(name)) return focusField(event, "name");
    accept.mutate();
  };
  // Signing out comes back to this same link, which then offers to enter.
  const leave = useMutation({ mutationFn: () => signOut(window.location.pathname) });

  if (invite.isPending) {
    return (
      <PublicLayout>
        <div className="flex justify-center py-10">
          <Spinner className="size-8" />
        </div>
      </PublicLayout>
    );
  }
  if (invite.isError) {
    const failure = invite.error instanceof ApiFailure ? invite.error : null;
    // A link the server refused stays refused: trying again is only offered
    // when the answer did not come (no network, a server error).
    const dead = failure !== null && failure.status === 410;
    const full = failure?.code === "invite_full";
    // A site's code (/j/…) and a personal link (/i/…) are not asked for again
    // from the same person: each says whom to ask.
    const siteCode = window.location.pathname.startsWith("/j/");
    const [title, text] = failure?.offline
      ? [
          "Pas de réseau",
          "Ce lien a besoin du réseau pour s'ouvrir. Réessayez quand la connexion revient.",
        ]
      : full
        ? ["Ce code QR est complet", errorMessage(invite.error)]
        : dead && siteCode
          ? [
              "Ce code QR ne fonctionne plus",
              "Demandez à votre contremaître d'afficher le code de la semaine.",
            ]
          : dead
            ? [
                "Ce lien ne fonctionne plus",
                "Il a déjà servi ou il a expiré. Demandez un nouveau lien au bureau.",
              ]
            : ["Ce lien n'a pas pu s'ouvrir", errorMessage(invite.error)];
    // The app only opens for a device that is signed in; anyone else learns the ways in.
    const signedIn = Boolean(me.data);
    return (
      <PublicLayout>
        <Heading title={title}>{text}</Heading>
        <div className="mt-6 flex flex-col gap-2">
          {dead ? null : (
            <Button size="lg" block loading={invite.isFetching} onClick={() => invite.refetch()}>
              Réessayer
            </Button>
          )}
          {signedIn ? (
            <ButtonLink href="/" variant={dead ? "primary" : "ghost"} size="lg" block>
              Ouvrir l&apos;application
            </ButtonLink>
          ) : (
            <ButtonLink href="/bienvenue" variant={dead ? "secondary" : "ghost"} size="lg" block>
              Comment entrer?
            </ButtonLink>
          )}
        </div>
      </PublicLayout>
    );
  }

  const preview = invite.data;
  if (preview.kind === "personal" && preview.signedInAs) {
    // Someone else's link on a device in use: its owner decides, knowingly.
    // Staying is the large button: nobody has a password, so whoever signs
    // out needs a new link from the office to come back.
    return (
      <PublicLayout>
        <Heading title="Cet appareil est déjà connecté">
          Il est connecté sous le nom de {preview.signedInAs}. Ce lien est celui de {preview.name}.
        </Heading>
        <div className="mt-6">
          <ButtonLink href="/" size="lg" block>
            Ouvrir l&apos;application
          </ButtonLink>
        </div>
        <p className="border-line text-dim mt-6 border-t pt-4 text-sm text-pretty">
          Pour entrer avec ce lien, déconnectez d&apos;abord cet appareil. Pour revenir ensuite sous
          le nom de {preview.signedInAs}, il faudra un nouveau lien du bureau.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <FormError>{leave.isError ? errorMessage(leave.error) : null}</FormError>
          <Button
            variant="secondary"
            block
            loading={leave.isPending || leave.isSuccess}
            onClick={() => leave.mutate()}
          >
            Se déconnecter de cet appareil
          </Button>
        </div>
      </PublicLayout>
    );
  }
  if (preview.kind === "personal") {
    return (
      <PublicLayout>
        <Heading title={`Bonjour ${preview.name}`}>
          Ce lien ouvre l&apos;application sur cet appareil. Vous y resterez connecté, sans mot de
          passe.
        </Heading>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <FormError>{accept.isError ? errorMessage(accept.error) : null}</FormError>
          <Button type="submit" size="lg" block loading={busy}>
            Entrer
          </Button>
          <p className="text-dim text-center text-sm">
            Le lien sert une seule fois. Ne le partagez pas.
          </p>
        </form>
      </PublicLayout>
    );
  }

  const projectNumber = preview.projectNumber ? (
    <p className="font-display text-ead-dark mb-1 text-xs font-semibold tracking-wider uppercase">
      Projet {preview.projectNumber}
    </p>
  ) : null;
  if (preview.access !== "join") {
    // Signed in, and the code has nothing to give: the office and the
    // project's own people already have access, and a foreman of another
    // project is put on this one by the office, never by a code.
    return (
      <PublicLayout>
        {projectNumber}
        <Heading title={preview.projectName}>
          {preview.access === "open"
            ? `Vous êtes connecté sous le nom de ${preview.signedInAs}. Vous avez déjà accès à ce projet.`
            : `Vous êtes connecté sous le nom de ${preview.signedInAs}. Le code QR sert aux travailleurs. Demandez au bureau de vous ajouter à ce projet.`}
        </Heading>
        <div className="mt-6">
          {preview.access === "open" ? (
            <ButtonLink href={`/projets/${preview.projectId}`} size="lg" block>
              Ouvrir le projet
            </ButtonLink>
          ) : (
            <ButtonLink href="/" size="lg" block>
              Ouvrir l&apos;application
            </ButtonLink>
          )}
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      {projectNumber}
      <Heading title={preview.projectName}>
        {preview.signedInAs
          ? `Vous êtes connecté sous le nom de ${preview.signedInAs}. Ajoutez ce projet à votre liste.`
          : "Inscrivez votre nom pour voir les plans et les documents de ce chantier."}
      </Heading>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        {preview.signedInAs ? null : (
          <>
            <Field label="Prénom et nom" error={nameError}>
              <Input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                autoCapitalize="words"
                maxLength={80}
                aria-invalid={Boolean(nameError) || undefined}
              />
            </Field>
            <Field label="Cellulaire" optional>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={30}
              />
            </Field>
          </>
        )}
        <FormError>{accept.isError ? errorMessage(accept.error) : null}</FormError>
        <Button type="submit" size="lg" block loading={busy}>
          {preview.signedInAs ? "Ajouter le projet" : "Entrer sur le chantier"}
        </Button>
        {preview.signedInAs ? (
          <ButtonLink href="/" variant="ghost" block>
            Ouvrir l&apos;application
          </ButtonLink>
        ) : null}
      </form>
    </PublicLayout>
  );
}
