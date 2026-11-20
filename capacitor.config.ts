import type { CapacitorConfig } from "@capacitor/cli";

// The iPhone app (ios/): a native shell around the app's own pages, loaded
// from the server like in a browser. See docs/ios.

const config: CapacitorConfig = {
  /** The app's identifier at Apple. It cannot change once a build is uploaded. */
  appId: "ca.allendumaresq.ead",
  appName: "EAD",
  /** The few pages the shell carries itself, for when the server cannot be reached. */
  webDir: "ios-shell/dist",
  server: {
    url: "https://ead-chantier.vercel.app",
  },
  ios: {
    backgroundColor: "#0b0d10",
  },
};

export default config;
