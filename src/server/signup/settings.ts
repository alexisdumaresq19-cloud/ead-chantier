import { eq } from "drizzle-orm";

import type { Executor } from "../auth";
import { db, schema } from "../db/client";
import { newCompanyCode } from "./code";

// The company code, kept in the app's settings table: one row, its value the
// code while account creation is open and null once the office turns it off.
// The row's date is when the code in force was set: the door counts wrong
// codes from then on.

const KEY = "company_code";
const settings = schema.appSettings;

export type CompanyCodeSetting = {
  code: string | null;
  changedAt: Date | null;
  changedBy: string | null;
};

export async function readCompanyCode(executor: Executor = db): Promise<CompanyCodeSetting> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  return row
    ? { code: row.value, changedAt: row.updatedAt, changedBy: row.updatedBy }
    : { code: null, changedAt: null, changedBy: null };
}

/**
 * Turns account creation on with a new code, or gives it a new one: the old
 * code stops working at once. Accounts already made keep working.
 */
export async function newCompanyCodeBy(userId: string, now = new Date()): Promise<string> {
  const code = newCompanyCode();
  await write(code, userId, now);
  return code;
}

/** Turns account creation off. Turned on again, it gets a new code. */
export async function closeSignup(userId: string, now = new Date()) {
  await write(null, userId, now);
}

async function write(value: string | null, userId: string, now: Date) {
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: userId, updatedAt: now },
    });
}
