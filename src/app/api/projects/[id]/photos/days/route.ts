import { projectFor } from "@/server/access";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { listPhotoDays } from "@/server/photos/queries";

/** The days that have photos, with how many: what lets someone go to a day. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  return listPhotoDays(id);
});
