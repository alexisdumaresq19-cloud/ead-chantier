import { eq } from "drizzle-orm";

import { createPersonalInvite, requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { notFound, originOf, route } from "@/server/http";
import type { InviteLink } from "@/shared/api";

/** A new link for someone: a first invitation, a new phone, a lost session. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdmin(request);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!user || !user.active) throw notFound("Personne introuvable.");
  const token = await createPersonalInvite(id, admin.id);
  return {
    url: `${originOf(request)}/i/${token}`,
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  } satisfies InviteLink;
});
