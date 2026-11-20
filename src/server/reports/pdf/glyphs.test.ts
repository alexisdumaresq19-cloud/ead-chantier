import { describe, expect, it } from "vitest";

import { covers, drawable } from "./glyphs";

// A typeface that has plain Latin letters, digits, punctuation and the
// no-break space only.
const latin = (codePoint: number) =>
  (codePoint >= 0x20 && codePoint < 0x7f) || codePoint === 0xa0 || codePoint === 0xe9;

describe("what a typeface can draw", () => {
  it("leaves out what it lacks without leaving two spaces behind", () => {
    expect(drawable("Bravo \u{1f44d} !", latin)).toBe("Bravo !");
    expect(drawable("\u{1f477} Fini", latin)).toBe("Fini");
    expect(drawable("Fini \u{1f477}", latin)).toBe("Fini");
    expect(drawable("Fini \u{1f477}\nSuite", latin)).toBe("Fini\nSuite");
    // An emoji made of several characters goes whole.
    expect(drawable("A \u{1f468}\u200d\u{1f527} B", latin)).toBe("A B");
    expect(drawable("Ok ✔\ufe0f fait", latin)).toBe("Ok fait");
  });

  it("writes a character in its plain form when the typeface has that", () => {
    expect(drawable("ﬁn", latin)).toBe("fin");
    expect(drawable("12\u00a0m²", (cp) => latin(cp) && cp !== 0xb2)).toBe("12\u00a0m2");
  });

  it("keeps a narrow no-break space unbreakable", () => {
    expect(drawable("10\u202f000", latin)).toBe("10\u00a0000");
    expect(drawable("10\u202f000", (cp) => cp === 0x202f || latin(cp))).toBe("10\u202f000");
  });

  it("drops invisible characters and writes every space as a plain one", () => {
    expect(drawable("a\u200bb\u00adc\td\u2003e\r\nf", latin)).toBe("abc d e\nf");
    expect(drawable("e\u0301té", latin)).toBe("été");
  });

  it("tells whether a typeface has every character of a text", () => {
    expect(covers("Rue Principale", latin)).toBe(true);
    expect(covers("Дмитрий", latin)).toBe(false);
  });
});
