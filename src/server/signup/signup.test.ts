import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// What only a real database shows for making one's own account and deleting
// it: the door's counts with the clock given, the code replaced or closed,
// accounts made together, and what deleting an account leaves. The tests run
// against a database of their own beside this checkout's (its name followed
// by "_signup_vitest"), dropped at the end; without a local Postgres they are
// skipped.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the development default applies.
}
const configured = new URL(process.env.DATABASE_URL ?? "postgres://ead:ead@127.0.0.1:54329/ead");
const databaseName = `${configured.pathname.slice(1)}_signup_vitest`;
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
const { createAccountWithCode } = await import("./account");
const { closeSignup, newCompanyCodeBy, readCompanyCode } = await import("./settings");
const { deleteOwnAccount } = await import("../people/delete");
const { currentUser } = await import("../auth");
const { hashToken } = await import("../ids");

const limits = { triesPerHour: 3, wrongCodesPerDay: 6, accountsPerDay: 4 };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const start = new Date();
const at = (ms: number) => new Date(start.getTime() + ms);

/** A request from a phone at an address. */
const from = (address: string, cookie?: string) =>
  new NextRequest("http://localhost/api/signup", {
    method: "POST",
    headers: {
      "x-forwarded-for": address,
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1",
      ...(cookie ? { cookie: `ead_session=${cookie}` } : {}),
    },
  });
let phones = 0;
const newcomer = (code: string, name = "Luc Roy") => ({
  name,
  phone: `418 555-${String(1000 + ++phones)}`,
  code,
});
const answer = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    (error) => `${error.status} ${error.code}`,
  );

