import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/server/env";
import { verifySignature } from "@/server/ids";
import { fsPath } from "@/server/storage/fs";
import type { Bucket } from "@/server/storage";

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

export async function PUT(request: NextRequest, { params }: Context) {
  if (env.storageDriver !== "fs") return gone();
  const [action, bucket, ...rest] = (await params).path;
  const key = rest.join("/");
  if (action !== "upload" || (bucket !== "public" && bucket !== "private") || !key) return gone();
  const expires = Number(request.nextUrl.searchParams.get("e"));
  const signature = request.nextUrl.searchParams.get("s") ?? "";
  if (!(expires > Date.now()) || !verifySignature(`put:${bucket}:${key}:${expires}`, signature)) {
    return new NextResponse(null, { status: 403 });
  }
  const path = fsPath(bucket as Bucket, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await request.arrayBuffer()));
  return NextResponse.json({ ok: true });
}
