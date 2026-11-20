import { and, asc, desc, eq, inArray, lt, sql as raw } from "drizzle-orm";
import type { z } from "zod";

import {
  crewTotals,
  excerptOf,
  isEmptyContent,
  WEATHER_CONDITIONS,
  type CrewLine,
  type DayReport,
  type Report,
  type ReportContent,
  type ReportSummary,
  type SavedReport,
  type Weather,
  type WeatherCondition,
} from "@/shared/reports";

import type { Photo } from "@/shared/photos";

import { assertOpen, projectToManage, type Project } from "../access";
import { refuseDemoUnlessAuthor } from "../access-code/rules";
import type { SessionUser } from "../auth";
import { db, schema } from "../db/client";
import type { ReportCrewLine, ReportWeather } from "../db/schema";
import { badRequest, forbidden, HttpError, notFound } from "../http";
import { newId } from "../ids";
import { photosByIds } from "../photos/queries";
import { EMPTY_REPORT, type newReport, type reportChange } from "./input";

// Daily reports: one per project and per day (the unique index
// daily_reports_project_day), written by the foremen and the office. A
// report names the photos that go with it; the photos stay the project's.

export type ReportRow = typeof schema.dailyReports.$inferSelect;
type Row = ReportRow;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const reports = schema.dailyReports;

const MISSING = "Rapport introuvable.";

function weatherDto(stored: ReportWeather): Weather {
  const condition = WEATHER_CONDITIONS.includes(stored.condition as WeatherCondition)
    ? (stored.condition as WeatherCondition)
    : null;
  return { condition, temperatureC: stored.temperatureC ?? null, note: stored.note ?? "" };
}

/** As stored: a condition that was not chosen is left out. */
const weatherRow = ({ condition, temperatureC, note }: Weather): ReportWeather => ({
  ...(condition ? { condition } : {}),
  temperatureC,
  note,
});

const crewDto = (stored: ReportCrewLine[]): CrewLine[] =>
  stored.map((line) => ({ name: line.name, hours: line.hours ?? 0, userId: line.userId ?? null }));

/** What the report says, as the screens and its PDF read it. */
export const contentOf = (row: Row): ReportContent => ({
  day: row.day,
  weather: weatherDto(row.weather),
  crew: crewDto(row.crew),
  equipment: row.equipment,
  workDone: row.workDone,
  notes: row.notes,
  photoIds: row.photoIds,
});

function reportDto(
  row: Row,
  authorName: string | null,
  user: SessionUser,
  photos: Photo[],
): Report {
  return {
    ...contentOf(row),
    id: row.id,
    projectId: row.projectId,
    authorId: row.createdBy,
    authorName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canDelete: canDelete(user, row),
    photos,
  };
}

/** What a report is shown with: who asks, and whether its project still takes changes. */
type Reader = { user: SessionUser; project: Pick<Project, "status"> };

const withAuthor = () =>
  db
    .select({ row: reports, authorName: schema.users.name })
    .from(reports)
    .leftJoin(schema.users, eq(schema.users.id, reports.createdBy));

export async function authorName(row: Row): Promise<string | null> {
  if (!row.createdBy) return null;
  const [author] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, row.createdBy))
    .limit(1);
  return author?.name ?? null;
}

/** Its author or the office. */
const canDelete = (user: SessionUser, row: Row) =>
  user.role === "admin" || row.createdBy === user.id;

/**
 * The report, for someone allowed to read it: its project is read from the
 * record. A report of a project the person does not see answers "not found",
 * like one that does not exist.
 */
export async function reportToManage(
  user: SessionUser,
  id: string,
): Promise<{ row: Row; project: Project }> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!row) throw notFound(MISSING);
  try {
    return { row, project: await projectToManage(user, row.projectId) };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw notFound(MISSING);
    throw error;
  }
}

