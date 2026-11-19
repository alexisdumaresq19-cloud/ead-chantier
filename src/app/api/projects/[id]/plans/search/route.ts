import { projectFor } from "@/server/access";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { searchPlans } from "@/server/plans/queries";

export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  return searchPlans(id, request.nextUrl.searchParams.get("q") ?? "");
});
