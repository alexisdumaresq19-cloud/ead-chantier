import { and, asc, desc, eq, inArray, isNull, lt, ne, sql as raw } from "drizzle-orm";

import { sheetNumberKey, type PlanImportSummary } from "@/shared/plans";

import type { SessionUser } from "../auth";
import { db, schema } from "../db/client";
import { badRequest, notFound } from "../http";
import { newId, newPublicKey } from "../ids";
import { storage } from "../storage";
import { discardUpload, type Upload } from "../uploads";
import { lockPlanNames } from "./lock";
import { sheetsByNumber } from "./queries";
import {
  openPlanPdf,
  PAGE_FAILED,
  PageFailure,
  PDF_TOO_SLOW,
  PDF_UNREADABLE,
  TILE_OVERLAP,
  TILE_SIZE,
  UnreadablePdf,
  type PlanPdf,
  type RenderedPage,
} from "./render";
import { suggestSheetName } from "./suggest";
import { pageTurns, type Turn } from "./turns";

// Bringing a PDF of plans in. The PDF is read, then each page is drawn and
// cut into tiles ("processing"); the office checks the sheet names
// ("review") and publishes. Until then the site sees nothing new.
//
// The work is done by short-lived workers, started after an answer by the
// requests that look at the import. Any number may be started: each admits
// itself in the database before it downloads anything. One reads the PDF
// (a lease on the reading), and at most MAX_WORKERS draw pages at once (a
// claim per page, under a lock on the import). Within one server process,
// workers of all imports also wait for one of its few PDFiums (pageTurns)
// before they take anything. A worker that dies loses nothing: its page or
// its reading is taken again after a few minutes, and given up the second
// time.

type Import = typeof schema.planImports.$inferSelect;
type Revision = typeof schema.sheetRevisions.$inferSelect;
type Executor = Pick<typeof db, "execute">;

/**
 * How long a worker keeps taking new pages. Its last page may still take
 * PAGE_TIME_LIMIT_MS (90 s) to draw, then its tiles have to be sent: all of
 * it within the routes' 300 s.
 */
const WORKER_BUDGET_MS = Number(process.env.PLAN_WORKER_BUDGET_MS ?? 150_000);
/** A page in progress, or a reading, older than this was abandoned by its worker. */
export const STALE_MS = 5 * 60_000;
export const MAX_WORKERS = 3;
/** A page taken this many times without coming out is given up. */
export const MAX_ATTEMPTS = 2;
/** A plan set is a few dozen sheets; a PDF over this is refused. */
export const MAX_PAGES = 500;
const UPLOADS_AT_ONCE = 16;
/** Imports with a worker of this process waiting for a turn to draw (see pageTurns). */
const waitingImports = new Set<string>();

const NO_PAGE = "Ce PDF ne contient aucune page.";
const READING_FAILED = "Ce PDF n'a pas pu être lu. Réessayez dans un moment.";
const READING_STOPPED = "La lecture de ce PDF a été interrompue deux fois.";
const READING_GIVEN_UP =
  "La lecture de ce PDF a été interrompue trois fois. Essayez de l'exporter de nouveau, ou divisez-le en plusieurs PDF.";
const GIVEN_UP = "Cette page n'a pas pu être convertie après deux essais.";
export const tooManyPages = (pageCount: number) =>
  `Ce PDF compte ${pageCount} pages, la limite est de ${MAX_PAGES}. Divisez-le en plusieurs PDF, puis importez-les un à un.`;

/** What reading the same file again would only repeat. */
const readingIsFinal = (error: string | null) =>
  error === PDF_UNREADABLE ||
  error === PDF_TOO_SLOW ||
  error === NO_PAGE ||
  error === READING_GIVEN_UP ||
  (error?.startsWith("Ce PDF compte ") ?? false);

/** A refusal of the PDF itself, in words fit for the office. */
class RefusedPdf extends Error {}

/**
 * Starts the import of an uploaded PDF. One import per PDF sent: asked twice
 * (the answer was lost on a bad connection and the app tried again), the
 * second request finds the import the first one started.
 */
