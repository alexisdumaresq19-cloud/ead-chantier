import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// What only a real database shows for signing in by a typed code: a code used
// up with its link, replaced with it, ended with the person's access; the
// door's counts with requests sent all at once; a number nobody has answered
// like one that belongs to someone; and the demonstration access, made again
// after its visitor deletes it. The tests run against a database of their own
// beside this checkout's (its name followed by "_access_vitest"), dropped at
// the end; without a local Postgres they are skipped.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the development default applies.
}
const configured = new URL(process.env.DATABASE_URL ?? "postgres://ead:ead@127.0.0.1:54329/ead");
const databaseName = `${configured.pathname.slice(1)}_access_vitest`;
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
const { signInWithCode } = await import("./sign-in");
const { createDemoAccess, changeDemoAccess, isDemoPhone, readDemoAccess, removeDemoAccess } =
  await import("./demo");
const { DEMO_REMAKES_PER_DAY } = await import("./door");
const { createPersonalInvite, currentUser, consumeInvite, findInvite } = await import("../auth");
const { endAccess } = await import("../people/links");
const { deleteOwnAccount } = await import("../people/delete");
const { createAccountWithCode } = await import("../signup/account");
const { newCompanyCodeBy } = await import("../signup/settings");
const { db } = await import("../db/client");

const limits = { triesPerHour: 3, wrongPerNumber: 4 };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const start = new Date();
const at = (ms: number) => new Date(start.getTime() + ms);
const fast = { limits, refusalMs: 0 };

/** A request from a phone at an address, signed in or not. */
const from = (address: string, cookie?: string) =>
  new NextRequest("http://localhost/api/sessions/code", {
    method: "POST",
    headers: {
      "x-forwarded-for": address,
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1",
      ...(cookie ? { cookie: `ead_session=${cookie}` } : {}),
    },
  });
const answer = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    (error) => `${error.status} ${error.code}`,
  );
/** A code that is not the one given (the last digit turned). */
const other = (code: string) => code.slice(0, 7) + ((Number(code[7]) + 1) % 10);

