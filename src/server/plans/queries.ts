import { and, asc, eq, inArray, isNotNull, isNull, sql as raw } from "drizzle-orm";

import type { Plans, PlanSearchHit, Sheet, SheetDetail, SheetRevision } from "@/shared/plans";

import { db, schema } from "../db/client";
import { notFound } from "../http";
import { revisionDto, thumbOf } from "./dto";

type SheetRow = typeof schema.sheets.$inferSelect;
type RevisionRow = typeof schema.sheetRevisions.$inferSelect;

/** Folders first (in their order), then loose sheets; inside, by sort then number. */
function inListOrder(sheets: SheetRow[], folderSort: Map<string, number>): SheetRow[] {
  const rank = (s: SheetRow) =>
    s.folderId ? (folderSort.get(s.folderId) ?? 0) : Number.MAX_SAFE_INTEGER;
  return [...sheets].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.sort - b.sort ||
      a.number.localeCompare(b.number, "fr", { numeric: true }),
  );
}

async function revisionsOf(sheetIds: string[]): Promise<Map<string, RevisionRow[]>> {
  const bySheet = new Map<string, RevisionRow[]>();
  if (!sheetIds.length) return bySheet;
  const rows = await db
    .select()
    .from(schema.sheetRevisions)
    .where(
      and(
        inArray(schema.sheetRevisions.sheetId, sheetIds),
        eq(schema.sheetRevisions.status, "ready"),
      ),
    )
    .orderBy(raw`${schema.sheetRevisions.readyAt} desc`);
  for (const row of rows) {
    const list = bySheet.get(row.sheetId!) ?? [];
    list.push(row);
    bySheet.set(row.sheetId!, list);
  }
  return bySheet;
}

function sheetDto(sheet: SheetRow, revisions: RevisionRow[]): Sheet {
  const currentRow = revisions.find((r) => r.id === sheet.currentRevisionId) ?? revisions[0];
  return {
    id: sheet.id,
    number: sheet.number,
    title: sheet.title,
    folderId: sheet.folderId,
    sort: sheet.sort,
    current: currentRow ? revisionDto(currentRow) : null,
    revisionCount: revisions.length,
  };
}

export async function listPlans(projectId: string): Promise<Plans> {
  const folders = await db
    .select()
    .from(schema.planFolders)
    .where(eq(schema.planFolders.projectId, projectId))
    .orderBy(asc(schema.planFolders.sort), asc(schema.planFolders.name));
  const rows = await db
    .select()
    .from(schema.sheets)
    .where(and(eq(schema.sheets.projectId, projectId), isNull(schema.sheets.archivedAt)));
  const ordered = inListOrder(rows, new Map(folders.map((f, i) => [f.id, i])));
  const revisions = await revisionsOf(ordered.map((s) => s.id));
  return {
    folders: folders.map((f) => ({ id: f.id, name: f.name, sort: f.sort })),
    sheets: ordered.map((sheet) => sheetDto(sheet, revisions.get(sheet.id) ?? [])),
  };
}

export async function sheetRow(sheetId: string): Promise<SheetRow> {
  const [sheet] = await db
    .select()
    .from(schema.sheets)
    .where(eq(schema.sheets.id, sheetId))
    .limit(1);
  if (!sheet) throw notFound("Feuille introuvable.");
  return sheet;
}

export async function sheetDetail(sheet: SheetRow): Promise<SheetDetail> {
  const revisions = (await revisionsOf([sheet.id])).get(sheet.id) ?? [];
  const { sheets } = await listPlans(sheet.projectId);
  const at = sheets.findIndex((s) => s.id === sheet.id);
  return {
    ...sheetDto(sheet, revisions),
    revisions: revisions.map(revisionDto).filter((r): r is SheetRevision => r !== null),
    previousId: at > 0 ? sheets[at - 1].id : null,
    nextId: at >= 0 && at < sheets.length - 1 ? sheets[at + 1].id : null,
  };
}

/** Finds sheets by number, by title, or by the words drawn on them. */
export async function searchPlans(projectId: string, query: string): Promise<PlanSearchHit[]> {
  const words = query.trim().slice(0, 80);
  if (words.length < 2) return [];
  const like = `%${words.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({ sheet: schema.sheets, revision: schema.sheetRevisions })
    .from(schema.sheets)
    .innerJoin(schema.sheetRevisions, eq(schema.sheetRevisions.id, schema.sheets.currentRevisionId))
    .where(
      and(
        eq(schema.sheets.projectId, projectId),
        isNull(schema.sheets.archivedAt),
        isNotNull(schema.sheets.currentRevisionId),
        raw`(${schema.sheets.number} ilike ${like} or ${schema.sheets.title} ilike ${like} or ${schema.sheetRevisions.text} ilike ${like})`,
      ),
    )
    .limit(60);

  const lower = words.toLowerCase();
  const inName = (r: (typeof rows)[number]) =>
    r.sheet.number.toLowerCase().includes(lower) || r.sheet.title.toLowerCase().includes(lower);
  return rows
    .sort(
      (a, b) =>
        Number(inName(b)) - Number(inName(a)) ||
        a.sheet.number.localeCompare(b.sheet.number, "fr", { numeric: true }),
    )
    .map((r) => {
      let excerpt: string | null = null;
      if (!inName(r) && r.revision.text) {
        const flat = r.revision.text.replace(/\s+/g, " ");
        const at = flat.toLowerCase().indexOf(lower);
        if (at >= 0)
          excerpt = `${at > 40 ? "…" : ""}${flat.slice(Math.max(0, at - 40), at + words.length + 60).trim()}…`;
      }
      return {
        sheetId: r.sheet.id,
        number: r.sheet.number,
        title: r.sheet.title,
        thumbUrl: thumbOf(r.revision),
        excerpt,
      };
    });
}
