import { and, desc, gt, lt, sql as raw } from "drizzle-orm";

import type { Executor } from "../auth";
import { db, schema } from "../db/client";
import { HttpError } from "../http";
import { newId, sign } from "../ids";
import { fullUntil, whenText } from "../signup/door";

// The door of signing in by typing a cell number and a code. Eight digits are
// a hundred million codes: what keeps a stranger from finding one is the
// number of guesses, counted here in the database so that every server
// instance holds the same door.
//
// - From one network (an IPv4 address, an IPv6 /64), a handful of wrong
//   tries an hour, whatever numbers they were for.
// - For one cell number, a handful of wrong codes a day, from every network
//   together; a new code for that number starts a new count.
//
// A number nobody has is counted the same way as one that belongs to
// someone, so the door's answers say nothing about who has an account.
//
// The tries are kept in the same table as account creation's, under
// outcomes of their own and keys of their own, and counted under a lock of
// their own: these tries never pause account creation, and its tries never
// shut this door.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** What no longer counts is not kept (account creation lets go of it too). */
const KEPT = 2 * DAY;

export type AccessLimits = {
  /** Wrong tries from one network in an hour. */
  triesPerHour: number;
  /** Wrong codes for one cell number in a day, since its newest code. */
  wrongPerNumber: number;
};

export const ACCESS_LIMITS: AccessLimits = { triesPerHour: 10, wrongPerNumber: 10 };

/**
 * The limits from the settings (a test server may set its own), each a whole
 * number from 1 to 10 000; anything else keeps the default.
 */
export function accessLimitsFrom(settings: Record<string, string | undefined>): AccessLimits {
  const read = (name: string, fallback: number) => {
    const value = Number(settings[name]);
    return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : fallback;
  };
  return {
    triesPerHour: read("ACCESS_TRIES_PER_HOUR", ACCESS_LIMITS.triesPerHour),
    wrongPerNumber: read("ACCESS_WRONG_PER_NUMBER", ACCESS_LIMITS.wrongPerNumber),
  };
}

let limits: AccessLimits | undefined;
/** Read once: every request of a server holds the same door. */
export const accessLimits = () => (limits ??= accessLimitsFrom(process.env));

/** The two keys a wrong try is noted under. Addresses are personal data: only keyed digests. */
export const networkKey = (network: string) => sign(`access-network:${network}`);
export const numberKey = (phoneDigits: string) => sign(`access-number:${phoneDigits}`);

// Account creation's table holds these tries too; its outcomes are its own
// ("wrong_code", "phone_taken", "created"), so neither door counts the other's.
const NETWORK = "access_network";
const NUMBER = "access_number";
type Outcome = typeof NETWORK | typeof NUMBER;
const attempts = schema.signupAttempts;

export type AccessCounts = {
  /** Wrong tries from this network in the last hour, newest first. */
  network: Date[];
  /** Wrong codes for this number since `numberSince`, newest first. */
  number: Date[];
};

export type AccessRefusal = { reason: "network" | "number"; retryAt: Date };

export function accessRefusal(counts: AccessCounts, limits: AccessLimits): AccessRefusal | null {
  const number = fullUntil(counts.number, limits.wrongPerNumber, DAY);
  if (number) return { reason: "number", retryAt: number };
  const network = fullUntil(counts.network, limits.triesPerHour, HOUR);
  if (network) return { reason: "network", retryAt: network };
  return null;
}

/** The refusal as the person reads it: when to try again, and what to do meanwhile. */
export function tooManyTries(refusal: AccessRefusal, now: Date): HttpError {
  // A minute more than the exact end, so that trying at the time said works.
  const when = whenText(new Date(refusal.retryAt.getTime() + 60_000), now);
  return new HttpError(
    429,
    "too_many_tries",
    refusal.reason === "network"
      ? `Trop d'essais à partir de ce réseau. Réessayez ${when}, ou demandez au bureau un lien pour entrer.`
      : `Trop d'essais pour ce numéro. Réessayez ${when}, ou demandez un nouveau code au bureau.`,
  );
}

/**
 * What the door has seen. `numberSince`: when the newest code for this
 * number was made, if it is less than a day old; wrong codes from before
 * were tried against another code.
 */
export async function accessCounts(
  keys: { network: string; number: string | null },
  numberSince: Date | null,
  limits: AccessLimits,
  now: Date,
  executor: Executor = db,
): Promise<AccessCounts> {
  const newest = (outcome: Outcome, key: string, since: Date, limit: number) =>
    executor
      .select({ at: attempts.createdAt })
      .from(attempts)
      .where(
        and(
          raw`${attempts.outcome} = ${outcome}`,
          raw`${attempts.addressHash} = ${key}`,
          gt(attempts.createdAt, since),
        ),
      )
      .orderBy(desc(attempts.createdAt))
      .limit(limit)
      .then((rows) => rows.map((row) => row.at));
  const dayAgo = new Date(now.getTime() - DAY);
  const [network, number] = await Promise.all([
    newest(NETWORK, keys.network, new Date(now.getTime() - HOUR), limits.triesPerHour),
    keys.number
      ? newest(
          NUMBER,
          keys.number,
          numberSince && numberSince > dayAgo ? numberSince : dayAgo,
          limits.wrongPerNumber,
        )
      : Promise.resolve([]),
  ]);
  return { network, number };
}

/** Notes a wrong try, under the network and under the number, and lets go of old ones. */
export async function noteWrongTry(
  keys: { network: string; number: string },
  now: Date,
  executor: Executor = db,
) {
  // The column's type names account creation's outcomes only: these two are
  // this door's, and nothing of account creation reads them.
  const row = (outcome: Outcome, addressHash: string) => ({
    id: newId(),
    addressHash,
    outcome: outcome as unknown as typeof attempts.$inferInsert.outcome,
    createdAt: now,
  });
  await executor.insert(attempts).values([row(NETWORK, keys.network), row(NUMBER, keys.number)]);
  await executor
    .delete(attempts)
    .where(
      and(
        raw`${attempts.outcome} in (${NETWORK}, ${NUMBER})`,
        lt(attempts.createdAt, new Date(now.getTime() - KEPT)),
      ),
    );
}

/**
 * Takes this door's turn for the rest of the transaction: one request at a
 * time counts the tries and notes its own, so requests sent all at once
 * cannot all read the count before any adds to it. Account creation has a
 * lock of its own. Under a flood, a request that waited too long is refused.
 */
export async function holdAccessDoor(tx: Pick<typeof db, "execute">) {
  await tx.execute(raw`set local lock_timeout = '5s'`);
  try {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtext('ead:access-code'))`);
  } catch (error) {
    if (!lockTimedOut(error)) throw error;
    throw new HttpError(
      429,
      "too_many_tries",
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
