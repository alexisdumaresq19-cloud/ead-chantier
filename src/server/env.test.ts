import { afterEach, describe, expect, it, vi } from "vitest";

import {
  productionStorageProblem,
  SETUP_CODE_MIN_LENGTH,
  setupCodeAdvice,
  storageDriverFrom,
} from "./env";

const supabase = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" };

describe("storageDriverFrom", () => {
  it("uses Supabase when its key is set, the folder otherwise, unless told", () => {
    expect(storageDriverFrom({})).toBe("fs");
    expect(storageDriverFrom(supabase)).toBe("supabase");
    expect(storageDriverFrom({ ...supabase, STORAGE_DRIVER: "fs" })).toBe("fs");
    expect(storageDriverFrom({ STORAGE_DRIVER: "supabase" })).toBe("supabase");
  });
});

describe("productionStorageProblem", () => {
  it("accepts hosted storage that is fully configured", () => {
    expect(productionStorageProblem(supabase)).toBeNull();
  });

  it("refuses the folder on disk, whether by omission or copied from .env.example", () => {
    expect(productionStorageProblem({})).toMatch(/refusé en production/);
    expect(productionStorageProblem({ ...supabase, STORAGE_DRIVER: "fs" })).toMatch(
      /refusé en production/,
    );
  });

  it("allows the folder on disk only when asked for", () => {
    expect(productionStorageProblem({ ALLOW_FS_STORAGE: "1" })).toBeNull();
    expect(productionStorageProblem({ ALLOW_FS_STORAGE: "true" })).not.toBeNull();
  });

  it("refuses half-configured hosted storage", () => {
    expect(productionStorageProblem({ SUPABASE_SERVICE_ROLE_KEY: "key" })).toMatch(/incomplet/);
    expect(productionStorageProblem({ STORAGE_DRIVER: "supabase" })).toMatch(/incomplet/);
  });
});

describe("setupCodeAdvice", () => {
  const long = "x".repeat(SETUP_CODE_MIN_LENGTH);
  it("asks for a long code until the office's account exists", () => {
    expect(setupCodeAdvice(undefined, false)).toMatch(/n'est pas définie/);
    expect(setupCodeAdvice(long.slice(1), false)).toMatch(/moins de 16 caractères/);
    expect(setupCodeAdvice(long, false)).toBeNull();
  });

  it("asks to remove the code afterwards", () => {
    expect(setupCodeAdvice(long, true)).toMatch(/retirez/);
    expect(setupCodeAdvice(undefined, true)).toBeNull();
  });
});

describe("env, on a production server", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function production(settings: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    for (const name of [
      "SETUP_CODE",
      "STORAGE_DRIVER",
      "ALLOW_FS_STORAGE",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ])
      vi.stubEnv(name, settings[name] ?? undefined);
    return (await import("./env")).env;
  }

  it("treats a short setup code as none, and has no default", async () => {
    expect((await production({})).setupCode).toBeUndefined();
    expect((await production({ SETUP_CODE: "dev" })).setupCode).toBeUndefined();
    const short = "x".repeat(SETUP_CODE_MIN_LENGTH - 1);
    expect((await production({ SETUP_CODE: short })).setupCode).toBeUndefined();
    expect((await production({ SETUP_CODE: `${short}x` })).setupCode).toBe(`${short}x`);
  });

  it("refuses to fall back to the folder on disk", async () => {
    const unset = await production({});
    expect(() => unset.storageDriver).toThrow(/refusé en production/);
    const copied = await production({ ...supabase, STORAGE_DRIVER: "fs" });
    expect(() => copied.storageDriver).toThrow(/refusé en production/);
    expect((await production({ ALLOW_FS_STORAGE: "1" })).storageDriver).toBe("fs");
    expect((await production(supabase)).storageDriver).toBe("supabase");
  });
});

describe("env, in development", () => {
  it('uses the folder on disk and the code "dev" without any setting', async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    for (const name of ["SETUP_CODE", "STORAGE_DRIVER", "SUPABASE_SERVICE_ROLE_KEY"])
      vi.stubEnv(name, undefined);
    const { env } = await import("./env");
    expect(env.storageDriver).toBe("fs");
    expect(env.setupCode).toBe("dev");
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
