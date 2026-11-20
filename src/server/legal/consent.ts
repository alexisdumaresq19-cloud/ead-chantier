import { eq } from "drizzle-orm";

import { ASSISTANT_CONSENT_REQUIRED } from "@/shared/dictation";

import { db, schema } from "../db/client";
import { HttpError } from "../http";

// The person's agreement to the report's assistant (users.assistant_consent_at).
// Apple (guideline 5.1.2(i)) and Québec's Law 25 ask for it before anything
// personal goes to an outside AI service. The screens ask the question; the
// server holds to the answer, so that an old page or a script cannot skip it.

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

/** Records the agreement (now), or takes it back. Returns when it now dates from. */
export async function setAssistantConsent(
  userId: string,
  agreed: boolean,
  now = new Date(),
): Promise<Date | null> {
  const at = agreed ? now : null;
  await db.update(schema.users).set({ assistantConsentAt: at }).where(eq(schema.users.id, userId));
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
