import { expect, test } from "@playwright/test";

// The file Apple's servers read so that links open the iPhone app
// (src/app/.well-known/apple-app-site-association). Apple takes it only as a
// direct 200 answer in JSON: the single-page fallback of next.config.ts must
// never answer for it with the app's page. Run with IOS_APP_ID set, the
// server names the app; without it, the address does not exist.

const PATH = "/.well-known/apple-app-site-association";
const appId = process.env.IOS_APP_ID;

test("the association file answers itself, never with the app's page", async ({ request }) => {
  const response = await request.get(PATH, { maxRedirects: 0 });
  const type = response.headers()["content-type"] ?? "";
  expect(type).not.toContain("text/html");
  if (!appId) {
    expect(response.status()).toBe(404);
    return;
  }
  expect(response.status()).toBe(200);
  expect(type).toBe("application/json");
  const body = await response.json();
  expect(body.applinks.details[0].appIDs).toEqual([appId]);
});

test("a screen of the app is still the app's page", async ({ request }) => {
  const response = await request.get("/projets/x/plans", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
});
