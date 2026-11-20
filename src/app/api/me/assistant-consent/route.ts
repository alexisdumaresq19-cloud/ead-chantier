import { z } from "zod";

import { aiAvailable } from "@/server/ai/gateway";
import { requireUser } from "@/server/auth";
import { body, route } from "@/server/http";
import { setAssistantConsent } from "@/server/legal/consent";
import type { AssistantStatus } from "@/shared/dictation";

const input = z.object({ agreed: z.boolean() });

/**
 * Records the person's agreement to the report's assistant ({ agreed: true },
 * dated now), or takes it back ({ agreed: false }). Answers as GET /api/assistant.
 */
export const PUT = route(async (request) => {
  const user = await requireUser(request);
  const { agreed } = await body(request, input);
  const at = await setAssistantConsent(user.id, agreed);
  return {
    dictation: await aiAvailable(),
    consentAt: at?.toISOString() ?? null,
  } satisfies AssistantStatus;
});
