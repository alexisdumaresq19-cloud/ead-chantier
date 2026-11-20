import { useQuery } from "@tanstack/react-query";

import type { AssistantStatus } from "@/shared/dictation";

import { api } from "./api";

/** Whether reports can be dictated here; unknown (no data) until the server said. */
export function useAssistant() {
  return useQuery({
    queryKey: ["assistant"],
    queryFn: () => api<AssistantStatus>("/api/assistant"),
    staleTime: 10 * 60 * 1000,
  });
}
