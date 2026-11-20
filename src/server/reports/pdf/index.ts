import sharp from "sharp";

import type { Project } from "../../access";
import { photoRowsByIds, type PhotoRow } from "../../photos/queries";
import { storage } from "../../storage";
import { authorName, contentOf, type ReportRow } from "../queries";
import { renderReportPdf, type ReportPdfPhoto } from "./document";

// From a saved report to its PDF: the report's own words, and its photos
// fetched from storage and made as small as a printed page needs.

/** The longest side of a photo on the page: sharp at the size it is printed, light to send. */
const PHOTO_SIDE = 1100;
/** Photos fetched and redrawn at a time. */
const AT_ONCE = 6;

async function photoForPage(row: PhotoRow): Promise<ReportPdfPhoto | null> {
  try {
    const original = await storage().get("public", `${row.imageKey}/full.jpg`);
    const { data, info } = await sharp(original, { failOn: "none" })
      .resize({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 76 })
      .toBuffer({ resolveWithObject: true });
    return {
      jpeg: data,
      width: info.width,
      height: info.height,
      caption: row.caption,
      takenAt: row.takenAt,
    };
  } catch (error) {
    // A photo that cannot be read is left out: the report is still worth having.
    console.error("report pdf: photo", row.id, error);
    return null;
  }
}

/** Runs `task` over the items, a few at a time, and keeps their order. */
async function inTurns<T, R>(items: T[], atOnce: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, worker));
  return results;
}

/** The report's PDF. Whoever asks has been checked against its project already. */
export async function reportPdf(
  row: ReportRow,
  project: Pick<Project, "number" | "name">,
): Promise<Buffer> {
  const [name, photoRows] = await Promise.all([
    authorName(row),
    photoRowsByIds(row.projectId, row.photoIds),
  ]);
  const photos = await inTurns(photoRows, AT_ONCE, ({ photo }) => photoForPage(photo));
  return renderReportPdf({
    ...contentOf(row),
    project: { number: project.number, name: project.name },
    authorName: name,
    photos: photos.filter((photo) => photo !== null),
    producedAt: new Date(),
  });
}
