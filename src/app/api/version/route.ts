import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { route } from "@/server/http";

// Which deployment is answering. The app asks now and then, to tell the
// person when a newer version than the one on their screen is ready
// (src/client/pwa/update.ts). Anyone may ask, signed in or not: the welcome
// screen needs it too, and the answer says nothing about the deployment.

/** A restarted server of the same build must keep its answer: the build's own id comes first. */
function buildId(): string | undefined {
  try {
    return readFileSync(
      join(/* turbopackIgnore: true */ process.cwd(), ".next", "BUILD_ID"),
      "utf8",
    );
  } catch {
    return undefined; // development, or a host that lays the build out differently
  }
}

const startedAt = String(Date.now());

/** Fixed for the life of this server; a digest, so no commit or host name leaves it. */
const version = createHash("sha256")
  .update(
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || buildId() || startedAt,
  )
  .digest("hex")
  .slice(0, 16);

// Answered by the running server each time, never from the build.
export const dynamic = "force-dynamic";

export const GET = route(async () =>
  NextResponse.json({ version }, { headers: { "cache-control": "no-store" } }),
);