describe.skipIf(!ready)("with a database", () => {
  let code = "";
  beforeEach(async () => {
    await sql`delete from signup_attempts`;
    await sql`delete from photos`;
    await sql`delete from projects`;
    await sql`delete from users`;
    await sql`insert into users (id, name, role) values ('office', 'Camille Roy', 'admin')`;
    code = await newCompanyCodeBy("office", at(-HOUR));
  });

  afterAll(async () => {
    await sql.end();
    const server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await server.end();
  });

  it("makes an unreviewed worker on no project, signed in for seven days", async () => {
    const made = await createAccountWithCode(from("203.0.113.1"), newcomer(code, "  Luc   Roy "), {
      now: start,
      limits,
    });
    const [user] = await sql`select * from users where id = ${made.userId}`;
    expect(user).toMatchObject({
      name: "Luc Roy",
      role: "travailleur",
      unreviewed: true,
      joined_with: "company_code",
      active: true,
    });
    expect(user.phone).toMatch(/^418 555-\d{4}$/);
    const [{ n }] =
      await sql`select count(*)::int as n from project_members where user_id = ${made.userId}`;
    expect(n).toBe(0);
    const days = (made.expiresAt.getTime() - Date.now()) / (24 * HOUR);
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect((await currentUser(from("x", made.token)))?.id).toBe(made.userId);
  });

  it("answers a wrong code, a closed door and a replaced code alike", async () => {
    const wrong = await answer(
      createAccountWithCode(from("203.0.113.2"), newcomer("11112222"), { now: start, limits }),
    );
    const old = code;
    code = await newCompanyCodeBy("office", at(-MINUTE));
    const replaced = await answer(
      createAccountWithCode(from("203.0.113.3"), newcomer(old), { now: start, limits }),
    );
    await closeSignup("office", at(-MINUTE));
    const closed = await answer(
      createAccountWithCode(from("203.0.113.4"), newcomer(code), { now: start, limits }),
    );
    expect([wrong, replaced, closed]).toEqual(Array(3).fill("400 wrong_code"));
    expect((await readCompanyCode()).code).toBeNull();
  });

  it("refuses a number that already belongs to an active account, however typed", async () => {
    await sql`insert into users (id, name, phone) values ('known', 'Julie Cyr', '(418) 555-0199')`;
    const taken = createAccountWithCode(
      from("203.0.113.5"),
      { name: "Autre Personne", phone: "1-418-555-0199", code },
      { now: start, limits },
    );
    expect(await answer(taken)).toBe("409 phone_taken");
    // Someone switched off no longer holds their number.
    await sql`update users set active = false where id = 'known'`;
    const freed = createAccountWithCode(
      from("203.0.113.5"),
      { name: "Autre Personne", phone: "418 555 0199", code },
      { now: start, limits },
    );
    expect(await answer(freed)).toBe("accepted");
  });

  it("holds an address to a handful of tries an hour, the right code included", async () => {
    const tries = (now: Date, given = "11112222") =>
      answer(createAccountWithCode(from("198.51.100.1"), newcomer(given), { now, limits }));
    for (let i = 0; i < 3; i++) expect(await tries(at(i * MINUTE))).toBe("400 wrong_code");
    expect(await tries(at(5 * MINUTE), code)).toBe("429 too_many_signups");
    // Another address is not held back by this one.
    expect(
      await answer(
        createAccountWithCode(from("198.51.100.2"), newcomer(code), {
          now: at(5 * MINUTE),
          limits,
        }),
      ),
    ).toBe("accepted");
    // An hour after the first try, one more is let through.
    expect(await tries(at(HOUR + MINUTE), code)).toBe("accepted");
  });

  it("pauses for everyone after the day's wrong codes, until a new code", async () => {
    for (let i = 0; i < 6; i++)
      expect(
        await answer(
          createAccountWithCode(from(`192.0.2.${i}`), newcomer("11112222"), {
            now: at(i * MINUTE),
            limits,
          }),
        ),
      ).toBe("400 wrong_code");
    const paused = createAccountWithCode(from("192.0.2.99"), newcomer(code), {
      now: at(10 * MINUTE),
      limits,
    });
    expect(await answer(paused)).toBe("429 too_many_signups");
    await expect(paused).rejects.toThrow(/en pause/);
    code = await newCompanyCodeBy("office", at(11 * MINUTE));
    expect(
      await answer(
        createAccountWithCode(from("192.0.2.99"), newcomer(code), { now: at(12 * MINUTE), limits }),
      ),
    ).toBe("accepted");
  });

  it("makes no more accounts in a day than the ceiling, even sent together", async () => {
    const answers = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        answer(
          createAccountWithCode(from(`100.64.0.${i}`), newcomer(code), { now: start, limits }),
        ),
      ),
    );
    expect(answers.filter((a) => a === "accepted")).toHaveLength(4);
    expect(answers.filter((a) => a === "429 too_many_signups")).toHaveLength(3);
    const [{ n }] =
      await sql`select count(*)::int as n from users where joined_with = 'company_code'`;
    expect(n).toBe(4);
  });

  it("lets go of attempts that no longer count", async () => {
    await sql`insert into signup_attempts (id, address_hash, outcome, created_at)
              values ('old', 'x', 'wrong_code', ${at(-3 * 24 * HOUR).toISOString()})`;
    await answer(
      createAccountWithCode(from("203.0.113.9"), newcomer("11112222"), { now: start, limits }),
    );
    const rows = await sql`select id from signup_attempts`;
    expect(rows.map((row) => row.id)).not.toContain("old");
    // Nothing about the code, nor the address itself, is kept.
    const [row] = await sql`select * from signup_attempts`;
    expect(JSON.stringify(row)).not.toMatch(/11112222|203\.0\.113\.9/);
  });

  describe("deleting one's account", () => {
    const person = async (id: string, role = "travailleur") => {
      await sql`insert into users (id, name, role, phone, email)
                values (${id}, 'Marc Lévesque', ${role}, '418 555-0100', 'marc@exemple.ca')`;
      await sql`insert into projects (id, name) values (${`p-${id}`}, 'Projet des essais')`;
      await sql`insert into project_members (project_id, user_id) values (${`p-${id}`}, ${id})`;
      await sql`insert into sessions (id, user_id, token_hash, expires_at)
                values (${`s-${id}`}, ${id}, ${`h-${id}`}, now() + interval '1 day')`;
      await sql`insert into invites (id, token_hash, kind, user_id, expires_at, created_by)
                values (${`i-${id}`}, ${`t-${id}`}, 'personal', ${id}, now() + interval '1 day', 'office')`;
      await sql`insert into invites (id, token_hash, kind, project_id, expires_at, created_by)
                values (${`q-${id}`}, ${`u-${id}`}, 'project', ${`p-${id}`}, now() + interval '1 day', ${id})`;
    };
    const left = async (id: string) => ({
      user: (await sql`select * from users where id = ${id}`)[0],
      sessions: (await sql`select 1 from sessions where user_id = ${id}`).length,
      invites: (await sql`select 1 from invites where user_id = ${id}`).length,
      members: (await sql`select 1 from project_members where user_id = ${id}`).length,
      code: (await sql`select revoked_at from invites where id = ${`q-${id}`}`)[0],
    });

    it("removes someone who wrote nothing entirely", async () => {
      await person("quiet");
      expect(await deleteOwnAccount("quiet")).toBe("removed");
      const after = await left("quiet");
      expect(after).toMatchObject({ user: undefined, sessions: 0, invites: 0, members: 0 });
      // Their site's QR code no longer lets anyone in.
      expect(after.code.revoked_at).not.toBeNull();
    });

    it("keeps only the name of someone whose name is on the company's records", async () => {
      await person("author", "contremaitre");
      await sql`insert into photos (id, project_id, image_key, width, height, taken_at, created_by)
                values ('photo', 'p-author', 'p/photo', 10, 10, now(), 'author')`;
      expect(await deleteOwnAccount("author")).toBe("kept");
      const after = await left("author");
      expect(after.user).toMatchObject({
        name: "Marc Lévesque",
        active: false,
        phone: null,
        email: null,
        title: null,
      });
      expect(after.user.deleted_at).not.toBeNull();
      expect(after).toMatchObject({ sessions: 0, invites: 0, members: 0 });
      expect(after.code.revoked_at).not.toBeNull();
      // Deleted once, there is nothing left to delete.
      expect(await answer(deleteOwnAccount("author"))).toBe("404 not_found");
      // Switched back on by mistake, the row still never signs in.
      await sql`update users set active = true where id = 'author'`;
      await sql`insert into sessions (id, user_id, token_hash, expires_at)
                values ('again', 'author', ${hashToken("token-again")}, now() + interval '1 day')`;
      expect(await currentUser(from("x", "token-again"))).toBeNull();
    });

    it("refuses the last active office account, and allows it once another exists", async () => {
      expect(await answer(deleteOwnAccount("office"))).toBe("400 last_office_account");
      await sql`insert into users (id, name, role) values ('office2', 'Anne Roy', 'admin')`;
      expect(await deleteOwnAccount("office")).toBe("removed");
      expect(await answer(deleteOwnAccount("office2"))).toBe("400 last_office_account");
    });
  });
});
