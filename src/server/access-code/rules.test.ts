import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEMO_OWN_ONLY, DEMO_PLANS, refuseDemoOnPlans, refuseDemoUnlessAuthor } from "./rules";

const visitor = { id: "demo", demo: true };
const foreman = { id: "julie", demo: false };

describe("what the demonstration account may change", () => {
  it("changes what it added, never what someone of the team did", () => {
    expect(() => refuseDemoUnlessAuthor(visitor, "demo")).not.toThrow();
    expect(() => refuseDemoUnlessAuthor(visitor, "julie")).toThrow(DEMO_OWN_ONLY);
    expect(() => refuseDemoUnlessAuthor(visitor, null)).toThrow(DEMO_OWN_ONLY);
    expect(() => refuseDemoUnlessAuthor(foreman, "marc")).not.toThrow();
  });

  it("never changes the plans", () => {
    expect(() => refuseDemoOnPlans(visitor)).toThrow(DEMO_PLANS);
    expect(() => refuseDemoOnPlans(foreman)).not.toThrow();
  });
});

describe("the routes about plans", () => {
  const api = new URL("../../app/api/", import.meta.url);
  const routes = (readdirSync(api, { recursive: true }) as string[])
    .filter((path) => path.endsWith("route.ts"))
    .map((path) => ({ path, text: readFileSync(new URL(path, api), "utf8") }));

  it("refuse the demonstration account wherever they change something", () => {
    const changing = routes.filter(
      ({ path, text }) =>
        /plan|sheet/.test(path) && /export const (POST|PUT|PATCH|DELETE)\b/.test(text),
    );
    expect(changing.length).toBeGreaterThan(5);
    for (const { path, text } of changing)
      expect(text.includes("refuseDemoOnPlans("), path).toBe(true);
    // A plan's file is announced to the uploads route first.
    const uploads = routes.find(({ path }) => path === "uploads/route.ts")!;
    expect(uploads.text).toMatch(/kind === "plan"\) refuseDemoOnPlans\(user\)/);
  });
});
