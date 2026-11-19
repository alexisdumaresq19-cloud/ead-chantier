// Site photos, as exchanged between the app and its API.
//
//   GET    /api/projects/:id/photos?day=2026-10-01     the project's photos, newest first
//                                                      (day is optional: only that day's)
//   POST   /api/projects/:id/photos                    { uploadId, takenAt?, caption? }
//   PATCH  /api/photos/:id                             { caption }
//   DELETE /api/photos/:id

export type Photo = {
  id: string;
  /** The full image, sized for a screen (JPEG). */
  url: string;
  /** A small square-ish preview (WebP). */
  thumbUrl: string;
  width: number;
  height: number;
  /** When it was taken, ISO 8601. */
  takenAt: string;
  /** The day it was taken at the site, "2026-10-01". */
  day: string;
  caption: string | null;
  authorId: string | null;
  authorName: string | null;
  /** The signed-in person may change or remove it. */
  canEdit: boolean;
};
