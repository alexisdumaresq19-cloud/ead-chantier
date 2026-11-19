import type { ImportPage, SheetRevision, Tiles } from "@/shared/plans";

import type { schema } from "../db/client";
import { storage } from "../storage";
import { levelsFor } from "./render";

type RevisionRow = typeof schema.sheetRevisions.$inferSelect;

export function tilesOf(row: RevisionRow): Tiles | null {
  if (row.status !== "ready" || !row.tileKey || !row.width || !row.height) return null;
  return {
    url: storage().publicUrl(row.tileKey),
    width: row.width,
    height: row.height,
    tileSize: row.tileSize ?? 1024,
    overlap: row.tileOverlap ?? 1,
    ...levelsFor(row.width, row.height),
  };
}

export const thumbOf = (row: RevisionRow): string | null =>
  row.status === "ready" && row.tileKey ? storage().publicUrl(`${row.tileKey}/thumb.webp`) : null;

export function revisionDto(row: RevisionRow): SheetRevision | null {
  const tiles = tilesOf(row);
  if (!tiles) return null;
  return {
    id: row.id,
    label: row.label,
    issuedOn: row.issuedOn,
    addedAt: (row.readyAt ?? row.createdAt).toISOString(),
    tiles,
    thumbUrl: thumbOf(row)!,
  };
}

export function importPageDto(row: RevisionRow): ImportPage {
  return {
    id: row.id,
    pageIndex: row.pageIndex,
    status: row.status,
    error: row.error,
    thumbUrl: thumbOf(row),
    tiles: tilesOf(row),
    draftNumber: row.draftNumber ?? "",
    draftTitle: row.draftTitle ?? "",
    draftSheetId: row.draftSheetId,
    draftSkip: row.draftSkip,
  };
}
