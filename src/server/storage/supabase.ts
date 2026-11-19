import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "../env";
import type { Bucket, BucketRules, Storage, StoredFile } from "./index";

// Production storage: Supabase Storage, reached with the service key (server
// only). Browsers upload through signed links that write once and read
// private files through short-lived signed links.

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

// The service's errors carry the HTTP status and, depending on its version,
// its own code in `statusCode` or `code`. Read as plain fields: an error that
// crossed a bundle boundary is not an `instanceof` the class imported here.
type ServiceError = { message: string; status?: number; statusCode?: string; code?: string };

/** Storage's way of saying there is no such file, in its older and newer forms. */
function isMissing(error: ServiceError): boolean {
  return (
    error.code === "NoSuchKey" ||
    error.status === 404 ||
    error.statusCode === "404" ||
    /not found/i.test(error.message)
  );
}

type BucketApi = Pick<SupabaseClient["storage"], "createBucket" | "updateBucket">;
type BucketOptions = { public: boolean; fileSizeLimit: number | null; allowedMimeTypes: string[] };

const alreadyExists = (error: ServiceError) =>
  /already exists/i.test(error.message) || error.status === 409 || error.statusCode === "409";

/** Creates the bucket with these settings, or gives them to the one that exists. */
async function applyBucket(api: BucketApi, name: string, options: BucketOptions) {
  const created = await api.createBucket(name, options);
  if (!created.error) return null;
  if (!alreadyExists(created.error)) return created.error;
  return (await api.updateBucket(name, options)).error;
}

/**
 * Makes sure the two buckets exist and only take what the app stores: a size
 * limit per file and a list of file types, applied by storage itself to
 * every upload, the browsers' signed links included. Buckets created by an
 * earlier deployment are brought to the same settings. Run at deployment.
 *
 * A bucket's size limit may not exceed the Supabase project's own ("global")
 * limit, and the service refuses it when it does. The deployment then goes on
 * without the bucket limit, with a warning: the global limit still applies.
 */
export async function ensureBuckets(rules: BucketRules, api: BucketApi = supabase().storage) {
  for (const bucket of ["public", "private"] as const) {
    const name = BUCKETS[bucket];
    const { fileSizeLimit, allowedMimeTypes } = rules[bucket];
    const options = { public: bucket === "public", fileSizeLimit, allowedMimeTypes };
    const refused = await applyBucket(api, name, options);
    if (!refused) continue;
    const unlimited = await applyBucket(api, name, { ...options, fileSizeLimit: null });
    if (unlimited) fail(`bucket ${name}`, refused);
    const megabytes = Math.round(fileSizeLimit / (1024 * 1024));
    console.warn(
      `ATTENTION : le stockage a refusé la limite de ${megabytes} Mo par fichier pour le compartiment « ${name} » (${refused.message}). ` +
        "Le compartiment est prêt sans cette limite : seule la limite globale du projet Supabase s'applique. " +
        `Si elle est plus basse que ${megabytes} Mo, les fichiers plus gros seront refusés à l'envoi : augmentez-la dans les réglages de stockage du projet Supabase, puis redéployez.`,
    );
  }
}

export function supabaseStorage(using?: Pick<SupabaseClient, "storage">): Storage {
  const from = (bucket: Bucket) => (using ?? supabase()).storage.from(BUCKETS[bucket]);

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

  // Only a missing file answers null. Any other failure is an error: "the
  // file is not there" must not be concluded from storage being unreachable.
  async function stat(bucket: Bucket, key: string): Promise<StoredFile | null> {
    const { data, error } = await from(bucket).info(key);
    if (error) {
      if (isMissing(error)) return null;
      fail("info", error);
    }
    if (typeof data.size !== "number") fail("info", { message: "taille inconnue" });
    return { size: data.size, contentType: data.contentType ?? null };
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
    stat,
    async size(bucket, key) {
      return (await stat(bucket, key))?.size ?? null;
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
      // Signed without "upsert": the link writes the file once and is refused
      // while a file is there, for the two hours Supabase keeps it valid. The
      // browser sends the file itself as the body of a PUT, with these
      // headers; storage records the type from the content-type header and
      // applies the bucket's limits (it knows nothing of the announced size).
      const { data, error } = await from(bucket).createSignedUploadUrl(key);
      if (error) fail("createSignedUploadUrl", error);
      return {
        url: data.signedUrl,
        method: "PUT",
        headers: { "content-type": contentType, "cache-control": "max-age=3600" },
      };
    },
  };
}
