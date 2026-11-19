import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { chooseTakenAt, exifDate, NotAPhoto, processPhoto, thumbSize } from "./process";

const now = new Date("2026-10-01T18:00:00.000Z");
const at = (iso: string) => new Date(iso);

/** A JPEG as a phone makes it: with a date, a position, and held sideways. */
function phonePhoto(options: { width: number; height: number; orientation?: number }) {
  const { width, height } = options;
  // Blue on the top half, brown on the bottom half, as the camera's sensor saw it.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="50%" fill="#2060e0"/>
    <rect y="50%" width="100%" height="50%" fill="#704010"/>
  </svg>`;
  return sharp(Buffer.from(svg))
    .jpeg()
    .withExif({
      IFD2: { DateTimeOriginal: "2026:07:01 14:05:00" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 49/1 4800/100" },
    })
    .withMetadata({ orientation: options.orientation ?? 1 })
    .toBuffer();
}

describe("when a photo was taken", () => {
  it("believes the phone", () => {
    expect(chooseTakenAt(at("2026-10-01T12:00:00Z"), at("2026-09-01T12:00:00Z"), now)).toEqual(
      at("2026-10-01T12:00:00Z"),
    );
  });

  it("files nothing in the future, even for a clock that runs a little ahead", () => {
    expect(chooseTakenAt(at("2026-10-01T18:04:00Z"), null, now)).toEqual(now);
    expect(chooseTakenAt(at("2026-10-02T18:00:00Z"), at("2026-09-30T10:00:00Z"), now)).toEqual(
      at("2026-09-30T10:00:00Z"),
    );
  });

  it("does not believe a clock that was never set", () => {
    expect(chooseTakenAt(at("1970-01-01T00:00:10Z"), at("2026-09-30T10:00:00Z"), now)).toEqual(
      at("2026-09-30T10:00:00Z"),
    );
    expect(chooseTakenAt(at("2000-01-01T00:00:00Z"), at("1980-01-01T00:00:00Z"), now)).toEqual(now);
  });

  it("falls back to the camera's date, then to now", () => {
    expect(chooseTakenAt(undefined, at("2026-09-30T10:00:00Z"), now)).toEqual(
      at("2026-09-30T10:00:00Z"),
    );
    expect(chooseTakenAt(new Date("nonsense"), null, now)).toEqual(now);
    expect(chooseTakenAt(undefined, undefined, now)).toEqual(now);
  });
});

describe("the preview's size", () => {
  it("keeps 360 pixels on the short side", () => {
    expect(thumbSize(2560, 1920)).toEqual({ width: 480, height: 360 });
    expect(thumbSize(1920, 2560)).toEqual({ width: 360, height: 480 });
    expect(thumbSize(2560, 1440)).toEqual({ width: 640, height: 360 });
  });

  it("caps a panorama and never enlarges", () => {
    expect(thumbSize(2560, 512)).toEqual({ width: 960, height: 192 });
    expect(thumbSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe("a photo's files", () => {
  it("come out upright, shrunk, and without the phone's metadata", async () => {
    // 12 megapixels, the phone held upright: the sensor's image lies on its side.
    const original = await phonePhoto({ width: 4032, height: 3024, orientation: 6 });
    const photo = await processPhoto(original);
    expect([photo.width, photo.height]).toEqual([1920, 2560]);

    for (const [file, format, size] of [
      [photo.full, "jpeg", [1920, 2560]],
      [photo.thumb, "webp", [360, 480]],
    ] as const) {
      const metadata = await sharp(file).metadata();
      expect(metadata.format).toBe(format);
      expect([metadata.width, metadata.height]).toEqual(size);
      // No EXIF at all: no GPS position, no orientation left to apply twice.
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      // Turned a quarter clockwise, the sensor's top (blue) is on the right.
      const pixels = await sharp(file).resize(2, 1, { fit: "fill" }).raw().toBuffer();
      expect(pixels[2]).toBeLessThan(90);
      expect(pixels[5]).toBeGreaterThan(160);
    }
    expect((await sharp(photo.full).metadata()).isProgressive).toBe(true);
  });

  it("reads the camera's date on the site's clock", async () => {
    const photo = await processPhoto(await phonePhoto({ width: 800, height: 600 }));
    expect(photo.exifDate?.toISOString()).toBe("2026-07-01T18:05:00.000Z");
  });

  it("uses the offset from UTC when the camera wrote one", async () => {
    const original = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#888888" },
    })
      .jpeg()
      .withExif({ IFD2: { DateTimeOriginal: "2026:07:01 14:05:00", OffsetTimeOriginal: "-07:00" } })
      .toBuffer();
    expect(exifDate((await sharp(original).metadata()).exif)?.toISOString()).toBe(
      "2026-07-01T21:05:00.000Z",
    );
  });

  it("leaves a small photo at its size", async () => {
    const photo = await processPhoto(await phonePhoto({ width: 640, height: 480 }));
    expect([photo.width, photo.height]).toEqual([640, 480]);
  });

  it("gives a screenshot's transparent parts a white background", async () => {
    const png = await sharp({
      create: { width: 200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const photo = await processPhoto(png);
    const pixels = await sharp(photo.full).resize(1, 1).raw().toBuffer();
    expect([...pixels.subarray(0, 3)].every((value) => value > 250)).toBe(true);
    expect(photo.exifDate).toBeNull();
  });

  it("refuses what is not an image", async () => {
    await expect(processPhoto(Buffer.from("Ceci n'est pas une photo."))).rejects.toBeInstanceOf(
      NotAPhoto,
    );
    await expect(processPhoto(Buffer.alloc(0))).rejects.toBeInstanceOf(NotAPhoto);
  });

  it("refuses formats the app does not keep", async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
    })
      .gif()
      .toBuffer();
    await expect(processPhoto(gif)).rejects.toBeInstanceOf(NotAPhoto);
  });

  it("has no date for a file without EXIF, or with a broken block", () => {
    expect(exifDate(undefined)).toBeNull();
    expect(exifDate(Buffer.from("Exif\0\0garbage"))).toBeNull();
  });
});
