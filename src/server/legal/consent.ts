import { and, eq, sql as raw } from "drizzle-orm";

import { ASSISTANT_CONSENT_REQUIRED } from "@/shared/dictation";

import type { Executor } from "../auth";
import { db, schema } from "../db/client";
import { HttpError } from "../http";

// The person's agreement to the report's assistant (users.assistant_consent_at).
// Apple (guideline 5.1.2(i)) and Québec's Law 25 ask for it before anything
// personal goes to an outside AI service. The screens ask the question; the
// server holds to the answer, so that an old page or a script cannot skip it.
//
// The demonstration account is one account for every visitor the office
// hands its code to: one visitor's "yes" is not the next one's. Its
// agreement is kept per device instead, by its session (an app_settings row
// "demo_consent:<session id>"), and ends with that session.

/**
 * When what the assistant sends, or to whom, last changed (the policy's part
 * "L'assistant du rapport"). An agreement given before then was given to
 * something else, so the question is asked again: move this date forward
 * with any such change, and POLICY_VERSION with it.
 */
export const ASSISTANT_TERMS_SINCE = new Date("2026-11-20T00:00:00-05:00");

/** The agreement on record, if it covers what the assistant does now. */
export function consentInForce(at: Date | null): Date | null {
  return at && at >= ASSISTANT_TERMS_SINCE ? at : null;
}

const settings = schema.appSettings;
const DEMO_CONSENT = "demo_consent:";
const demoConsentKey = (sessionId: string) => `${DEMO_CONSENT}${sessionId}`;

/** The agreement given on this session of the demonstration account, or null. */
export async function demoSessionConsent(
  sessionId: string,
  executor: Executor = db,
): Promise<Date | null> {
  const [row] = await executor
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, demoConsentKey(sessionId)))
    .limit(1);
  return row?.value ? new Date(row.value) : null;
}

/**
 * Records the agreement (now), or takes it back. Returns when it now dates
 * from. For the demonstration account, on this session only.
 */
export async function setAssistantConsent(
  user: { id: string; demo: boolean; sessionId: string },
  agreed: boolean,
  now = new Date(),
): Promise<Date | null> {
  const at = agreed ? now : null;
  if (!user.demo) {
    await db
      .update(schema.users)
      .set({ assistantConsentAt: at })
      .where(eq(schema.users.id, user.id));
    return at;
  }
  await db.transaction(async (tx) => {
    // The agreements of sessions that have ended go first: nothing reads them.
    await tx
      .delete(settings)
      .where(
        and(
          raw`starts_with(${settings.key}, ${DEMO_CONSENT})`,
          raw`substr(${settings.key}, ${DEMO_CONSENT.length + 1}) not in (select id from sessions)`,
        ),
      );
    const key = demoConsentKey(user.sessionId);
    if (!at) await tx.delete(settings).where(eq(settings.key, key));
    else
      await tx
        .insert(settings)
        .values({ key, value: at.toISOString(), updatedBy: user.id, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: at.toISOString(), updatedAt: now },
        });
  });
  return at;
}

/** Refuses a request to the assistant from someone who has not agreed (403). */
export function assertAssistantConsent(user: { assistantConsentAt: Date | null }) {
  if (consentInForce(user.assistantConsentAt)) return;
  throw new HttpError(
    403,
    ASSISTANT_CONSENT_REQUIRED,
    "Acceptez d'abord que l'assistant envoie votre voix, le texte et les photos du rapport, et les noms des gens du chantier, à des services d'intelligence artificielle. Vous pouvez aussi remplir le rapport à la main.",
  );
}
