import { z } from "zod";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { body, route } from "@/server/http";
import { createFolder } from "@/server/plans/folders";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  const { name } = await body(request, z.object({ name: z.string().trim().min(1).max(60) }));
  return createFolder(id, name);
});
