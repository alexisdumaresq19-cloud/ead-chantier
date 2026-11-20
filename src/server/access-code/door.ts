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
//   together; a new code for that number starts a new count. One network
//   fills a third of it at most (and is then held back for that number
//   alone): a single stranger who knows someone's number cannot shut that
//   person out.
// - The demonstration's number is held by the network count only. Its code
//   is no one's secret (it opens sample projects), and it is published to
//   Apple's reviewer: a count per number would let anyone shut it.
//
// A number nobody has is counted the same way as one that belongs to
// someone, so the door's answers say nothing about who has an account.
//
// The tries are kept in the same table as account creation's, under
// outcomes of their own and keys of their own, and counted under locks of
// their own (one per network, one per number): these tries never pause
// account creation, its tries never shut this door, and a flood of guesses
// on some numbers never makes the others wait.

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

/** How much of a number's count one network fills: a third, so that it takes three. */
export const networkShare = (limits: AccessLimits) => Math.ceil(limits.wrongPerNumber / 3);

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
// Keyed "<number's key>.<network's key>" (base64url has no dot): the number's
// count is read by its prefix, and each network's part in it by the rest.
const NUMBER = "access_number";
// One row each time a visitor's sign-in makes the demonstration account again.
const DEMO_MADE = "access_demo";
type Outcome = typeof NETWORK | typeof NUMBER | typeof DEMO_MADE;
const attempts = schema.signupAttempts;

/** A row of the table under this door's own outcome (the column's type names account creation's). */
const row = (outcome: Outcome, addressHash: string, now: Date) => ({
  id: newId(),
  addressHash,
  outcome: outcome as unknown as typeof attempts.$inferInsert.outcome,
  createdAt: now,
});

export type AccessCounts = {
  /** Wrong tries from this network in the last hour, newest first. */
  network: Date[];
  /** Wrong codes for this number since `numberSince`, newest first, with the network each came from. */
  number: { at: Date; network: string }[];
};

export type AccessRefusal = { reason: "network" | "number"; retryAt: Date };

/**
 * Whether the door is shut to this network, for this number. `network` is
 * this request's key, to find its own part of the number's count.
 */
export function accessRefusal(
  counts: AccessCounts,
  limits: AccessLimits,
  network: string,
): AccessRefusal | null {
  const share = networkShare(limits);
  // Each network's newest wrong codes, a share at most: what one network
  // does beyond that is held back below, for that network only.
  const taken = new Map<string, number>();
  const capped = counts.number.filter(({ network: from }) => {
    const seen = taken.get(from) ?? 0;
    taken.set(from, seen + 1);
    return seen < share;
  });
  const everyone = fullUntil(
    capped.map((entry) => entry.at),
    limits.wrongPerNumber,
    DAY,
  );
  if (everyone) return { reason: "number", retryAt: everyone };
  const mine = fullUntil(
    counts.number.filter((entry) => entry.network === network).map((entry) => entry.at),
    share,
    DAY,
  );
  if (mine) return { reason: "number", retryAt: mine };
  const shut = fullUntil(counts.network, limits.triesPerHour, HOUR);
  if (shut) return { reason: "network", retryAt: shut };
  return null;
}

/** The refusal as the person reads it: when to try again, and what to do meanwhile. */
export function tooManyTries(refusal: AccessRefusal, now: Date): HttpError {
  // A minute more than the exact end, so that trying at the time said works.
  const when = whenText(new Date(refusal.retryAt.getTime() + 60_000), now);
  return new HttpError(
    429,
    "too_many_tries",
    // Office Wi-Fi is one network for everyone on it: the phone's own data
    // is another, and works at once.
    refusal.reason === "network"
      ? `Trop d'essais à partir de ce réseau. Réessayez ${when}, ou essayez sans Wi-Fi, avec les données cellulaires.`
      : `Trop d'essais pour ce numéro. Réessayez ${when}, ou demandez un nouveau code au bureau.`,
  );
}

/**
 * What the door has seen. `number`: the number's key, or null for a count
 * of the network alone (the demonstration's number). `numberSince`: when the
 * newest code for this number was made, if it is less than a day old; wrong
 * codes from before were tried against another code.
 */
