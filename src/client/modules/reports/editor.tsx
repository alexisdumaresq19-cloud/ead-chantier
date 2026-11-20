import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Mic, TriangleAlert, WifiOff } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Redirect, useParams, useSearch } from "wouter";

import type { DictationField } from "@/shared/dictation";
import {
  isRealDay,
  REPORT_LIMITS,
  sameContent,
  WEATHER_CONDITIONS,
  WEATHER_LABELS,
  type Report,
  type ReportContent,
  type SavedReport,
} from "@/shared/reports";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { useAssistant } from "../../lib/assistant";
import { cn } from "../../lib/cn";
import { count, formatWeekday } from "../../lib/format";
import { navigate } from "../../lib/location";
import { useOnline } from "../../lib/online";
import { keys, useCurrentProject, useCurrentUser } from "../../lib/session";
import { Page } from "../../shell/page";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  confirmAction,
  FormError,
  Input,
  Textarea,
  toast,
} from "../../ui";
import { authorHas, ClashSheet, type Clash } from "./clash";
import { CrewEditor } from "./crew";
import {
  reportKeys,
  reportsPath,
  useDayReport,
  useMembers,
  useReport,
  useStillShown,
  useToday,
} from "./data";
import { DictationCard, DictationSheet } from "./dictation/sheet";
import { canKeepDrafts, draftKey, readDraft, removeDraft, writeDraft, type Draft } from "./drafts";
import { Fetched } from "./fetched";
import {
  checkForm,
  emptyForm,
  formFromReport,
  formSignature,
  formTotals,
  isBlankForm,
  type FormProblem,
  type ReportForm,
} from "./form";
import { capitalize, formatFullDay, formatHours, shiftDay } from "./lib";
import { ReportMissing } from "./missing";
import { DraftStatus, Notice } from "./status";
import { WEATHER_ICONS } from "./weather";

// Writing a report: one form to scroll through, with large controls. What is
// typed is kept on the device at every change (see drafts.ts) and sent only
// by "Enregistrer".

/** /rapports/nouveau?jour=2026-10-01 — today when the day is missing or impossible. */
export function NewReportScreen() {
  const project = useCurrentProject();
  const me = useCurrentUser();
  const today = useToday();
  const asked = new URLSearchParams(useSearch()).get("jour") ?? "";
  const day = isRealDay(asked) && asked <= today ? asked : today;
  // Read once, when the screen opens: from then on the form is the draft.
  const [draft] = useState(() => readDraft(draftKey(me.id, project.id, day)));
  return <Editor reportId={null} report={undefined} initialDay={day} draft={draft} />;
}

/** /rapports/:reportId/modifier */
export function EditReportScreen() {
  const { reportId } = useParams<{ reportId: string }>();
  return <EditReport key={reportId} reportId={reportId} />;
}

function EditReport({ reportId }: { reportId: string }) {
  const project = useCurrentProject();
  const me = useCurrentUser();
  const report = useReport(project.id, reportId);
  const [draft] = useState(() => readDraft(draftKey(me.id, project.id, reportId)));

  // With a draft on the device, the form opens even if the report cannot be fetched.
  if (report.data === undefined && !draft) {
    const back = { href: reportsPath(project.id), label: "Rapports" };
    if (report.error instanceof ApiFailure && report.error.status === 404) return <ReportMissing />;
    return (
      <Page title="Modifier le rapport" back={back} narrow>
        <Fetched query={report}>{() => null}</Fetched>
      </Page>
    );
  }
  return (
    <Editor
      reportId={reportId}
      report={report.data}
      initialDay={report.data?.day ?? draft?.form.day ?? ""}
      draft={draft}
    />
  );
}

type SaveJob = {
  content: ReportContent;
  /** The saved report to replace, at the version it was read; null to create one. */
  over: { id: string; version: string | null } | null;
};

