import { tileUrl, type SheetRevision } from "@/shared/plans";

import { baseLevel } from "./geometry";

// Fetching ahead what the next sheet will show first, so that turning to it
// is immediate: its thumbnail and the one tile that holds the whole sheet.
// They are asked for the way the viewer asks (with CORS), so the browser and
// the service worker serve the viewer from the same stored answer.

const loading = new Map<string, HTMLImageElement>();
const fetched = new Set<string>();

function preloadImage(url: string) {
  if (fetched.has(url) || loading.has(url)) return;
  const image = new Image();
  image.crossOrigin = "anonymous";
  // Held until it ends, or the browser could drop the request with the image.
  loading.set(url, image);
  image.onload = () => {
    loading.delete(url);
    fetched.add(url);
  };
  image.onerror = () => loading.delete(url);
  image.src = url;
}

export function preloadRevision(revision: SheetRevision) {
  preloadImage(revision.thumbUrl);
  preloadImage(tileUrl(revision.tiles, baseLevel(revision.tiles), 0, 0));
}
