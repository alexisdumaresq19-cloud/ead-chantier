import { describe, expect, it } from "vitest";

import {
  acceptsUpload,
  BUCKET_RULES,
  exceedsAllowance,
  MAX_PENDING_BYTES,
  MAX_PENDING_UPLOADS,
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
