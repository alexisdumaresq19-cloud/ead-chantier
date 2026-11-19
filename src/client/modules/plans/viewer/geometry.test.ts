import { describe, expect, it } from "vitest";

import type { Tiles } from "@/shared/plans";

import {
  baseLevel,
  fitPlacement,
  placementAlong,
  placementTransform,
  tileTuning,
  type Margins,
} from "./geometry";

// An A1 sheet drawn at 200 dpi, landscape.
const a1: Tiles = {
  url: "/t",
  width: 6622,
  height: 4677,
  tileSize: 1024,
  overlap: 1,
  minLevel: 8,
  maxLevel: 13,
};

const phone = { width: 390, height: 844 };
const none: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

describe("a sheet shown whole", () => {
  it("fills the width of a phone held upright and sits in the middle", () => {
    const placed = fitPlacement(phone, none, a1, 0);
    expect(placed.width).toBeCloseTo(390);
    expect(placed.x).toBeCloseTo(0);
    const drawnHeight = (390 * a1.height) / a1.width;
    expect(placed.y).toBeCloseTo((844 - drawnHeight) / 2);
    expect(placed.degrees).toBe(0);
  });

  it("stays between the bars", () => {
    const margins = { top: 100, right: 8, bottom: 80, left: 8 };
    const placed = fitPlacement(phone, margins, a1, 0);
    expect(placed.width).toBeCloseTo(374);
    expect(placed.x).toBeCloseTo(8);
    // Centred in the room left by the bars, not in the screen.
    const drawnHeight = (374 * a1.height) / a1.width;
    expect(placed.y + drawnHeight / 2).toBeCloseTo(100 + (844 - 180) / 2);
  });

  it("is limited by the height on a wide screen", () => {
    const placed = fitPlacement({ width: 1440, height: 900 }, none, a1, 0);
    expect(placed.width).toBeCloseTo((900 * a1.width) / a1.height);
    expect(placed.y).toBeCloseTo(0);
  });

  it("uses the height of the phone once turned a quarter", () => {
    const placed = fitPlacement(phone, none, a1, 1);
    // The sheet's long side now runs down the screen.
    const scale = Math.min(390 / a1.height, 844 / a1.width);
    expect(placed.width).toBeCloseTo(a1.width * scale);
    expect(placed.degrees).toBe(90);
    // Its top-left corner is at the top right of where it is drawn.
    expect(placed.x).toBeCloseTo(390 / 2 + (a1.height * scale) / 2);
    expect(placed.y).toBeCloseTo(844 / 2 - (a1.width * scale) / 2);
  });

  it("is the same size upside down, with its corner at the opposite end", () => {
    const upright = fitPlacement(phone, none, a1, 0);
    const flipped = fitPlacement(phone, none, a1, 2);
    expect(flipped.width).toBeCloseTo(upright.width);
    expect(flipped.x).toBeCloseTo(390);
    expect(flipped.y).toBeCloseTo(844 - upright.y);
  });

  it("copes with a screen smaller than its bars", () => {
    const placed = fitPlacement({ width: 10, height: 10 }, { ...none, top: 50 }, a1, 0);
    expect(placed.width).toBeGreaterThan(0);
  });
});

describe("following the viewer", () => {
  it("reads the size and the turn from the sheet's top edge", () => {
    expect(placementAlong({ x: 10, y: 20 }, { x: 210, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 200,
      degrees: 0,
    });
    const turned = placementAlong({ x: 300, y: 50 }, { x: 300, y: 450 });
    expect(turned.width).toBeCloseTo(400);
    expect(turned.degrees).toBeCloseTo(90);
  });

  it("agrees with the placement computed for a whole sheet", () => {
    // The top edge of the sheet, turned a quarter, runs straight down.
    const placed = fitPlacement(phone, none, a1, 1);
    const along = placementAlong(
      { x: placed.x, y: placed.y },
      { x: placed.x, y: placed.y + placed.width },
    );
    expect(along.width).toBeCloseTo(placed.width);
    expect(along.degrees).toBeCloseTo(90);
  });

  it("writes it as one transform", () => {
    expect(placementTransform({ x: 8, y: 290.066, width: 320, degrees: 90 }, 640)).toBe(
      "translate(8px, 290.07px) rotate(90deg) scale(0.5)",
    );
  });
});

describe("the tile that holds the whole sheet", () => {
  it("is the highest level made of one tile", () => {
    // 828 × 585 at level 10; level 11 needs 2 × 2 tiles.
    expect(baseLevel(a1)).toBe(10);
  });

  it("is the full size for a small image", () => {
    expect(baseLevel({ ...a1, width: 900, height: 600, minLevel: 8, maxLevel: 10 })).toBe(10);
  });

  it("is never below the smallest level stored", () => {
    expect(baseLevel({ ...a1, tileSize: 128 })).toBe(8);
  });
});

describe("how much detail a screen is worth", () => {
  it("lets a tile stretch a little on a dense phone screen, never on a monitor", () => {
    expect(tileTuning({ ...phone, pixelRatio: 3 }).minPixelRatio).toBe(0.6);
    expect(tileTuning({ width: 1440, height: 900, pixelRatio: 1 }).minPixelRatio).toBe(0.5);
  });

  it("keeps few tiles in memory on a phone, more on a large dense screen", () => {
    expect(tileTuning({ ...phone, pixelRatio: 3 }).maxImageCacheCount).toBe(32);
    expect(tileTuning({ width: 1440, height: 900, pixelRatio: 1 }).maxImageCacheCount).toBe(32);
    const large = tileTuning({ width: 2560, height: 1440, pixelRatio: 2 }).maxImageCacheCount;
    expect(large).toBeGreaterThan(64);
    expect(large).toBeLessThanOrEqual(128);
  });
});
