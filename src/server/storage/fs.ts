import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { env } from "../env";
import { sign } from "../ids";
import type { Bucket, Storage } from "./index";

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

/** Signature of a private link or an upload link, valid until `expires`. */
export function fsSignature(
  action: "get" | "put",
  bucket: Bucket,
  key: string,
  expires: number,
): string {
  return sign(`${action}:${bucket}:${key}:${expires}`);
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
    async size(bucket, key) {
      try {
        return (await stat(fsPath(bucket, key))).size;
      } catch {
        return null;
      }
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
    async uploadTarget(bucket, key, { contentType }) {
      const expires = Date.now() + 2 * 3600 * 1000;
      const query = new URLSearchParams({
        e: String(expires),
        s: fsSignature("put", bucket, key, expires),
      });
      return {
        url: `/files/upload/${bucket}/${key}?${query}`,
        method: "PUT",
        headers: { "content-type": contentType },
      };
    },
  };
}
