import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client";
import { HttpError } from "../http";
import { newId } from "../ids";

// Each dictation costs a few cents. A person's allowance is far above a day's
// work (a report takes two or three goes), and stops a phone, a script or a
// stolen session from running up the bill.

export const DICTATIONS_PER_HOUR = 40;
export const DICTATIONS_PER_DAY = 150;
/**
 * The demonstration account's, per account: anyone the office gave its code
 * to can use it, and deleting it makes a new one (a few times a day at most,
 * src/server/access-code/door.ts), whose count starts again.
 */
export const DEMO_DICTATIONS_PER_DAY = 20;

const uses = schema.assistantUses;

/** Whether one more dictation would exceed what a person may ask for. */
export const exceedsDictationAllowance = (lastHour: number, lastDay: number, demo = false) =>
  lastHour >= DICTATIONS_PER_HOUR ||
  lastDay >= (demo ? DEMO_DICTATIONS_PER_DAY : DICTATIONS_PER_DAY);

/**
 * Counts one dictation for this person, or refuses it (429) when they have
 * asked for too many. To be called before the AI service is.
 */
export async function countDictation(userId: string, demo = false): Promise<void> {
  const mine = and(eq(uses.userId, userId), eq(uses.kind, "dictation"));
  // Compared on the database's clock, the same for every server.
  const [recent] = await db
    .select({
      lastHour: sql<number>`count(*) filter (where ${uses.createdAt} > now() - interval '1 hour')::int`,
      lastDay: sql<number>`count(*)::int`,
    })
    .from(uses)
    .where(and(mine, sql`${uses.createdAt} > now() - interval '1 day'`));
  if (exceedsDictationAllowance(recent?.lastHour ?? 0, recent?.lastDay ?? 0, demo))
    throw new HttpError(
      429,
      "too_many_dictations",
      "Beaucoup de dictées en peu de temps. Réessayez un peu plus tard, ou remplissez le rapport à la main.",
    );
  await db.insert(uses).values({ id: newId(), userId, kind: "dictation" });
  // What no longer counts is not kept.
  await db
    .delete(uses)
    .where(and(eq(uses.userId, userId), sql`${uses.createdAt} < now() - interval '2 days'`));
}
