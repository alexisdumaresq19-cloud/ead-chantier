import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { badRequest, route } from "@/server/http";
import { dayReport } from "@/server/reports/queries";
import { isRealDay } from "@/shared/reports";

/** The report of a day, or none, with the last crew noted before that day. */
export const GET = route<{ id: string; day: string }>(async (request, { id, day }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  if (!isRealDay(day)) throw badRequest("Date invalide.");
  return dayReport(user, id, day);
});
