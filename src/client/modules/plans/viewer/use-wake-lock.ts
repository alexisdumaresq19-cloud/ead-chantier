import { useEffect } from "react";

/**
 * Keeps the screen on while a plan is shown: at the site the phone lies on
 * the hood or is held in a glove, and nobody is touching it. The browser
 * drops the lock whenever the app goes to the background, so it is asked for
 * again each time the app comes back. Where the browser cannot do it, or
 * refuses (low battery), the screen simply dims as usual.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let asking = false;
    let left = false;

    const acquire = async () => {
      if (asking || lock || document.visibilityState !== "visible") return;
      asking = true;
      try {
        const granted = await navigator.wakeLock.request("screen");
        if (left) {
          void granted.release();
          return;
        }
        lock = granted;
        granted.addEventListener("release", () => {
          if (lock === granted) lock = null;
        });
      } catch {
        // Refused by the device: nothing to do about it.
      } finally {
        asking = false;
      }
    };
    const onVisibility = () => void acquire();

    document.addEventListener("visibilitychange", onVisibility);
    void acquire();
    return () => {
      left = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release();
      lock = null;
    };
  }, [active]);
}
