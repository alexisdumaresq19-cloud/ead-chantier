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
