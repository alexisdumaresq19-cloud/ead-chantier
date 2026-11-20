import { describe, expect, it } from "vitest";

import { photoPages, type LayoutRules, type PhotoRow } from "./layout";

const RULES: LayoutRules = {
  width: 528,
  gap: 12,
  target: 200,
  min: 110,
  max: 236,
  most: 4,
  rowGap: 12,
  page: 682,
};
const LANDSCAPE = 4 / 3;
const PORTRAIT = 3 / 4;
const PANORAMA = 3;
/** One line of caption under every photo, with its gap. */
const caption = () => 15;

const rowsOf = (aspects: number[], first = RULES.page) =>
  photoPages(aspects, caption, RULES, first);
const shape = (pages: PhotoRow[][]) => pages.map((rows) => rows.map((row) => row.count));
const filled = (row: PhotoRow) =>
  row.widths.reduce((total, width) => total + width, 0) + RULES.gap * (row.count - 1);

describe("the layout of a report's photos", () => {
  it("puts two landscapes side by side, at one height, across the width", () => {
    const [[row]] = rowsOf([LANDSCAPE, LANDSCAPE]);
    expect(row.count).toBe(2);
    expect(row.short).toBe(false);
    expect(filled(row)).toBeCloseTo(RULES.width, 6);
    expect(row.widths[0]).toBeCloseTo(row.widths[1], 6);
  });

  it("keeps every photo in its proportions", () => {
    const aspects = [LANDSCAPE, PORTRAIT, PANORAMA, PORTRAIT, LANDSCAPE, 16 / 9, PORTRAIT];
    for (const row of rowsOf(aspects).flat())
      row.widths.forEach((width, at) =>
        expect(width / row.height).toBeCloseTo(aspects[row.start + at], 6),
      );
  });

  it("makes rows of three portraits, and lets a panorama fill a row alone", () => {
    expect(shape(rowsOf([PORTRAIT, PORTRAIT, PORTRAIT]))).toEqual([[3]]);
    const [[row]] = rowsOf([PANORAMA]);
    expect(row.short).toBe(false);
    expect(filled(row)).toBeCloseTo(RULES.width, 6);
  });

  it("never stretches a photo left alone at the end across the page", () => {
    const pages = rowsOf([LANDSCAPE, LANDSCAPE, LANDSCAPE]);
    expect(shape(pages)).toEqual([[2, 1]]);
    const last = pages[0][1];
    expect(last.short).toBe(true);
    expect(last.height).toBe(RULES.target);
    expect(filled(last)).toBeLessThan(RULES.width / 2 + 20);
    // A single photo alone is the same.
    expect(rowsOf([PORTRAIT])[0][0].height).toBe(RULES.target);
  });

  it("keeps every row within the smallest and largest heights", () => {
    const aspects = Array.from({ length: 40 }, (_, index) =>
      index % 5 === 4 ? PANORAMA : index % 3 === 2 ? PORTRAIT : LANDSCAPE,
    );
    const rows = rowsOf(aspects).flat();
    expect(rows.reduce((total, row) => total + row.count, 0)).toBe(40);
    for (const row of rows) {
      expect(row.height).toBeLessThanOrEqual(RULES.max);
      if (row.count > 1) expect(row.height).toBeGreaterThanOrEqual(RULES.min);
    }
  });

  it("fills a page with six landscapes, and starts the seventh on the next one", () => {
    expect(shape(rowsOf(Array(6).fill(LANDSCAPE)))).toEqual([[2, 2, 2]]);
    expect(shape(rowsOf(Array(7).fill(LANDSCAPE)))).toEqual([[2, 2, 2], [1]]);
  });

  it("puts a first row under the text when one fits there, and none when none does", () => {
    const aspects = [LANDSCAPE, LANDSCAPE, LANDSCAPE, LANDSCAPE];
    const room = 200 + 15 + 10;
    expect(shape(rowsOf(aspects, room))[0]).toEqual([2]);
    expect(shape(rowsOf(aspects, 120))[0]).toEqual([]);
  });

  it("never puts more on a page than it holds, with the gaps between rows", () => {
    const aspects = Array.from(
      { length: 23 },
      (_, index) => [LANDSCAPE, PORTRAIT, PANORAMA, LANDSCAPE, 1][index % 5],
    );
    const pages = photoPages(aspects, (index) => 15 + (index % 4) * 10, RULES, 300);
    pages.forEach((rows, page) => {
      const used =
        rows.reduce((total, row) => total + row.space, 0) + RULES.rowGap * (rows.length - 1);
      expect(used).toBeLessThanOrEqual(page === 0 ? 300 : RULES.page);
    });
  });

  it("gives the same layout for the same photos", () => {
    const aspects = [PORTRAIT, LANDSCAPE, PANORAMA, PORTRAIT, PORTRAIT, LANDSCAPE];
    expect(rowsOf(aspects)).toEqual(rowsOf(aspects));
  });
});
