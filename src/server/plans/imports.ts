import { and, asc, eq, isNull, lt, sql as raw } from "drizzle-orm";

import type { SessionUser } from "../auth";
import { db, schema, sql } from "../db/client";
import { badRequest, notFound } from "../http";
import { newId, newPublicKey } from "../ids";
import { storage } from "../storage";
import type { Upload } from "../uploads";
import { openPdf, renderPage, TILE_OVERLAP, TILE_SIZE } from "./render";
import { sheetNumberKey, suggestSheetName } from "./suggest";

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

export async function createImport(
  user: SessionUser,
  upload: Upload,
  options: { folderId?: string | null; revisionLabel?: string | null; issuedOn?: string | null },
): Promise<Import> {
  const [created] = await db
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
    const existing = await db
      .select({ id: schema.sheets.id, number: schema.sheets.number })
      .from(schema.sheets)
      .where(and(eq(schema.sheets.projectId, current.projectId), isNull(schema.sheets.archivedAt)));
    const match = existing.find(
      (sheet) => sheetNumberKey(sheet.number) === sheetNumberKey(name.number),
    );

    await db
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
      .where(eq(schema.sheetRevisions.id, revision.id));
  } finally {
    await rendered.dispose();
  }
}

// --- Review and publication -------------------------------------------------

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

/**
 * Publishes a checked import: each page becomes a new sheet, or the new
 * current revision of the sheet it replaces. All or nothing.
 */
export async function publishImport(
  user: SessionUser,
  importId: string,
): Promise<{ sheetIds: string[] }> {
  const { current, pages } = await importWithPages(importId);
  if (current.status !== "review") throw badRequest("Cet import n'est pas prêt à être publié.");
  const kept = pages.filter((page) => !page.draftSkip && page.status === "ready");
  if (!kept.length) throw badRequest("Aucune feuille à publier.");

  const fresh = kept.filter((page) => !page.draftSheetId);
  for (const page of fresh) {
    if (!page.draftNumber?.trim())
      throw badRequest(`La page ${page.pageIndex + 1} n'a pas de numéro de feuille.`);
  }
  const numbers = new Set<string>();
  for (const page of fresh) {
    const key = sheetNumberKey(page.draftNumber!);
    if (numbers.has(key))
      throw badRequest(`Deux feuilles portent le numéro ${page.draftNumber}. Corrigez-en une.`);
    numbers.add(key);
  }
  const replaced = new Set<string>();
  for (const page of kept) {
    if (!page.draftSheetId) continue;
    if (replaced.has(page.draftSheetId))
      throw badRequest("Deux pages remplacent la même feuille. Corrigez-en une.");
    replaced.add(page.draftSheetId);
  }

  const sheetIds: string[] = [];
  await db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: raw<number>`coalesce(max(${schema.sheets.sort}), 0)::int` })
      .from(schema.sheets)
      .where(eq(schema.sheets.projectId, current.projectId));
    let sort = next;
    for (const page of kept) {
      let sheetId = page.draftSheetId;
      if (sheetId) {
        const [sheet] = await tx
          .select()
          .from(schema.sheets)
          .where(and(eq(schema.sheets.id, sheetId), eq(schema.sheets.projectId, current.projectId)))
          .limit(1);
        if (!sheet)
          throw badRequest(
            `La feuille à remplacer par la page ${page.pageIndex + 1} n'existe plus.`,
          );
        await tx
          .update(schema.sheets)
          .set({
            currentRevisionId: page.id,
            archivedAt: null,
            ...(page.draftTitle?.trim() ? { title: page.draftTitle.trim() } : {}),
          })
          .where(eq(schema.sheets.id, sheetId));
      } else {
        sheetId = newId();
        await tx.insert(schema.sheets).values({
          id: sheetId,
          projectId: current.projectId,
          folderId: current.folderId,
          number: page.draftNumber!.trim(),
          title: page.draftTitle?.trim() ?? "",
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
    await tx
      .update(schema.planImports)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(schema.planImports.id, current.id));
  });

  // Pages left out were never shown to anyone: their images can go.
  await discardPages(pages.filter((page) => page.draftSkip || page.status !== "ready"));
  return { sheetIds };
}

/** Abandons an import that was not published, with its images. */
export async function cancelImport(importId: string) {
  const { current, pages } = await importWithPages(importId);
  if (current.status === "published") throw badRequest("Cet import est déjà publié.");
  await db.delete(schema.planImports).where(eq(schema.planImports.id, importId));
  await discardPages(pages);
}

async function discardPages(pages: Revision[]) {
  for (const page of pages) {
    if (page.sheetId) continue;
    await db.delete(schema.sheetRevisions).where(eq(schema.sheetRevisions.id, page.id));
    if (page.tileKey)
      await storage()
        .removePrefix("public", page.tileKey)
        .catch(() => {});
  }
}
