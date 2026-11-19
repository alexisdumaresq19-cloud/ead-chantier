import {
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FileUp,
  RotateCw,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";

import type { PlanImportSummary } from "@/shared/plans";

import { cn } from "../../lib/cn";
import { count, formatSize } from "../../lib/format";
import { navigate } from "../../lib/location";
import { Section } from "../../shell/page";
import { Badge, IconButton, ProgressBar, Spinner, toast } from "../../ui";
import { planPaths, usePendingImports } from "./data";
import { sortPdfFiles } from "./logic";
import {
  addPlanFiles,
  removeUpload,
  retryUpload,
  usePlanUploads,
  type PlanUpload,
} from "./uploads";

// Adding plans, for those who manage a project: PDFs chosen or dropped, their
// way to the server, and the imports that wait to be checked and published.

/**
 * Takes the files chosen or dropped: refuses what is not a PDF, sends the
 * rest. One PDF leads straight to its conversion; several stay in the list,
 * each to be checked in turn.
 */
export function useAddFiles(projectId: string) {
  const onScreen = useRef(false);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  return useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const { accepted, refused } = sortPdfFiles(files);
      if (refused.length) {
        toast.error(
          refused.length === 1 ? refused[0] : `${refused.length} fichiers n'ont pas été ajoutés`,
          {
            description:
              refused.length === 1
                ? "Les plans s'ajoutent en PDF, 500 Mo au plus."
                : refused.join(" "),
            duration: 8000,
          },
        );
      }
      if (!accepted.length) return;
      const importIds = await addPlanFiles(projectId, accepted);
      if (!onScreen.current || !importIds.length) return;
      if (accepted.length === 1) navigate(planPaths.import(projectId, importIds[0]));
      else
        toast.success(
          `${count(importIds.length, "PDF envoyé", "PDF envoyés")}. La conversion est commencée.`,
        );
    },
    [projectId],
  );
}

/** Lets PDFs be dropped anywhere on the screen; true while files hover over it. */
export function useFileDrop(enabled: boolean, onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    // Entering a child fires before leaving its parent: count to know when
    // the files have really left the window.
    let depth = 0;
    const withFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent) => {
      if (!withFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!withFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!withFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!withFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      onFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [enabled, onFiles]);
  return dragging;
}

export function DropHint() {
  return (
    <div className="bg-ead-darker/95 animate-fade pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-white/70 px-10 py-12 text-center text-white">
        <FileUp className="size-12" aria-hidden />
        <p className="font-display mt-4 text-2xl font-bold">Déposez vos PDF ici</p>
        <p className="mt-1 text-white/80">Chaque page deviendra une feuille de plan.</p>
      </div>
    </div>
  );
}

/** PDFs being sent and imports not yet published, so that none is forgotten. */
export function InProgress({ projectId }: { projectId: string }) {
  const uploads = usePlanUploads(projectId);
  const imports = usePendingImports(projectId, true);
  if (!uploads.length && !imports.data?.length) return null;
  return (
    <Section title="En cours d'ajout" className="mb-6">
      <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border shadow-xs">
        {uploads.map((upload) => (
          <UploadRow key={upload.id} upload={upload} />
        ))}
        {imports.data?.map((current) => (
          <ImportRow key={current.id} projectId={projectId} current={current} />
        ))}
      </ul>
    </Section>
  );
}

function RowIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: "blue" | "warn" | "bad" }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        tone === "blue" && "bg-ead-tint text-ead-dark",
        tone === "warn" && "bg-warn-tint text-warn",
        tone === "bad" && "bg-bad-tint text-bad",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

function UploadRow({ upload }: { upload: PlanUpload }) {
  const failed = upload.status === "failed";
  return (
    <li className="flex items-center gap-3 py-2.5 pr-1.5 pl-3">
      <RowIcon icon={failed ? CircleAlert : Upload} tone={failed ? "bad" : "blue"} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{upload.name}</p>
        {failed ? (
          <p className="text-bad text-sm font-medium">{upload.error}</p>
        ) : (
          <>
            <p className="text-dim text-sm">
              {upload.status === "waiting"
                ? `En attente · ${formatSize(upload.size)}`
                : upload.status === "sending"
                  ? `Envoi\u00a0: ${Math.round(upload.progress * 100)}\u00a0% de ${formatSize(upload.size)}`
                  : "Envoyé. Début de la conversion…"}
            </p>
            <ProgressBar
              value={upload.status === "starting" ? undefined : upload.progress}
              label={`Envoi de ${upload.name}`}
              className="mt-1.5 h-1.5"
            />
          </>
        )}
      </div>
      {failed ? (
        <IconButton
          label={`Réessayer l'envoi de ${upload.name}`}
          onClick={() => retryUpload(upload.id)}
        >
          <RotateCw aria-hidden />
        </IconButton>
      ) : null}
      <IconButton
        label={`${failed ? "Retirer" : "Annuler l'envoi de"} ${upload.name}`}
        onClick={() => removeUpload(upload.id)}
      >
        <X aria-hidden />
      </IconButton>
    </li>
  );
}

function ImportRow({ projectId, current }: { projectId: string; current: PlanImportSummary }) {
  const converting = current.status === "reading" || current.status === "processing";
  const done = current.readyCount + current.failedCount;
  return (
    <li>
      <Link
        href={planPaths.import(projectId, current.id)}
        className="hover:bg-canvas active:bg-canvas flex min-h-16 items-center gap-3 py-2.5 pr-2 pl-3 -outline-offset-2 transition-colors"
      >
        {converting ? (
          <span className="bg-ead-tint flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Spinner className="text-ead-dark size-5" label="Conversion en cours" />
          </span>
        ) : (
          <RowIcon
            icon={current.status === "failed" ? CircleAlert : ClipboardCheck}
            tone={current.status === "failed" ? "bad" : "warn"}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{current.filename}</p>
          {converting ? (
            <>
              <p className="text-dim text-sm">
                {current.pageCount
                  ? `Conversion\u00a0: ${done} sur ${count(current.pageCount, "page")}`
                  : "Lecture du PDF…"}
              </p>
              <ProgressBar
                value={current.pageCount ? done / current.pageCount : undefined}
                label={`Conversion de ${current.filename}`}
                className="mt-1.5 h-1.5"
              />
            </>
          ) : current.status === "failed" ? (
            <p className="text-bad text-sm font-medium">
              {current.error ?? "La conversion a échoué."}
            </p>
          ) : (
            <p className="text-dim text-sm">
              {count(current.readyCount, "page prête", "pages prêtes")} à vérifier et à publier
            </p>
          )}
        </div>
        {current.status === "review" ? (
          <Badge tone="warn" className="max-sm:hidden">
            À vérifier
          </Badge>
        ) : null}
        <ChevronRight className="text-dim size-5 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}
