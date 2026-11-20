import { useCallback, useMemo, useSyncExternalStore } from "react";

// What a person chose on this device: the list or the grid, the folders they
// closed. Kept in the browser's storage; if that is refused (private
// browsing), the choice simply lasts until the page is closed.

const listeners = new Set<() => void>();
const fallbacks = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return fallbacks.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    fallbacks.set(key, value);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab of the app changed it.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A value remembered on this device, shared by every screen that reads it. */
export function useStored(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback((next: string) => write(key, next), [key]);
  return [value, set];
}

export type PlanView = "list" | "grid";

/** Dense rows (the default: fastest to scan on a phone) or large thumbnails. */
export function usePlanView(): [PlanView, (view: PlanView) => void] {
  const [stored, set] = useStored("ead:plans:view", "list");
  return [stored === "grid" ? "grid" : "list", set];
}

/** Stands for the sheets outside any folder in the set of closed folders. */
export const LOOSE = "-";

/** The folders of a project this person closed in the plan list. */
export function useClosedFolders(projectId: string): [Set<string>, (id: string) => void] {
  const [stored, set] = useStored(`ead:plans:closed:${projectId}`, "");
  const closed = useMemo(() => new Set(stored.split(",").filter(Boolean)), [stored]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      set([...next].join(","));
    },
    [closed, set],
  );
  return [closed, toggle];
}
