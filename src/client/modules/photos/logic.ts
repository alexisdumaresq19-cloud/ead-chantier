import { shiftDay, SITE_TIME_ZONE, siteDay, type Photo } from "@/shared/photos";

import { ApiFailure } from "../../lib/api";
import { formatDay, formatWeekday } from "../../lib/format";

// The parts of the photos module that are plain reasoning: no screen, no
// network, no storage.

/** A photo that is still on the device only. */
export type LocalPhoto = {
  /** The id the photo will keep once the server has it. */
  id: string;
  projectId: string;
  ownerId: string;
  takenAt: string;
  caption: string | null;
  /**
   * preparing: being shrunk; sending: on its way; waiting: kept for later
   * (no network, or the last try failed); refused: the server will not take
   * it (an archived project…), so it is no longer tried on its own; sent: the
   * server has it and the gallery is about to show the real one.
   */
  state: "preparing" | "sending" | "waiting" | "refused" | "sent";
  /** Why the last try failed, in words for the person. */
  error: string | null;
};

export type Tile =
  | { kind: "photo"; id: string; takenAt: string; photo: Photo }
  | { kind: "local"; id: string; takenAt: string; local: LocalPhoto };

export type DayGroup = { day: string; tiles: Tile[] };

const newestFirst = (a: Tile, b: Tile) =>
  a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/**
 * The gallery's content: what the server has and what waits on the device,
 * together, newest day first. A photo the server already lists is no longer
 * shown from the device.
 */
export function groupByDay(photos: Photo[], locals: LocalPhoto[]): DayGroup[] {
  const tiles = new Map<string, Tile>();
  for (const local of locals)
    tiles.set(local.id, { kind: "local", id: local.id, takenAt: local.takenAt, local });
  for (const photo of photos)
    tiles.set(photo.id, { kind: "photo", id: photo.id, takenAt: photo.takenAt, photo });

  const days = new Map<string, Tile[]>();
  for (const tile of [...tiles.values()].sort(newestFirst)) {
    const day = tile.kind === "photo" ? tile.photo.day : siteDay(tile.takenAt);
    const list = days.get(day);
    if (list) list.push(tile);
    else days.set(day, [tile]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => ({ day, tiles: list }));
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Aujourd'hui", "Hier", "Jeudi 12 novembre", and the year when it is another one. */
export function dayTitle(day: string, today: string): string {
  if (day === today) return "Aujourd'hui";
  if (day === shiftDay(today, -1)) return "Hier";
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return capitalized(sameYear ? formatWeekday(day) : `${formatWeekday(day)} ${day.slice(0, 4)}`);
}

const monthFormat = new Intl.DateTimeFormat("fr-CA", { month: "long", year: "numeric" });
/** "Novembre 2026", for a day of that month. */
export const monthTitle = (day: string) =>
  capitalized(monthFormat.format(new Date(`${day}T12:00:00`)));

const siteTimeFormat = new Intl.DateTimeFormat("fr-CA", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIME_ZONE,
});

/** "Aujourd'hui à 14 h 05", "12 novembre 2026 à 14 h 05": when a photo was taken, at the site. */
export function takenLabel(photo: Pick<Photo, "takenAt" | "day">, today: string): string {
  const day =
    photo.day === today
      ? "Aujourd'hui"
      : photo.day === shiftDay(today, -1)
        ? "Hier"
        : formatDay(photo.day);
  return `${day} à ${siteTimeFormat.format(new Date(photo.takenAt))}`;
}

// --- Sending ------------------------------------------------------------------

const RETRY_DELAYS = [5, 15, 30, 60, 120, 300];
/**
 * After the server said this person has too many sends under way or for the
 * day: those clear in hours, and each try that fails half-way would use up
 * one more of them.
 */
export const BUSY_RETRY_DELAY = 30 * 60_000;

/** How long to wait before trying again, after that many failed tries in a row (ms). */
export function retryDelay(failures: number): number {
  const index = Math.min(Math.max(failures, 1), RETRY_DELAYS.length) - 1;
  return RETRY_DELAYS[index] * 1000;
}

/**
 * What a failed try means for a waiting photo:
 *  - offline: nothing reached the server; stop and wait for the network
 *  - signed-out: nobody is signed in on this device any more; stop
 *  - invalid: the server looked at the file and it is not a photo; discard it
 *  - resend: the server no longer has the file; send it again
 *  - busy: this person has too many sends under way, or for the day; stop
 *    and wait a long while
 *  - refused: the server will not take it from this person (an archived
 *    project, no longer on the project…); keep it, say why, stop trying
 *  - failed: anything else (a server error); keep it and try later
 */
export type FailureKind =
  "offline" | "signed-out" | "invalid" | "resend" | "busy" | "refused" | "failed";

export function failureKind(error: unknown): FailureKind {
  // A cancelled or stalled request, or anything unexpected in between.
  if (!(error instanceof ApiFailure)) return "offline";
  if (error.offline) return "offline";
  if (error.status === 401) return "signed-out";
  if (error.code === "invalid_image") return "invalid";
  if (error.code === "upload_missing") return "resend";
  if (error.status === 429) return "busy";
  if (error.status === 403 || error.status === 404 || error.status === 409) return "refused";
  return "failed";
}

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** An id for a photo, made on the device in the shape of the server's ids. */
export function newPhotoId(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): string {
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

const YEAR = 365.25 * 24 * 3600 * 1000;

/**
 * When a chosen file was taken: the camera's own date if the file has one,
 * else the file's date, else now. A date in the future or from a clock that
 * was never set is not believed.
 */
export function pickTakenAt(exif: Date | null, fileDate: number | undefined, now: Date): Date {
  const believable = (time: number) =>
    Number.isFinite(time) && time <= now.getTime() + 600_000 && time >= now.getTime() - 20 * YEAR;
  for (const time of [exif?.getTime(), fileDate]) {
    if (time !== undefined && believable(time)) return new Date(Math.min(time, now.getTime()));
  }
  return now;
}

/** The size of an image once its longest side is brought down to `max`. */
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
