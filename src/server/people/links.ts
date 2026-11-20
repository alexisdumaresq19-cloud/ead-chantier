import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { createPersonalInvite } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { originOf } from "@/server/http";
import { hashToken } from "@/server/ids";
import type { InviteLink } from "@/shared/api";

// What the people routes share: making someone's link, and closing the ways
// in that a person leaves behind when they lose a right.

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A new personal link for someone, as the office will send it. The office
 * vouches for whoever it sends a link to: someone who came in by a site's QR
 * code is confirmed by it.
 */
export async function personalLink(
  request: NextRequest,
  userId: string,
  createdBy: string,
): Promise<InviteLink> {
  await db
    .update(schema.users)
    .set({ unreviewed: false })
    .where(and(eq(schema.users.id, userId), eq(schema.users.unreviewed, true)));
  const token = await createPersonalInvite(userId, createdBy);
  // The end date is read back rather than computed again, so the screen
  // never promises more days than the server gives.
  const [invite] = await db
    .select({ expiresAt: schema.invites.expiresAt })
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, hashToken(token)))
    .limit(1);
  return { url: `${originOf(request)}/i/${token}`, expiresAt: invite.expiresAt.toISOString() };
}

/**
 * Called after someone's role, state or projects changed: ends the site QR
 * codes they made for projects they may no longer invite people to. A code
 * outlives the screen that showed it (a printed poster, a forwarded link), so
 * it must not keep working once its author has lost that right.
 */
export async function settleSiteCodes(tx: Tx, userId: string) {
  const [user] = await tx
    .select({ role: schema.users.role, active: schema.users.active })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  // The office invites to any project.
  if (!user || (user.active && user.role === "admin")) return;
  const keep =
    user.active && user.role === "contremaitre"
      ? (
          await tx
            .select({ projectId: schema.projectMembers.projectId })
            .from(schema.projectMembers)
            .where(eq(schema.projectMembers.userId, userId))
        ).map((member) => member.projectId)
      : [];
  await tx
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invites.kind, "project"),
        eq(schema.invites.createdBy, userId),
        isNull(schema.invites.revokedAt),
        keep.length ? notInArray(schema.invites.projectId, keep) : undefined,
      ),
    );
}

/**
 * Switches someone's access off: every device is signed out at once, and
 * the links they have not opened yet stay dead, even after a reactivation
 * (the office then sends a new one). Their QR codes end as well.
 */
export async function endAccess(tx: Tx, userId: string) {
  await tx.update(schema.users).set({ active: false }).where(eq(schema.users.id, userId));
  await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await tx
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invites.kind, "personal"),
        eq(schema.invites.userId, userId),
        isNull(schema.invites.revokedAt),
      ),
    );
  await settleSiteCodes(tx, userId);
}
