import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { latestReportDay } from "@/shared/reports";

import type { SessionUser } from "../auth";

// What only a real database shows for daily reports: saves of the same day
// that arrive together, the one-report-per-day index, a closed project. The
// tests run against a database of their own beside this checkout's (its name
// followed by "_reports_vitest"), dropped at the end; without a local
// Postgres they are skipped.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the development default applies.
}
const configured = new URL(process.env.DATABASE_URL ?? "postgres://ead:ead@127.0.0.1:54329/ead");
const databaseName = `${configured.pathname.slice(1)}_reports_vitest`;
const serverUrl = Object.assign(new URL(configured), { pathname: "/postgres" }).href;
const databaseUrl = Object.assign(new URL(configured), { pathname: `/${databaseName}` }).href;

async function createDatabase(): Promise<boolean> {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(configured.hostname)) return false;
  const server = postgres(serverUrl, { max: 1, onnotice: () => {}, connect_timeout: 3 });
  try {
    await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await server.unsafe(`create database "${databaseName}"`);
  } catch {
    return false;
  } finally {
    await server.end();
  }
  const fresh = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(fresh), { migrationsFolder: "./drizzle" });
  await fresh.end();
  return true;
}

const ready = await createDatabase();
// Before the app's own client connects (it does at its first query).
process.env.DATABASE_URL = databaseUrl;

const { sql } = await import("../db/client");
const {
  changeReport,
  createReport,
  deleteReport,
  isDayTaken,
  listReports,
  reportOf,
  reportToChange,
  reportToManage,
} = await import("./queries");
const { newReport } = await import("./input");
const { removePhoto } = await import("../photos/changes");
const { photoRow } = await import("../photos/queries");

const projectId = "reports-test-project";
const project = { id: projectId, status: "actif" as const };
const foreman = { id: "reports-foreman", role: "contremaitre" } as SessionUser;
const office = { id: "reports-office", role: "admin" } as SessionUser;
const asForeman = { user: foreman, project };
const asOffice = { user: office, project };
const today = latestReportDay();
const dayBefore = (days: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
const content = (day: string, workDone = "Excavation de la tranchée.") =>
  newReport.parse({
    day,
    weather: { condition: "pluie", temperatureC: -4, note: "" },
    crew: [{ name: "Julie Cyr", hours: 7.5, userId: null }],
    equipment: "",
    workDone,
    notes: "",
  });
/** A photo of a project, as the photos module would have saved it. */
const photo = (id: string, takenAt: string, inProject = projectId) =>
  sql`insert into photos (id, project_id, image_key, width, height, taken_at, created_by)
      values (${id}, ${inProject}, ${`p/${id}`}, 1600, 1200, ${takenAt}, ${foreman.id})`;
const answer = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    (error) => `${error.status} ${error.code}`,
  );

describe("a failure on the one-report-per-day index", () => {
  it("is told apart from any other failure, wrapped or not", () => {
    const violation = { code: "23505", constraint_name: "daily_reports_project_day" };
    expect(isDayTaken(violation)).toBe(true);
    expect(isDayTaken(Object.assign(new Error("Failed query"), { cause: violation }))).toBe(true);
    expect(isDayTaken({ code: "23505", constraint_name: "users_pkey" })).toBe(false);
    expect(isDayTaken(new Error("connection lost"))).toBe(false);
    expect(isDayTaken(null)).toBe(false);
  });
});

