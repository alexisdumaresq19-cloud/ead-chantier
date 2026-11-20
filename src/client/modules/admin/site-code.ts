import { useMemo, useSyncExternalStore } from "react";

import type { InviteLink } from "@/shared/api";

// The site QR codes this device made, kept until they run out.
//
// The server gives a code's link once, when the code is made, and each new
// code ends the one before. So a code is kept here, on the device, for as
// long as it works: reopening the window, coming back to the app or
// restarting it shows the same code, and a poster printed in the morning
// still works at noon. It lives in localStorage, apart from the fetched data:
// it cannot be fetched again, and it must be there the moment the screen opens.

const PREFIX = "ead-site-code:";
const keyOf = (userId: string, projectId: string) => `${PREFIX}${userId}:${projectId}`;

/** What was stored, if it is a link. */
export function parseSiteCode(raw: string | null): InviteLink | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { url, expiresAt } = value as Record<string, unknown>;
    if (typeof url !== "string" || typeof expiresAt !== "string") return null;
    return Number.isFinite(new Date(expiresAt).getTime()) ? { url, expiresAt } : null;
  } catch {
    return null;
  }
}

/** Whether a code has reached its end. */
export const hasRunOut = (link: InviteLink, now: Date) =>
  new Date(link.expiresAt).getTime() <= now.getTime();

// A browser that refuses storage (private browsing, no room left) still
// keeps the code for as long as the app stays open.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/** Keeps the code just made for a project, in place of the previous one. */
export function storeSiteCode(userId: string, projectId: string, link: InviteLink) {
  const key = keyOf(userId, projectId);
  const raw = JSON.stringify(link);
  memory.set(key, raw);
  try {
    // Codes that have run out are of no use to anyone: they go as others come.
    const now = new Date();
    for (const other of Object.keys(window.localStorage)) {
      if (!other.startsWith(PREFIX)) continue;
      const kept = parseSiteCode(window.localStorage.getItem(other));
      if (!kept || hasRunOut(kept, now)) window.localStorage.removeItem(other);
    }
    window.localStorage.setItem(key, raw);
  } catch {
    // Kept in memory above.
  }
  notify();
}

/** Lets go of every code on this device (signing out). */
export function forgetSiteCodes() {
  memory.clear();
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Nothing was stored.
  }
  notify();
}

function subscribe(listener: () => void) {
  // Another tab of the same person made or replaced a code.
  if (listeners.size === 0) window.addEventListener("storage", notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", notify);
  };
}

/** The code this person last made for the project on this device, run out or not. */
export function useStoredSiteCode(userId: string, projectId: string): InviteLink | null {
  const key = keyOf(userId, projectId);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  return useMemo(() => parseSiteCode(raw), [raw]);
}
