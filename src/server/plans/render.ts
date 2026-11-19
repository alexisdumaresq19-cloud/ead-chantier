import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFiumLibrary, type PDFiumDocument } from "@hyzyla/pdfium";
import sharp from "sharp";

// Turns a page of a PDF into a pyramid of image tiles. A plan is drawn once,
// here, at high resolution; phones then load only the few small tiles they
// are looking at, which is why a full-size sheet opens at once and stays
// sharp when zoomed, on any device and without a PDF reader.

/** Resolution of the full-size level. 200 dpi keeps 2 mm text readable. */
const DPI = Number(process.env.PLAN_DPI ?? 200);
/** Very large sheets are drawn a little coarser rather than exhausting memory. */
const MAX_SIDE = 14_000;
const MAX_PIXELS = 110_000_000;

export const TILE_SIZE = 1024;
export const TILE_OVERLAP = 1;
/** Levels smaller than this are never asked for by the viewer. */
const MIN_LEVEL_SIDE = 256;
const THUMB_WIDTH = 640;

let library: Promise<PDFiumLibrary> | undefined;

export async function openPdf(data: Buffer): Promise<PDFiumDocument> {
  library ??= PDFiumLibrary.init();
  return (await library).loadDocument(data);
}

export type RenderedPage = {
  width: number;
  height: number;
  minLevel: number;
  maxLevel: number;
  text: string;
  /** Tile files, as paths relative to the tile folder: "12/3_1.webp". */
  files: { path: string; data: () => Promise<Buffer> }[];
  thumb: Buffer;
  /** Deletes the temporary files. */
  dispose: () => Promise<void>;
};

export function levelsFor(width: number, height: number): { minLevel: number; maxLevel: number } {
  const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
  const minLevel = Math.min(maxLevel, Math.ceil(Math.log2(MIN_LEVEL_SIDE)));
  return { minLevel, maxLevel };
}

export async function renderPage(
  document: PDFiumDocument,
  pageIndex: number,
): Promise<RenderedPage> {
  const page = document.getPage(pageIndex);
  const directory = await mkdtemp(join(tmpdir(), "ead-plan-"));
  try {
    const { originalWidth, originalHeight } = page.getOriginalSize();
    let scale = DPI / 72;
    scale = Math.min(scale, MAX_SIDE / Math.max(originalWidth, originalHeight));
    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (originalWidth * originalHeight)));

    const bitmap = await page.render({ scale, render: "bitmap" });
    const text = page.getText();
    const { width, height } = bitmap;
    const image = () =>
      sharp(bitmap.data, { raw: { width, height, channels: 4 }, limitInputPixels: false }).flatten({
        background: "#ffffff",
      });

    await image()
      .webp({ quality: 80 })
      .tile({ size: TILE_SIZE, overlap: TILE_OVERLAP, layout: "dz", container: "fs" })
      .toFile(join(directory, "t"));
    const thumb = await image()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();

    const { minLevel, maxLevel } = levelsFor(width, height);
    const files: RenderedPage["files"] = [];
    const root = join(directory, "t_files");
    for (const level of await readdir(root)) {
      // Level folders are numbers; libvips also leaves a properties file here.
      if (!/^\d+$/.test(level) || Number(level) < minLevel) continue;
      for (const name of await readdir(join(root, level))) {
        files.push({ path: `${level}/${name}`, data: () => readFile(join(root, level, name)) });
      }
    }
    return {
      width,
      height,
      minLevel,
      maxLevel,
      text,
      files,
      thumb,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    page.close();
  }
}
