import { projectToChange, projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { body, route } from "@/server/http";
import { newReport } from "@/server/reports/input";
import { createReport, listReports } from "@/server/reports/queries";

/** The project's daily reports, newest day first. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  return listReports(id);
});

/** Writes the report of a day. A day that already has one answers with it, unchanged. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToChange(user, id);
  return createReport(user, id, await body(request, newReport));
});
