import { describe, expect, it } from "vitest";

import { refuseDemoOnPlans, refuseDemoUnlessAuthor } from "@/server/access-code/rules";

import { mayChangeAddedBy, mayEditPlans } from "./demo";

const visitor = { id: "demo", demo: true };
const foreman = { id: "julie", demo: false };
// What a device stored before the field existed: not the demonstration.
const older = { id: "marc" };

const serverAllows = (run: () => void) => {
  try {
    run();
    return true;
  } catch {
    return false;
  }
};

describe("what the screens offer the demonstration account", () => {
  it("changes what it added, never what someone of the team did", () => {
    expect(mayChangeAddedBy(visitor, "demo")).toBe(true);
    expect(mayChangeAddedBy(visitor, "julie")).toBe(false);
    // An author since deleted, or never known.
    expect(mayChangeAddedBy(visitor, null)).toBe(false);
  });

  it("never changes the plans", () => {
    expect(mayEditPlans(visitor)).toBe(false);
  });

  it("changes nothing for anyone else", () => {
    for (const me of [foreman, older]) {
      for (const author of ["demo", "julie", "marc", null])
        expect(mayChangeAddedBy(me, author)).toBe(true);
      expect(mayEditPlans(me)).toBe(true);
    }
  });

  it("answers as the server does, in every case", () => {
    for (const me of [visitor, foreman, { ...older, demo: false }])
      for (const author of ["demo", "julie", "marc", null]) {
        expect(mayChangeAddedBy(me, author)).toBe(
          serverAllows(() => refuseDemoUnlessAuthor(me, author)),
        );
        expect(mayEditPlans(me)).toBe(serverAllows(() => refuseDemoOnPlans(me)));
      }
  });
});
