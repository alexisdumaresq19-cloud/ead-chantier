import { asc, gt, inArray, isNull, sql as raw } from "drizzle-orm";

import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, route } from "@/server/http";
import { newId } from "@/server/ids";
import { personalLink } from "@/server/people/links";
import { newPerson, personProblem } from "@/server/people/rules";
import type { Person } from "@/shared/api";

/**
 * Everyone, for the office: who they are, their projects, their devices.
 * Someone who deleted their account is no longer anyone's to manage: their
 * name stays on what they wrote, and nowhere here.
 */
export const GET = route(async (request) => {
  await requireAdmin(request);
  const users = await db
    .select()
    .from(schema.users)
    .where(isNull(schema.users.deletedAt))
    .orderBy(asc(schema.users.name));
  const memberships = await db
    .select({ userId: schema.projectMembers.userId, projectId: schema.projectMembers.projectId })
    .from(schema.projectMembers);
  const devices = await db
    .select({ userId: schema.sessions.userId, n: raw<number>`count(*)::int` })
    .from(schema.sessions)
    .where(gt(schema.sessions.expiresAt, new Date()))
    .groupBy(schema.sessions.userId);
  const projectIds = new Map<string, string[]>();
  for (const { userId, projectId } of memberships) {
    const list = projectIds.get(userId);
    if (list) list.push(projectId);
    else projectIds.set(userId, [projectId]);
  }
  const deviceCount = new Map(devices.map((d) => [d.userId, d.n]));
  return users.map((u): Person => ({
    id: u.id,
    name: u.name,
    role: u.role,
    title: u.title,
    phone: u.phone,
    email: u.email,
    active: u.active,
    unreviewed: u.unreviewed,
    joinedWith: u.joinedWith,
    demo: u.demo,
    projectIds: projectIds.get(u.id) ?? [],
    deviceCount: deviceCount.get(u.id) ?? 0,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
});

/** Adds a person and returns their invitation link, to send by text or email. */
export const POST = route(async (request) => {
  const admin = await requireAdmin(request);
  const data = await body(request, newPerson);
  const problem = personProblem(data);
  if (problem) throw badRequest(problem);
  const id = newId();
  // The person and their projects are saved together, or not at all.
  await db.transaction(async (tx) => {
    await tx.insert(schema.users).values({
      id,
      name: data.name,
      role: data.role,
      title: data.title || null,
      phone: data.phone || null,
      email: data.email || null,
      createdBy: admin.id,
    });
    if (!data.projectIds.length) return;
    const projects = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(inArray(schema.projects.id, data.projectIds));
    if (projects.length) {
      await tx
        .insert(schema.projectMembers)
        .values(projects.map((p) => ({ projectId: p.id, userId: id })));
    }
  });
  return { id, invite: await personalLink(request, id, admin.id) };
});
