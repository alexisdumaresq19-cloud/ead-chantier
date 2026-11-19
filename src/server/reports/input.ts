import { z } from "zod";

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
  note: z.string().trim().max(LIMITS.weatherNote, tooLong(LIMITS.weatherNote)),
});

const crewLine = z.object({
  name: z.string().trim().min(1, "Nom manquant.").max(LIMITS.name, tooLong(LIMITS.name)),
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

const content = z.object({
  day: reportDay,
  weather,
  crew,
  equipment: z.string().trim().max(LIMITS.equipment, tooLong(LIMITS.equipment)),
  workDone: z.string().trim().max(LIMITS.text, tooLong(LIMITS.text)),
  notes: z.string().trim().max(LIMITS.text, tooLong(LIMITS.text)),
});

export const EMPTY_REPORT =
  "Le rapport est vide\u00a0: inscrivez au moins la météo ou les travaux.";

/** POST: the whole report. */
export const newReport = content.refine((report) => !isEmptyContent(report), EMPTY_REPORT);

/** PATCH: what changes, and the version the change was made from. */
export const reportChange = content.partial().extend({
  baseUpdatedAt: z.iso.datetime("Version du rapport manquante."),
});
