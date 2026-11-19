import { eq } from "drizzle-orm";

import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, notFound, route } from "@/server/http";

import { personalLink } from "../../_lib/people";

/** A new link for someone: a first invitation, a new phone, a lost session. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const admin = await requireAdmin(request);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!user) throw notFound("Personne introuvable.");
  if (!user.active)
    throw badRequest("Cette personne est désactivée. Réactivez-la avant de lui envoyer un lien.");
  return personalLink(request, id, admin.id);
});
