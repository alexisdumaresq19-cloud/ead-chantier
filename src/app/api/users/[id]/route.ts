import { and, asc, eq, inArray } from "drizzle-orm";

import { DEMO_PHONE_TAKEN, isDemoPhone } from "@/server/access-code/demo";
import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, forbidden, notFound, route } from "@/server/http";
import { DEMO_MANAGED, endAccess, settleSiteCodes } from "@/server/people/links";
import { officeLockout, personChange, personProblem } from "@/server/people/rules";

/** The office changes someone's details, role, state or projects. */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdmin(request);
  const { projectIds, ...fields } = await body(request, personChange);
  const problem = personProblem(fields);
  if (problem) throw badRequest(problem);
  // The demonstration's number belongs to no one: a person never shares it.
  if (await isDemoPhone(fields.phone)) throw badRequest(DEMO_PHONE_TAKEN, "demo_phone");
  const changesAccess = fields.role !== undefined || fields.active !== undefined;

  await db.transaction(async (tx) => {
    // The office's accounts are locked while a role or a state changes: two
    // people of the office demoting each other at the same moment must not
    // both succeed and leave nobody in charge. Always in the same order, so
    // two such changes wait for each other instead of deadlocking.
    const office = changesAccess
      ? await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.role, "admin"), eq(schema.users.active, true)))
          .orderBy(asc(schema.users.id))
          .for("update")
      : null;
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    // A deleted account is not brought back: the person makes a new one.
    if (!user || user.deletedAt) throw notFound("Personne introuvable.");
    // Never a role, a number or projects other than the access gives it:
    // the demonstration account is managed from its own card.
    if (user.demo) throw forbidden(DEMO_MANAGED);
    if (office) {
      if (!office.some((account) => account.id === admin.id)) throw forbidden("Réservé au bureau.");
      const refusal = officeLockout({
        target: user,
        change: fields,
        actorId: admin.id,
        otherActiveAdmins: office.filter((account) => account.id !== id).length,
      });
      if (refusal) throw badRequest(refusal);
    }

    const clean = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value === "" ? null : value]),
    );
    if (Object.keys(clean).length)
      await tx.update(schema.users).set(clean).where(eq(schema.users.id, id));

    if (fields.active === false) await endAccess(tx, id);

    if (projectIds) {
      const current = (
        await tx
          .select({ projectId: schema.projectMembers.projectId })
          .from(schema.projectMembers)
          .where(eq(schema.projectMembers.userId, id))
      ).map((member) => member.projectId);
      const wanted = projectIds.length
        ? (
            await tx
              .select({ id: schema.projects.id })
              .from(schema.projects)
              .where(inArray(schema.projects.id, projectIds))
          ).map((project) => project.id)
        : [];
      const removed = current.filter((projectId) => !wanted.includes(projectId));
      const added = wanted.filter((projectId) => !current.includes(projectId));
      if (removed.length) {
        await tx
          .delete(schema.projectMembers)
          .where(
            and(
              eq(schema.projectMembers.userId, id),
              inArray(schema.projectMembers.projectId, removed),
            ),
          );
      }
      if (added.length) {
        await tx
          .insert(schema.projectMembers)
          .values(added.map((projectId) => ({ projectId, userId: id })))
          .onConflictDoNothing();
      }
    }

    if (changesAccess || projectIds) await settleSiteCodes(tx, id);
  });
  return { ok: true };
});
