// Dates, sizes and names, written as in Québec.

const LOCALE = "fr-CA";

const dayFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDayFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });

/** A calendar day ("2026-10-01") is read at noon, so no time zone moves it. */
const toDate = (value: string | Date) =>
  value instanceof Date
    ? value
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);

/** The first of the month is written "1er": "1 octobre" becomes "1er octobre". */
export const withFirst = (text: string) => text.replace(/(^|\s)1(?=\s)/, "$11er");

/** "2 octobre 2026", "1er octobre 2026" */
export const formatDay = (value: string | Date) => withFirst(dayFormat.format(toDate(value)));
/** "2 oct.", "1er oct." */
export const formatShortDay = (value: string | Date) =>
  withFirst(shortDayFormat.format(toDate(value)));
/** "jeudi 1er octobre" */
export const formatWeekday = (value: string | Date) =>
  withFirst(weekdayFormat.format(toDate(value)));
/** "14 h 05" */
export const formatTime = (value: string | Date) => timeFormat.format(toDate(value));

/** Today's date on this device, as "2026-10-01". */
export function todayKey(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "aujourd'hui", "hier", "il y a 3 jours", then the date. */
export function formatAgo(value: string | Date, now = new Date()): string {
  const date = toDate(value);
  const days = Math.round(
    (new Date(todayKey(now)).getTime() - new Date(todayKey(date)).getTime()) / 86_400_000,
  );
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} jours`;
  return formatDay(date);
}

/** "1,4 Mo" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** "ML" for "Marc Lévesque": what an avatar shows. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")
  ).toUpperCase();
}

/** "1 feuille", "8 feuilles" */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString(LOCALE)} ${n > 1 ? plural : singular}`;
}
