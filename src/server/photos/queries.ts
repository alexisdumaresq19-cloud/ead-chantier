import { and, desc, eq, gte, lt, lte, or, sql as raw } from "drizzle-orm";

import { SITE_TIME_ZONE, siteDay, siteDayBounds, type Photo, type PhotoDay } from "@/shared/photos";
import { canManageProject } from "@/shared/roles";

import type { SessionUser } from "../auth";
import { db, schema } from "../db/client";
import { notFound } from "../http";
import { storage } from "../storage";

export type PhotoRow = typeof schema.photos.$inferSelect;

/** Its author, and those who manage the project, may change or remove a photo. */
export const canEditPhoto = (row: PhotoRow, user: SessionUser) =>
  row.createdBy === user.id || canManageProject(user.role);

export function photoDto(row: PhotoRow, authorName: string | null, user: SessionUser): Photo {
  return {
    id: row.id,
    url: storage().publicUrl(`${row.imageKey}/full.jpg`),
    thumbUrl: storage().publicUrl(`${row.imageKey}/thumb.webp`),
    width: row.width,
    height: row.height,
    takenAt: row.takenAt.toISOString(),
    day: siteDay(row.takenAt),
    caption: row.caption,
    authorId: row.createdBy,
    authorName,
    canEdit: canEditPhoto(row, user),
  };
}

/** The photo's record. Whoever asks must then be checked against its project. */
export async function photoRow(id: string): Promise<PhotoRow> {
  const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, id)).limit(1);
  if (!row) throw notFound("Photo introuvable.");
  return row;
}

/** One photo as the app shows it, with its author's name. */
export async function photoOf(row: PhotoRow, user: SessionUser): Promise<Photo> {
  let authorName: string | null = null;
  if (row.createdBy) {
    const [author] = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, row.createdBy))
      .limit(1);
    authorName = author?.name ?? null;
  }
  return photoDto(row, authorName, user);
}

export type PhotoListOptions = {
  /** Only that day at the site. */
  day?: string;
  /** Resume after the photo taken at that moment with that id. */
  before?: { takenAt: Date; id: string };
  limit: number;
};

/** A project's photos, newest first. */
export async function listPhotos(
  user: SessionUser,
  projectId: string,
  { day, before, limit }: PhotoListOptions,
): Promise<Photo[]> {
  const bounds = day ? siteDayBounds(day) : null;
  const rows = await db
    .select({ photo: schema.photos, authorName: schema.users.name })
    .from(schema.photos)
    .leftJoin(schema.users, eq(schema.users.id, schema.photos.createdBy))
    .where(
      and(
        eq(schema.photos.projectId, projectId),
        bounds ? gte(schema.photos.takenAt, bounds.from) : undefined,
        bounds ? lt(schema.photos.takenAt, bounds.to) : undefined,
        // Photos taken in the same instant are told apart by their id. The
        // first condition alone lets the (project, taken_at) index find the page.
        before ? lte(schema.photos.takenAt, before.takenAt) : undefined,
        before
          ? or(lt(schema.photos.takenAt, before.takenAt), lt(schema.photos.id, before.id))
          : undefined,
      ),
    )
    .orderBy(desc(schema.photos.takenAt), desc(schema.photos.id))
    .limit(limit);
  return rows.map((row) => photoDto(row.photo, row.authorName, user));
}

/** The days that have photos, newest first, counted on the site's clock. */
export async function listPhotoDays(projectId: string): Promise<PhotoDay[]> {
  // The zone is written into the query (it is a constant of the app): as a
  // parameter, Postgres would not see that the grouping is the selected column.
  const zone = raw.raw(`'${SITE_TIME_ZONE}'`);
  const day = raw<string>`to_char(${schema.photos.takenAt} at time zone ${zone}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, count: raw<number>`count(*)::int` })
    .from(schema.photos)
    .where(eq(schema.photos.projectId, projectId))
    .groupBy(day)
    .orderBy(desc(day));
  return rows;
}
