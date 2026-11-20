import { describe, expect, it } from "vitest";

import { breakLines, type Run } from "./lines";

// Every character is 1 point wide, so widths are counts of characters.
const measure = (text: string) => [...text].length;
const plain = (text: string): Run<string>[] => [{ text, style: "body" }];
const texts = (text: string, width: number) =>
  breakLines(plain(text), width, measure).map((line) => line.runs.map((run) => run.text).join(""));

describe("breaking a paragraph into lines", () => {
  it("breaks at spaces and drops the spaces at the ends of lines", () => {
    expect(texts("pose de la conduite", 10)).toEqual(["pose de la", "conduite"]);
    expect(texts("  pose", 10)).toEqual(["pose"]);
  });

  it("never breaks at a no-break space", () => {
    expect(texts("arrêt à 14\u00a0h\u00a030", 10)).toEqual(["arrêt à", "14\u00a0h\u00a030"]);
  });

  it("breaks after a hyphen between two long parts only", () => {
    expect(texts("chez Marie-Ève", 11)).toEqual(["chez Marie-", "Ève"]);
    expect(texts("entre R-4 et", 7)).toEqual(["entre", "R-4 et"]);
  });

  it("cuts a word longer than a whole line, so nothing leaves the page", () => {
    const lines = texts("série XJ29384756293847", 8);
    expect(lines.every((line) => measure(line) <= 8)).toBe(true);
    expect(lines.join("")).toBe("sérieXJ29384756293847");
  });

  it("keeps each run's style, and never ends a line between two runs without a space", () => {
    const lines = breakLines(
      [
        { text: "3\u00a0\u00a0", style: "number" },
        { text: "conduite en place\u00a0", style: "caption" },
        { text: "·\u00a09\u00a0h\u00a034", style: "time" },
      ],
      20,
      measure,
    );
    expect(lines.map((line) => line.runs.map((run) => [run.style, run.text]))).toEqual([
      [
        ["number", "3\u00a0\u00a0"],
        ["caption", "conduite en"],
      ],
      [
        ["caption", "place\u00a0"],
        ["time", "·\u00a09\u00a0h\u00a034"],
      ],
    ]);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(20);
  });
});
