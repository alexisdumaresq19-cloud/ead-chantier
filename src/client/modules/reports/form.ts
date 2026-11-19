import {
  FIRST_REPORT_DAY,
  isEmptyContent,
  isRealDay,
  isValidHours,
  REPORT_LIMITS,
  type CrewLine,
  type ReportContent,
  type WeatherCondition,
} from "@/shared/reports";

import { hoursText, parseHours, parseTemperature } from "./lib";

// The report as it is being typed: numbers are still text ("7,5"), and each
// crew line remembers whether its hours were written by hand. Everything here
// is plain data in, plain data out, so the screen only has to draw it.

export const DEFAULT_HOURS = 8;

export type CrewRow = {
  /** Names the line on screen; never sent. */
  key: string;
  userId: string | null;
  name: string;
  /** As typed. */
  hours: string;
  /** Written by hand for this person: changing the hours of the day leaves it alone. */
  own: boolean;
};

export type ReportForm = {
  day: string;
  condition: WeatherCondition | null;
  temperature: string;
  weatherNote: string;
  /** The hours of the day, given to each person added. */
  dayHours: string;
  crew: CrewRow[];
  equipment: string;
  workDone: string;
  notes: string;
};

const newKey = () => Math.random().toString(36).slice(2, 10);

export const emptyForm = (day: string): ReportForm => ({
  day,
  condition: null,
  temperature: "",
  weatherNote: "",
  dayHours: hoursText(DEFAULT_HOURS),
  crew: [],
  equipment: "",
  workDone: "",
  notes: "",
});

/** The hours most of the crew did (the longer day on a tie); 8 without a crew. */
export function usualHours(crew: Pick<CrewLine, "hours">[]): number {
  const counts = new Map<number, number>();
  for (const { hours } of crew) counts.set(hours, (counts.get(hours) ?? 0) + 1);
  let usual = DEFAULT_HOURS;
  let most = 0;
  for (const [hours, count] of counts) {
    if (count > most || (count === most && hours > usual)) {
      usual = hours;
      most = count;
    }
  }
  return usual;
}

const rowFromLine = (line: CrewLine, usual: number): CrewRow => ({
  key: newKey(),
  userId: line.userId,
  name: line.name,
  hours: hoursText(line.hours),
  own: line.hours !== usual,
});

export function formFromReport(report: ReportContent): ReportForm {
  const usual = usualHours(report.crew);
  return {
    day: report.day,
    condition: report.weather.condition,
    temperature: report.weather.temperatureC === null ? "" : String(report.weather.temperatureC),
    weatherNote: report.weather.note,
    dayHours: hoursText(usual),
    crew: report.crew.map((line) => rowFromLine(line, usual)),
    equipment: report.equipment,
    workDone: report.workDone,
    notes: report.notes,
  };
}

/** Nothing has been written yet (the date alone does not count). */
export const isBlankForm = (form: ReportForm) =>
  !form.condition &&
  !form.temperature.trim() &&
  !form.weatherNote.trim() &&
  form.crew.length === 0 &&
  !form.equipment.trim() &&
  !form.workDone.trim() &&
  !form.notes.trim();

/** Two forms with the same signature would save the same report. */
export const formSignature = (form: ReportForm) =>
  JSON.stringify([
    form.day,
    form.condition,
    parseTemperature(form.temperature),
    form.weatherNote.trim(),
    form.crew.map((row) => [row.userId, row.name.trim(), parseHours(row.hours) ?? row.hours]),
    form.equipment.trim(),
    form.workDone.trim(),
    form.notes.trim(),
  ]);

// --- The crew ---------------------------------------------------------------

const plain = (name: string) => name.trim().toLocaleLowerCase("fr");
const isFull = (form: ReportForm) => form.crew.length >= REPORT_LIMITS.crew;

/** Adds a person of the project, with the hours of the day. Once only. */
export function addMember(form: ReportForm, member: { id: string; name: string }): ReportForm {
  if (isFull(form) || form.crew.some((row) => row.userId === member.id)) return form;
  const row = { key: newKey(), userId: member.id, name: member.name, hours: form.dayHours };
  return { ...form, crew: [...form.crew, { ...row, own: false }] };
}

/** Adds a line to write a name in (a subcontractor, a visitor). */
export function addBlankRow(form: ReportForm): { form: ReportForm; key: string | null } {
  if (isFull(form)) return { form, key: null };
  const key = newKey();
  const row = { key, userId: null, name: "", hours: form.dayHours, own: false };
  return { form: { ...form, crew: [...form.crew, row] }, key };
}

export const removeRow = (form: ReportForm, key: string): ReportForm => ({
  ...form,
  crew: form.crew.filter((row) => row.key !== key),
});

