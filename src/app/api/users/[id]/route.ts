import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { z } from "zod";

import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, notFound, route } from "@/server/http";
import { ROLES } from "@/shared/roles";

const patch = z
  .object({
    name: z.string().trim().min(2).max(80),
    role: z.enum(ROLES),
    title: z.string().trim().max(80).nullable(),
    phone: z.string().trim().max(30).nullable(),
    email: z.string().trim().max(120).nullable(),
    active: z.boolean(),
    unreviewed: z.boolean(),
    projectIds: z.array(z.string()).max(200),
  })
  .partial();

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdmin(request);
  const { projectIds, ...fields } = await body(request, patch);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!user) throw notFound("Personne introuvable.");

  // The office must always keep at least one working administrator.
  const losesAdmin =
    user.role === "admin" && ((fields.role && fields.role !== "admin") || fields.active === false);
  if (losesAdmin) {
    if (id === admin.id)
      throw badRequest("Vous ne pouvez pas retirer votre propre accès au bureau.");
    const others = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(eq(schema.users.role, "admin"), eq(schema.users.active, true), ne(schema.users.id, id)),
      )
      .limit(1);
    if (!others.length) throw badRequest("Il doit rester au moins une personne du bureau.");
  }

  const clean = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v === "" ? null : v]),
  );
  if (Object.keys(clean).length)
    await db.update(schema.users).set(clean).where(eq(schema.users.id, id));
  // Someone deactivated is signed out everywhere at once.
  if (fields.active === false)
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));

  if (projectIds) {
    const valid = projectIds.length
      ? (
          await db
            .select({ id: schema.projects.id })
            .from(schema.projects)
            .where(inArray(schema.projects.id, projectIds))
        ).map((p) => p.id)
      : [];
    await db
      .delete(schema.projectMembers)
      .where(
        and(
          eq(schema.projectMembers.userId, id),
          valid.length ? notInArray(schema.projectMembers.projectId, valid) : undefined,
        ),
      );
    if (valid.length) {
      await db
        .insert(schema.projectMembers)
        .values(valid.map((projectId) => ({ projectId, userId: id })))
        .onConflictDoNothing();
    }
  }
  return { ok: true };
});
