import { isIP } from "node:net";

import { and, count, desc, eq, gt, inArray, lt, sql as raw } from "drizzle-orm";
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
// - A ceiling of accounts made in a day with the code in force (a new code
//   starts a new count too).
//
// With the defaults, finding one code among a hundred million at forty
// guesses a day would take thousands of years. A refusal is a 429 in plain
// French that says when to try again.
//
// Counting and noting a try happen together, one request at a time
// (holdDoor): requests sent all at once must not all read the count before
// any of them adds to it.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** What no longer counts is not kept. */
const KEPT = 2 * DAY;

export type Attempt = "wrong_code" | "phone_taken" | "created";
const attempts = schema.signupAttempts;

/** The eight 16-bit groups of an IPv6 address that isIP() accepted. */
function ipv6Groups(address: string): number[] {
  let text = address;
  // "::ffff:198.51.100.10": the last two groups written as an IPv4 address.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const parse = (part: string | undefined) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : [];
  const front = parse(head);
  const back = parse(tail);
  return [...front, ...Array(8 - front.length - back.length).fill(0), ...back];
}

/**
 * The network a client address belongs to, written one way only: an IPv4
 * address as itself (a port or the IPv6 wrapping "::ffff:" taken off), an
 * IPv6 address by its first 64 bits, which is what one home or one phone
 * gets (it could otherwise try from millions of addresses). Anything else
 * is not an address a proxy writes: all of it counts as one.
 */
export function networkOf(written: string): string {
  let text = written.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  if (bracketed) text = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(text)) text = text.slice(0, text.lastIndexOf(":"));
  text = text.replace(/%.*$/, "");
  const kind = isIP(text);
  if (kind === 4) return text;
  if (kind !== 6) return "invalid";
  const groups = ipv6Groups(text);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/**
 * The network a request came from: the first of x-forwarded-for. On the host
 * (Vercel) its edge writes that header itself, so a client cannot choose it
 * there. Behind a proxy that only appends, a client could: the ceilings for
 * everyone together hold the door even then.
 */
export function addressOf(request: Pick<NextRequest, "headers">): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const written = forwarded || request.headers.get("x-real-ip")?.trim();
  return written ? networkOf(written) : "unknown";
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
  /** Accounts made in the last day with the code in force, newest first. */
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
      ? `Trop d'essais à partir de ce réseau. Réessayez ${when}, ou demandez au bureau un lien pour entrer.`
      : refusal.reason === "everyone"
        ? `La création de comptes est en pause. Réessayez ${when}, ou demandez au bureau un lien pour entrer.`
        : `Beaucoup de comptes ont été créés aujourd'hui. Réessayez ${when}, ou demandez au bureau un lien pour entrer.`;
  return new HttpError(429, "too_many_signups", message);
}

/**
 * What the door has seen. `codeSince`: when the code in force was set; wrong
 * codes from before it were tried against another code and no longer count,
 * and the accounts made with another code no longer hold this one back.
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
  const since = codeWindow(codeSince, now);
  const [address, wrongCodes, accounts] = await Promise.all([
    newest(
      new Date(now.getTime() - HOUR),
      limits.triesPerHour,
      eq(attempts.addressHash, addressHash),
      inArray(attempts.outcome, ["wrong_code", "phone_taken"]),
    ),
    newest(since, limits.wrongCodesPerDay, eq(attempts.outcome, "wrong_code")),
    newest(since, limits.accountsPerDay, eq(attempts.outcome, "created")),
  ]);
  return { address, wrongCodes, accounts };
}

/** The day's window, starting no earlier than when the code in force was set. */
const codeWindow = (codeSince: Date | null, now: Date) => {
  const dayAgo = new Date(now.getTime() - DAY);
  return codeSince && codeSince > dayAgo ? codeSince : dayAgo;
};

/**
 * Takes the door's turn, for the rest of the transaction: one request at a
 * time counts the tries and notes its own. Under a flood, a request that
 * waited too long is refused, and the others are not held up behind it.
 */
export async function holdDoor(tx: Pick<typeof db, "execute">) {
  // How long a request waits its turn before giving up.
  await tx.execute(raw`set local lock_timeout = '5s'`);
  try {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtext('ead:signup'))`);
  } catch (error) {
    if (!lockTimedOut(error)) throw error;
    throw new HttpError(
      429,
      "too_many_signups",
      "Beaucoup de demandes en ce moment. Réessayez dans une minute.",
    );
  }
}

/** Postgres's "lock_not_available", however deep the driver wrapped it. */
function lockTimedOut(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if ((cause as { code?: unknown }).code === "55P03") return true;
  return false;
}

/** The door as the office sees it: shut for everyone until when and why, and today's accounts. */
export type DoorState = {
  pause: { reason: "everyone" | "accounts"; until: Date } | null;
  /** Accounts made with the code in force, in the last day. */
  accounts: number;
};

export async function doorState(
  codeSince: Date | null,
  limits: SignupLimits,
  now: Date,
): Promise<DoorState> {
  const counts = await doorCounts("", codeSince, limits, now);
  const refusal = doorRefusal({ ...counts, address: [] }, limits);
  const [made] = await db
    .select({ n: count() })
    .from(attempts)
    .where(
      and(eq(attempts.outcome, "created"), gt(attempts.createdAt, codeWindow(codeSince, now))),
    );
  return {
    pause:
      refusal && refusal.reason !== "address"
        ? { reason: refusal.reason, until: refusal.retryAt }
        : null,
    accounts: made?.n ?? 0,
  };
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
