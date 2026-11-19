import { describe, expect, it } from "vitest";

import { allTileUrls, levelGrid, levelSize, type Tiles } from "./plans";

// An A1 sheet drawn at 200 dpi.
const a1: Tiles = {
  url: "/t",
  width: 6622,
  height: 4678,
  tileSize: 1024,
  overlap: 1,
  minLevel: 8,
  maxLevel: 13,
};

describe("the tile pyramid", () => {
  it("halves the image at each level below the full one", () => {
    expect(levelSize(a1, 13)).toEqual({ width: 6622, height: 4678 });
    expect(levelSize(a1, 12)).toEqual({ width: 3311, height: 2339 });
    expect(levelSize(a1, 8)).toEqual({ width: 207, height: 147 });
  });

  it("counts the tiles of a level", () => {
    expect(levelGrid(a1, 13)).toEqual({ columns: 7, rows: 5 });
    expect(levelGrid(a1, 12)).toEqual({ columns: 4, rows: 3 });
    expect(levelGrid(a1, 10)).toEqual({ columns: 1, rows: 1 });
  });

  it("lists every tile, smallest levels first", () => {
    const urls = allTileUrls(a1);
    expect(urls[0]).toBe("/t/8/0_0.webp");
    expect(urls.at(-1)).toBe("/t/13/6_4.webp");
    // 1 + 1 + 1 + 2×2 + 4×3 + 7×5
    expect(urls).toHaveLength(54);
  });
});
