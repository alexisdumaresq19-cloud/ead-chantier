import { describe, expect, it } from "vitest";

import { hasRunOut, parseSiteCode } from "./site-code";

const link = { url: "https://exemple.ca/j/abc", expiresAt: "2026-11-20T14:00:00.000Z" };

describe("parseSiteCode", () => {
  it("gives back a stored link", () => {
    expect(parseSiteCode(JSON.stringify(link))).toEqual(link);
  });

  it("ignores what is not a link", () => {
    expect(parseSiteCode(null)).toBeNull();
    expect(parseSiteCode("")).toBeNull();
    expect(parseSiteCode("pas du JSON")).toBeNull();
    expect(parseSiteCode("null")).toBeNull();
    expect(parseSiteCode(JSON.stringify({ url: link.url }))).toBeNull();
    expect(parseSiteCode(JSON.stringify({ ...link, expiresAt: "demain" }))).toBeNull();
    expect(parseSiteCode(JSON.stringify({ url: 3, expiresAt: link.expiresAt }))).toBeNull();
  });

  it("keeps only what a link is made of", () => {
    expect(parseSiteCode(JSON.stringify({ ...link, extra: "x" }))).toEqual(link);
  });
});

describe("hasRunOut", () => {
  it("is true from the very moment the code ends", () => {
    expect(hasRunOut(link, new Date("2026-11-20T13:59:59.999Z"))).toBe(false);
    expect(hasRunOut(link, new Date("2026-11-20T14:00:00.000Z"))).toBe(true);
    expect(hasRunOut(link, new Date("2026-11-21T09:00:00.000Z"))).toBe(true);
  });
});
