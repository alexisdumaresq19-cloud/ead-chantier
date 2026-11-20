// A project's documents (contract, permits, safety program, data sheets…),
// as exchanged between the app and its API.
//
//   GET    /api/projects/:id/documents    the project's documents (members)
//   POST   /api/projects/:id/documents    { uploadId, title, category } (managers)
//   PATCH  /api/documents/:id             { title?, category? } (managers)
//   DELETE /api/documents/:id             takes it off the project (managers)
//   GET    /api/documents/:id/link        a short-lived link to the file (members)

/** In the order the site reads them. The key is stored; the label is shown. */
export const DOCUMENT_CATEGORIES = [
  "contrat",
  "permis",
  "sst",
  "fiches",
  "echeancier",
  "essais",
  "autre",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  contrat: "Contrat et devis",
  permis: "Permis et autorisations",
  sst: "Santé et sécurité",
  fiches: "Fiches techniques",
  echeancier: "Échéancier",
  essais: "Essais et rapports",
  autre: "Autres documents",
};

/** A stored category this version does not know is shown with the others. */
export const toCategory = (value: string): DocumentCategory =>
  (DOCUMENT_CATEGORIES as readonly string[]).includes(value)
    ? (value as DocumentCategory)
    : "autre";

export type ProjectDocument = {
  id: string;
  title: string;
  category: DocumentCategory;
  /** The file as it was sent ("Devis section 3.pdf"): its extension says what it is. */
  filename: string;
  /** In bytes. */
  size: number;
  /** ISO 8601. */
  addedAt: string;
  /** Name of the person who added it, if they are still known. */
  addedBy: string | null;
};

/** What GET /api/documents/:id/link answers. Never kept: it stops working within minutes. */
export type DocumentLink = { url: string };

// --- Titles -----------------------------------------------------------------

export const DOCUMENT_TITLE_MAX = 120;

/** One line, single spaces. Control characters (a pasted NUL, an escape) count as spaces. */
export const tidyTitle = (text: string) => text.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();

/** "pdf" for "Devis.PDF"; "" when the name has no extension. */
export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename.trim());
  // "Plan v1.2" has no extension: an extension has a letter in it.
  return match && /[a-z]/i.test(match[1]) ? match[1].toLowerCase() : "";
}

/** A document's first title: its file name without the extension. */
export function titleFromFilename(filename: string): string {
  const extension = extensionOf(filename);
  const base = extension ? filename.trim().slice(0, -(extension.length + 1)) : filename;
  // Underscores stand for spaces in file names; a title is read by people.
  const title = tidyTitle(base.replace(/_+/g, " "));
  if (title.length <= DOCUMENT_TITLE_MAX) return title || "Document";
  // Too long: cut at the end of a word, unless that would lose much of it.
  const cut = title.slice(0, DOCUMENT_TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > DOCUMENT_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

/** The name the file takes when it is saved on a device: its title, with its extension. */
export function downloadName(title: string, filename: string): string {
  const extension = extensionOf(filename);
  const safe = tidyTitle(title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")).replace(/[. ]+$/, "");
  if (!safe) return filename;
  if (!extension || safe.toLowerCase().endsWith(`.${extension}`)) return safe;
  return `${safe}.${extension}`;
}

/**
 * Storage keeps the first 200 characters of a file's name. A longer name is
 * cut before its extension, which is what says what the file is.
 */
export function fitFilename(filename: string, max = 200): string {
  if (filename.length <= max) return filename;
  const extension = extensionOf(filename);
  const end = extension ? `.${extension}` : "";
  return filename.slice(0, max - end.length) + end;
}

// --- Accepted files ---------------------------------------------------------

export type DocumentKind =
  "pdf" | "image" | "word" | "sheet" | "slides" | "text" | "drawing" | "archive" | "other";

type FileType = {
  kind: DocumentKind;
  /** What a person calls it. */
  label: string;
  /** The type announced to storage, which serves the file back under it. */
  contentType: string;
  /** Browsers show it themselves, in a tab. */
  inline?: true;
};

const OFFICE = "application/vnd.openxmlformats-officedocument";

// A file is recognised by its extension: browsers do not agree on the type of
// a DWG or a ZIP, and report none for files the device does not know.
const FILE_TYPES: Record<string, FileType> = {
  pdf: { kind: "pdf", label: "PDF", contentType: "application/pdf", inline: true },
  jpg: { kind: "image", label: "Image", contentType: "image/jpeg", inline: true },
  jpeg: { kind: "image", label: "Image", contentType: "image/jpeg", inline: true },
  png: { kind: "image", label: "Image", contentType: "image/png", inline: true },
  webp: { kind: "image", label: "Image", contentType: "image/webp", inline: true },
  heic: { kind: "image", label: "Image", contentType: "image/heic" },
  heif: { kind: "image", label: "Image", contentType: "image/heif" },
  doc: { kind: "word", label: "Word", contentType: "application/msword" },
  docx: {
    kind: "word",
    label: "Word",
    contentType: `${OFFICE}.wordprocessingml.document`,
  },
  xls: { kind: "sheet", label: "Excel", contentType: "application/vnd.ms-excel" },
  xlsx: { kind: "sheet", label: "Excel", contentType: `${OFFICE}.spreadsheetml.sheet` },
  csv: { kind: "sheet", label: "CSV", contentType: "text/csv" },
  ppt: { kind: "slides", label: "PowerPoint", contentType: "application/vnd.ms-powerpoint" },
  pptx: {
    kind: "slides",
    label: "PowerPoint",
    contentType: `${OFFICE}.presentationml.presentation`,
  },
  txt: { kind: "text", label: "Texte", contentType: "text/plain" },
  dwg: { kind: "drawing", label: "DWG", contentType: "image/vnd.dwg" },
  dxf: { kind: "drawing", label: "DXF", contentType: "application/dxf" },
  zip: { kind: "archive", label: "ZIP", contentType: "application/zip" },
};

const UNKNOWN: FileType = {
  kind: "other",
  label: "Fichier",
  contentType: "application/octet-stream",
};

const knownType = (filename: string): FileType | undefined => {
  const extension = extensionOf(filename);
  return Object.hasOwn(FILE_TYPES, extension) ? FILE_TYPES[extension] : undefined;
};

/** What a file is, from its name. */
export const fileTypeOf = (filename: string): FileType => knownType(filename) ?? UNKNOWN;

/** PDFs and common images open in a tab; the rest is saved on the device. */
export const opensInBrowser = (filename: string) => fileTypeOf(filename).inline === true;

export const DOCUMENT_MAX_SIZE = 200 * 1024 * 1024;

/** For a file picker's `accept`. */
export const DOCUMENT_ACCEPT = Object.keys(FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

/** Said whenever a file is refused. */
export const ACCEPTED_FILES_LABEL =
  "Fichiers acceptés : PDF, images (JPEG, PNG, WebP, HEIC), Word, Excel, PowerPoint, texte, CSV, DWG, DXF et ZIP, de 200 Mo au plus.";

export type FileProblem = "type" | "size" | "empty";

export const FILE_PROBLEM_LABELS: Record<FileProblem, string> = {
  type: "Type de fichier non accepté",
  size: "Fichier de plus de 200 Mo",
  empty: "Fichier vide",
};

/** Why a file cannot become a document, or null when it can. */
export function fileProblem(file: { name: string; size: number }): FileProblem | null {
  if (!knownType(file.name)) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > DOCUMENT_MAX_SIZE) return "size";
  return null;
}
