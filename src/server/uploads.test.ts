import { describe, expect, it } from "vitest";

import {
  acceptsUpload,
  BUCKET_RULES,
  DAILY_LIMITS,
  dailyLimit,
  exceedsAllowance,
  exceedsDailyAllowance,
  MAX_PENDING_BYTES,
  MAX_PENDING_UPLOADS,
  OFFICE_DAILY_FACTOR,
  uploadProblem,
} from "./uploads";

const MB = 1024 * 1024;
const OFFICE = "application/vnd.openxmlformats-officedocument";

describe("acceptsUpload", () => {
  it("takes plans in PDF only, up to 500 MB", () => {
    expect(acceptsUpload("plan", "application/pdf", 500 * MB)).toBe(true);
    expect(acceptsUpload("plan", "application/pdf", 500 * MB + 1)).toBe(false);
    expect(acceptsUpload("plan", "text/html", 10)).toBe(false);
    expect(acceptsUpload("plan", "application/pdf", 0)).toBe(false);
  });

  it("takes photos as JPEG, PNG or WebP, up to 30 MB", () => {
    expect(acceptsUpload("photo", "image/jpeg", 30 * MB)).toBe(true);
    expect(acceptsUpload("photo", "image/jpeg", 30 * MB + 1)).toBe(false);
    expect(acceptsUpload("photo", "image/svg+xml", 10)).toBe(false);
    expect(acceptsUpload("photo", "application/pdf", 10)).toBe(false);
  });

  it("takes the documents a site keeps, and nothing a browser would run", () => {
    for (const type of [
      "application/pdf",
      "image/heic",
      "text/csv",
      "application/msword",
      `${OFFICE}.wordprocessingml.document`,
      `${OFFICE}.spreadsheetml.sheet`,
      `${OFFICE}.presentationml.presentation`,
      "image/vnd.dwg",
      "application/dxf",
      "application/zip",
      "application/octet-stream",
    ])
      expect(acceptsUpload("document", type, 1200), type).toBe(true);
    for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript"])
      expect(acceptsUpload("document", type, 1200), type).toBe(false);
    expect(acceptsUpload("document", "application/pdf", 200 * MB + 1)).toBe(false);
  });
});

describe("BUCKET_RULES", () => {
  it("lets the private bucket take every announced type, and the largest size", () => {
    const { allowedMimeTypes, fileSizeLimit } = BUCKET_RULES.private;
    expect(fileSizeLimit).toBe(500 * MB);
    expect(allowedMimeTypes).toContain("application/pdf");
    expect(allowedMimeTypes).toContain("image/webp");
    expect(allowedMimeTypes).toContain(`${OFFICE}.spreadsheetml.sheet`);
    expect(new Set(allowedMimeTypes).size).toBe(allowedMimeTypes.length);
    for (const type of allowedMimeTypes)
      expect(
        acceptsUpload("document", type, 10) || acceptsUpload("plan", type, 10),
        `${type} is announced by no kind of upload`,
      ).toBe(true);
    // Storage refuses what no kind of upload may announce.
    expect(allowedMimeTypes).not.toContain("text/html");
    expect(allowedMimeTypes).not.toContain("image/svg+xml");
  });

  it("lets the public bucket take the images the server writes, and only those", () => {
    expect(BUCKET_RULES.public.allowedMimeTypes).toEqual(["image/webp", "image/jpeg", "image/png"]);
  });
});

describe("exceedsAllowance", () => {
  it("stops at 30 unfinished uploads", () => {
    expect(exceedsAllowance({ count: MAX_PENDING_UPLOADS - 1, bytes: 0 }, 10)).toBe(false);
    expect(exceedsAllowance({ count: MAX_PENDING_UPLOADS, bytes: 0 }, 10)).toBe(true);
  });

  it("stops when the unfinished uploads would pass 2 GB in all", () => {
    expect(MAX_PENDING_BYTES).toBe(2048 * MB);
    expect(exceedsAllowance({ count: 3, bytes: 1500 * MB }, 500 * MB)).toBe(false);
    expect(exceedsAllowance({ count: 4, bytes: 2000 * MB }, 500 * MB)).toBe(true);
  });
});

