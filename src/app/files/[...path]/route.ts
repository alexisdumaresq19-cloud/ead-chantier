import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/server/env";
import { verifySignature } from "@/server/ids";
import { plainType } from "@/server/storage";
import { fsPath, fsUploadPayload } from "@/server/storage/fs";

// Serves and receives files when they are kept on disk (development). With
// hosted storage these addresses do not exist: files go straight to it.

const TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".json": "application/json",
};

type Context = { params: Promise<{ path: string[] }> };

const gone = () => new NextResponse(null, { status: 404 });

export async function GET(request: NextRequest, { params }: Context) {
  if (env.storageDriver !== "fs") return gone();
  const [bucket, ...rest] = (await params).path;
  const key = rest.join("/");
  if ((bucket !== "public" && bucket !== "private") || !key) return gone();

  const query = request.nextUrl.searchParams;
  if (bucket === "private") {
    const expires = Number(query.get("e"));
    if (
      !(expires > Date.now()) ||
      !verifySignature(`get:private:${key}:${expires}`, query.get("s") ?? "")
    ) {
      return new NextResponse(null, { status: 403 });
    }
  }

  let path: string;
  let size: number;
  try {
    path = fsPath(bucket, key);
    size = (await stat(path)).size;
  } catch {
    return gone();
  }
  const headers = new Headers({
    "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "content-length": String(size),
    "cache-control":
      bucket === "public" ? "public, max-age=31536000, immutable" : "private, max-age=300",
    "x-content-type-options": "nosniff",
  });
  const name = query.get("n");
  if (bucket === "private") {
    const disposition = query.get("i") ? "inline" : "attachment";
    headers.set(
      "content-disposition",
      name ? `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}` : disposition,
    );
  }
  return new NextResponse(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
}

/**
 * Receives one file sent with an upload link. Like a hosted link, it writes
 * once. Unlike one, it also holds the sender to what was announced when the
 * link was made: that type, and not a byte more than that size (a shorter
 * file is caught when the upload is confirmed).
 */
export async function PUT(request: NextRequest, { params }: Context) {
  if (env.storageDriver !== "fs") return gone();
  const [action, bucket, ...rest] = (await params).path;
  const key = rest.join("/");
  if (action !== "upload" || (bucket !== "public" && bucket !== "private") || !key) return gone();
  const query = request.nextUrl.searchParams;
  const expires = Number(query.get("e"));
  const size = Number(query.get("z"));
  const type = query.get("t") ?? "";
  const payload = fsUploadPayload(bucket, key, expires, size, type);
  if (!(expires > Date.now()) || !verifySignature(payload, query.get("s") ?? "")) {
    return new NextResponse(null, { status: 403 });
  }
  if (plainType(request.headers.get("content-type") ?? "") !== plainType(type)) {
    return new NextResponse(null, { status: 415 });
  }
  // Refused on its announced length when there is one, and in any case no
  // more than `size` bytes are ever read.
  if (Number(request.headers.get("content-length") ?? 0) > size) return tooLarge();
  const data = await readUpTo(request, size);
  if (!data) return tooLarge();

  const path = fsPath(bucket, key);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, data, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return new NextResponse(null, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

const tooLarge = () => new NextResponse(null, { status: 413 });

/** The request's body, or null as soon as it runs past `limit` bytes. */
async function readUpTo(request: NextRequest, limit: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}
