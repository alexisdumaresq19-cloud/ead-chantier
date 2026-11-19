// Leaving the viewer. When the person came from another screen of the app
// (the plan list, a search), going back in history returns them exactly
// where they were, scrolled as they left it. When the viewer is the first
// screen (a link received, a page reloaded), history leads out of the app:
// the plan list is opened in its place instead.

/** The part of the Navigation API used here; not in every browser yet. */
type NavigationHistory = {
  currentEntry: { index: number } | null;
  entries(): { sameDocument: boolean; url: string | null }[];
};

const isSheet = (url: string) => /\/feuilles\/[^/]+$/.test(new URL(url).pathname);

/**
 * Whether the app was already running when this screen opened. To be asked
 * once, on arrival: turning to other sheets replaces the address.
 */
export function arrivedFromAnotherScreen(): boolean {
  const [load] = performance.getEntriesByType("navigation");
  return load !== undefined && load.name !== window.location.href;
}

/**
 * Whether one step back in history is another screen of the app, still in
 * memory. Another sheet does not count: it would not be a way out.
 */
export function canStepBack(arrivedInApp: boolean): boolean {
  const navigation = (window as { navigation?: NavigationHistory }).navigation;
  if (!navigation?.currentEntry) return arrivedInApp;
  const previous = navigation.entries()[navigation.currentEntry.index - 1];
  return Boolean(previous?.sameDocument && previous.url && !isSheet(previous.url));
}
