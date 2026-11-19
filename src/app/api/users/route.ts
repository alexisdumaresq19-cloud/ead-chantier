import { asc, gt, inArray, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { createPersonalInvite, requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, originOf, route } from "@/server/http";
import { newId } from "@/server/ids";
import type { InviteLink, Person } from "@/shared/api";
import { ROLES } from "@/shared/roles";

/** Everyone, for the office: who they are, their projects, their devices. */
export const GET = route(async (request) => {
  await requireAdmin(request);
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.name));
  const memberships = await db.select().from(schema.projectMembers);
  const devices = await db
    .select({ userId: schema.sessions.userId, n: raw<number>`count(*)::int` })
    .from(schema.sessions)
    .where(gt(schema.sessions.expiresAt, new Date()))
    .groupBy(schema.sessions.userId);
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
    projectIds: memberships.filter((m) => m.userId === u.id).map((m) => m.projectId),
    deviceCount: deviceCount.get(u.id) ?? 0,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
});

const input = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  title: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(120).nullish(),
  projectIds: z.array(z.string()).max(200).default([]),
});

/** Adds a person and returns their invitation link, to send by text or email. */
export const POST = route(async (request) => {
  const admin = await requireAdmin(request);
  const data = await body(request, input);
  const id = newId();
  await db.insert(schema.users).values({
    id,
    name: data.name,
    role: data.role,
    title: data.title || null,
    phone: data.phone || null,
    email: data.email || null,
    createdBy: admin.id,
  });
  if (data.projectIds.length) {
    const projects = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(inArray(schema.projects.id, data.projectIds));
    if (projects.length) {
      await db
        .insert(schema.projectMembers)
        .values(projects.map((p) => ({ projectId: p.id, userId: id })));
    }
  }
  const token = await createPersonalInvite(id, admin.id);
  const invite: InviteLink = {
    url: `${originOf(request)}/i/${token}`,
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
  return { id, invite };
});