export async function createImport(
  user: SessionUser,
  upload: Upload,
  options: { folderId?: string | null; revisionLabel?: string | null; issuedOn?: string | null },
): Promise<Import> {
  return db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ status: schema.uploads.status })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, upload.id))
      .for("update");
    const [existing] = await tx
      .select()
      .from(schema.planImports)
      .where(eq(schema.planImports.uploadId, upload.id))
      .limit(1);
    if (existing) return existing;
    // Looked at again under the lock: the PDF of an import cancelled
    // meanwhile has been discarded, and starts nothing.
    if (taken?.status !== "complete") throw badRequest("Le téléversement n'est pas terminé.");
    const [created] = await tx
      .insert(schema.planImports)
      .values({
        id: newId(),
        projectId: upload.projectId!,
        uploadId: upload.id,
        filename: upload.filename,
        folderId: options.folderId ?? null,
        revisionLabel: options.revisionLabel || null,
        issuedOn: options.issuedOn || null,
        createdBy: user.id,
      })
      .returning();
    return created;
  });
}

// --- Admitting workers ------------------------------------------------------

/** No reader holds the reading: none started yet, or the last one was not heard of again. */
const readingFree = raw<boolean>`(${schema.planImports.readingStartedAt} is null or ${schema.planImports.readingStartedAt} < now() - make_interval(secs => ${STALE_MS / 1000}))`;

/**
 * True if a worker should be started for this import. A guess that may race
 * with another request: the worker admits itself again, in the database.
 */
export async function needsWorker(importId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: schema.planImports.status, readingFree })
    .from(schema.planImports)
    .where(eq(schema.planImports.id, importId))
    .limit(1);
  if (row?.status === "reading") return row.readingFree;
  if (row?.status !== "processing") return false;
  await removeTiles(await requeueStale(db, importId));
  const [counts] = await db
    .select({
      queued: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} = 'queued')::int`,
      active: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} = 'processing')::int`,
    })
    .from(schema.sheetRevisions)
    .where(eq(schema.sheetRevisions.importId, importId));
  if (counts.queued === 0) {
    if (counts.active === 0) await finishIfDone(importId);
    return false;
  }
  return counts.active < MAX_WORKERS;
}

/**
 * Takes the reading of the PDF for one worker, or answers null when another
 * holds it. A reader that was never heard of again was stopped with its
 * server (a deployment, its memory, its time). Once is bad luck; the second
 * time, the PDF is what stops it, and the import fails. A person may try it
 * once more (retryFailedPages); stopped again, it is final.
 *
 * While reading, the error column holds what the import ends with if this
 * reader is stopped too: nobody sees it before.
 */
async function takeReading(importId: string): Promise<Import | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ current: schema.planImports, readingFree })
      .from(schema.planImports)
      .where(eq(schema.planImports.id, importId))
      .for("update");
    if (row?.current.status !== "reading" || !row.readingFree) return null;
    const interrupted = row.current.readingStartedAt !== null;
    const { error } = row.current;
    if (interrupted && (error === READING_STOPPED || error === READING_GIVEN_UP)) {
      await tx
        .update(schema.planImports)
        .set({ status: "failed" })
        .where(eq(schema.planImports.id, importId));
      return null;
    }
    const [taken] = await tx
      .update(schema.planImports)
      .set({
        readingStartedAt: raw`now()`,
        error: interrupted ? READING_STOPPED : error === READING_GIVEN_UP ? error : null,
      })
      .where(eq(schema.planImports.id, importId))
      .returning();
    return taken;
  });
}

/**
 * Pages whose worker was not heard of again go back in the queue, or are
 * given up once taken MAX_ATTEMPTS times. Answers the tile folders that
 * worker may have begun, to be removed.
 */
async function requeueStale(executor: Executor, importId: string) {
  const rows = await executor.execute<{ tileKey: string | null }>(raw`
    with stale as (
      select id, tile_key from sheet_revisions
      where import_id = ${importId} and status = 'processing'
        and started_at < now() - make_interval(secs => ${STALE_MS / 1000})
      for update
    )
    update sheet_revisions page set
      status = case when page.attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end,
      error = case when page.attempts >= ${MAX_ATTEMPTS} then ${GIVEN_UP} else null end,
      started_at = null,
      tile_key = null
    from stale where page.id = stale.id
    returning stale.tile_key as "tileKey"`);
  return [...rows];
}

