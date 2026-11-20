import { describe, expect, it } from "vitest";

import { qrShape } from "./qr-shape";

const LINK = "https://chantier.exemple.ca/j/4fGq0b1mY2n8Zr5tKx7LwPa9sVd3uHc6eJiNoQyRzTU";

/** Paints the path back onto a grid, to compare it with what a scanner expects. */
function paint({ size, path }: { size: number; path: string }): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(width); i++) grid[Number(y)][Number(x) + i] = true;
  }
  return grid;
}

describe("qrShape", () => {
  it("draws the three corner squares a scanner looks for, inside a light margin", () => {
    const shape = qrShape(LINK);
    const grid = paint(shape);
    const last = shape.size - 1;
    // The margin stays light.
    expect(grid[0].some(Boolean)).toBe(false);
    expect(grid[1].some(Boolean)).toBe(false);
    expect(grid.every((row) => !row[0] && !row[1] && !row[last] && !row[last - 1])).toBe(true);
    // Each finder pattern starts with a full row of seven dark modules.
    expect(grid[2].slice(2, 9).every(Boolean)).toBe(true);
    expect(grid[2].slice(last - 8, last - 1).every(Boolean)).toBe(true);
    expect(grid[last - 8].slice(2, 9).every(Boolean)).toBe(true);
    // ...then a light ring inside it.
    expect(grid[3].slice(3, 8).some(Boolean)).toBe(false);
  });

  it("covers every dark module exactly, row by row", () => {
    const { path } = qrShape("EAD");
    expect(path.startsWith("M2 2h7v1h-7z")).toBe(true);
    expect(path).not.toMatch(/h0v/);
  });

  it("keeps a site link small enough to scan from a distance", () => {
    // Fewer, larger modules: 33 a side at the lowest correction level, plus the margin.
    expect(qrShape(LINK, "L").size).toBe(33 + 4);
    expect(qrShape(LINK, "L").size).toBeLessThan(qrShape(LINK, "Q").size);
  });

  it("gives the same drawing for the same link", () => {
    expect(qrShape(LINK)).toEqual(qrShape(LINK));
  });
});
