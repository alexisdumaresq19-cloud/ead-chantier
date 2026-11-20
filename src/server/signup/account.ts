import { and, eq, isNull, sql as raw } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { canadianPhone, codeDigits, COMPANY_CODE_LENGTH, PHONE_HINT } from "@/shared/signup";

import { openSession, typedLine, UNREVIEWED_SESSION_DAYS } from "../auth";
import { db, schema } from "../db/client";
import { env, type SignupLimits } from "../env";
import { badRequest, HttpError } from "../http";
import { newId } from "../ids";
import { isCompanyCode } from "./code";
import { addressKey, addressOf, doorCounts, doorRefusal, noteAttempt, tooMany } from "./door";
import { readCompanyCode } from "./settings";

// A newcomer makes their own account with the company's code: a worker,
// "unreviewed", on no project, signed in on this device for the few days the
// office has to confirm them (as after a site's QR code). The office then
// puts them on their sites.

export const signupInput = z.object({
  name: z.string().max(200),
  phone: z.string().max(100),
  code: z.string().max(100),
});
export type SignupFields = z.infer<typeof signupInput>;

/** A refusal about one field: the screen shows it under that field. */
const fieldError = (code: "bad_name" | "bad_phone" | "bad_code", message: string) =>
  badRequest(message, code);

/**
 * What was typed, cleaned, or the refusal of the first field that is wrong.
 * Nothing here looks at the code in force: its form is no secret.
 */
export function cleanSignup(input: SignupFields): { name: string; phone: string; code: string } {
  const name = typedLine(input.name);
  if (name === null)
    throw fieldError("bad_name", "Ce nom contient des caractères non permis. Retapez-le.");
  if (name.length < 2) throw fieldError("bad_name", "Entrez votre prénom et votre nom.");
  if (name.length > 80) throw fieldError("bad_name", "Ce nom est trop long.");
  const phone = canadianPhone(input.phone);
  if (!phone) throw fieldError("bad_phone", `Entrez un numéro de cellulaire de ${PHONE_HINT}`);
  const code = codeDigits(input.code);
  if (code.length !== COMPANY_CODE_LENGTH || /[^\d\s-]/.test(input.code))
    throw fieldError("bad_code", `Le code d'entreprise a ${COMPANY_CODE_LENGTH} chiffres.`);
  return { name, phone, code };
}

/**
 * The one answer for a wrong code, a code replaced since and account creation
 * turned off: a stranger learns nothing from it.
 */
export const wrongCode = () =>
  new HttpError(400, "wrong_code", "Ce code ne fonctionne pas. Vérifiez-le auprès du bureau.");

/**
 * Someone with an account already has this number. Said only to whoever
 * holds the code (it is checked first), and counted as a refused try from
 * their address: a handful an hour at most, so the code cannot be used to
 * go through the company's phone numbers.
 */
const phoneTaken = () =>
  new HttpError(
    409,
    "phone_taken",
    "Ce numéro est déjà celui d'un compte. Demandez au bureau un lien pour entrer sur ce téléphone.",
  );

/** Whether an active account already has this number, however it was typed. */
async function phoneInUse(phone: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, "");
  const typed = raw`regexp_replace(${schema.users.phone}, '\\D', '', 'g')`;
  const [found] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.active, true),
        isNull(schema.users.deletedAt),
        raw`(${typed} = ${digits} or ${typed} = ${`1${digits}`})`,
      ),
    )
    .limit(1);
  return Boolean(found);
}

/**
 * Makes the account and opens this device's session, or refuses. Everything
 * is written in one transaction; the caller gives the cookie once it is
 * committed. `now` and `limits` are given by the tests.
 */
export async function createAccountWithCode(
  request: NextRequest,
  input: SignupFields,
  { now = new Date(), limits = env.signupLimits }: { now?: Date; limits?: SignupLimits } = {},
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const typed = cleanSignup(input);
  const address = addressKey(addressOf(request));
  const setting = await readCompanyCode();

  // The door is asked before the code is looked at: once it is shut, the
  // right code gets the same refusal as any other.
  const refusal = doorRefusal(await doorCounts(address, setting.changedAt, limits, now), limits);
  if (refusal) throw tooMany(refusal, now);

  if (!isCompanyCode(typed.code, setting.code)) {
    await noteAttempt(address, "wrong_code", now);
    throw wrongCode();
  }
  if (await phoneInUse(typed.phone)) {
    await noteAttempt(address, "phone_taken", now);
    throw phoneTaken();
  }

  return db.transaction(async (tx) => {
    // One creation at a time: the day's ceiling of accounts is counted again
    // here, so requests sent together cannot pass it, and the code is read
    // again, so one replaced a moment ago no longer opens anything.
    await tx.execute(raw`select pg_advisory_xact_lock(hashtext('ead:signup'))`);
    const current = await readCompanyCode(tx);
    if (!isCompanyCode(typed.code, current.code)) throw wrongCode();
    const counted = await doorCounts(address, current.changedAt, limits, now, tx);
    const late = doorRefusal({ ...counted, address: [], wrongCodes: [] }, limits);
    if (late) throw tooMany(late, now);

    const userId = newId();
    await tx.insert(schema.users).values({
      id: userId,
      name: typed.name,
      phone: typed.phone,
      role: "travailleur",
      unreviewed: true,
      joinedWith: "company_code",
      createdAt: now,
    });
    await noteAttempt(address, "created", now, tx);
    // Until the office confirms the person, the device stays signed in for a
    // few days only (see sessionRenewal).
    const session = await openSession(userId, request, UNREVIEWED_SESSION_DAYS, tx);
    return { userId, ...session };
  });
}
