import { and, eq, isNull, sql as raw } from "drizzle-orm";
import { z } from "zod";

import {
  changeDemoAccess,
  createDemoAccess,
  readDemoAccess,
  removeDemoAccess,
} from "@/server/access-code/demo";
import { demoRemakesPausedUntil } from "@/server/access-code/door";
import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, route } from "@/server/http";
import type { DemoAccessState } from "@/shared/access";

// The demonstration access, for the office only (src/server/access-code/demo.ts):
// read it, make it on some projects (POST), change its projects or its code
// (PATCH), remove it (DELETE).

const projectIds = z.array(z.string().max(40)).max(500);

async function shown(): Promise<DemoAccessState> {
  const setting = await readDemoAccess();
  if (!setting) return { access: null };
  const [author] = setting.changedBy
    ? await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, setting.changedBy))
        .limit(1)
    : [];
  // The last visit, of the account in place or of one its visitor deleted.
  const [seen] = await db
    .select({ at: schema.users.lastSeenAt, active: schema.users.active })
    .from(schema.users)
    .where(and(eq(schema.users.demo, true), isNull(schema.users.deletedAt)))
    .orderBy(raw`${schema.users.lastSeenAt} desc nulls last`)
    .limit(1);
  return {
    access: {
      phone: setting.phone,
      code: setting.code,
      projectIds: setting.projectIds,
      changedAt: setting.changedAt.toISOString(),
      changedBy: author?.name ?? null,
      lastSeenAt: seen?.at?.toISOString() ?? null,
      // Visitors are stuck only while no account stands and none may be made.
      pausedUntil: seen?.active
        ? null
        : ((await demoRemakesPausedUntil(db, new Date()))?.toISOString() ?? null),
    },
  };
}

export const GET = route(async (request) => {
  await requireAdmin(request);
  return shown();
});

export const POST = route(async (request) => {
  const admin = await requireAdmin(request);
  const input = await body(request, z.object({ projectIds }));
  await createDemoAccess(admin.id, input.projectIds);
  return shown();
});

export const PATCH = route(async (request) => {
  const admin = await requireAdmin(request);
  const input = await body(
    request,
    z.object({ projectIds: projectIds.optional(), newCode: z.literal(true).optional() }),
  );
  await changeDemoAccess(admin.id, input);
  return shown();
});

export const DELETE = route(async (request) => {
  await requireAdmin(request);
  await removeDemoAccess();
  return shown();
});
