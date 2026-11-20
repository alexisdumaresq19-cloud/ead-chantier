import exifReader from "exif-reader";
import sharp, { type Metadata } from "sharp";

import { PHOTO_MAX_SIDE, siteTimeToDate } from "@/shared/photos";

// What the server keeps of a photo: an image sized for a screen and a small
// preview, both upright and without the phone's metadata (a photo's EXIF
// holds the GPS position, the phone's model, sometimes its owner's name).

const FORMATS = new Set(["jpeg", "png", "webp"]);
/** More pixels than any phone produces; past it, the file is not a photo. */
const MAX_PIXELS = 268_000_000;

const THUMB_SHORT_SIDE = 360;
const THUMB_LONG_SIDE = 960;

/** The file is not an image the app can keep. */
export class NotAPhoto extends Error {}

export type ProcessedPhoto = {
  /** full.jpg */
  full: Buffer;
  /** thumb.webp */
  thumb: Buffer;
  /** Of the full image, upright. */
  width: number;
  height: number;
  /** When the camera says it was taken, if it says so. */
  exifDate: Date | null;
};

/**
 * The preview's size: the grid shows squares, so the short side decides how
 * sharp a thumbnail looks; a panorama is capped on its long side.
 */
export function thumbSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    THUMB_SHORT_SIDE / Math.min(width, height),
    THUMB_LONG_SIDE / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The moment written in a photo's EXIF block. Cameras write the local time;
 * recent phones add the offset from UTC, and without it the time is read on
 * the site's clock.
 */
export function exifDate(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  try {
    const tags = exifReader(exif);
    const local =
      tags.Photo?.DateTimeOriginal ?? tags.Photo?.DateTimeDigitized ?? tags.Image?.DateTime;
    // exif-reader gives the local time as if it were UTC.
    if (!(local instanceof Date) || Number.isNaN(local.getTime())) return null;
    const offset = /^([+-])(\d{2}):(\d{2})$/.exec(String(tags.Photo?.OffsetTimeOriginal ?? ""));
    if (!offset) return siteTimeToDate(local.getTime());
    const minutes = (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
    return new Date(local.getTime() - minutes * 60_000);
  } catch {
    return null;
  }
}

const MINUTE = 60_000;
const YEAR = 365.25 * 24 * 60 * MINUTE;

/**
 * When the photo was taken: what the phone said if it is believable, else
 * what the camera wrote in the file, else now. A phone whose clock runs a
 * little ahead is believed, but nothing is filed in the future; a camera
 * whose clock was never set (1970, 2000…) is not believed.
 */
export function chooseTakenAt(
  sent: Date | null | undefined,
  exif: Date | null | undefined,
  now: Date,
): Date {
  for (const candidate of [sent, exif]) {
    if (!candidate || Number.isNaN(candidate.getTime())) continue;
    const ahead = candidate.getTime() - now.getTime();
    if (ahead <= 10 * MINUTE && ahead >= -20 * YEAR)
      return new Date(Math.min(candidate.getTime(), now.getTime()));
  }
  return now;
}

export async function processPhoto(original: Buffer): Promise<ProcessedPhoto> {
  // Reading the header is what tells a photo from anything else. A file that
  // fails here is refused for good.
  let metadata: Metadata;
  try {
    metadata = await sharp(original).metadata();
  } catch {
    throw new NotAPhoto();
  }
  if (!FORMATS.has(metadata.format) || !metadata.width || !metadata.height) throw new NotAPhoto();
  if (metadata.width * metadata.height > MAX_PIXELS) throw new NotAPhoto();

  // From here on a failure is the server's: damaged pixels are drawn as far
  // as they go ("failOn: none") instead of losing someone's photo.
  const { data: full, info } = await sharp(original, { failOn: "none" })
    .autoOrient()
    .resize({
      width: PHOTO_MAX_SIDE,
      height: PHOTO_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    // A screenshot's transparency would come out black in a JPEG.
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 84, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  // sharp writes no metadata unless asked to: neither file carries the EXIF.
  const thumb = await sharp(full)
    .resize({ ...thumbSize(info.width, info.height), fit: "fill" })
    .webp({ quality: 74 })
    .toBuffer();

  return {
    full,
    thumb,
    width: info.width,
    height: info.height,
    exifDate: exifDate(metadata.exif),
  };
}
