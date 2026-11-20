// @ts-check
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { PDFiumLibrary } from "@hyzyla/pdfium";
import sharp from "sharp";

// Draws the pages of a PDF into pyramids of image tiles. A plan is drawn
// once, here, at high resolution; phones then load only the few small tiles
// they are looking at.
//
// This file is plain JavaScript on purpose. The server starts it by its path
// as a worker thread (render.ts), so that a page that draws for minutes or
// eats PDFium's memory never holds up the server and dies with its thread.
// Node runs it as it is, under Turbopack in development as after
// `next build`; the server also imports it, for the rare platform that
// refuses to start a worker.

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

/**
 * @param {number} width
 * @param {number} height
 * @returns {{ minLevel: number; maxLevel: number }}
 */
export function levelsFor(width, height) {
  const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
  const minLevel = Math.min(maxLevel, Math.ceil(Math.log2(MIN_LEVEL_SIDE)));
  return { minLevel, maxLevel };
}

/**
 * @typedef {object} DrawnPage
 * @property {number} width
 * @property {number} height
 * @property {number} minLevel
 * @property {number} maxLevel
 * @property {string} text
 * @property {string[]} files Tiles, relative to `<directory>/t_files`: "12/3_1.webp".
 */

/**
 * One PDF open in one PDFium of its own. After PDFium has thrown, it may be
 * broken for good (an abort leaves its 2 GB heap full): whoever gets an
 * error from it throws the reader away.
 */
export function pdfReader() {
  /** @type {import("@hyzyla/pdfium").PDFiumLibrary | undefined} */
  let library;
  /** @type {import("@hyzyla/pdfium").PDFiumDocument | undefined} */
  let document;

  return {
    /**
     * @param {Uint8Array} data
     * @returns {Promise<number>} the number of pages
     */
    async open(data) {
      library = await PDFiumLibrary.init();
      document = await library.loadDocument(data);
      return document.getPageCount();
    },

    /**
     * Draws a page into `directory`: tiles under `t_files`, and `thumb.webp`.
     * @param {number} pageIndex
     * @param {string} directory an empty folder
     * @returns {Promise<DrawnPage>}
     */
    async draw(pageIndex, directory) {
      if (!document) throw new Error("No PDF open");
      const page = document.getPage(pageIndex);
      try {
        const { originalWidth, originalHeight } = page.getOriginalSize();
        let scale = DPI / 72;
        scale = Math.min(scale, MAX_SIDE / Math.max(originalWidth, originalHeight));
        scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (originalWidth * originalHeight)));

        const bitmap = await page.render({ scale, render: "bitmap" });
        const text = page.getText();
        const { width, height } = bitmap;
        const image = () =>
          sharp(bitmap.data, {
            raw: { width, height, channels: 4 },
            limitInputPixels: false,
          }).flatten({ background: "#ffffff" });

        await image()
          .webp({ quality: 80 })
          .tile({ size: TILE_SIZE, overlap: TILE_OVERLAP, layout: "dz", container: "fs" })
          .toFile(join(directory, "t"));
        await image()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(join(directory, "thumb.webp"));

        const { minLevel, maxLevel } = levelsFor(width, height);
        /** @type {string[]} */
        const files = [];
        const root = join(directory, "t_files");
        for (const level of await readdir(root)) {
          // Level folders are numbers; libvips also leaves a properties file here.
          if (!/^\d+$/.test(level) || Number(level) < minLevel) continue;
          for (const name of await readdir(join(root, level))) files.push(`${level}/${name}`);
        }
        return { width, height, minLevel, maxLevel, text, files };
      } finally {
        page.close();
      }
    },

    close() {
      document?.destroy();
      document = undefined;
      library = undefined;
    },
  };
}

// --- As a worker thread ------------------------------------------------------
//
// Questions come one at a time: { open: Uint8Array } then { draw, directory }.
// Each gets { ok: value } or { failed: message }. "ready" says the libraries
// loaded: a worker that dies before saying it could not be started at all.

if (parentPort && workerData?.planPages) {
  const port = parentPort;
  const reader = pdfReader();
  port.on(
    "message",
    async (/** @type {{ open?: Uint8Array; draw?: number; directory?: string }} */ question) => {
      try {
        const ok =
          question.open !== undefined
            ? await reader.open(question.open)
            : await reader.draw(question.draw ?? 0, question.directory ?? "");
        port.postMessage({ ok });
      } catch (error) {
        port.postMessage({ failed: error instanceof Error ? error.message : String(error) });
      }
    },
  );
  port.postMessage("ready");
}
