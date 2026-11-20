import { PHOTO_MAX_SIDE } from "@/shared/photos";

import { fitWithin } from "./logic";

// A phone's photo is 3 to 12 MB; the server keeps 2560 pixels of it. Drawing
// it at that size here, before sending, turns a minute on a cellular network
// into a few seconds. The same pass makes the small image the gallery shows
// while the photo is on its way.

const JPEG_QUALITY = 0.85;
/** Short side of the image shown in the grid until the real thumbnail exists. */
const PREVIEW_SIDE = 400;
/** What the server accepts as it is, when the browser cannot redraw a file. */
const ACCEPTED = /^image\/(jpeg|png|webp)$/;
const MAX_BYTES = 30 * 1024 * 1024;

export type Shrunk = {
  /** What to send: the redrawn image, or the original when it was already small enough. */
  file: Blob;
  /** For the grid; null when the browser could not draw the file. */
  preview: Blob | null;
};

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** The picture, upright (the camera's orientation applied), ready to be drawn. */
async function decode(file: Blob): Promise<Drawable | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    // Older browsers: an <img> also applies the orientation when drawn.
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth) throw new Error("empty image");
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function draw(image: Drawable, width: number, height: number, quality: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve<Blob | null>(null);
  // A JPEG has no transparency: without this a screenshot's clear parts turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(
      (blob) => resolve(blob?.type === "image/jpeg" ? blob : null),
      "image/jpeg",
      quality,
    ),
  );
}

/**
 * Prepares a chosen file for sending. Returns null when the file cannot be
 * a photo here: the browser cannot draw it and the server would not take it
 * as it is (a HEIC image on a phone that does not read them, a video…).
 */
export async function shrinkPhoto(file: Blob): Promise<Shrunk | null> {
  const asIs = ACCEPTED.test(file.type) && file.size <= MAX_BYTES ? file : null;
  const image = await decode(file);
  if (!image) return asIs ? { file: asIs, preview: null } : null;
  try {
    const size = fitWithin(image.width, image.height, PHOTO_MAX_SIDE);
    const scale = Math.max(1, Math.min(size.width, size.height) / PREVIEW_SIDE);
    const preview = await draw(
      image,
      Math.round(size.width / scale),
      Math.round(size.height / scale),
      0.72,
    );
    // A JPEG that is already small enough is sent untouched: redrawing it
    // would only lose quality.
    const small = size.width === image.width && size.height === image.height;
    if (small && asIs && file.type === "image/jpeg") return { file, preview };
    const redrawn = await draw(image, size.width, size.height, JPEG_QUALITY);
    if (redrawn) return { file: redrawn, preview };
    return asIs ? { file: asIs, preview } : null;
  } finally {
    image.release();
  }
}
