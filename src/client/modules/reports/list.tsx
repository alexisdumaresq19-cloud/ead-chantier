import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  ClipboardList,
  Mic,
  NotebookPen,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";

import { isRealDay, type ReportSummary } from "@/shared/reports";

import { useAssistant } from "../../lib/assistant";
import { cn } from "../../lib/cn";
import { count, formatWeekday } from "../../lib/format";
import { navigate } from "../../lib/location";
import { useCurrentProject, useCurrentUser } from "../../lib/session";
import { Page, Section } from "../../shell/page";
import {
  Button,
  confirmAction,
  EmptyState,
  Field,
  IconButton,
  Input,
  QueryState,
  Sheet,
  Skeleton,
} from "../../ui";
import {
  dayQuery,
  membersQuery,
  reportsPath,
  useCanChangeReports,
  useDrafts,
  useReports,
  useToday,
} from "./data";
import { removeDraft, type Draft } from "./drafts";
import {
  capitalize,
  formatFullDay,
  formatHours,
  formatBriefDay,
  formatWhen,
  groupByMonth,
  isWorkday,
  lastDays,
  monthLabel,
  shiftDay,
  weekdayShort,
} from "./lib";
import { Notice } from "./status";
import { WeatherLine } from "./weather";

// The project's reports: today's first, then the days of the week that still
// miss one, then every report by month.

type KeyedDraft = Draft & { key: string };

