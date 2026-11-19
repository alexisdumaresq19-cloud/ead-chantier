import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { projectFor } from "@/server/access";
import { requireAdmin, requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, route } from "@/server/http";
import type { Member } from "@/shared/api";

/** The people on the project, as every member sees them (a contact list). */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  const rows = await db
    .select({ user: schema.users })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.projectMembers.projectId, id))
    .orderBy(asc(schema.users.name));
  return rows
    .filter((r) => r.user.active)
    .map(({ user: u }): Member => ({
      id: u.id,
      name: u.name,
      role: u.role,
      title: u.title,
      phone: u.phone,
      unreviewed: u.unreviewed,
    }));
});

/** The office puts existing people on the project. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdmin(request);
  await projectFor(admin, id);
  const { userIds } = await body(
    request,
    z.object({ userIds: z.array(z.string()).min(1).max(200) }),
  );
  const known = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  if (known.length) {
    await db
      .insert(schema.projectMembers)
      .values(known.map((u) => ({ projectId: id, userId: u.id })))
      .onConflictDoNothing();
  }
  return { ok: true };
});