export async function accessCounts(
  keys: { network: string; number: string | null },
  numberSince: Date | null,
  limits: AccessLimits,
  now: Date,
  executor: Executor = db,
): Promise<AccessCounts> {
  const dayAgo = new Date(now.getTime() - DAY);
  const since = numberSince && numberSince > dayAgo ? numberSince : dayAgo;
  const [network, number] = await Promise.all([
    executor
      .select({ at: attempts.createdAt })
      .from(attempts)
      .where(
        and(
          raw`${attempts.outcome} = ${NETWORK}`,
          raw`${attempts.addressHash} = ${keys.network}`,
          gt(attempts.createdAt, new Date(now.getTime() - HOUR)),
        ),
      )
      .orderBy(desc(attempts.createdAt))
      .limit(limits.triesPerHour)
      .then((rows) => rows.map((entry) => entry.at)),
    keys.number
      ? executor
          .select({ at: attempts.createdAt, key: attempts.addressHash })
          .from(attempts)
          .where(
            and(
              raw`${attempts.outcome} = ${NUMBER}`,
              raw`starts_with(${attempts.addressHash}, ${`${keys.number}.`})`,
              gt(attempts.createdAt, since),
            ),
          )
          .orderBy(desc(attempts.createdAt))
          // Rows stop coming once the number is shut; this only bounds a read.
          .limit(1000)
          .then((rows) =>
            rows.map((entry) => ({
              at: entry.at,
              network: entry.key.slice(keys.number!.length + 1),
            })),
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
  await executor
    .insert(attempts)
    .values([row(NETWORK, keys.network, now), row(NUMBER, `${keys.number}.${keys.network}`, now)]);
  await executor
    .delete(attempts)
    .where(
      and(
        raw`${attempts.outcome} in (${NETWORK}, ${NUMBER}, ${DEMO_MADE})`,
        lt(attempts.createdAt, new Date(now.getTime() - KEPT)),
      ),
    );
}

// --- The demonstration account made again -------------------------------------

/**
 * How many times a day visitors' sign-ins may make the demonstration account
 * again after one deleted it. Each new account starts with its own allowance
 * of the assistant and of uploads: without a bound, deleting and coming back
 * would make them endless.
 */
export const DEMO_REMAKES_PER_DAY = 5;
const DEMO_KEY = "access-demo";

/** Refuses one more demonstration account today, or notes it. Under holdDemo. */
export async function countDemoRemake(executor: Executor, now: Date) {
  const made = await executor
    .select({ at: attempts.createdAt })
    .from(attempts)
    .where(
      and(
        raw`${attempts.outcome} = ${DEMO_MADE}`,
        gt(attempts.createdAt, new Date(now.getTime() - DAY)),
      ),
    )
    .orderBy(desc(attempts.createdAt))
    .limit(DEMO_REMAKES_PER_DAY);
  const full = fullUntil(
    made.map((entry) => entry.at),
    DEMO_REMAKES_PER_DAY,
    DAY,
  );
  if (full)
    throw new HttpError(
      429,
      "too_many_demos",
      `Le compte de démonstration a été supprimé et refait plusieurs fois aujourd'hui. Réessayez ${whenText(new Date(full.getTime() + 60_000), now)}, ou demandez un autre code au bureau.`,
    );
  await executor.insert(attempts).values(row(DEMO_MADE, sign(DEMO_KEY), now));
}

// --- Locks ----------------------------------------------------------------------

/**
 * Takes a turn for the rest of the transaction: one request at a time counts
 * the tries under a key and notes its own, so requests sent all at once
 * cannot all read the count before any adds to it. Under a flood, a request
 * that waited too long is refused.
 */
async function hold(tx: Pick<typeof db, "execute">, lock: ReturnType<typeof raw>) {
  await tx.execute(raw`set local lock_timeout = '5s'`);
  try {
    await tx.execute(lock);
  } catch (error) {
    if (!lockTimedOut(error)) throw error;
    throw new HttpError(
      429,
      "too_many_tries",
      "Beaucoup de demandes en ce moment. Réessayez dans une minute.",
    );
  }
}

// Always taken in this order (network, then the demonstration or the
// number), so that two requests never wait for each other in a circle.

/** The turn of one network's count. */
export const holdNetwork = (tx: Pick<typeof db, "execute">, key: string) =>
  hold(tx, raw`select pg_advisory_xact_lock(hashtext('ead:access-network'), hashtext(${key}))`);

/** The turn of one number's count. */
export const holdNumber = (tx: Pick<typeof db, "execute">, key: string) =>
  hold(tx, raw`select pg_advisory_xact_lock(hashtext('ead:access-number'), hashtext(${key}))`);

/**
 * The turn of the demonstration access: its setting and its account. Two
 * visitors at once never make two accounts, and a sign-in never uses a code
 * the office is replacing.
 */
export const holdDemo = (tx: Pick<typeof db, "execute">) =>
  hold(tx, raw`select pg_advisory_xact_lock(hashtext('ead:access-demo'))`);

/** Postgres's "lock_not_available", however deep the driver wrapped it. */
function lockTimedOut(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if ((cause as { code?: unknown }).code === "55P03") return true;
  return false;
}
