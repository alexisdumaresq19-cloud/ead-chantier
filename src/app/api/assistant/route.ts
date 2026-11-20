import { aiAvailable } from "@/server/ai/gateway";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import type { AssistantStatus } from "@/shared/dictation";

/**
 * What the AI service can do here, and whether this person agreed to it:
 * the screens offer only what works, and ask the question first.
 */
export const GET = route(async (request) => {
  const user = await requireUser(request);
  return {
    dictation: await aiAvailable(),
    consentAt: user.assistantConsentAt?.toISOString() ?? null,
  } satisfies AssistantStatus;
});