/**
 * Takes the next waiting page for a worker, or null when none is left or
 * MAX_WORKERS pages are already being drawn. The import is locked meanwhile,
 * so claims made together count each other.
 */
async function claimPage(importId: string): Promise<Revision | null> {
  const { revision, leftovers } = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: schema.planImports.status })
      .from(schema.planImports)
      .where(eq(schema.planImports.id, importId))
      .for("update");
    if (current?.status !== "processing") return { revision: null, leftovers: [] };
    const leftovers = await requeueStale(tx, importId);
    const [{ active }] = await tx
      .select({ active: raw<number>`count(*)::int` })
      .from(schema.sheetRevisions)
      .where(
        and(
          eq(schema.sheetRevisions.importId, importId),
          eq(schema.sheetRevisions.status, "processing"),
        ),
      );
    if (active >= MAX_WORKERS) return { revision: null, leftovers };
    const [next] = await tx
      .select({ id: schema.sheetRevisions.id })
      .from(schema.sheetRevisions)
      .where(
        and(
          eq(schema.sheetRevisions.importId, importId),
          eq(schema.sheetRevisions.status, "queued"),
        ),
      )
      .orderBy(asc(schema.sheetRevisions.pageIndex))
      .limit(1);
    if (!next) return { revision: null, leftovers };
    const [revision] = await tx
      .update(schema.sheetRevisions)
      .set({
        status: "processing",
        startedAt: raw`now()`,
        attempts: raw`${schema.sheetRevisions.attempts} + 1`,
        error: null,
      })
      .where(eq(schema.sheetRevisions.id, next.id))
      .returning();
    return { revision, leftovers };
  });
  await removeTiles(leftovers);
  return revision;
}

/**
 * Once no page is waiting: on to review, or failed if not one page came out.
 * The pages are counted under the import's lock, which retryFailedPages also
 * takes: pages it puts back in the queue are seen, and keep the import going.
 * (One update with the count in its condition would not do: waiting for the
 * lock, it would still count the pages as they were before it waited.)
 */
async function finishIfDone(importId: string) {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: schema.planImports.status })
      .from(schema.planImports)
      .where(eq(schema.planImports.id, importId))
      .for("update");
    if (current?.status !== "processing") return;
    const [counts] = await tx
      .select({
        pending: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} in ('queued', 'processing'))::int`,
        ready: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} = 'ready')::int`,
      })
      .from(schema.sheetRevisions)
      .where(eq(schema.sheetRevisions.importId, importId));
    if (counts.pending > 0) return;
    await tx
      .update(schema.planImports)
      .set(
        counts.ready > 0
          ? { status: "review", error: null }
          : { status: "failed", error: "Aucune page de ce PDF n'a pu être convertie." },
      )
      .where(eq(schema.planImports.id, importId));
  });
}

/** Whether trying again could help: what failed has not been tried enough yet. */
export function canRetry(current: Import, pages: Revision[]): boolean {
  if (current.pageCount === null)
    return current.status === "failed" && !readingIsFinal(current.error);
  return pages.some((page) => page.status === "failed" && page.attempts < MAX_ATTEMPTS);
}

/**
 * Puts what failed back in the queue, for one more try: the reading of the
 * PDF when it failed for a reason that may pass, else the pages that failed
 * fewer than MAX_ATTEMPTS times. Starting a worker is up to the caller.
 */
