import { useSyncExternalStore } from "react";

// Chrome and Edge (Android and computers) say once, early, that the app can
// be installed, and hand over the means to ask. It is caught here from the
// start and kept for the card on the account screen, opened much later.

/** The browser's offer to install (not in TypeScript's own definitions). */
type InstallOffer = Event & {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type State = { offer: InstallOffer | null; installed: boolean };

let state: State = { offer: null, installed: false };
const listeners = new Set<() => void>();
function change(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function watchInstallOffer() {
  window.addEventListener("beforeinstallprompt", (event) => {
    // The app offers it in its own place; no banner from the browser.
    event.preventDefault();
    change({ ...state, offer: event as InstallOffer });
  });
  window.addEventListener("appinstalled", () => change({ offer: null, installed: true }));
}

export function useInstallOffer(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

/** Shows the browser's install window. True if the person accepted. */
export async function acceptInstallOffer(): Promise<boolean> {
  const { offer } = state;
  if (!offer) return false;
  await offer.prompt();
  const { outcome } = await offer.userChoice;
  // An offer serves once; the browser sends another if it was declined.
  change({ ...state, offer: null });
  return outcome === "accepted";
}
