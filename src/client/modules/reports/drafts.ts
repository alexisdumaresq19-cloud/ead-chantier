import type { ReportForm } from "./form";

// What is typed in a report is written on the device at every change, so a
// phone that sleeps, a lost network or a closed tab loses nothing. It is kept
// in localStorage because that write is finished before the next keystroke;
// a report is a few kilobytes at most. Drafts never leave the device: only
// "Enregistrer" sends a report.

export type Draft = {
  /** When it was last written. */
  savedAt: string;
  /** The saved report being changed; null for a report not saved yet. */
  reportId: string | null;
  /** The version of the saved report the changes started from. */
  baseUpdatedAt: string | null;
  form: ReportForm;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The number changes when the stored shape does: older drafts are then ignored. */
const PREFIX = "ead:rapport:1";

function deviceStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    // Storage is blocked (private browsing on some browsers).
    return null;
  }
}

const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((listener) => listener());
};

/** For screens that list drafts: called when one is written or removed, here or in another tab. */
export function subscribeToDrafts(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", changed);
    // Another tab may have written while nobody was listening.
    version++;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", changed);
  };
}
export const draftsVersion = () => version;

/**
 * Where a draft is kept: per person (a shared phone does not show someone
 * else's), per project, and per report — or per day for a report not saved yet.
 */
export const draftKey = (userId: string, projectId: string, reportIdOrDay: string) =>
  `${PREFIX}:${userId}:${projectId}:${reportIdOrDay}`;

const isDraft = (value: unknown): value is Draft => {
  const draft = value as Draft | null;
  return (
    typeof draft === "object" &&
    draft !== null &&
    typeof draft.savedAt === "string" &&
    typeof draft.form?.day === "string" &&
    Array.isArray(draft.form.crew)
  );
};

export function readDraft(key: string, store = deviceStore()): Draft | null {
  try {
    const draft: unknown = JSON.parse(store?.getItem(key) ?? "null");
    if (!isDraft(draft)) return null;
    // A draft written before reports had photos.
    return Array.isArray(draft.form.photoIds)
      ? draft
      : { ...draft, form: { ...draft.form, photoIds: [] } };
  } catch {
    return null;
  }
}

/** False when the device refused to keep it (storage full or blocked). */
export function writeDraft(key: string, draft: Draft, store = deviceStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(key, JSON.stringify(draft));
    changed();
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(key: string, store = deviceStore()) {
  try {
    if (!store || store.getItem(key) === null) return;
    store.removeItem(key);
    changed();
  } catch {
    // Nothing was kept, so there is nothing to remove.
  }
}

/** The drafts of a person in a project, latest day first. */
export function listDrafts(
  userId: string,
  projectId: string,
  store = deviceStore(),
): (Draft & { key: string })[] {
  const prefix = draftKey(userId, projectId, "");
  const drafts: (Draft & { key: string })[] = [];
  try {
    for (let index = 0; index < (store?.length ?? 0); index++) {
      const key = store?.key(index);
      if (!key?.startsWith(prefix)) continue;
      const draft = readDraft(key, store);
      if (draft) drafts.push({ ...draft, key });
    }
  } catch {
    return [];
  }
  return drafts.sort((a, b) => b.form.day.localeCompare(a.form.day));
}

/** Whether this device can keep drafts at all. */
export function canKeepDrafts(store = deviceStore()): boolean {
  try {
    if (!store) return false;
    const probe = `${PREFIX}:probe`;
    store.setItem(probe, "1");
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
