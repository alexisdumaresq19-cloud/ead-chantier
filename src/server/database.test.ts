import { StorageApiError } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "./auth";

// What only a real database shows: requests that arrive together, locks,
// transactions that fail half way. These tests run the real code against a
// database of their own, made here beside the one this checkout uses (same
// local Postgres, the name followed by "_vitest") and dropped at the end, and
// against the real Supabase driver talking to a stand-in for the storage
// service: files in memory, answers after a network delay, and the one rule
// that matters here, taken from the service's source: a signed link without
// upsert writes only while no file is there, and writes again once the file
// has been deleted.
//
// Without a local Postgres they are skipped: they never touch a hosted one.

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the development default applies.
}
const configured = new URL(process.env.DATABASE_URL ?? "postgres://ead:ead@127.0.0.1:54329/ead");
const databaseName = `${configured.pathname.slice(1)}_vitest`;
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
if (!ready) console.warn("database.test.ts: no local Postgres answers, tests skipped.");
// Before the app's own client connects (it does at its first query).
process.env.DATABASE_URL = databaseUrl;

// --- The stand-in for the storage service -----------------------------------

type StoredFile = { size: number; contentType?: string; body: string };

const service = vi.hoisted(() => {
  const state = {
    files: new Map<string, StoredFile>(),
    /** One round trip to storage, in ms. */
    roundTrip: 0,
    linksFail: false,
    /** Keys storage refuses to delete. */
    stuck: new Set<string>(),
    log: [] as string[],
  };
  const leg = () =>
    state.roundTrip
      ? new Promise((resolve) => setTimeout(resolve, (state.roundTrip / 2) * (0.7 + Math.random())))
      : Promise.resolve();
  return { state, leg };
});
const { state, leg } = service;

/** What a browser's PUT to an upload link does: it writes once. */
async function send(key: string, file: StoredFile): Promise<number> {
  await leg();
  const free = !state.files.has(key);
  if (free) {
    state.files.set(key, file);
    state.log.push(`PUT ${file.body}`);
  }
  await leg();
  return free ? 200 : 409;
}

vi.mock("./storage", async (original) => {
  const real = await original<typeof import("./storage")>();
  const { supabaseStorage } = await import("./storage/supabase");
  const { state, leg } = service;
  const failure = (message: string, status: number, code: string) =>
    new StorageApiError(message, status, code, "storage", code);
  const bucket = {
    async createSignedUploadUrl(key: string) {
      await leg();
      if (state.linksFail) return { data: null, error: failure("fetch failed", 503, "503") };
      return { data: { signedUrl: `https://storage.test/${key}?token=t` }, error: null };
    },
    async info(key: string) {
      await leg();
      const file = state.files.get(key);
      await leg();
      if (!file) return { data: null, error: failure("Object not found", 404, "NoSuchKey") };
      return { data: { size: file.size, contentType: file.contentType }, error: null };
    },
    async list(folder: string) {
      await leg();
      const entries = [...state.files.keys()]
        .filter((key) => key.startsWith(`${folder}/`))
        .map((key) => ({ name: key.slice(folder.length + 1), id: "file" }));
      await leg();
      return { data: entries, error: null };
    },
    async remove(paths: string[]) {
      await leg();
      if (paths.some((path) => state.stuck.has(path)))
        return { data: null, error: failure("Internal Server Error", 500, "500") };
      for (const path of paths) {
        const file = state.files.get(path);
        if (file && state.files.delete(path)) state.log.push(`DELETE ${file.body}`);
      }
      await leg();
      return { data: [], error: null };
    },
  };
  const driver = supabaseStorage({ storage: { from: () => bucket } } as never);
  return { ...real, storage: () => driver };
});

const { db, schema, sql } = await import("./db/client");
const { consumeInvite, createProjectInvite, findInvite } = await import("./auth");
const {
  beginUpload,
  completeUpload,
  discardUpload,
  MAX_DAILY_UPLOADS,
  MAX_PENDING_UPLOADS,
  sweepAbandonedUploads,
  takeUpload,
} = await import("./uploads");

