import { describe, expect, it } from "vitest";

import { excerptAround } from "./excerpt";

describe("the excerpt of a page's text", () => {
  it("shows the words found with a little of what surrounds them", () => {
    const text =
      "NOTES GÉNÉRALES\n1. Les regards sont préfabriqués en béton.\n2. Remblai compacté.";
    expect(excerptAround(text, "regards")).toBe(
      "NOTES GÉNÉRALES 1. Les regards sont préfabriqués en béton. 2. Remblai compacté.",
    );
  });

  it("ignores accents and case, and keeps the text as it is drawn", () => {
    expect(excerptAround("CONDUITE D'ÉGOUT SANITAIRE", "egout sanitaire")).toBe(
      "CONDUITE D'ÉGOUT SANITAIRE",
    );
  });

  it("cuts long text on both sides of the words", () => {
    const text = `${"a".repeat(100)} puisard ${"b".repeat(100)}`;
    const excerpt = excerptAround(text, "puisard")!;
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).toContain(" puisard ");
    expect(excerpt.length).toBeLessThan(120);
  });

  it("finds words written with separate accent marks", () => {
    expect(excerptAround("Tranchée drainante", "tranchee")).toBe("Tranchée drainante");
  });

  it("is nothing when the words are not on the page", () => {
    expect(excerptAround("Plan et profil", "regard")).toBeNull();
  });
});
