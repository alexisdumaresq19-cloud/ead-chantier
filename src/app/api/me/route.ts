import { NextResponse } from "next/server";

import { currentUser, SESSION_COOKIE, setSessionCookie } from "@/server/auth";
import { route, unauthorized } from "@/server/http";
import type { Me } from "@/shared/api";

/** Who is signed in on this device. Called each time the app opens. */
export const GET = route(async (request) => {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  const me: Me = { id: user.id, name: user.name, role: user.role, title: user.title };
  const response = NextResponse.json(me);
  // Each visit pushes the cookie's end date back, so a device in regular use
  // never has to sign in again.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) setSessionCookie(response, token, new Date(Date.now() + 400 * 86_400_000));
  return response;
});
