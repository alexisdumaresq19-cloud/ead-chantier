import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ApiFailure } from "../../lib/api";
import { ErrorState, QueryState } from "../../ui";

/** The device holds nothing yet and has no network: the request waits for it. */
export const waitsForNetwork = (query: Pick<UseQueryResult<unknown>, "data" | "fetchStatus">) =>
  query.data === undefined && query.fetchStatus === "paused";

/**
 * QueryState, on a site without signal. A request that waits for the network
 * is neither loading nor failed, and QueryState alone would show its skeleton
 * until the network is back: here the screen says there is none. The request
 * resumes by itself.
 */
export function Fetched<T>({
  query,
  loading,
  children,
}: {
  query: UseQueryResult<T>;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (waitsForNetwork(query)) return <ErrorState error={new ApiFailure(0, "offline", "")} />;
  return (
    <QueryState query={query} loading={loading}>
      {children}
    </QueryState>
  );
}