export async function retryFailedPages(importId: string) {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.planImports)
      .where(eq(schema.planImports.id, importId))
      .for("update");
    if (!current) throw notFound("Import introuvable.");
    if (current.status === "published") throw badRequest("Cet import est déjà publié.");
    if (current.pageCount === null) {
      // Still being read: there is nothing to try again yet.
      if (current.status !== "failed") return;
      if (readingIsFinal(current.error))
        throw badRequest(
          "Ce PDF ne peut pas être converti. Annulez cet import, puis envoyez un autre fichier.",
        );
      await tx
        .update(schema.planImports)
        .set({
          status: "reading",
          // After two readings stopped, this one is the last (see takeReading).
          error: current.error === READING_STOPPED ? READING_GIVEN_UP : null,
          readingStartedAt: null,
        })
        .where(eq(schema.planImports.id, importId));
      return;
    }
    const retried = await tx
      .update(schema.sheetRevisions)
      .set({ status: "queued", error: null, startedAt: null })
      .where(
        and(
          eq(schema.sheetRevisions.importId, importId),
          eq(schema.sheetRevisions.status, "failed"),
          lt(schema.sheetRevisions.attempts, MAX_ATTEMPTS),
        ),
      )
      .returning({ id: schema.sheetRevisions.id });
    if (!retried.length) {
      if (current.status !== "review" && current.status !== "failed") return;
      const [failed] = await tx
        .select({ id: schema.sheetRevisions.id })
        .from(schema.sheetRevisions)
        .where(
          and(
            eq(schema.sheetRevisions.importId, importId),
            eq(schema.sheetRevisions.status, "failed"),
          ),
        )
        .limit(1);
      throw badRequest(
        failed
          ? "Ces pages ont déjà été essayées deux fois. Publiez les autres, ou annulez l'import."
          : "Aucune page à réessayer.",
      );
    }
    await tx
      .update(schema.planImports)
      .set({ status: "processing", error: null })
      .where(eq(schema.planImports.id, importId));
  });
}

// --- A worker ---------------------------------------------------------------

/**
 * One worker: reads the PDF if that is still to do, then draws pages until
 * none is left or its time is up. Safe to start any number of times.
 */
export async function runImportWorker(importId: string): Promise<void> {
  const startedAt = Date.now();
  let pdf: PlanPdf | undefined;
  let turn: Turn | null = null;
  // Waits for a PDFium of this process before anything is taken in the
  // database: a worker that waits holds no page and no reading, so waiting
  // costs no attempt, and what it leaves is taken by a later worker.
  const waitTurn = async () => {
    turn = pageTurns.tryTake();
    // Requests keep starting workers while pages wait: one waiting per import is enough.
    if (turn || waitingImports.has(importId)) return turn;
    waitingImports.add(importId);
    try {
      turn = await pageTurns.take(WORKER_BUDGET_MS - (Date.now() - startedAt));
      return turn;
    } finally {
      waitingImports.delete(importId);
    }
  };
  const load = async () =>
    (
      await db.select().from(schema.planImports).where(eq(schema.planImports.id, importId)).limit(1)
    )[0];
  try {
    let current = await load();
    if (current?.status === "reading") {
      if (!(await waitTurn())) return;
      const taken = await takeReading(importId);
      if (!taken) {
        // Read by another meanwhile, perhaps while this one waited for its
        // turn: its pages may be waiting, left to this worker by the others.
        current = await load();
      } else {
        current = taken;
        try {
          pdf = await openImportPdf(current);
          await listPages(current, pdf.pageCount);
        } catch (error) {
          // Whatever went wrong, the import does not stay "reading".
          if (!(error instanceof UnreadablePdf || error instanceof RefusedPdf))
            console.error("plan import: reading failed", importId, error);
          await db
            .update(schema.planImports)
            .set({
              status: "failed",
              error:
                error instanceof UnreadablePdf || error instanceof RefusedPdf
                  ? error.message
                  : READING_FAILED,
            })
            .where(
              and(eq(schema.planImports.id, importId), eq(schema.planImports.status, "reading")),
            );
          return;
        }
      }
    }
    // Pages to draw: listed just now by this worker, or earlier.
    if (!current || (!pdf && current.status !== "processing")) return;

    while (Date.now() - startedAt < WORKER_BUDGET_MS) {
      if (!turn && !(await waitTurn())) break;
      const revision = await claimPage(importId);
      if (!revision) break;
      try {
        // Only now that a page is ours: a worker with nothing to do downloads nothing.
        pdf ??= await openImportPdf(current);
      } catch (error) {
        console.error("plan import: PDF not opened again", importId, error);
        await db
          .update(schema.sheetRevisions)
          .set({ status: "failed", error: PAGE_FAILED })
          .where(eq(schema.sheetRevisions.id, revision.id));
        break;
      }
      await processPage(current, revision, pdf);
      if ([...waitingImports].some((other) => other !== importId)) {
        // Another import waits for a PDFium: this one goes, with its memory,
        // and this worker gets in line again. The turn is handed back
        // whatever closing does: after a page that broke PDFium, closing
        // throws, and a turn kept would be lost for the life of the process.
        const closing = pdf;
        pdf = undefined;
        try {
          await closing.close();
        } finally {
          releaseTurn();
        }
      }
    }
    await finishIfDone(importId);
  } finally {
    try {
      await pdf?.close();
    } finally {
      releaseTurn();
    }
  }

  function releaseTurn() {
    turn?.release();
    turn = null;
  }
}