describe("exceedsDailyAllowance", () => {
  const GB = 1024 * MB;

  it("counts each kind on its own, far above a heavy day's work", () => {
    expect(DAILY_LIMITS).toEqual({
      photo: { count: 300, bytes: 3 * GB },
      document: { count: 100, bytes: 4 * GB },
      plan: { count: 30, bytes: 6 * GB },
    });
    // Far above what the allowance of unfinished uploads lets through at once.
    for (const limit of Object.values(DAILY_LIMITS)) {
      expect(limit.count).toBeGreaterThanOrEqual(MAX_PENDING_UPLOADS);
      expect(limit.bytes).toBeGreaterThan(MAX_PENDING_BYTES);
    }
  });

  it("stops at the number of uploads of the kind", () => {
    expect(exceedsDailyAllowance("photo", "travailleur", { count: 299, bytes: 0 }, 10)).toBe(false);
    expect(exceedsDailyAllowance("photo", "travailleur", { count: 300, bytes: 0 }, 10)).toBe(true);
    expect(exceedsDailyAllowance("plan", "contremaitre", { count: 29, bytes: 0 }, 10)).toBe(false);
    expect(exceedsDailyAllowance("plan", "contremaitre", { count: 30, bytes: 0 }, 10)).toBe(true);
    expect(exceedsDailyAllowance("document", "contremaitre", { count: 100, bytes: 0 }, 10)).toBe(
      true,
    );
  });

  it("stops at the bytes of the kind", () => {
    // Twelve 500 MB plans fit in 6 GB, a thirteenth does not.
    const foreman = "contremaitre";
    expect(exceedsDailyAllowance("plan", foreman, { count: 11, bytes: 5500 * MB }, 500 * MB)).toBe(
      false,
    );
    expect(exceedsDailyAllowance("plan", foreman, { count: 12, bytes: 6000 * MB }, 500 * MB)).toBe(
      true,
    );
    expect(exceedsDailyAllowance("photo", foreman, { count: 100, bytes: 3 * GB - 10 }, 10)).toBe(
      false,
    );
    expect(exceedsDailyAllowance("photo", foreman, { count: 100, bytes: 3 * GB - 10 }, 11)).toBe(
      true,
    );
  });

  it("gives the office five times as much, and no more", () => {
    expect(OFFICE_DAILY_FACTOR).toBe(5);
    expect(dailyLimit("plan", "admin")).toEqual({ count: 150, bytes: 30 * GB });
    expect(dailyLimit("plan", "contremaitre")).toEqual(DAILY_LIMITS.plan);
    expect(dailyLimit("photo", "travailleur")).toEqual(DAILY_LIMITS.photo);
    expect(exceedsDailyAllowance("plan", "admin", { count: 149, bytes: 0 }, 10)).toBe(false);
    expect(exceedsDailyAllowance("plan", "admin", { count: 150, bytes: 0 }, 10)).toBe(true);
    expect(exceedsDailyAllowance("document", "admin", { count: 10, bytes: 20 * GB }, 1)).toBe(true);
    expect(exceedsDailyAllowance("document", "admin", { count: 10, bytes: 20 * GB - 1 }, 1)).toBe(
      false,
    );
    // What stops a foreman lets the office through.
    expect(exceedsDailyAllowance("plan", "contremaitre", { count: 30, bytes: 0 }, 10)).toBe(true);
    expect(exceedsDailyAllowance("plan", "admin", { count: 30, bytes: 0 }, 10)).toBe(false);
  });
});

describe("uploadProblem", () => {
  const announced = { size: 1000, contentType: "application/pdf" };

  it("accepts the announced file", () => {
    expect(uploadProblem(announced, { size: 1000, contentType: "application/pdf" })).toBeNull();
    // Storage may add parameters or change the case.
    expect(
      uploadProblem(announced, { size: 1000, contentType: "Application/PDF; charset=binary" }),
    ).toBeNull();
  });

  it("refuses a file of another size", () => {
    expect(uploadProblem(announced, { size: 999, contentType: "application/pdf" })).toMatch(
      /incomplet/,
    );
    // 10 bytes announced, 500 MB sent.
    expect(
      uploadProblem(
        { size: 10, contentType: "image/jpeg" },
        { size: 500 * MB, contentType: "image/jpeg" },
      ),
    ).toMatch(/n'est pas celui qui était annoncé/);
  });

  it("refuses a file stored under another type than the announced one", () => {
    expect(uploadProblem(announced, { size: 1000, contentType: "text/html" })).toMatch(
      /n'est pas celui qui était annoncé/,
    );
  });

  it("does not ask a store that records no type (the development folder)", () => {
    expect(uploadProblem(announced, { size: 1000, contentType: null })).toBeNull();
    expect(uploadProblem(announced, { size: 1001, contentType: null })).not.toBeNull();
  });
});
