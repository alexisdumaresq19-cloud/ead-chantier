import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { env } from "../env";
import { sign } from "../ids";
import type { Bucket, Storage, StoredFile } from "./index";

// Development storage: a folder on disk, served by src/app/files.

export function fsRoot(): string {
  return resolve(/* turbopackIgnore: true */ process.cwd(), env.storageDir);
}

/** The file's path on disk; refuses keys that would climb out of the folder. */
export function fsPath(bucket: Bucket, key: string): string {
  const root = resolve(/* turbopackIgnore: true */ fsRoot(), bucket);
  const path = resolve(/* turbopackIgnore: true */ root, key);
  if (!path.startsWith(root + sep)) throw new Error("Clé de fichier invalide.");
  return path;
}

/** Signature of a private link, valid until `expires`. */
export function fsSignature(action: "get", bucket: Bucket, key: string, expires: number): string {
  return sign(`${action}:${bucket}:${key}:${expires}`);
}

/**
 * What an upload link is signed over: the place, the end of its validity and
 * the announced size and type, so the file route can hold the sender to them.
 */
export function fsUploadPayload(
  bucket: Bucket,
  key: string,
  expires: number,
  size: number,
  contentType: string,
): string {
  return `put:${bucket}:${key}:${expires}:${size}:${contentType}`;
}

async function fsStat(bucket: Bucket, key: string): Promise<StoredFile | null> {
  try {
    // The folder keeps no type: the file route already refused any other
    // than the announced one when the file came in.
    return { size: (await stat(fsPath(bucket, key))).size, contentType: null };
  } catch {
    return null;
  }
}

export function fsStorage(): Storage {
  return {
    async put(bucket, key, data) {
      const path = fsPath(bucket, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(bucket, key) {
      return readFile(fsPath(bucket, key));
    },
    stat: fsStat,
    async size(bucket, key) {
      return (await fsStat(bucket, key))?.size ?? null;
    },
    async removePrefix(bucket, prefix) {
      await rm(fsPath(bucket, prefix), { recursive: true, force: true });
    },
    publicUrl(key) {
      return `/files/public/${key}`;
    },
    async downloadUrl(key, options = {}) {
      const expires = Date.now() + (options.expiresIn ?? 3600) * 1000;
      const query = new URLSearchParams({
        e: String(expires),
        s: fsSignature("get", "private", key, expires),
      });
      if (options.filename) query.set("n", options.filename);
      if (options.inline) query.set("i", "1");
      return `/files/private/${key}?${query}`;
    },
    async uploadTarget(bucket, key, { contentType, size }) {
      const expires = Date.now() + 2 * 3600 * 1000;
      const query = new URLSearchParams({
        e: String(expires),
        z: String(size),
        t: contentType,
        s: sign(fsUploadPayload(bucket, key, expires, size, contentType)),
      });
      return {
        url: `/files/upload/${bucket}/${key}?${query}`,
        method: "PUT",
        headers: { "content-type": contentType },
      };
    },
  };
}