async function openImportPdf(current: Import): Promise<PlanPdf> {
  const [upload] = await db
    .select({ storageKey: schema.uploads.storageKey })
    .from(schema.uploads)
    .where(eq(schema.uploads.id, current.uploadId))
    .limit(1);
  if (!upload) throw new Error("The import's upload is gone");
  return openPlanPdf(await storage().get("private", upload.storageKey));
}

/** Creates one waiting page per page of the PDF, exactly once. */
async function listPages(current: Import, pageCount: number) {
  if (pageCount === 0) throw new RefusedPdf(NO_PAGE);
  if (pageCount > MAX_PAGES) throw new RefusedPdf(tooManyPages(pageCount));
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(schema.planImports)
      .set({ status: "processing", pageCount, error: null })
      .where(and(eq(schema.planImports.id, current.id), eq(schema.planImports.status, "reading")))
      .returning({ id: schema.planImports.id });
    if (!moved.length) return; // cancelled meanwhile
    await tx.insert(schema.sheetRevisions).values(
      Array.from({ length: pageCount }, (_, pageIndex) => ({
        id: newId(),
        projectId: current.projectId,
        importId: current.id,
        pageIndex,
        label: current.revisionLabel,
        issuedOn: current.issuedOn,
        createdBy: current.createdBy,
      })),
    );
  });
}

/** Draws a page this worker claimed. Never throws: a page that fails is marked so. */
async function processPage(current: Import, revision: Revision, pdf: PlanPdf) {
  // Still this worker's: not cancelled, nor given up and taken by another.
  const ours = and(
    eq(schema.sheetRevisions.id, revision.id),
    eq(schema.sheetRevisions.status, "processing"),
    eq(schema.sheetRevisions.attempts, revision.attempts),
  );
  const tileKey = newPublicKey("t");
  // Where the tiles go is written down before the first is sent, so that
  // they are removed whatever happens to this page or to its import.
  const marked = await db
    .update(schema.sheetRevisions)
    .set({ tileKey })
    .where(ours)
    .returning({ id: schema.sheetRevisions.id });
  if (!marked.length) return;

  let rendered: RenderedPage | undefined;
  try {
    rendered = await pdf.render(revision.pageIndex);
    const store = storage();
    const queue = [...rendered.files];
    // Every sender has stopped before a failure is reported: a tile still
    // on its way would land after the folder was removed, and stay.
    const sent = await Promise.allSettled(
      Array.from({ length: UPLOADS_AT_ONCE }, async () => {
        for (let file = queue.pop(); file; file = queue.pop()) {
          try {
            await store.put("public", `${tileKey}/${file.path}`, await file.data(), {
              contentType: "image/webp",
              immutable: true,
            });
          } catch (error) {
            queue.length = 0;
            throw error;
          }
        }
      }),
    );
    const refused = sent.find((result) => result.status === "rejected");
    if (refused) throw refused.reason;
    await store.put("public", `${tileKey}/thumb.webp`, rendered.thumb, {
      contentType: "image/webp",
      immutable: true,
    });

    const name = suggestSheetName(rendered.text, revision.pageIndex, current.filename);
    const match = (await sheetsByNumber(current.projectId)).get(sheetNumberKey(name.number));

    const saved = await db
      .update(schema.sheetRevisions)
      .set({
        status: "ready",
        readyAt: new Date(),
        width: rendered.width,
        height: rendered.height,
        tileSize: TILE_SIZE,
        tileOverlap: TILE_OVERLAP,
        text: rendered.text.replace(/\u0000/g, "").slice(0, 200_000),
        draftNumber: name.number,
        draftTitle: name.title,
        draftSheetId: match?.id ?? null,
      })
      .where(ours)
      .returning({ id: schema.sheetRevisions.id });
    // The import was cancelled while this page was being drawn.
    if (!saved.length) await removeTiles([{ tileKey }]);
  } catch (error) {
    if (!(error instanceof PageFailure))
      console.error("plan import: page failed", current.id, revision.pageIndex, error);
    await removeTiles([{ tileKey }]);
    await db
      .update(schema.sheetRevisions)
      .set({
        status: "failed",
        error: error instanceof PageFailure ? error.message : PAGE_FAILED,
        tileKey: null,
      })
      .where(ours);
  } finally {
    await rendered?.dispose();
  }
}

