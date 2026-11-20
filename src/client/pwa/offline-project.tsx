import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  CloudDownload,
  Download,
  RefreshCw,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { ProjectDetail } from "@/shared/api";
import type { Plans } from "@/shared/plans";

import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { count, formatDay, formatSize } from "../lib/format";
import { useOnline } from "../lib/online";
import { isNativeApp } from "../native";
import { keys } from "../lib/session";
import { Section } from "../shell/page";
import { Button, Card, confirmAction, ProgressBar, Skeleton, toast, type Tone } from "../ui";
import { canStore } from "./caches";
import {
  estimateBytes,
  filesToKeep,
  isSpaceShort,
  keptStatus,
  keptTotals,
  sheetsToFetch,
} from "./keep";
import {
  cancelKeeping,
  keepProject,
  knownSizes,
  removeKept,
  useKeptProject,
  type Download as Progress,
} from "./kept";
import { freeSpace } from "./storage";

const NEEDS_NETWORK = "Les documents ont encore besoin du réseau.";

/** The longest pause between the two taps of a double tap. */
const DOUBLE_TAP = 500;
let tappedAt = -DOUBLE_TAP;

/**
 * The card's buttons take each other's place ("Annuler" appears where
 * "Garder sur cet appareil" was): the second tap of a double tap would undo
 * the first. A tap that follows another one this closely is ignored.
 */
function firstTap(action: () => void) {
  return (event: { timeStamp: number }) => {
    if (event.timeStamp - tappedAt < DOUBLE_TAP) return;
    tappedAt = event.timeStamp;
    action();
  };
}

/** On a project's home: keeping the project on the device for the site. */
export function OfflineProject({ project }: { project: ProjectDetail }) {
  const { kept, download, problem } = useKeptProject(project.id);
  const online = useOnline();
  // The plan list tells what there is to keep and whether a kept copy is out
  // of date. The plans screen reads the same stored list.
  const plans = useQuery({
    queryKey: keys.plans(project.id),
    queryFn: () => api<Plans>(`/api/projects/${project.id}/plans`),
  });
  const [removing, setRemoving] = useState(false);
  // Read once: what the browser says is left, to warn before a download starts.
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => void freeSpace().then(setFree), []);

  // The iPhone app runs the offline worker only where the shell lets it
  // (an App-Bound Domain): without it a kept project would not open offline.
  if (isNativeApp() && !("serviceWorker" in navigator)) {
    return (
      <Section title="Sans réseau">
        <Layout
          icon={WifiOff}
          tone="neutral"
          title="Plans sans réseau indisponibles"
          text="Dans cette version de l'application, les plans ne peuvent pas être gardés sur le téléphone. Ils s'ouvrent quand le réseau est là."
        />
      </Section>
    );
  }
  // No cache storage in this browser: nothing can be kept, nothing to offer.
  if (!canStore()) return null;
  if (kept === undefined) {
    return (
      <Section title="Sans réseau">
        <Skeleton className="h-32" />
      </Section>
    );
  }

  const wanted = plans.data ? filesToKeep(plans.data) : undefined;
  const toFetch = wanted ? sheetsToFetch(kept, wanted) : undefined;
  const status = keptStatus(kept, download !== null, toFetch?.length);
  const onDevice = keptTotals(Object.values(kept?.sheets ?? {}));
  const needed = toFetch
    ? estimateBytes(
        toFetch.reduce((files, sheet) => files + sheet.urls.length, 0),
        knownSizes(),
      )
    : null;
  const about = needed === null ? null : formatSize(needed);
  // Said on the card before the person starts, not only once they press.
  const warning =
    problem ??
    (needed !== null && free !== null && isSpaceShort(needed, free)
      ? `Il reste environ ${formatSize(free)} sur cet appareil\u00a0: la place risque de manquer.`
      : null);
  const keptOn = kept?.keptAt ? `Gardé le ${formatDay(kept.keptAt)}` : undefined;
  const offlineNote = online
    ? null
    : "Pas de réseau pour l'instant. Revenez ici quand il sera de retour.";

  async function remove() {
    const sure = await confirmAction({
      title: "Retirer ce projet de l'appareil?",
      text: "Ses plans ne s'ouvriront plus sans réseau. Vous pourrez le garder de nouveau quand vous voudrez.",
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!sure) return;
    setRemoving(true);
    try {
      await removeKept(project.id);
      toast.success("Projet retiré de cet appareil.");
    } catch {
      toast.error("Le projet n'a pas pu être retiré. Réessayez.");
    } finally {
      setRemoving(false);
    }
  }

  const start = (label: string, Icon: LucideIcon) => (
    <Button
      size="lg"
      disabled={!online || removing}
      onClick={firstTap(() => keepProject(project.id))}
      className="w-full sm:w-auto"
    >
      <Icon aria-hidden /> {label}
    </Button>
  );
  /** Alone under a kept project it stays small: it is not what the card is for. */
  const removal = (label: string, alone = false) => (
    <Button
      variant="secondary"
      loading={removing}
      onClick={firstTap(remove)}
      className={cn(alone ? "self-start" : "w-full", "sm:w-auto")}
    >
      {label}
    </Button>
  );

  let card: ReactNode;
  if (status === "downloading" && download) {
    card = (
      <Downloading
        progress={download}
        onCancel={() => {
          cancelKeeping(project.id);
          toast("Téléchargement annulé.");
        }}
      />
    );
  } else if (status === "kept") {
    card = (
      <Layout
        icon={CircleCheck}
        tone="good"
        title="Projet gardé sur cet appareil"
        text={`${count(onDevice.sheets, "feuille")} · ${formatSize(onDevice.bytes)}`}
        detail={keptOn}
        actions={removal("Retirer de l'appareil", true)}
        note={`Les plans s'ouvrent sans réseau. ${NEEDS_NETWORK}`}
      />
    );
  } else if (status === "outdated") {
    const stale = toFetch?.length ?? 0;
    card = (
      <Layout
        icon={RefreshCw}
        tone="warn"
        title="Plans à mettre à jour"
        text={`${count(stale, "feuille")} à télécharger${about ? `, environ ${about}` : ""}`}
        detail={keptOn}
        actions={
          <>
            {start("Mettre à jour", RefreshCw)}
            {removal("Retirer")}
          </>
        }
        problem={warning}
        note={offlineNote}
      />
    );
  } else if (status === "interrupted") {
    card = (
      <Layout
        icon={CircleAlert}
        tone="warn"
        title="Téléchargement interrompu"
        text={`${count(onDevice.sheets, "feuille")}${wanted ? ` sur ${wanted.length}` : ""} ${onDevice.sheets > 1 ? "sont" : "est"} sur cet appareil.`}
        detail={
          about
            ? `Il reste environ ${about} à télécharger.`
            : "Le reste se télécharge quand vous reprenez."
        }
        actions={
          <>
            {start("Reprendre", Download)}
            {removal("Retirer")}
          </>
        }
        problem={warning}
        note={offlineNote}
      />
    );
  } else if (project.sheetCount === 0) {
    card = (
      <Layout
        icon={CloudDownload}
        tone="neutral"
        title="Rien à garder pour l'instant"
        text="Ce projet n'a pas encore de plans. Quand il en aura, vous pourrez les garder sur cet appareil pour le chantier."
      />
    );
  } else {
    card = (
      <Layout
        icon={CloudDownload}
        tone="blue"
        title="Garder ce projet sur l'appareil"
        text="Les plans s'ouvriront au chantier, même sans réseau."
        detail={`${count(wanted?.length ?? project.sheetCount, "feuille")}${about ? `, environ ${about}` : ""}`}
        actions={start("Garder sur cet appareil", Download)}
        problem={warning}
        note={offlineNote ?? NEEDS_NETWORK}
      />
    );
  }

  return <Section title="Sans réseau">{card}</Section>;
}