/** Same, to change or remove it: refused once its project is archived, except to the office. */
export async function reportToChange(
  user: SessionUser,
  id: string,
): Promise<{ row: Row; project: Project }> {
  const found = await reportToManage(user, id);
  assertOpen(user, found.project);
  refuseDemoUnlessAuthor(user, found.row.createdBy);
  return found;
}

/** The report as the screens read it, with its author's name and its photos. */
export async function reportOf({ user, project }: Reader, row: Row): Promise<Report> {
  const [name, photos] = await Promise.all([
    authorName(row),
    photosByIds(user, { id: row.projectId, status: project.status }, row.photoIds),
  ]);
  return reportDto(row, name, user, photos);
}

/** Every report of the project, newest day first, as lines of a list. */
export async function listReports(projectId: string): Promise<ReportSummary[]> {
  const rows = await db
    .select({
      id: reports.id,
      day: reports.day,
      weather: reports.weather,
      crew: reports.crew,
      // The list shows a line of text: long reports are not read in full for it.
      workDone: raw<string>`left(${reports.workDone}, 400)`,
      notes: raw<string>`left(${reports.notes}, 400)`,
      updatedAt: reports.updatedAt,
      authorName: schema.users.name,
      // Counted among the project's photos: one removed since is not.
      photoCount: raw<number>`(
        select count(*)::int from ${schema.photos}
        where ${schema.photos.projectId} = ${reports.projectId}
          and ${schema.photos.id} in (select jsonb_array_elements_text(${reports.photoIds}))
      )`,
    })
    .from(reports)
    .leftJoin(schema.users, eq(schema.users.id, reports.createdBy))
    .where(eq(reports.projectId, projectId))
    .orderBy(desc(reports.day), asc(reports.createdAt));
  return rows.map((row) => {
    const weather = weatherDto(row.weather);
    return {
      id: row.id,
      day: row.day,
      condition: weather.condition,
      temperatureC: weather.temperatureC,
      ...crewTotals(crewDto(row.crew)),
      excerpt: excerptOf(row.workDone.trim() || row.notes),
      authorName: row.authorName,
      updatedAt: row.updatedAt.toISOString(),
      photoCount: row.photoCount,
    };
  });
}

/** The report of a day, if any, and the last crew noted before that day. */
export async function dayReport(
  user: SessionUser,
  project: Pick<Project, "id" | "status">,
  day: string,
): Promise<DayReport> {
  const projectId = project.id;
  const [found] = await withAuthor()
    .where(and(eq(reports.projectId, projectId), eq(reports.day, day)))
    .orderBy(asc(reports.createdAt))
    .limit(1);
  // Days without anyone at the site (closed for weather) are skipped.
  const [previous] = await db
    .select({ day: reports.day, crew: reports.crew })
    .from(reports)
    .where(
      and(
        eq(reports.projectId, projectId),
        lt(reports.day, day),
        raw`jsonb_array_length(${reports.crew}) > 0`,
      ),
    )
    .orderBy(desc(reports.day))
    .limit(1);
  return {
    report: found
      ? reportDto(
          found.row,
          found.authorName,
          user,
          await photosByIds(user, project, found.row.photoIds),
        )
      : null,
    previous: previous ? { day: previous.day, crew: crewDto(previous.crew) } : null,
  };
}

const DAY_TAKEN = "Un rapport existe déjà pour cette journée.";

/**
 * Whether a query failed on the one-report-per-day index. The driver's error
 * may come wrapped (Drizzle puts it in `cause`).
 */
export function isDayTaken(error: unknown): boolean {
  let link = error;
  for (let depth = 0; depth < 5 && typeof link === "object" && link !== null; depth++) {
    const { code, constraint_name, cause } = link as Record<string, unknown>;
    if (code === "23505" && constraint_name === "daily_reports_project_day") return true;
    link = cause;
  }
  return false;
}

/**
 * A line stays tied to a person only if that person is on the project, or
 * was already on this report: a request cannot give hours to anyone else.
 */
