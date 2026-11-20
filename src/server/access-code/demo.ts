import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { DEMO_NAME, phoneKey } from "@/shared/access";

import type { Executor } from "../auth";
import { db, schema } from "../db/client";
import { HttpError } from "../http";
import { newId } from "../ids";
import { deleteOwnAccount } from "../people/delete";
import { newAccessCode } from "./code";
import { countDemoRemake, forgetDemoRemakes, holdDemo } from "./door";

// The demonstration access: a cell number from the range kept for fiction and
// a code, that let someone outside the team (Apple's reviewer, a client the
// office shows the app to) see the projects the office chose, as a foreman
// sees them, without ever touching the team. It is kept readable in the app's
// settings, as the company's code is: it opens nothing but those projects.
//
// Behind it stands one account (users.demo), made when the access is, and
// there again, on the same projects, when a visitor signs in after the last
// one deleted it: "Supprimer mon compte" works for the visitor as for anyone,
// and the next one still gets in. An account that had added something comes
// back as itself, so that what the demonstration added stays its own to
// change; one that had added nothing is gone, and a new one is made. Its
// sessions last a day.

const KEY = "demo_access";
const settings = schema.appSettings;

export type DemoSetting = {
  phone: string;
  code: string;
  projectIds: string[];
  changedAt: Date;
  changedBy: string | null;
};

type Stored = { phone: string; code: string; projectIds: string[] };

export async function readDemoAccess(executor: Executor = db): Promise<DemoSetting | null> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  if (!row?.value) return null;
  const stored = JSON.parse(row.value) as Stored;
  return { ...stored, changedAt: row.updatedAt, changedBy: row.updatedBy };
}

// When a visitor last signed in, kept beside the access and not on the
// account: a visitor may delete the account, and one that added nothing
// leaves no row, while the office still wants to know that someone came.
const SEEN_KEY = "demo_access_seen";

/** Notes a visitor's sign-in. Under holdDemo, in the sign-in's own transaction. */
export async function noteDemoVisit(tx: Executor, now: Date) {
  const text = now.toISOString();
  await tx
    .insert(settings)
    .values({ key: SEEN_KEY, value: text, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: text, updatedAt: now } });
}

/** When a visitor last signed in with the access in place; null if none has. */
export async function demoLastVisit(executor: Executor = db): Promise<Date | null> {
  const [row] = await executor
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SEEN_KEY))
    .limit(1);
  return row?.value ? new Date(row.value) : null;
}

async function write(tx: Executor, value: Stored, userId: string, now: Date) {
  const text = JSON.stringify(value);
  await tx
    .insert(settings)
    .values({ key: KEY, value: text, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: text, updatedBy: userId, updatedAt: now },
    });
}

/**
 * The first number of 418 555-0100 to 418 555-0199 that no account has,
 * switched off or not (one may be switched back on). That range is kept for
 * fiction: no one can own it, and no text message sent to it reaches anybody.
 */
async function fictionalNumber(tx: Executor): Promise<string> {
  const taken = new Set(
    (
      await tx
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(isNull(schema.users.deletedAt))
    ).map((user) => phoneKey(user.phone)),
  );
  for (let line = 100; line <= 199; line++) {
    const phone = `418 555-0${line}`;
    if (!taken.has(phoneKey(phone))) return phone;
  }
  throw new HttpError(409, "no_fictional_number", "Aucun numéro de démonstration n'est libre.");
}

/** Said when the office gives a person the number the demonstration uses. */
export const DEMO_PHONE_TAKEN =
  "Ce numéro est celui de l'accès de démonstration. Entrez le cellulaire de la personne.";

/** Whether this number, however typed, is the demonstration's. */
export async function isDemoPhone(phone: string | null | undefined, executor: Executor = db) {
  const key = phoneKey(phone);
  if (!key) return false;
  const setting = await readDemoAccess(executor);
  return setting !== null && phoneKey(setting.phone) === key;
}

/** The projects of the list that still exist. */
async function existing(tx: Executor, projectIds: string[]): Promise<string[]> {
  if (!projectIds.length) return [];
  const rows = await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(inArray(schema.projects.id, projectIds));
  return rows.map((row) => row.id);
}

const demoAccounts = (tx: Executor) =>
  tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.demo, true),
        eq(schema.users.active, true),
        isNull(schema.users.deletedAt),
      ),
    );

/** Puts the account on exactly these projects. */
async function setProjects(tx: Executor, userId: string, projectIds: string[]) {
  await tx.delete(schema.projectMembers).where(eq(schema.projectMembers.userId, userId));
  if (projectIds.length)
    await tx
      .insert(schema.projectMembers)
      .values(projectIds.map((projectId) => ({ projectId, userId })))
      .onConflictDoNothing();
}

