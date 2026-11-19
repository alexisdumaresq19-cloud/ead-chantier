import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "../env";
import type { Bucket, Storage } from "./index";

// Production storage: Supabase Storage, reached with the service key (server
// only). Browsers upload through one-time signed links and read private
// files through short-lived signed links.

const BUCKETS: Record<Bucket, string> = { public: "ead-public", private: "ead-private" };
const YEAR = 31_536_000;

let client: SupabaseClient | undefined;
const supabase = () =>
  (client ??= createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false },
  }));

function fail(action: string, error: { message: string }): never {
  throw new Error(`Stockage (${action}) : ${error.message}`);
}

/** Creates the two buckets if they do not exist yet. Run at deployment. */
export async function ensureBuckets() {
  for (const [bucket, name] of Object.entries(BUCKETS)) {
    const { error } = await supabase().storage.createBucket(name, { public: bucket === "public" });
    if (error && !/already exists/i.test(error.message)) fail("createBucket", error);
  }
}

export function supabaseStorage(): Storage {
  const from = (bucket: Bucket) => supabase().storage.from(BUCKETS[bucket]);

  async function listAll(bucket: Bucket, prefix: string): Promise<string[]> {
    const files: string[] = [];
    const folders = [prefix.replace(/\/$/, "")];
    while (folders.length) {
      const folder = folders.pop()!;
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await from(bucket).list(folder, { limit: 1000, offset });
        if (error) fail("list", error);
        for (const entry of data) {
          const path = `${folder}/${entry.name}`;
          // Folders come back without an id.
          if (entry.id === null) folders.push(path);
          else files.push(path);
        }
        if (data.length < 1000) break;
      }
    }
    return files;
  }

  return {
    async put(bucket, key, data, { contentType, immutable }) {
      const { error } = await from(bucket).upload(key, data, {
        contentType,
        cacheControl: String(immutable ? YEAR : 3600),
        upsert: true,
      });
      if (error) fail("upload", error);
    },
    async get(bucket, key) {
      const { data, error } = await from(bucket).download(key);
      if (error) fail("download", error);
      return Buffer.from(await data.arrayBuffer());
    },
    async size(bucket, key) {
      const { data, error } = await from(bucket).info(key);
      if (error || !data) return null;
      return data.size ?? null;
    },
    async removePrefix(bucket, prefix) {
      const files = await listAll(bucket, prefix);
      for (let i = 0; i < files.length; i += 500) {
        const { error } = await from(bucket).remove(files.slice(i, i + 500));
        if (error) fail("remove", error);
      }
    },
    publicUrl(key) {
      return `${env.supabaseUrl}/storage/v1/object/public/${BUCKETS.public}/${key}`;
    },
    async downloadUrl(key, options = {}) {
      const { data, error } = await from("private").createSignedUrl(
        key,
        options.expiresIn ?? 3600,
        {
          download: options.inline ? undefined : (options.filename ?? true),
        },
      );
      if (error) fail("createSignedUrl", error);
      return data.signedUrl;
    },
    async uploadTarget(bucket, key, { contentType }) {
      const { data, error } = await from(bucket).createSignedUploadUrl(key, { upsert: true });
      if (error) fail("createSignedUploadUrl", error);
      return {
        url: data.signedUrl,
        method: "PUT",
        headers: {
          "content-type": contentType,
          "cache-control": "max-age=3600",
          "x-upsert": "true",
        },
      };
    },
  };
}