const changeRow = (form: ReportForm, key: string, change: Partial<CrewRow>): ReportForm => ({
  ...form,
  crew: form.crew.map((row) => (row.key === key ? { ...row, ...change } : row)),
});

export const setRowName = (form: ReportForm, key: string, name: string) =>
  changeRow(form, key, { name });

export const setRowHours = (form: ReportForm, key: string, hours: string) =>
  changeRow(form, key, { hours, own: parseHours(hours) !== parseHours(form.dayHours) });

/** Changes the hours of the day: everyone follows, except hours written by hand. */
export const setDayHours = (form: ReportForm, dayHours: string): ReportForm => ({
  ...form,
  dayHours,
  crew: form.crew.map((row) => (row.own ? row : { ...row, hours: dayHours })),
});

/** Half an hour more or less, between 0 and 24. */
export function stepDayHours(form: ReportForm, step: number): ReportForm {
  const current = parseHours(form.dayHours) ?? DEFAULT_HOURS;
  return setDayHours(form, hoursText(Math.min(24, Math.max(0, current + step))));
}

/**
 * Takes the crew of an earlier report. Into an empty list it comes as it was,
 * hours included; into a list already started, only the people missing are added.
 */
export function takeCrew(form: ReportForm, crew: CrewLine[]): { form: ReportForm; added: number } {
  const startingFresh = form.crew.length === 0;
  const usual = startingFresh ? usualHours(crew) : (parseHours(form.dayHours) ?? DEFAULT_HOURS);
  const ids = new Set(form.crew.flatMap((row) => row.userId ?? []));
  const names = new Set(form.crew.map((row) => plain(row.name)));
  const missing = crew
    .filter((line) => (line.userId ? !ids.has(line.userId) : !names.has(plain(line.name))))
    .slice(0, REPORT_LIMITS.crew - form.crew.length);
  return {
    form: {
      ...form,
      dayHours: startingFresh ? hoursText(usual) : form.dayHours,
      crew: [...form.crew, ...missing.map((line) => rowFromLine(line, usual))],
    },
    added: missing.length,
  };
}

/** The people and hours the report would be saved with. */
export function formTotals(form: ReportForm): { people: number; hours: number } {
  let people = 0;
  let hours = 0;
  for (const row of form.crew) {
    if (!row.name.trim()) continue;
    people++;
    const value = parseHours(row.hours);
    if (value !== null && isValidHours(value)) hours += value;
  }
  return { people, hours };
}

// --- Before saving ----------------------------------------------------------

export type FormProblem = {
  where: "day" | "temperature" | "crew" | "form";
  /** The crew line concerned. */
  rowKey?: string;
  message: string;
};

/**
 * What the form would send, or what must be corrected first. Lines without a
 * name are left out, unless hours were written on them.
 */
export function checkForm(
  form: ReportForm,
  today: string,
): { content: ReportContent | null; problems: FormProblem[] } {
  const problems: FormProblem[] = [];

  if (!isRealDay(form.day)) problems.push({ where: "day", message: "Choisissez une date." });
  else if (form.day > today)
    problems.push({
      where: "day",
      message: "Un rapport ne peut pas porter sur une journée à venir.",
    });
  else if (form.day < FIRST_REPORT_DAY)
    problems.push({ where: "day", message: "Vérifiez l'année de la date." });

  const temperatureC = parseTemperature(form.temperature);
  if (temperatureC === "invalid")
    problems.push({
      where: "temperature",
      message: `Température à vérifier (entre −${-REPORT_LIMITS.temperatureMin} et ${REPORT_LIMITS.temperatureMax}\u00a0°C).`,
    });

  const crew: CrewLine[] = [];
  for (const row of form.crew) {
    const name = row.name.trim();
    if (!name) {
      if (row.own) problems.push({ where: "crew", rowKey: row.key, message: "Inscrivez le nom." });
      continue;
    }
    const hours = parseHours(row.hours);
    if (hours === null || !isValidHours(hours)) {
      problems.push({
        where: "crew",
        rowKey: row.key,
        message: row.hours.trim()
          ? "Heures entre 0 et 24, au quart d'heure (7,25 · 7,5 · 7,75)."
          : "Inscrivez les heures.",
      });
      continue;
    }
    crew.push({ name, hours, userId: row.userId });
  }

  const content: ReportContent = {
    day: form.day,
    weather: {
      condition: form.condition,
      temperatureC: temperatureC === "invalid" ? null : temperatureC,
      note: form.weatherNote.trim(),
    },
    crew,
    equipment: form.equipment.trim(),
    workDone: form.workDone.trim(),
    notes: form.notes.trim(),
  };
  if (problems.length === 0 && isEmptyContent(content))
    problems.push({
      where: "form",
      message: "Le rapport est vide. Inscrivez au moins la météo ou les travaux.",
    });

  return problems.length ? { content: null, problems } : { content, problems };
}
