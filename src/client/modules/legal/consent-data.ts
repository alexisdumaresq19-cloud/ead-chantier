import { useMutation } from "@tanstack/react-query";

import type { Me } from "@/shared/api";
import type { AssistantStatus } from "@/shared/dictation";

import { api } from "../../lib/api";
import { useAssistant } from "../../lib/assistant";
import { queryClient } from "../../lib/query";
import { keys, useCurrentUser } from "../../lib/session";

// The person's agreement to the report's assistant, as the screens know it:
// GET /api/assistant says when it dates from, and the person (/api/me) says
// whether there is one. Both are kept in step when it changes.

/**
 * Whether the person agreed, and since when. An answer stored on the device
 * before the date was sent falls back on what /api/me says.
 */
export function useAssistantConsent(): { agreed: boolean; at: string | null } {
  const me = useCurrentUser();
  const status = useAssistant().data;
  if (status?.consentAt !== undefined)
    return { agreed: status.consentAt !== null, at: status.consentAt };
  return { agreed: me.assistantConsent === true, at: null };
}

/** Puts the server's answer where the screens read it. */
export function noteConsent(status: Pick<AssistantStatus, "consentAt"> & Partial<AssistantStatus>) {
  const consentAt = status.consentAt ?? null;
  queryClient.setQueryData<AssistantStatus>(["assistant"], (old) => ({
    dictation: status.dictation ?? old?.dictation ?? false,
    consentAt,
  }));
  queryClient.setQueryData<Me | null>(keys.me, (old) =>
    old ? { ...old, assistantConsent: consentAt !== null } : old,
  );
}

/** Records the agreement (true) or takes it back (false). */
export function useSetAssistantConsent() {
  return useMutation({
    mutationFn: (agreed: boolean) =>
      api<AssistantStatus>("/api/me/assistant-consent", { method: "PUT", body: { agreed } }),
    onSuccess: noteConsent,
  });
}
