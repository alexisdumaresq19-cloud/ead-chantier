import { z } from "zod";

import { projectFor, projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { body, route } from "@/server/http";
import { beginUpload } from "@/server/uploads";
import type { UploadTicket } from "@/shared/api";

const input = z.object({
  projectId: z.string(),
  kind: z.enum(["plan", "document", "photo"]),
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive(),
});

/** Announces a file and returns where the browser should send it. */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const data = await body(request, input);
  // Anyone on the project adds photos; plans and documents are for those who manage it.
  if (data.kind === "photo") await projectFor(user, data.projectId);
  else await projectToManage(user, data.projectId);
  const { upload, target } = await beginUpload(user, data);
  return { uploadId: upload.id, target } satisfies UploadTicket;
});
