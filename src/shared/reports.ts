// Daily reports, as exchanged between the app and its API. Foremen and the
// office only: every address below refuses anyone else.
//
//   GET    /api/projects/:id/reports             ReportSummary[], newest day first
//   GET    /api/projects/:id/reports/day/:day    DayReport: that day's report, or none
//   POST   /api/projects/:id/reports             ReportContent → SavedReport
//                                                (a day has one report: if it already
//                                                has one, that report comes back as is)
//   GET    /api/reports/:id                      Report
//   PATCH  /api/reports/:id                      ReportPatch → Report
//                                                (409 "conflict" if it changed since
//                                                `baseUpdatedAt`, 409 "day_taken" if the
//                                                new day already has a report)
//   DELETE /api/reports/:id                      its author or the office
//   GET    /api/reports/:id/pdf                  the report as a PDF document, with
//                                                EAD's logo and its photos
//                                                (application/pdf, named reportPdfName())

import type { Photo } from "./photos";

export const WEATHER_CONDITIONS = [
  "soleil",
  "nuageux",
  "pluie",
  "neige",
  "vent",
  "brouillard",
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export const WEATHER_LABELS: Record<WeatherCondition, string> = {
  soleil: "Soleil",
  nuageux: "Nuageux",
  pluie: "Pluie",
  neige: "Neige",
  vent: "Vent",
  brouillard: "Brouillard",
};

export type Weather = {
  condition: WeatherCondition | null;
  /** Whole degrees Celsius; null when it was not noted. */
  temperatureC: number | null;
  note: string;
};

export type CrewLine = {
  name: string;
  /** Hours worked that day, to the quarter of an hour. */
  hours: number;
  /** Set when the person is a member of the project; null for a name typed by hand. */
  userId: string | null;
};

/** What the foreman writes. */
export type ReportContent = {
  /** The day at the site, "2026-10-01". */
  day: string;
  weather: Weather;
  crew: CrewLine[];
  equipment: string;
  workDone: string;
  /** Delays, incidents, visitors, instructions received. */
  notes: string;
  /**
   * The photos that go with the report, chosen among the project's: they are
   * shown in the report and printed in its PDF. Only their ids are kept: a
   * photo still on its way from a phone is already counted, and one removed
   * from the project since simply no longer shows.
   */
  photoIds: string[];
};

export type Report = ReportContent & {
  id: string;
  projectId: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  /** Sent back with a change (`baseUpdatedAt`), so nobody overwrites a newer version unknowingly. */
  updatedAt: string;
  /** The signed-in person may remove it (its author or the office). */
  canDelete: boolean;
  /** The photos of `photoIds` that the project holds, in the order they were taken. */
  photos: Photo[];
};

export type ReportSummary = {
  id: string;
  day: string;
  condition: WeatherCondition | null;
  temperatureC: number | null;
  people: number;
  hours: number;
  /** The first words of the work done (of the notes, on a day without work). */
  excerpt: string;
  authorName: string | null;
  updatedAt: string;
  /** How many photos go with the report. */
  photoCount: number;
};

export type DayReport = {
  report: Report | null;
  /** The crew of the last report before that day, to start from. */
  previous: { day: string; crew: CrewLine[] } | null;
};

export type SavedReport = {
  report: Report;
  /** False when the day already had a report: `report` is that one, unchanged. */
  created: boolean;
};

export type ReportPatch = Partial<ReportContent> & { baseUpdatedAt: string };

// --- Rules shared by the form and the server --------------------------------

export const REPORT_LIMITS = {
  crew: 100,
  name: 80,
  weatherNote: 200,
  equipment: 2000,
  text: 10_000,
  /** Photos with one report: its PDF stays light enough to send by email. */
  photos: 40,
  temperatureMin: -60,
  temperatureMax: 60,
} as const;

/** A calendar day that exists: "2026-02-30" does not. */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** No report is older than this: an earlier date is a typing mistake. */
export const FIRST_REPORT_DAY = "2000-01-01";

/**
 * The latest day a report can be for: today, where the day is the most
 * advanced in Québec (the Atlantic time of the Îles-de-la-Madeleine), so that
 * no site is refused its own evening.
 */
export function latestReportDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Halifax",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Between 0 and 24, in quarters of an hour. */
export const isValidHours = (hours: number) =>
  Number.isFinite(hours) && hours >= 0 && hours <= 24 && Number.isInteger(hours * 4);

export function crewTotals(crew: Pick<CrewLine, "hours">[]): { people: number; hours: number } {
  // Quarters add up exactly in binary, so the total needs no rounding.
  return { people: crew.length, hours: crew.reduce((sum, line) => sum + line.hours, 0) };
}

/** The first words of a text, on one line, cut between two words. */
export function excerptOf(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const end = cut.lastIndexOf(" ");
  return `${cut.slice(0, end > max / 2 ? end : max).replace(/[\s,;:.]+$/, "")}…`;
}

/** Nothing was written: such a report is refused. */
export const isEmptyContent = (content: Omit<ReportContent, "day">) =>
  !content.weather.condition &&
  content.weather.temperatureC === null &&
  !content.weather.note.trim() &&
  content.crew.length === 0 &&
  !content.equipment.trim() &&
  !content.workDone.trim() &&
  !content.notes.trim() &&
  content.photoIds.length === 0;

/** The same photos, in whatever order they were added. */
function samePhotos(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a);
  return b.every((id) => ids.has(id));
}

/** Whether two versions of a report say the same thing. */
export function sameContent(a: ReportContent, b: ReportContent): boolean {
  return (
    a.day === b.day &&
    a.weather.condition === b.weather.condition &&
    a.weather.temperatureC === b.weather.temperatureC &&
    a.weather.note === b.weather.note &&
    a.equipment === b.equipment &&
    a.workDone === b.workDone &&
    a.notes === b.notes &&
    samePhotos(a.photoIds, b.photoIds) &&
    a.crew.length === b.crew.length &&
    a.crew.every((line, index) => {
      const other = b.crew[index];
      return line.name === other.name && line.hours === other.hours && line.userId === other.userId;
    })
  );
}

/**
 * The name of a report's PDF file: "Rapport journalier 2026-014 2026-10-01.pdf".
 * Only letters, digits, spaces and hyphens, so that every phone, mail and
 * shared folder takes it as it is.
 */
export function reportPdfName(project: { number: string | null; name: string }, day: string) {
  const label = (project.number?.trim() || project.name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `Rapport journalier ${label ? `${label} ` : ""}${day}.pdf`;
}
