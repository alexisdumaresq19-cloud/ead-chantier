// Shapes of the plans module: sheets, their revisions and the import of PDFs.

/**
 * A sheet's image, cut into a pyramid of tiles (Deep Zoom layout): level
 * `maxLevel` is full size and each level below is half the one above. A tile
 * is at `${url}/${level}/${column}_${row}.webp`.
 */
export type Tiles = {
  url: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  minLevel: number;
  maxLevel: number;
};

export type SheetRevision = {
  id: string;
  /** "Rév. 2", "B"… as the office wrote it; may be empty. */
  label: string | null;
  issuedOn: string | null;
  addedAt: string;
  tiles: Tiles;
  thumbUrl: string;
};

export type Sheet = {
  id: string;
  number: string;
  title: string;
  folderId: string | null;
  sort: number;
  /** What the site sees. Null only while a sheet has no rendered revision. */
  current: SheetRevision | null;
  revisionCount: number;
};

export type PlanFolder = { id: string; name: string; sort: number };

export type Plans = { folders: PlanFolder[]; sheets: Sheet[] };

export type SheetDetail = Sheet & {
  /** Newest first. */
  revisions: SheetRevision[];
  /** Neighbours in the plan list, for "next" and "previous" in the viewer. */
  previousId: string | null;
  nextId: string | null;
};

export type ImportPage = {
  id: string;
  pageIndex: number;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  thumbUrl: string | null;
  tiles: Tiles | null;
  draftNumber: string;
  draftTitle: string;
  /** Set when this page is a new revision of a sheet that already exists. */
  draftSheetId: string | null;
  draftSkip: boolean;
};

export type PlanImport = {
  id: string;
  filename: string;
  status: "reading" | "processing" | "review" | "published" | "failed";
  error: string | null;
  pageCount: number | null;
  folderId: string | null;
  revisionLabel: string | null;
  issuedOn: string | null;
  createdAt: string;
  pages: ImportPage[];
};

export type PlanSearchHit = {
  sheetId: string;
  number: string;
  title: string;
  thumbUrl: string | null;
  /** Where the words were found in the sheet's text, if not in its name. */
  excerpt: string | null;
};

// --- The tile pyramid -------------------------------------------------------

/** Size of a sheet's image at a level of its pyramid. */
export function levelSize(tiles: Tiles, level: number): { width: number; height: number } {
  const scale = 2 ** (tiles.maxLevel - level);
  return {
    width: Math.max(1, Math.ceil(tiles.width / scale)),
    height: Math.max(1, Math.ceil(tiles.height / scale)),
  };
}

/** How many tiles a level has across and down. */
export function levelGrid(tiles: Tiles, level: number): { columns: number; rows: number } {
  const { width, height } = levelSize(tiles, level);
  return { columns: Math.ceil(width / tiles.tileSize), rows: Math.ceil(height / tiles.tileSize) };
}

export const tileUrl = (tiles: Tiles, level: number, column: number, row: number) =>
  `${tiles.url}/${level}/${column}_${row}.webp`;

/** Every tile of a sheet, smallest levels first: what keeping it offline takes. */
export function allTileUrls(tiles: Tiles): string[] {
  const urls: string[] = [];
  for (let level = tiles.minLevel; level <= tiles.maxLevel; level++) {
    const { columns, rows } = levelGrid(tiles, level);
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++)
        urls.push(tileUrl(tiles, level, column, row));
  }
  return urls;
}

// --- Lists, search and imports ----------------------------------------------

/** An import not yet published, as the plan list shows it to those who manage. */
export type PlanImportSummary = {
  id: string;
  filename: string;
  status: PlanImport["status"];
  error: string | null;
  pageCount: number | null;
  /** Pages converted so far, and pages that could not be. */
  readyCount: number;
  failedCount: number;
  createdAt: string;
};

/** What the import endpoints answer: the import and the project it belongs to. */
export type PlanImportDetail = PlanImport & { projectId: string };

/**
 * "C-101", "c 101" and "C101" are the same sheet. A page imported with the
 * number of a sheet the project already has becomes its new revision.
 */
export function sheetNumberKey(number: string): string {
  const upper = number.trim().toUpperCase();
  // A number made only of separators ("-") still has to compare as itself.
  return upper.replace(/[\s._-]+/g, "") || upper;
}

/** Lowercase, without accents: "Égout" is found by typing "egout". */
export function plainText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
