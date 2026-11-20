import { describe, expect, it } from "vitest";

import { isCompanyCode, looksGuessable, newCompanyCode } from "./code";

describe("the company code", () => {
  it("is eight digits from the random source, never an obvious one", () => {
    const codes = Array.from({ length: 500 }, newCompanyCode);
    for (const code of codes) {
      expect(code).toMatch(/^\d{8}$/);
      expect(looksGuessable(code)).toBe(false);
    }
    // Five hundred draws among a hundred million: no repeats, every digit everywhere.
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(codes.map((code) => code[0])).size).toBe(10);
  });

  it("knows the codes anyone would try first", () => {
    for (const code of ["00000000", "77777777", "12345678", "23456789", "87654321", "90123456"])
      expect(looksGuessable(code), code).toBe(true);
    expect(looksGuessable("48271936")).toBe(false);
  });

  it("opens only with the code in force, and never while creation is closed", () => {
    expect(isCompanyCode("48271936", "48271936")).toBe(true);
    expect(isCompanyCode("48271937", "48271936")).toBe(false);
    expect(isCompanyCode("", "48271936")).toBe(false);
    expect(isCompanyCode("48271936", null)).toBe(false);
  });
});
