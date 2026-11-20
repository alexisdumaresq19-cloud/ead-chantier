// Getting in by typing: a cell number and an eight-digit code from the office
// (a personal invitation's, or the demonstration access's). What both sides
// agree on; no React and no database here, so it is tested on its own.

import { canadianPhone, codeDigits, COMPANY_CODE_LENGTH, formatCompanyCode } from "./signup";

/** A typed code has as many digits as the company's, and is shown the same way ("4827 1936"). */
export const ACCESS_CODE_LENGTH = COMPANY_CODE_LENGTH;
export const formatAccessCode = formatCompanyCode;

/** The screen where the number and the code are typed. */
export const ACCESS_CODE_PATH = "/bienvenue/code";

/** Where the code is typed, said the way the screens name it. */
export const ACCESS_CODE_HOW =
  "Dans l'application\u00a0: J'ai déjà un compte, puis Avec un code du bureau.";

/** How long a device stays signed in on the demonstration account. */
export const DEMO_SESSION_DAYS = 1;

/** The name the demonstration account goes by on every list. */
export const DEMO_NAME = "Compte de démonstration";

// Two groups of four, standing alone: never digits inside a link's token.
const GROUPED = /(?<![\p{L}\p{N}_/-])(\d{4})[ \u00a0.-]?(\d{4})(?![\p{L}\p{N}_])/gu;

/**
 * The code in what was typed or pasted. Typed (digits, spaces, dashes):
 * its digits. A text (the office's whole message, whose link holds digits
 * of its own): the two groups of four that follow the word "code", else the
 * last two groups of four standing alone (the message ends with the code),
 * else nothing.
 */
export function codeFromText(text: string): string {
  if (!/\p{L}/u.test(text)) return codeDigits(text).slice(0, ACCESS_CODE_LENGTH);
  const afterWord = /code[^\d]{0,12}(\d{4})[ \u00a0.-]?(\d{4})(?!\d)/i.exec(text);
  if (afterWord) return afterWord[1] + afterWord[2];
  const last = [...text.matchAll(GROUPED)].at(-1);
  return last ? last[1] + last[2] : "";
}

/** "4827 1936" while it is typed: the digits, in two groups of four. */
export function typedCode(text: string): string {
  const digits = codeFromText(text);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/;

/**
 * The cell number and the code in a pasted text (the office's whole text
 * message, or just one of the two): "418 555-0123" and the eight digits,
 * each null when it is not there.
 */
export function readMessage(text: string): { phone: string | null; code: string | null } {
  const found = PHONE.exec(text);
  const phone = found ? canadianPhone(found[0]) : null;
  // The number's digits are not the code's.
  const rest =
    found && phone
      ? `${text.slice(0, found.index)} ${text.slice(found.index + found[0].length)}`
      : text;
  const code = codeFromText(rest);
  return { phone, code: code.length === ACCESS_CODE_LENGTH ? code : null };
}

/**
 * The ten digits a number is looked up by, however it was typed or stored:
 * "(418) 555-0123", "1 418 555 0123". Null for anything that is not one.
 */
export function phoneKey(text: string | null | undefined): string | null {
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/** POST /api/sessions/code. */
export type AccessCodeInput = { phone: string; code: string };

/** The demonstration access, as the office reads it (GET /api/company/demo). */
export type DemoAccess = {
  /** "418 555-0100": from the range kept for fiction, so nobody owns it. */
  phone: string;
  /** The eight digits. */
  code: string;
  projectIds: string[];
  /** When it was made, or its code or projects last changed, and by whom. */
  changedAt: string;
  changedBy: string | null;
  /** When a visitor last used it; null if never. */
  lastSeenAt: string | null;
};

export type DemoAccessState = { access: DemoAccess | null };

/** PATCH /api/company/demo. */
export type DemoAccessChange = { projectIds?: string[]; newCode?: true };
