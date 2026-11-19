import { and, eq, inArray, isNull, sql as raw } from "drizzle-orm";

import type { ProjectSummary } from "@/shared/api";

import type { SessionUser } from "./auth";
import { db, schema } from "./db/client";

type ProjectRow = typeof schema.projects.$inferSelect;

/** Projects with their sheet and member counts, for lists. */
export async function summarize(rows: ProjectRow[]): Promise<ProjectSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const sheetCounts = await db
    .select({ projectId: schema.sheets.projectId, n: raw<number>`count(*)::int` })
    .from(schema.sheets)
    .where(and(inArray(schema.sheets.projectId, ids), isNull(schema.sheets.archivedAt)))
    .groupBy(schema.sheets.projectId);
  const memberCounts = await db
    .select({ projectId: schema.projectMembers.projectId, n: raw<number>`count(*)::int` })
    .from(schema.projectMembers)
    .where(inArray(schema.projectMembers.projectId, ids))
    .groupBy(schema.projectMembers.projectId);
  const sheets = new Map(sheetCounts.map((r) => [r.projectId, r.n]));
  const members = new Map(memberCounts.map((r) => [r.projectId, r.n]));
  return rows.map((p) => ({
    id: p.id,
    number: p.number,
    name: p.name,
    client: p.client,
    address: p.address,
    city: p.city,
    status: p.status,
    sheetCount: sheets.get(p.id) ?? 0,
    memberCount: members.get(p.id) ?? 0,
  }));
}

/** The projects this person sees: all of them for the office, theirs otherwise. */
export async function projectsOf(user: SessionUser): Promise<ProjectRow[]> {
  if (user.role === "admin") {
    return db
      .select()
      .from(schema.projects)
      .orderBy(raw`${schema.projects.createdAt} desc`);
  }
  const rows = await db
    .select({ project: schema.projects })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .where(eq(schema.projectMembers.userId, user.id))
    .orderBy(raw`${schema.projects.createdAt} desc`);
  return rows.map((r) => r.project);
}
