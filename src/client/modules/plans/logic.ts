import {
  plainText,
  sheetNumberKey,
  type ImportPage,
  type PlanFolder,
  type Plans,
  type Sheet,
} from "@/shared/plans";
import type { Role } from "@/shared/roles";

// What the plan screens work out from their data, apart from any drawing:
// who matches a search, which folder shows what, what stops a publication.

// --- Who changes the plans --------------------------------------------------

/**
 * Whether to show the controls that change the plans: to those who manage
 * the project, and once it is archived, to the office alone. The server
 * decides again on every request.
 */
export const mayChangePlans = (
  project: { canManage: boolean; status: "actif" | "archive" },
  role: Role,
): boolean => project.canManage && (project.status !== "archive" || role === "admin");

// --- Searching the list -----------------------------------------------------

/** A sheet with what searching it takes, worked out once for the whole list. */
export type IndexedSheet = { sheet: Sheet; number: string; compact: string; title: string };

const compactOf = (text: string) => text.replace(/[\s._-]+/g, "");

export function indexSheets(sheets: Sheet[]): IndexedSheet[] {
  return sheets.map((sheet) => {
    const number = plainText(sheet.number);
    return { sheet, number, compact: compactOf(number), title: plainText(sheet.title) };
  });
}

/** The words typed, lowercase and without accents. */
export const searchWords = (query: string) => plainText(query).split(/\s+/).filter(Boolean);

/**
 * The sheets whose number or title holds every word typed, best first: a
 * number that starts with what was typed, then any number, then titles.
 * "c201" and "c 201" both find C-201.
 */
export function filterSheets(index: IndexedSheet[], query: string): Sheet[] {
  const words = searchWords(query);
  if (!words.length) return index.map((entry) => entry.sheet);
  const whole = compactOf(words.join(""));

  const found: { sheet: Sheet; rank: number }[] = [];
  for (const entry of index) {
    let inNumber = Boolean(whole) && entry.compact.includes(whole);
    const all =
      inNumber ||
      words.every((word) => {
        const compact = compactOf(word);
        if (entry.number.includes(word) || (compact && entry.compact.includes(compact))) {
          inNumber = true;
          return true;
        }
        return entry.title.includes(word);
      });
    if (!all) continue;
    const starts = Boolean(whole) && entry.compact.startsWith(whole);
    found.push({ sheet: entry.sheet, rank: starts ? 0 : inNumber ? 1 : 2 });
  }
  // The sort is stable: within a rank, sheets keep the order of the list.
  return found.sort((a, b) => a.rank - b.rank).map((entry) => entry.sheet);
}

/**
 * `text` cut where the words typed appear in it, so they can be set in bold.
 * Accents and case are ignored, as in the search itself.
 */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = searchWords(query);
  // One character for one character, so positions are those of `text`.
  const folded = text
    .split("")
    .map((character) => plainText(character)[0] ?? character)
    .join("");
  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length))
      marked.fill(true, at, at + word.length);
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.hit === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marked[i] });
  }
  return parts;
}

// --- Folders ----------------------------------------------------------------

/** A folder with its sheets; `folder` is null for the sheets outside any folder. */
export type FolderGroup = { folder: PlanFolder | null; sheets: Sheet[] };

/**
 * The list as it is shown: one group per folder, in the folders' order, then
 * the sheets that are in no folder. Empty folders are shown only to those who
 * manage them.
 */
export function groupByFolder(plans: Plans, { keepEmpty }: { keepEmpty: boolean }): FolderGroup[] {
  const groups = new Map<string, FolderGroup>(
    plans.folders.map((folder) => [folder.id, { folder, sheets: [] }]),
  );
  const loose: FolderGroup = { folder: null, sheets: [] };
  for (const sheet of plans.sheets)
    ((sheet.folderId && groups.get(sheet.folderId)) || loose).sheets.push(sheet);
  return [...groups.values(), loose].filter((group) =>
    group.folder ? keepEmpty || group.sheets.length > 0 : group.sheets.length > 0,
  );
}

// --- Revisions --------------------------------------------------------------

/**
 * How a revision is called on screen. The office writes labels freely: a
 * bare "2" or "B" reads better as "Rév. 2", while "Rév. 2" or "Émis pour
 * construction" are already what they should be.
 */
export function revisionName(label: string | null | undefined): string | null {
  const text = label?.trim();
  if (!text) return null;
  return /^[\dA-Za-z]{1,3}$/.test(text) ? `Rév. ${text}` : text;
}

/** How long a new revision is pointed out in the lists. */
const NEW_FOR = 7 * 24 * 3600 * 1000;

/**
 * Whether the revision the site sees replaced another in the last week: the
 * one case where a revision deserves colour in a list, so that it is
 * noticed. A sheet's first revision is not news.
 */
