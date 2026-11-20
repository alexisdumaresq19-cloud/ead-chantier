import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import type { NextRequest } from "next/server";

import type { Executor } from "../auth";
import { db, schema } from "../db/client";
import type { SignupLimits } from "../env";
import { HttpError } from "../http";
import { newId, sign } from "../ids";

// The door of account creation. The company code is short so that people can
// type it: what keeps a stranger from guessing it is here, on the server,
// counted in the database so that every server instance holds the same door.
//
// - From one network address, a handful of refused tries an hour.
// - From everyone together, a ceiling of wrong codes a day against the code
//   in force: once reached, creation pauses until the oldest of them is a
//   day old, or until the office changes the code (which starts a new count).
// - A ceiling of accounts made in a day.
//
// With the defaults, finding one code among a hundred million at forty
// guesses a day would take thousands of years. A refusal is a 429 in plain
// French that says when to try again.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** What no longer counts is not kept. */
const KEPT = 2 * DAY;

export type Attempt = "wrong_code" | "phone_taken" | "created";
const attempts = schema.signupAttempts;

/**
 * The network address a request came from: the first of x-forwarded-for.
 * On the host (Vercel) its edge writes that header itself, so a client
 * cannot choose it there. Behind a proxy that only appends, a client could:
 * the ceilings for everyone together hold the door even then.
 */
export function addressOf(request: Pick<NextRequest, "headers">): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Addresses are personal data: only a keyed digest is kept. */
export const addressKey = (address: string) => sign(`signup-address:${address}`);

/**
 * When a window that holds `times` (newest first) has room again, or null
 * when it has room now: once the limit-th newest leaves the window, one
 * fewer than the limit is left in it.
 */
export function fullUntil(times: Date[], limit: number, windowMs: number): Date | null {
  if (times.length < limit) return null;
  return new Date(times[limit - 1].getTime() + windowMs);
}

export type DoorCounts = {
  /** Refused tries from this address in the last hour, newest first. */
  address: Date[];
  /** Wrong codes from everyone in the last day, against the code in force, newest first. */
  wrongCodes: Date[];
  /** Accounts made in the last day, newest first. */
  accounts: Date[];
};

export type DoorRefusal = { reason: "address" | "everyone" | "accounts"; retryAt: Date };

/** Why the door is shut right now, and until when; null when it is open. */
export function doorRefusal(counts: DoorCounts, limits: SignupLimits): DoorRefusal | null {
  const everyone = fullUntil(counts.wrongCodes, limits.wrongCodesPerDay, DAY);
  if (everyone) return { reason: "everyone", retryAt: everyone };
  const accounts = fullUntil(counts.accounts, limits.accountsPerDay, DAY);
  if (accounts) return { reason: "accounts", retryAt: accounts };
  const address = fullUntil(counts.address, limits.triesPerHour, HOUR);
  if (address) return { reason: "address", retryAt: address };
  return null;
}

/** "à 14 h 30", "demain à 9 h 05": when, said the way people say it here. */
export function whenText(at: Date, now: Date): string {
  const zone = "America/Toronto";
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
  const time = new Intl.DateTimeFormat("fr-CA", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  })
    .format(at)
    .replace(/\s/g, "\u00a0");
  return day(at) === day(now) ? `à ${time}` : `demain à ${time}`;
}

/** The refusal as the person reads it. Nothing in it is about the code. */
export function tooMany(refusal: DoorRefusal, now: Date): HttpError {
  // A minute more than the exact end, so that trying at the time said works.
  const when = whenText(new Date(refusal.retryAt.getTime() + 60_000), now);
  const message =
    refusal.reason === "address"
      ? `Trop d'essais à partir de ce réseau. Réessayez ${when}.`
      : refusal.reason === "everyone"
        ? `La création de comptes est en pause. Réessayez ${when}, ou demandez au bureau un lien pour entrer.`
        : `Beaucoup de comptes ont été créés aujourd'hui. Réessayez ${when}, ou demandez au bureau un lien pour entrer.`;
  return new HttpError(429, "too_many_signups", message);
}

/**
 * What the door has seen. `codeSince`: when the code in force was set; wrong
 * codes from before it were tried against another code and no longer count.
 */
export async function doorCounts(
  addressHash: string,
  codeSince: Date | null,
  limits: SignupLimits,
  now: Date,
  executor: Executor = db,
): Promise<DoorCounts> {
  const newest = (since: Date, limit: number, ...where: Parameters<typeof and>) =>
    executor
      .select({ at: attempts.createdAt })
      .from(attempts)
      .where(and(gt(attempts.createdAt, since), ...where))
      .orderBy(desc(attempts.createdAt))
      .limit(limit)
      .then((rows) => rows.map((row) => row.at));
  const dayAgo = new Date(now.getTime() - DAY);
  const [address, wrongCodes, accounts] = await Promise.all([
    newest(
      new Date(now.getTime() - HOUR),
      limits.triesPerHour,
      eq(attempts.addressHash, addressHash),
      inArray(attempts.outcome, ["wrong_code", "phone_taken"]),
    ),
    newest(
      codeSince && codeSince > dayAgo ? codeSince : dayAgo,
      limits.wrongCodesPerDay,
      eq(attempts.outcome, "wrong_code"),
    ),
    newest(dayAgo, limits.accountsPerDay, eq(attempts.outcome, "created")),
  ]);
  return { address, wrongCodes, accounts };
}

/** Notes an attempt, and lets go of those that no longer count. */
export async function noteAttempt(
  addressHash: string,
  outcome: Attempt,
  now: Date,
  executor: Executor = db,
) {
  await executor.insert(attempts).values({ id: newId(), addressHash, outcome, createdAt: now });
  await executor.delete(attempts).where(lt(attempts.createdAt, new Date(now.getTime() - KEPT)));
}
