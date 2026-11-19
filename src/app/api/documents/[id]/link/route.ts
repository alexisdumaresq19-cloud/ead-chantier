import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth";
import { documentFor } from "@/server/documents";
import { route } from "@/server/http";
import { storage } from "@/server/storage";
import { downloadName, opensInBrowser, type DocumentLink } from "@/shared/documents";

// Long enough to open a large file on a slow connection (the link only has
// to be valid when the download starts), too short to be worth passing around.
const LINK_SECONDS = 15 * 60;

/**
 * A link to the file, made when the person opens the document. PDFs and
 * images show in the browser; other files are saved under the document's title.
 */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const { row, document } = await documentFor(user, id);
  const url = await storage().downloadUrl(row.upload.storageKey, {
    filename: downloadName(document.title, document.filename),
    inline: opensInBrowser(document.filename),
    expiresIn: LINK_SECONDS,
  });
  // The link is a key to the file: no cache, on the device or on the way, keeps it.
  return NextResponse.json({ url } satisfies DocumentLink, {
    headers: { "cache-control": "no-store" },
  });
});
