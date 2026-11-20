import { sql as raw } from "drizzle-orm";

import type { db } from "../db/client";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * One change at a time to the names of a project's plans (sheet numbers,
 * folder names): once a name is found free, it stays free until the change
 * is saved. Held until the transaction ends.
 */
export const lockPlanNames = (tx: Transaction, projectId: string) =>
  tx.execute(raw`select pg_advisory_xact_lock(hashtext(${projectId}))`);
