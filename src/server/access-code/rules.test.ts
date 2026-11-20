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
