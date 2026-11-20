import { NextResponse } from "next/server";

import { currentUser, SESSION_COOKIE, setSessionCookie } from "@/server/auth";
import { route, unauthorized } from "@/server/http";
import { consentInForce } from "@/server/legal/consent";
import { deleteOwnAccount } from "@/server/people/delete";
import type { Me } from "@/shared/api";

/** Who is signed in on this device. Called each time the app opens. */
export const GET = route(async (request) => {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  const me: Me = {
    id: user.id,
    name: user.name,
    role: user.role,
    title: user.title,
    unreviewed: user.unreviewed,
    demo: user.demo,
    assistantConsent: consentInForce(user.assistantConsentAt) !== null,
  };
  const response = NextResponse.json(me);
  // The cookie follows the session: pushed back with it on a device in
  // regular use, never beyond it (a QR-code session keeps its few days).
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) setSessionCookie(response, token, user.sessionExpiresAt);
  return response;
});

/**
 * Deletes one's own account, at once (src/server/people/delete.ts): every
 * device is signed out, this one included.
 */
export const DELETE = route(async (request) => {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  const outcome = await deleteOwnAccount(user.id);
  const response = NextResponse.json({ ok: true, outcome });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
});
