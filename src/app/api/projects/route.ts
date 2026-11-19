import { z } from "zod";

import { requireAdmin, requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, route } from "@/server/http";
import { newId } from "@/server/ids";
import { projectsOf, summarize } from "@/server/projects";

const projectInput = z.object({
  name: z.string().trim().min(2).max(120),
  number: z.string().trim().max(40).nullish(),
  client: z.string().trim().max(120).nullish(),
  address: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(80).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

export const GET = route(async (request) => {
  const user = await requireUser(request);
  return summarize(await projectsOf(user));
});

export const POST = route(async (request) => {
  const user = await requireAdmin(request);
  const input = await body(request, projectInput);
  const [project] = await db
    .insert(schema.projects)
    .values({
      id: newId(),
      name: input.name,
      number: input.number || null,
      client: input.client || null,
      address: input.address || null,
      city: input.city || null,
      description: input.description || null,
      createdBy: user.id,
    })
    .returning();
  return (await summarize([project]))[0];
});
