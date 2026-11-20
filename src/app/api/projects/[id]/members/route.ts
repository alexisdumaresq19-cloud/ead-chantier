import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { projectFor } from "@/server/access";
import { requireAdmin, requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, route } from "@/server/http";
import type { Member } from "@/shared/api";
import { canManageProject } from "@/shared/roles";

/** The people on the project, as every member sees them (a contact list). */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const project = await projectFor(user, id);
  // Who is still to confirm is for those who may confirm them: the office,
  // and the project's foremen while it is open.
  const reviews =
    canManageProject(user.role) && (project.status !== "archive" || user.role === "admin");
  const rows = await db
    .select({ user: schema.users })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(and(eq(schema.projectMembers.projectId, id), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.name));
  return rows.map(({ user: u }) => {
    const unreviewed = reviews && u.unreviewed;
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      title: u.title,
      phone: u.phone,
      unreviewed,
      // Someone to confirm got their account when they scanned the site's
      // code, or made it themselves with the company's code. How and when
      // is for those who confirm, like the rest.
      scannedAt: unreviewed ? u.createdAt.toISOString() : null,
      joinedWith: unreviewed ? u.joinedWith : null,
    } satisfies Member & { scannedAt: string | null };
  });
});

/**
 * The office puts existing people on the project, archived or not (the
 * office may still change an archived project).
 */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdmin(request);
  await projectFor(admin, id);
  const { userIds } = await body(
    request,
    z.object({ userIds: z.array(z.string().max(40)).min(1).max(500) }),
  );
  // Deactivated people stay off the lists until the office reactivates them.
  const known = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.id, userIds), eq(schema.users.active, true)));
  if (known.length) {
    await db
      .insert(schema.projectMembers)
      .values(known.map((u) => ({ projectId: id, userId: u.id })))
      .onConflictDoNothing();
  }
  return { ok: true };
});
