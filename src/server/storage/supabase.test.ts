import { StorageApiError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BucketRules } from "./index";
import { ensureBuckets, supabaseStorage } from "./supabase";

// Hosted storage cannot be reached from the tests: these check what the app
// asks of it, against the client library's own shapes.

type Call = { method: string; args: unknown[] };

function fakeClient(answers: { info?: unknown; createSignedUploadUrl?: unknown }) {
  const calls: Call[] = [];
  const bucket = (name: string) => ({
    info: async (...args: unknown[]) => {
      calls.push({ method: `${name}.info`, args });
      return answers.info;
    },
    createSignedUploadUrl: async (...args: unknown[]) => {
      calls.push({ method: `${name}.createSignedUploadUrl`, args });
      return answers.createSignedUploadUrl;
    },
  });
  const client = { storage: { from: bucket } } as unknown as Parameters<typeof supabaseStorage>[0];
  return { calls, storage: supabaseStorage(client) };
}

describe("supabase upload links", () => {
  it("are signed without upsert, so a link cannot replace a file that arrived", async () => {
    const { calls, storage } = fakeClient({
      createSignedUploadUrl: {
        data: { signedUrl: "https://x.supabase.co/storage/v1/object/upload/sign/k?token=t" },
        error: null,
      },
    });
    const target = await storage.uploadTarget("private", "u/abc/plan.pdf", {
      contentType: "application/pdf",
      size: 1000,
    });
    // One argument: the key. The library only asks for upsert when given { upsert: true }.
    expect(calls).toEqual([
      { method: "ead-private.createSignedUploadUrl", args: ["u/abc/plan.pdf"] },
    ]);
    expect(target.method).toBe("PUT");
    expect(target.headers).toEqual({
      "content-type": "application/pdf",
      "cache-control": "max-age=3600",
    });
    expect(Object.keys(target.headers).map((name) => name.toLowerCase())).not.toContain("x-upsert");
  });
});

describe("supabase stat", () => {
  it("returns the stored size and type", async () => {
    const { storage } = fakeClient({
      info: { data: { size: 1234, contentType: "application/pdf" }, error: null },
    });
    expect(await storage.stat("private", "u/abc/plan.pdf")).toEqual({
      size: 1234,
      contentType: "application/pdf",
    });
    expect(await storage.size("private", "u/abc/plan.pdf")).toBe(1234);
  });

  it("answers null for a missing file, in the old and the new error shapes", async () => {
    for (const error of [
      new StorageApiError("Object not found", 400, "404"),
      new StorageApiError("Object not found", 404, "NoSuchKey", "storage", "NoSuchKey"),
    ]) {
      const { storage } = fakeClient({ info: { data: null, error } });
      expect(await storage.stat("private", "u/abc/plan.pdf")).toBeNull();
      expect(await storage.size("private", "u/abc/plan.pdf")).toBeNull();
    }
  });

  it("does not mistake an unreachable storage for a missing file", async () => {
    const { storage } = fakeClient({
      info: { data: null, error: new StorageApiError("Internal Server Error", 500, "500") },
    });
    await expect(storage.stat("private", "u/abc/plan.pdf")).rejects.toThrow(/Stockage \(info\)/);
  });
});

describe("ensureBuckets", () => {
  const MB = 1024 * 1024;
  const rules: BucketRules = {
    private: { fileSizeLimit: 500 * MB, allowedMimeTypes: ["application/pdf", "image/jpeg"] },
    public: { fileSizeLimit: 500 * MB, allowedMimeTypes: ["image/webp"] },
  };
  type Options = { public: boolean; fileSizeLimit: number | null; allowedMimeTypes: string[] };
  type Answer = { error: Error | null };

  function fakeApi(
    answer: (method: "create" | "update", name: string, options: Options) => Answer,
  ) {
    const calls: { method: "create" | "update"; name: string; options: Options }[] = [];
    const call = (method: "create" | "update") => async (name: string, options: Options) => {
      calls.push({ method, name, options });
      return { data: null, ...answer(method, name, options) };
    };
    const api = { createBucket: call("create"), updateBucket: call("update") };
    return { calls, api: api as unknown as Parameters<typeof ensureBuckets>[1] };
  }
  const exists = new StorageApiError("The resource already exists", 400, "409");
  const tooLarge = new StorageApiError("The object exceeded the maximum allowed size", 413, "413");

  afterEach(() => vi.restoreAllMocks());

  it("creates both buckets with their size limit and allowed types", async () => {
    const { calls, api } = fakeApi(() => ({ error: null }));
    await ensureBuckets(rules, api);
    expect(calls).toEqual([
      {
        method: "create",
        name: "ead-public",
        options: { public: true, fileSizeLimit: 500 * MB, allowedMimeTypes: ["image/webp"] },
      },
      {
        method: "create",
        name: "ead-private",
        options: {
          public: false,
          fileSizeLimit: 500 * MB,
          allowedMimeTypes: ["application/pdf", "image/jpeg"],
        },
      },
    ]);
  });

  it("gives the same settings to buckets that already exist", async () => {
    const { calls, api } = fakeApi((method) => ({ error: method === "create" ? exists : null }));
    await ensureBuckets(rules, api);
    expect(calls.filter((call) => call.method === "update")).toEqual([
      {
        method: "update",
        name: "ead-public",
        options: { public: true, fileSizeLimit: 500 * MB, allowedMimeTypes: ["image/webp"] },
      },
      {
        method: "update",
        name: "ead-private",
        options: {
          public: false,
          fileSizeLimit: 500 * MB,
          allowedMimeTypes: ["application/pdf", "image/jpeg"],
        },
      },
    ]);
  });

  it("goes on without the size limit, with a warning, when the service refuses it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // An existing bucket, in a project whose global limit is below 500 MB.
    const { calls, api } = fakeApi((method, _name, options) => {
      if (method === "create") return { error: exists };
      return { error: options.fileSizeLimit === null ? null : tooLarge };
    });
    await ensureBuckets(rules, api);
    const last = calls.filter((call) => call.name === "ead-private").at(-1);
    expect(last).toEqual({
      method: "update",
      name: "ead-private",
      options: {
        public: false,
        fileSizeLimit: null,
        allowedMimeTypes: ["application/pdf", "image/jpeg"],
      },
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toMatch(/limite de 500 Mo.*ead-private.*maximum allowed size/);
  });

  it("also goes on when a new bucket is refused its size limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, api } = fakeApi((_method, _name, options) => ({
      error: options.fileSizeLimit === null ? null : tooLarge,
    }));
    await ensureBuckets(rules, api);
    expect(calls.map((call) => [call.method, call.options.fileSizeLimit])).toEqual([
      ["create", 500 * MB],
      ["create", null],
      ["create", 500 * MB],
      ["create", null],
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("still fails the deployment on any other error", async () => {
    const down = new StorageApiError("Invalid API key", 401, "401");
    const { api } = fakeApi(() => ({ error: down }));
    await expect(ensureBuckets(rules, api)).rejects.toThrow(/Invalid API key/);
  });
});
