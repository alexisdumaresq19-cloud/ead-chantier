import { and, asc, eq, inArray, isNotNull, isNull, sql as raw, type AnyColumn } from "drizzle-orm";

import {
  plainText,
  sheetNumberKey,
  type Plans,
  type PlanSearchHit,
  type Sheet,
  type SheetDetail,
  type SheetRevision,
} from "@/shared/plans";

import { db, schema } from "../db/client";
import { notFound } from "../http";
import { revisionDto, thumbOf } from "./dto";
import { excerptAround } from "./excerpt";

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

/**
 * The project's sheets by number, as the site sees them. A page imported with
 * the number of one of them is its new revision; any other is a new sheet.
 */
export async function sheetsByNumber(
  projectId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<Map<string, { id: string; number: string }>> {
  const rows = await executor
    .select({ id: schema.sheets.id, number: schema.sheets.number })
    .from(schema.sheets)
    .where(and(eq(schema.sheets.projectId, projectId), isNull(schema.sheets.archivedAt)));
  return new Map(rows.map((sheet) => [sheetNumberKey(sheet.number), sheet]));
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

// Search ignores case and accents: plans are lettered in capitals, with or
// without accents, and nobody types them on a phone. Postgres folds the
// stored text the same way plainText() folds the words typed.
const ACCENTED = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ";
const UNACCENTED = "aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy";
const folded = (column: AnyColumn) => raw`translate(lower(${column}), ${ACCENTED}, ${UNACCENTED})`;

/** Finds sheets by number, by title, or by the words drawn on them. */
export async function searchPlans(projectId: string, query: string): Promise<PlanSearchHit[]> {
  const words = plainText(query.trim().slice(0, 80));
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
        raw`(${folded(schema.sheets.number)} like ${like} or ${folded(schema.sheets.title)} like ${like} or ${folded(schema.sheetRevisions.text)} like ${like})`,
      ),
    )
    .limit(60);

  const inName = (r: (typeof rows)[number]) =>
    plainText(r.sheet.number).includes(words) || plainText(r.sheet.title).includes(words);
  return rows
    .sort(
      (a, b) =>
        Number(inName(b)) - Number(inName(a)) ||
        a.sheet.number.localeCompare(b.sheet.number, "fr", { numeric: true }),
    )
    .map((r) => ({
      sheetId: r.sheet.id,
      number: r.sheet.number,
      title: r.sheet.title,
      thumbUrl: thumbOf(r.revision),
      excerpt: inName(r) || !r.revision.text ? null : excerptAround(r.revision.text, words),
    }));
}
