import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { pdfReader, type DrawnPage } from "./page-drawing.mjs";

export { levelsFor, TILE_OVERLAP, TILE_SIZE } from "./page-drawing.mjs";

// The pages of a PDF of plans, drawn into tiles off the server's main
// thread. PDFium makes one synchronous WebAssembly call per page: a page
// built to draw for an hour, or to fill PDFium's 2 GB heap, would otherwise
// stop the server from answering anyone and leave a broken PDFium behind for
// every later import. Here each PDF gets a worker thread with its own
// PDFium, each page a time limit, and a worker that failed or ran out of
// time is terminated and never asked again.

/** A page that takes longer than this is given up. Far under the routes' 300 s. */
export const PAGE_TIME_LIMIT_MS = Number(process.env.PLAN_PAGE_TIME_LIMIT_MS ?? 90_000);
/** Starting a worker and loading PDFium takes well under a second. */
const START_TIME_LIMIT_MS = 30_000;

// The file itself, found from the project's folder: the same in
// development, after `next build`, under vitest and on Vercel (where it has
// to be in the function's trace). Its parts are joined at run time so that
// the bundler leaves it alone instead of making a copy of its own.
const WORKER_FILE = join(process.cwd(), ...["src", "server", "plans", "page-drawing.mjs"]);

export const PDF_UNREADABLE = "Ce PDF est illisible ou protégé par un mot de passe.";
export const PDF_TOO_SLOW = "La lecture de ce PDF prend trop de temps.";
export const PAGE_FAILED = "Cette page n'a pas pu être convertie.";
export const PAGE_TOO_SLOW =
  "Cette page n'a pas pu être convertie : elle demande trop de temps à dessiner.";

/** The PDF could not be opened; the message is fit for the office. */
export class UnreadablePdf extends Error {}

/** A page could not be drawn; the message is fit for the office. */
export class PageFailure extends Error {}

export type RenderedPage = Omit<DrawnPage, "files"> & {
  /** Tile files, as paths relative to the tile folder: "12/3_1.webp". */
  files: { path: string; data: () => Promise<Buffer> }[];
  thumb: Buffer;
  /** Deletes the temporary files. */
  dispose: () => Promise<void>;
};

export type PlanPdf = {
  pageCount: number;
  /** Throws a PageFailure when the page cannot be drawn. */
  render(pageIndex: number): Promise<RenderedPage>;
  close(): Promise<void>;
};

/** One PDFium with the PDF open in it, in a worker or, failing that, here. */
type Reader = {
  draw(pageIndex: number, directory: string): Promise<DrawnPage>;
  /** Throws it away: it is never asked again. */
  discard(): Promise<void>;
};

class TimedOut extends Error {}

/**
 * Asks a worker one question (none: waits for its "ready") and waits for its
 * answer, its end or the time limit.
 */
function ask<T>(worker: Worker, question: object | null, limitMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      finish();
    };
    const onMessage = (answer: { ok?: T; failed?: string }) =>
      settle(() =>
        answer.failed !== undefined ? reject(new Error(answer.failed)) : resolve(answer.ok as T),
      );
    const onError = (error: Error) => settle(() => reject(error));
    const onExit = (code: number) => settle(() => reject(new Error(`worker stopped (${code})`)));
    const timer = setTimeout(() => settle(() => reject(new TimedOut())), limitMs);
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    if (question) worker.postMessage(question);
  });
}

/** A worker thread whose libraries have loaded, or null if none can be started here. */
async function startWorker(): Promise<Worker | null> {
  let worker: Worker | undefined;
  try {
    const started = new Worker(WORKER_FILE, {
      workerData: { planPages: true },
    });
    worker = started;
    // An error outside a question has nobody to tell; the next question
    // finds the worker gone.
    started.on("error", () => {});
    await ask(started, null, START_TIME_LIMIT_MS);
    return started;
  } catch (error) {
    await worker?.terminate();
    console.warn("plan import: no page worker, drawing pages in the server itself", error);
    return null;
  }
}

/** Opens the PDF in a fresh PDFium. Throws UnreadablePdf if it cannot. */
async function openReader(data: Uint8Array): Promise<{ reader: Reader; pageCount: number }> {
  const worker = await startWorker();
  if (worker) {
    try {
      const pageCount = await ask<number>(worker, { open: data }, PAGE_TIME_LIMIT_MS);
      return {
        pageCount,
        reader: {
          draw: (pageIndex, directory) =>
            ask<DrawnPage>(worker, { draw: pageIndex, directory }, PAGE_TIME_LIMIT_MS),
          discard: async () => void (await worker.terminate()),
        },
      };
    } catch (error) {
      await worker.terminate();
      console.error("plan import: PDF not opened", error);
      throw new UnreadablePdf(error instanceof TimedOut ? PDF_TOO_SLOW : PDF_UNREADABLE);
    }
  }
  // Without a worker there is no time limit. PDFium is still never reused
  // after an error, so one bad PDF does not break the next imports.
  const local = pdfReader();
  try {
    const pageCount = await local.open(data);
    return { pageCount, reader: { draw: local.draw, discard: async () => local.close() } };
  } catch (error) {
    local.close();
    console.error("plan import: PDF not opened", error);
    throw new UnreadablePdf(PDF_UNREADABLE);
  }
}

/**
 * Opens a PDF for drawing its pages; throws UnreadablePdf if it cannot be
 * read. A page that fails takes its PDFium with it, and the next page gets a
 * new one with the PDF opened again.
 */
export async function openPlanPdf(file: Buffer): Promise<PlanPdf> {
  // Shared with the workers rather than copied into each.
  const data = new Uint8Array(new SharedArrayBuffer(file.length));
  data.set(file);
  const first = await openReader(data);
  let reader: Reader | null = first.reader;

  return {
    pageCount: first.pageCount,
    async render(pageIndex) {
      const directory = await mkdtemp(join(tmpdir(), "ead-plan-"));
      const dispose = () => rm(directory, { recursive: true, force: true });
      try {
        reader ??= (await openReader(data)).reader;
        const drawn = await reader.draw(pageIndex, directory);
        const root = join(directory, "t_files");
        return {
          ...drawn,
          files: drawn.files.map((path) => ({ path, data: () => readFile(join(root, path)) })),
          thumb: await readFile(join(directory, "thumb.webp")),
          dispose,
        };
      } catch (error) {
        console.error("plan import: page not drawn", pageIndex, error);
        await reader?.discard();
        reader = null;
        await dispose();
        throw new PageFailure(error instanceof TimedOut ? PAGE_TOO_SLOW : PAGE_FAILED);
      }
    },
    async close() {
      await reader?.discard();
      reader = null;
    },
  };
}
