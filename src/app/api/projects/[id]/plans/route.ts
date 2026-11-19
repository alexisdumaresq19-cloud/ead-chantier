import { projectFor } from "@/server/access";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { listPlans } from "@/server/plans/queries";

/** The project's plans as the site sees them: published sheets only. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  return listPlans(id);
});
