// The app inside its iPhone shell (the App Store version, built with
// Capacitor in ios/): the same pages, loaded from the same server, in a web
// view that the shell gives a few native means (the share sheet, a document
// viewer, links that open the app). Everything the pages do differently
// there goes through this folder.

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/** True inside the iPhone app; false in a browser or the installed web app. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}