const squares: Record<Tone, string> = {
  neutral: "bg-canvas text-dim",
  blue: "bg-ead-tint text-ead-dark",
  good: "bg-good-tint text-good",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
};

function Layout({
  icon: Icon,
  tone,
  title,
  text,
  detail,
  actions,
  problem,
  note,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  text: string;
  /** A second line: figures, a date. */
  detail?: string;
  /** The main action first. On a phone they stack, full width. */
  actions?: ReactNode;
  /** Why the last download stopped. */
  problem?: string | null;
  note?: string | null;
  /** The progress bar: under the text on a phone, under everything on a wide screen. */
  children?: ReactNode;
}) {
  return (
    <Card
      className="p-4 sm:p-5"
      // A double click on a button would select the text that takes its place.
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl",
              squares[tone],
            )}
          >
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg leading-tight font-bold">{title}</h3>
            <p className="text-dim mt-1 max-w-prose text-[15px] text-pretty">{text}</p>
            {detail ? <p className="text-dim mt-0.5 text-[15px]">{detail}</p> : null}
          </div>
        </div>
        {children ? <div className="sm:order-last sm:col-span-2">{children}</div> : null}
        {actions ? (
          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">{actions}</div>
        ) : null}
      </div>
      {problem ? (
        <p
          role="alert"
          className="bg-warn-tint text-warn mt-4 rounded-xl px-3.5 py-2.5 text-sm font-medium"
        >
          {problem}
        </p>
      ) : null}
      {note ? <p className="border-line text-dim mt-4 border-t pt-3 text-sm">{note}</p> : null}
    </Card>
  );
}

function Downloading({ progress, onCancel }: { progress: Progress; onCancel: () => void }) {
  const cancel = (
    <Button variant="secondary" onClick={firstTap(onCancel)} className="w-full sm:w-auto">
      Annuler
    </Button>
  );
  if (progress.phase === "preparing") {
    return (
      <Layout
        icon={CloudDownload}
        tone="blue"
        title="Préparation du téléchargement"
        text="Lecture de la liste des plans."
        actions={cancel}
      >
        <ProgressBar label="Préparation du téléchargement" />
      </Layout>
    );
  }
  const done = `${progress.sheetsDone} feuille${progress.sheetsDone > 1 ? "s" : ""} sur ${progress.sheetsTotal} · ${formatSize(progress.bytes)}`;
  const waiting = progress.phase === "waiting";
  return (
    <Layout
      icon={waiting ? WifiOff : CloudDownload}
      tone={waiting ? "warn" : "blue"}
      title={waiting ? "En attente du réseau" : "Téléchargement en cours"}
      text={done}
      detail={waiting ? "La suite reprendra toute seule au retour du réseau." : undefined}
      actions={cancel}
      note="Gardez l'application ouverte jusqu'à la fin."
    >
      <ProgressBar
        label="Téléchargement du projet"
        value={progress.filesTotal > 0 ? progress.filesDone / progress.filesTotal : 0}
      />
    </Layout>
  );
}
