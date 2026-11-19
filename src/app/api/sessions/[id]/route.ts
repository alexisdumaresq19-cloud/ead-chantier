import { eq } from "drizzle-orm";

import { endSession, requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { notFound, route } from "@/server/http";

/** Signs a device out: one's own, or anyone's for the office. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  if (!session || (session.userId !== user.id && user.role !== "admin"))
    throw notFound("Appareil introuvable.");
  await endSession(id);
  return { ok: true };
});
