// What the browser lets the app store, and for how long.

/**
 * Asks the browser not to clear the app's storage when the device runs
 * short. Some browsers ask the person; so this is called when they have
 * just shown they count on it (the app installed, a project kept).
 */
export async function keepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/** Bytes the app may still store, or null when the browser does not say. */
export async function freeSpace(): Promise<number | null> {
  try {
    const { quota, usage = 0 } = await navigator.storage.estimate();
    return quota === undefined ? null : Math.max(0, quota - usage);
  } catch {
    return null;
  }
}