function Editor({
  reportId,
  report,
  initialDay,
  draft,
}: {
  /** The saved report being changed; null while writing a new one. */
  reportId: string | null;
  /** Its saved version, once fetched. */
  report: Report | undefined;
  initialDay: string;
  /** What was typed earlier on this device and not saved. */
  draft: Draft | null;
}) {
  const project = useCurrentProject();
  const me = useCurrentUser();
  const today = useToday();
  const online = useOnline();
  const client = useQueryClient();
  const stillShown = useStillShown();
  const base = reportsPath(project.id);

  const [form, setForm] = useState<ReportForm>(
    () => draft?.form ?? (report ? formFromReport(report) : emptyForm(initialDay)),
  );
  // The date field holds whatever is being typed; the form only takes real days.
  const [dayText, setDayText] = useState(form.day);
  const [keepsDrafts] = useState(canKeepDrafts);
  const [finished, setFinished] = useState(false);
  const [checked, setChecked] = useState(false);
  const [refusedDay, setRefusedDay] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [clash, setClash] = useState<Clash | null>(null);
  // Dictating: closed, open, or open with the recording started by the same tap.
  // "?dicter=1" comes from a "Dicter" button elsewhere (the project's home, the
  // list): that tap starts the recording, and the mark then leaves the address
  // so that reloading the page does not.
  const [dictating, setDictating] = useState<"closed" | "open" | "recording">(() =>
    new URLSearchParams(window.location.search).get("dicter") === "1" ? "recording" : "closed",
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("dicter")) return;
    url.searchParams.delete("dicter");
    navigate(url.pathname + url.search, { replace: true });
  }, []);
  // The parts of the report filled by voice, marked so the person checks them.
  const [dictated, setDictated] = useState<DictationField[]>([]);
  const canDictate = useAssistant().data?.dictation === true;
  // The draft the form was filled from, for the notice that says so.
  const [restored, setRestored] = useState(draft);

  // The saved version the form started from. A draft remembers its own; what
  // that version said is known once the report is fetched.
  const saved = useMemo(
    () =>
      report
        ? { version: report.updatedAt, signature: formSignature(formFromReport(report)) }
        : null,
    [report],
  );
  const [baseline, setBaseline] = useState<{ version: string | null; signature: string | null }>(
    () =>
      draft
        ? { version: draft.baseUpdatedAt, signature: null }
        : (saved ?? { version: null, signature: null }),
  );
  const signature = formSignature(form);
  const dirty = reportId ? signature !== baseline.signature : !isBlankForm(form);

  // The saved report has arrived, or changed since. The form follows it,
  // unless that would discard what was typed here: then saving settles it.
  if (saved && report && (saved.version !== baseline.version || baseline.signature === null)) {
    if (saved.version === baseline.version || signature === saved.signature) {
      setBaseline(saved);
    } else if (!dirty) {
      setBaseline(saved);
      setForm(formFromReport(report));
      setDayText(report.day);
    }
  }

  const key = draftKey(me.id, project.id, reportId ?? form.day);
  useEffect(() => {
    if (finished) return;
    if (!dirty) {
      removeDraft(key);
      return;
    }
    const kept = readDraft(key);
    const same =
      kept?.baseUpdatedAt === baseline.version &&
      JSON.stringify(kept.form) === JSON.stringify(form);
    // Opening a draft does not make it newer.
    if (!same)
      writeDraft(key, {
        savedAt: new Date().toISOString(),
        reportId,
        baseUpdatedAt: baseline.version,
        form,
      });
  }, [finished, dirty, key, form, reportId, baseline.version]);

  const members = useMembers(project.id);
  const dayReport = useDayReport(project.id, form.day, isRealDay(form.day));
  const sameDay = dayReport.data?.report ?? null;
  const takenBy = sameDay && sameDay.id !== reportId ? sameDay : null;

  const save = useMutation({
    mutationFn: async ({ content, over }: SaveJob): Promise<{ saved: Report } | Clash> => {
      if (!over) {
        const { report: theirs, created } = await api<SavedReport>(
          `/api/projects/${project.id}/reports`,
          { method: "POST", body: content },
        );
        // The day already had a report. If it says the same thing, it is this
        // very save, received twice.
        return created || sameContent(theirs, content)
          ? { saved: theirs }
          : { kind: "exists", latest: theirs, mine: content };
      }
      try {
        const body = { ...content, baseUpdatedAt: over.version };
        return { saved: await api<Report>(`/api/reports/${over.id}`, { method: "PATCH", body }) };
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 404) return { kind: "deleted", mine: content };
        if (error.code !== "conflict") throw error;
        const latest = await api<Report>(`/api/reports/${over.id}`);
        return sameContent(latest, content)
          ? { saved: latest }
          : { kind: "changed", latest, mine: content };
      }
    },
    onMutate: () => {
      setSavedOffline(false);
      setRefusedDay(null);
    },
    onSuccess: (outcome) => {
      if ("kind" in outcome) {
        setClash(outcome);
        return;
      }
      leaveWith(outcome.saved);
      toast.success("Rapport enregistré");
    },
    onError: (error, { content }) => {
      if (error instanceof ApiFailure && error.offline) {
        setSavedOffline(true);
        toast.warning("Pas de réseau. Le rapport reste sur cet appareil.");
      } else if (error instanceof ApiFailure && error.code === "day_taken")
        setRefusedDay(content.day);
      else toast.error(errorMessage(error));
    },
  });

  /** The draft has served: on to the report as it is saved. */
  function leaveWith(latest: Report | null) {
    setFinished(true);
    setClash(null);
    removeDraft(key);
    if (latest) client.setQueryData(reportKeys.one(project.id, latest.id), latest);
    void client.invalidateQueries({ queryKey: keys.project(project.id) });
    if (stillShown.current) navigate(latest ? `${base}/${latest.id}` : base, { replace: true });
  }

  // What is still being typed in the date field is not a day yet.
  const unfinishedDay: FormProblem[] =
    dayText === form.day ? [] : [{ where: "day", message: "Choisissez une date." }];
  const dayTaken =
    takenBy && reportId
      ? "Un rapport existe déjà pour cette journée. Choisissez une autre date."
      : refusedDay === form.day
        ? "Un rapport existe déjà pour cette journée."
        : null;
  const problems: FormProblem[] = [
    ...unfinishedDay,
    ...(dayTaken ? [{ where: "day" as const, message: dayTaken }] : []),
    ...(checked ? checkForm(form, today).problems : []),
  ];
  const problemAt = (where: FormProblem["where"]) =>
    problems.find((problem) => problem.where === where)?.message;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const check = checkForm(form, today);
    const [first] = [...unfinishedDay, ...check.problems];
    if (first || !check.content) {
      setChecked(true);
      const id =
        !first || first.where === "form"
          ? null
          : first.where === "crew"
            ? `crew-${first.rowKey}`
            : `report-${first.where}`;
      const field = id ? document.getElementById(id) : null;
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus({ preventScroll: true });
      // Nothing to point at: said where the person is looking, wherever that is.
      if (first && !field) toast.error(first.message);
      return;
    }
    save.mutate({
      content: check.content,
      over: reportId ? { id: reportId, version: baseline.version } : null,
    });
  };

  /** In a new report, the day decides where the draft is kept and what the address says. */
  const changeDay = async (text: string) => {
    if (!isRealDay(text) || text === form.day) {
      setDayText(text);
      return;
    }
    if (!reportId) {
      // That day may have a draft of its own, started earlier on this device:
      // it is taken up again, or replaced only if the person says so.
      const waiting = readDraft(draftKey(me.id, project.id, text));
      if (waiting && dirty) {
        const replace = await confirmAction({
          title: `Remplacer le brouillon du ${formatWeekday(text)}?`,
          text: "Un brouillon existe déjà sur cet appareil pour cette journée. Il sera remplacé par ce que vous avez écrit ici.",
          confirmLabel: "Remplacer",
          danger: true,
        });
        if (!replace) return;
      }
      removeDraft(key);
      if (text <= today) navigate(`${base}/nouveau?jour=${text}`, { replace: true });
      if (waiting && !dirty) {
        setRestored(waiting);
        setForm(waiting.form);
        setDayText(text);
        return;
      }
    }
    setDayText(text);
    setForm((current) => ({ ...current, day: text }));
  };

  const discard = async () => {
    const sure = await confirmAction({
      title: "Effacer le brouillon?",
      text: reportId
        ? "Vos changements seront perdus. Le rapport restera tel qu'il est enregistré."
        : "Ce que vous avez écrit pour cette journée sera perdu.",
      confirmLabel: "Effacer",
      danger: true,
    });
    if (!sure) return;
    setChecked(false);
    setRestored(null);
    removeDraft(key);
    if (!reportId) setForm(emptyForm(form.day));
    else if (report && saved) {
      setBaseline(saved);
      setForm(formFromReport(report));
      setDayText(report.day);
    } else leaveWith(null);
  };

  const set = (change: Partial<ReportForm>) => setForm((current) => ({ ...current, ...change }));
  const below = /^\s*[-−–]/.test(form.temperature);
  const flipSign = () => {
    const digits = form.temperature.trim().replace(/^[-−–+]\s*/, "");
    set({ temperature: below ? digits : `-${digits}` });
    document.getElementById("report-temperature")?.focus();
  };
  // "Enter" on a phone keyboard closes the keyboard; only the button saves.
  const keepEnterFromSaving = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    event.target.blur();
  };

  // A day that already has a report leads to that report, unless something
  // written here would be left behind.
  if (!reportId && sameDay && !dirty && !dayReport.isFetching && !finished)
    return <Redirect to={`${base}/${sameDay.id}/modifier`} replace />;

  const totals = formTotals(form);
  const relative =
    form.day === today ? " (aujourd'hui)" : form.day === shiftDay(today, -1) ? " (hier)" : "";

  return (
    <Page
      title={reportId ? "Modifier le rapport" : "Nouveau rapport"}
      subtitle={isRealDay(form.day) ? capitalize(formatFullDay(form.day)) : undefined}
      back={
        reportId
          ? { href: `${base}/${reportId}`, label: "Rapport" }
          : { href: base, label: "Rapports" }
      }
      narrow
    >
      <form onSubmit={submit} onKeyDown={keepEnterFromSaving} noValidate className="space-y-3">
        <DraftStatus
          dirty={dirty}
          restored={restored}
          keepsDrafts={keepsDrafts}
          online={online}
          onDiscard={discard}
        />

        {takenBy && !reportId ? (
          <Notice tone="warn" icon={<TriangleAlert aria-hidden />}>
            <p>
              {authorHas(takenBy, me.id)} déjà enregistré un rapport pour cette journée. Une journée
              n&apos;a qu&apos;un rapport.
            </p>
            <ButtonLink href={`${base}/${takenBy.id}`} variant="secondary" className="mt-2">
              Voir ce rapport
            </ButtonLink>
          </Notice>
        ) : null}

        {canDictate && !(takenBy && !reportId) ? (
          <DictationCard onOpen={(record) => setDictating(record ? "recording" : "open")} />
        ) : null}

        <Block title="Date">
          <Input
            id="report-day"
            type="date"
            value={dayText}
            max={today}
            onChange={(event) => changeDay(event.target.value)}
            aria-label="Date du rapport"
            aria-invalid={Boolean(problemAt("day"))}
            className="sm:max-w-64"
          />
          {problemAt("day") ? (
            <FieldProblem>{problemAt("day")}</FieldProblem>
          ) : (
            <p className="text-dim mt-1.5 text-sm">
              {capitalize(formatWeekday(form.day))}
              {relative}
            </p>
          )}
        </Block>

        <Block title="Météo" dictated={dictated.includes("weather")}>
          <div role="group" aria-label="Temps qu'il a fait" className="grid grid-cols-3 gap-2">
            {WEATHER_CONDITIONS.map((condition) => {
              const Icon = WEATHER_ICONS[condition];
              const chosen = form.condition === condition;
              return (
                <button
                  key={condition}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => set({ condition: chosen ? null : condition })}
                  className={cn(
                    "flex min-h-19 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors sm:min-h-21",
                    chosen
                      ? "border-ead-dark bg-ead-dark text-white shadow-sm"
                      : "border-line bg-surface hover:border-ead/60 active:bg-ead-tint",
                  )}
                >
                  <Icon className={cn("size-7", !chosen && "text-ead-dark")} aria-hidden />
                  {WEATHER_LABELS[condition]}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-end gap-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Température</span>
              <span className="relative block w-32">
                <Input
                  id="report-temperature"
                  value={form.temperature}
                  onChange={(event) => set({ temperature: event.target.value })}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  aria-invalid={Boolean(problemAt("temperature"))}
                  className="font-display pr-11 text-center text-lg font-bold tabular-nums"
                />
                <span className="text-dim pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-semibold">
                  °C
                </span>
              </span>
            </label>
            {/* A phone's number pad has no minus sign. */}
            <Button
              variant="secondary"
              aria-pressed={below}
              onClick={flipSign}
              className={cn("h-12", below && "border-ead-dark bg-ead-tint text-ead-dark")}
            >
              Sous zéro
            </Button>
          </div>
          {problemAt("temperature") ? (
            <FieldProblem>{problemAt("temperature")}</FieldProblem>
          ) : null}

          <label className="mt-4 block">
            <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold">
              Note sur la météo <span className="text-dim font-normal">Facultatif</span>
            </span>
            <Input
              value={form.weatherNote}
              onChange={(event) => set({ weatherNote: event.target.value })}
              maxLength={REPORT_LIMITS.weatherNote}
              placeholder="Vent fort en après-midi, averses…"
            />
          </label>
        </Block>

        <Block
          title="Équipe"
          dictated={dictated.includes("crew")}
          aside={
            totals.people > 0 ? (
              <span className="text-dim text-sm font-medium">
                {count(totals.people, "personne")} · {formatHours(totals.hours)}
              </span>
            ) : null
          }
        >
          <CrewEditor
            form={form}
            setForm={setForm}
            problems={problems}
            members={members}
            previous={dayReport.data?.previous ?? null}
            today={today}
          />
        </Block>

        <Block
          title="Équipement"
          hint="La machinerie et l'outillage utilisés ce jour-là."
          dictated={dictated.includes("equipment")}
        >
          <Textarea
            value={form.equipment}
            onChange={(event) => set({ equipment: event.target.value })}
            maxLength={REPORT_LIMITS.equipment}
            rows={3}
            aria-label="Équipement"
            placeholder="Pelle, chargeuse, camion 10 roues, compacteur…"
            className={cn(GROWS, "min-h-24")}
          />
        </Block>

        <Block title="Travaux réalisés" dictated={dictated.includes("workDone")}>
          <Textarea
            value={form.workDone}
            onChange={(event) => set({ workDone: event.target.value })}
            maxLength={REPORT_LIMITS.text}
            rows={6}
            aria-label="Travaux réalisés"
            placeholder="Ce qui a été fait, et où."
            className={cn(GROWS, "min-h-40")}
          />
          {form.crew.length === 0 && !form.workDone.trim() ? (
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => set({ workDone: "Chantier fermé." })}
            >
              Inscrire «&nbsp;Chantier fermé&nbsp;»
            </Button>
          ) : null}
        </Block>

        <Block
          title="Notes"
          hint="Retards, incidents, visiteurs, directives reçues."
          dictated={dictated.includes("notes")}
        >
          <Textarea
            value={form.notes}
            onChange={(event) => set({ notes: event.target.value })}
            maxLength={REPORT_LIMITS.text}
            rows={4}
            aria-label="Notes"
            className={cn(GROWS, "min-h-28")}
          />
        </Block>

        {savedOffline ? (
          <Notice
            tone={online ? "good" : "warn"}
            icon={online ? <CircleCheck aria-hidden /> : <WifiOff aria-hidden />}
          >
            {online
              ? "Le réseau est revenu. Vous pouvez enregistrer le rapport."
              : "Pas de réseau\u00a0: le rapport n'a pas été envoyé. Il est gardé sur cet appareil. Enregistrez-le quand le réseau sera revenu."}
          </Notice>
        ) : null}
        <FormError>
          {problemAt("form") ??
            (problems.length > 0 && checked
              ? "Corrigez ce qui est indiqué en rouge, puis enregistrez."
              : null)}
        </FormError>

        {/* Stays above the tabs of a phone, so saving is always one tap away. */}
        <div className="from-canvas sticky bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-20 -mx-4 bg-linear-to-t from-60% to-transparent px-4 pt-3 pb-2 sm:-mx-6 sm:px-6 lg:bottom-0 lg:pb-4">
          <div className="border-line bg-surface/95 flex items-center gap-3 rounded-2xl border py-2.5 pr-2.5 pl-4 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1">
              <p className="text-dim text-xs font-semibold tracking-wide uppercase">Total</p>
              <p className="font-display truncate text-lg leading-tight font-bold">
                {formatHours(totals.hours)}
                <span className="text-dim font-sans text-sm font-medium">
                  {" "}
                  · {totals.people > 0 ? count(totals.people, "personne") : "aucune personne"}
                </span>
              </p>
            </div>
            <Button type="submit" size="lg" loading={save.isPending}>
              Enregistrer
            </Button>
          </div>
        </div>
      </form>

      {/* An open window stays, whatever becomes of the service: it holds what was said. */}
      {canDictate || dictating !== "closed" ? (
        <DictationSheet
          open={dictating !== "closed"}
          onClose={() => setDictating("closed")}
          projectId={project.id}
          form={form}
          startRecording={dictating === "recording"}
          onApply={(next, changed) => {
            setForm(next);
            // Putting a dictation back (nothing changed) clears the marks.
            setDictated((fields) =>
              changed.length === 0 ? [] : [...new Set([...fields, ...changed])],
            );
          }}
        />
      ) : null}

      <ClashSheet
        clash={clash}
        onClose={() => setClash(null)}
        onReplace={(latest, mine) => {
          setClash(null);
          save.mutate({ content: mine, over: { id: latest.id, version: latest.updatedAt } });
        }}
        onSaveAsNew={(mine) => {
          setClash(null);
          save.mutate({ content: mine, over: null });
        }}
        onLeave={leaveWith}
        myId={me.id}
      />
    </Page>
  );
}

/** Grows with the text where the browser can; long reports scroll inside otherwise. */
const GROWS = "field-sizing-content max-h-[70dvh] resize-none";

function Block({
  title,
  aside,
  hint,
  dictated,
  children,
}: {
  title: string;
  aside?: ReactNode;
  hint?: string;
  /** Filled by voice: marked, so the person reads it over before saving. */
  dictated?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn("p-4 sm:p-5", dictated && "ring-ead/40 ring-2")}>
      <div className="mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display flex items-center gap-2 text-lg leading-tight font-bold">
            {title}
            {dictated ? (
              <Badge tone="blue">
                <Mic aria-hidden />
                Dicté
              </Badge>
            ) : null}
          </h2>
          {aside}
        </div>
        {hint ? <p className="text-dim mt-0.5 text-sm">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}

const FieldProblem = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="text-bad mt-1.5 text-sm font-medium">
    {children}
  </p>
);