async function knownCrew(
  // The transaction, when called inside one: a query through the pool while
  // each transaction holds a connection can leave them all waiting forever.
  from: Pick<Transaction, "select">,
  projectId: string,
  crew: CrewLine[],
  already: ReportCrewLine[] = [],
): Promise<CrewLine[]> {
  const ids = crew.flatMap((line) => line.userId ?? []);
  if (!ids.length) return crew;
  const members = await from
    .select({ userId: schema.projectMembers.userId })
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        inArray(schema.projectMembers.userId, ids),
      ),
    );
  const known = new Set([
    ...members.map((member) => member.userId),
    ...already.flatMap((line) => line.userId ?? []),
  ]);
  return crew.map((line) =>
    line.userId && !known.has(line.userId) ? { ...line, userId: null } : line,
  );
}

const reportOfDay = async (projectId: string, day: string) =>
  (
    await db
      .select()
      .from(reports)
      .where(and(eq(reports.projectId, projectId), eq(reports.day, day)))
      .limit(1)
  ).at(0);

/** Creates the day's report, or returns the one the day already has, untouched. */
export async function createReport(
  user: SessionUser,
  project: Pick<Project, "id" | "status">,
  input: z.infer<typeof newReport>,
): Promise<SavedReport> {
  const projectId = project.id;
  const reader = { user, project };
  const crew = await knownCrew(db, projectId, input.crew);
  // Two saves of the same day at the same moment: the index lets one row in,
  // the other insert does nothing and reads the winner. That row can be
  // deleted before it is read, so the day is tried again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();
    const [inserted] = await db
      .insert(reports)
      .values({
        ...input,
        weather: weatherRow(input.weather),
        crew,
        id: newId(),
        projectId,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [reports.projectId, reports.day] })
      .returning();
    if (inserted) return { report: await reportOf(reader, inserted), created: true };
    const existing = await reportOfDay(projectId, input.day);
    if (existing) return { report: await reportOf(reader, existing), created: false };
  }
  throw new HttpError(409, "day_taken", DAY_TAKEN);
}

/**
 * Saves a change made from the version `baseUpdatedAt`. If someone else saved
 * in the meantime, nothing is written: the person is told and chooses.
 */
export async function changeReport(
  reader: Reader,
  id: string,
  { baseUpdatedAt, ...change }: z.infer<typeof reportChange>,
): Promise<Report> {
  try {
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
      if (!current) throw notFound(MISSING);
      if (current.updatedAt.getTime() !== Date.parse(baseUpdatedAt))
        throw new HttpError(
          409,
          "conflict",
          "Ce rapport a été modifié depuis que vous l'avez ouvert. Rien n'a été enregistré.",
        );
      const crew = change.crew
        ? await knownCrew(tx, current.projectId, change.crew, current.crew)
        : crewDto(current.crew);
      const next = {
        weather: change.weather ?? weatherDto(current.weather),
        crew,
        equipment: change.equipment ?? current.equipment,
        workDone: change.workDone ?? current.workDone,
        notes: change.notes ?? current.notes,
        photoIds: change.photoIds ?? current.photoIds,
      };
      if (isEmptyContent(next)) throw badRequest(EMPTY_REPORT);
      const [saved] = await tx
        .update(reports)
        .set({
          ...next,
          weather: weatherRow(next.weather),
          // Moving onto a day that has a report breaks the index: see below.
          day: change.day ?? current.day,
          // Always later than the version it replaces, even within the same millisecond.
          updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
        })
        .where(eq(reports.id, id))
        .returning();
      return saved;
    });
    return reportOf(reader, row);
  } catch (error) {
    if (isDayTaken(error)) throw new HttpError(409, "day_taken", DAY_TAKEN);
    throw error;
  }
}

export async function deleteReport(user: SessionUser, row: Row) {
  if (!canDelete(user, row))
    throw forbidden("Seuls l'auteur du rapport et le bureau peuvent le supprimer.");
  await db.delete(reports).where(eq(reports.id, row.id));
}
