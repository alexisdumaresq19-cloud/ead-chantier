import { REPORT_LIMITS } from "@/shared/reports";

import { formatShortDay, formatTime, formatWeekday, todayKey, withFirst } from "../../lib/format";

// Hours, degrees and days, as a foreman types and reads them.

const LOCALE = "fr-CA";
const NBSP = "\u00a0";

/**
 * Hours as typed on a phone: "8", "7,5", "7.5", "7 h 30", "7h30", "7:30".
 * Null when the text is not a number of hours.
 */
export function parseHours(text: string): number | null {
  const compact = text.toLowerCase().replace(/\s+/g, "");
  const decimal = /^(\d{1,2})(?:[.,](\d{1,2}))?(?:h|heures?)?$/.exec(compact);
  if (decimal) return Number(`${decimal[1]}.${decimal[2] ?? "0"}`);
  const clock = /^(\d{1,2})[h:](\d{1,2})(?:m|min)?$/.exec(compact);
  if (clock && Number(clock[2]) < 60) return Number(clock[1]) + Number(clock[2]) / 60;
  return null;
}

/** "7,5", for a field. */
export const hoursText = (hours: number) => String(hours).replace(".", ",");

/** "7,5 h" */
export const formatHours = (hours: number) =>
  `${hours.toLocaleString(LOCALE, { maximumFractionDigits: 2 })}${NBSP}h`;

/**
 * Degrees as typed: "-12", "−12", "+3", "4,6" (rounded). Null when the field
 * is empty, "invalid" when it cannot be a temperature.
 */
export function parseTemperature(text: string): number | null | "invalid" {
  const compact = text.replace(/\s+/g, "").replace(/°c?$/i, "");
  if (!compact) return null;
  const match = /^([+\-−–])?(\d{1,2})(?:[.,](\d))?$/.exec(compact);
  if (!match) return "invalid";
  const degrees = Math.round(Number(`${match[2]}.${match[3] ?? "0"}`));
  const value = match[1] && match[1] !== "+" && degrees !== 0 ? -degrees : degrees;
  return value < REPORT_LIMITS.temperatureMin || value > REPORT_LIMITS.temperatureMax
    ? "invalid"
    : value;
}

/** "−12 °C", with a true minus sign. */
export const formatTemperature = (degrees: number) =>
  `${degrees < 0 ? "−" : ""}${Math.abs(degrees)}${NBSP}°C`;

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A calendar day moved by a number of days: ("2026-03-01", -1) → "2026-02-28". */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** The `count` days ending on `today`, oldest first. */
export const lastDays = (today: string, count: number) =>
  Array.from({ length: count }, (_, index) => shiftDay(today, index - count + 1));

// A calendar day is read at noon, so no time zone moves it.
const atNoon = (day: string) => new Date(`${day}T12:00:00`);
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });
const weekdayLongFormat = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });
const fullFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "Novembre 2026" */
export const monthLabel = (day: string) => capitalize(monthFormat.format(atNoon(day)));
/** "jeu." */
export const weekdayShort = (day: string) => weekdayFormat.format(atNoon(day));
/** "jeudi 19 novembre 2026" */
export const formatFullDay = (day: string) => withFirst(fullFormat.format(atNoon(day)));

/** "aujourd'hui à 15 h 42", "hier à 16 h 05", then "le mardi 17 novembre". */
export function formatWhen(value: string | Date, now = new Date()): string {
  const date = new Date(value);
  const day = todayKey(date);
  // The hour stays in one piece at the end of a line.
  const time = formatTime(date).replace(/\s/g, NBSP);
  if (day === todayKey(now)) return `aujourd'hui à ${time}`;
  if (day === shiftDay(todayKey(now), -1)) return `hier à ${time}`;
  return `le ${formatWeekday(date)}`;
}

/**
 * The button that copies the crew of the last report before `day`. It stays
 * short enough for one line of a 360 px phone: "d'hier", "de la veille",
 * "de vendredi" within a week, then "du 28 sept.".
 */
export function previousCrewLabel(previousDay: string, day: string, today: string): string {
  if (previousDay === shiftDay(today, -1) && day === today) return "Reprendre l'équipe d'hier";
  if (previousDay === shiftDay(day, -1)) return "Reprendre l'équipe de la veille";
  if (previousDay > shiftDay(day, -7))
    return `Reprendre l'équipe de ${weekdayLongFormat.format(atNoon(previousDay))}`;
  return `Reprendre l'équipe du ${formatShortDay(previousDay)}`;
}

/** Days in the order given, split where the month changes. */
export function groupByMonth<T extends { day: string }>(
  items: T[],
): { month: string; items: T[] }[] {
  const groups: { month: string; items: T[] }[] = [];
  for (const item of items) {
    const month = item.day.slice(0, 7);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}
