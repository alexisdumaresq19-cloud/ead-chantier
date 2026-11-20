import { and, eq, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { projectToChange } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, forbidden, HttpError, route } from "@/server/http";
import { DEMO_REFUSED, endAccess } from "@/server/people/links";
import { reviewRefusal } from "@/server/people/rules";

/**
 * The project's foreman (or the office) decides about a worker who came in
 * with the site's QR code. "confirm": the person is known, their session
 * renews from now on. "refuse": they leave the project and, if it was their
 * only one, their access is switched off, which signs their devices out.
 */
export const POST = route<{ id: string; userId: string }>(async (request, { id, userId }) => {
  const user = await requireUser(request);
  await projectToChange(user, id);
  if (user.demo) throw forbidden(DEMO_REFUSED);
  const { decision } = await body(request, z.object({ decision: z.enum(["confirm", "refuse"]) }));

  const deactivated = await db.transaction(async (tx) => {
    // Locked: a refusal on two projects at once, or a refusal and the
    // office's confirmation, are decided one after the other.
    const [target] = await tx
      .select({
        role: schema.users.role,
        active: schema.users.active,
        unreviewed: schema.users.unreviewed,
        onProject: raw<boolean>`exists (select 1 from ${schema.projectMembers}
          where ${schema.projectMembers.projectId} = ${id}
          and ${schema.projectMembers.userId} = ${schema.users.id})`,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update")
      .limit(1);
    const refusal = reviewRefusal(target ?? null);
    if (refusal)
      throw new HttpError(
        refusal.status,
        refusal.status === 404 ? "not_found" : "already_confirmed",
        refusal.message,
      );

    if (decision === "confirm") {
      await tx.update(schema.users).set({ unreviewed: false }).where(eq(schema.users.id, userId));
      return false;
    }
    await tx
      .delete(schema.projectMembers)
      .where(
        and(eq(schema.projectMembers.projectId, id), eq(schema.projectMembers.userId, userId)),
      );
    const [elsewhere] = await tx
      .select({ userId: schema.projectMembers.userId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, userId))
      .limit(1);
    if (elsewhere) return false;
    await endAccess(tx, userId);
    return true;
  });
  return { ok: true, deactivated };
});
