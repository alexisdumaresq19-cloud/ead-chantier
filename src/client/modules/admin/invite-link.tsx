import { useMutation } from "@tanstack/react-query";
import { Check, Clock, Copy, Mail, MessageSquareText, Share2, TriangleAlert } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { ACCESS_CODE_HOW, formatAccessCode } from "@/shared/access";
import type { InviteLink } from "@/shared/api";
import { canadianPhone, PHONE_HINT } from "@/shared/signup";

import { api } from "../../lib/api";
import { isNativeApp, shareLinkInApp } from "../../native";
import { buttonClass, Button, Input, toast } from "../../ui";
import { refreshPeople, useNow } from "./data";
import {
  daysLeft,
  firstName,
  formatPhone,
  INVITE_SUBJECT,
  inviteMessage,
  mailHref,
  smsHref,
} from "./people";
import { QrCode } from "./qr";
import { ShownError } from "./shown-error";

/** Whether this device can hand a link to another app (messages, mail, AirDrop…). */
export const canShare = () => typeof navigator !== "undefined" && "share" in navigator;

/** Hands a link to the device's share sheet. Closing the sheet is not an error. */
export async function shareLink(data: { title?: string; text?: string; url?: string }) {
  try {
    await navigator.share(data);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    toast.error("Le partage n'a pas fonctionné. Copiez le lien à la place.");
  }
}

// Inside the iPhone app the shell's share sheet is always there; a browser
// keeps its own, where it has one. The app cannot print a page
// (window.print() does nothing there): a poster is printed from a computer.

/** Whether a share button is worth showing on this device. */
export const canShareHere = () => isNativeApp() || canShare();

/** Hands a link or a text to the share sheet: the app's own inside the iPhone app, the browser's elsewhere. */
export async function shareHere(data: { title?: string; text?: string; url?: string }) {
  if (!isNativeApp()) return shareLink(data);
  if (!(await shareLinkInApp(data)))
    toast.error("Le partage n'a pas fonctionné. Copiez le lien à la place.");
}

/** A link shown in full, with a button that copies it. */
export function LinkField({ url, label }: { url: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Lien copié");
    } catch {
      // No clipboard access (an old browser, a refused permission): the link
      // is selected, ready to be copied by hand.
      input.current?.select();
      toast("Le lien est sélectionné. Copiez-le à partir du champ.");
    }
  };
  return (
    <div className="flex gap-2">
      <input
        ref={input}
        readOnly
        value={url}
        aria-label={label}
        onFocus={(event) => event.target.select()}
        className="border-line bg-canvas text-dim h-11 min-w-0 flex-1 rounded-xl border px-3 font-mono text-[13px] outline-none"
      />
      <Button variant="secondary" onClick={copy} className="w-28">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copié" : "Copier"}
      </Button>
    </div>
  );
}

/**
 * A personal invitation link, at the one moment it exists on a screen: to
 * scan on the spot, or to send by text message, by email or through another
 * app; and its code, to type in the iPhone app. Nothing here is kept once
 * the window closes.
 */
