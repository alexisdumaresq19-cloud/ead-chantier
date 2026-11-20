import { PencilLine, TriangleAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { Draft } from "./drafts";
import { formatWhen } from "./lib";

// What the form says about itself, above its fields: where the text is kept,
// whether it is saved, whether there is a network.

export function Notice({
  tone,
  icon,
  children,
}: {
  tone: "neutral" | "warn" | "good" | "bad";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm font-medium [&_svg]:mt-px [&_svg]:size-4.5 [&_svg]:shrink-0",
        tone === "neutral" && "text-dim bg-line/50",
        tone === "warn" && "bg-warn-tint text-warn",
        tone === "good" && "bg-good-tint text-good",
        tone === "bad" && "bg-bad-tint text-bad",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Where the text is kept, whether it is saved, whether there is a network. */
export function DraftStatus({
  dirty,
  restored,
  keepsDrafts,
  online,
  onDiscard,
}: {
  dirty: boolean;
  restored: Draft | null;
  keepsDrafts: boolean;
  online: boolean;
  onDiscard: () => void;
}) {
  if (!keepsDrafts)
    return (
      <Notice tone="bad" icon={<TriangleAlert aria-hidden />}>
        Cet appareil ne peut pas garder de brouillon. Enregistrez avant de quitter cette page.
      </Notice>
    );
  if (!dirty && !online)
    return (
      <Notice tone="warn" icon={<WifiOff aria-hidden />}>
        Hors ligne. Ce que vous écrivez est gardé sur cet appareil; vous l&apos;enregistrerez au
        retour du réseau.
      </Notice>
    );
  // A reassurance, not news: it stays out of the way of the form.
  if (!dirty)
    return (
      <p className="text-dim flex items-center gap-1.5 text-[13px] leading-snug">
        <PencilLine className="size-3.5 shrink-0" aria-hidden />
        Ce que vous écrivez reste sur cet appareil.
      </p>
    );
  return (
    <Notice tone="warn" icon={online ? <PencilLine aria-hidden /> : <WifiOff aria-hidden />}>
      <div className="flex items-start justify-between gap-3">
        <p>
          {restored
            ? `Brouillon écrit ${formatWhen(restored.savedAt)}, repris.`
            : "Brouillon gardé sur cet appareil."}{" "}
          {online
            ? "Pas encore enregistré."
            : "Hors ligne\u00a0: à enregistrer au retour du réseau."}
        </p>
        <button
          type="button"
          onClick={onDiscard}
          className="-my-2 -mr-2 inline-flex h-11 shrink-0 cursor-pointer items-center rounded-lg px-2 font-semibold underline underline-offset-2"
        >
          Effacer
        </button>
      </div>
    </Notice>
  );
}
