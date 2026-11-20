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

// When each project was last opened on this device, so that the list of
// projects starts with the site the person is on these days.

const projectsKey = (userId: string) => `ead:recents:projects:${userId}`;

/** For each project opened on this device, when it was last opened (ms). */
export function projectsOpenedAt(userId: string): Record<string, number> {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(projectsKey(userId)) ?? "{}");
    if (!kept || typeof kept !== "object" || Array.isArray(kept)) return {};
    return Object.fromEntries(
      Object.entries(kept).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
}

/** Remembers that a project was just shown. */
export function noteProjectOpened(userId: string, projectId: string) {
  try {
    const opened = { ...projectsOpenedAt(userId), [projectId]: Date.now() };
    window.localStorage.setItem(projectsKey(userId), JSON.stringify(opened));
  } catch {
    // Local storage can be closed to the page (private mode): the usual order then.
  }
}
