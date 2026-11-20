import { confirmAction } from "../../ui";

/** Sooner than this, a yes is the second tap of a double tap. */
const TOO_SOON_MS = 500;

/**
 * Asks like confirmAction, but does not take a yes that comes at once: on a
 * phone the window's confirm button comes up under the finger that asked, and
 * a double tap (gloves, cold hands) would publish or archive without the
 * question being read. It is then simply asked again.
 */
export async function confirmDeliberately(
  question: Parameters<typeof confirmAction>[0],
): Promise<boolean> {
  for (;;) {
    const asked = Date.now();
    if (!(await confirmAction(question))) return false;
    if (Date.now() - asked >= TOO_SOON_MS) return true;
  }
}
