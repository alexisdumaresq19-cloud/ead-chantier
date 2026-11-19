import { env } from "../env";
import { fsStorage } from "./fs";
import { supabaseStorage } from "./supabase";

// Where files live. Two buckets:
//  - "private": originals (PDFs, documents). Read through short-lived signed
//    links handed out after an access check.
//  - "public": plan tiles, thumbnails and photos, under unguessable folder
//    names. They are served straight from the CDN with no login check, which
//    is what makes plans open instantly and lets phones keep them offline.

export type Bucket = "public" | "private";

/** How a browser sends a file straight to storage. */
export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

export interface Storage {
  put(
    bucket: Bucket,
    key: string,
    data: Buffer,
    options: { contentType: string; immutable?: boolean },
  ): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Buffer>;
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
  uploadTarget(
    bucket: Bucket,
    key: string,
    options: { contentType: string },
  ): Promise<UploadTarget>;
}

let instance: Storage | undefined;

export function storage(): Storage {
  return (instance ??= env.storageDriver === "supabase" ? supabaseStorage() : fsStorage());
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
