import type { CapacitorConfig } from "@capacitor/cli";

// The iPhone app (ios/): a native shell around the site itself, loaded from
// the server like in a browser, so each deployment reaches the app at once.
// How it is put together and why: docs/ios/README.md. How it is built, tried
// and uploaded on a Mac: docs/ios/MAC.md.
//
// `npx cap sync ios` (scripts/ios-sync.sh) writes this into
// ios/App/App/capacitor.config.json, which is what the app reads: a change
// here reaches the app with its next build, never by itself.

/** The site the app shows. Its host is also in ios/App/App/Info.plist
 * (WKAppBoundDomains) and ios/App/App/App.entitlements (applinks:). */
const site = "https://ead-chantier.vercel.app";

/** The app's version, as the App Store shows it. Must equal MARKETING_VERSION
 * in ios/App/App.xcodeproj/project.pbxproj (scripts/ios-sync.sh checks). */
const version = "1.0.0";

/**
 * THE APP-BOUND DOMAINS SWITCH (true or false; nothing else changes with it).
 *
 * On, the web view only loads pages from the domains listed under
 * WKAppBoundDomains in ios/App/App/Info.plist: the site, and "localhost" for
 * the shell's own pages (capacitor://localhost). In exchange WebKit gives the
 * site its service worker, which is what opens kept plans without a network:
 * in an app that is not a browser, WebKit runs service workers only in a web
 * view created with this option (WebPage::updatePreferences), so off means no
 * service worker at all. Links to other sites still open, in Safari: WebKit
 * asks Capacitor's policy delegate first, which hands them to the system
 * (WebViewDelegationHandler.decidePolicyFor), and pictures or requests to
 * other hosts are not navigations, so they still load.
 *
 * Only a run on an iPhone or in the Simulator proves it: docs/ios/MAC.md
 * ("Premier essai dans le simulateur") says what to read on /diagnostic and
 * when to turn this off (only if the bridge is missing with it on).
 * docs/ios/README.md has the reasoning, with WebKit's source.
 */
const appBoundDomains = true;

const config: CapacitorConfig = {
  /** The app's identifier at Apple. It cannot change once a build is
   * uploaded; before that, scripts/ios-set-id.sh changes it everywhere. */
  appId: "ca.allendumaresq.ead",
  appName: "EAD",
  /** The few pages the shell carries itself (ios-shell/, copied here by
   * ios-shell/build.mjs). The site itself is never bundled. */
  webDir: "ios-shell/dist",
  server: {
    url: site,
    // Shown by the shell when a page of the site cannot be loaded at all (no
    // network and no service worker to answer, server unreachable). An error
    // page the server sends is a page like any other and shows as is.
    errorPath: "offline.html",
  },
  // Lets the site tell the app from Safari, and which version of the shell
  // it runs in. Capacitor adds it after WebKit's own "Mobile/…" part.
  appendUserAgent: `EADApp/${version}`,
  // The app's black, behind the page while it loads: no white flash.
  backgroundColor: "#0b0d10",
  ios: {
    limitsNavigationsToAppBoundDomains: appBoundDomains,
    // The page runs under the status bar and the home indicator and keeps
    // clear of them itself (viewport-fit=cover, env(safe-area-inset-*)).
    contentInset: "never",
    // A long press on a link must not open a preview of the page.
    allowsLinkPreview: false,
    // Pages are drawn for phones: never ask for a desktop layout.
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: {
      // The pages call SplashScreen.hide() as soon as they are drawn. If one
      // never does (an older deployment, a page that failed), the logo goes
      // away by itself: the screen does not take touches while it shows.
      launchAutoHide: true,
      launchShowDuration: 3000,
      launchFadeOutDuration: 200,
      backgroundColor: "#0b0d10",
      showSpinner: false,
    },
  },
};

export default config;
