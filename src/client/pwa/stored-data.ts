import type { QueryClient } from "@tanstack/react-query";

/** The longest delay a browser's timer can count, 24.8 days. Past it, the timer fires at once. */
export const LONGEST_TIMER = 2 ** 31 - 1;

/**
 * Keeps the data nobody is looking at for a time the browser can count.
 *
 * The app asks to keep it a month (lib/query.ts). A timer cannot count that
 * far and fires at once: what is restored at launch is then dropped before
 * any screen reads it, the stored copy is emptied, and nothing opens without
 * a network. Call this before the stored data is restored.
 */
export function keepUnusedData(client: QueryClient) {
  const defaults = client.getDefaultOptions();
  const asked = defaults.queries?.gcTime;
  if (typeof asked !== "number" || asked === Infinity || asked <= LONGEST_TIMER) return;
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, gcTime: LONGEST_TIMER },
  });
}
