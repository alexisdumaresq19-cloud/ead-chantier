import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { projectToChange, projectToManage } from "@/server/access";
import { createProjectInvite, requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { forbidden, originOf, route } from "@/server/http";
import type { InviteLink } from "@/shared/api";

/**
 * Until when the caller's current QR code for this site works; null when
 * they have none. The link itself is given once, when the code is made (only
 * its hash is kept): a device that still holds it asks here whether it is
 * still the one in force, before showing it again.
 */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  const [invite] = await db
    .select({ expiresAt: schema.invites.expiresAt })
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.projectId, id),
        eq(schema.invites.kind, "project"),
        eq(schema.invites.createdBy, user.id),
        isNull(schema.invites.revokedAt),
        gt(schema.invites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.invites.createdAt))
    .limit(1);
  return { expiresAt: invite?.expiresAt.toISOString() ?? null };
});

/**
 * A fresh QR code for the site, good for a day. It replaces the caller's
 * previous one. An archived project admits nobody: no code is made for it,
 * even for the office.
 */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const project = await projectToChange(user, id);
  if (project.status === "archive")
    throw forbidden("Ce projet est archivé : personne de nouveau n'y entre.");
  const { token, expiresAt } = await createProjectInvite(id, user.id);
  return {
    url: `${originOf(request)}/j/${token}`,
    expiresAt: expiresAt.toISOString(),
  } satisfies InviteLink;
});
