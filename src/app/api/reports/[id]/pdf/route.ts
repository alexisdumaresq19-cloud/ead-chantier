import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { reportPdf } from "@/server/reports/pdf";
import { reportToManage } from "@/server/reports/queries";
import { reportPdfName } from "@/shared/reports";

// A report with forty photos has them all fetched and redrawn.
export const maxDuration = 60;

/**
 * The report as a PDF, for whoever may read it. Shown in the browser's own
 * viewer; "?download" makes it a file to keep instead.
 */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const { row, project } = await reportToManage(user, id);
  const pdf = await reportPdf(row, project);
  const kept = request.nextUrl.searchParams.has("download") ? "attachment" : "inline";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      // The name is plain ASCII by construction (reportPdfName).
      "Content-Disposition": `${kept}; filename="${reportPdfName(project, row.day)}"`,
    },
  });
});
