import { eq } from "drizzle-orm";

import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { route } from "@/server/http";
import { closeSignup, newCompanyCodeBy, readCompanyCode } from "@/server/signup/settings";
import type { CompanyCode } from "@/shared/signup";

// The company code, for the office only: read it, turn account creation on
// with a new code or give it a new one (POST), turn it off (DELETE).

async function shown(): Promise<CompanyCode> {
  const setting = await readCompanyCode();
  const [author] = setting.changedBy
    ? await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, setting.changedBy))
        .limit(1)
    : [];
  return {
    code: setting.code,
    changedAt: setting.changedAt?.toISOString() ?? null,
    changedBy: author?.name ?? null,
  };
}

export const GET = route(async (request) => {
  await requireAdmin(request);
  return shown();
});

export const POST = route(async (request) => {
  const admin = await requireAdmin(request);
  await newCompanyCodeBy(admin.id);
  return shown();
});

export const DELETE = route(async (request) => {
  const admin = await requireAdmin(request);
  await closeSignup(admin.id);
  return shown();
});
