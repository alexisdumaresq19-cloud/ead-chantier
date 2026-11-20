import { and, eq, inArray, isNull } from "drizzle-orm";

import { DEMO_NAME, phoneKey } from "@/shared/access";

import type { Executor } from "../auth";
import { db, schema } from "../db/client";
import { HttpError } from "../http";
import { newId } from "../ids";
import { deleteOwnAccount } from "../people/delete";
import { newAccessCode } from "./code";
import { holdAccessDoor } from "./door";

// The demonstration access: a cell number from the range kept for fiction and
// a code, that let someone outside the team (Apple's reviewer, a client the
// office shows the app to) see the projects the office chose, as a foreman
// sees them, without ever touching the team. It is kept readable in the app's
// settings, as the company's code is: it opens nothing but those projects.
//
// Behind it stands one account (users.demo), made when the access is, and
// made again, on the same projects, when a visitor signs in after the last
// one deleted it: "Supprimer mon compte" works for the visitor as for anyone,
// and the next one still gets in. Its sessions last a day.

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
 * The first number of 418 555-0100 to 418 555-0199 that no active account
 * has. That range is kept for fiction: no one can own it, and no text
 * message sent to it reaches anybody.
 */
async function fictionalNumber(tx: Executor): Promise<string> {
  const taken = new Set(
    (
      await tx
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(and(eq(schema.users.active, true), isNull(schema.users.deletedAt)))
    ).map((user) => phoneKey(user.phone)),
  );
  for (let line = 100; line <= 199; line++) {
    const phone = `418 555-0${line}`;
    if (!taken.has(phoneKey(phone))) return phone;
  }
  throw new HttpError(409, "no_fictional_number", "Aucun numéro de démonstration n'est libre.");
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
 * The demonstration account, made if there is none (the last visitor deleted
 * it): a foreman, so that it shows the whole app, daily reports included;
 * the routes that touch the team refuse it (users.demo). Called with the
 * door held, so two visitors at once never make two accounts.
 */
export async function demoAccount(tx: Executor, setting: DemoSetting): Promise<string> {
  const [found] = await demoAccounts(tx).limit(1);
  if (found) return found.id;
  const id = newId();
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

const noProject = () => new HttpError(400, "no_project", "Cochez au moins un projet à montrer.");

/** Makes the access: a number, a code and its account, on these projects. */
export async function createDemoAccess(officeId: string, projectIds: string[], now = new Date()) {
  await db.transaction(async (tx) => {
    await holdAccessDoor(tx);
    if (await readDemoAccess(tx))
      throw new HttpError(409, "demo_exists", "L'accès de démonstration existe déjà.");
    const shown = await existing(tx, projectIds);
    if (!shown.length) throw noProject();
    const value = { phone: await fictionalNumber(tx), code: newAccessCode(), projectIds: shown };
    await write(tx, value, officeId, now);
    await demoAccount(tx, { ...value, changedAt: now, changedBy: officeId });
  });
}

/**
 * Other projects, or a new code. A new code signs the visitors out: the old
 * one may have gone further than meant.
 */
export async function changeDemoAccess(
  officeId: string,
  change: { projectIds?: string[]; newCode?: boolean },
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    await holdAccessDoor(tx);
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
    await holdAccessDoor(tx);
    await tx.delete(settings).where(eq(settings.key, KEY));
  });
  // No visitor gets in any more: the accounts left can go, one by one.
  for (const account of await demoAccounts(db)) await deleteOwnAccount(account.id);
}
