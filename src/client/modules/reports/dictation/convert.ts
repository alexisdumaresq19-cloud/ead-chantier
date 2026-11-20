import {
  DICTATION_FIELD_LABELS,
  type DictationField,
  type DictationPhoto,
} from "@/shared/dictation";
import {
  isValidHours,
  REPORT_LIMITS,
  WEATHER_LABELS,
  type CrewLine,
  type ReportContent,
} from "@/shared/reports";

import { count } from "../../../lib/format";
import { usualHours, type CrewRow, type ReportForm } from "../form";
import { formatHours, formatTemperature, hoursText, parseHours, parseTemperature } from "../lib";
import type { ReportPhoto } from "../photos";

// Between the form being typed and the report the dictation works on. The
// form may hold anything (half a number, a line without a name): what cannot
// be read yet is simply left out, so dictating never waits on a correction.

const plain = (name: string) => name.trim().toLocaleLowerCase("fr");
const newKey = () => Math.random().toString(36).slice(2, 10);

/** The form as a report, for the dictation: unreadable numbers count as not given. */
export function contentForDictation(form: ReportForm): ReportContent {
  const temperature = parseTemperature(form.temperature);
  const crew: CrewLine[] = [];
  for (const row of form.crew) {
    const name = row.name.trim().slice(0, REPORT_LIMITS.name);
    if (!name || crew.length >= REPORT_LIMITS.crew) continue;
    const hours = parseHours(row.hours);
    // Zero stands for "hours not given yet" on the way to the dictation.
    crew.push({
      name,
      hours: hours !== null && isValidHours(hours) ? hours : 0,
      userId: row.userId,
    });
  }
  return {
    day: form.day,
    weather: {
      condition: form.condition,
      temperatureC: temperature === "invalid" ? null : temperature,
      note: form.weatherNote.slice(0, REPORT_LIMITS.weatherNote),
    },
    crew,
    equipment: form.equipment.slice(0, REPORT_LIMITS.equipment),
    workDone: form.workDone.slice(0, REPORT_LIMITS.text),
    notes: form.notes.slice(0, REPORT_LIMITS.text),
    photoIds: form.photoIds.slice(0, REPORT_LIMITS.photos),
  };
}

/**
 * The form once a dictation has been applied. Lines already there keep their
 * place and what was typed on them; a person named without hours gets an
 * empty hours field, which the form then asks for.
 */
export function formAfterDictation(form: ReportForm, content: ReportContent): ReportForm {
  const before = contentForDictation(form);

  // A crew dictated into an empty list sets the hours of the day.
  const given = content.crew.filter((line) => line.hours > 0);
  const dayHours =
    form.crew.some((row) => row.name.trim()) || given.length === 0
      ? form.dayHours
      : hoursText(usualHours(given));
  const usual = parseHours(dayHours);

  const rows = form.crew.filter((row) => row.name.trim());
  const taken = new Set<string>();
  const crew: CrewRow[] = content.crew.map((line) => {
    const row = rows.find(
      (candidate) =>
        !taken.has(candidate.key) &&
        (line.userId
          ? candidate.userId === line.userId
          : !candidate.userId && plain(candidate.name) === plain(line.name)),
    );
    const hours = line.hours > 0 ? hoursText(line.hours) : "";
    if (!row)
      return {
        key: newKey(),
        userId: line.userId,
        name: line.name,
        hours,
        own: line.hours !== usual,
      };
    taken.add(row.key);
    const typed = parseHours(row.hours);
    // Hours left as typed when the dictation did not change them ("7 h 30" stays "7 h 30").
    const untouched = (typed !== null && isValidHours(typed) ? typed : 0) === line.hours;
    return untouched
      ? { ...row, name: line.name }
      : { ...row, name: line.name, hours, own: line.hours !== usual };
  });

  const temperature =
    content.weather.temperatureC === before.weather.temperatureC
      ? form.temperature
      : content.weather.temperatureC === null
        ? ""
        : String(content.weather.temperatureC);

  return {
    ...form,
    condition: content.weather.condition,
    temperature,
    weatherNote: content.weather.note,
    dayHours,
    crew,
    equipment: content.equipment,
    workDone: content.workDone,
    notes: content.notes,
  };
}

/**
 * A form from an earlier moment (the one a request left with, the one a turn
 * puts back) laid over the form as it is now. The photos stay those the
 * report has now: one taken in the meantime goes with the report all the same.
 */