export function isNewRevision(
  sheet: Pick<Sheet, "current" | "revisionCount">,
  now = Date.now(),
): boolean {
  if (!sheet.current || sheet.revisionCount < 2) return false;
  const age = now - new Date(sheet.current.addedAt).getTime();
  return age >= 0 && age < NEW_FOR;
}

// --- Words found on the plans -----------------------------------------------

/**
 * An excerpt as a search result shows it. The server cuts a few words before
 * what was found, often mid-sentence ("…du Proctor modifié. 6. Les
 * regards…"): when a sentence starts between the cut and the words found,
 * the excerpt starts there, without the "…". A list number ("6.") belongs to
 * the sentence it opens. At the other end, a stub of the next sentence
 * ("mm. 7…") is left out.
 */
export function tidyExcerpt(text: string, query: string): string {
  const excerpt = text.replace(/([.!?;])\s+\S{1,3}…$/, "$1");
  if (!excerpt.startsWith("…")) return excerpt;
  const parts = highlightParts(excerpt, query);
  const firstHit = parts.findIndex((part) => part.hit);
  if (firstHit < 0) return excerpt;
  const hitAt = parts.slice(0, firstHit).reduce((length, part) => length + part.text.length, 0);
  let start = -1;
  for (const boundary of excerpt.slice(0, hitAt).matchAll(/[.!?;]\s+/g)) {
    if (/(^|\s)\d{1,3}$/.test(excerpt.slice(0, boundary.index))) continue;
    const at = boundary.index + boundary[0].length;
    if (/[\p{Lu}\d]/u.test(excerpt[at] ?? "")) start = at;
  }
  return start > 0 ? excerpt.slice(start) : excerpt;
}

/** Hits whose excerpt reads the same (notes repeated on every sheet), together, in order. */
export function groupByExcerpt<T extends { excerpt: string }>(
  hits: T[],
): { excerpt: string; hits: T[] }[] {
  const groups = new Map<string, { excerpt: string; hits: T[] }>();
  for (const hit of hits) {
    const key = hit.excerpt.replace(/\s+/g, " ").trim();
    const group = groups.get(key);
    if (group) group.hits.push(hit);
    else groups.set(key, { excerpt: hit.excerpt, hits: [hit] });
  }
  return [...groups.values()];
}

// --- Checking an import -----------------------------------------------------

/** What the office is about to publish for one page, as typed on the screen. */
export type PageDraft = { number: string; title: string; skip: boolean };

export const draftOf = (page: ImportPage): PageDraft => ({
  number: page.draftNumber,
  title: page.draftTitle,
  skip: page.draftSkip,
});

/** The pages that would be published: converted, and not left out. */
export const keptPages = (pages: ImportPage[], drafts: Record<string, PageDraft>) =>
  pages.filter((page) => page.status === "ready" && !(drafts[page.id] ?? draftOf(page)).skip);

/**
 * What stops an import from being published, by page id: a sheet needs a
 * number, and two pages cannot become the same sheet.
 */
export function draftProblems(
  pages: ImportPage[],
  drafts: Record<string, PageDraft>,
): Map<string, string> {
  const problems = new Map<string, string>();
  const firstWith = new Map<string, ImportPage>();
  for (const page of keptPages(pages, drafts)) {
    const number = (drafts[page.id] ?? draftOf(page)).number.trim();
    if (!number) {
      problems.set(page.id, "Inscrivez le numéro de la feuille.");
      continue;
    }
    const key = sheetNumberKey(number);
    const first = firstWith.get(key);
    if (!first) {
      firstWith.set(key, page);
      continue;
    }
    problems.set(page.id, `Même numéro que la page ${first.pageIndex + 1}.`);
    if (!problems.has(first.id))
      problems.set(first.id, `Même numéro que la page ${page.pageIndex + 1}.`);
  }
  return problems;
}

/** The project's sheets by number: a page with the number of one is its new revision. */
export function sheetsByNumber(sheets: Sheet[]): Map<string, Sheet> {
  return new Map(sheets.map((sheet) => [sheetNumberKey(sheet.number), sheet]));
}

// --- Choosing files ---------------------------------------------------------

const MAX_PDF_SIZE = 500 * 1024 * 1024;

type FileLike = { name: string; type: string; size: number };

/**
 * Sorts what was chosen or dropped: plans come in as PDFs of 500 MB at most
 * (the server's own rule). Some phones give a PDF no type or a vague one, so
 * its name counts too.
 */
export function sortPdfFiles<T extends FileLike>(files: T[]): { accepted: T[]; refused: string[] } {
  const accepted: T[] = [];
  const refused: string[] = [];
  for (const file of files) {
    const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!pdf) refused.push(`« ${file.name} » n'est pas un PDF.`);
    else if (file.size === 0) refused.push(`« ${file.name} » est vide.`);
    else if (file.size > MAX_PDF_SIZE) refused.push(`« ${file.name} » dépasse 500 Mo.`);
    else accepted.push(file);
  }
  return { accepted, refused };
}
