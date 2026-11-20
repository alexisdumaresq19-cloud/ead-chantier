import { CircleAlert, Clock, Image as ImageIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { cn } from "../../lib/cn";
import { Spinner } from "../../ui";
import type { LocalPhoto } from "./logic";
import { localPreviewUrl, retryRefused, sendNow, useSendProgress } from "./outbox";

// The pieces of a photo tile, shared by the gallery and the daily report:
// what a photo still on this device shows of its state, and the words for it.

export const tileClass =
  "bg-line/70 relative block aspect-square w-full cursor-pointer overflow-hidden focus-visible:z-[1] focus-visible:-outline-offset-3";

/** A touch screen: the device has a camera worth a button of its own. */
export function useTouchDevice() {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

/** Drawn over the image: a ring of the tile itself would be hidden under it. */
export function Outline({ shown }: { shown: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ring-ead pointer-events-none absolute inset-0 ring-3 transition-opacity duration-500 ring-inset",
        shown ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

/** What a photo still on this device is going through, read aloud. */
export function localLabel(local: LocalPhoto): string {
  return local.state === "waiting"
    ? "Photo en attente d'envoi"
    : local.state === "refused"
      ? "Photo non envoyée"
      : local.state === "sent"
        ? "Photo envoyée"
        : "Photo en cours d'envoi";
}

/** The small image of a photo still on this device, or what stands in for it. */
export function LocalImage({ local }: { local: LocalPhoto }) {
  const preview = localPreviewUrl(local.id);
  if (preview)
    return <img src={preview} alt="" draggable={false} className="size-full object-cover" />;
  if (local.state === "preparing") return null;
  // A file the browser could not draw, sent as it is.
  return (
    <span className="text-dim/50 flex size-full items-center justify-center">
      <ImageIcon className="size-8" aria-hidden />
    </span>
  );
}

/** Over the tile of a photo still on this device: being prepared, leaving, waiting, refused. */
export function LocalMark({ local }: { local: LocalPhoto }) {
  if (local.state === "preparing")
    return (
      <span className="absolute inset-0 flex items-center justify-center">
        <Spinner className="text-dim/70 size-7" label="Préparation" />
      </span>
    );
  if (local.state === "sending") return <SendingMark id={local.id} />;
  if (local.state === "waiting")
    return (
      <span className="bg-ink/75 absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1 text-[11px] font-semibold text-white">
        <Clock className="size-3.5" aria-hidden /> En attente
      </span>
    );
  if (local.state === "refused")
    return (
      <span className="bg-bad absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1 text-[11px] font-semibold text-white">
        <CircleAlert className="size-3.5" aria-hidden /> Non envoyée
      </span>
    );
  return null;
}

/** A ring that fills as the photo leaves. */
function SendingMark({ id }: { id: string }) {
  const sent = useSendProgress(id);
  const radius = 15;
  const around = 2 * Math.PI * radius;
  return (
    <span className="bg-ink/30 absolute inset-0 flex items-center justify-center">
      <svg
        viewBox="0 0 36 36"
        role="progressbar"
        aria-label="Envoi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sent * 100)}
        className="size-10 -rotate-90 drop-shadow"
      >
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          className="stroke-white/35"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={around}
          strokeDashoffset={around * (1 - Math.max(0.04, sent))}
          className="stroke-white transition-[stroke-dashoffset] duration-300"
        />
      </svg>
    </span>
  );
}

/** The title of the window of a photo still on this device. */
export function localTitle(local: LocalPhoto): string {
  return local.state === "refused"
    ? "Photo non envoyée"
    : local.state === "waiting"
      ? "Photo en attente d'envoi"
      : "Photo en cours d'envoi";
}

/** Why a photo is still on this device, and what will become of it. */
export function localExplanation(local: LocalPhoto, online: boolean): string {
  if (local.state === "refused")
    return `${local.error ?? "Le serveur l'a refusée."} Elle reste sur cet appareil\u00a0: enregistrez-en une copie ou retirez-la.`;
  if (local.state !== "waiting") return "Elle sera visible par toute l'équipe dans un instant.";
  return online
    ? (local.error ?? "L'envoi n'a pas abouti. Un nouvel essai se fera tout seul.")
    : "Elle est gardée sur cet appareil et partira dès que le réseau reviendra.";
}

/** The person's own try at sending a photo that waits, or one the server refused. */
export function useSendAgain(local: LocalPhoto | undefined) {
  const [trying, setTrying] = useState(false);
  const run = () => {
    if (!local) return;
    setTrying(true);
    void (local.state === "refused" ? retryRefused(local.id) : sendNow()).finally(() =>
      setTrying(false),
    );
  };
  return { trying, run };
}
