import { describe, expect, it } from "vitest";

import samples from "./suggest.samples.json";
import { suggestSheetName } from "./suggest";

// The text PDFium reads on the eight sheets of the sample plan set
// (scripts/make-sample-plans.ts), with the names guessed before the guess
// was made linear: they must not change.

describe("guessing a sheet's name", () => {
  it.each(samples)("reads page $pageIndex of the sample set as before", (sample) => {
    expect(suggestSheetName(sample.text, sample.pageIndex, "Plans civils.pdf")).toEqual(
      sample.expected,
    );
  });

  it("takes the number next to its label, even two lines below it", () => {
    const text = "NOTES\nMG-20 compacté\nFEUILLE\nDATE\nS-102\nRev. 1\nS-102A dans la note";
    expect(suggestSheetName(text, 0, "x.pdf").number).toBe("S-102");
  });

  it("numbers the page when nothing looks like a sheet number", () => {
    expect(suggestSheetName("PLAN DE SITUATION\nÉchelle 1:500", 4, "Lot 3.pdf")).toEqual({
      number: "05",
      title: "Lot 3 — page 5",
    });
  });

  it("reads one very long line in a moment", () => {
    // 240,000 characters on one baseline: 13 s when the guess was quadratic.
    const line = "A1 ".repeat(80_000);
    const started = performance.now();
    const name = suggestSheetName(line, 0, "x.pdf");
    expect(performance.now() - started).toBeLessThan(500);
    expect(name.number).toBe("01");
  });
});
