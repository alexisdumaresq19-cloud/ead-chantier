import { requireUser } from "@/server/auth";
import { body, route } from "@/server/http";
import { reportChange } from "@/server/reports/input";
import { changeReport, deleteReport, reportOf, reportToManage } from "@/server/reports/queries";

export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  return reportOf(user, await reportToManage(user, id));
});

/** Saves a change, unless someone else changed the report in the meantime. */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await reportToManage(user, id);
  return changeReport(user, id, await body(request, reportChange));
});

/** Removes the report: its author or the office. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await deleteReport(user, await reportToManage(user, id));
  return { ok: true };
});
