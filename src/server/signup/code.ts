import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { COMPANY_CODE_LENGTH } from "@/shared/signup";

// The company code: made here, from the system's random source, and compared
// in constant time. It is kept as it is (the office reads it again), since it
// opens nothing but a worker's account that sees no project; what keeps it
// from being guessed is the door (door.ts).

/** A run of one digit, or digits in a row, is the first thing anyone would try. */
export function looksGuessable(code: string): boolean {
  if (/^(\d)\1+$/.test(code)) return true;
  const steps = [...code].slice(1).map((digit, i) => (Number(digit) - Number(code[i]) + 10) % 10);
  return steps.every((step) => step === 1) || steps.every((step) => step === 9);
}

/** Eight random digits, never one of the obvious ones. */
export function newCompanyCode(): string {
  for (;;) {
    const code = String(randomInt(0, 10 ** COMPANY_CODE_LENGTH)).padStart(COMPANY_CODE_LENGTH, "0");
    if (!looksGuessable(code)) return code;
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether the code given is the one in force. The digests are compared in
 * constant time, and a closed door (no code) is compared with a random value
 * the same way: the time of the answer says nothing about the code, nor
 * whether there is one.
 */
export function isCompanyCode(given: string, expected: string | null): boolean {
  const same = timingSafeEqual(digest(given), digest(expected ?? randomBytes(16).toString("hex")));
  return same && expected !== null;
}
