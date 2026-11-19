import type { QRCodeErrorCorrectionLevel } from "qrcode";
import { useMemo } from "react";

import { cn } from "../../lib/cn";
import { qrShape } from "./qr-shape";

/**
 * A QR code, black on white whatever surrounds it, as wide as its container.
 * On a screen, "L" gives the largest modules, read from the farthest; on
 * paper, "M" survives a fold or a stain.
 */
export function QrCode({
  value,
  label,
  level = "L",
  className,
}: {
  value: string;
  /** Read aloud in place of the drawing. */
  label: string;
  level?: QRCodeErrorCorrectionLevel;
  className?: string;
}) {
  const { size, path } = useMemo(() => qrShape(value, level), [value, level]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("block h-auto w-full", className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