const MB = 1024 * 1024;
const projectId = "project-of-the-tests";
let people = 0;
const person = (role: SessionUser["role"] = "travailleur") =>
  ({ id: `person-${++people}`, role }) as SessionUser;
const photo = (name = "photo.jpg", size = 100) => ({
  projectId,
  kind: "photo" as const,
  filename: name,
  contentType: "image/jpeg",
  size,
});
const jpeg = (size: number, body = "the announced file") => ({
  size,
  contentType: "image/jpeg",
  body,
});
const rowOf = async (id: string) =>
  (await db.select().from(schema.uploads).where(eq(schema.uploads.id, id)))[0];
const rowsOf = (user: SessionUser) =>
  db.select().from(schema.uploads).where(eq(schema.uploads.createdBy, user.id));
const age = (ids: string[], hours: number) =>
  sql`update uploads set created_at = now() - ${hours}::float8 * interval '1 hour'
      where id in ${sql(ids)}`;
/** Rows written straight to the table: uploads of the past. */
async function past(user: SessionUser, count: number, hours: number, status = "pending") {
  const ids = Array.from({ length: count }, (_, i) => `${user.id}-${status}-${hours}h-${i}`);
  await sql`insert into uploads ${sql(
    ids.map((id) => ({
      id,
      project_id: projectId,
      kind: "photo",
      storage_key: `u/${id}/photo.jpg`,
      filename: `${id}.jpg`,
      content_type: "image/jpeg",
      size: 1000,
      status,
      created_by: user.id,
    })),
  )}`;
  await age(ids, hours);
  return ids;
}
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    (error) => `${error.status} ${error.code}`,
  );

