import { useMutation } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { Link } from "wouter";

import {
  ACCESS_CODE_LENGTH,
  codeFromText,
  readMessage,
  typedCode,
  type AccessCodeInput,
} from "@/shared/access";
import { canadianPhone, PHONE_HINT } from "@/shared/signup";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { enterApp, signOut, useMe } from "../../lib/session";
import { PublicLayout } from "../../shell/public-layout";
import { Button, ButtonLink, Field, FormError, Input } from "../../ui";
import { focusNamed, Heading } from "./parts";

// Signing in by typing (/bienvenue/code): the cell number the office has on
// file and the eight digits it sent. For the iPhone app above all, where a
// link tapped in Messages opens Safari instead of the app.

type FieldName = "phone" | "code";

const PHONE_MISSING = "Inscrivez votre numéro de cellulaire.";
const PHONE_WRONG = `Vérifiez le numéro\u00a0: ${PHONE_HINT}`;
const CODE_MISSING = `Inscrivez les ${ACCESS_CODE_LENGTH} chiffres du code que le bureau vous a envoyé.`;

/** What is wrong before anything is sent, field by field. */
export function codeProblems(form: AccessCodeInput): Partial<Record<FieldName, string>> {
  return {
    phone: !form.phone.trim() ? PHONE_MISSING : canadianPhone(form.phone) ? undefined : PHONE_WRONG,
    code: codeFromText(form.code).length === ACCESS_CODE_LENGTH ? undefined : CODE_MISSING,
  };
}

/** The field the server's refusal is about, if it is about one. */
const FIELD_OF: Record<string, FieldName> = { bad_phone: "phone", bad_code: "code" };

export function AccessCodeScreen() {
  const me = useMe();
  const formRef = useRef<HTMLFormElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  /**
   * Once the keyboard is up, the button comes into view under the fields: on
   * a small phone both fields and the button then fit above the keyboard.
   */
  const keepButtonInView = () =>
    window.setTimeout(() => sendRef.current?.scrollIntoView({ block: "nearest" }), 350);
  const [form, setForm] = useState<AccessCodeInput>({ phone: "", code: "" });
  const [checked, setChecked] = useState(false);
  const enter = useMutation({
    mutationFn: () =>
      api("/api/sessions/code", {
        method: "POST",
        body: { phone: form.phone, code: codeFromText(form.code) },
      }),
    onSuccess: () => enterApp("/"),
    onError: (error) => {
      const field = error instanceof ApiFailure ? FIELD_OF[error.code] : undefined;
      // A wrong pair: the code is what most often needs another look.
      const again =
        field ??
        (error instanceof ApiFailure && error.code === "wrong_access_code" ? "code" : null);
      if (again) focusNamed(formRef.current, again);
    },
  });
  const leave = useMutation({ mutationFn: () => signOut(window.location.pathname) });
  const busy = enter.isPending || enter.isSuccess;

  if (me.data && !busy) {
    // Never another account behind the back of the one signed in here.
    return (
      <PublicLayout>
        <Heading title="Cet appareil est déjà connecté">
          Il est connecté sous le nom de {me.data.name}.
        </Heading>
        <div className="mt-6">
          <ButtonLink href="/" size="lg" block>
            Ouvrir l&apos;application
          </ButtonLink>
        </div>
        <p className="border-line text-dim mt-6 border-t pt-4 text-sm text-pretty">
          Pour entrer sous un autre nom, déconnectez d&apos;abord cet appareil.
        </p>
        <FormError>{leave.isError ? errorMessage(leave.error) : null}</FormError>
        <Button
          variant="secondary"
          block
          className="mt-3"
          loading={leave.isPending || leave.isSuccess}
          onClick={() => leave.mutate()}
        >
          Se déconnecter de cet appareil
        </Button>
      </PublicLayout>
    );
  }

  const shown = checked ? codeProblems(form) : {};
  const refusal = enter.error instanceof ApiFailure ? enter.error : null;
  const refusedField = refusal ? FIELD_OF[refusal.code] : undefined;
  const errorOf = (field: FieldName) =>
    shown[field] ?? (refusedField === field ? refusal?.message : undefined) ?? null;
  const change = (field: FieldName, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    // What the server said goes once something is typed again.
    if (enter.isError) enter.reset();
  };
  /**
   * A whole text message pasted in either field: the number goes to the
   * number, the code to the code, whatever else it says.
   */
  const paste = (field: FieldName) => (event: ClipboardEvent<HTMLInputElement>) => {
    const { phone, code } = readMessage(event.clipboardData.getData("text"));
    // Something else (a number being fixed by hand): the browser pastes it.
    if (!phone && !code) return;
    event.preventDefault();
    setForm((current) => ({
      phone: phone && (field === "phone" || !current.phone.trim()) ? phone : current.phone,
      code: code ? typedCode(code) : current.code,
    }));
    if (enter.isError) enter.reset();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    const found = codeProblems(form);
    const first = (["phone", "code"] as const).find((field) => found[field]);
    if (first) return focusNamed(event.currentTarget, first);
    enter.mutate();
  };

  return (
    <PublicLayout compact>
      <Link
        href="/bienvenue/compte"
        className="text-ead-dark hover:bg-ead-tint -mt-2 mb-1 -ml-2 inline-flex h-11 items-center gap-0.5 rounded-lg pr-2.5 text-sm font-semibold"
      >
        <ChevronLeft className="size-5" aria-hidden /> Retour
      </Link>
      <Heading title="Entrer avec un code">
        Votre numéro de cellulaire et le code envoyé par le bureau.
      </Heading>
      <form ref={formRef} onSubmit={submit} noValidate className="mt-5 space-y-4">
        <Field label="Cellulaire" error={errorOf("phone")}>
          <Input
            name="phone"
            value={form.phone}
            onChange={(event) => change("phone", event.target.value)}
            onPaste={paste("phone")}
            onFocus={keepButtonInView}
            // Shown the way it is kept, once typed.
            onBlur={() => {
              const phone = canadianPhone(form.phone);
              if (phone && phone !== form.phone) setForm((current) => ({ ...current, phone }));
            }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="next"
            placeholder="418 555-0123"
            maxLength={40}
            className="h-14 text-xl tabular-nums"
            aria-invalid={Boolean(errorOf("phone")) || undefined}
          />
        </Field>
        <Field label="Code du bureau" error={errorOf("code")}>
          <Input
            name="code"
            value={form.code}
            onChange={(event) => change("code", typedCode(event.target.value))}
            onPaste={paste("code")}
            onFocus={keepButtonInView}
            inputMode="numeric"
            pattern="[0-9 ]*"
            // The phone offers the code of a text message it just received.
            autoComplete="one-time-code"
            enterKeyHint="go"
            placeholder="0000 0000"
            maxLength={9}
            className="font-display placeholder:text-dim/30 h-16 text-center text-[28px] font-bold tracking-[0.2em] tabular-nums placeholder:font-medium"
            aria-invalid={Boolean(errorOf("code")) || undefined}
          />
        </Field>
        <FormError>{enter.isError && !refusedField ? errorMessage(enter.error) : null}</FormError>
        <div ref={sendRef} className="scroll-mb-3">
          <Button type="submit" size="lg" block loading={busy} className="h-14 text-[17px]">
            Entrer
          </Button>
        </div>
      </form>
      <p className="text-dim mt-4 text-center text-sm text-pretty">
        Pas de code? Demandez-en un au bureau.
      </p>
    </PublicLayout>
  );
}