describe.skipIf(!ready)("with a database", () => {
  beforeEach(async () => {
    await sql`delete from signup_attempts`;
    await sql`delete from app_settings`;
    await sql`delete from projects`;
    await sql`delete from users`;
    await sql`insert into users (id, name, role) values ('office', 'Camille Roy', 'admin')`;
    await sql`insert into users (id, name, role, phone)
              values ('julie', 'Julie Cyr', 'contremaitre', '(418) 555-0142')`;
    await sql`insert into projects (id, name) values ('p1', 'Projet des essais')`;
    await sql`insert into projects (id, name) values ('p2', 'Autre projet')`;
  });

  afterAll(async () => {
    await sql.end();
    const server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await server.end();
  });

  it("signs in once with the number and the code, however typed, and keeps only a digest", async () => {
    const { code } = await createPersonalInvite("julie", "office");
    const made = await signInWithCode(
      from("203.0.113.1"),
      { phone: "1-418-555-0142", code: `${code.slice(0, 4)} ${code.slice(4)}` },
      fast,
    );
    expect(made.userId).toBe("julie");
    expect((await currentUser(from("x", made.token)))?.id).toBe("julie");
    const [invite] = await sql`select * from invites where user_id = 'julie'`;
    expect(invite.uses).toBe(1);
    expect(JSON.stringify(invite)).not.toContain(code);
    // Used once, the code is a wrong code like any other.
    expect(
      await answer(signInWithCode(from("203.0.113.1"), { phone: "4185550142", code }, fast)),
    ).toBe("400 wrong_access_code");
  });

  it("is used up with its link, either way round", async () => {
    const first = await createPersonalInvite("julie", "office");
    const invite = await findInvite(first.token);
    expect(await consumeInvite(invite!)).toBe(true);
    expect(
      await answer(signInWithCode(from("203.0.113.2"), { phone: "418 555-0142", ...first }, fast)),
    ).toBe("400 wrong_access_code");

    const second = await createPersonalInvite("julie", "office");
    await signInWithCode(from("203.0.113.2"), { phone: "418 555-0142", code: second.code }, fast);
    expect(await findInvite(second.token)).toBeNull();
  });

  it("dies with a new link, and when the person's access is cut", async () => {
    const old = await createPersonalInvite("julie", "office");
    const fresh = await createPersonalInvite("julie", "office");
    expect(
      await answer(
        signInWithCode(from("203.0.113.3"), { phone: "418 555-0142", code: old.code }, fast),
      ),
    ).toBe("400 wrong_access_code");
    await db.transaction((tx) => endAccess(tx, "julie"));
    await sql`update users set active = true where id = 'julie'`;
    expect(
      await answer(
        signInWithCode(from("203.0.113.3"), { phone: "418 555-0142", code: fresh.code }, fast),
      ),
    ).toBe("400 wrong_access_code");
  });

  it("answers a number nobody has as it answers someone's, in about the same time", async () => {
    const { code } = await createPersonalInvite("julie", "office");
    const timed = async (phone: string) => {
      const began = performance.now();
      const result = await signInWithCode(
        from("203.0.113.4"),
        { phone, code: other(code) },
        { limits: { triesPerHour: 100, wrongPerNumber: 100 } },
      ).catch((error) => error);
      return { result, ms: performance.now() - began };
    };
    const someone = await timed("418 555-0142");
    const nobody = await timed("418 555-0143");
    expect([someone.result.status, someone.result.code, someone.result.message]).toEqual([
      nobody.result.status,
      nobody.result.code,
      nobody.result.message,
    ]);
    expect(someone.result.message).toMatch(/^Ce numéro ou ce code n'est pas le bon\./);
    // Both wait for the same floor; what is left of the difference is noise.
    for (const { ms } of [someone, nobody]) expect(ms).toBeGreaterThanOrEqual(245);
    expect(Math.abs(someone.ms - nobody.ms)).toBeLessThan(100);
    // And the door counts both alike.
    const [{ n }] =
      await sql`select count(*)::int as n from signup_attempts where outcome = 'access_number'`;
    expect(n).toBe(2);
  });

  it("holds a network to its handful of tries, even sent all at once, the right code included", async () => {
    const { code } = await createPersonalInvite("julie", "office");
    const answers = await Promise.all(
      Array.from({ length: limits.triesPerHour * 10 }, (_, i) =>
        answer(
          signInWithCode(
            from("198.51.100.7"),
            { phone: `418 555-0${100 + i}`, code: "11112222" },
            { ...fast, now: start },
          ),
        ),
      ),
    );
    expect(answers.filter((a) => a === "400 wrong_access_code")).toHaveLength(limits.triesPerHour);
    expect(answers.filter((a) => a === "429 too_many_tries")).toHaveLength(limits.triesPerHour * 9);
    const shut = signInWithCode(from("198.51.100.7"), { phone: "418 555-0142", code }, fast);
    await expect(shut).rejects.toThrow(
      /^Trop d'essais à partir de ce réseau\. Réessayez (à|demain à) /,
    );
    // Another network is not held back, and an hour later this one may try again.
    expect(
      await answer(
        signInWithCode(from("198.51.100.8"), { phone: "418 555-0142", code: other(code) }, fast),
      ),
    ).toBe("400 wrong_access_code");
    expect(
      await answer(
        signInWithCode(
          from("198.51.100.7"),
          { phone: "418 555-0142", code },
          { ...fast, now: at(HOUR + MINUTE) },
        ),
      ),
    ).toBe("accepted");
  });

  it("holds a number to its handful of wrong codes from every network, until a new code", async () => {
    const answers = await Promise.all(
      Array.from({ length: limits.wrongPerNumber * 5 }, (_, i) =>
        answer(
          signInWithCode(
            from(`10.2.${i >> 8}.${i & 255}`),
            { phone: "418 555-0142", code: "11112222" },
            { ...fast, now: start },
          ),
        ),
      ),
    );
    expect(answers.filter((a) => a === "400 wrong_access_code")).toHaveLength(
      limits.wrongPerNumber,
    );
    // A number nobody has is held the same way.
    for (let i = 0; i < limits.wrongPerNumber; i++)
      await signInWithCode(
        from(`10.3.0.${i}`),
        { phone: "418 555-0143", code: "11112222" },
        fast,
      ).catch(() => null);
    const nobody = signInWithCode(
      from("10.3.1.1"),
      { phone: "418 555-0143", code: "11112222" },
      fast,
    );
    await expect(nobody).rejects.toThrow(/^Trop d'essais pour ce numéro\. Réessayez /);

    // The office's new code is the way out.
    const { code } = await createPersonalInvite("julie", "office");
    expect(
      await answer(
        signInWithCode(
          from("10.4.0.1"),
          { phone: "418 555-0142", code },
          { ...fast, now: new Date(Date.now() + MINUTE) },
        ),
      ),
    ).toBe("accepted");
  });

  it("never lets one network shut a number by itself", async () => {
    const roomy = { ...fast, limits: { triesPerHour: 100, wrongPerNumber: 4 } };
    // One address hammers Julie's number: it is held back for that number
    // once it has filled its part (half of four, here), and only it.
    const answers: string[] = [];
    for (let i = 0; i < 12; i++)
      answers.push(
        await answer(
          signInWithCode(from("192.0.2.50"), { phone: "418 555-0142", code: "11112222" }, roomy),
        ),
      );
    expect(answers.filter((a) => a === "400 wrong_access_code")).toHaveLength(2);
    expect(answers.slice(2).every((a) => a === "429 too_many_tries")).toBe(true);
    // Its other numbers are not held.
    expect(
      await answer(
        signInWithCode(from("192.0.2.50"), { phone: "418 555-0143", code: "11112222" }, roomy),
      ),
    ).toBe("400 wrong_access_code");
    // Julie, from her own phone, still gets in with her code.
    const { code } = await createPersonalInvite("julie", "office");
    await sql`update signup_attempts set created_at = created_at - interval '1 minute'`;
    for (let i = 0; i < 6; i++)
      await signInWithCode(
        from("192.0.2.50"),
        { phone: "418 555-0142", code: "11112222" },
        roomy,
      ).catch(() => null);
    expect(
      await answer(signInWithCode(from("192.0.2.60"), { phone: "418 555-0142", code }, roomy)),
    ).toBe("accepted");
  });

  it("never pauses account creation, and account creation never shuts it", async () => {
    const signupLimits = { triesPerHour: 2, wrongCodesPerDay: 3, accountsPerDay: 10 };
    const company = await newCompanyCodeBy("office", at(-HOUR));
    // This door's tries, many, from one network.
    for (let i = 0; i < limits.triesPerHour; i++)
      await signInWithCode(
        from("192.0.2.10"),
        { phone: "418 555-0199", code: "11112222" },
        fast,
      ).catch(() => null);
    expect(
      await answer(
        createAccountWithCode(
          from("192.0.2.10"),
          { name: "Luc Roy", phone: "418 555-0188", code: company },
          { now: start, limits: signupLimits },
        ),
      ),
    ).toBe("accepted");
    // Account creation shut for everyone by wrong company codes.
    for (let i = 0; i < signupLimits.wrongCodesPerDay; i++)
      await createAccountWithCode(
        from(`192.0.2.${20 + i}`),
        { name: "Luc Roy", phone: `418 555-01${50 + i}`, code: "11112222" },
        { now: start, limits: signupLimits },
      ).catch(() => null);
    const { code } = await createPersonalInvite("julie", "office");
    expect(
      await answer(
        signInWithCode(
          from("192.0.2.20"),
          { phone: "418 555-0142", code },
          { ...fast, now: start },
        ),
      ),
    ).toBe("accepted");
  });

  it("tells someone signed in as another person to sign out first, and keeps the code", async () => {
    await sql`insert into users (id, name, phone) values ('marc', 'Marc Lévesque', '418 555-0177')`;
    const marc = await createPersonalInvite("marc", "office");
    const inMarc = await signInWithCode(
      from("203.0.113.5"),
      { phone: "418 555-0177", code: marc.code },
      fast,
    );
    const { code } = await createPersonalInvite("julie", "office");
    const julie = { phone: "418 555-0142", code };
    expect(await answer(signInWithCode(from("203.0.113.5", inMarc.token), julie, fast))).toBe(
      "409 signed_in_as_other",
    );
    expect(await answer(signInWithCode(from("203.0.113.5"), julie, fast))).toBe("accepted");
  });

  it("refuses a number or a code that is not one, before counting anything", async () => {
    expect(
      await answer(signInWithCode(from("203.0.113.6"), { phone: "555", code: "1" }, fast)),
    ).toBe("400 bad_phone");
    expect(
      await answer(
        signInWithCode(from("203.0.113.6"), { phone: "418 555-0142", code: "1234" }, fast),
      ),
    ).toBe("400 bad_code");
    expect((await sql`select 1 from signup_attempts`).length).toBe(0);
  });

  describe("the demonstration access", () => {
    const demoRows = () => sql`select * from users where demo order by created_at`;

    it("lets visitors in for a day, on its projects, and again after one deletes the account", async () => {
      await createDemoAccess("office", ["p1", "missing"]);
      const setting = (await readDemoAccess())!;
      expect(setting.phone).toBe("418 555-0100");
      expect(setting.projectIds).toEqual(["p1"]);
      const [account] = await demoRows();
      expect(account).toMatchObject({ role: "contremaitre", demo: true, phone: "418 555-0100" });

      const typed = { phone: setting.phone, code: setting.code };
      const first = await signInWithCode(from("203.0.113.7"), typed, fast);
      expect(first.userId).toBe(account.id);
      const hours = (first.expiresAt.getTime() - Date.now()) / HOUR;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThan(24.1);
      // It serves more than once: a second device gets in too.
      const second = await signInWithCode(from("203.0.113.8"), typed, fast);
      expect(second.userId).toBe(account.id);
      // A visit never pushes the day back.
      await sql`update sessions set last_seen_at = now() - interval '7 hours' where user_id = ${account.id}`;
      const seen = await currentUser(from("x", first.token));
      expect(seen?.sessionExpiresAt.getTime()).toBe(first.expiresAt.getTime());

      // The visitor deletes the account, as Apple's reviewer will.
      await deleteOwnAccount(account.id);
      expect(await currentUser(from("x", second.token))).toBeNull();
      const again = await signInWithCode(from("203.0.113.9"), typed, fast);
      expect(again.userId).not.toBe(account.id);
      const members =
        await sql`select project_id from project_members where user_id = ${again.userId}`;
      expect(members.map((row) => row.project_id)).toEqual(["p1"]);
      expect((await demoRows()).filter((row) => row.active)).toHaveLength(1);
    });

    it("is never shut by wrong codes on its number: the right one always gets in", async () => {
      await createDemoAccess("office", ["p1"]);
      const setting = (await readDemoAccess())!;
      // Wrong codes from many networks, more than any number would take.
      const answers = await Promise.all(
        Array.from({ length: limits.wrongPerNumber * 5 }, (_, i) =>
          answer(
            signInWithCode(
              from(`10.9.${i >> 8}.${i & 255}`),
              { phone: setting.phone, code: other(setting.code) },
              fast,
            ),
          ),
        ),
      );
      expect(answers.every((a) => a === "400 wrong_access_code")).toBe(true);
      // Each network is still held to its own handful.
      for (let i = 0; i < limits.triesPerHour; i++)
        await signInWithCode(
          from("10.9.9.9"),
          { phone: setting.phone, code: other(setting.code) },
          fast,
        ).catch(() => null);
      expect(
        await answer(
          signInWithCode(from("10.9.9.9"), { phone: setting.phone, code: setting.code }, fast),
        ),
      ).toBe("429 too_many_tries");
      // Apple's reviewer, from a network of its own, gets in.
      expect(
        await answer(
          signInWithCode(from("17.0.0.1"), { phone: setting.phone, code: setting.code }, fast),
        ),
      ).toBe("accepted");
    });

    it("is made again a few times a day at most, and its number is no one else's", async () => {
      await createDemoAccess("office", ["p1"]);
      const setting = (await readDemoAccess())!;
      const typed = { phone: setting.phone, code: setting.code };
      // Deleted and come back: each time a new account, until the day's bound.
      for (let i = 0; i < DEMO_REMAKES_PER_DAY; i++) {
        const [account] = await demoRows();
        await deleteOwnAccount(account.id);
        await signInWithCode(from(`203.0.115.${i}`), typed, fast);
      }
      const [last] = await demoRows();
      await deleteOwnAccount(last.id);
      const refused = await signInWithCode(from("203.0.115.99"), typed, fast).catch((e) => e);
      expect([refused.status, refused.code]).toEqual([429, "too_many_demos"]);
      expect(refused.message).toMatch(/^Le compte de démonstration a été supprimé et refait /);
      expect(await demoRows()).toHaveLength(0);

      // Nobody of the team is given that number, however typed.
      expect(await isDemoPhone("1 (418) 555-0100")).toBe(true);
      expect(await isDemoPhone("418 555-0101")).toBe(false);
      expect(
        await answer(
          createAccountWithCode(
            from("192.0.2.30"),
            {
              name: "Luc Roy",
              phone: "418-555-0100",
              code: await newCompanyCodeBy("office", at(-HOUR)),
            },
            { now: start, limits: { triesPerHour: 5, wrongCodesPerDay: 5, accountsPerDay: 5 } },
          ),
        ),
      ).toBe("409 phone_taken");
    });

    it("makes one account for visitors who come at the same moment", async () => {
      await createDemoAccess("office", ["p1"]);
      const setting = (await readDemoAccess())!;
      await sql`delete from users where demo`;
      const made = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          signInWithCode(
            from(`203.0.114.${i}`),
            { phone: setting.phone, code: setting.code },
            fast,
          ),
        ),
      );
      expect(new Set(made.map((session) => session.userId)).size).toBe(1);
      expect(await demoRows()).toHaveLength(1);
    });

    it("takes a new code and other projects, and is removed with its account", async () => {
      await createDemoAccess("office", ["p1"]);
      const before = (await readDemoAccess())!;
      const visit = await signInWithCode(
        from("203.0.113.10"),
        { phone: before.phone, code: before.code },
        fast,
      );
      await changeDemoAccess("office", { newCode: true, projectIds: ["p2"] });
      const after = (await readDemoAccess())!;
      expect(after.code).not.toBe(before.code);
      // The old code no longer opens, and its visitors are signed out.
      expect(await currentUser(from("x", visit.token))).toBeNull();
      expect(
        await answer(
          signInWithCode(from("203.0.113.10"), { phone: before.phone, code: before.code }, fast),
        ),
      ).toBe("400 wrong_access_code");
      const [account] = await demoRows();
      const members =
        await sql`select project_id from project_members where user_id = ${account.id}`;
      expect(members.map((row) => row.project_id)).toEqual(["p2"]);

      await removeDemoAccess();
      expect(await readDemoAccess()).toBeNull();
      expect(await demoRows()).toHaveLength(0);
      expect(
        await answer(
          signInWithCode(from("203.0.113.11"), { phone: after.phone, code: after.code }, fast),
        ),
      ).toBe("400 wrong_access_code");
    });

    it("takes a number no account has, switched off or not", async () => {
      await sql`insert into users (id, name, phone) values ('taken', 'Luc Roy', '418-555-0100')`;
      await sql`insert into users (id, name, phone, active)
                values ('off', 'Léa Roy', '4185550101', false)`;
      await createDemoAccess("office", ["p1"]);
      expect((await readDemoAccess())!.phone).toBe("418 555-0102");
    });
  });
});
