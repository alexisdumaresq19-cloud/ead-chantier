import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ApiFailure } from "../../lib/api";
import { ErrorState, QueryState } from "../../ui";

const NO_NETWORK = new ApiFailure(0, "offline", "Pas de réseau.");

/**
 * QueryState, which also says so when there is no network and the device
 * holds nothing yet. A query started without a network does not fail: it
 * waits for the signal, and its loading state would stay up for as long as
 * the signal is gone. It starts again by itself when the network returns.
 */
export function Fetched<T>({
  query,
  loading,
  errorClassName,
  children,
}: {
  query: UseQueryResult<T>;
  loading?: ReactNode;
  /** For the "no network" message where it sits inside a card. */
  errorClassName?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.data === undefined && query.fetchStatus === "paused")
    return <ErrorState error={NO_NETWORK} className={errorClassName} />;
  return (
    <QueryState query={query} loading={loading}>
      {children}
    </QueryState>
  );
}
