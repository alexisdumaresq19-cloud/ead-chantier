import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { appIdFrom, association } from "./association";
import { GET } from "./route";

const APP_ID = "ABCDE12345.ca.allendumaresq.ead";

/** Apple's rule: the first component whose pattern matches decides. */
function opensTheApp(path: string): boolean {
  const { components } = association(APP_ID).applinks.details[0];
  for (const component of components) {
    const pattern = new RegExp(
      "^" +
        component["/"]
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
    );
    if (pattern.test(path)) return !("exclude" in component && component.exclude);
  }
  return false;
}

describe("apple-app-site-association", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers 404 while the app's identifier is not set", async () => {
    vi.stubEnv("IOS_APP_ID", "");
    expect(GET().status).toBe(404);
  });

  it("answers 404 for an identifier that is not TEAMID.bundle.identifier", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("IOS_APP_ID", "ca.allendumaresq.ead");
    expect(GET().status).toBe(404);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(appIdFrom("abcde12345.ca.allendumaresq.ead")).toBeNull();
    expect(appIdFrom(` ${APP_ID} `)).toBe(APP_ID);
  });

  it("names the app, as JSON", async () => {
    vi.stubEnv("IOS_APP_ID", APP_ID);
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = await response.json();
    expect(body.applinks.details).toHaveLength(1);
    expect(body.applinks.details[0].appIDs).toEqual([APP_ID]);
  });

  it("opens the app's screens in the app", () => {
    for (const path of [
      "/",
      "/projets/p1",
      "/projets/p1/plans",
      "/projets/p1/feuilles/s1",
      "/projets/p1/rapports/r1",
      "/i/a-secret-token",
      "/j/a-secret-token",
      "/bienvenue",
      "/bienvenue/code",
      "/equipe",
      "/moi",
      "/diagnostic",
    ]) {
      expect(opensTheApp(path), path).toBe(true);
    }
  });

  it("leaves the server's answers, files and public pages to the browser", () => {
    for (const path of [
      "/api/me",
      "/api/reports/r1/pdf",
      "/files/a/b.pdf",
      "/_next/static/chunks/main.js",
      "/.well-known/apple-app-site-association",
      "/confidentialite",
      "/soutien",
      "/sw.js",
      "/brand/ead-logo.png",
      "/manifest.webmanifest",
    ]) {
      expect(opensTheApp(path), path).toBe(false);
    }
  });

  // The file only works if the app claims the same site, for the same app.
  it("agrees with the iPhone project", () => {
    const read = (path: string) =>
      readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
    const config = read("capacitor.config.ts");
    const host = new URL(/^const site = "([^"]+)";$/m.exec(config)![1]).host;
    const appId = /appId: "([^"]+)"/.exec(config)![1];
    expect(read("ios/App/App/App.entitlements")).toContain(`<string>applinks:${host}</string>`);
    expect(read("ios/App/App/Info.plist")).toContain(`<string>${host}</string>`);
    const project = read("ios/App/App.xcodeproj/project.pbxproj");
    const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set([appId]));
    // The version the web view announces is the one the App Store shows.
    const version = /^const version = "([^"]+)";$/m.exec(config)![1];
    const versions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    expect(new Set(versions)).toEqual(new Set([version]));
  });
});
