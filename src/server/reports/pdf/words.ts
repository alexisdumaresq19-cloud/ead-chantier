import { SITE_TIME_ZONE } from "@/shared/photos";
import { WEATHER_LABELS, type Weather } from "@/shared/reports";

// Dates, hours and degrees as the PDF writes them: as in Québec, and on the
// site's clock (the server's own clock is in another time zone).

const LOCALE = "fr-CA";
const NBSP = "\u00a0";

const dayFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIME_ZONE,
});
const momentFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: SITE_TIME_ZONE,
});

/** The first of the month is written "1er". */
const withFirst = (text: string) => text.replace(/(^|\s)1(?=\s)/, "$11er");
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "jeudi 19 novembre 2026", for a day written "2026-11-19": as written inside a sentence. */
export const dayInSentence = (day: string) =>
  withFirst(dayFormat.format(new Date(`${day}T12:00:00Z`)));

/** "Jeudi 19 novembre 2026": as written at the start of a line. */
export const fullDay = (day: string) => capitalize(dayInSentence(day));

/** "14 h 05", at the site, in one piece: a line never ends inside it. */
export const siteTime = (at: Date) => timeFormat.format(at).replace(/\s/g, NBSP);

/** "19 novembre 2026 à 16 h 42", at the site. */
export const siteMoment = (at: Date) => `${withFirst(momentFormat.format(at))} à ${siteTime(at)}`;

/** "7,5 h" */
export const hoursLabel = (hours: number) =>
  `${hours.toLocaleString(LOCALE, { maximumFractionDigits: 2 })}${NBSP}h`;

/** "−12 °C", with a true minus sign. */
export const temperatureLabel = (degrees: number) =>
  `${degrees < 0 ? "−" : ""}${Math.abs(degrees)}${NBSP}°C`;

/** "Neige, −12 °C"; empty when neither was noted. */
export const weatherLabel = ({ condition, temperatureC }: Weather) =>
  [
    condition ? WEATHER_LABELS[condition] : null,
    temperatureC === null ? null : temperatureLabel(temperatureC),
  ]
    .filter((part) => part !== null)
    .join(", ");

export const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count.toLocaleString(LOCALE)}${NBSP}${count > 1 ? plural : singular}`;

/** "Rue Principale, Gaspé": the address, then the city when the address does not already say it. */
export function placeLabel(address: string | null, city: string | null): string {
  const street = address?.trim() ?? "";
  const town = city?.trim() ?? "";
  if (!street) return town;
  if (!town || street.toLocaleLowerCase(LOCALE).includes(town.toLocaleLowerCase(LOCALE)))
    return street;
  return `${street}, ${town}`;
}

/** Units written after a number; the space between them never ends a line. */
const UNITS = [
  "km/h",
  "m/s",
  "min",
  "mm",
  "cm",
  "km",
  "m²",
  "m³",
  "m2",
  "m3",
  "kg",
  "kPa",
  "MPa",
  "kN",
  "°C",
  "°",
  "%",
  "\\$",
  "po",
  "pi",
  "h",
  "m",
  "t",
  "L",
  "s",
].join("|");
const AFTER_UNIT = "(?=$|[\\s.,;:!?)\\]»/])";

/**
 * Text as the person typed it, set as a printed page sets it: the
 * typewriter apostrophe between two letters becomes ’ (a foot mark after a
 * number stays), typed "quotes" become « guillemets » with their no-break
 * spaces, and the spaces that must not end a line become no-break spaces:
 * before « : ; ! ? », between a number and its unit ("300 mm", "14 h 30")
 * and inside a number ("1 035 kPa"). No other space is added or taken away.
 */
export function typeset(text: string): string {
  return text
    .replace(/(?<=\p{L})'(?=\p{L})/gu, "\u2019")
    .replace(/(^|[\s(\[])"(?=\S)([^"\n]*?\S)"(?=$|[\s.,;:!?)\]])/gu, `$1«${NBSP}$2${NBSP}»`)
    .replace(/«[ \u00a0]*/g, `«${NBSP}`)
    .replace(/[ \u00a0]*»/g, `${NBSP}»`)
    .replace(/ +(?=[:;!?»])/g, NBSP)
    .replace(new RegExp(`(?<=\\d) +(?=(?:${UNITS})${AFTER_UNIT})`, "gu"), NBSP)
    .replace(/(?<=\d\u00a0h) +(?=\d)/g, NBSP)
    .replace(/(?<=\d) (?=\d{3}(?!\d))/g, NBSP);
}
