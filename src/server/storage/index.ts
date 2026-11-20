import { env } from "../env";
import { fsStorage } from "./fs";
import { supabaseStorage } from "./supabase";

// Where files live. Two buckets:
//  - "private": originals (PDFs, documents). Read through short-lived signed
//    links handed out after an access check.
//  - "public": plan tiles, thumbnails and photos, under unguessable folder
//    names. They are served straight from the CDN with no login check, which
//    is what makes plans open instantly and lets phones keep them offline.
// In production each bucket only takes the file types and sizes listed in
// BUCKET_RULES (src/server/uploads.ts), whoever writes: a new kind of file
// written by the server has to be added there.

export type Bucket = "public" | "private";

/** How a browser sends a file straight to storage. */
export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

/** What storage holds under a key. */
export type StoredFile = {
  size: number;
  /**
   * The type storage recorded when the file arrived (the sender's
   * content-type header). Null only for a store that keeps none: the
   * development folder, whose file route refuses any other type than the
   * announced one. Hosted storage always has one, and its driver fails
   * rather than answer null: null skips the comparison in completeUpload.
   */
  contentType: string | null;
};

/** What a bucket accepts, enforced by hosted storage itself. */
export type BucketRules = Record<Bucket, { fileSizeLimit: number; allowedMimeTypes: string[] }>;

export interface Storage {
  put(
    bucket: Bucket,
    key: string,
    data: Buffer,
    options: { contentType: string; immutable?: boolean },
  ): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Buffer>;
  /** What is stored under this key, or null if there is no such file. */
  stat(bucket: Bucket, key: string): Promise<StoredFile | null>;
  /** Size in bytes, or null if there is no such file. */
  size(bucket: Bucket, key: string): Promise<number | null>;
  removePrefix(bucket: Bucket, prefix: string): Promise<void>;
  /** Address of a file of the public bucket. */
  publicUrl(key: string): string;
  /** A link to a private file that works for a short while. */
  downloadUrl(
    key: string,
    options?: { filename?: string; inline?: boolean; expiresIn?: number },
  ): Promise<string>;
  /**
   * A link a browser sends one file to, for two hours. It writes once: it
   * cannot replace a file that is already there, so a file that has been
   * checked (completeUpload) stays the file that was checked, for as long as
   * it is there. Once that file is deleted the link writes again, until it
   * expires: an upload's file is therefore deleted only by uploads.ts
   * (discardUpload for a module), which keeps count of what the link may
   * still store. The link itself does not hold the sender to the announced
   * type and size, except in the development folder; hosted storage only
   * applies the bucket's own limits, which is why completeUpload compares
   * what arrived with what was announced.
   */
  uploadTarget(
    bucket: Bucket,
    key: string,
    options: { contentType: string; size: number },
  ): Promise<UploadTarget>;
}

let instance: Storage | undefined;

export function storage(): Storage {
  return (instance ??= env.storageDriver === "supabase" ? supabaseStorage() : fsStorage());
}

/** A content type as storage compares it: "Image/JPEG; q=1" is "image/jpeg". */
export function plainType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/** Keeps a file name readable but harmless as a storage key. */
export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(-120);
  return cleaned || "fichier";
}
