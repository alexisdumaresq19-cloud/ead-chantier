// When a JPEG says it was taken. The image is redrawn smaller before it is
// sent, which drops its EXIF block, so the date is read here first: a photo
// chosen from the phone's gallery must land on the day it was taken.

const EXIF_IFD = 0x8769;
const DATE_TIME = 0x0132;
const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME_DIGITIZED = 0x9004;
const OFFSET_TIME = 0x9010;
const OFFSET_TIME_ORIGINAL = 0x9011;

/** The EXIF block is near the start of the file: this much is enough to find it. */
export const EXIF_READ_BYTES = 256 * 1024;

/** The TIFF structure inside a JPEG's EXIF segment, if it has one. */
function findTiff(view: DataView): number | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    // The picture itself starts: there is no EXIF after this.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(offset + 2);
    if (
      marker === 0xe1 &&
      offset + 10 <= view.byteLength &&
      view.getUint32(offset + 4) === 0x45786966 && // "Exif"
      view.getUint16(offset + 8) === 0
    )
      return offset + 10;
    offset += 2 + length;
  }
  return null;
}

/** The text tags of one directory, by tag number; pointers to other directories as numbers. */
function readDirectory(
  view: DataView,
  tiff: number,
  directory: number,
  little: boolean,
): Map<number, string | number> {
  const tags = new Map<number, string | number>();
  const start = tiff + directory;
  if (start + 2 > view.byteLength) return tags;
  const entries = view.getUint16(start, little);
  for (let i = 0; i < entries; i++) {
    const entry = start + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    if (type === 4 && count === 1) {
      tags.set(tag, view.getUint32(entry + 8, little));
    } else if (type === 2 && count > 0 && count <= 64) {
      const at = count <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little);
      if (at + count > view.byteLength) continue;
      let text = "";
      for (let j = 0; j < count; j++) {
        const code = view.getUint8(at + j);
        if (code === 0) break;
        text += String.fromCharCode(code);
      }
      tags.set(tag, text);
    }
  }
  return tags;
}

/**
 * The date a JPEG was taken, from the first bytes of the file; null when it
 * does not say. Cameras write the local time: with the offset from UTC that
 * recent phones add it is exact, and without it the time is read on this
 * device's clock (the phone that took the photo, most of the time).
 */
export function readExifDate(bytes: ArrayBuffer): Date | null {
  try {
    const view = new DataView(bytes);
    const tiff = findTiff(view);
    if (tiff === null || tiff + 8 > view.byteLength) return null;
    const order = view.getUint16(tiff);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    if (view.getUint16(tiff + 2, little) !== 42) return null;

    const image = readDirectory(view, tiff, view.getUint32(tiff + 4, little), little);
    const pointer = image.get(EXIF_IFD);
    const photo =
      typeof pointer === "number"
        ? readDirectory(view, tiff, pointer, little)
        : new Map<number, string | number>();

    const original = photo.get(DATE_TIME_ORIGINAL);
    const written = original ?? photo.get(DATE_TIME_DIGITIZED) ?? image.get(DATE_TIME);
    const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(written ?? ""));
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    // A camera whose clock was never set writes zeros.
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const zone = /^([+-])(\d{2}):(\d{2})$/.exec(
      String(photo.get(original ? OFFSET_TIME_ORIGINAL : OFFSET_TIME) ?? ""),
    );
    const date = zone
      ? new Date(
          Date.UTC(year, month - 1, day, hour, minute, second) -
            (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3])) * 60_000,
        )
      : new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    // A damaged block reads past its end: the file simply has no usable date.
    return null;
  }
}
