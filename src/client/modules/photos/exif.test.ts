import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { EXIF_READ_BYTES, readExifDate } from "./exif";

const bytes = (buffer: Buffer): ArrayBuffer => {
  const copy = new ArrayBuffer(buffer.length);
  new Uint8Array(copy).set(buffer);
  return copy;
};

const jpeg = (exif?: Record<string, Record<string, string>>) => {
  const image = sharp({
    create: { width: 64, height: 48, channels: 3, background: "#7a6a55" },
  }).jpeg();
  return (exif ? image.withExif(exif) : image).toBuffer();
};

describe("the date a JPEG was taken", () => {
  it("is read as the device's local time when the camera wrote no offset", async () => {
    const file = await jpeg({ IFD2: { DateTimeOriginal: "2026:07:01 14:05:09" } });
    expect(readExifDate(bytes(file))).toEqual(new Date(2026, 6, 1, 14, 5, 9));
  });

  it("is exact when the camera wrote its offset from UTC", async () => {
    const file = await jpeg({
      IFD2: { DateTimeOriginal: "2026:07:01 14:05:00", OffsetTimeOriginal: "-04:00" },
    });
    expect(readExifDate(bytes(file))?.toISOString()).toBe("2026-07-01T18:05:00.000Z");
    const east = await jpeg({
      IFD2: { DateTimeOriginal: "2026:07:01 14:05:00", OffsetTimeOriginal: "+05:30" },
    });
    expect(readExifDate(bytes(east))?.toISOString()).toBe("2026-07-01T08:35:00.000Z");
  });

  it("falls back to the file's other dates", async () => {
    const digitized = await jpeg({ IFD2: { DateTimeDigitized: "2026:07:02 08:00:00" } });
    expect(readExifDate(bytes(digitized))).toEqual(new Date(2026, 6, 2, 8, 0, 0));
    const modified = await jpeg({ IFD0: { DateTime: "2026:07:03 09:30:00" } });
    expect(readExifDate(bytes(modified))).toEqual(new Date(2026, 6, 3, 9, 30, 0));
  });

  it("is found in the first bytes of a large file", async () => {
    const file = await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .jpeg({ quality: 95 })
      .withExif({ IFD2: { DateTimeOriginal: "2026:07:01 14:05:00" } })
      .toBuffer();
    expect(file.length).toBeGreaterThan(EXIF_READ_BYTES);
    expect(readExifDate(bytes(file.subarray(0, EXIF_READ_BYTES)))).toEqual(
      new Date(2026, 6, 1, 14, 5, 0),
    );
  });

  it("is null when the file has none", async () => {
    expect(readExifDate(bytes(await jpeg()))).toBeNull();
    expect(readExifDate(bytes(await jpeg({ IFD0: { Copyright: "EXEMPLE" } })))).toBeNull();
    expect(
      readExifDate(bytes(await jpeg({ IFD2: { DateTimeOriginal: "0000:00:00 00:00:00" } }))),
    ).toBeNull();
  });

  it("is null for anything that is not a JPEG, or a damaged one", async () => {
    expect(readExifDate(new ArrayBuffer(0))).toBeNull();
    expect(readExifDate(bytes(Buffer.from("Ceci n'est pas une photo.")))).toBeNull();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    expect(readExifDate(bytes(png))).toBeNull();
    const file = await jpeg({ IFD2: { DateTimeOriginal: "2026:07:01 14:05:00" } });
    // Cut in the middle of the EXIF block.
    for (const length of [3, 12, 40, 80, 120])
      expect(readExifDate(bytes(file.subarray(0, length)))).toBeNull();
  });
});
