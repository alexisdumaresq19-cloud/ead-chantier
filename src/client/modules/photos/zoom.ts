// The arithmetic of looking at a photo closely: how large it is drawn, and
// where it may be dragged once enlarged. Positions are measured from the
// centre of the screen.

export type Size = { width: number; height: number };
export type View = { scale: number; x: number; y: number };

export const MAX_ZOOM = 5;
/** What a double tap zooms to. */
export const TAP_ZOOM = 2.5;
export const AT_REST: View = { scale: 1, x: 0, y: 0 };

/** The photo drawn whole inside the screen, never larger than it really is. */
export function fitInside(photo: Size, screen: Size): Size {
  if (!photo.width || !photo.height || !screen.width || !screen.height)
    return { width: 0, height: 0 };
  const scale = Math.min(1, screen.width / photo.width, screen.height / photo.height);
  return { width: photo.width * scale, height: photo.height * scale };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps an enlarged photo from being dragged off the screen. */
export function clampView(view: View, drawn: Size, screen: Size): View {
  const scale = clamp(view.scale, 1, MAX_ZOOM);
  const reachX = Math.max(0, (drawn.width * scale - screen.width) / 2);
  const reachY = Math.max(0, (drawn.height * scale - screen.height) / 2);
  return { scale, x: clamp(view.x, -reachX, reachX), y: clamp(view.y, -reachY, reachY) };
}

/**
 * Zooms to `scale` while the point of the photo that was under `from` ends
 * up under `to` (the same point for a wheel or a double tap; the fingers'
 * midpoint, which moves, for a pinch).
 */
export function zoomAround(
  view: View,
  scale: number,
  from: { x: number; y: number },
  to: { x: number; y: number } = from,
): View {
  const next = clamp(scale, 1, MAX_ZOOM);
  const ratio = next / view.scale;
  return { scale: next, x: to.x - (from.x - view.x) * ratio, y: to.y - (from.y - view.y) * ratio };
}

/** Whether a horizontal drag, once released, turns to the next or previous photo. */
export function swipeTurn(distance: number, velocity: number, width: number): -1 | 0 | 1 {
  const far = Math.abs(distance) > Math.min(140, width * 0.22);
  const fast = Math.abs(velocity) > 0.45 && Math.abs(distance) > 24;
  if (!far && !fast) return 0;
  // Dragging the photo to the left brings the next one.
  return distance < 0 ? 1 : -1;
}
