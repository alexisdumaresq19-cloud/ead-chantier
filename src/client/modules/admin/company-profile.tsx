import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CircleAlert, ExternalLink, Pencil } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  COMPANY_DETAIL_LABELS,
  COMPANY_LIMITS as L,
  emailProblem,
  frenchList,
  missingDetails,
  officerProblem,
  phoneProblem,
  type CompanyProfile,
  type CompanyProfileInput,
} from "@/shared/company";

import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDay } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { Badge, Button, Card, Field, Input, Sheet, Skeleton, Textarea, toast } from "../../ui";
import { PRIVACY_PATH, SUPPORT_PATH } from "../legal/links";
import { ShownError } from "./shown-error";

// The company's public contact details, kept by the office: what the privacy
// policy and the support page show (src/app/confidentialite, src/app/soutien).
// Nothing is filled in for the office but the name: what is missing is said
// plainly, with why it matters.

const KEY = ["company-profile"] as const;

const useCompanyProfile = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<CompanyProfile>("/api/company/profile"),
    meta: { persist: false },
  });

const formOf = (profile: CompanyProfile): CompanyProfileInput => ({
  name: profile.name,
  address: profile.address,
  phone: profile.phone,
  email: profile.email,
  privacyOfficer: { ...profile.privacyOfficer },
});

