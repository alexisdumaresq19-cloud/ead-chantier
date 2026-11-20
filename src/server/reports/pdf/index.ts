import { eq } from "drizzle-orm";
import sharp from "sharp";

import type { Project } from "../../access";
import { db, schema } from "../../db/client";
import { photoRowsByIds, type PhotoRow } from "../../photos/queries";
import { storage } from "../../storage";
import { contentOf, type ReportRow } from "../queries";
import { renderReportPdf, type PageImage, type ReportPdfPhoto } from "./document";

// From a saved report to its PDF: the report's own words, its author, and
// its photos fetched from storage and made as small as a printed page needs.

/** The longest side of a photo on the page: sharp at the size it is printed, light to send. */
const PHOTO_SIDE = 1100;
const PHOTO_QUALITY = 75;
/**
 * Photos fetched and redrawn at a time, whatever their number: a report of
 * forty photos never holds more than a few originals at once.
 */
const AT_ONCE = 3;

async function pageImage(row: PhotoRow): Promise<PageImage | null> {
  try {
    const original = await storage().get("public", `${row.imageKey}/full.jpg`);
    const { data, info } = await sharp(original, { failOn: "none" })
      .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      // Baseline JPEG: every viewer, old ones included, draws it.
      .jpeg({ quality: PHOTO_QUALITY, progressive: false, chromaSubsampling: "4:2:0" })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height };
  } catch (error) {
    // A photo that cannot be read is left out: the report is still worth having.
    console.error("report pdf: photo", row.id, error);
    return null;
  }
}

/** Runs the tasks given to it at most `atOnce` at a time, in the order they were asked for. */
function turns(atOnce: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= atOnce) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

async function authorOf(row: ReportRow) {
  if (!row.createdBy) return null;
  const [author] = await db
    .select({ name: schema.users.name, title: schema.users.title })
    .from(schema.users)
    .where(eq(schema.users.id, row.createdBy))
    .limit(1);
  return author ?? null;
}

/** The report's PDF. Whoever asks has been checked against its project already. */
export async function reportPdf(
  row: ReportRow,
  project: Pick<Project, "number" | "name" | "client" | "address" | "city">,
): Promise<Buffer> {
  const [author, photoRows] = await Promise.all([
    authorOf(row),
    photoRowsByIds(row.projectId, row.photoIds),
  ]);
  const inTurn = turns(AT_ONCE);
  const photos: ReportPdfPhoto[] = photoRows.map(({ photo }) => ({
    width: photo.width,
    height: photo.height,
    caption: photo.caption,
    takenAt: photo.takenAt,
    image: () => inTurn(() => pageImage(photo)),
  }));
  return renderReportPdf({
    ...contentOf(row),
    project: {
      number: project.number,
      name: project.name,
      client: project.client,
      address: project.address,
      city: project.city,
    },
    author,
    photos,
    writtenAt: row.createdAt,
    changedAt: row.updatedAt,
    producedAt: new Date(),
  });
}
