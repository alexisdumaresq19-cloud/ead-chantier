import { NextResponse } from "next/server";

import { accessCodeInput, signInWithCode } from "@/server/access-code/sign-in";
import { setSessionCookie } from "@/server/auth";
import { body, route } from "@/server/http";

// Signing in by typing one's cell number and the office's code
// (src/server/access-code). Anyone may ask, signed in or not.

export const POST = route(async (request) => {
  const input = await body(request, accessCodeInput);
  const session = await signInWithCode(request, input);
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, session.token, session.expiresAt);
  return response;
});
