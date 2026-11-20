import { confirmAction } from "../../ui";

// A window or a confirmation opens right under the finger that asked for it.
// With gloves, cold hands or the habit of the double click, a tap often counts
// twice, and the second one lands on whatever just appeared: the red button of
// a confirmation, "Terminé" under a link shown only once, or the dimmed
// background that closes the window at once.

const QUIET_MS = 400;
const BEFORE_ANYTHING_ELSE = { capture: true };

/** Ignores taps for a short moment: call it just before something opens under the finger. */
export function ignoreSecondTap() {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, BEFORE_ANYTHING_ELSE);
  window.setTimeout(
    () => window.removeEventListener("click", swallow, BEFORE_ANYTHING_ELSE),
    QUIET_MS,
  );
}

/** confirmAction, which the second tap of a double tap cannot answer. */
export function confirmCalmly(question: Parameters<typeof confirmAction>[0]): Promise<boolean> {
  ignoreSecondTap();
  return confirmAction(question);
}
