import { allTileUrls, type Plans } from "@/shared/plans";

// Keeping a project on the device, the part that only reasons: which files a
// project takes, what the device already holds, and what to tell the person.
// The downloading itself is in kept.ts.

/** A sheet whose files are all on the device. */
export type KeptSheet = {
  /** The revision that was kept: a newer one makes the sheet out of date. */
  revisionId: string;
  /** Where the revision's files live; every one of them is under this address. */
  folder: string;
  files: number;
  bytes: number;
};

/** What the device remembers of a kept project (one record per project, in IndexedDB). */
export type KeptProject = {
  projectId: string;
  /** When every sheet was last on the device; null until a first download ends. */
  keptAt: string | null;
  sheets: Record<string, KeptSheet>;
  /**
   * Every folder a download has begun to fill, noted before its first file
   * so that removing the project finds them even if it never finished.
   */
  folders: string[];
};

/** What keeping one sheet takes: every file of its current revision. */
export type SheetFiles = { sheetId: string; revisionId: string; folder: string; urls: string[] };

/**
 * The files to keep for a project. The thumbnail and the small levels come
 * first: a sheet caught half-way already opens, blurred.
 */
export function filesToKeep(plans: Plans): SheetFiles[] {
  return plans.sheets.flatMap((sheet) =>
    sheet.current
      ? [
          {
            sheetId: sheet.id,
            revisionId: sheet.current.id,
            folder: sheet.current.tiles.url,
            urls: [sheet.current.thumbUrl, ...allTileUrls(sheet.current.tiles)],
          },
        ]
      : [],
  );
}

/** The sheets the device does not hold as the site now sees them: new or revised. */
export function sheetsToFetch(kept: KeptProject | null, wanted: SheetFiles[]): SheetFiles[] {
  return wanted.filter((sheet) => kept?.sheets[sheet.sheetId]?.revisionId !== sheet.revisionId);
}

/** Folders noted for a project that its plans no longer use: old revisions, removed sheets. */
export function unusedFolders(kept: KeptProject, wanted: SheetFiles[]): string[] {
  const used = new Set(wanted.map((sheet) => sheet.folder));
  return kept.folders.filter((folder) => !used.has(folder));
}

/**
 * The record without the sheets whose files are no longer all in the cache:
 * a browser clears storage when the device runs short. They count as sheets
 * to fetch again.
 */
export function sheetsStillThere(
  kept: KeptProject,
  storedUrls: readonly string[],
  absolute: (url: string) => string,
): KeptProject {
  const whole = ([, sheet]: [string, KeptSheet]) => {
    const prefix = `${absolute(sheet.folder)}/`;
    let found = 0;
    for (const url of storedUrls) if (url.startsWith(prefix) && ++found >= sheet.files) return true;
    return sheet.files === 0;
  };
  return { ...kept, sheets: Object.fromEntries(Object.entries(kept.sheets).filter(whole)) };
}

export function keptTotals(sheets: KeptSheet[]): { sheets: number; files: number; bytes: number } {
  return sheets.reduce(
    (total, sheet) => ({
      sheets: total.sheets + 1,
      files: total.files + sheet.files,
      bytes: total.bytes + sheet.bytes,
    }),
    { sheets: 0, files: 0, bytes: 0 },
  );
}

/** A tile of an engineering drawing, on average; the example plans are a little lighter. */
const TYPICAL_FILE = 45_000;
/** Below this many files, what the device has seen says little about the next ones. */
const ENOUGH_FILES = 100;

/**
 * About how much room `files` will take. Sizes are only known once
 * downloaded, so this goes by what this device already keeps, if anything.
 */
export function estimateBytes(files: number, known: { files: number; bytes: number }): number {
  const average = known.files >= ENOUGH_FILES ? known.bytes / known.files : TYPICAL_FILE;
  return Math.round(files * average);
}

/** Whether a download of about `needed` bytes risks running out of room. */
export function isSpaceShort(needed: number, free: number | null): boolean {
  // The browser's figure is itself an estimate: leave a tenth of margin.
  return free !== null && needed > free * 0.9;
}

/** The state the project's card shows. */
export type KeptStatus = "none" | "downloading" | "interrupted" | "outdated" | "kept";

export function keptStatus(
  kept: KeptProject | null,
  downloading: boolean,
  /** Sheets to fetch, when the plan list is known. */
  toFetch: number | undefined,
): KeptStatus {
  if (downloading) return "downloading";
  if (!kept) return "none";
  if (!kept.keptAt) return "interrupted";
  return toFetch ? "outdated" : "kept";
}
