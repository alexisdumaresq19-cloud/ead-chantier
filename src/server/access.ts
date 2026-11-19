import { and, eq } from "drizzle-orm";

import { canManageProject } from "@/shared/roles";

import type { SessionUser } from "./auth";
import { db, schema } from "./db/client";
import { forbidden, notFound } from "./http";

export type Project = typeof schema.projects.$inferSelect;

/**
 * The project, if this person may see it: the office sees every project,
 * everyone else only the projects they are a member of. A project someone
 * may not see answers "not found", so its existence is not revealed.
 */
export async function projectFor(user: SessionUser, projectId: string): Promise<Project> {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) throw notFound("Projet introuvable.");
  if (user.role === "admin") return project;
  const [member] = await db
    .select({ userId: schema.projectMembers.userId })
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        eq(schema.projectMembers.userId, user.id),
      ),
    )
    .limit(1);
  if (!member) throw notFound("Projet introuvable.");
  return project;
}

/** Same, for someone about to add or change plans, documents or members. */
export async function projectToManage(user: SessionUser, projectId: string): Promise<Project> {
  const project = await projectFor(user, projectId);
  if (!canManageProject(user.role)) throw forbidden("Réservé au bureau et aux contremaîtres.");
  return project;
}
