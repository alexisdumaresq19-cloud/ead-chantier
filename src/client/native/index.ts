// The app inside its iPhone shell (the App Store version, built with
// Capacitor in ios/): the same pages, loaded from the same server, in a web
// view that the shell gives a few native means (the share sheet, a document
// viewer, links that open the app). Everything the pages do differently
// there goes through this folder.
//
// This file stays small and free of plugin code: every screen imports it to
// ask where it runs. The plugins themselves are loaded on first use, inside
// the app only (plugins.ts), so a browser never downloads them.

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

const capacitor = () =>
  typeof window === "undefined" ? undefined : (window as { Capacitor?: CapacitorGlobal }).Capacitor;

/** True inside the iPhone app; false in a browser or the installed web app. */
export function isNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** "ios" inside the iPhone app, "web" everywhere else. */
export function nativePlatform(): string {
  return isNativeApp() ? (capacitor()?.getPlatform?.() ?? "web") : "web";
}

/**
 * In the app: hands a link to the share sheet (Messages, Mail, AirDrop,
 * Imprimer…). False when it failed; closing the sheet is not a failure.
 */
export async function shareLinkInApp(data: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<boolean> {
  try {
    await (await import("./files")).shareLinkNatively(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Directions to a site. In the app the link leaves for Apple Maps, which
 * every iPhone has; in a browser Google Maps serves every device.
 */
export const directionsUrl = (address: string, inApp = isNativeApp()) =>
  inApp
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
