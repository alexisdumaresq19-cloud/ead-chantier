import { and, asc, desc, eq, inArray, isNull, lt, ne, sql as raw } from "drizzle-orm";

import { sheetNumberKey, type PlanImportSummary } from "@/shared/plans";

import type { SessionUser } from "../auth";
import { db, schema, sql } from "../db/client";
import { badRequest, notFound } from "../http";
import { newId, newPublicKey } from "../ids";
import { storage } from "../storage";
import type { Upload } from "../uploads";
import { lockPlanNames } from "./lock";
import { sheetsByNumber } from "./queries";
import { openPdf, renderPage, TILE_OVERLAP, TILE_SIZE } from "./render";
import { suggestSheetName } from "./suggest";

// Bringing a PDF of plans in. The PDF is read, then each page is drawn and
// cut into tiles ("processing"); the office checks the sheet names
// ("review") and publishes. Until then the site sees nothing new.
//
// Pages are worked on by short-lived workers that each take the next page
// still waiting. Several can run at once, and one that dies loses nothing:
// its page goes back in the queue after a few minutes.

type Import = typeof schema.planImports.$inferSelect;
type Revision = typeof schema.sheetRevisions.$inferSelect;

/** How long a worker keeps taking pages before it lets another take over. */
const WORKER_BUDGET_MS = Number(process.env.PLAN_WORKER_BUDGET_MS ?? 240_000);
/** A page "in progress" for longer than this was abandoned by its worker. */
const STALE_MS = 5 * 60_000;
export const MAX_WORKERS = 3;
const UPLOADS_AT_ONCE = 16;

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
    await tx
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, upload.id))
      .for("update");
    const [existing] = await tx
      .select()
      .from(schema.planImports)
      .where(eq(schema.planImports.uploadId, upload.id))
      .limit(1);
    if (existing) return existing;
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

/** True if a worker should be started for this import. */
export async function needsWorker(importId: string): Promise<boolean> {
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, importId))
    .limit(1);
  if (!current || (current.status !== "reading" && current.status !== "processing")) return false;
  if (current.status === "reading") {
    // Reading is quick; only restart it if it clearly never finished.
    return Date.now() - current.createdAt.getTime() > 60_000;
  }
  await requeueStale(importId);
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

async function requeueStale(importId: string) {
  await db
    .update(schema.sheetRevisions)
    .set({ status: "queued", startedAt: null })
    .where(
      and(
        eq(schema.sheetRevisions.importId, importId),
        eq(schema.sheetRevisions.status, "processing"),
        lt(schema.sheetRevisions.startedAt, new Date(Date.now() - STALE_MS)),
      ),
    );
}

