import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "wouter";

import {
  canadianPhone,
  codeDigits,
  COMPANY_CODE_LENGTH,
  PHONE_HINT,
  type SignupInput,
  type SignupStatus,
} from "@/shared/signup";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { enterApp, useMe } from "../../lib/session";
import { PublicLayout } from "../../shell/public-layout";
import { Button, ButtonLink, Field, FormError, Input, Spinner } from "../../ui";
import { focusNamed, Heading, NAME_MISSING, nameMissing } from "./parts";

// A newcomer makes their own account with the code the office gave them
// (/inscription, or /inscription?code=… from the office's link or QR code).
// They come in as a worker, on no project; the office then adds them to
// their sites.

type FieldName = "name" | "phone" | "code";

/** "4827 1936" as it is typed: the digits, in two groups of four. */
const shownCode = (typed: string) => {
  const digits = codeDigits(typed).slice(0, COMPANY_CODE_LENGTH);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
};

const CODE_MISSING = `Inscrivez les ${COMPANY_CODE_LENGTH} chiffres du code que le bureau vous a donné.`;
const PHONE_WRONG = `Vérifiez le numéro\u00a0: ${PHONE_HINT}`;

/** What is wrong before anything is sent, field by field. */
function problems(form: SignupInput): Partial<Record<FieldName, string>> {
  return {
    name: nameMissing(form.name) ? NAME_MISSING : undefined,
    phone: !form.phone.trim()
      ? "Inscrivez votre numéro de cellulaire."
      : canadianPhone(form.phone)
        ? undefined
        : PHONE_WRONG,
    code: codeDigits(form.code).length === COMPANY_CODE_LENGTH ? undefined : CODE_MISSING,
  };
}

/** The field the server's refusal is about, if it is about one. */
const FIELD_OF: Record<string, FieldName> = {
  bad_name: "name",
  bad_phone: "phone",
  phone_taken: "phone",
  bad_code: "code",
  wrong_code: "code",
};

export function SignUpScreen() {
  const me = useMe();
  const [params] = useSearchParams();
  const fromLink = shownCode(params.get("code") ?? "");
  const status = useQuery({
    queryKey: ["signup"],
    queryFn: () => api<SignupStatus>("/api/signup"),
    refetchOnMount: "always",
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<SignupInput>({ name: "", phone: "", code: fromLink });
  const [checked, setChecked] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api("/api/signup", { method: "POST", body: { ...form, code: codeDigits(form.code) } }),
    onSuccess: () => enterApp("/"),
    onError: (error) => {
      const field = error instanceof ApiFailure ? FIELD_OF[error.code] : undefined;
      if (field) focusNamed(formRef.current, field);
      // Someone signed in meanwhile, in another tab: the screen says so.
      if (error instanceof ApiFailure && error.code === "signed_in") void me.refetch();
    },
  });
  const busy = create.isPending || create.isSuccess;

  if (me.data && !busy) {
    // Never a second account behind someone's back.
    return (
      <PublicLayout>
        <Heading title="Cet appareil est déjà connecté">
          Il est connecté sous le nom de {me.data.name}. Votre compte est déjà prêt.
        </Heading>
        <div className="mt-6">
          <ButtonLink href="/" size="lg" block>
            Ouvrir l&apos;application
          </ButtonLink>
        </div>
      </PublicLayout>
    );
  }
  if (status.isPending || me.isPending) {
    return (
      <PublicLayout>
        <div className="flex justify-center py-10" role="status" aria-label="Chargement">
          <Spinner className="size-8" />
        </div>
      </PublicLayout>
    );
  }
  if (status.data && !status.data.open && !busy) {
    return (
      <PublicLayout>
        <Heading title="La création de comptes est fermée">
          Demandez au bureau un lien pour entrer, ou scannez le code QR de votre contremaître au
          chantier.
        </Heading>
        <div className="mt-6">
          <ButtonLink href="/bienvenue" variant="secondary" size="lg" block>
            Comment entrer?
          </ButtonLink>
        </div>
      </PublicLayout>
    );
  }

  const shown = checked ? problems(form) : {};
  const refusal = create.error instanceof ApiFailure ? create.error : null;
  const refusedField = refusal ? FIELD_OF[refusal.code] : undefined;
  const errorOf = (field: FieldName) =>
    shown[field] ?? (refusedField === field ? refusal?.message : undefined) ?? null;
  const change = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    // What the server said about a field goes once the field changes.
    if (refusedField === field) create.reset();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    const found = problems(form);
    const first = (["name", "phone", "code"] as const).find((field) => found[field]);
    if (first) return focusNamed(event.currentTarget, first);
    create.mutate();
  };

  return (
    <PublicLayout compact>
      <Link
        href="/bienvenue"
        className="text-ead-dark hover:bg-ead-tint -mt-2 mb-2 -ml-2 inline-flex h-11 items-center gap-0.5 rounded-lg pr-2.5 text-sm font-semibold"
      >
        <ChevronLeft className="size-5" aria-hidden /> Retour
      </Link>
      <Heading title="Créer mon compte">
        Avec le code que le bureau vous a donné. Le bureau vous ajoutera ensuite à vos chantiers.
      </Heading>
      <form ref={formRef} onSubmit={submit} noValidate className="mt-6 space-y-4">
        <Field label="Prénom et nom" error={errorOf("name")}>
          <Input
            name="name"
            value={form.name}
            onChange={(event) => change("name", event.target.value)}
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={80}
            aria-invalid={Boolean(errorOf("name")) || undefined}
          />
        </Field>
        <Field label="Cellulaire" hint={PHONE_HINT} error={errorOf("phone")}>
          <Input
            name="phone"
            value={form.phone}
            onChange={(event) => change("phone", event.target.value)}
            // Shown the way it is kept, once typed.
            onBlur={() => {
              const phone = canadianPhone(form.phone);
              if (phone && phone !== form.phone) setForm((current) => ({ ...current, phone }));
            }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="next"
            maxLength={30}
            aria-invalid={Boolean(errorOf("phone")) || undefined}
          />
        </Field>
        <Field
          label="Code d'entreprise"
          hint={
            fromLink ? "Rempli à partir du lien du bureau." : "8 chiffres, donnés par le bureau."
          }
          error={errorOf("code")}
        >
          <Input
            name="code"
            value={form.code}
            onChange={(event) => change("code", shownCode(event.target.value))}
            inputMode="numeric"
            pattern="[0-9 ]*"
            autoComplete="off"
            enterKeyHint="go"
            maxLength={COMPANY_CODE_LENGTH + 1}
            className="font-display h-14 text-center text-2xl font-bold tracking-[0.2em] tabular-nums"
            aria-invalid={Boolean(errorOf("code")) || undefined}
          />
        </Field>
        <FormError>{create.isError && !refusedField ? errorMessage(create.error) : null}</FormError>
        <Button type="submit" size="lg" block loading={busy} className="h-14 text-[17px]">
          Créer mon compte
        </Button>
        <p className="text-dim text-center text-sm text-pretty">
          Vous entrez comme travailleur. Le bureau doit confirmer votre compte d&apos;ici
          7&nbsp;jours.
        </p>
      </form>
    </PublicLayout>
  );
}
