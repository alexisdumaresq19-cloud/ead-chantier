import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";

import type { ProjectDetail } from "@/shared/api";
import type { Photo } from "@/shared/photos";
import { crewTotals, type Report } from "@/shared/reports";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count, formatTime, formatWeekday } from "../../lib/format";
import { navigate } from "../../lib/location";
import { keys, useCurrentProject } from "../../lib/session";
import { Page, Section } from "../../shell/page";
import {
  ButtonLink,
  confirmAction,
  IconButton,
  QueryState,
  Sheet,
  Skeleton,
  toast,
} from "../../ui";
import { BottomBar } from "./bar";
import {
  reportKeys,
  reportsPath,
  useCanChangeReports,
  useDayPhotos,
  useReport,
  useStillShown,
} from "./data";
import { capitalize, formatFullDay, formatHours, formatWhen } from "./lib";
import { ReportMissing } from "./missing";
import { PdfButton, PdfLink } from "./pdf";
import { stillOnDevice, useReportPhotos, type ReportPhoto } from "./photos";
import { ReportPhotoGrid, ReportPhotoSheet } from "./report-photos";
import { WeatherLine } from "./weather";

// Reading a report: laid out as the document it is, its photos included, with
// the day's other photos under it. Its PDF is what leaves the site; the
// browser's own print command still gives the document on a letter-size page.

const COMPANY = "Les Entreprises Allen Dumaresq";

/**
 * The printed page. The app's frame hides itself (class no-print); a message
 * still on screen ("Rapport enregistré") must not be printed on every sheet,
 * and the black behind the app would edge the page and fill the end of the
 * last one when backgrounds are printed.
 */
const PRINT_PAGE = `
  @page { size: letter portrait; margin: 16mm 15mm; }
  @media print {
    html { background: #fff !important; }
    [data-sonner-toaster] { display: none !important; }
  }
`;

export function ReportScreen() {
  const { reportId } = useParams<{ reportId: string }>();
  return <ReportView key={reportId} reportId={reportId} />;
}

