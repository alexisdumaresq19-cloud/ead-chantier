import { levelGrid, type Tiles } from "@/shared/plans";

// The arithmetic of the viewer, kept apart from the browser so it can be
// tested: where a sheet sits when shown whole, and how much detail a screen
// is worth.

export type Size = { width: number; height: number };

/** Room kept clear around the sheet, in pixels: the bars, the notch, a little air. */
export type Margins = { top: number; right: number; bottom: number; left: number };

/**
 * Where a sheet's image is on the screen: its top-left corner, its drawn
 * width and its rotation about that corner. Enough to place a picture of it
 * with one CSS transform.
 */
export type Placement = { x: number; y: number; width: number; degrees: number };

/**
 * A sheet shown whole: as large as fits between the margins, centred, turned
 * by quarter turns. It is the placement OpenSeadragon calls "home"; computing
 * it here lets the thumbnail be drawn in place before the viewer exists.
 */
export function fitPlacement(
  screen: Size,
  margins: Margins,
  image: Size,
  quarterTurns: number,
): Placement {
  const roomWidth = Math.max(1, screen.width - margins.left - margins.right);
  const roomHeight = Math.max(1, screen.height - margins.top - margins.bottom);
  const sideways = Math.abs(quarterTurns % 2) === 1;
  const scale = sideways
    ? Math.min(roomWidth / image.height, roomHeight / image.width)
    : Math.min(roomWidth / image.width, roomHeight / image.height);

  // The image's top-left corner, turned about the centre of the room.
  const radians = (quarterTurns * Math.PI) / 2;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const left = (-image.width * scale) / 2;
  const top = (-image.height * scale) / 2;
  return {
    x: margins.left + roomWidth / 2 + left * cos - top * sin,
    y: margins.top + roomHeight / 2 + left * sin + top * cos,
    width: image.width * scale,
    degrees: quarterTurns * 90,
  };
}

/** The placement of an image whose top edge runs from one screen point to another. */
export function placementAlong(
  topLeft: { x: number; y: number },
  topRight: { x: number; y: number },
): Placement {
  const dx = topRight.x - topLeft.x;
  const dy = topRight.y - topLeft.y;
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.hypot(dx, dy),
    degrees: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** The CSS transform that puts an element laid out `baseWidth` wide, at the origin, in place. */
export function placementTransform(placement: Placement, baseWidth: number): string {
  const { x, y, width, degrees } = placement;
  return `translate(${round(x)}px, ${round(y)}px) rotate(${round(degrees)}deg) scale(${width / baseWidth})`;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The highest level of the pyramid that is a single tile: the whole sheet in
 * one small file. OpenSeadragon draws it under everything else, so it is the
 * one tile worth fetching ahead for the sheets on either side.
 */
export function baseLevel(tiles: Tiles): number {
  let level = tiles.minLevel;
  while (level < tiles.maxLevel) {
    const { columns, rows } = levelGrid(tiles, level + 1);
    if (columns > 1 || rows > 1) break;
    level++;
  }
  return level;
}

/**
 * How much detail to load for a screen.
 *
 * `minPixelRatio` is the fewest screen pixels a tile pixel may cover before a
 * sharper level is fetched: at 0.5 a tile is never stretched. On the dense
 * screens of phones, 0.6 lets a tile stretch by a fifth at most, which the
 * eye cannot see at that density, and saves about a third of the downloads.
 *
 * `maxImageCacheCount` is how many tiles stay in memory. A tile is up to 4 MB
 * once decoded, so the default of 200 would exhaust a phone: keep a few
 * screens' worth.
 */
export function tileTuning(
  screen: Size & { pixelRatio: number },
  tileSize = 1024,
): { minPixelRatio: number; maxImageCacheCount: number } {
  const minPixelRatio = screen.pixelRatio >= 2 ? 0.6 : 0.5;
  const tilePixelsOnScreen =
    (screen.width * screen.height * screen.pixelRatio ** 2) / minPixelRatio ** 2;
  const tilesOnScreen = Math.ceil(tilePixelsOnScreen / tileSize ** 2);
  return {
    minPixelRatio,
    maxImageCacheCount: Math.min(128, Math.max(32, Math.ceil(tilesOnScreen * 2.5))),
  };
}