/**
 * The demonstration account a visitor, or the office, deleted after it had
 * added something: its row stays, with the name alone, for what it added
 * (src/server/people/delete.ts). Null when there is none.
 */
async function formerDemoAccount(tx: Executor): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.demo, true), isNotNull(schema.users.deletedAt)))
    .orderBy(desc(schema.users.deletedAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Puts the demonstration account in place. The one that left its name on
 * photos, documents or reports is brought back, rather than a new one made:
 * a visitor who deletes the account and returns still changes what was added
 * before, and no row piles up at each visit. Nothing of an earlier visitor
 * comes back with it: deleting kept the name alone, and ended every session.
 */
async function makeDemoAccount(tx: Executor, setting: DemoSetting): Promise<string> {
  const former = await formerDemoAccount(tx);
  const id = former ?? newId();
  if (former)
    await tx
      .update(schema.users)
      .set({
        name: DEMO_NAME,
        role: "contremaitre",
        phone: setting.phone,
        active: true,
        deletedAt: null,
      })
      .where(eq(schema.users.id, former));
  else
    await tx.insert(schema.users).values({
      id,
      name: DEMO_NAME,
      role: "contremaitre",
      phone: setting.phone,
      demo: true,
      createdBy: setting.changedBy,
    });
  await setProjects(tx, id, await existing(tx, setting.projectIds));
  return id;
}

/**
 * The demonstration account for a visitor's sign-in, put back in place if
 * there is none (the last visitor deleted it), a few times a day at most: a foreman,
 * so that it shows the whole app, daily reports included; the routes that
 * touch the team, or what others wrote, refuse it (users.demo). Called with
 * holdDemo held, so two visitors at once never make two accounts.
 */
export async function demoAccount(tx: Executor, setting: DemoSetting, now: Date): Promise<string> {
  const [found] = await demoAccounts(tx).limit(1);
  if (found) return found.id;
  await countDemoRemake(tx, now);
  return makeDemoAccount(tx, setting);
}

const noProject = () => new HttpError(400, "no_project", "Cochez au moins un projet à montrer.");

/** Makes the access: a number, a code and its account, on these projects. */
export async function createDemoAccess(officeId: string, projectIds: string[], now = new Date()) {
  await db.transaction(async (tx) => {
    await holdDemo(tx);
    if (await readDemoAccess(tx))
      throw new HttpError(409, "demo_exists", "L'accès de démonstration existe déjà.");
    const shown = await existing(tx, projectIds);
    if (!shown.length) throw noProject();
    const value = { phone: await fictionalNumber(tx), code: newAccessCode(), projectIds: shown };
    await write(tx, value, officeId, now);
    // A new access is a new code: what an earlier one's visitors deleted
    // today must not pause this one after its first deletion. Nobody has
    // come with it yet either.
    await forgetDemoRemakes(tx);
    await tx.delete(settings).where(eq(settings.key, SEEN_KEY));
    await makeDemoAccount(tx, { ...value, changedAt: now, changedBy: officeId });
  });
}

/**
 * Other projects, or a new code. A new code signs the visitors out: the old
 * one may have gone further than meant. It also lets visitors make the
 * account again at once, if deleting it too often had paused that: the
 * refusal sends them to the office for a new code.
 */
export async function changeDemoAccess(
  officeId: string,
  change: { projectIds?: string[]; newCode?: boolean },
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    await holdDemo(tx);
    const setting = await readDemoAccess(tx);
    if (!setting) throw new HttpError(404, "not_found", "Il n'y a pas d'accès de démonstration.");
    const projectIds = change.projectIds ? await existing(tx, change.projectIds) : null;
    if (projectIds && !projectIds.length) throw noProject();
    const value = {
      phone: setting.phone,
      code: change.newCode ? newAccessCode() : setting.code,
      projectIds: projectIds ?? setting.projectIds,
    };
    await write(tx, value, officeId, now);
    if (change.newCode) await forgetDemoRemakes(tx);
    for (const account of await demoAccounts(tx)) {
      if (projectIds) await setProjects(tx, account.id, projectIds);
      if (change.newCode)
        await tx.delete(schema.sessions).where(eq(schema.sessions.userId, account.id));
    }
  });
}

/**
 * Removes the access: the number and the code stop working, and the account
 * is deleted as its visitor would delete it, which signs it out everywhere.
 */
export async function removeDemoAccess() {
  await db.transaction(async (tx) => {
    await holdDemo(tx);
    await tx.delete(settings).where(inArray(settings.key, [KEY, SEEN_KEY]));
  });
  // No visitor gets in any more: the accounts left can go, one by one.
  for (const account of await demoAccounts(db)) await deleteOwnAccount(account.id);
}
