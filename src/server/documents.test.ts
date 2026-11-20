import { describe, expect, it } from "vitest";

import { DOCUMENT_TITLE_MAX } from "@/shared/documents";

import { documentCategory, documentTitle, isRecordId } from "./documents";

describe("isRecordId", () => {
  it("takes the ids the app makes", () => {
    expect(isRecordId("h72tc43j7cawpy6h")).toBe(true);
  });

  it("refuses what cannot name a record", () => {
    expect(isRecordId("")).toBe(false);
    expect(isRecordId("\u0000")).toBe(false);
    expect(isRecordId("abc def")).toBe(false);
    expect(isRecordId("' or 1=1 --")).toBe(false);
    expect(isRecordId("../u/abc")).toBe(false);
    expect(isRecordId("a".repeat(41))).toBe(false);
  });
});

describe("documentTitle", () => {
  it("tidies the title before checking it", () => {
    expect(documentTitle.parse("  Devis \n section\u0000 3 ")).toBe("Devis section 3");
  });

  it("refuses an empty title and one that is too long", () => {
    expect(documentTitle.safeParse(" \t\u0000 ").success).toBe(false);
    expect(documentTitle.safeParse("x".repeat(DOCUMENT_TITLE_MAX)).success).toBe(true);
    expect(documentTitle.safeParse("x".repeat(DOCUMENT_TITLE_MAX + 1)).success).toBe(false);
    expect(documentTitle.safeParse(42).success).toBe(false);
  });
});

describe("documentCategory", () => {
  it("takes the known keys only", () => {
    expect(documentCategory.safeParse("sst").success).toBe(true);
    expect(documentCategory.safeParse("Santé et sécurité").success).toBe(false);
  });
});
