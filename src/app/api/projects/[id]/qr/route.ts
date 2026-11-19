import { projectToManage } from "@/server/access";
import { createProjectInvite, requireUser } from "@/server/auth";
import { originOf, route } from "@/server/http";
import type { InviteLink } from "@/shared/api";

/** A fresh QR code for the site, good for a day. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  const { token, expiresAt } = await createProjectInvite(id, user.id);
  return {
    url: `${originOf(request)}/j/${token}`,
    expiresAt: expiresAt.toISOString(),
  } satisfies InviteLink;
});
