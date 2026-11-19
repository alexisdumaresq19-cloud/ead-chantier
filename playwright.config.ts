import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// End-to-end tests, run by scripts/e2e.sh against a production build with its
// own database, seeded with the fictional data of scripts/seed-dev.mts.

// Some machines provide one Chromium for every Playwright version.
const sharedChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.E2E_CHROMIUM ?? (existsSync(sharedChromium) ? sharedChromium : undefined);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One database for all tests: they run one after the other.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE ?? "http://localhost:3300",
    locale: "fr-CA",
    timezoneId: "America/Toronto",
    trace: "off",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
