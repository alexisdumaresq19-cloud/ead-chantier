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
const { changeReport, createReport, deleteReport, isDayTaken, reportToChange, reportToManage } =
  await import("./queries");
const { newReport } = await import("./input");

const projectId = "reports-test-project";
const foreman = { id: "reports-foreman", role: "contremaitre" } as SessionUser;
const office = { id: "reports-office", role: "admin" } as SessionUser;
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
        createReport(foreman, projectId, content(today, `Version ${i}`)),
      ),
    );
    expect(saves.filter((save) => save.created)).toHaveLength(1);
    expect(new Set(saves.map((save) => save.report.id)).size).toBe(1);
    const [{ count }] = await sql`select count(*)::int as count from daily_reports`;
    expect(count).toBe(1);
  });

  it("refuses to move a report onto a day that has one, with a 409 and nothing changed", async () => {
    const { report: first } = await createReport(foreman, projectId, content(dayBefore(1)));
    const { report: second } = await createReport(foreman, projectId, content(dayBefore(2)));
    const move = changeReport(foreman, second.id, {
      day: first.day,
      baseUpdatedAt: second.updatedAt,
    });
    expect(await answer(move)).toBe("409 day_taken");
    const [row] = await sql`select day::text from daily_reports where id = ${second.id}`;
    expect(row.day).toBe(second.day);

    // Two reports swapping days at the same moment: neither breaks the index.
    const moves = await Promise.all([
      answer(
        changeReport(foreman, first.id, { day: dayBefore(3), baseUpdatedAt: first.updatedAt }),
      ),
      answer(
        changeReport(foreman, second.id, { day: dayBefore(3), baseUpdatedAt: second.updatedAt }),
      ),
    ]);
    expect(moves.sort()).toEqual(["409 day_taken", "accepted"]);
  });

  it("writes nothing over a version saved since", async () => {
    const { report } = await createReport(foreman, projectId, content(today));
    await changeReport(office, report.id, {
      workDone: "Version du bureau",
      baseUpdatedAt: report.updatedAt,
    });
    const stale = changeReport(foreman, report.id, {
      workDone: "Version du chantier",
      baseUpdatedAt: report.updatedAt,
    });
    expect(await answer(stale)).toBe("409 conflict");
    const [row] = await sql`select work_done from daily_reports where id = ${report.id}`;
    expect(row.work_done).toBe("Version du bureau");
  });

  it("keeps an archived project's reports readable and closed to change, except to the office", async () => {
    const { report } = await createReport(foreman, projectId, content(today));
    await sql`update projects set status = 'archive' where id = ${projectId}`;
    expect((await reportToManage(foreman, report.id)).row.id).toBe(report.id);
    expect(await answer(reportToChange(foreman, report.id))).toBe("403 forbidden");
    const row = await reportToChange(office, report.id);
    await deleteReport(office, row);
    const [{ count }] = await sql`select count(*)::int as count from daily_reports`;
    expect(count).toBe(0);
  });

  it("answers a report of a project the person is not on as missing", async () => {
    const { report } = await createReport(foreman, projectId, content(today));
    const outsider = { id: "reports-outsider", role: "contremaitre" } as SessionUser;
    expect(await answer(reportToManage(outsider, report.id))).toBe("404 not_found");
    expect(await answer(reportToChange(outsider, report.id))).toBe("404 not_found");
  });
});
