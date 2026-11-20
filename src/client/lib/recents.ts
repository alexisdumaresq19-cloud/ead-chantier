// The plan sheets a person opened last in a project, kept on the device: the
// project's home offers them again, since a crew works off the same few
// sheets for days.

const MAX = 6;
const key = (userId: string, projectId: string) => `ead:recents:${userId}:${projectId}`;

/** The ids of the sheets opened last, most recent first. */
export function recentSheetIds(userId: string, projectId: string): string[] {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(key(userId, projectId)) ?? "[]");
    return Array.isArray(kept) ? kept.filter((id) => typeof id === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Remembers that a sheet was just opened. */
export function noteSheetOpened(userId: string, projectId: string, sheetId: string) {
  try {
    const ids = [sheetId, ...recentSheetIds(userId, projectId).filter((id) => id !== sheetId)];
    window.localStorage.setItem(key(userId, projectId), JSON.stringify(ids.slice(0, MAX)));
  } catch {
    // Local storage can be closed to the page (private mode): no shortcuts then.
  }
}
