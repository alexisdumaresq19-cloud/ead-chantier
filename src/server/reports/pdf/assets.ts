import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { create, type Font } from "fontkit";
import sharp from "sharp";

import type { Coverage } from "./glyphs";

// What the PDF is drawn with: the app's two typefaces (Inter for text,
// Archivo for titles, both under the SIL Open Font License kept beside them)
// and EAD's logo. They are read from disk once per server instance. On
// Vercel these files are not found by the bundler: next.config.ts names them
// in the trace of the route.

/**
 * A file of the project, by its place from the project's folder. The path is
 * put together at run time and marked, so that the bundler does not try to
 * follow it (it would put the whole project in the route's trace).
 */
const projectFile = (...place: string[]) =>
  readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ process.cwd(), ...place));
const FONTS = ["src", "server", "reports", "pdf", "fonts"];
const BRAND = ["public", "brand"];

const FONT_FILES = {
  text: "Inter-Regular.ttf",
  italic: "Inter-Italic.ttf",
  strong: "Inter-SemiBold.ttf",
  bold: "Inter-Bold.ttf",
  title: "Archivo-Bold.ttf",
  display: "Archivo-ExtraBold.ttf",
} as const;

export type FontName = keyof typeof FONT_FILES;

export type Face = {
  /**
   * The typeface read once (its tables parsed), handed to pdfkit as it is:
   * read again for every document, it would take most of the time spent.
   */
  font: Font;
  /** Which characters it can draw. */
  has: Coverage;
  /** The height of its capitals, for one point of size: what lines and boxes centre on. */
  capHeight: number;
};

export type PdfAssets = {
  faces: Record<FontName, Face>;
  /**
   * The full logo, with the company's name, laid on the black of the bands
   * it is drawn on. Without its transparency pdfkit embeds it as it is,
   * instead of taking every pixel apart for each document.
   */
  logo: Buffer;
  /** The emblem alone, laid on the same black. */
  mark: Buffer;
};

function faceOf(data: Buffer): Face {
  const font: Font = create(data);
  const known = new Map<number, boolean>();
  return {
    font,
    has: (codePoint) => {
      let answer = known.get(codePoint);
      if (answer === undefined) {
        answer = font.hasGlyphForCodePoint(codePoint);
        known.set(codePoint, answer);
      }
      return answer;
    },
    capHeight: font.capHeight / font.unitsPerEm,
  };
}

/** The black of the bands (INK in document.ts). */
const BAND_BLACK = "#0b0d10";
const onBlack = (png: Buffer) =>
  sharp(png).flatten({ background: BAND_BLACK }).png({ compressionLevel: 9 }).toBuffer();

let loading: Promise<PdfAssets> | undefined;

async function load(): Promise<PdfAssets> {
  const names = Object.keys(FONT_FILES) as FontName[];
  const [logo, mark, ...fonts] = await Promise.all([
    projectFile(...BRAND, "ead-logo.png").then(onBlack),
    projectFile(...BRAND, "ead-mark.png").then(onBlack),
    ...names.map((name) => projectFile(...FONTS, FONT_FILES[name])),
  ]);
  return {
    faces: Object.fromEntries(names.map((name, index) => [name, faceOf(fonts[index])])) as Record<
      FontName,
      Face
    >,
    logo,
    mark,
  };
}

export function pdfAssets(): Promise<PdfAssets> {
  loading ??= load().catch((error) => {
    // A failed read is tried again at the next document.
    loading = undefined;
    throw error;
  });
  return loading;
}