/** Once no page is waiting: on to review, or failed if not one page came out. */
async function finishIfDone(importId: string) {
  const [counts] = await db
    .select({
      pending: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} in ('queued', 'processing'))::int`,
      ready: raw<number>`count(*) filter (where ${schema.sheetRevisions.status} = 'ready')::int`,
    })
    .from(schema.sheetRevisions)
    .where(eq(schema.sheetRevisions.importId, importId));
  if (counts.pending > 0) return;
  await db
    .update(schema.planImports)
    .set(
      counts.ready > 0
        ? { status: "review", error: null }
        : { status: "failed", error: "Aucune page de ce PDF n'a pu être convertie." },
    )
    .where(and(eq(schema.planImports.id, importId), eq(schema.planImports.status, "processing")));
}

/** Puts the pages that failed back in the queue, for another try. */
export async function retryFailedPages(importId: string) {
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, importId))
    .limit(1);
  if (!current || current.status === "published")
    throw badRequest("Cet import ne peut pas être relancé.");
  const retried = await db
    .update(schema.sheetRevisions)
    .set({ status: "queued", error: null, startedAt: null })
    .where(
      and(eq(schema.sheetRevisions.importId, importId), eq(schema.sheetRevisions.status, "failed")),
    )
    .returning({ id: schema.sheetRevisions.id });
  if (retried.length || current.pageCount === null) {
    await db
      .update(schema.planImports)
      .set({ status: current.pageCount === null ? "reading" : "processing", error: null })
      .where(eq(schema.planImports.id, importId));
  }
}

/** Takes the next waiting page for this worker, or null when none is left. */
async function claimPage(importId: string): Promise<Revision | null> {
  const rows = await sql<{ id: string }[]>`
    update sheet_revisions set status = 'processing', started_at = now(), error = null
    where id = (
      select id from sheet_revisions
      where import_id = ${importId} and status = 'queued'
      order by page_index
      limit 1
      for update skip locked
    )
    returning id`;
  if (!rows.length) return null;
  const [revision] = await db
    .select()
    .from(schema.sheetRevisions)
    .where(eq(schema.sheetRevisions.id, rows[0].id));
  return revision ?? null;
}

/**
 * One worker: reads the PDF if that is not done yet, then draws pages until
 * none is left or its time is up. Safe to run several at once.
 */
export async function runImportWorker(importId: string): Promise<void> {
  const startedAt = Date.now();
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, importId))
    .limit(1);
  if (!current || (current.status !== "reading" && current.status !== "processing")) return;
  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(eq(schema.uploads.id, current.uploadId))
    .limit(1);
  if (!upload) return;

  let document: Awaited<ReturnType<typeof openPdf>>;
  try {
    document = await openPdf(await storage().get("private", upload.storageKey));
  } catch (error) {
    console.error("plan import: unreadable PDF", importId, error);
    await db
      .update(schema.planImports)
      .set({ status: "failed", error: "Ce PDF est illisible ou protégé par un mot de passe." })
      .where(eq(schema.planImports.id, importId));
    return;
  }

  try {
    if (current.status === "reading") await listPages(current, document.getPageCount());

    while (Date.now() - startedAt < WORKER_BUDGET_MS) {
      const revision = await claimPage(importId);
      if (!revision) break;
      try {
        await processPage(current, revision, document);
      } catch (error) {
        console.error("plan import: page failed", importId, revision.pageIndex, error);
        await db
          .update(schema.sheetRevisions)
          .set({ status: "failed", error: "Cette page n'a pas pu être convertie." })
          .where(eq(schema.sheetRevisions.id, revision.id));
      }
    }
    await finishIfDone(importId);
  } finally {
    document.destroy();
  }
}

/** Creates one waiting page per page of the PDF, exactly once. */
async function listPages(current: Import, pageCount: number) {
  if (pageCount === 0) {
    await db
      .update(schema.planImports)
      .set({ status: "failed", error: "Ce PDF ne contient aucune page." })
      .where(eq(schema.planImports.id, current.id));
    return;
  }
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(schema.planImports)
      .set({ status: "processing", pageCount })
      .where(and(eq(schema.planImports.id, current.id), eq(schema.planImports.status, "reading")))
      .returning({ id: schema.planImports.id });
    if (!moved.length) return; // another worker got here first
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

async function processPage(
  current: Import,
  revision: Revision,
  document: Awaited<ReturnType<typeof openPdf>>,
) {
  const rendered = await renderPage(document, revision.pageIndex);
  try {
    const tileKey = newPublicKey("t");
    const store = storage();
    const queue = [...rendered.files];
    await Promise.all(
      Array.from({ length: UPLOADS_AT_ONCE }, async () => {
        for (let file = queue.pop(); file; file = queue.pop()) {
          await store.put("public", `${tileKey}/${file.path}`, await file.data(), {
            contentType: "image/webp",
            immutable: true,
          });
        }
      }),
    );
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
        tileKey,
        width: rendered.width,
        height: rendered.height,
        tileSize: TILE_SIZE,
        tileOverlap: TILE_OVERLAP,
        text: rendered.text.replace(/\u0000/g, "").slice(0, 200_000),
        draftNumber: name.number,
        draftTitle: name.title,
        draftSheetId: match?.id ?? null,
      })
      .where(eq(schema.sheetRevisions.id, revision.id))
      .returning({ id: schema.sheetRevisions.id });
    // The import was cancelled while this page was being drawn.
    if (!saved.length) await store.removePrefix("public", tileKey).catch(() => {});
  } finally {
    await rendered.dispose();
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
  const { pages, upload } = await db.transaction(async (tx) => {
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
    // The PDF was sent for this import alone; the import goes with it.
    const [upload] = await tx
      .delete(schema.uploads)
      .where(eq(schema.uploads.id, current.uploadId))
      .returning({ storageKey: schema.uploads.storageKey });
    return { pages, upload };
  });
  await removeTiles(pages);
  if (upload) {
    const folder = upload.storageKey.slice(0, upload.storageKey.lastIndexOf("/"));
    await storage()
      .removePrefix("private", folder)
      .catch(() => {});
  }
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
        .catch(() => {});
  }
}
