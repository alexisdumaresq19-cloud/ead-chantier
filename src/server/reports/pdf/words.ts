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

/** "Jeudi 19 novembre 2026", for a day written "2026-11-19". */
export const fullDay = (day: string) =>
  capitalize(withFirst(dayFormat.format(new Date(`${day}T12:00:00Z`))));

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