function ReportView({ reportId }: { reportId: string }) {
  const project = useCurrentProject();
  const client = useQueryClient();
  const report = useReport(project.id, reportId);
  const dayPhotos = useDayPhotos(project.id, report.data?.day);
  const stillShown = useStillShown();
  const canChange = useCanChangeReports();
  const base = reportsPath(project.id);
  const [menu, setMenu] = useState(false);
  // What came with the report, and since when: a photo still leaving this
  // phone shows too, from the device.
  const known = useMemo(
    () => (report.data ? { photos: report.data.photos, at: report.dataUpdatedAt } : undefined),
    [report.data, report.dataUpdatedAt],
  );
  const { photos } = useReportPhotos(project.id, report.data?.photoIds ?? NO_IDS, known);
  const pending = stillOnDevice(photos).length;
  const [openId, setOpenId] = useState<string | null>(null);
  const openIndex = photos.findIndex((photo) => photo.id === openId);

  const remove = useMutation({
    mutationFn: () => api(`/api/reports/${reportId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Rapport supprimé");
      if (stillShown.current) navigate(base, { replace: true });
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
  const canDelete = Boolean(shown?.canDelete && canChange);
  const others = dayPhotos.data?.filter((photo) => !shown?.photoIds.includes(photo.id)) ?? [];
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
            {/* A computer has the room for every button; a phone keeps the rare ones in a menu. */}
            <div className="hidden items-center gap-2 lg:flex">
              {canChange ? (
                <ButtonLink href={`${base}/${reportId}/modifier`} variant="secondary">
                  <Pencil aria-hidden /> Modifier
                </ButtonLink>
              ) : null}
              <PdfLink reportId={reportId} pending={pending} />
              {canDelete ? (
                <IconButton
                  label="Supprimer le rapport"
                  disabled={remove.isPending || remove.isSuccess}
                  onClick={() => askToRemove(shown.day)}
                  className="text-bad hover:bg-bad-tint hover:text-bad active:bg-bad-tint"
                >
                  <Trash2 aria-hidden />
                </IconButton>
              ) : null}
            </div>
            {canDelete ? (
              <IconButton
                label="Autres actions"
                onClick={() => setMenu(true)}
                className="border-line bg-surface text-text -mr-1 border lg:hidden"
              >
                <Ellipsis aria-hidden />
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
            <ReportDocument
              report={loaded}
              project={project}
              photos={photos}
              onOpenPhoto={setOpenId}
            />
            {others.length ? (
              <DayPhotos photos={others} project={project} day={loaded.day} />
            ) : null}
            <BottomBar className="no-print mt-6 lg:hidden">
              <PdfButton
                reportId={reportId}
                day={loaded.day}
                project={project}
                pending={pending}
                className="flex-1"
              />
              {canChange ? (
                <ButtonLink
                  href={`${base}/${reportId}/modifier`}
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                >
                  <Pencil aria-hidden /> Modifier
                </ButtonLink>
              ) : null}
            </BottomBar>
          </>
        )}
      </QueryState>

      <ReportPhotoSheet
        projectId={project.id}
        photo={photos[openIndex]}
        number={openIndex + 1}
        onClose={() => setOpenId(null)}
      />
      <Sheet
        open={menu && shown !== undefined}
        onClose={() => setMenu(false)}
        title="Rapport journalier"
        description={shown ? capitalize(formatFullDay(shown.day)) : undefined}
      >
        <div className="divide-line border-line divide-y overflow-hidden rounded-2xl border">
          {canDelete && shown ? (
            <MenuChoice
              icon={Trash2}
              label="Supprimer le rapport"
              danger
              disabled={remove.isPending || remove.isSuccess}
              onClick={() => {
                setMenu(false);
                void askToRemove(shown.day);
              }}
            />
          ) : null}
        </div>
      </Sheet>
    </Page>
  );
}

const NO_IDS: string[] = [];

function ReportDocument({
  report,
  project,
  photos,
  onOpenPhoto,
}: {
  report: Report;
  project: ProjectDetail;
  photos: ReportPhoto[];
  onOpenPhoto: (id: string) => void;
}) {
  const totals = crewTotals(report.crew);
  const { weather } = report;
  const changedLater =
    new Date(report.updatedAt).getTime() - new Date(report.createdAt).getTime() > 60_000;
  return (
    <article className="border-line bg-surface rounded-2xl border shadow-xs print:rounded-none print:border-0 print:shadow-none">
      <div className="border-line border-b px-4 py-4 sm:px-6 print:border-b-2 print:border-black print:px-0 print:pt-0">
        <p className="font-display hidden text-lg font-bold print:block">{COMPANY}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[15px] print:mt-2">
          {/* The frame already names the project on screen. */}
          <dt className="text-dim hidden print:block">Projet</dt>
          <dd className="hidden font-semibold print:block">
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
        {photos.length > 0 ? (
          <DocumentPart title="Photos" aside={count(photos.length, "photo")}>
            <div className="pt-1.5">
              <ReportPhotoGrid photos={photos} onOpen={onOpenPhoto} large />
            </div>
          </DocumentPart>
        ) : null}
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

/** What else was photographed that day, from the photos module. */
function DayPhotos({
  photos,
  project,
  day,
}: {
  photos: Photo[];
  project: ProjectDetail;
  day: string;
}) {
  const [open, setOpen] = useState<Photo | null>(null);
  return (
    <div role="region" aria-label="Autres photos de la journée" className="mt-8">
      <Section
        title="Autres photos de la journée"
        // On paper, the title stays with its photos.
        className="print:break-inside-avoid"
        action={
          <Link
            href={`/projets/${project.id}/photos/jour/${day}`}
            className="no-print text-ead-dark hover:bg-ead-tint -my-1 -mr-2 inline-flex h-11 items-center rounded-lg px-2 text-sm font-semibold"
          >
            Voir la galerie
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
                className="bg-line block aspect-square w-full cursor-pointer overflow-hidden rounded-xl print:outline-none"
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
    </div>
  );
}

function MenuChoice({
  icon: Icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "hover:bg-canvas active:bg-canvas flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60",
        danger && "text-bad",
      )}
    >
      <Icon className={cn("size-5 shrink-0", !danger && "text-ead-dark")} aria-hidden />
      {label}
    </button>
  );
}
