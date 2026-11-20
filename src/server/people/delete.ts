import { and, asc, eq, isNull, sql as raw } from "drizzle-orm";

import { db, schema } from "@/server/db/client";
import { badRequest, notFound } from "@/server/http";

import type { Tx } from "./links";
import { deletionRefusal } from "./rules";

// A person deletes their own account, from the account screen (Apple asks
// that an app where an account can be made lets it be deleted from inside).
//
// What goes: the account's sessions and devices, its invitations, its places
// on projects, its contact details, and the site QR codes it made. What
// someone wrote for the company (reports, photos, documents, plans) is the
// company's record and stays; the tables name their author by id and read the
// name from the person's row. So the row of someone who wrote anything stays
// with the name alone, switched off for good (deletedAt): it never signs in
// again and no list of people shows it. Someone who wrote nothing is removed
// entirely.

/** Whether the person's name is on any of the company's records. */
async function wroteAnything(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.execute<{ wrote: boolean }>(raw`
    select exists (select 1 from ${schema.dailyReports} where ${schema.dailyReports.createdBy} = ${userId})
        or exists (select 1 from ${schema.photos} where ${schema.photos.createdBy} = ${userId})
        or exists (select 1 from ${schema.documents} where ${schema.documents.createdBy} = ${userId})
        or exists (select 1 from ${schema.sheets} where ${schema.sheets.createdBy} = ${userId})
        or exists (select 1 from ${schema.sheetRevisions} where ${schema.sheetRevisions.createdBy} = ${userId})
        or exists (select 1 from ${schema.planImports} where ${schema.planImports.createdBy} = ${userId})
        or exists (select 1 from ${schema.projects} where ${schema.projects.createdBy} = ${userId})
      as wrote`);
  return Boolean(row?.wrote);
}

/**
 * Deletes the account, at once. "kept": the name stays on what the person
 * wrote; "removed": nothing of them is left.
 */
export async function deleteOwnAccount(userId: string): Promise<"kept" | "removed"> {
  return db.transaction(async (tx) => {
    // The office's accounts are locked, as when a role changes: two people of
    // the office deleting their accounts at the same moment must not both
    // succeed and leave nobody in charge. Always in the same order.
    const office = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true)))
      .orderBy(asc(schema.users.id))
      .for("update");
    const [user] = await tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!user) throw notFound("Ce compte n'existe plus.");
    const refusal = deletionRefusal(user, office.filter((account) => account.id !== userId).length);
    if (refusal) throw badRequest(refusal, "last_office_account");

    // The QR codes the person made end now, wherever they are printed.
    await tx
      .update(schema.invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.invites.kind, "project"),
          eq(schema.invites.createdBy, userId),
          isNull(schema.invites.revokedAt),
        ),
      );
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await tx.delete(schema.invites).where(eq(schema.invites.userId, userId));
    await tx.delete(schema.projectMembers).where(eq(schema.projectMembers.userId, userId));
    await tx.delete(schema.assistantUses).where(eq(schema.assistantUses.userId, userId));

    if (!(await wroteAnything(tx, userId))) {
      await tx.delete(schema.users).where(eq(schema.users.id, userId));
      return "removed";
    }
    await tx
      .update(schema.users)
      .set({
        active: false,
        unreviewed: false,
        title: null,
        phone: null,
        email: null,
        joinedWith: null,
        lastSeenAt: null,
        deletedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));
    return "kept";
  });
}
