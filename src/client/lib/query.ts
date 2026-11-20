import { QueryClient, type Query } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

import { ApiFailure } from "./api";

// What the app has fetched is kept on the device, so a screen seen once
// opens at once the next time and still opens without a network. Fresh data
// replaces it in the background whenever the network is there.

const MONTH = 30 * 24 * 3600 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      // Never dropped from memory: this is what gets stored for offline use.
      // (A month here would not work: it is more than a browser timer can
      // count, so the clean-up would run at once.)
      gcTime: Infinity,
      // Show what is stored first; never block a screen on the network.
      networkMode: "offlineFirst",
      retry: (count, error) =>
        error instanceof ApiFailure && (error.offline || error.status >= 500) && count < 2,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { networkMode: "always", retry: false },
  },
});

const KEY = "ead-query-cache";
let pending: ReturnType<typeof setTimeout> | undefined;
let latest: PersistedClient | undefined;

function saveNow() {
  clearTimeout(pending);
  pending = undefined;
  if (latest) set(KEY, latest).catch(() => {});
  latest = undefined;
}

// A phone put back in a pocket may never run the timer: what was just seen
// is saved as the app goes out of sight.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });

/**
 * Stores the cache in IndexedDB, at most once a second, and never later than
 * a second after a change: a burst of changes does not push the save back.
 */
export const persister: Persister = {
  persistClient(client: PersistedClient) {
    latest = client;
    pending ??= setTimeout(saveNow, 1000);
  },
  restoreClient: () => get<PersistedClient>(KEY),
  removeClient: () => del(KEY),
};

/**
 * Everything fetched is stored, except queries marked `meta: { persist: false }`
 * (searches, short-lived links).
 */
export const dehydrateOptions = {
  // Data whose last refresh failed (a weak signal) is stored all the same.
  shouldDehydrateQuery: (query: Query) =>
    query.state.data !== undefined && query.meta?.persist !== false,
};

/** Changing this discards what devices have stored (after a breaking change). */
export const CACHE_VERSION = "1";
export const CACHE_MAX_AGE = MONTH;

/** Forgets everything stored for the signed-in person (on sign-out). */
export async function clearStoredData() {
  clearTimeout(pending);
  pending = undefined;
  latest = undefined;
  queryClient.clear();
  await del(KEY).catch(() => {});
}