// --- Review and publication -------------------------------------------------

/** The imports of a project that are not published yet, newest first. */
export async function pendingImports(projectId: string): Promise<PlanImportSummary[]> {
  const rows = await db
    .select()
    .from(schema.planImports)
    .where(
      and(eq(schema.planImports.projectId, projectId), ne(schema.planImports.status, "published")),
    )
    .orderBy(desc(schema.planImports.createdAt));
  if (!rows.length) return [];
  const counts = await db
    .select({
      importId: schema.sheetRevisions.importId,
      ready: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} = 'ready')::int`,
      failed: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} = 'failed')::int`,
    })
    .from(schema.sheetRevisions)
    .where(
      inArray(
        schema.sheetRevisions.importId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(schema.sheetRevisions.importId);
  const byImport = new Map(counts.map((count) => [count.importId, count]));
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    status: row.status,
    error: row.error,
    pageCount: row.pageCount,
    readyCount: byImport.get(row.id)?.ready ?? 0,
    failedCount: byImport.get(row.id)?.failed ?? 0,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function importWithPages(
  importId: string,
): Promise<{ current: Import; pages: Revision[] }> {
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, importId))
    .limit(1);
  if (!current) throw notFound("Import introuvable.");
  const pages = await db
    .select()
    .from(schema.sheetRevisions)
    .where(eq(schema.sheetRevisions.importId, importId))
    .orderBy(asc(schema.sheetRevisions.pageIndex));
  return { current, pages };
}

export type PageDraft = {
  id: string;
  draftNumber?: string;
  draftTitle?: string;
  draftSkip?: boolean;
};

/**
 * Saves what the office corrects on the pages of an import. A corrected
 * number is matched again with the project's sheets.
 */
export async function saveDrafts(current: Import, drafts: PageDraft[]) {
  const sheets = drafts.some((draft) => draft.draftNumber !== undefined)
    ? await sheetsByNumber(current.projectId)
    : null;
  for (const { id, ...draft } of drafts) {
    if (!Object.keys(draft).length) continue;
    await db
      .update(schema.sheetRevisions)
      .set(
        draft.draftNumber === undefined
          ? draft
          : {
              ...draft,
              draftSheetId: sheets?.get(sheetNumberKey(draft.draftNumber))?.id ?? null,
            },
      )
      .where(
        and(
          eq(schema.sheetRevisions.id, id),
          eq(schema.sheetRevisions.importId, current.id),
          isNull(schema.sheetRevisions.sheetId),
        ),
      );
  }
}

/**
 * Publishes a checked import: each page becomes a new sheet, or the new
 * current revision of the sheet that carries its number. All or nothing.
 */
