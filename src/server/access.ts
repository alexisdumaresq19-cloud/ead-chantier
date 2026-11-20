import { and, eq } from "drizzle-orm";

import { canManageProject } from "@/shared/roles";

import type { SessionUser } from "./auth";
import { db, schema } from "./db/client";
import { forbidden, notFound } from "./http";

export type Project = typeof schema.projects.$inferSelect;

/** Whether this person is on the project's list (the office is on none: it sees them all). */
export async function isProjectMember(userId: string, projectId: string): Promise<boolean> {
  const [member] = await db
    .select({ userId: schema.projectMembers.userId })
    .from(schema.projectMembers)
    .where(
      and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId)),
    )
    .limit(1);
  return Boolean(member);
}

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
  if (!(await isProjectMember(user.id, projectId))) throw notFound("Projet introuvable.");
  return project;
}

/**
 * Same, for what only those who manage the project may see or do (the office
 * and its foremen). It says nothing about the project being open: a route
 * that changes something uses projectToChange.
 */
export async function projectToManage(user: SessionUser, projectId: string): Promise<Project> {
  const project = await projectFor(user, projectId);
  if (!canManageProject(user.role)) throw forbidden("Réservé au bureau et aux contremaîtres.");
  return project;
}

// An archived project is read-only for everyone but the office, and nobody
// new joins it (see findInvite in auth.ts for the QR codes). Its members keep
// reading it.

/** Refuses a change to an archived project, unless the office makes it. */
export function assertOpen(user: SessionUser, project: Project) {
  if (project.status === "archive" && user.role !== "admin")
    throw forbidden("Ce projet est archivé.");
}

/**
 * For a change to the project's content by someone who manages it (plans,
 * documents, folders, QR codes, reports): refused once the project is
 * archived. Reads stay on projectToManage.
 */
export async function projectToChange(user: SessionUser, projectId: string): Promise<Project> {
  const project = await projectToManage(user, projectId);
  assertOpen(user, project);
  return project;
}

/**
 * For what any member adds to the project (a photo): refused once the project
 * is archived.
 */
export async function projectToAddTo(user: SessionUser, projectId: string): Promise<Project> {
  const project = await projectFor(user, projectId);
  assertOpen(user, project);
  return project;
}
