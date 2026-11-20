import { z } from "zod";

import { PHOTO_ID_PATTERN } from "@/shared/photos";
import {
  isValidHours,
  REPORT_LIMITS as LIMITS,
  WEATHER_CONDITIONS,
  type CrewLine,
  type ReportContent,
} from "@/shared/reports";
import type { DictationField } from "@/shared/dictation";

// What the model returns for a dictation, and how it lands in the report.
// The model never rewrites the report: it says what to add or change, and
// this code applies it, so that nothing already written can be lost.

/** The change to make to a report, as the model states it. */
export const dictationPatch = z.object({
  weather: z.object({
    condition: z.enum(WEATHER_CONDITIONS).nullable(),
    temperatureC: z.number().nullable(),
    note: z.string().nullable(),
  }),
  crew: z.array(
    z.object({
      name: z.string(),
      hours: z.number().nullable(),
      remove: z.boolean(),
    }),
  ),
  equipment: z.string().nullable(),
  workDone: z.string().nullable(),
  notes: z.string().nullable(),
  replace: z.object({ equipment: z.boolean(), workDone: z.boolean(), notes: z.boolean() }),
  questions: z.array(z.string()),
});

export type DictationPatch = z.infer<typeof dictationPatch>;

/**
 * The report as it stands on the person's screen when they dictate. It may
 * still be empty or unfinished, so only its shape and sizes are checked.
 */
export const reportOnScreen = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide."),
  weather: z.object({
    condition: z.enum(WEATHER_CONDITIONS).nullable(),
    temperatureC: z.number().int().min(LIMITS.temperatureMin).max(LIMITS.temperatureMax).nullable(),
    note: z.string().max(LIMITS.weatherNote),
  }),
  crew: z
    .array(
      z.object({
        name: z.string().max(LIMITS.name),
        hours: z.number().refine(isValidHours, "Heures invalides."),
        userId: z.string().max(40).nullable(),
      }),
    )
    .max(LIMITS.crew),
  equipment: z.string().max(LIMITS.equipment),
  workDone: z.string().max(LIMITS.text),
  notes: z.string().max(LIMITS.text),
  // A phone still running the version from before reports had photos sends none.
  photoIds: z.array(z.string().regex(PHOTO_ID_PATTERN)).max(LIMITS.photos).default([]),
});

export type KnownPerson = { id: string; name: string };

/** Lowercase, without accents or punctuation: "Lévesque" and "levesque" match. */
const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The one name of the list a spoken name designates: the same name, or the
 * only one sharing a first or last name with it. Null when none or several do.
 */
export function matchName<T extends { name: string }>(spoken: string, list: T[]): T | null {
  const wanted = plain(spoken);
  if (!wanted) return null;
  const exact = list.filter((entry) => plain(entry.name) === wanted);
  if (exact.length === 1) return exact[0];
  const words = new Set(wanted.split(" "));
  const sharing = list.filter((entry) =>
    plain(entry.name)
      .split(" ")
      .some((word) => words.has(word)),
  );
  return sharing.length === 1 ? sharing[0] : null;
}

/** Hours as the report takes them: to the quarter of an hour, within a day. */
const tidyHours = (hours: number) => Math.min(24, Math.max(0, Math.round(hours * 4) / 4));

const cut = (text: string, max: number) =>
  text.length > max ? text.slice(0, max).trimEnd() : text;

function addText(current: string, addition: string | null, replace: boolean, max: number): string {
  const added = addition?.trim();
  if (!added) return current;
  if (replace || !current.trim()) return cut(added, max);
  return cut(`${current.trimEnd()}\n${added}`, max);
}

/**
 * The report once the dictation is applied, the parts that changed, and the
 * questions left: the model's, plus one for each person added without hours.
 */
export function applyDictation(
  current: ReportContent,
  patch: DictationPatch,
  members: KnownPerson[],
): { content: ReportContent; changed: DictationField[]; questions: string[] } {
  const questions = patch.questions.map((question) => question.trim()).filter(Boolean);

  const weather = {
    condition: patch.weather.condition ?? current.weather.condition,
    temperatureC:
      patch.weather.temperatureC === null
        ? current.weather.temperatureC
        : Math.min(
            LIMITS.temperatureMax,
            Math.max(LIMITS.temperatureMin, Math.round(patch.weather.temperatureC)),
          ),
    note: patch.weather.note?.trim()
      ? cut(patch.weather.note.trim(), LIMITS.weatherNote)
      : current.weather.note,
  };

  let crew: CrewLine[] = current.crew.map((line) => ({ ...line }));
  for (const spoken of patch.crew) {
    const member = matchName(spoken.name, members);
    // A line already there for that person: by their account, else by name.
    const line =
      (member && crew.find((existing) => existing.userId === member.id)) ??
      matchName(spoken.name, crew);
    if (spoken.remove) {
      if (line) crew = crew.filter((existing) => existing !== line);
      continue;
    }
    const hours = spoken.hours === null ? null : tidyHours(spoken.hours);
    if (line) {
      if (hours !== null && isValidHours(hours)) line.hours = hours;
      continue;
    }
    if (crew.length >= LIMITS.crew) continue;
    const name = cut((member?.name ?? spoken.name).trim(), LIMITS.name);
    if (!name) continue;
    crew.push({ name, hours: hours ?? 0, userId: member?.id ?? null });
    if (hours === null) questions.push(`Combien d'heures pour ${name}?`);
  }

  const content: ReportContent = {
    day: current.day,
    weather,
    crew,
    equipment: addText(
      current.equipment,
      patch.equipment,
      patch.replace.equipment,
      LIMITS.equipment,
    ),
    workDone: addText(current.workDone, patch.workDone, patch.replace.workDone, LIMITS.text),
    notes: addText(current.notes, patch.notes, patch.replace.notes, LIMITS.text),
    photoIds: current.photoIds,
  };

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changed = (["weather", "crew", "equipment", "workDone", "notes"] as const).filter(
    (field) => !same(content[field], current[field]),
  );
  return { content, changed, questions: [...new Set(questions)].slice(0, 4) };
}
