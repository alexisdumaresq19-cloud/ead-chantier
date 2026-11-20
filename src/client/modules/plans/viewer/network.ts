import type { UseQueryResult } from "@tanstack/react-query";

import { ApiFailure } from "../../../lib/api";

/**
 * Why a query has nothing to show, if it has given up or cannot try. Without
 * a network a request is held back until the network returns rather than
 * failed: for the person waiting it is the same, and is said the same way.
 */
export function failureOf(query: UseQueryResult<unknown>): unknown {
  if (query.isError) return query.error;
  return query.isPaused ? new ApiFailure(0, "offline", "Pas de réseau.") : null;
}
