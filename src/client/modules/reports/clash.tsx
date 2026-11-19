import { crewTotals, excerptOf, type Report, type ReportContent } from "@/shared/reports";

import { count, formatWeekday } from "../../lib/format";
import { Button, Sheet } from "../../ui";
import { formatHours, formatWhen } from "./lib";

// Two people and one report: when a save cannot simply go through, nothing is
// replaced and the person chooses, seeing what is saved.

/** A save that could not simply go through, for the person to settle. */
export type Clash =
  | { kind: "changed" | "exists"; latest: Report; mine: ReportContent }
  | { kind: "deleted"; mine: ReportContent };

/** "Vous avez", "Julie Cyr a": who wrote a report, to the person reading. */
export const authorHas = (report: Report, myId: string) =>
  report.authorId === myId ? "Vous avez" : `${report.authorName ?? "Quelqu'un"} a`;

export function ClashSheet({
  clash,
  onClose,
  onReplace,
  onSaveAsNew,
  onLeave,
  myId,
}: {
  clash: Clash | null;
  onClose: () => void;
  onReplace: (latest: Report, mine: ReportContent) => void;
  onSaveAsNew: (mine: ReportContent) => void;
  /** Gives up what was written here, for the saved report (or the list). */
  onLeave: (latest: Report | null) => void;
  myId: string;
}) {
  if (!clash) return <Sheet open={false} onClose={onClose} title="" />;
  if (clash.kind === "deleted")
    return (
      <Sheet
        open
        onClose={onClose}
        title="Ce rapport a été supprimé"
        description="Quelqu'un l'a supprimé pendant que vous écriviez. Ce que vous avez écrit est toujours sur cet appareil."
        footer={
          <>
            <Button variant="secondary" onClick={() => onLeave(null)}>
              Abandonner mon texte
            </Button>
            <Button onClick={() => onSaveAsNew(clash.mine)}>L&apos;enregistrer quand même</Button>
          </>
        }
      />
    );

  const { latest, mine } = clash;
  const theirs = crewTotals(latest.crew);
  return (
    <Sheet
      open
      onClose={onClose}
      title={clash.kind === "exists" ? "Cette journée a déjà un rapport" : "Le rapport a changé"}
      description={
        clash.kind === "exists"
          ? `${authorHas(latest, myId)} déjà enregistré un rapport pour le ${formatWeekday(latest.day)}. Rien n'a été remplacé.`
          : `Quelqu'un l'a enregistré ${formatWhen(latest.updatedAt)}, après que vous l'avez ouvert. Rien n'a été remplacé.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onLeave(latest)}>
            Garder la version enregistrée
          </Button>
          <Button onClick={() => onReplace(latest, mine)}>Remplacer par ma version</Button>
        </>
      }
    >
      <div className="border-line bg-canvas rounded-xl border px-3.5 py-3">
        <p className="text-dim text-xs font-semibold tracking-wide uppercase">
          Version enregistrée
        </p>
        <p className="mt-1 text-[15px] font-semibold">
          {theirs.people > 0
            ? `${count(theirs.people, "personne")} · ${formatHours(theirs.hours)}`
            : "Sans équipe"}
        </p>
        <p className="text-dim mt-0.5 text-[15px] leading-snug">
          {excerptOf(latest.workDone, 160) || "Travaux non décrits"}
        </p>
        {latest.notes ? (
          <p className="text-dim mt-1 text-[15px] leading-snug">
            Notes&nbsp;: {excerptOf(latest.notes, 160)}
          </p>
        ) : null}
      </div>
      <p className="text-dim mt-3 text-sm">
        Si vous gardez la version enregistrée, ce que vous avez écrit sur cet appareil sera effacé.
      </p>
    </Sheet>
  );
}
