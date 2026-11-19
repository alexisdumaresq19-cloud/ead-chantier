import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, QrCode } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Redirect, useParams } from "wouter";

import type { InvitePreview } from "@/shared/api";

import { api, errorMessage } from "../../lib/api";
import { enterApp, useMe } from "../../lib/session";
import { PublicLayout } from "../../shell/public-layout";
import { Button, ButtonLink, Field, FormError, Input, Spinner } from "../../ui";

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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <PublicLayout>
      <Heading title="Configurer l'application">
        Créez le premier compte du bureau. Vous inviterez ensuite votre équipe à partir de
        l&apos;application.
      </Heading>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Votre nom">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            minLength={2}
            maxLength={80}
          />
        </Field>
        <Field label="Code de démarrage" hint="Le code fourni à l'installation de l'application.">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    accept.mutate();
  };

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
    return (
      <PublicLayout>
        <Heading title="Ce lien ne fonctionne plus">{errorMessage(invite.error)}</Heading>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="secondary" block onClick={() => invite.refetch()}>
            Réessayer
          </Button>
          <ButtonLink href="/" variant="ghost" block>
            Ouvrir l&apos;application
          </ButtonLink>
        </div>
      </PublicLayout>
    );
  }

  const preview = invite.data;
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

  return (
    <PublicLayout>
      {preview.projectNumber ? (
        <p className="font-display text-ead-dark mb-1 text-xs font-semibold tracking-wider uppercase">
          Projet {preview.projectNumber}
        </p>
      ) : null}
      <Heading title={preview.projectName}>
        {preview.signedInAs
          ? `Vous êtes connecté sous le nom de ${preview.signedInAs}. Ajoutez ce projet à votre liste.`
          : "Inscrivez votre nom pour voir les plans et les documents de ce chantier."}
      </Heading>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {preview.signedInAs ? null : (
          <>
            <Field label="Prénom et nom">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                autoCapitalize="words"
                required
                minLength={2}
                maxLength={80}
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
      </form>
    </PublicLayout>
  );
}
