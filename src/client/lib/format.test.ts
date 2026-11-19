import { describe, expect, it } from "vitest";

import { count, formatAgo, formatDay, formatSize, initials, todayKey } from "./format";

describe("format", () => {
  it("writes a calendar day without shifting it across time zones", () => {
    expect(formatDay("2026-10-01")).toBe("1 octobre 2026");
  });

  it("gives today's date as a key", () => {
    expect(todayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("says how long ago in words", () => {
    const now = new Date(2026, 9, 10, 9, 0);
    expect(formatAgo(new Date(2026, 9, 10, 7, 0), now)).toBe("aujourd'hui");
    expect(formatAgo(new Date(2026, 9, 9, 23, 0), now)).toBe("hier");
    expect(formatAgo(new Date(2026, 9, 7, 12, 0), now)).toBe("il y a 3 jours");
    expect(formatAgo(new Date(2026, 8, 1, 12, 0), now)).toBe("1 septembre 2026");
  });

  it("writes sizes in French units", () => {
    expect(formatSize(512)).toBe("512 o");
    expect(formatSize(1536)).toBe("1,5 ko");
    expect(formatSize(48 * 1024 * 1024)).toBe("48 Mo");
  });

  it("takes the first and last initials", () => {
    expect(initials("Marc Lévesque")).toBe("ML");
    expect(initials("Jean-Philippe St-Onge Bélanger")).toBe("JB");
    expect(initials("  Julie ")).toBe("J");
  });

  it("counts with the right plural", () => {
    expect(count(0, "feuille")).toBe("0 feuille");
    expect(count(1, "feuille")).toBe("1 feuille");
    expect(count(8, "feuille")).toBe("8 feuilles");
    expect(count(2, "projet archivé", "projets archivés")).toBe("2 projets archivés");
  });
});
