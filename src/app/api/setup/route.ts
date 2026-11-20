import { sql as raw } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isSetupCode, openSession, setSessionCookie } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, forbidden, route } from "@/server/http";
import { newId } from "@/server/ids";

// Creating the very first account (the office administrator), once, with the
// setup code chosen at deployment. After that, everyone comes in by invitation.

async function hasUsers() {
  const [any] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return Boolean(any);
}

const alreadyDone = () => forbidden("L'application est déjà configurée.");

export const GET = route(async () => ({ needed: !(await hasUsers()) }));

export const POST = route(async (request) => {
  const input = await body(
    request,
    z.object({ code: z.string(), name: z.string().trim().min(2).max(80) }),
  );
  // Asked before the code is looked at: once the office exists, every code
  // gets the same answer, so the answers cannot be used to find the code.
  if (await hasUsers()) throw alreadyDone();
  if (!isSetupCode(input.code)) throw forbidden("Code de démarrage invalide.");

  // One account, even if two people send the right code at the same moment:
  // the lock makes them take turns, and the second finds the first's account.
  // (A lock held for the transaction only: the hosted database is reached
  // through a transaction pooler.) The account and its session are written
  // together: setup never ends closed with nobody signed in.
  const id = newId();
  const session = await db.transaction(async (tx) => {
    await tx.execute(raw`select pg_advisory_xact_lock(hashtext('ead:setup'))`);
    const [any] = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
    if (any) return null;
    await tx.insert(schema.users).values({ id, name: input.name, role: "admin" });
    return openSession(id, request, undefined, tx);
  });
  if (!session) throw alreadyDone();
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, session.token, session.expiresAt);
  return response;
});
