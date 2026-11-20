import { useLayoutEffect, useSyncExternalStore } from "react";

// The way back of the screen on display. A screen names it on its Page; the
// frame draws it in the phone's top bar, so that a phone shows a single back
// arrow, the one where the thumb looks for it.

export type Back = { href: string; label: string };

let current: Back | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(back: Back | null) {
  current = back;
  listeners.forEach((listener) => listener());
}

/** Tells the frame where the screen on display goes back to. */
export function useOfferBack(back: Back | undefined) {
  const href = back?.href;
  const label = back?.label;
  // Before the paint: the top bar never shows the previous screen's arrow.
  useLayoutEffect(() => {
    if (href === undefined || label === undefined) return;
    const mine = { href, label };
    set(mine);
    return () => {
      // The next screen may already have put its own in place.
      if (current === mine) set(null);
    };
  }, [href, label]);
}

/** The way back the screen on display offers, if any. */
export function useBack(): Back | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
