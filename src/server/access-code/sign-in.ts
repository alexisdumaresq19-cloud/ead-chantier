import { and, eq, gt, isNotNull, isNull, sql as raw } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ACCESS_CODE_LENGTH, DEMO_SESSION_DAYS, phoneKey } from "@/shared/access";
import { canadianPhone, codeDigits, PHONE_HINT } from "@/shared/signup";

import {
  consumeInvite,
  currentUser,
  endSession,
  openSession,
  UNREVIEWED_SESSION_DAYS,
  type Executor,
  type Invite,
} from "../auth";
import { db, schema } from "../db/client";
import { badRequest, HttpError } from "../http";
import { addressOf } from "../signup/door";
import { isInviteCode, sameCode } from "./code";
import { demoAccount, readDemoAccess } from "./demo";
import {
  accessCounts,
  accessLimits,
  accessRefusal,
  holdAccessDoor,
  networkKey,
  noteWrongTry,
  numberKey,
  tooManyTries,
  type AccessLimits,
} from "./door";

// Signing in by typing one's cell number and the code the office gave: a
// personal invitation's (the same as its link, once) or the demonstration
// access's. For a device where a link cannot be opened: the iPhone app,
// where a link tapped in Messages opens Safari instead.

export const accessCodeInput = z.object({
  phone: z.string().max(100),
  code: z.string().max(100),
});
export type AccessCodeFields = z.infer<typeof accessCodeInput>;

/**
 * The one answer for a number nobody has, a code that is not that number's,
 * a code used or replaced since: a stranger learns nothing from it.
 */
export const wrongAccessCode = () =>
  new HttpError(
    400,
    "wrong_access_code",
    "Ce numéro ou ce code n'est pas le bon. Vérifiez les deux, ou demandez un nouveau code au bureau.",
  );

/**
 * How long a refusal of the code takes at least, from the request's start:
 * a number that belongs to someone and one that does not are answered in
 * the same time.
 */
const REFUSAL_MS = 250;

/** What was typed, cleaned, or the refusal of the field that is wrong. Its form is no secret. */
export function cleanAccessCode(input: AccessCodeFields): { phone: string; code: string } {
  const phone = canadianPhone(input.phone);
  if (!phone)
    throw badRequest(`Entrez votre numéro de cellulaire\u00a0: ${PHONE_HINT}`, "bad_phone");
  const code = codeDigits(input.code);
  if (code.length !== ACCESS_CODE_LENGTH)
    throw badRequest(
      `Le code a ${ACCESS_CODE_LENGTH} chiffres. Vérifiez-le dans le message du bureau.`,
      "bad_code",
    );
  return { phone: phoneKey(phone)!, code };
}

type Found =
  { kind: "personal"; userId: string; unreviewed: boolean; invite: Invite } | { kind: "demo" };

/**
 * The people who have this number, each with their live invitation if any:
 * one query, whether or not someone has it.
 */
