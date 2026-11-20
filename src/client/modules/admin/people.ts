import type { Person } from "@/shared/api";
import { ROLE_LABELS, type Role } from "@/shared/roles";

import { ApiFailure, errorMessage } from "../../lib/api";
import { formatAgo, formatTime, formatWeekday, todayKey } from "../../lib/format";

// Words and links about people: phone numbers as written in Québec, what an
// invitation says, how the office's list is sorted and searched. No React
// here, so all of it is tested on its own.

/** Lowercase, without accents: "Lévesque" is found by typing "levesque". */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// --- Phone numbers ----------------------------------------------------------

const EXTENSION = /(?:poste|ext\.?|x|#)\s*(\d{1,6})\s*$/i;

/** The ten digits of a Canadian number and its extension, when that is what was typed. */
function northAmerican(raw: string): { digits: string; extension: string | null } | null {
  const extension = EXTENSION.exec(raw);
  const main = extension ? raw.slice(0, extension.index) : raw;
  let digits = main.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? { digits, extension: extension?.[1] ?? null } : null;
}

/**
 * "418 555-0142", however it was typed. Numbers are stored as typed; anything
 * that is not a ten-digit number (another country, a note) is shown as is.
 */
export function formatPhone(raw: string): string {
  const text = raw.trim();
  const number = northAmerican(text);
  // Words around the number say something ("cell.", "maison"): keep them.
  if (!number || /[a-z]/i.test(text.replace(EXTENSION, ""))) return text;
  const { digits, extension } = number;
  const formatted = `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return extension ? `${formatted}, poste ${extension}` : formatted;
}

/** What a tap-to-call or text-message link dials; null when there is no number in it. */
function dialable(raw: string): string | null {
  const number = northAmerican(raw);
  if (number) return `+1${number.digits}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return raw.trim().startsWith("+") ? `+${digits}` : digits;
}

export function telHref(raw: string): string | null {
  const number = dialable(raw);
  return number ? `tel:${number}` : null;
}

/** Opens the phone's messages with the text ready. "?&" is read by both iOS and Android. */
export function smsHref(phone: string | null, text: string): string {
  return `sms:${(phone && dialable(phone)) ?? ""}?&body=${encodeURIComponent(text)}`;
}

export function mailHref(email: string | null, subject: string, text: string): string {
  return `mailto:${email ? encodeURIComponent(email.trim()).replace(/%40/g, "@") : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

// --- Invitations ------------------------------------------------------------

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** Whole days left before a link stops working, never less than one while it works. */
export function daysLeft(expiresAt: string, now: Date): number {
  return Math.max(1, Math.round((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000));
}

export const INVITE_SUBJECT = "Votre accès à EAD Chantier";

/** What the office sends with a personal link, by text message or by email. */
export function inviteMessage(name: string, url: string, days: number): string {
  const length = days > 1 ? `pendant ${days} jours` : "jusqu'à demain";
  return `Bonjour ${firstName(name)}, voici votre lien personnel pour ouvrir EAD Chantier sur votre téléphone.\n${url}\nIl sert une seule fois, ${length}.`;
}

/** Until when a link or a QR code works, in words: "Valide jusqu'à demain, 14 h 05". */
export function validUntilText(expiresAt: string, now: Date): string {
  const end = new Date(expiresAt);
  const days = Math.round(
    (new Date(todayKey(end)).getTime() - new Date(todayKey(now)).getTime()) / 86_400_000,
  );
  if (days <= 0) return `Valide aujourd'hui jusqu'à ${formatTime(end)}`;
  if (days === 1) return `Valide jusqu'à demain, ${formatTime(end)}`;
  return `Valide jusqu'au ${formatWeekday(end)}`;
}

// --- People to confirm ------------------------------------------------------

/** How long someone who came in by a site's QR code stays in without a confirmation (UNREVIEWED_SESSION_DAYS on the server). */
const UNREVIEWED_DAYS = 7;

/** What happens to someone who came in by a site's QR code, said where they are to confirm. */
export const UNREVIEWED_RULE = `Sans confirmation, l'accès prend fin ${UNREVIEWED_DAYS} jours après le scan du code.`;

/** "Code scanné aujourd'hui à 7 h 30", "Code scanné il y a 3 jours". */
export function scannedText(scannedAt: string, now = new Date()): string {
  const ago = formatAgo(scannedAt, now);
  if (/^\d/.test(ago)) return `Code scanné le ${ago}`;
  return ago === "aujourd'hui" || ago === "hier"
    ? `Code scanné ${ago} à ${formatTime(scannedAt)}`
    : `Code scanné ${ago}`;
}

/** "Accès jusqu'au jeudi 26 novembre": when the device of someone not confirmed is signed out. */
export function accessEndText(scannedAt: string): string {
  const end = new Date(new Date(scannedAt).getTime() + UNREVIEWED_DAYS * 86_400_000);
  return `Accès jusqu'au ${formatWeekday(end)}`;
}

// --- The office's list ------------------------------------------------------

/** "Opérateur" if a title was given, otherwise the role: "Travailleur". */
export const titleOrRole = (person: { title: string | null; role: Role }) =>
  person.title?.trim() || ROLE_LABELS[person.role];

/** "Vu hier", "Vu le 1er septembre 2026", "Jamais connecté". */
export function lastSeenText(lastSeenAt: string | null, now = new Date()): string {
  if (!lastSeenAt) return "Jamais connecté";
  const ago = formatAgo(lastSeenAt, now);
  return /^\d/.test(ago) ? `Vu le ${ago}` : `Vu ${ago}`;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "fr-CA", { sensitivity: "base" });

/** By name, whatever the accents and the capitals. */
export const sortByName = <T extends { name: string }>(people: T[]): T[] =>
  [...people].sort(byName);

/** People waiting for the office's check first, then by name. */
export function sortPeople<T extends { name: string; unreviewed: boolean }>(people: T[]): T[] {
  return [...people].sort((a, b) => Number(b.unreviewed) - Number(a.unreviewed) || byName(a, b));
}

const ROLE_ORDER: Record<Role, number> = { contremaitre: 0, admin: 1, travailleur: 2 };

/** A site's contact list: the foremen on top, then the office, then the crew. */
export function sortMembers<T extends { name: string; role: Role }>(members: T[]): T[] {
  return [...members].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byName(a, b));
}

/** Finds by name, title, role, email or phone; digits alone search the phone numbers. */
export function matchesPerson(
  person: Pick<Person, "name" | "title" | "role" | "phone"> & { email?: string | null },
  search: string,
): boolean {
  const wanted = plain(search).trim();
  if (!wanted) return true;
  const digits = wanted.replace(/\D/g, "");
  if (digits.length >= 3 && digits.length === wanted.replace(/[\s().+-]/g, "").length) {
    return (person.phone ?? "").replace(/\D/g, "").includes(digits);
  }
  const text = plain(
    [person.name, person.title, ROLE_LABELS[person.role], person.email].filter(Boolean).join(" "),
  );
  return wanted.split(/\s+/).every((word) => text.includes(word));
}

// --- Signing out ------------------------------------------------------------

/** Why signing out did not happen: the person is still signed in on this device. */
export function signOutFailure(error: unknown): string {
  return error instanceof ApiFailure && error.offline
    ? "Pas de réseau : vous êtes encore connecté sur cet appareil. Réessayez quand la connexion revient."
    : `${errorMessage(error)} Vous êtes encore connecté sur cet appareil.`;
}