export function CompanyProfileCard({ className }: { className?: string }) {
  const profile = useCompanyProfile();
  const [editing, setEditing] = useState(false);
  const data = profile.data;
  const missing = data ? missingDetails(data) : [];
  const officer = data?.privacyOfficer;

  return (
    <Card className={cn("p-4 sm:p-5", className)} role="region" aria-labelledby="company-profile">
      <div className="flex items-center gap-3">
        <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-xl">
          <Building2 className="size-5.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="company-profile" className="font-display text-lg leading-tight font-bold">
            Coordonnées de l&apos;entreprise
          </h2>
          <p className="text-dim text-sm">Montrées sur les pages publiques</p>
        </div>
        {data ? (
          missing.length > 0 ? (
            <Badge tone="warn">À compléter</Badge>
          ) : (
            <Badge tone="good">Complet</Badge>
          )
        ) : null}
      </div>

      {profile.isPending ? (
        <Skeleton className="mt-4 h-40" />
      ) : profile.isError ? (
        <div className="mt-4">
          <ShownError error={profile.error} />
        </div>
      ) : data ? (
        <>
          {missing.length > 0 ? (
            <div className="bg-warn-tint text-warn mt-4 rounded-xl px-3.5 py-3" role="status">
              <p className="flex items-start gap-2.5 text-[15px] text-pretty">
                <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">
                    Il manque {frenchList(missing.map((detail) => COMPANY_DETAIL_LABELS[detail]))}.
                  </strong>{" "}
                  La politique de confidentialité affiche ces coordonnées. Les gens s&apos;en
                  servent pour joindre l&apos;entreprise au sujet de leurs renseignements.
                </span>
              </p>
            </div>
          ) : null}

          <dl className="divide-line mt-4 divide-y text-[15px]">
            <Detail label="Nom">{data.name}</Detail>
            <Detail label="Adresse">
              {data.address ? <span className="whitespace-pre-line">{data.address}</span> : null}
            </Detail>
            <Detail label="Téléphone">{data.phone || null}</Detail>
            <Detail label="Courriel">{data.email || null}</Detail>
            <Detail label="Responsable des renseignements personnels">
              {officer?.name || officer?.title ? (
                <>
                  {officer.name || officer.title}
                  {officer.name && officer.title ? (
                    <span className="text-dim">, {officer.title}</span>
                  ) : null}
                  {officer.contact ? (
                    <span className="text-dim block">{officer.contact}</span>
                  ) : null}
                </>
              ) : null}
            </Detail>
          </dl>

          {data.updatedAt ? (
            <p className="text-dim mt-2 text-sm">
              {["Modifié", data.updatedBy ? `par ${data.updatedBy}` : null]
                .filter(Boolean)
                .join(" ")}{" "}
              le {formatDay(data.updatedAt)}.
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {missing.length > 0 ? "Compléter" : "Modifier"}
            </Button>
            <div className="-ml-1 flex flex-wrap gap-x-1">
              <PageLink href={PRIVACY_PATH}>Voir la politique</PageLink>
              <PageLink href={SUPPORT_PATH}>Voir la page de soutien</PageLink>
            </div>
          </div>
          <ProfileSheet profile={data} open={editing} onClose={() => setEditing(false)} />
        </>
      ) : null}
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="text-dim text-sm font-semibold sm:pt-px">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">
        {children ?? <span className="text-dim italic">À inscrire</span>}
      </dd>
    </div>
  );
}

function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="text-ead-dark inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}

type Problems = Partial<Record<"name" | "phone" | "email" | "officer", string>>;

function problemsOf(form: CompanyProfileInput): Problems {
  const problems: Problems = {};
  if (form.name.trim().length < 2) problems.name = "Le nom de l'entreprise est requis.";
  const phone = phoneProblem(form.phone);
  if (phone) problems.phone = phone;
  const email = emailProblem(form.email);
  if (email) problems.email = email;
  const officer = officerProblem(form.privacyOfficer);
  if (officer) problems.officer = officer;
  return problems;
}

/** Every detail in one window; saved all at once. */
function ProfileSheet({
  profile,
  open,
  onClose,
}: {
  profile: CompanyProfile;
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => formOf(profile));
  const [shown, setShown] = useState<Problems>({});
  // Each opening starts from what is saved.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(formOf(profile));
      setShown({});
    }
  }

  const save = useMutation({
    mutationFn: (input: CompanyProfileInput) =>
      api<CompanyProfile>("/api/company/profile", { method: "PUT", body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      toast.success("Coordonnées enregistrées");
      onClose();
    },
  });

  const set = (patch: Partial<CompanyProfileInput>) => setForm((now) => ({ ...now, ...patch }));
  const setOfficer = (patch: Partial<CompanyProfileInput["privacyOfficer"]>) =>
    setForm((now) => ({ ...now, privacyOfficer: { ...now.privacyOfficer, ...patch } }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems = problemsOf(form);
    setShown(problems);
    if (Object.keys(problems).length === 0) save.mutate(form);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Coordonnées de l'entreprise"
      description="Elles paraissent sur la politique de confidentialité et la page de soutien, que tout le monde peut lire."
      footer={
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={save.isPending}>
            Annuler
          </Button>
          <Button size="lg" type="submit" form="company-profile-form" loading={save.isPending}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <form id="company-profile-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Nom de l'entreprise" error={shown.name}>
          <Input
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            maxLength={L.name}
            autoComplete="organization"
            aria-invalid={Boolean(shown.name)}
          />
        </Field>
        <Field label="Adresse postale">
          <Textarea
            value={form.address}
            onChange={(event) => set({ address: event.target.value })}
            maxLength={L.address}
            rows={3}
            autoComplete="street-address"
            placeholder={"Numéro et rue\nVille (Québec)  Code postal"}
            className="resize-none"
          />
        </Field>
        <Field label="Téléphone" error={shown.phone}>
          <Input
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(event) => set({ phone: event.target.value })}
            maxLength={L.phone}
            autoComplete="tel"
            aria-invalid={Boolean(shown.phone)}
          />
        </Field>
        <Field label="Courriel" error={shown.email}>
          <Input
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(event) => set({ email: event.target.value })}
            maxLength={L.email}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(shown.email)}
          />
        </Field>

        <div
          role="group"
          aria-labelledby="company-officer"
          className="border-line space-y-4 border-t pt-4"
        >
          <div>
            <p id="company-officer" className="font-display text-base leading-tight font-bold">
              Responsable de la protection des renseignements personnels
            </p>
            <p className="text-dim mt-1 text-sm text-pretty">
              La loi confie ce rôle à la personne qui a la plus haute autorité dans
              l&apos;entreprise. Elle peut le déléguer par écrit à quelqu&apos;un d&apos;autre.
            </p>
          </div>
          <Field label="Nom" optional>
            <Input
              value={form.privacyOfficer.name}
              onChange={(event) => setOfficer({ name: event.target.value })}
              maxLength={L.officerName}
              autoComplete="off"
            />
          </Field>
          <Field label="Titre" optional error={shown.officer}>
            <Input
              value={form.privacyOfficer.title}
              onChange={(event) => setOfficer({ title: event.target.value })}
              maxLength={L.officerTitle}
              autoComplete="off"
              aria-invalid={Boolean(shown.officer)}
            />
          </Field>
          <Field
            label="Pour la joindre"
            optional
            hint="Un courriel ou un numéro, s'ils diffèrent de ceux de l'entreprise."
          >
            <Input
              value={form.privacyOfficer.contact}
              onChange={(event) => setOfficer({ contact: event.target.value })}
              maxLength={L.officerContact}
              autoComplete="off"
            />
          </Field>
        </div>
        <ShownError error={save.error} />
      </form>
    </Sheet>
  );
}
