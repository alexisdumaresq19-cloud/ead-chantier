import { eq } from "drizzle-orm";

import { ASSISTANT_CONSENT_REQUIRED } from "@/shared/dictation";

import { db, schema } from "../db/client";
import { HttpError } from "../http";

// The person's agreement to the report's assistant (users.assistant_consent_at).
// Apple (guideline 5.1.2(i)) and Québec's Law 25 ask for it before anything
// personal goes to an outside AI service. The screens ask the question; the
// server holds to the answer, so that an old page or a script cannot skip it.

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
  if (user.assistantConsentAt) return;
  throw new HttpError(
    403,
    ASSISTANT_CONSENT_REQUIRED,
    "Acceptez d'abord que l'assistant envoie votre voix, le texte et les photos du rapport à un service d'intelligence artificielle. Vous pouvez aussi remplir le rapport à la main.",
  );
}
