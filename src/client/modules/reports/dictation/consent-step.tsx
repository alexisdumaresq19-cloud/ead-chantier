import { Check, FileText, Images, Mic, Users } from "lucide-react";

import { errorMessage } from "../../../lib/api";
import { Button, FormError } from "../../../ui";
import { PRIVACY_PATH } from "../../legal/links";

// The question asked once, the first time the person opens the assistant:
// what leaves the phone, for whom and where, and that the report can always
// be written by hand. Nothing is sent before "J'accepte" (the server holds
// to it too: src/server/legal/consent.ts).

export const CONSENT_TITLE = "Avant d'utiliser l'assistant";

const SENT = [
  { icon: Mic, text: "l'enregistrement de votre voix, quand vous dictez;" },
  { icon: FileText, text: "le texte du rapport;" },
  { icon: Images, text: "les photos du rapport;" },
  { icon: Users, text: "votre nom et ceux des gens du chantier, pour bien les écrire." },
] as const;

/** The step's content, in the sheet's body. */
export function ConsentStep() {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-pretty">
      <p>
        Pour remplir le rapport et décrire les photos, l&apos;assistant envoie à des services
        d&apos;intelligence artificielle&nbsp;:
      </p>
      <ul className="space-y-2">
        {SENT.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3">
            <span className="bg-ead-tint text-ead-dark grid size-10 shrink-0 place-items-center rounded-xl">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="font-semibold">{text}</span>
          </li>
        ))}
      </ul>
      <div className="bg-canvas space-y-2 rounded-2xl px-4 py-3.5">
        <p>
          Ces services sont ceux d&apos;<strong className="font-semibold">Anthropic</strong>, qui
          rédige, et d&apos;<strong className="font-semibold">OpenAI</strong>, qui transcrit la
          voix, joints par l&apos;entremise de Vercel. Ils sont aux{" "}
          <strong className="font-semibold">États-Unis</strong>.
        </p>
        <p>
          L&apos;application leur envoie ces données seulement pour remplir le rapport. Elle ne
          garde pas l&apos;enregistrement de votre voix. Ces services traitent ce qu&apos;ils
          reçoivent selon leurs propres conditions.
        </p>
      </div>
      <p>Vous pouvez toujours écrire le rapport à la main, sans l&apos;assistant.</p>
      <p className="text-dim text-sm">
        Une fois que vous avez accepté, la question ne revient plus. Vous pouvez retirer votre
        accord en tout temps dans Mon compte.{" "}
        {/* Beside the report, which stays open (in the iPhone app, Safari opens it). */}
        <a
          href={PRIVACY_PATH}
          target="_blank"
          rel="noopener"
          className="text-ead-dark font-semibold underline underline-offset-4"
        >
          Politique de confidentialité
        </a>
      </p>
    </div>
  );
}

/** The step's two answers, pinned under it. */
export function ConsentAnswers({
  onAccept,
  onDecline,
  pending,
  error,
}: {
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
  error: unknown;
}) {
  return (
    <div className="w-full space-y-3">
      {error ? <FormError>{errorMessage(error)}</FormError> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onDecline} disabled={pending}>
          Pas maintenant
        </Button>
        <Button size="lg" onClick={onAccept} loading={pending}>
          {pending ? null : <Check aria-hidden />}
          J&apos;accepte
        </Button>
      </div>
    </div>
  );
}
