import { eq } from "drizzle-orm";

import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";
import { route } from "@/server/http";
import { doorState } from "@/server/signup/door";
import { closeSignup, newCompanyCodeBy, readCompanyCode } from "@/server/signup/settings";
import type { CompanyCode } from "@/shared/signup";

// The company code, for the office only: read it, turn account creation on
// with a new code or give it a new one (POST), turn it off (DELETE). With it,
// the door's state: a pause for everyone is the office's to see and to lift.

async function shown(): Promise<CompanyCode> {
  const setting = await readCompanyCode();
  const [author] = setting.changedBy
    ? await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, setting.changedBy))
        .limit(1)
    : [];
  const door = setting.code
    ? await doorState(setting.changedAt, env.signupLimits, new Date())
    : { pause: null, accounts: 0 };
  return {
    code: setting.code,
    changedAt: setting.changedAt?.toISOString() ?? null,
    changedBy: author?.name ?? null,
    pause: door.pause && {
      reason: door.pause.reason === "everyone" ? "wrong_codes" : "accounts",
      until: door.pause.until.toISOString(),
    },
    accountsToday: door.accounts,
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