describe.skipIf(!ready)("with a database", () => {
  beforeEach(async () => {
    await sql`delete from daily_reports`;
    await sql`delete from photos`;
    await sql`delete from projects`;
    await sql`insert into users (id, name, role) values
              (${foreman.id}, 'Julie Cyr', 'contremaitre'), (${office.id}, 'Camille Roy', 'admin')
              on conflict do nothing`;
    await sql`insert into projects (id, name) values (${projectId}, 'Projet des essais')`;
    await sql`insert into project_members (project_id, user_id) values (${projectId}, ${foreman.id})`;
  });

  afterAll(async () => {
    await sql.end();
    const server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await server.end();
  });

  it("makes one report of ten saves of the same day sent together", async () => {
    const saves = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createReport(foreman, project, content(today, `Version ${i}`)),
      ),
    );
    expect(saves.filter((save) => save.created)).toHaveLength(1);
    expect(new Set(saves.map((save) => save.report.id)).size).toBe(1);
    const [{ count }] = await sql`select count(*)::int as count from daily_reports`;
    expect(count).toBe(1);
  });

  it("refuses to move a report onto a day that has one, with a 409 and nothing changed", async () => {
    const { report: first } = await createReport(foreman, project, content(dayBefore(1)));
    const { report: second } = await createReport(foreman, project, content(dayBefore(2)));
    const move = changeReport(asForeman, second.id, {
      day: first.day,
      baseUpdatedAt: second.updatedAt,
    });
    expect(await answer(move)).toBe("409 day_taken");
    const [row] = await sql`select day::text from daily_reports where id = ${second.id}`;
    expect(row.day).toBe(second.day);

    // Two reports swapping days at the same moment: neither breaks the index.
    const moves = await Promise.all([
      answer(
        changeReport(asForeman, first.id, { day: dayBefore(3), baseUpdatedAt: first.updatedAt }),
      ),
      answer(
        changeReport(asForeman, second.id, { day: dayBefore(3), baseUpdatedAt: second.updatedAt }),
      ),
    ]);
    expect(moves.sort()).toEqual(["409 day_taken", "accepted"]);
  });

  it("writes nothing over a version saved since", async () => {
    const { report } = await createReport(foreman, project, content(today));
    await changeReport(asOffice, report.id, {
      workDone: "Version du bureau",
      baseUpdatedAt: report.updatedAt,
    });
    const stale = changeReport(asForeman, report.id, {
      workDone: "Version du chantier",
      baseUpdatedAt: report.updatedAt,
    });
    expect(await answer(stale)).toBe("409 conflict");
    const [row] = await sql`select work_done from daily_reports where id = ${report.id}`;
    expect(row.work_done).toBe("Version du bureau");
  });

  it("keeps an archived project's reports readable and closed to change, except to the office", async () => {
    const { report } = await createReport(foreman, project, content(today));
    await sql`update projects set status = 'archive' where id = ${projectId}`;
    expect((await reportToManage(foreman, report.id)).row.id).toBe(report.id);
    expect(await answer(reportToChange(foreman, report.id))).toBe("403 forbidden");
    const { row } = await reportToChange(office, report.id);
    await deleteReport(office, row);
    const [{ count }] = await sql`select count(*)::int as count from daily_reports`;
    expect(count).toBe(0);
  });

  it("answers a report of a project the person is not on as missing", async () => {
    const { report } = await createReport(foreman, project, content(today));
    const outsider = { id: "reports-outsider", role: "contremaitre" } as SessionUser;
    expect(await answer(reportToManage(outsider, report.id))).toBe("404 not_found");
    expect(await answer(reportToChange(outsider, report.id))).toBe("404 not_found");
  });

  describe("the photos that go with a report", () => {
    const early = "aaaaaaaaaaaaaaaa";
    const late = "bbbbbbbbbbbbbbbb";
    const elsewhere = "cccccccccccccccc";
    const notYetSent = "dddddddddddddddd";

    beforeEach(async () => {
      await sql`insert into projects (id, name) values ('reports-other-project', 'Un autre projet')`;
      await photo(late, "2026-11-18T19:00:00Z");
      await photo(early, "2026-11-18T13:00:00Z");
      await photo(elsewhere, "2026-11-18T15:00:00Z", "reports-other-project");
    });

    it("are those of its list the project holds, in the order they were taken", async () => {
      const photoIds = [late, notYetSent, elsewhere, early];
      const { report } = await createReport(foreman, project, { ...content(today), photoIds });
      // The list is kept as it was sent: a photo on its way from a phone has its place.
      expect(report.photoIds).toEqual(photoIds);
      expect(report.photos.map((shown) => shown.id)).toEqual([early, late]);
      expect(report.photos[0]).toMatchObject({ authorName: "Julie Cyr", canEdit: true });

      // Once that photo arrives, the report shows it.
      await photo(notYetSent, "2026-11-18T14:00:00Z");
      const { row } = await reportToManage(foreman, report.id);
      const read = await reportOf(asForeman, row);
      expect(read.photos.map((shown) => shown.id)).toEqual([early, notYetSent, late]);
      expect((await listReports(projectId))[0].photoCount).toBe(3);
    });

    it("stay when a change says nothing of them, and go when it says so", async () => {
      const { report } = await createReport(foreman, project, {
        ...content(today),
        photoIds: [early, late],
      });
      const noted = await changeReport(asForeman, report.id, {
        notes: "Visite de l'ingénieur.",
        baseUpdatedAt: report.updatedAt,
      });
      expect(noted.photoIds).toEqual([early, late]);
      const fewer = await changeReport(asForeman, report.id, {
        photoIds: [late],
        baseUpdatedAt: noted.updatedAt,
      });
      expect(fewer.photos.map((shown) => shown.id)).toEqual([late]);
      expect((await listReports(projectId))[0].photoCount).toBe(1);
    });

    it("no longer name a photo removed from the project, without a new version", async () => {
      const { report } = await createReport(foreman, project, {
        ...content(today),
        photoIds: [early, late],
      });
      const { report: untouched } = await createReport(foreman, project, {
        ...content(dayBefore(1)),
        photoIds: [late],
      });
      expect(await removePhoto(await photoRow(early))).toBe(true);
      const rows = await sql`select id, photo_ids, updated_at from daily_reports order by day desc`;
      expect(rows.map((row) => row.photo_ids)).toEqual([[late], [late]]);
      expect(new Date(rows[0].updated_at).toISOString()).toBe(report.updatedAt);
      expect(new Date(rows[1].updated_at).toISOString()).toBe(untouched.updatedAt);
    });

    it("are not editable once the project is archived, except by the office", async () => {
      const { report } = await createReport(foreman, project, {
        ...content(today),
        photoIds: [early],
      });
      await sql`update projects set status = 'archive' where id = ${projectId}`;
      const found = await reportToManage(foreman, report.id);
      expect(
        (await reportOf({ user: foreman, project: found.project }, found.row)).photos[0].canEdit,
      ).toBe(false);
      expect(
        (await reportOf({ user: office, project: found.project }, found.row)).photos[0].canEdit,
      ).toBe(true);
    });
  });
});
