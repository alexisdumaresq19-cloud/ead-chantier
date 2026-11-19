import { describe, expect, it } from "vitest";

import { AT_REST, clampView, fitInside, MAX_ZOOM, swipeTurn, zoomAround } from "./zoom";

const phone = { width: 390, height: 844 };

describe("how large a photo is drawn", () => {
  it("fits whole inside the screen", () => {
    expect(fitInside({ width: 2560, height: 1920 }, phone)).toEqual({ width: 390, height: 292.5 });
    expect(fitInside({ width: 1920, height: 2560 }, phone)).toEqual({ width: 390, height: 520 });
    expect(fitInside({ width: 1000, height: 4000 }, phone)).toEqual({ width: 211, height: 844 });
  });

  it("is never drawn larger than it is", () => {
    expect(fitInside({ width: 300, height: 200 }, phone)).toEqual({ width: 300, height: 200 });
  });

  it("is nothing before the screen is measured", () => {
    expect(fitInside({ width: 300, height: 200 }, { width: 0, height: 0 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("looking closely", () => {
  const drawn = { width: 390, height: 292.5 };

  it("keeps the point under the finger in place", () => {
    const at = { x: 100, y: -50 };
    const view = zoomAround(AT_REST, 2.5, at);
    // The point of the photo that was under the finger: (100, -50) before…
    const before = { x: (at.x - AT_REST.x) / AT_REST.scale, y: (at.y - AT_REST.y) / AT_REST.scale };
    // …is still drawn under it after.
    expect(before.x * view.scale + view.x).toBeCloseTo(at.x);
    expect(before.y * view.scale + view.y).toBeCloseTo(at.y);
  });

  it("follows the fingers of a pinch as they move", () => {
    const view = zoomAround(AT_REST, 2, { x: 0, y: 0 }, { x: 30, y: 10 });
    expect(view).toEqual({ scale: 2, x: 30, y: 10 });
  });

  it("stays between its real size on screen and five times that", () => {
    expect(zoomAround(AT_REST, 0.3, { x: 0, y: 0 }).scale).toBe(1);
    expect(zoomAround(AT_REST, 40, { x: 0, y: 0 }).scale).toBe(MAX_ZOOM);
  });

  it("cannot be dragged off the screen", () => {
    // At 2×, 780 wide on a 390 screen: 195 of reach on each side; 585 tall
    // on an 844 screen: none.
    expect(clampView({ scale: 2, x: 500, y: 300 }, drawn, phone)).toEqual({
      scale: 2,
      x: 195,
      y: 0,
    });
    expect(clampView({ scale: 2, x: -500, y: -300 }, drawn, phone)).toEqual({
      scale: 2,
      x: -195,
      y: -0,
    });
    expect(clampView({ scale: 4, x: 0, y: 200 }, drawn, phone)).toEqual({ scale: 4, x: 0, y: 163 });
  });

  it("comes back to the middle at its normal size", () => {
    expect(clampView({ scale: 1, x: 80, y: -40 }, drawn, phone)).toEqual({ scale: 1, x: 0, y: -0 });
    expect(clampView({ scale: 0.6, x: 0, y: 0 }, drawn, phone).scale).toBe(1);
  });
});

describe("turning to a neighbour", () => {
  it("needs a real drag", () => {
    expect(swipeTurn(-30, 0, 390)).toBe(0);
    expect(swipeTurn(30, 0.1, 390)).toBe(0);
  });

  it("goes to the next photo when dragged far to the left, the previous to the right", () => {
    expect(swipeTurn(-120, 0, 390)).toBe(1);
    expect(swipeTurn(120, 0, 390)).toBe(-1);
  });

  it("also turns on a short, quick flick", () => {
    expect(swipeTurn(-40, -0.8, 390)).toBe(1);
    expect(swipeTurn(40, 0.8, 390)).toBe(-1);
    // Quick, but barely moved: a tap that slipped.
    expect(swipeTurn(-10, -2, 390)).toBe(0);
  });

  it("asks for no more than a hand's width on a wide screen", () => {
    expect(swipeTurn(-150, 0, 1440)).toBe(1);
    expect(swipeTurn(-100, 0, 1440)).toBe(0);
  });
});
