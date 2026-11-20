import { useMutation } from "@tanstack/react-query";
import {
  CircleAlert,
  CloudOff,
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Share2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { reportPdfName } from "@/shared/reports";

import { ApiFailure, errorMessage } from "../../lib/api";
import { formatSize } from "../../lib/format";
import { useOnline } from "../../lib/online";
import { Button, buttonClass, Sheet, Spinner, toast } from "../../ui";
import { reportPdfUrl } from "./photos";
import { formatFullDay } from "./lib";
import { Notice } from "./status";

// The report's PDF, the way it leaves the site: made by the server in about
// a second, then shared (a text message, an email, Teams), opened in the
// browser's own viewer, or kept as a file.

/** Long enough for a report with forty photos. */
const MAKING_TIMEOUT = 60_000;

async function fetchPdf(reportId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(reportPdfUrl(reportId), {
      credentials: "same-origin",
      signal: AbortSignal.timeout(MAKING_TIMEOUT),
    });
  } catch {
    throw new ApiFailure(0, "offline", "Le PDF n'a pas pu être préparé. Vérifiez le réseau.");
  }
  if (!response.ok) {
    let message = "Le PDF n'a pas pu être préparé. Réessayez.";
    try {
      const data = await response.json();
      if (data?.error?.message) message = data.error.message;
    } catch {
      // Not one of ours (a proxy, a timeout): the plain message stays.
    }
    throw new ApiFailure(response.status, "pdf", message);
  }
  return response.blob();
}

/** A phone that can hand a file to its other apps. */
function canShare(file: File) {
  try {
    return (
      typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true
    );
  } catch {
    return false;
  }
}

const pendingText = (pending: number) =>
  pending > 1
    ? `${pending} photos de ce rapport sont encore sur ce téléphone\u00a0: elles ne seront pas dans ce PDF. Refaites-le une fois envoyées.`
    : "1 photo de ce rapport est encore sur ce téléphone\u00a0: elle ne sera pas dans ce PDF. Refaites-le une fois envoyée.";

type Subject = {
  reportId: string;
  day: string;
  project: { number: string | null; name: string };
  /** Photos of the report not yet on the server. */
  pending: number;
};

/**
 * On a computer: the PDF opens straight in a new tab, in the browser's own
 * viewer (the service worker leaves /api/ alone).
 */
export function PdfLink({ reportId, pending }: Pick<Subject, "reportId" | "pending">) {
  const online = useOnline();
  if (!online)
    return (
      <Button variant="secondary" onClick={() => toast.warning("Le PDF demande le réseau.")}>
        <FileText aria-hidden /> PDF
      </Button>
    );
  return (
    <a
      href={reportPdfUrl(reportId)}
      target="_blank"
      rel="noopener"
      onClick={() => {
        if (pending) toast.warning(pendingText(pending));
      }}
      className={buttonClass()}
    >
      <FileText aria-hidden /> PDF
    </a>
  );
}

/** On a phone: the large button of the bottom bar, and the window that follows. */
export function PdfButton({ className, ...subject }: Subject & { className?: string }) {
  const [open, setOpen] = useState(false);
  const make = useMutation({ mutationFn: () => fetchPdf(subject.reportId) });
  const start = () => {
    setOpen(true);
    if (navigator.onLine) make.mutate();
  };
  // Opened without a network, or cut off on the way: the PDF is made as soon
  // as the network is back, without another tap.
  const online = useOnline();
  const waitsForNetwork =
    open &&
    !make.isPending &&
    !make.data &&
    (make.isIdle || (make.error instanceof ApiFailure && make.error.offline));
  const { mutate } = make;
  // On the network's return only: a failure while it seems there waits for a tap.
  const wasOnline = useRef(online);
  useEffect(() => {
    const back = online && !wasOnline.current;
    wasOnline.current = online;
    if (back && waitsForNetwork) mutate();
  }, [online, waitsForNetwork, mutate]);
  return (
    <>
      <Button size="lg" onClick={start} className={className}>
        <FileText aria-hidden /> PDF
      </Button>
      <PdfSheet
        open={open}
        onClose={() => {
          setOpen(false);
          make.reset();
        }}
        make={make}
        onRetry={() => make.mutate()}
        {...subject}
      />
    </>
  );
}

function PdfSheet({
  open,
  onClose,
  make,
  onRetry,
  reportId,
  day,
  project,
  pending,
}: Subject & {
  open: boolean;
  onClose: () => void;
  make: { data?: Blob; error: unknown; isPending: boolean; isIdle: boolean };
  onRetry: () => void;
}) {
  const online = useOnline();
  const name = reportPdfName(project, day);
  const file = make.data ? new File([make.data], name, { type: "application/pdf" }) : null;

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: name });
    } catch (error) {
      // Closed without sharing: nothing more to do.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Le partage n'a pas abouti. Ouvrez ou téléchargez le PDF.");
    }
  }

  const sharing = file ? canShare(file) : false;
  let body;
  if (file) {
    body = (
      <div className="space-y-3">
        <div className="border-line bg-canvas flex items-center gap-3 rounded-xl border px-3.5 py-3">
          <span className="bg-ead-tint text-ead-dark flex size-11 shrink-0 items-center justify-center rounded-lg">
            <FileText className="size-6" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-snug font-semibold">
              Rapport du {formatFullDay(day)}
            </span>
            <span className="text-dim block text-sm">PDF · {formatSize(file.size)}</span>
          </span>
        </div>
        <div className="grid gap-2">
          {sharing ? (
            <Button size="lg" onClick={share}>
              <Share2 aria-hidden /> Partager
            </Button>
          ) : null}
          <a
            href={reportPdfUrl(reportId)}
            target="_blank"
            rel="noopener"
            className={buttonClass({ variant: sharing ? "secondary" : "primary", size: "lg" })}
          >
            <ExternalLink aria-hidden /> Ouvrir
          </a>
          <a
            href={reportPdfUrl(reportId, true)}
            download={name}
            className={buttonClass({ variant: "secondary", size: "lg" })}
          >
            <Download aria-hidden /> Télécharger
          </a>
        </div>
      </div>
    );
  } else if (make.isPending) {
    body = (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Spinner className="size-9" label="Préparation du PDF" />
        <p className="font-semibold">Préparation du PDF…</p>
      </div>
    );
  } else {
    // Not asked yet (opened without a network), or failed.
    const offline = !online || (make.error instanceof ApiFailure && make.error.offline);
    body = (
      <div className="space-y-3">
        {make.isIdle && online ? null : (
          <Notice
            tone={offline ? "warn" : "bad"}
            icon={offline ? <CloudOff aria-hidden /> : <CircleAlert aria-hidden />}
          >
            {!online
              ? "Le PDF se prépare sur le serveur\u00a0: il demande le réseau. Réessayez quand il sera revenu."
              : errorMessage(make.error)}
          </Notice>
        )}
        <Button size="lg" block onClick={onRetry} disabled={!online}>
          {make.isIdle ? "Préparer le PDF" : "Réessayer"}
        </Button>
      </div>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="PDF du rapport">
      <div className="space-y-3">
        {pending > 0 ? (
          <Notice tone="warn" icon={<ImageOff aria-hidden />}>
            {pendingText(pending)}
          </Notice>
        ) : null}
        {body}
      </div>
    </Sheet>
  );
}
