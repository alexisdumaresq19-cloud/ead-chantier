import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Printer, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";

import type { ProjectDetail } from "@/shared/api";
import type { Photo } from "@/shared/photos";
import { crewTotals, type Report } from "@/shared/reports";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { count, formatTime, formatWeekday } from "../../lib/format";
import { navigate } from "../../lib/location";
import { keys, useCurrentProject } from "../../lib/session";
import { Page, Section } from "../../shell/page";
import {
  Button,
  ButtonLink,
  confirmAction,
  IconButton,
  QueryState,
  Sheet,
  Skeleton,
  toast,
} from "../../ui";
import { reportKeys, reportsPath, useDayPhotos, useReport } from "./data";
import { capitalize, formatFullDay, formatHours, formatWhen } from "./lib";
import { ReportMissing } from "./missing";
import { WeatherLine } from "./weather";

// Reading a report: laid out as the document it is, with the day's photos
// under it. "Imprimer" gives the same document on a letter-size page.

const COMPANY = "Les Entreprises Allen Dumaresq";

/**
 * The printed page. The app's frame hides itself (class no-print); a message
 * still on screen ("Rapport enregistré") must not be printed on every sheet.
 */
const PRINT_PAGE = `
  @page { size: letter portrait; margin: 16mm 15mm; }
  @media print { [data-sonner-toaster] { display: none !important; } }
`;

export function ReportScreen() {
  const { reportId } = useParams<{ reportId: string }>();
  return <ReportView key={reportId} reportId={reportId} />;
}