export const keepingPhotos = (earlier: ReportForm, now: ReportForm): ReportForm => ({
  ...earlier,
  photoIds: now.photoIds,
});

const NBSP = "\u00a0";
/** People named one by one in an answer; the others are counted. */
const PEOPLE_SHOWN = 4;

/**
 * What a dictation understood, as the short labels of its answer: the values
 * themselves ("Soleil, −2 °C", "Marc Lévesque · 10 h"), so the person checks
 * them without leaving the window. `before` is the report the dictation
 * worked on, `after` the one it gave back.
 */
export function dictationChips(
  before: ReportContent,
  after: ReportContent,
  changed: DictationField[],
): string[] {
  const chips: string[] = [];
  for (const field of changed) {
    if (field === "weather") chips.push(weatherChip(after));
    else if (field === "crew") chips.push(...crewChips(before.crew, after.crew));
    else {
      const was = before[field].trim();
      const now = after[field].trim();
      const what = !now ? "effacé" : !was || now.startsWith(was) ? "ajouté" : "corrigé";
      chips.push(`${DICTATION_FIELD_LABELS[field]}${NBSP}: ${what}`);
    }
  }
  return chips;
}

function weatherChip({ weather }: ReportContent): string {
  const parts = [
    weather.condition ? WEATHER_LABELS[weather.condition] : null,
    weather.temperatureC === null ? null : formatTemperature(weather.temperatureC),
  ].filter((part) => part !== null);
  if (parts.length > 0) return parts.join(", ");
  return `${DICTATION_FIELD_LABELS.weather}${NBSP}: ${weather.note ? "note ajoutée" : "effacée"}`;
}

const sameLine = (a: CrewLine, b: CrewLine) =>
  a.userId || b.userId ? a.userId === b.userId : plain(a.name) === plain(b.name);

function crewChips(before: CrewLine[], after: CrewLine[]): string[] {
  const people: string[] = [];
  for (const line of after) {
    const was = before.find((other) => sameLine(other, line));
    if (was && was.hours === line.hours && was.name === line.name) continue;
    people.push(line.hours > 0 ? `${line.name} · ${formatHours(line.hours)}` : line.name);
  }
  for (const line of before)
    if (!after.some((other) => sameLine(other, line)))
      people.push(`${DICTATION_FIELD_LABELS.crew}${NBSP}: ${line.name} en moins`);
  if (people.length === 0) return [DICTATION_FIELD_LABELS.crew];
  if (people.length <= PEOPLE_SHOWN) return people;
  const others = count(people.length - PEOPLE_SHOWN, "autre");
  return [...people.slice(0, PEOPLE_SHOWN), `+${NBSP}${others}`];
}

// --- Photos ---------------------------------------------------------------------

/** The report's photos as the assistant is told about them, numbered by their order. */
export function photosForAssistant(photos: ReportPhoto[]): DictationPhoto[] {
  return photos.map((photo) => ({
    id: photo.id,
    caption: photo.caption?.trim() || null,
    takenAt: photo.takenAt,
    onServer: photo.photo ? true : photo.local.state === "sent",
  }));
}

/** Photos the project has that still lack a description: "Décrire les photos" is for them. */
export const photosToDescribe = (photos: ReportPhoto[]) =>
  photos.filter((photo) => photo.photo && !photo.caption?.trim()).length;

/** Whether the report holds text that can be put in clean French. */
export const hasTextToTidy = (form: ReportForm) =>
  [form.equipment, form.workDone, form.notes].some((text) => text.trim());

type TextField = "equipment" | "workDone" | "notes";
const isTextField = (field: DictationField): field is TextField =>
  field === "equipment" || field === "workDone" || field === "notes";

/** What "Mettre au propre" wrote, part by part, for the person to read before saving. */
export const tidyTexts = (content: ReportContent, changed: DictationField[]) =>
  changed
    .filter(isTextField)
    .map((field) => ({ field, label: DICTATION_FIELD_LABELS[field], text: content[field] }));

/** "la photo 3", "les photos 3 et 5", "les photos 1, 2 et 4". */
export function photoNumbers(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length === 1) return `la photo ${sorted[0]}`;
  return `les photos ${sorted.slice(0, -1).join(", ")} et ${sorted.at(-1)}`;
}
