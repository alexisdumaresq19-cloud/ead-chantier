import { NextResponse } from "next/server";
import { z } from "zod";

import { startSession } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";
import { body, forbidden, route } from "@/server/http";
import { newId } from "@/server/ids";

// Creating the very first account (the office administrator), once, with the
// setup code chosen at deployment. After that, everyone comes in by invitation.

async function hasUsers() {
  const [any] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return Boolean(any);
}

export const GET = route(async () => ({ needed: !(await hasUsers()) }));

export const POST = route(async (request) => {
  const input = await body(
    request,
    z.object({ code: z.string(), name: z.string().trim().min(2).max(80) }),
  );
  if (!env.setupCode || input.code !== env.setupCode)
    throw forbidden("Code de démarrage invalide.");
  if (await hasUsers()) throw forbidden("L'application est déjà configurée.");
  const id = newId();
  await db.insert(schema.users).values({ id, name: input.name, role: "admin" });
  const response = NextResponse.json({ ok: true });
  await startSession(id, request, response);
  return response;
});
