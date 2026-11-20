import { and, eq, isNull, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { projectFor } from "@/server/access";
import { requireAdmin, requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, notFound, route } from "@/server/http";
import { summarize } from "@/server/projects";
import type { ProjectDetail } from "@/shared/api";
import { canManageProject } from "@/shared/roles";

const count = async (
  table: typeof schema.documents | typeof schema.photos | typeof schema.dailyReports,
  projectId: string,
) => {
  const archived = "archivedAt" in table ? isNull(table.archivedAt) : undefined;
  const [row] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(table)
    .where(and(eq(table.projectId, projectId), archived));
  return row?.n ?? 0;
};

export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const project = await projectFor(user, id);
  const [summary] = await summarize([project]);
  return {
    ...summary,
    description: project.description,
    latitude: project.latitude,
    longitude: project.longitude,
    documentCount: await count(schema.documents, id),
    photoCount: await count(schema.photos, id),
    // Daily reports are for foremen and the office.
    reportCount: canManageProject(user.role) ? await count(schema.dailyReports, id) : 0,
    canManage: canManageProject(user.role),
    // An archived project is read-only for everyone but the office.
    canChange:
      canManageProject(user.role) && (project.status !== "archive" || user.role === "admin"),
  } satisfies ProjectDetail;
});

const patch = z
  .object({
    name: z.string().trim().max(120),
    number: z.string().trim().max(40).nullable(),
    client: z.string().trim().max(120).nullable(),
    address: z.string().trim().max(200).nullable(),
    city: z.string().trim().max(80).nullable(),
    description: z.string().trim().max(2000).nullable(),
    status: z.enum(["actif", "archive"]),
  })
  .partial();

/** The office corrects a project's details, archives it or reopens it. */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  await requireAdmin(request);
  const input = await body(request, patch);
  // Said in words for the office: a validation error would name the field in English.
  if (input.name !== undefined && input.name.length < 2)
    throw badRequest("Entrez le nom du projet.");
  const clean = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === "" ? null : v]));
  // An update with nothing to set is an error for the database.
  const [project] = Object.keys(clean).length
    ? await db.update(schema.projects).set(clean).where(eq(schema.projects.id, id)).returning()
    : await db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
  if (!project) throw notFound("Projet introuvable.");
  return (await summarize([project]))[0];
});
