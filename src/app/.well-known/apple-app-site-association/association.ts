// What the iPhone app's universal links cover (docs/ios/README.md): Apple
// fetches this file from the site when the app is installed, and from then on
// a tap on a link to one of these addresses, in Messages, Mail or Safari,
// opens the app at that screen instead of the browser.

/** "TEAMID.bundle.identifier": Apple's ten-character Team ID, then the app's
 * bundle identifier (capacitor.config.ts, appId). */
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

type Component = { "/": string; exclude?: true; comment?: string };

/** Left to the browser. The first rule that matches an address decides. */
const BROWSER: Component[] = [
  { "/": "/api/*", comment: "The server's answers to the app" },
  { "/": "/files/*", comment: "Files, opened as files" },
  { "/": "/_next/*", comment: "The site's code" },
  { "/": "/.well-known/*" },
  // Public pages, for anyone, with or without the app: the App Store's
  // privacy and support links among them.
  { "/": "/confidentialite*", comment: "Privacy policy" },
  { "/": "/soutien*", comment: "Support" },
  // The site's own files.
  { "/": "/brand/*" },
  { "/": "/sw.js" },
  { "/": "/manifest.webmanifest" },
  { "/": "/icon.png" },
  { "/": "/apple-icon.png" },
  { "/": "/favicon.ico" },
].map((component) => ({ ...component, exclude: true as const }));

/** Every other address is a screen of the app: invitations, projects, plans… */
const APP: Component = { "/": "/*", comment: "Every screen of the app" };

/** The app identifier, or null when it is missing or malformed. */
export function appIdFrom(value: string | undefined): string | null {
  const appId = value?.trim();
  return appId && APP_ID.test(appId) ? appId : null;
}

/** The apple-app-site-association document for one app. */
export function association(appId: string) {
  return {
    applinks: {
      details: [{ appIDs: [appId], components: [...BROWSER, APP] }],
    },
  };
}
