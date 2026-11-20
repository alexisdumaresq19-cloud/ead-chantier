import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { PDFDocument, StandardFonts } from "pdf-lib";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The import of a PDF against a real database: workers started together,
// pages that keep failing, PDFs that cannot be imported. Run on a database
// of their own beside the one this checkout uses (the name followed by
// "_plans_vitest"), dropped at the end; skipped without a local Postgres.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the development default applies.
}
const configured = new URL(process.env.DATABASE_URL ?? "postgres://ead:ead@127.0.0.1:54329/ead");
const databaseName = `${configured.pathname.slice(1)}_plans_vitest`;
const serverUrl = Object.assign(new URL(configured), { pathname: "/postgres" }).href;
const databaseUrl = Object.assign(new URL(configured), { pathname: `/${databaseName}` }).href;

async function createDatabase(): Promise<boolean> {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(configured.hostname)) return false;
  const server = postgres(serverUrl, { max: 1, onnotice: () => {}, connect_timeout: 3 });
  try {
    await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await server.unsafe(`create database "${databaseName}"`);
  } catch {
    return false;
  } finally {
    await server.end();
  }
  const fresh = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(fresh), { migrationsFolder: "./drizzle" });
  await fresh.end();
  return true;
}

const ready = await createDatabase();
if (!ready) console.warn("imports.test.ts: no local Postgres answers, tests skipped.");
process.env.DATABASE_URL = databaseUrl;
const files = await mkdtemp(join(tmpdir(), "ead-plans-test-"));
process.env.STORAGE_DRIVER = "fs";
process.env.STORAGE_DIR = files;

// Counts what the workers do with PDFs: how many opened one, how many pages
// were drawn at the same moment, how many PDFiums were alive at once.
const drawing = vi.hoisted(() => ({ opened: 0, now: 0, most: 0, alive: 0, mostAlive: 0 }));
vi.mock("./render", async (original) => {
  const real = await original<typeof import("./render")>();
  return {
    ...real,
    openPlanPdf: async (file: Buffer) => {
      const pdf = await real.openPlanPdf(file);
      drawing.opened++;
      drawing.mostAlive = Math.max(drawing.mostAlive, ++drawing.alive);
      let closed = false;
      return {
        ...pdf,
        close: async () => {
          if (!closed) drawing.alive--;
          closed = true;
          await pdf.close();
        },
        render: async (pageIndex: number) => {
          drawing.most = Math.max(drawing.most, ++drawing.now);
          try {
            return await pdf.render(pageIndex);
          } finally {
            drawing.now--;
          }
        },
      };
    },
  };
});

const { db, schema, sql } = await import("../db/client");
const { storage } = await import("../storage");
const imports = await import("./imports");
const { importDto } = await import("./import-dto");
const { PDF_UNREADABLE } = await import("./render");
const { PAGES_AT_ONCE, pageTurns } = await import("./turns");

afterAll(async () => {
  await sql.end();
  await rm(files, { recursive: true, force: true });
  if (!ready) return;
  const server = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await server.end();
});

async function pdfOf(pageCount: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pageCount; i++) {
    const page = pdf.addPage([432, 288]);
    page.drawText(`FEUILLE C-${101 + i}`, { x: 250, y: 40, size: 12, font });
  }
  return Buffer.from(await pdf.save());
}

let serial = 0;
/** An import of this file, as POST /api/projects/:id/plan-imports leaves it. */
async function importOf(file: Buffer) {
  const id = `t${++serial}${Date.now().toString(36)}`;
  await db.insert(schema.users).values({ id: `u${id}`, name: "Julie Cyr", role: "contremaitre" });
  await db.insert(schema.projects).values({ id: `p${id}`, name: "Projet d'essai" });
  const storageKey = `u/up${id}/plans.pdf`;
  await storage().put("private", storageKey, file, { contentType: "application/pdf" });
  const [upload] = await db
    .insert(schema.uploads)
    .values({
      id: `up${id}`,
      projectId: `p${id}`,
      kind: "plan",
      storageKey,
      filename: "plans.pdf",
      contentType: "application/pdf",
      size: file.length,
      status: "complete",
      createdBy: `u${id}`,
    })
    .returning();
  const user = { id: `u${id}`, role: "contremaitre" } as Parameters<typeof imports.createImport>[0];
  return imports.createImport(user, upload, {});
}

