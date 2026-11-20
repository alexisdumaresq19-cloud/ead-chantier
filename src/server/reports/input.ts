import { z } from "zod";

import { PHOTO_ID_PATTERN } from "@/shared/photos";
import {
  FIRST_REPORT_DAY,
  isEmptyContent,
  isRealDay,
  isValidHours,
  latestReportDay,
  REPORT_LIMITS as LIMITS,
  WEATHER_CONDITIONS,
} from "@/shared/reports";

// What the API accepts for a daily report. The form checks the same rules
// before sending (they live in src/shared/reports.ts); here they are enforced.

const tooLong = (max: number) => `Texte trop long (${max} caractères au plus).`;

/**
 * A text as it will be stored. Postgres takes neither a NUL character nor
 * half of a surrogate pair: nobody types them, so they are dropped rather
 * than failing the save.
 */
const text = (max: number) =>
  z
    .string()
    .transform((value) => value.toWellFormed().replaceAll("\u0000", "").trim())
    .pipe(z.string().max(max, tooLong(max)));

export const reportDay = z
  .string()
  .refine(isRealDay, "Date invalide.")
  .refine((day) => day >= FIRST_REPORT_DAY, "Date trop ancienne.")
  .refine(
    (day) => day <= latestReportDay(),
    "Un rapport ne peut pas porter sur une journée à venir.",
  );

const weather = z.object({
  condition: z.enum(WEATHER_CONDITIONS, "Météo inconnue.").nullable(),
  temperatureC: z
    .number("Température invalide.")
    .int("Température en degrés entiers.")
    .min(LIMITS.temperatureMin, "Température trop basse.")
    .max(LIMITS.temperatureMax, "Température trop haute.")
    .nullable(),
  note: text(LIMITS.weatherNote),
});

const crewLine = z.object({
  name: text(LIMITS.name).refine((name) => name.length > 0, "Nom manquant."),
  hours: z
    .number("Heures invalides.")
    .refine(isValidHours, "Heures entre 0 et 24, au quart d'heure près."),
  userId: z
    .string()
    .max(40)
    .nullish()
    .transform((id) => id || null),
});

const crew = z
  .array(crewLine)
  .max(LIMITS.crew, `Équipe trop nombreuse (${LIMITS.crew} lignes au plus).`)
  .refine((lines) => {
    const ids = lines.flatMap((line) => line.userId ?? []);
    return new Set(ids).size === ids.length;
  }, "Une personne est inscrite deux fois.");

/**
 * The photos that go with the report. Only the shape of an id is checked: a
 * photo still on its way from a phone is not in the project yet, and the
 * report reads its photos from the project alone (reports/queries.ts).
 */
const photoIds = z
  .array(z.string().regex(PHOTO_ID_PATTERN, "Photo inconnue."))
  .transform((ids) => [...new Set(ids)])
  .pipe(z.array(z.string()).max(LIMITS.photos, `Trop de photos (${LIMITS.photos} au plus).`));

const content = z.object({
  day: reportDay,
  weather,
  crew,
  equipment: text(LIMITS.equipment),
  workDone: text(LIMITS.text),
  notes: text(LIMITS.text),
  photoIds,
});

export const EMPTY_REPORT =
  "Le rapport est vide\u00a0: inscrivez au moins la météo ou les travaux.";

/**
 * POST: the whole report. A phone still running the version from before
 * reports had photos sends none.
 */
export const newReport = content
  .extend({ photoIds: photoIds.default([]) })
  .refine((report) => !isEmptyContent(report), EMPTY_REPORT);

/** PATCH: what changes, and the version the change was made from. */
export const reportChange = content.partial().extend({
  baseUpdatedAt: z.iso.datetime("Version du rapport manquante."),
});
