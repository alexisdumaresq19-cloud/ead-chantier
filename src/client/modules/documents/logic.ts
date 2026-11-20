import {
  DOCUMENT_CATEGORIES,
  fileProblem,
  tidyTitle,
  titleFromFilename,
  type DocumentCategory,
  type FileProblem,
  type ProjectDocument,
} from "@/shared/documents";
import type { Me, ProjectDetail } from "@/shared/api";
import { mayChangeAddedBy } from "@/shared/demo";
import type { Role } from "@/shared/roles";

import { formatShortDay } from "../../lib/format";

// What the documents screens work out by themselves: who sees the managing
// controls, the search, the order of the list, the files chosen for sending.

/**
 * Whether to offer adding, renaming, moving and archiving. An archived
 * project is read-only for all but the office. The server decides again.
 */
export const canChangeDocuments = (
  project: Pick<ProjectDetail, "canManage" | "status">,
  role: Role,
) => project.canManage && (project.status !== "archive" || role === "admin");

/**
 * Whether to offer renaming, moving and archiving this document, on a
 * project where canChangeDocuments holds: anyone who manages the project
 * may, the demonstration account only on what it added itself. The list
 * does not name a document's author by id: the documents this device sent
 * for the demonstration account (`addedHere`, see data.ts) are the ones
 * known to be its own, and any other is left alone.
 */
export const canManageDocument = (
  me: Pick<Me, "id" | "demo">,
  document: Pick<ProjectDocument, "id">,
  addedHere: ReadonlySet<string>,
) => mayChangeAddedBy(me, addedHere.has(document.id) ? me.id : null);

/** Lowercase, without accents: "Échéancier" is found by typing "echeancier". */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Every word typed is somewhere in the title, in any order. */
export function matchesSearch(title: string, search: string): boolean {
  const where = plain(title);
  return plain(search)
    .split(/\s+/)
    .every((word) => where.includes(word));
}

/** Two titles a person would read as the same. */
export const sameTitle = (a: string, b: string) => plain(tidyTitle(a)) === plain(tidyTitle(b));

export type DocumentGroup = { category: DocumentCategory; documents: ProjectDocument[] };

const titleOrder = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

/**
 * The documents by category, in the categories' own order and without the
 * empty ones. Inside a category, by title as a person files papers
 * ("Section 2" before "Section 10"); of two with the same title, the newest first.
 */
export function groupDocuments(documents: ProjectDocument[], search = ""): DocumentGroup[] {
  const shown = search.trim()
    ? documents.filter((document) => matchesSearch(document.title, search))
    : documents;
  return DOCUMENT_CATEGORIES.map((category) => ({
    category,
    documents: shown
      .filter((document) => document.category === category)
      .sort((a, b) => titleOrder.compare(a.title, b.title) || b.addedAt.localeCompare(a.addedAt)),
  })).filter((group) => group.documents.length > 0);
}

/** "14 oct.", with the year once it is no longer this year's. */
export function formatAdded(value: string, now = new Date()): string {
  const date = new Date(value);
  const day = formatShortDay(date);
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** A file chosen for sending, before it is sent. */
export type Draft<F extends ChosenFile = File> = {
  key: string;
  file: F;
  title: string;
  /** Why it cannot be sent, if it cannot. */
  problem: FileProblem | null;
};

type ChosenFile = { name: string; size: number; lastModified: number };

const draftKey = (file: ChosenFile) => `${file.name}:${file.size}:${file.lastModified}`;

/**
 * Adds chosen files to those already chosen. The same file picked twice is
 * kept once; two different files that share a name are both kept.
 */
export function addDrafts<F extends ChosenFile>(drafts: Draft<F>[], files: F[]): Draft<F>[] {
  const known = new Set(drafts.map((draft) => draft.key));
  const added: Draft<F>[] = [];
  for (const file of files) {
    const key = draftKey(file);
    if (known.has(key)) continue;
    known.add(key);
    added.push({ key, file, title: titleFromFilename(file.name), problem: fileProblem(file) });
  }
  return [...drafts, ...added];
}