function ReportView({ reportId }: { reportId: string }) {
  const project = useCurrentProject();
  const client = useQueryClient();
  const report = useReport(project.id, reportId);
  const photos = useDayPhotos(project.id, report.data?.day);
  const base = reportsPath(project.id);

  const remove = useMutation({
    mutationFn: () => api(`/api/reports/${reportId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Rapport supprimé");
      navigate(base, { replace: true });
      client.removeQueries({ queryKey: reportKeys.one(project.id, reportId) });
      void client.invalidateQueries({ queryKey: keys.project(project.id) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const askToRemove = async (day: string) => {
    const sure = await confirmAction({
      title: "Supprimer ce rapport?",
      text: `Le rapport du ${formatFullDay(day)} sera supprimé pour tout le monde. Il ne pourra pas être récupéré.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (sure) remove.mutate();
  };

  // Removed since this device last saw it: what is stored is no longer shown.
  if (report.error instanceof ApiFailure && report.error.status === 404) return <ReportMissing />;

  const shown = report.data;
  return (
    <Page
      title="Rapport journalier"
      subtitle={
        shown ? (
          <span className="text-text font-semibold print:hidden">
            {capitalize(formatFullDay(shown.day))}
          </span>
        ) : undefined
      }
      back={{ href: base, label: "Rapports" }}
      narrow
      actions={
        shown ? (
          <>
            <ButtonLink href={`${base}/${reportId}/modifier`}>
              <Pencil aria-hidden /> Modifier
            </ButtonLink>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden /> Imprimer
            </Button>
            {shown.canDelete ? (
              <IconButton
                label="Supprimer le rapport"
                disabled={remove.isPending || remove.isSuccess}
                onClick={() => askToRemove(shown.day)}
                className="text-bad hover:bg-bad-tint hover:text-bad active:bg-bad-tint"
              >
                <Trash2 aria-hidden />
              </IconButton>
            ) : null}
          </>
        ) : null
      }
    >
      <style>{PRINT_PAGE}</style>
      <QueryState
        query={report}
        loading={
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        {(loaded) => (
          <>
            <ReportDocument report={loaded} project={project} />
            {photos.data?.length ? <DayPhotos photos={photos.data} project={project} /> : null}
          </>
        )}
      </QueryState>
    </Page>
  );
}

function ReportDocument({ report, project }: { report: Report; project: ProjectDetail }) {
  const totals = crewTotals(report.crew);
  const { weather } = report;
  const changedLater =
    new Date(report.updatedAt).getTime() - new Date(report.createdAt).getTime() > 60_000;
  return (
    <article className="border-line bg-surface rounded-2xl border shadow-xs print:rounded-none print:border-0 print:shadow-none">
      <div className="border-line border-b px-4 py-4 sm:px-6 print:border-b-2 print:border-black print:px-0 print:pt-0">
        <p className="font-display hidden text-lg font-bold print:block">{COMPANY}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[15px] print:mt-2">
          <dt className="text-dim">Projet</dt>
          <dd className="font-semibold">
            {project.number ? `${project.number} · ` : ""}
            {project.name}
          </dd>
          <dt className="text-dim hidden print:block">Date</dt>
          <dd className="hidden font-semibold print:block">
            {capitalize(formatFullDay(report.day))}
          </dd>
          <dt className="text-dim">Rédigé par</dt>
          <dd className="font-semibold">{report.authorName ?? "Auteur inconnu"}</dd>
          {changedLater ? (
            <>
              <dt className="text-dim print:hidden">Modifié</dt>
              <dd className="print:hidden">{formatWhen(report.updatedAt)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="divide-line divide-y px-4 sm:px-6 print:px-0">
        <DocumentPart title="Météo">
          {weather.condition || weather.temperatureC !== null || weather.note ? (
            <>
              <WeatherLine
                condition={weather.condition}
                temperatureC={weather.temperatureC}
                className="text-[17px] font-semibold"
              />
              {weather.note ? <p className="mt-0.5 wrap-anywhere">{weather.note}</p> : null}
            </>
          ) : (
            <Nothing>Non notée</Nothing>
          )}
        </DocumentPart>

        <DocumentPart
          title="Équipe"
          aside={
            totals.people > 0
              ? `${count(totals.people, "personne")} · ${formatHours(totals.hours)}`
              : undefined
          }
        >
          {report.crew.length > 0 ? (
            <>
              <ul className="gap-x-10 sm:columns-2 print:columns-2">
                {report.crew.map((line, index) => (
                  <li
                    key={index}
                    className="border-line flex break-inside-avoid items-baseline justify-between gap-4 border-b py-1.5"
                  >
                    <span className="min-w-0 wrap-anywhere">{line.name}</span>
                    <span className="font-semibold whitespace-nowrap tabular-nums">
                      {formatHours(line.hours)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="font-display flex items-baseline justify-between gap-4 pt-2.5 font-bold">
                <span>Total des heures</span>
                <span className="text-lg tabular-nums">{formatHours(totals.hours)}</span>
              </p>
            </>
          ) : (
            <Nothing>Personne au chantier</Nothing>
          )}
        </DocumentPart>

        <DocumentPart title="Équipement">
          <Text empty="Aucun équipement inscrit">{report.equipment}</Text>
        </DocumentPart>
        <DocumentPart title="Travaux réalisés">
          <Text empty="Aucun travail inscrit">{report.workDone}</Text>
        </DocumentPart>
        <DocumentPart title="Notes">
          <Text empty="Aucune note">{report.notes}</Text>
        </DocumentPart>
      </div>
    </article>
  );
}

function DocumentPart({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section className="py-4 print:py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-dim text-sm font-bold tracking-wider uppercase print:text-black">
          {title}
        </h2>
        {aside ? <span className="text-dim text-sm font-medium">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A text as it was typed, line breaks included; very long words wrap. */
const Text = ({ children, empty }: { children: string; empty: string }) =>
  children ? (
    <p className="max-w-prose leading-relaxed wrap-anywhere whitespace-pre-line print:max-w-none">
      {children}
    </p>
  ) : (
    <Nothing>{empty}</Nothing>
  );

const Nothing = ({ children }: { children: ReactNode }) => (
  <p className="text-dim italic">{children}</p>
);

/** What was photographed that day, from the photos module. */
function DayPhotos({ photos, project }: { photos: Photo[]; project: ProjectDetail }) {
  const [open, setOpen] = useState<Photo | null>(null);
  return (
    <Section
      title="Photos du jour"
      // On paper, the title stays with its photos.
      className="print:break-inside-avoid"
      action={
        <Link
          href={`/projets/${project.id}/photos`}
          className="no-print text-ead-dark hover:bg-ead-tint -mr-2 inline-flex h-9 items-center rounded-lg px-2 text-sm font-semibold"
        >
          Toutes les photos
        </Link>
      }
    >
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {photos.map((photo) => (
          <li key={photo.id} className="break-inside-avoid">
            <button
              type="button"
              onClick={() => setOpen(photo)}
              aria-label={photo.caption ?? `Photo prise à ${formatTime(photo.takenAt)}`}
              className="bg-line block aspect-square w-full cursor-pointer overflow-hidden rounded-xl"
            >
              <img
                src={photo.thumbUrl}
                alt=""
                crossOrigin="anonymous"
                loading="lazy"
                className="size-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.caption ?? "Photo du jour"}
        description={
          open
            ? `${capitalize(formatWeekday(open.takenAt))} à ${formatTime(open.takenAt)}${open.authorName ? ` · ${open.authorName}` : ""}`
            : undefined
        }
        wide
      >
        {open ? (
          <img
            src={open.url}
            alt={open.caption ?? ""}
            width={open.width}
            height={open.height}
            crossOrigin="anonymous"
            className="bg-line h-auto max-h-[70dvh] w-full rounded-xl object-contain"
          />
        ) : null}
      </Sheet>
    </Section>
  );
}