describe.skipIf(!ready)("with a database", () => {
  beforeEach(async () => {
    Object.assign(state, { roundTrip: 0, linksFail: false, log: [] });
    state.files.clear();
    state.stuck.clear();
    await sql`delete from uploads`;
    await sql`insert into projects (id, name) values (${projectId}, 'Projet des essais')
              on conflict do nothing`;
  });

  afterAll(async () => {
    await sql.end();
    const server = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await server.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await server.end();
  });

  describe("confirming an upload", () => {
    it("deletes a file that is not the announced one, and keeps its place counted", async () => {
      const user = person();
      const { upload } = await beginUpload(user, photo());
      await send(upload.storageKey, jpeg(40, "too short"));
      await expect(completeUpload(user, upload.id)).rejects.toThrow(/incomplet/);
      expect(state.files.size).toBe(0);
      // The link can write again: the row stays, unfinished, to answer for it.
      expect((await rowOf(upload.id)).status).toBe("pending");
      await expect(completeUpload(user, upload.id)).rejects.toThrow(/pas arrivé/);
      await expect(takeUpload(user, upload.id, "photo", projectId)).rejects.toThrow(/pas terminé/);

      expect(await send(upload.storageKey, jpeg(100))).toBe(200);
      expect((await completeUpload(user, upload.id)).status).toBe("complete");
      expect(await send(upload.storageKey, jpeg(100, "another"))).toBe(409);
    });

    it("refuses a file stored under another type, or under none", async () => {
      const user = person();
      const { upload } = await beginUpload(user, photo());
      await send(upload.storageKey, { size: 100, contentType: "text/html", body: "a page" });
      await expect(completeUpload(user, upload.id)).rejects.toThrow(/n'est pas celui/);
      expect(state.files.size).toBe(0);
      // Hosted storage always records a type: without one, nothing is concluded.
      await send(upload.storageKey, { size: 100, body: "no type" });
      await expect(completeUpload(user, upload.id)).rejects.toThrow(/type de fichier inconnu/);
      expect((await rowOf(upload.id)).status).toBe("pending");
    });

    // The attack: announce 100 bytes, send a short file, then confirm and send
    // in a loop. A confirmation deletes the short file; the right file gets
    // in and is confirmed; a confirmation that had seen the short file then
    // deletes the right one. The upload is "complete", its link is free
    // again, and takes any file.
    it("never leaves a confirmed upload holding a file nobody checked", async () => {
      const user = person();
      state.roundTrip = 24;
      const right = jpeg(100);
      const other = { size: 5 * MB, contentType: "application/pdf", body: "5 MB, never checked" };
      for (let round = 0; round < 8; round++) {
        state.log = [];
        const { upload } = await beginUpload(user, photo(`course-${round}.jpg`));
        const key = upload.storageKey;
        await send(key, jpeg(40, "too short"));
        let confirmed = false;
        const requests: Promise<unknown>[] = [];
        const spray = setInterval(() => {
          requests.push(
            completeUpload(user, upload.id).then(
              () => (confirmed = true),
              () => {},
            ),
          );
          requests.push(send(key, confirmed ? other : right));
        }, 3);
        await new Promise((resolve) => setTimeout(resolve, state.roundTrip * 8));
        clearInterval(spray);
        await Promise.all(requests);

        const row = await rowOf(upload.id);
        const stored = state.files.get(key);
        if (row.status === "complete")
          expect(stored, `round ${round}: ${state.log.join(" → ")}`).toEqual(right);
        // Whatever happened, the announced file can still be sent and confirmed.
        if (row.status !== "complete") {
          if (stored && stored.body !== right.body)
            await completeUpload(user, upload.id).catch(() => {});
          await send(key, right);
          expect((await completeUpload(user, upload.id)).status).toBe("complete");
        }
        expect(await send(key, other)).toBe(409);
      }
    }, 60_000);

    it("refuses an upload past its time, which the clean-up then removes", async () => {
      const user = person();
      const { upload } = await beginUpload(user, photo());
      await send(upload.storageKey, jpeg(100));
      await age([upload.id], 4);
      await expect(completeUpload(user, upload.id)).rejects.toThrow(/trop tardé/);
      expect(await sweepAbandonedUploads()).toBe(1);
      expect(await rowOf(upload.id)).toBeUndefined();
      expect(state.files.size).toBe(0);
    });
  });

  describe("announcing an upload", () => {
    it("leaves nothing behind when storage cannot give a link", async () => {
      const user = person("contremaitre");
      const plan = {
        projectId,
        kind: "plan" as const,
        filename: "plans.pdf",
        contentType: "application/pdf",
        size: 450 * MB,
      };
      state.linksFail = true;
      for (let i = 0; i < 6; i++)
        await expect(beginUpload(user, plan)).rejects.toThrow(/createSignedUploadUrl/);
      expect(await rowsOf(user)).toHaveLength(0);
      state.linksFail = false;
      expect((await beginUpload(user, plan)).target.url).toContain("/u/");
    });

    it("gives a send that is tried again the place it already had", async () => {
      const worker = person();
      const tries = [];
      for (let i = 0; i < MAX_PENDING_UPLOADS + 1; i++)
        tries.push((await beginUpload(worker, photo("chantier.jpg", 3 * MB))).upload.id);
      expect(new Set(tries).size).toBe(1);
      expect(await rowsOf(worker)).toHaveLength(1);

      // Five tries of one 450 MB plan are one upload, not 2 GB of them.
      const foreman = person("contremaitre");
      const plan = {
        projectId,
        kind: "plan" as const,
        filename: "plans.pdf",
        contentType: "application/pdf",
        size: 450 * MB,
      };
      for (let i = 0; i < 5; i++) await beginUpload(foreman, plan);
      expect(await rowsOf(foreman)).toHaveLength(1);
      // Five different plans of that size are: the fifth waits.
      for (let i = 1; i < 4; i++)
        await beginUpload(foreman, { ...plan, filename: `plans-${i}.pdf` });
      expect(await refusal(beginUpload(foreman, { ...plan, filename: "plans-4.pdf" }))).toBe(
        "429 too_many_uploads",
      );
    });

    it("starts the time of a retried upload again, with its new link", async () => {
      const user = person();
      const { upload } = await beginUpload(user, photo());
      await age([upload.id], 2.9);
      const again = await beginUpload(user, photo());
      expect(again.upload.id).toBe(upload.id);
      expect(Date.now() - again.upload.createdAt.getTime()).toBeLessThan(60_000);
    });

    it("does not reuse a place whose file has arrived, or another file's", async () => {
      const user = person();
      const first = await beginUpload(user, photo());
      await send(first.upload.storageKey, jpeg(100));
      // Sent but not confirmed (the connection dropped): the link wrote once.
      const second = await beginUpload(user, photo());
      expect(second.upload.id).not.toBe(first.upload.id);
      expect((await beginUpload(user, photo("photo.jpg", 101))).upload.id).not.toBe(
        second.upload.id,
      );
      expect((await beginUpload(user, photo("autre.jpg"))).upload.id).not.toBe(second.upload.id);
      expect((await beginUpload(person(), photo())).upload.id).not.toBe(second.upload.id);
      await completeUpload(user, first.upload.id);
      expect((await beginUpload(user, photo())).upload.id).toBe(second.upload.id);
    });

    it("stops at 30 unfinished uploads, however many are announced at once", async () => {
      const user = person();
      const answers = await Promise.all(
        Array.from({ length: 35 }, (_, i) => refusal(beginUpload(user, photo(`p${i}.jpg`)))),
      );
      expect(answers.filter((answer) => answer === "accepted")).toHaveLength(30);
      expect(answers.filter((answer) => answer === "429 too_many_uploads")).toHaveLength(5);
    });

    it("no longer counts unfinished uploads past their time, and removes the caller's first", async () => {
      const [someone, user] = [person(), person()];
      // Older leftovers of someone else come first in the table.
      const theirs = await past(someone, 25, 50);
      const mine = await past(user, MAX_PENDING_UPLOADS, 49);
      for (const id of mine) state.files.set(`u/${id}/photo.jpg`, jpeg(1000));

      expect(await refusal(beginUpload(user, photo()))).toBe("accepted");
      const left = (await rowsOf(user)).filter((row) => mine.includes(row.id));
      expect(left).toHaveLength(MAX_PENDING_UPLOADS - 10);
      expect(state.files.size).toBe(MAX_PENDING_UPLOADS - 10);
      expect(await rowsOf(someone)).toHaveLength(theirs.length);
      // Announce after announce, everything goes, other people's included.
      for (let i = 0; i < 6; i++) await beginUpload(user, photo());
      expect(state.files.size).toBe(0);
      expect(await rowsOf(someone)).toHaveLength(0);
    });

    it("goes on cleaning when storage refuses to delete one upload", async () => {
      const user = person();
      const ids = await past(user, 5, 5);
      for (const id of ids) state.files.set(`u/${id}/photo.jpg`, jpeg(1000));
      state.stuck.add(`u/${ids[2]}/photo.jpg`);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await sweepAbandonedUploads(user.id)).toBe(4);
      expect(error).toHaveBeenCalledTimes(1);
      expect((await rowsOf(user)).map((row) => row.id)).toEqual([ids[2]]);
      // The one left does not stop its owner from sending.
      expect(await refusal(beginUpload(user, photo()))).toBe("accepted");
      error.mockRestore();
    });

    it("stops a person at what one may send in a day, confirmed uploads included", async () => {
      const worker = person();
      await past(worker, MAX_DAILY_UPLOADS - 1, 20, "complete");
      expect(await refusal(beginUpload(worker, photo("avant-dernier.jpg")))).toBe("accepted");
      expect(await refusal(beginUpload(worker, photo("de-trop.jpg")))).toBe(
        "429 daily_upload_limit",
      );
      // What was sent more than a day ago no longer counts.
      await sql`update uploads set created_at = created_at - interval '5 hours'
                where created_by = ${worker.id} and status = 'complete'`;
      expect(await refusal(beginUpload(worker, photo("de-trop.jpg")))).toBe("accepted");

      // The office loads whole projects: it has no such limit.
      const office = person("admin");
      await past(office, MAX_DAILY_UPLOADS, 20, "complete");
      expect(await refusal(beginUpload(office, photo()))).toBe("accepted");
    });

    it("counts a day's bytes: ten 500 MB plans, not eleven", async () => {
      const foreman = person("contremaitre");
      const ids = await past(foreman, 10, 20, "complete");
      await sql`update uploads set size = ${500 * MB} where id in ${sql(ids)}`;
      const plan = (size: number) => ({
        projectId,
        kind: "plan" as const,
        filename: `plans-${size}.pdf`,
        contentType: "application/pdf",
        size,
      });
      expect(await refusal(beginUpload(foreman, plan(500 * MB)))).toBe("429 daily_upload_limit");
      expect(await refusal(beginUpload(foreman, plan(100 * MB)))).toBe("accepted");
    });
  });

  describe("discarding an upload a module no longer wants", () => {
    it("deletes the file and answers for the link while it can still write", async () => {
      const user = person();
      const { upload } = await beginUpload(user, photo());
      await send(upload.storageKey, jpeg(100));
      await completeUpload(user, upload.id);

      await discardUpload(upload.id);
      expect(state.files.size).toBe(0);
      // The link is free again: the upload is unfinished again, and counted.
      expect((await rowOf(upload.id)).status).toBe("pending");
      expect(
        await send(upload.storageKey, {
          size: 5 * MB,
          contentType: "application/pdf",
          body: "anything",
        }),
      ).toBe(200);
      await expect(takeUpload(user, upload.id, "photo", projectId)).rejects.toThrow(/pas terminé/);
      await expect(completeUpload(user, upload.id)).rejects.toThrow(/n'est pas celui/);
      // Whatever the link wrote goes with the row when its time is over.
      await send(upload.storageKey, jpeg(100, "sent again"));
      await age([upload.id], 4);
      expect(await sweepAbandonedUploads()).toBe(1);
      expect(state.files.size).toBe(0);
      expect(await rowOf(upload.id)).toBeUndefined();
    });

    it("deletes the row as well once the link can no longer write", async () => {
      const user = person();
      const { upload } = await beginUpload(user, photo());
      await send(upload.storageKey, jpeg(100));
      await completeUpload(user, upload.id);
      await age([upload.id], 30);
      await discardUpload(upload.id);
      expect(state.files.size).toBe(0);
      expect(await rowOf(upload.id)).toBeUndefined();
      await discardUpload(upload.id); // nothing left: nothing happens
    });
  });

  describe("a site's QR code", () => {
    async function code() {
      await sql`delete from invites`;
      await sql`insert into users (id, name, role) values ('office', 'Bureau', 'admin')
                on conflict do nothing`;
      const { token } = await createProjectInvite(projectId, "office");
      const invite = await findInvite(token);
      return { token, invite: invite! };
    }
    const uses = async () => (await sql`select uses, revoked_at from invites`)[0];

    it("gives its place back when what the place was for fails", async () => {
      const { invite } = await code();
      await expect(
        db.transaction(async (tx) => {
          expect(await consumeInvite(invite, tx)).toBe(true);
          // What the database answers to a name it cannot store.
          await tx.insert(schema.users).values({ id: "x", name: "Jean\u0000Tremblay" });
        }),
      ).rejects.toThrow();
      expect((await uses()).uses).toBe(0);
      await db.transaction((tx) => consumeInvite(invite, tx));
      expect((await uses()).uses).toBe(1);
    });

    it("with no place left is still found: it opens the project for those already in", async () => {
      const { token } = await code();
      await sql`update invites set uses = max_uses`;
      const full = await findInvite(token);
      expect(full).not.toBeNull();
      expect(await consumeInvite(full!)).toBe(false);
    });

    it("is ended for good once seen while its project is archived", async () => {
      const { token } = await code();
      await sql`update projects set status = 'archive' where id = ${projectId}`;
      expect(await findInvite(token)).toBeNull();
      expect((await uses()).revoked_at).not.toBeNull();
      await sql`update projects set status = 'actif' where id = ${projectId}`;
      expect(await findInvite(token)).toBeNull();
    });
  });
});
