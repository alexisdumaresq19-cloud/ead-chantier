import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import { completeUpload } from "@/server/uploads";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const upload = await completeUpload(user, id);
  return { uploadId: upload.id };
});