export async function publishImport(
  user: SessionUser,
  importId: string,
): Promise<{ sheetIds: string[] }> {
  const { current, pages } = await importWithPages(importId);
  if (current.status !== "review") throw badRequest("Cet import n'est pas prêt à être publié.");
  const kept = pages.filter((page) => !page.draftSkip && page.status === "ready");
  if (!kept.length) throw badRequest("Aucune feuille à publier.");

  const numbers = new Set<string>();
  for (const page of kept) {
    const number = page.draftNumber?.trim();
    if (!number) throw badRequest(`La page ${page.pageIndex + 1} n'a pas de numéro de feuille.`);
    const key = sheetNumberKey(number);
    if (numbers.has(key))
      throw badRequest(`Deux pages portent le numéro ${number}. Corrigez-en une.`);
    numbers.add(key);
  }

  const sheetIds: string[] = [];
  await db.transaction(async (tx) => {
    // One publication at a time per project: two imports of the same set
    // published together must end up as revisions of the same sheets.
    await lockPlanNames(tx, current.projectId);
    const claimed = await tx
      .update(schema.planImports)
      .set({ status: "published", publishedAt: new Date() })
      .where(and(eq(schema.planImports.id, current.id), eq(schema.planImports.status, "review")))
      .returning({ id: schema.planImports.id });
    if (!claimed.length) throw badRequest("Cet import a déjà été publié ou annulé.");

    const existing = await sheetsByNumber(current.projectId, tx);
    const [{ next }] = await tx
      .select({ next: raw<number>`coalesce(max(${schema.sheets.sort}), 0)::int` })
      .from(schema.sheets)
      .where(eq(schema.sheets.projectId, current.projectId));
    let sort = next;
    for (const page of kept) {
      const number = page.draftNumber!.trim();
      const title = page.draftTitle?.trim() ?? "";
      let sheetId = existing.get(sheetNumberKey(number))?.id;
      if (sheetId) {
        await tx
          .update(schema.sheets)
          .set({ currentRevisionId: page.id, ...(title ? { title } : {}) })
          .where(eq(schema.sheets.id, sheetId));
      } else {
        sheetId = newId();
        await tx.insert(schema.sheets).values({
          id: sheetId,
          projectId: current.projectId,
          folderId: current.folderId,
          number,
          title,
          sort: ++sort,
          currentRevisionId: page.id,
          createdBy: user.id,
        });
      }
      await tx
        .update(schema.sheetRevisions)
        .set({ sheetId, label: current.revisionLabel, issuedOn: current.issuedOn })
        .where(eq(schema.sheetRevisions.id, page.id));
      sheetIds.push(sheetId);
    }
  });

  // Pages left out were never shown to anyone: their images can go.
  await discardPages(pages.filter((page) => page.draftSkip || page.status !== "ready"));
  return { sheetIds };
}

/** Abandons an import that was not published, with its images and its PDF. */
export async function cancelImport(importId: string) {
  const { pages, uploadId } = await db.transaction(async (tx) => {
    // The import is locked first: a publication under way finishes before
    // this looks at it, and its pages are then no longer there to take.
    const [current] = await tx
      .select()
      .from(schema.planImports)
      .where(eq(schema.planImports.id, importId))
      .for("update");
    if (!current) throw notFound("Import introuvable.");
    if (current.status === "published") throw badRequest("Cet import est déjà publié.");
    const pages = await tx
      .delete(schema.sheetRevisions)
      .where(
        and(eq(schema.sheetRevisions.importId, importId), isNull(schema.sheetRevisions.sheetId)),
      )
      .returning({ tileKey: schema.sheetRevisions.tileKey });
    // The PDF's upload is locked and marked unfinished in this same
    // transaction: a create request for it arriving at this moment (a
    // repeated tap, a retry) waits on the lock, then finds an upload it may
    // not use, instead of bringing the cancelled import back.
    await tx
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, current.uploadId))
      .for("update");
    await tx
      .update(schema.uploads)
      .set({ status: "pending" })
      .where(eq(schema.uploads.id, current.uploadId));
    await tx.delete(schema.planImports).where(eq(schema.planImports.id, importId));
    return { pages, uploadId: current.uploadId };
  });
  await removeTiles(pages);
  // The PDF was sent for this import alone. The import's row is gone first:
  // the upload's row takes with it whatever still refers to it.
  await discardUpload(uploadId).catch((error) =>
    console.error("plan import: PDF of a cancelled import not removed", importId, error),
  );
}

/** Removes pages that belong to no sheet, with their images. */
async function discardPages(pages: Revision[]) {
  if (!pages.length) return;
  const removed = await db
    .delete(schema.sheetRevisions)
    .where(
      and(
        inArray(
          schema.sheetRevisions.id,
          pages.map((page) => page.id),
        ),
        isNull(schema.sheetRevisions.sheetId),
      ),
    )
    .returning({ tileKey: schema.sheetRevisions.tileKey });
  await removeTiles(removed);
}

async function removeTiles(pages: { tileKey: string | null }[]) {
  for (const { tileKey } of pages) {
    if (tileKey)
      await storage()
        .removePrefix("public", tileKey)
        .catch((error) => console.error("plan import: tiles not removed", tileKey, error));
  }
}
