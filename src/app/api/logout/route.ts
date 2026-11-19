import { NextResponse } from "next/server";

import { currentUser, endSession, SESSION_COOKIE } from "@/server/auth";
import { route } from "@/server/http";

export const POST = route(async (request) => {
  const user = await currentUser(request);
  const response = NextResponse.json({ ok: true });
  if (user) await endSession(user.sessionId, response);
  else response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
});