async function holders(tx: Executor, digits: string, now: Date) {
  const typed = raw`regexp_replace(${schema.users.phone}, '\\D', '', 'g')`;
  return tx
    .select({ user: schema.users, invite: schema.invites })
    .from(schema.users)
    .leftJoin(
      schema.invites,
      and(
        eq(schema.invites.userId, schema.users.id),
        eq(schema.invites.kind, "personal"),
        isNull(schema.invites.revokedAt),
        isNotNull(schema.invites.codeHash),
        gt(schema.invites.expiresAt, now),
        raw`${schema.invites.uses} < coalesce(${schema.invites.maxUses}, 1)`,
      ),
    )
    .where(
      and(
        eq(schema.users.active, true),
        isNull(schema.users.deletedAt),
        // The demonstration account comes in by the access's own code.
        eq(schema.users.demo, false),
        raw`(${typed} = ${digits} or ${typed} = ${`1${digits}`})`,
      ),
    );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens this device's session, or refuses. The door is counted, the try
 * noted, the invitation used up and the session opened in one transaction,
 * one request at a time; the caller gives the cookie once it is committed.
 * `now`, `limits` and `refusalMs` are given by the tests.
 */
export async function signInWithCode(
  request: NextRequest,
  input: AccessCodeFields,
  {
    now = new Date(),
    limits = accessLimits(),
    refusalMs = REFUSAL_MS,
  }: { now?: Date; limits?: AccessLimits; refusalMs?: number } = {},
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const started = Date.now();
  const typed = cleanAccessCode(input);
  const keys = { network: networkKey(addressOf(request)), number: numberKey(typed.phone) };

  // A network that is shut is refused at once, without waiting for a turn.
  const shut = accessRefusal(
    await accessCounts({ network: keys.network, number: null }, null, limits, now),
    limits,
  );
  if (shut) throw tooManyTries(shut, now);
  const me = await currentUser(request);

  // A wrong try is noted, and the note kept: the transaction hands the
  // refusal back instead of throwing it, which would undo the note.
  type Outcome =
    | { made: { userId: string; token: string; expiresAt: Date } }
    | { wrong: true }
    | { refused: HttpError };
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    await holdAccessDoor(tx);
    const people = await holders(tx, typed.phone, now);
    const demo = await readDemoAccess(tx);
    const isDemoNumber = demo !== null && phoneKey(demo.phone) === typed.phone;
    // The number's count restarts with its newest code: the office's new
    // code is the way out for someone whose number was shut.
    const newest = [
      ...people.map((row) => row.invite?.createdAt),
      isDemoNumber ? demo.changedAt : undefined,
    ].reduce<Date | null>((last, at) => (at && (!last || at > last) ? at : last), null);
    // The door is asked before the code is looked at: once it is shut, the
    // right code gets the same refusal as any other.
    const refusal = accessRefusal(await accessCounts(keys, newest, limits, now, tx), limits);
    if (refusal) return { refused: tooManyTries(refusal, now) };

    let found: Found | null = null;
    for (const { user, invite } of people)
      if (invite?.codeHash && isInviteCode(invite.id, invite.codeHash, typed.code))
        found = { kind: "personal", userId: user.id, unreviewed: user.unreviewed, invite };
    // Compared whatever the number, so the time taken says nothing either.
    if (sameCode(typed.code, demo?.code ?? "") && isDemoNumber) found = { kind: "demo" };
    if (!found) {
      await noteWrongTry(keys, now, tx);
      return { wrong: true };
    }

    // Never swap the account of a device behind its owner's back: the
    // person signed in here signs out first. Said before the code is used
    // up, so it still works afterwards.
    if (me && (found.kind === "demo" ? !me.demo : me.id !== found.userId))
      return {
        refused: new HttpError(
          409,
          "signed_in_as_other",
          `Cet appareil est déjà connecté sous le nom de ${me.name}. Déconnectez-vous avant d'entrer avec ce code.`,
        ),
      };
    const userId = found.kind === "demo" ? await demoAccount(tx, demo!) : found.userId;
    // Used up in one statement: a link opened at the same moment, or the
    // same code typed twice, signs in one device only.
    if (found.kind === "personal" && !(await consumeInvite(found.invite, tx)))
      return { wrong: true };
    // The same person entering again: the session it replaces ends here.
    if (me) await endSession(me.sessionId, undefined, tx);
    const days =
      found.kind === "demo"
        ? DEMO_SESSION_DAYS
        : found.unreviewed
          ? UNREVIEWED_SESSION_DAYS
          : undefined;
    return { made: { userId, ...(await openSession(userId, request, days, tx)) } };
  });
  if ("made" in outcome) return outcome.made;
  if ("wrong" in outcome) {
    await wait(refusalMs - (Date.now() - started));
    throw wrongAccessCode();
  }
  throw outcome.refused;
}