export function ReportListScreen() {
  const project = useCurrentProject();
  const me = useCurrentUser();
  const today = useToday();
  const reports = useReports(project.id);
  const drafts = useDrafts(me.id, project.id);
  const [choosingDate, setChoosingDate] = useState(false);
  const canChange = useCanChangeReports();
  const base = reportsPath(project.id);

  // Fetched ahead: the report is often written where there is no signal, and
  // it starts from the people of the project and the crew of the day before.
  const client = useQueryClient();
  useEffect(() => {
    if (!canChange) return;
    void client.prefetchQuery(dayQuery(project.id, today));
    void client.prefetchQuery(membersQuery(project.id));
  }, [client, project.id, today, canChange]);

  const byDay = new Map(reports.data?.map((report) => [report.day, report]));
  const draftDays = new Set(drafts.map((draft) => draft.form.day));
  /** Where a day leads: its report if it has one, else a new report for that day. */
  const hrefOf = (day: string) => {
    const report = byDay.get(day);
    return report ? `${base}/${report.id}` : `${base}/nouveau?jour=${day}`;
  };
  const todayReport = byDay.get(today);
  // Saved, it is added to through the day; only on this device, it is still to save.
  // Short, with the day under it: two lines at most on a 360 px phone.
  const todayLabel = todayReport
    ? "Compléter le rapport du jour"
    : draftDays.has(today)
      ? "Continuer le rapport du jour"
      : "Rapport du jour";

  const todayHref = todayReport
    ? `${base}/${todayReport.id}/modifier`
    : `${base}/nouveau?jour=${today}`;
  const canDictate = useAssistant().data?.dictation === true && canChange;

  return (
    <Page title="Rapports">
      {canChange ? (
        <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-stretch lg:gap-4">
          <div className="flex gap-2.5">
            <Link
              href={todayHref}
              className="bg-ead-dark hover:bg-ead-darker active:bg-ead-darker flex min-h-18 min-w-0 flex-1 items-center gap-3.5 rounded-2xl px-4 py-3 text-white shadow-sm transition-colors"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <NotebookPen className="size-6.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-display block text-[17px] leading-tight font-bold text-balance">
                  {todayLabel}
                </span>
                <span className="mt-0.5 block text-sm text-white/85">
                  {capitalize(formatBriefDay(today))}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-white/85" aria-hidden />
            </Link>
            {canDictate ? (
              // Talking is the fastest way to write it: one tap and the recording starts.
              <Link
                href={`${todayHref}${todayHref.includes("?") ? "&" : "?"}dicter=1`}
                aria-label="Dicter le rapport du jour"
                className="bg-ink flex min-h-18 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl text-white shadow-sm transition active:scale-[0.97]"
              >
                <span className="bg-ead grid size-9 place-items-center rounded-full">
                  <Mic className="size-5" aria-hidden />
                </span>
                <span className="text-xs font-semibold">Dicter</span>
              </Link>
            ) : null}
          </div>

          {/* Seven days across a 360 px phone leave no room for a frame: there, they sit on the page. */}
          <section className="sm:border-line sm:bg-surface sm:rounded-2xl sm:border sm:px-3 sm:pt-1.5 sm:pb-3 sm:shadow-xs">
            <div className="flex items-center justify-between gap-2 sm:pl-1">
              <h2 className="font-display text-dim text-sm font-bold tracking-wider uppercase">
                7 derniers jours
              </h2>
              <Button variant="ghost" onClick={() => setChoosingDate(true)} className="-mr-2 px-3">
                <CalendarDays aria-hidden /> Autre date
              </Button>
            </div>
            <ul className="grid grid-cols-7 gap-0.5 min-[390px]:gap-1 sm:gap-2">
              {lastDays(today, 7).map((day) => (
                <li key={day}>
                  <DayCell
                    day={day}
                    href={hrefOf(day)}
                    state={
                      byDay.has(day)
                        ? "done"
                        : draftDays.has(day)
                          ? "draft"
                          : !reports.data
                            ? "unknown"
                            : day < today && isWorkday(day)
                              ? "missing"
                              : "none"
                    }
                    isToday={day === today}
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <Notice tone="neutral" icon={<Archive aria-hidden />}>
          Projet archivé&nbsp;: les rapports se lisent et leur PDF se partage, mais ils ne se
          modifient plus.
        </Notice>
      )}

      {drafts.length > 0 && canChange ? (
        <DraftList
          drafts={drafts}
          hrefOf={(draft) =>
            draft.reportId
              ? `${base}/${draft.reportId}/modifier`
              : `${base}/nouveau?jour=${draft.form.day}`
          }
        />
      ) : null}

      <div className={canChange ? "mt-8" : "mt-5"}>
        <QueryState
          query={reports}
          loading={
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          }
        >
          {(all) =>
            all.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Aucun rapport pour l'instant"
                text="En fin de journée, notez la météo, l'équipe et les travaux réalisés. Deux minutes suffisent."
              />
            ) : (
              groupByMonth(all).map((group) => (
                <Section
                  key={group.month}
                  title={monthLabel(group.items[0].day)}
                  action={
                    <span className="text-dim text-sm">
                      {count(group.items.length, "rapport")} ·{" "}
                      {formatHours(group.items.reduce((sum, report) => sum + report.hours, 0))}
                    </span>
                  }
                >
                  <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border shadow-xs">
                    {group.items.map((report) => (
                      <li key={report.id}>
                        <ReportRow report={report} href={`${base}/${report.id}`} />
                      </li>
                    ))}
                  </ul>
                </Section>
              ))
            )
          }
        </QueryState>
      </div>

      <OtherDateSheet
        open={choosingDate}
        onClose={() => setChoosingDate(false)}
        today={today}
        hasReport={(day) => byDay.has(day)}
        onChoose={(day) => {
          setChoosingDate(false);
          navigate(hrefOf(day));
        }}
      />
    </Page>
  );
}

/**
 * One of the last seven days: done, started on this device, missing (a
 * working day gone by without one), still to write — or not known yet,
 * while the list is on its way or out of reach.
 */
function DayCell({
  day,
  href,
  state,
  isToday,
}: {
  day: string;
  href: string;
  state: "done" | "draft" | "missing" | "none" | "unknown";
  isToday: boolean;
}) {
  const Icon = { done: Check, draft: PencilLine, missing: null, none: Plus, unknown: null }[state];
  const meaning = {
    done: "rapport fait",
    draft: "brouillon à enregistrer",
    missing: "rapport manquant",
    none: "aucun rapport, en commencer un",
    unknown: "ouvrir cette journée",
  }[state];
  return (
    <Link
      href={href}
      aria-label={`${capitalize(formatWeekday(day))}, ${meaning}`}
      className={cn(
        "flex min-h-18 flex-col items-center justify-center gap-0.5 rounded-xl border py-1.5 transition-colors",
        state === "done" && "border-ead/30 bg-ead-tint text-ead-dark hover:border-ead/60",
        (state === "draft" || state === "missing") &&
          "border-warn/30 bg-warn-tint text-warn hover:border-warn/60",
        state === "none" && "border-line bg-surface text-dim hover:border-ead/60 hover:text-text",
        state === "unknown" && "border-line bg-surface text-dim",
        // Days off without a report are nothing to worry about: drawn lightly.
        state === "none" && !isToday && "border-dashed",
        isToday && "border-ead-dark border-2",
      )}
    >
      <span className="text-xs leading-none font-semibold">
        {isToday ? "auj." : weekdayShort(day)}
      </span>
      <span className="font-display text-text text-lg leading-tight font-bold">
        {Number(day.slice(8))}
      </span>
      {Icon ? (
        <Icon className="size-4" strokeWidth={2.5} aria-hidden />
      ) : state === "missing" ? (
        <span aria-hidden className="font-display h-4 text-base leading-4 font-extrabold">
          !
        </span>
      ) : (
        <span className="h-4" />
      )}
    </Link>
  );
}

function DraftList({
  drafts,
  hrefOf,
}: {
  drafts: KeyedDraft[];
  hrefOf: (draft: KeyedDraft) => string;
}) {
  const discard = async (draft: KeyedDraft) => {
    const sure = await confirmAction({
      title: "Effacer ce brouillon?",
      text: `Ce que vous avez écrit pour le ${formatWeekday(draft.form.day)} et qui n'est pas enregistré sera perdu.`,
      confirmLabel: "Effacer",
      danger: true,
    });
    if (sure) removeDraft(draft.key);
  };
  return (
    <section className="border-warn/25 bg-warn-tint mt-3 rounded-2xl border px-3 pt-3 pb-1.5 lg:mt-4">
      <h2 className="text-warn flex items-center gap-2 px-1 text-sm font-bold">
        <PencilLine className="size-4.5 shrink-0" aria-hidden />
        {drafts.length > 1
          ? "Brouillons gardés sur cet appareil"
          : "Brouillon gardé sur cet appareil"}
      </h2>
      <ul className="mt-1">
        {drafts.map((draft) => (
          <li key={draft.key} className="flex items-center gap-1">
            <Link
              href={hrefOf(draft)}
              className="group flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-display min-w-0 truncate font-bold">
                    {capitalize(formatWeekday(draft.form.day))}
                  </span>
                  <PhotoCount count={draft.form.photoIds.length} />
                </span>
                <span className="text-warn block text-sm">
                  Pas encore enregistré. Écrit {formatWhen(draft.savedAt)}.
                </span>
              </span>
              <ChevronRight
                className="text-warn size-5 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
            <IconButton
              label="Effacer ce brouillon"
              onClick={() => discard(draft)}
              className="text-warn hover:bg-warn/10 hover:text-warn active:bg-warn/10"
            >
              <Trash2 aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A phone reads it in three lines (the day and the weather, the crew and the
 * author, the work); a wide screen in columns, the author under the day.
 */
function ReportRow({ report, href }: { report: ReportSummary; href: string }) {
  const wide = "md:row-span-2 md:row-start-1 md:self-center";
  return (
    <Link
      href={href}
      className="group hover:bg-canvas active:bg-canvas grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3.5 transition-colors md:grid-cols-[12.5rem_9.5rem_10.5rem_minmax(0,1fr)_1.25rem] md:gap-x-5 md:gap-y-0 md:py-3"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="font-display min-w-0 truncate text-[17px] leading-snug font-bold md:text-base">
          {capitalize(formatWeekday(report.day))}
        </span>
        <PhotoCount count={report.photoCount} />
      </span>
      <span className={cn("text-sm font-medium md:col-start-2", wide)}>
        <WeatherLine condition={report.condition} temperatureC={report.temperatureC} short />
      </span>
      <span className={cn("text-sm font-medium md:col-start-3", wide)}>
        {report.people > 0 ? (
          <>
            {count(report.people, "personne")} · {formatHours(report.hours)}
          </>
        ) : (
          <span className="text-dim">Sans équipe</span>
        )}
      </span>
      <span className="text-dim truncate text-right text-sm md:col-start-1 md:row-start-2 md:text-left">
        {report.authorName}
      </span>
      <span
        className={cn(
          "text-dim col-span-2 line-clamp-2 text-[15px] leading-snug wrap-anywhere md:col-span-1 md:col-start-4",
          wide,
          !report.excerpt && "italic",
        )}
      >
        {report.excerpt || "Travaux non décrits"}
      </span>
      <ChevronRight
        className={cn(
          "text-dim hidden size-5 transition-transform group-hover:translate-x-0.5 md:col-start-5 md:block",
          wide,
        )}
        aria-hidden
      />
    </Link>
  );
}

/** The photos that go with a report: a small camera and their number. */
function PhotoCount({ count: photos }: { count: number }) {
  if (!photos) return null;
  return (
    <span
      title={count(photos, "photo")}
      className="text-dim inline-flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums"
    >
      <Camera className="size-4" aria-hidden />
      {photos}
      <span className="sr-only"> {photos > 1 ? "photos" : "photo"}</span>
    </span>
  );
}

/** Any earlier day: a report forgotten last week, or one to read again. */
function OtherDateSheet({
  open,
  onClose,
  today,
  hasReport,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  hasReport: (day: string) => boolean;
  onChoose: (day: string) => void;
}) {
  const [day, setDay] = useState(() => shiftDay(today, -1));
  const valid = isRealDay(day) && day <= today;
  const exists = valid && hasReport(day);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Choisir une date"
      description="Pour écrire le rapport d'une journée passée, ou retrouver celui d'une date précise."
      footer={
        <Button size="lg" disabled={!valid} onClick={() => onChoose(day)}>
          {exists ? "Ouvrir le rapport" : "Commencer le rapport"}
        </Button>
      }
    >
      <Field
        label="Date du rapport"
        error={valid || !day ? null : "Choisissez une date passée ou celle d'aujourd'hui."}
        hint={
          valid
            ? `${capitalize(formatFullDay(day))}${exists ? "\u00a0: un rapport existe déjà." : ""}`
            : undefined
        }
      >
        <Input
          type="date"
          value={day}
          max={today}
          onChange={(event) => setDay(event.target.value)}
        />
      </Field>
    </Sheet>
  );
}
