// Making one's own account with the company's code: what both sides agree on.
// No React and no database here, so it is tested on its own.

/** The company code is eight digits: typed on a number pad, said aloud without spelling. */
export const COMPANY_CODE_LENGTH = 8;

/** The public address of the account-creation screen. */
export const SIGNUP_PATH = "/inscription";

/** The digits of a code as typed or pasted ("4827 1936", "4827-1936"). */
export const codeDigits = (typed: string) => typed.replace(/\D/g, "");

/**
 * "4827 1936": two groups of four, read and said in two breaths. The space
 * between them never breaks.
 */
export function formatCompanyCode(code: string): string {
  const digits = codeDigits(code);
  return digits.length === COMPANY_CODE_LENGTH
    ? `${digits.slice(0, 4)}\u00a0${digits.slice(4)}`
    : digits;
}

/** The link that opens the account-creation screen with the code already filled. */
export const signupLink = (origin: string, code: string) =>
  `${origin}${SIGNUP_PATH}?code=${codeDigits(code)}`;

/**
 * A Canadian cell number as stored and shown, "418 555-0123", or null when
 * what was typed is not one. Ten digits, with or without the leading 1, any
 * spaces, dashes, dots or brackets. The area code and the exchange never
 * start with 0 or 1, which catches most slips of a digit.
 */
export function canadianPhone(typed: string): string | null {
  if (/[^\d\s().+-]/.test(typed)) return null;
  let digits = typed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[2-9]\d\d[2-9]/.test(digits)) return null;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** What the phone field accepts, said under it. */
export const PHONE_HINT = "10 chiffres, par exemple 418 555-0123.";

/** GET /api/signup: all the first screen learns. */
export type SignupStatus = { open: boolean };

/** POST /api/signup. */
export type SignupInput = { name: string; phone: string; code: string };

/** GET /api/company/code, for the office. */
export type CompanyCode = {
  /** The eight digits while account creation is open; null while it is closed. */
  code: string | null;
  /** When it was last turned on, changed or turned off, and by whom. */
  changedAt: string | null;
  changedBy: string | null;
};
