import { NextResponse } from "next/server";

import { currentUser, setSessionCookie } from "@/server/auth";
import { body, HttpError, route } from "@/server/http";
import { createAccountWithCode, signupInput } from "@/server/signup/account";
import { readCompanyCode } from "@/server/signup/settings";
import type { SignupStatus } from "@/shared/signup";

// A newcomer makes their own account with the company's code
// (src/server/signup). Anyone may ask, signed in or not.

/** Only whether account creation is open: the first screen offers it or not. */
export const GET = route(
  async () => ({ open: (await readCompanyCode()).code !== null }) satisfies SignupStatus,
);

export const POST = route(async (request) => {
  const input = await body(request, signupInput);
  // Never a second account behind someone's back: a device already signed in
  // opens the app instead.
  const me = await currentUser(request);
  if (me)
    throw new HttpError(
      409,
      "signed_in",
      `Cet appareil est déjà connecté sous le nom de ${me.name}. Ouvrez l'application.`,
    );
  const session = await createAccountWithCode(request, input);
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, session.token, session.expiresAt);
  return response;
});