export function InviteLinkPanel({
  link,
  person,
}: {
  link: InviteLink;
  person: { id: string; name: string; phone: string | null; email: string | null };
}) {
  const now = useNow();
  // A number added here is the one the texts and the code go with.
  const [phone, setPhone] = useState(person.phone);
  const days = daysLeft(link.expiresAt, now);
  const message = inviteMessage(person.name, link.url, days, link.code, phone);
  // The way that matches what the office knows about the person comes first.
  const main = phone ? "sms" : person.email ? "mail" : "none";

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium text-pretty">
        <Clock className="text-dim size-4.5 shrink-0" aria-hidden />
        {link.code
          ? `Le lien et le code servent une seule fois, pendant ${days > 1 ? `${days}\u00a0jours` : "un jour"}.`
          : `Ce lien sert une seule fois, pendant ${days > 1 ? `${days} jours` : "un jour"}.`}
      </p>
      <div className="border-line flex items-center gap-3 rounded-2xl border bg-white p-2 pr-4">
        <QrCode
          value={link.url}
          label={`Code QR du lien de ${person.name}`}
          className="w-36 shrink-0"
        />
        <p className="text-dim text-sm text-pretty">
          <span className="text-text block text-[15px] font-semibold">Sur place?</span>
          {`Faites scanner ce code avec l'appareil photo du téléphone de ${firstName(person.name)}.`}
          {link.code ? " Pour l'application iPhone, donnez plutôt le code ci\u2011dessous." : null}
        </p>
      </div>
      {link.code ? (
        <TypedCode
          code={link.code}
          person={{ ...person, phone }}
          onPhoneAdded={(added) => setPhone(added)}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <a
          href={smsHref(phone, message)}
          className={buttonClass({ variant: main === "sms" ? "primary" : "secondary", size: "lg" })}
        >
          <MessageSquareText aria-hidden /> Texto
        </a>
        <a
          href={mailHref(person.email, INVITE_SUBJECT, message)}
          className={buttonClass({
            variant: main === "mail" ? "primary" : "secondary",
            size: "lg",
          })}
        >
          <Mail aria-hidden /> Courriel
        </a>
        {canShareHere() ? (
          <Button
            variant="secondary"
            size="lg"
            className="col-span-2"
            onClick={() => shareHere({ title: INVITE_SUBJECT, text: message })}
          >
            <Share2 aria-hidden /> Partager autrement
          </Button>
        ) : null}
      </div>

      <LinkField url={link.url} label={`Lien personnel de ${person.name}`} />
    </div>
  );
}

/**
 * The link's code, large, to read out on the phone or copy: with the
 * person's cell number, it opens the iPhone app, where a link would open
 * Safari instead. Without a number on file it cannot work: said so, with
 * the number to add right here.
 */
function TypedCode({
  code,
  person,
  onPhoneAdded,
}: {
  code: string;
  person: { id: string; name: string; phone: string | null };
  onPhoneAdded: (phone: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copié");
    } catch {
      toast("Copiez le code à la main\u00a0: la copie n'est pas permise ici.");
    }
  };
  return (
    <div className="bg-canvas rounded-2xl p-4" role="group" aria-labelledby={`code-${person.id}`}>
      <p
        id={`code-${person.id}`}
        className="font-display text-dim text-xs font-bold tracking-wider uppercase"
      >
        Code pour l&apos;application
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p
          className="font-display text-[clamp(26px,8.5vw,34px)] leading-none font-bold tracking-[0.06em] whitespace-nowrap tabular-nums"
          aria-label={`Code ${code.split("").join(" ")}`}
          data-testid="access-code"
        >
          {formatAccessCode(code)}
        </p>
        <Button variant="secondary" onClick={copy} className="shrink-0">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copié" : "Copier"}
        </Button>
      </div>
      {person.phone ? (
        <p className="text-dim mt-2.5 text-sm text-pretty">
          {ACCESS_CODE_HOW} À taper avec son cellulaire, le{" "}
          {/* The number is read as one piece: it never breaks across lines. */}
          <span className="whitespace-nowrap">{formatPhone(person.phone)}</span>.
        </p>
      ) : (
        <AddPhone person={person} onAdded={onPhoneAdded} />
      )}
    </div>
  );
}

/** The cell number the code goes with, added without leaving the window. */
function AddPhone({
  person,
  onAdded,
}: {
  person: { id: string; name: string };
  onAdded: (phone: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const phone = canadianPhone(typed);
  const save = useMutation({
    mutationFn: () => api(`/api/users/${person.id}`, { method: "PATCH", body: { phone } }),
    onSuccess: async () => {
      onAdded(phone!);
      toast.success("Numéro ajouté à sa fiche");
      await refreshPeople();
    },
  });
  const problem = checked && !phone ? `Vérifiez le numéro\u00a0: ${PHONE_HINT}` : null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (phone) save.mutate();
  };
  return (
    <form onSubmit={submit} noValidate className="mt-3">
      <p className="text-warn flex items-start gap-2 text-sm font-medium text-pretty">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Le code fonctionne avec le cellulaire de la fiche, et {firstName(person.name)} n&apos;en a
          pas. Ajoutez son numéro.
        </span>
      </p>
      <div className="mt-2 flex gap-2">
        <Input
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setChecked(false);
          }}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="418 555-0123"
          maxLength={30}
          aria-label={`Cellulaire de ${person.name}`}
          aria-invalid={Boolean(problem) || undefined}
          className="h-11 min-w-0 flex-1"
        />
        <Button type="submit" loading={save.isPending} className="shrink-0">
          Ajouter
        </Button>
      </div>
      {problem ? <p className="text-bad mt-1.5 text-sm font-medium">{problem}</p> : null}
      <ShownError error={save.error} />
    </form>
  );
}
