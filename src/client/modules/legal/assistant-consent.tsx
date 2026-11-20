import { ShieldCheck, Sparkles } from "lucide-react";

import { canWriteReports } from "@/shared/roles";

import { errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDay } from "../../lib/format";
import { useCurrentUser } from "../../lib/session";
import { Section } from "../../shell/page";
import { Button, Card, confirmAction, FormError, toast } from "../../ui";
import { useAssistantConsent, useSetAssistantConsent } from "./consent-data";
import { PRIVACY_PATH } from "./links";

// The person's agreement to the report's assistant sending their voice,
// their texts and the report's photos to an AI service: asked before the
// first use (modules/reports/dictation/consent-step.tsx), shown and taken
// back here, on the account screen.

/** The assistant's setting on the account screen: only for those who write reports. */
export function AssistantConsentSetting() {
  const me = useCurrentUser();
  const consent = useAssistantConsent();
  const change = useSetAssistantConsent();
  if (!canWriteReports(me.role)) return null;

  const takeBack = async () => {
    const ok = await confirmAction({
      title: "Retirer votre accord?",
      text: "L'assistant ne recevra plus rien de vous. Il vous reposera la question si vous l'ouvrez de nouveau. Vos rapports restent tels quels.",
      confirmLabel: "Retirer mon accord",
    });
    if (ok) change.mutate(false, { onSuccess: () => toast.success("Accord retiré") });
  };

  return (
    <Section title="Assistant du rapport">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl",
              consent.agreed ? "bg-good-tint text-good" : "bg-canvas text-dim",
            )}
          >
            {consent.agreed ? (
              <ShieldCheck className="size-5.5" aria-hidden />
            ) : (
              <Sparkles className="size-5.5" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] leading-snug font-semibold">
              {consent.agreed
                ? consent.at
                  ? `Accepté le ${formatDay(consent.at)}`
                  : "Accepté"
                : "Pas encore accepté"}
            </p>
            <p className="text-dim mt-1 text-[15px] text-pretty">
              {consent.agreed
                ? "Quand vous l'utilisez, l'assistant envoie votre voix, le texte et les photos du rapport à des services d'intelligence artificielle, aux États-Unis."
                : "La première fois que vous ouvrirez l'assistant, il vous demandera votre accord avant d'envoyer quoi que ce soit."}
            </p>
          </div>
        </div>
        {consent.agreed ? (
          <Button
            variant="secondary"
            block
            className="mt-4"
            onClick={takeBack}
            loading={change.isPending}
          >
            Retirer mon accord
          </Button>
        ) : null}
        {change.isError ? (
          <div className="mt-3">
            <FormError>{errorMessage(change.error)}</FormError>
          </div>
        ) : null}
        <p className="mt-3 text-center text-sm">
          <a
            href={PRIVACY_PATH}
            className="text-ead-dark inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline"
          >
            Lire la politique de confidentialité
          </a>
        </p>
      </Card>
    </Section>
  );
}
