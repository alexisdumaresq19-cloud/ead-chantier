import { aiAvailable } from "@/server/ai/gateway";
import { requireUser } from "@/server/auth";
import { route } from "@/server/http";
import type { AssistantStatus } from "@/shared/dictation";

/** What the AI service can do here: the screens offer only what works. */
export const GET = route(async (request) => {
  await requireUser(request);
  return { dictation: await aiAvailable() } satisfies AssistantStatus;
});
