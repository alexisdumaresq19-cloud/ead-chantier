import { Check, Clock, Copy, Mail, MessageSquareText, Share2 } from "lucide-react";
import { useRef, useState } from "react";

import type { InviteLink } from "@/shared/api";

import { buttonClass, Button, toast } from "../../ui";
import { useNow } from "./data";
import { daysLeft, firstName, INVITE_SUBJECT, inviteMessage, mailHref, smsHref } from "./people";
import { QrCode } from "./qr";

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
 * app. Nothing here is kept once the window closes.
 */
export function InviteLinkPanel({
  link,
  person,
}: {
  link: InviteLink;
  person: { name: string; phone: string | null; email: string | null };
}) {
  const now = useNow();
  const days = daysLeft(link.expiresAt, now);
  const message = inviteMessage(person.name, link.url, days);
  // The way that matches what the office knows about the person comes first.
  const main = person.phone ? "sms" : person.email ? "mail" : "none";

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium text-pretty">
        <Clock className="text-dim size-4.5 shrink-0" aria-hidden />
        Ce lien sert une seule fois, pendant {days > 1 ? `${days} jours` : "un jour"}.
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
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={smsHref(person.phone, message)}
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
        {canShare() ? (
          <Button
            variant="secondary"
            size="lg"
            className="col-span-2"
            onClick={() => shareLink({ title: INVITE_SUBJECT, text: message })}
          >
            <Share2 aria-hidden /> Partager autrement
          </Button>
        ) : null}
      </div>

      <LinkField url={link.url} label={`Lien personnel de ${person.name}`} />
    </div>
  );
}
