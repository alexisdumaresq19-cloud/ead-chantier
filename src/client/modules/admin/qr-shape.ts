import { create, type QRCodeErrorCorrectionLevel } from "qrcode";

/** Light modules kept around the code; the white card it sits on adds the rest. */
const QUIET_ZONE = 2;

/**
 * A QR code as one SVG path on a square of `size` units: drawn as shapes, it
 * stays sharp at any size, on a phone held up as on a printed poster. Dark
 * modules that touch on a row are merged, which keeps the path short.
 */
export function qrShape(
  text: string,
  level: QRCodeErrorCorrectionLevel = "M",
): { size: number; path: string } {
  const { modules } = create(text, { errorCorrectionLevel: level });
  const count = modules.size;
  let path = "";
  for (let row = 0; row < count; row++) {
    let start = -1;
    for (let column = 0; column <= count; column++) {
      const dark = column < count && modules.data[row * count + column] === 1;
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) {
        const width = column - start;
        path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${width}v1h-${width}z`;
        start = -1;
      }
    }
  }
  return { size: count + QUIET_ZONE * 2, path };
}