const importRow = async (id: string) =>
  (await db.select().from(schema.planImports).where(eq(schema.planImports.id, id)))[0];
const pagesOf = (id: string) =>
  db.select().from(schema.sheetRevisions).where(eq(schema.sheetRevisions.importId, id));
/** "t/abc" of "t/abc/12/0_0.webp". */
const tilePrefix = (key: string) => key.split("/").slice(0, 2).join("/");
const publicFiles = async (prefix: string) =>
  readdir(join(files, "public", prefix), { recursive: true }).catch(() => []);

/**
 * A worker whose download of the PDF does not come back, as when its server
 * is stopped under it; `stop` ends it, once the import has moved on.
 */
function stalledReader(importId: string) {
  let fail!: (error: Error) => void;
  vi.spyOn(storage(), "get").mockImplementationOnce(
    () => new Promise((_, reject) => (fail = reject)),
  );
  const running = imports.runImportWorker(importId);
  return {
    stop: async () => {
      fail(new Error("server stopped"));
      await running;
    },
  };
}

beforeEach(() => {
  drawing.opened = drawing.most = drawing.mostAlive = 0;
  vi.restoreAllMocks();
});

describe.skipIf(!ready)("importing a PDF of plans", () => {
  it("reads the PDF once and draws at most three pages at a time, however many workers", async () => {
    const current = await importOf(await pdfOf(7));
    // Five requests start a worker together: one reads, the others leave.
    await Promise.all(Array.from({ length: 5 }, () => imports.runImportWorker(current.id)));
    expect(drawing.opened).toBe(1);

    // Pages put back in the queue, then six workers at once.
    await db
      .update(schema.sheetRevisions)
      .set({ status: "queued" })
      .where(eq(schema.sheetRevisions.importId, current.id));
    await db
      .update(schema.planImports)
      .set({ status: "processing" })
      .where(eq(schema.planImports.id, current.id));
    drawing.opened = drawing.most = 0;
    await Promise.all(Array.from({ length: 6 }, () => imports.runImportWorker(current.id)));
    expect(drawing.most).toBeLessThanOrEqual(imports.MAX_WORKERS);
    // Those turned away did not download the PDF.
    expect(drawing.opened).toBeLessThanOrEqual(imports.MAX_WORKERS);
    expect((await importRow(current.id)).status).toBe("review");
    expect((await pagesOf(current.id)).every((page) => page.status === "ready")).toBe(true);
  }, 60_000);

  it("starts no second reader while one holds the reading", async () => {
    const current = await importOf(await pdfOf(1));
    expect(await imports.needsWorker(current.id)).toBe(true);
    await db
      .update(schema.planImports)
      .set({ readingStartedAt: new Date() })
      .where(eq(schema.planImports.id, current.id));
    expect(await imports.needsWorker(current.id)).toBe(false);
    await imports.runImportWorker(current.id);
    expect(drawing.opened).toBe(0);

    // A reader not heard of for longer than STALE_MS has stopped: read again.
    const old = new Date(Date.now() - imports.STALE_MS - 60_000);
    await db
      .update(schema.planImports)
      .set({ readingStartedAt: old })
      .where(eq(schema.planImports.id, current.id));
    expect(await imports.needsWorker(current.id)).toBe(true);
    await imports.runImportWorker(current.id);
    expect((await importRow(current.id)).status).toBe("review");
  }, 30_000);

  it("gives up a reading stopped twice instead of starting it for ever", async () => {
    const current = await importOf(await pdfOf(1));
    const old = new Date(Date.now() - imports.STALE_MS - 60_000);
    // The first reader died: the next one takes over, and dies too.
    await db
      .update(schema.planImports)
      .set({ readingStartedAt: old })
      .where(eq(schema.planImports.id, current.id));
    const first = stalledReader(current.id);
    await vi.waitFor(async () =>
      expect((await importRow(current.id)).readingStartedAt!.getTime()).toBeGreaterThan(
        old.getTime(),
      ),
    );
    await db
      .update(schema.planImports)
      .set({ readingStartedAt: old })
      .where(eq(schema.planImports.id, current.id));
    await imports.runImportWorker(current.id);
    const after = await importRow(current.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe("La lecture de ce PDF a été interrompue deux fois.");
    expect((await importDto(current.id)).canRetry).toBe(true);
    await first.stop();

    // A person tries once more, and that reader is stopped too: it is final.
    await imports.retryFailedPages(current.id);
    const second = stalledReader(current.id);
    await vi.waitFor(async () =>
      expect((await importRow(current.id)).readingStartedAt).not.toBeNull(),
    );
    await db
      .update(schema.planImports)
      .set({ readingStartedAt: old })
      .where(eq(schema.planImports.id, current.id));
    expect(await imports.needsWorker(current.id)).toBe(true);
    await imports.runImportWorker(current.id);
    const final = await importRow(current.id);
    expect(final.status).toBe("failed");
    expect(final.error).toBe(
      "La lecture de ce PDF a été interrompue trois fois. Essayez de l'exporter de nouveau, ou divisez-le en plusieurs PDF.",
    );
    expect((await importDto(current.id)).canRetry).toBe(false);
    await second.stop();
    await expect(imports.retryFailedPages(current.id)).rejects.toThrow(/Annulez cet import/);
    expect((await importRow(current.id)).status).toBe("failed");
  });

  it("reads a PDF tried again after two stopped readings, when it goes well", async () => {
    const current = await importOf(await pdfOf(1));
    await db
      .update(schema.planImports)
      .set({ status: "failed", error: "La lecture de ce PDF a été interrompue deux fois." })
      .where(eq(schema.planImports.id, current.id));
    await imports.retryFailedPages(current.id);
    await imports.runImportWorker(current.id);
    expect(await importRow(current.id)).toMatchObject({ status: "review", error: null });
  });

  it("refuses a PDF of more than 500 pages, with what to do", async () => {
    const current = await importOf(await pdfOf(501));
    await imports.runImportWorker(current.id);
    const after = await importRow(current.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe(imports.tooManyPages(501));
    expect(await pagesOf(current.id)).toHaveLength(0);
    expect((await importDto(current.id)).canRetry).toBe(false);
    await expect(imports.retryFailedPages(current.id)).rejects.toThrow(/Annulez cet import/);
  }, 30_000);

  it("ends an unreadable PDF failed, and does not read it again on retry", async () => {
    const current = await importOf(Buffer.from("%PDF-1.4 ceci n'est pas un plan"));
    await imports.runImportWorker(current.id);
    const after = await importRow(current.id);
    expect(after).toMatchObject({ status: "failed", error: PDF_UNREADABLE });
    expect(await imports.needsWorker(current.id)).toBe(false);
    await expect(imports.retryFailedPages(current.id)).rejects.toThrow();
    expect((await importRow(current.id)).status).toBe("failed");
  });

  it("ends any error of the reading failed, with a message", async () => {
    const current = await importOf(await pdfOf(1));
    vi.spyOn(storage(), "get").mockRejectedValueOnce(new Error("storage unreachable"));
    await imports.runImportWorker(current.id);
    const after = await importRow(current.id);
    expect(after.status).toBe("failed");
    expect(after.error).toBe("Ce PDF n'a pas pu être lu. Réessayez dans un moment.");
    // That one may pass: tried again, it is read.
    await imports.retryFailedPages(current.id);
    expect(await imports.needsWorker(current.id)).toBe(true);
    await imports.runImportWorker(current.id);
    expect((await importRow(current.id)).status).toBe("review");
  });

  it("gives up a page whose worker stopped twice, and removes what it had sent", async () => {
    const current = await importOf(await pdfOf(2));
    await imports.runImportWorker(current.id);
    const [first, second] = (await pagesOf(current.id)).sort((a, b) => a.pageIndex - b.pageIndex);
    const old = new Date(Date.now() - imports.STALE_MS - 60_000);
    for (const [page, attempts] of [
      [first, 1],
      [second, 2],
    ] as const) {
      await db
        .update(schema.sheetRevisions)
        .set({ status: "processing", startedAt: old, attempts })
        .where(eq(schema.sheetRevisions.id, page.id));
    }
    await db
      .update(schema.planImports)
      .set({ status: "processing" })
      .where(eq(schema.planImports.id, current.id));
    expect(await publicFiles(second.tileKey!)).not.toHaveLength(0);

    await imports.needsWorker(current.id);
    const pages = await pagesOf(current.id);
    expect(pages.find((page) => page.id === first.id)).toMatchObject({ status: "queued" });
    expect(pages.find((page) => page.id === second.id)).toMatchObject({
      status: "failed",
      error: "Cette page n'a pas pu être convertie après deux essais.",
      tileKey: null,
    });
    expect(await publicFiles(second.tileKey!)).toHaveLength(0);

    // The page given up is not tried again; the other is.
    await imports.runImportWorker(current.id);
    expect((await importRow(current.id)).status).toBe("review");
    expect((await importDto(current.id)).canRetry).toBe(false);
    await expect(imports.retryFailedPages(current.id)).rejects.toThrow(/deux fois/);
  }, 30_000);

  it("removes the tiles of a page that failed half way", async () => {
    const current = await importOf(await pdfOf(1));
    const put = storage().put;
    const prefixes = new Set<string>();
    let sent = 0;
    vi.spyOn(storage(), "put").mockImplementation(async (...args) => {
      prefixes.add(tilePrefix(args[1]));
      if (++sent === 3) throw new Error("storage refused");
      return put(...args);
    });
    await imports.runImportWorker(current.id);
    const [page] = await pagesOf(current.id);
    expect(page).toMatchObject({ status: "failed", tileKey: null, attempts: 1 });
    expect(prefixes.size).toBe(1);
    for (const prefix of prefixes) expect(await publicFiles(prefix)).toHaveLength(0);
    // Taken once: one more try is allowed, and it works.
    vi.restoreAllMocks();
    expect((await importDto(current.id)).canRetry).toBe(true);
    await imports.retryFailedPages(current.id);
    await imports.runImportWorker(current.id);
    expect((await importRow(current.id)).status).toBe("review");
  }, 30_000);

  it("removes the tiles of a page finished after its import was cancelled", async () => {
    const current = await importOf(await pdfOf(1));
    const put = storage().put;
    const prefixes = new Set<string>();
    let cancelled: Promise<void> | undefined;
    vi.spyOn(storage(), "put").mockImplementation(async (...args) => {
      prefixes.add(tilePrefix(args[1]));
      // Cancelled while the tiles are being sent.
      cancelled ??= imports.cancelImport(current.id);
      await cancelled;
      return put(...args);
    });
    await imports.runImportWorker(current.id);
    vi.restoreAllMocks();
    expect(await importRow(current.id)).toBeUndefined();
    expect(await pagesOf(current.id)).toHaveLength(0);
    expect(prefixes.size).toBe(1);
    for (const prefix of prefixes) expect(await publicFiles(prefix)).toHaveLength(0);
    // The PDF went with it, through the uploads' own clean-up.
    const [upload] = await db
      .select()
      .from(schema.uploads)
      .where(eq(schema.uploads.id, current.uploadId));
    expect(upload?.status ?? "gone").not.toBe("complete");
    expect(await storage().size("private", `u/${current.uploadId}/plans.pdf`)).toBeNull();
  }, 30_000);
  it("says there is nothing to retry when no page failed", async () => {
    const current = await importOf(await pdfOf(1));
    await imports.runImportWorker(current.id);
    expect((await importRow(current.id)).status).toBe("review");
    await expect(imports.retryFailedPages(current.id)).rejects.toThrow(
      /^Aucune page à réessayer\.$/,
    );
  });

  it("keeps an import going when a retry puts a page back while it is being finished", async () => {
    const current = await importOf(await pdfOf(2));
    await imports.runImportWorker(current.id);
    const [page] = await pagesOf(current.id);
    await db
      .update(schema.sheetRevisions)
      .set({ status: "failed", error: "Cette page n'a pas pu être convertie." })
      .where(eq(schema.sheetRevisions.id, page.id));
    await db
      .update(schema.planImports)
      .set({ status: "processing" })
      .where(eq(schema.planImports.id, current.id));

    // A retry under way, as retryFailedPages does it: the import locked, the
    // page queued again, not yet committed.
    const other = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    let commit!: () => void;
    const retry = other.begin(async (tx) => {
      await tx`select id from plan_imports where id = ${current.id} for update`;
      await tx`update sheet_revisions set status = 'queued', error = null where id = ${page.id}`;
      await new Promise<void>((resolve) => (commit = resolve));
    });
    await vi.waitFor(() => expect(commit).toBeTypeOf("function"));

    // Meanwhile a request finds no page waiting, and finishes the import.
    const looked = imports.needsWorker(current.id);
    await vi.waitFor(async () => {
      const [{ blocked }] = await sql`
        select count(*)::int as blocked from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`;
      expect(blocked).toBeGreaterThan(0);
    });
    commit();
    await retry;
    await looked;
    await other.end();

    // The page put back is still to draw: the import did not go to review without it.
    expect((await importRow(current.id)).status).toBe("processing");
    expect(await imports.needsWorker(current.id)).toBe(true);
    await imports.runImportWorker(current.id);
    expect((await importRow(current.id)).status).toBe("review");
    expect((await pagesOf(current.id)).every((row) => row.status === "ready")).toBe(true);
  }, 30_000);

  it(`keeps at most ${PAGES_AT_ONCE} PDFiums alive in the process, across imports`, async () => {
    const both = [await importOf(await pdfOf(3)), await importOf(await pdfOf(3))];
    const allAtOnce = () =>
      Promise.all(
        both.flatMap((current) =>
          Array.from({ length: imports.MAX_WORKERS }, () => imports.runImportWorker(current.id)),
        ),
      );
    // Read, then drawn again with every page waiting: as many workers as
    // the imports allow, three each.
    for (const attempts of [1, 2]) {
      await allAtOnce();
      expect(drawing.mostAlive).toBeLessThanOrEqual(PAGES_AT_ONCE);
      expect(drawing.most).toBeLessThanOrEqual(PAGES_AT_ONCE);
      for (const current of both) {
        expect((await importRow(current.id)).status).toBe("review");
        // Waiting for a turn is no attempt.
        const pages = await pagesOf(current.id);
        expect(pages.map((page) => page.attempts)).toEqual([attempts, attempts, attempts]);
        await db
          .update(schema.sheetRevisions)
          .set({ status: "queued" })
          .where(eq(schema.sheetRevisions.importId, current.id));
        await db
          .update(schema.planImports)
          .set({ status: "processing" })
          .where(eq(schema.planImports.id, current.id));
      }
    }
  }, 60_000);

  it("lets a page wait for its turn without taking it, and draws it when the turn comes", async () => {
    const current = await importOf(await pdfOf(1));
    await imports.runImportWorker(current.id);
    const [page] = await pagesOf(current.id);
    await db
      .update(schema.sheetRevisions)
      .set({ status: "queued" })
      .where(eq(schema.sheetRevisions.id, page.id));
    await db
      .update(schema.planImports)
      .set({ status: "processing" })
      .where(eq(schema.planImports.id, current.id));

    drawing.opened = 0;
    // Other imports hold every turn of this process.
    const held = Array.from({ length: PAGES_AT_ONCE }, () => pageTurns.tryTake()!);
    const take = vi.spyOn(pageTurns, "take");
    const waiting = imports.runImportWorker(current.id);
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    // A second worker for the same import does not wait beside it.
    await imports.runImportWorker(current.id);
    expect(take).toHaveBeenCalledTimes(1);
    expect((await pagesOf(current.id))[0]).toMatchObject({ status: "queued", attempts: 1 });
    expect(drawing.opened).toBe(0);

    held[0].release();
    await waiting;
    held.slice(1).forEach((turn) => turn.release());
    expect((await pagesOf(current.id))[0]).toMatchObject({ status: "ready", attempts: 2 });
    expect((await importRow(current.id)).status).toBe("review");
  }, 30_000);

  it("draws the pages of a PDF read by another worker while this one waited", async () => {
    const current = await importOf(await pdfOf(1));
    await imports.runImportWorker(current.id);
    const [page] = await pagesOf(current.id);
    await db
      .update(schema.sheetRevisions)
      .set({ status: "queued" })
      .where(eq(schema.sheetRevisions.id, page.id));
    await db
      .update(schema.planImports)
      .set({ status: "reading", readingStartedAt: null })
      .where(eq(schema.planImports.id, current.id));

    const held = Array.from({ length: PAGES_AT_ONCE }, () => pageTurns.tryTake()!);
    const take = vi.spyOn(pageTurns, "take");
    const waiting = imports.runImportWorker(current.id);
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    // Another worker reads the PDF and lists its pages meanwhile.
    await db
      .update(schema.planImports)
      .set({ status: "processing", readingStartedAt: new Date() })
      .where(eq(schema.planImports.id, current.id));
    held.forEach((turn) => turn.release());
    await waiting;
    expect((await pagesOf(current.id))[0]).toMatchObject({ status: "ready" });
    expect((await importRow(current.id)).status).toBe("review");
  }, 30_000);

  it("drops a cancelled import's PDF through the uploads, after the import is gone", async () => {
    const recent = await importOf(await pdfOf(1));
    await imports.runImportWorker(recent.id);
    const tileKey = (await pagesOf(recent.id))[0].tileKey!;
    await imports.cancelImport(recent.id);
    // Gone at once from the screen, with its pages and their images.
    expect(await importRow(recent.id)).toBeUndefined();
    expect(await pagesOf(recent.id)).toHaveLength(0);
    expect(await publicFiles(tileKey)).toHaveLength(0);
    // The PDF is deleted; its row waits, unfinished, for its link to expire.
    const uploadOf = async (id: string) =>
      (await db.select().from(schema.uploads).where(eq(schema.uploads.id, id)))[0];
    expect(await uploadOf(recent.uploadId)).toMatchObject({ status: "pending" });
    expect(await storage().size("private", `u/${recent.uploadId}/plans.pdf`)).toBeNull();
    // Sent again for the same upload (an answer lost), the import does not come back.
    const upload = { ...(await uploadOf(recent.uploadId)), status: "complete" as const };
    const user = { id: upload.createdBy!, role: "contremaitre" } as Parameters<
      typeof imports.createImport
    >[0];
    await expect(imports.createImport(user, upload, {})).rejects.toThrow(/pas terminé/);
    expect(await pagesOf(recent.id)).toHaveLength(0);

    // An upload announced more than a day ago no longer counts for anything
    // and goes entirely (a younger one keeps its row for the day's count).
    // It takes nothing with it: its import and the pages were removed first.
    const old = await importOf(await pdfOf(1));
    await imports.runImportWorker(old.id);
    const [oldPage] = await pagesOf(old.id);
    await db
      .update(schema.uploads)
      .set({ createdAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(schema.uploads.id, old.uploadId));
    await imports.cancelImport(old.id);
    expect(await uploadOf(old.uploadId)).toBeUndefined();
    expect(await importRow(old.id)).toBeUndefined();
    expect(
      await db.select().from(schema.sheetRevisions).where(eq(schema.sheetRevisions.id, oldPage.id)),
    ).toHaveLength(0);
    expect(await publicFiles(oldPage.tileKey!)).toHaveLength(0);
  }, 30_000);
});
