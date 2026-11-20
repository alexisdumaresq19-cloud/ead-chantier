import { fileViewerPlugin, filesystemPlugin, pluginError, sharePlugin } from "./plugins";

// Files in the iPhone app. The web view hands a new tab or a window.open()
// to Safari, where the person is not signed in; it cancels a navigation to a
// blob: address, ignores a download link and does nothing on window.print().
// So a file is written to the app's cache and handed to the system: its
// viewer (Quick Look, whose own share button prints and saves), or the share
// sheet (Messages, Mail, Teams, "Enregistrer dans Fichiers", "Imprimer").

/** The cache folder the app writes its files to; emptied at each launch. */
export const CACHE_FOLDER = "ead-fichiers";

/** A name iOS accepts as a file name, keeping what the person will read. */
export function cacheName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+/, "")
    .trim();
  if (!clean) return "fichier";
  if (clean.length <= 120) return clean;
  // Long titles lose their middle, never their extension.
  const dot = clean.lastIndexOf(".");
  const extension = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
  return clean.slice(0, 120 - extension.length).trimEnd() + extension;
}

/** Bytes encoded at a time: a multiple of 3, so the pieces of base64 join up. */
const SLICE = 3 * 0x4000;

/** The file's bytes as base64, the only form the bridge carries. */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pieces: string[] = [];
  // Slice by slice: a 25 MB document never also exists as one string of
  // its raw bytes, and one call with every byte as an argument would
  // overflow the stack.
  for (let start = 0; start < bytes.length; start += SLICE)
    pieces.push(btoa(String.fromCharCode(...bytes.subarray(start, start + SLICE))));
  return pieces.join("");
}

let written = 0;

/**
 * Writes a file to the app's cache under its own name, in a folder of its
 * own (two files may share a name). Returns its file:// address.
 */
export async function cacheFile(blob: Blob, name: string): Promise<string> {
  const { Filesystem, Directory } = await filesystemPlugin();
  written += 1;
  const { uri } = await Filesystem.writeFile({
    path: `${CACHE_FOLDER}/${Date.now().toString(36)}-${written}/${cacheName(name)}`,
    data: await toBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  return uri;
}

/** Files of an earlier launch: shown and shared long ago, they only take room. */
export async function clearCachedFiles() {
  try {
    const { Filesystem, Directory } = await filesystemPlugin();
    await Filesystem.rmdir({ path: CACHE_FOLDER, directory: Directory.Cache, recursive: true });
  } catch {
    // Nothing there yet.
  }
}

/** "/var/…/Caches/x y.pdf" from "file:///var/…/Caches/x%20y.pdf". */
export const plainPath = (uri: string) =>
  uri.startsWith("file://") ? decodeURIComponent(new URL(uri).pathname) : uri;

/** The viewer's codes for a path it could not find or open (FileViewerError.swift). */
const NOT_FOUND = new Set(["OS-PLUG-FLVW-0004", "OS-PLUG-FLVW-0008"]);

/** Shows a file in the system's viewer, from which it can also be shared or printed. */
export async function openFile(blob: Blob, name: string): Promise<void> {
  const uri = await cacheFile(blob, name);
  const { FileViewer: viewer } = await fileViewerPlugin();
  try {
    await viewer.openDocumentFromLocalPath({ path: uri });
  } catch (error) {
    // The viewer's library reads "full absolute path" its own way: a file
    // address first, a plain path if it could not find the file by it.
    const code = pluginError(error).code;
    if (!code || !NOT_FOUND.has(code)) throw error;
    await viewer.openDocumentFromLocalPath({ path: plainPath(uri) });
  }
}

/**
 * Shows a file the viewer downloads itself, from an address that needs no
 * session (a signed link to storage). Used when the page cannot read it.
 */
export async function openFileAt(url: string): Promise<void> {
  const { FileViewer: viewer } = await fileViewerPlugin();
  await viewer.openDocumentFromUrl({ url });
}

/** How a share ended. Closing the sheet is not a failure. */
export type ShareOutcome = "shared" | "closed";

const closedSheet = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  /cancel/i.test(pluginError(error).message ?? "");

/**
 * Hands a file to the share sheet: through the web view's own sharing when
 * it takes files, else through the shell's, from a copy in the cache.
 */
export async function shareFile(
  file: File,
  details: { title?: string; text?: string } = {},
): Promise<ShareOutcome> {
  let webShare = false;
  try {
    webShare =
      typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    webShare = false;
  }
  if (webShare) {
    try {
      await navigator.share({ files: [file], ...details });
      return "shared";
    } catch (error) {
      if (closedSheet(error)) return "closed";
      // Refused (the tap is too far back, after a fetch): the shell's sheet needs no tap.
    }
  }
  const uri = await cacheFile(file, file.name);
  const { Share: share } = await sharePlugin();
  try {
    await share.share({ files: [uri], title: details.title, text: details.text });
    return "shared";
  } catch (error) {
    if (closedSheet(error)) return "closed";
    throw error;
  }
}

/** Hands a link (with a few words) to the share sheet. */
export async function shareLinkNatively(data: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<ShareOutcome> {
  const { Share: share } = await sharePlugin();
  try {
    await share.share(data);
    return "shared";
  } catch (error) {
    if (closedSheet(error)) return "closed";
    throw error;
  }
}

/** The name a server's answer gives its file (Content-Disposition), if any. */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // A broken encoding: the plain name, if there is one.
    }
  }
  const plain =
    /filename\s*=\s*"([^"]*)"/i.exec(disposition) ?? /filename\s*=\s*([^;]+)/i.exec(disposition);
  return plain ? plain[1].trim() || null : null;
}
