import { and, desc, eq, gt } from "drizzle-orm";

import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { forbidden, notFound, route } from "@/server/http";
import type { Device } from "@/shared/api";

/** The devices signed in as someone: their own, or anyone's for the office. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const userId = id === "me" ? user.id : id;
  if (userId !== user.id) {
    if (user.role !== "admin") throw forbidden();
    const [person] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!person) throw notFound("Personne introuvable.");
  }
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.lastSeenAt));
  return rows.map((s): Device => ({
    id: s.id,
    label: s.label,
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    current: s.id === user.sessionId,
  }));
});
