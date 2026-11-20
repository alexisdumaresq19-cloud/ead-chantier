// Site photos, as exchanged between the app and its API.
//
//   GET    /api/projects/:id/photos?day=2026-10-01     the project's photos, newest first
//                                                      (day is optional: only that day's)
//          …&limit=90&before=<photoCursor(last)>       a page at a time: the photos that
//                                                      come after that one. Fewer than
//                                                      `limit` back means there are no more;
//                                                      without `limit`, up to PHOTO_LIST_MAX.
//   GET    /api/projects/:id/photos/days               the days that have photos (PhotoDay[])
//   POST   /api/projects/:id/photos                    { uploadId, takenAt?, caption? }
//                                                      and optionally `id`, which names the
//                                                      photo ahead of time: sending it again
//                                                      gives back the same photo
//   GET    /api/photos/:id
//   PATCH  /api/photos/:id                             { caption }
//   DELETE /api/photos/:id

export type Photo = {
  id: string;
  /** The full image, sized for a screen (JPEG). */
  url: string;
  /** A small square-ish preview (WebP). */
  thumbUrl: string;
  width: number;
  height: number;
  /** When it was taken, ISO 8601. */
  takenAt: string;
  /** The day it was taken at the site, "2026-10-01". */
  day: string;
  caption: string | null;
  authorId: string | null;
  authorName: string | null;
  /** The signed-in person may change or remove it. */
  canEdit: boolean;
};

/** A day that has photos. Lists of them are newest day first. */
export type PhotoDay = { day: string; count: number };

/** Longest side of the image the server keeps; phones shrink to it before sending. */
export const PHOTO_MAX_SIDE = 2560;
export const PHOTO_CAPTION_MAX = 500;
/** The most photos one request returns. */
export const PHOTO_LIST_MAX = 500;

/** A photo id made on the device: the same shape as the server's own ids. */
export const PHOTO_ID_PATTERN = /^[a-hjkmnp-z2-9]{16}$/;

/** Where a list resumes after this photo: the value of `?before=`. */
export const photoCursor = (photo: Pick<Photo, "takenAt" | "id">) => `${photo.takenAt}_${photo.id}`;

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)_([a-z0-9]{1,40})$/;

/** The photo a `photoCursor()` names; null for anything else. */
export function readPhotoCursor(cursor: string): { takenAt: Date; id: string } | null {
  const [, takenAt, id] = CURSOR.exec(cursor) ?? [];
  if (!takenAt) return null;
  const at = new Date(takenAt);
  // "2026-13-45T…" has the shape of a date and is none.
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19) !== takenAt.slice(0, 19)
    ? null
    : { takenAt: at, id };
}

// --- The site's clock ---------------------------------------------------------
//
// A photo is filed under the day it was taken at the site, wherever the phone
// that shows it or the server that stores it happens to be. EAD's sites are
// in Québec.

export const SITE_TIME_ZONE = "America/Toronto";

const siteClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function siteClockAt(instant: Date) {
  const parts: Record<string, string> = {};
  for (const part of siteClock.formatToParts(instant)) parts[part.type] = part.value;
  return parts;
}

/** What the site's clocks show at that instant, written as if it were UTC (ms). */
function siteWallTime(instant: Date): number {
  const p = siteClockAt(instant);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/** The day at the site at that instant, "2026-10-01". */
export function siteDay(at: Date | string): string {
  const p = siteClockAt(typeof at === "string" ? new Date(at) : at);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * The instant at which the site's clocks show the given wall time (written
 * as if it were UTC, in ms): how a camera's "2026:10:01 14:05:00" becomes a
 * real moment.
 */
export function siteTimeToDate(wallTime: number): Date {
  const offsetAt = (instant: number) => siteWallTime(new Date(instant)) - instant;
  // The offset is read at a first guess, then at the corrected instant: the
  // second pass settles the hours around a clock change.
  const guess = wallTime - offsetAt(wallTime);
  return new Date(wallTime - offsetAt(guess));
}

/** When a site day starts and ends (the end is the start of the next day). */
export function siteDayBounds(day: string): { from: Date; to: Date } {
  const [year, month, date] = day.split("-").map(Number);
  return {
    from: siteTimeToDate(Date.UTC(year, month - 1, date)),
    to: siteTimeToDate(Date.UTC(year, month - 1, date + 1)),
  };
}

/** Whether the text is a real calendar day written "2026-10-01". */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, date] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date
  );
}

/** The day before or after, "2026-10-01" → "2026-09-30". */
export function shiftDay(day: string, by: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + by)).toISOString().slice(0, 10);
}
