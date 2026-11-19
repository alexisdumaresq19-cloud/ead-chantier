import { useSyncExternalStore } from "react";
import type { BaseLocationHook, BaseSearchHook } from "wouter";

// The address bar, for the client router (wouter).
//
// The page is served by Next.js, whose own router also writes to the browser
// history. The app listens only to its own navigations and to the back and
// forward buttons, and writes through the standard history API, which Next.js
// supports and keeps in step with.

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("popstate", notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("popstate", notify);
  };
}

/** Goes to another screen of the app. */
export function navigate(
  to: string,
  { replace = false, state = null }: { replace?: boolean; state?: unknown } = {},
) {
  window.history[replace ? "replaceState" : "pushState"](state, "", to);
  notify();
}

export const useAppLocation: BaseLocationHook = () => [
  useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/",
  ),
  navigate,
];

export const useAppSearch: BaseSearchHook = () =>
  useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
