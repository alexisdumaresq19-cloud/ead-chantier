import { describe, expect, it } from "vitest";

import {
  isDay,
  PHOTO_ID_PATTERN,
  photoCursor,
  readPhotoCursor,
  type Photo,
  shiftDay,
  siteDay,
  siteDayBounds,
  siteTimeToDate,
} from "./photos";

describe("the site's clock", () => {
  it("files a photo under the day it was taken at the site", () => {
    // 23:30 in Québec is already the next day in UTC.
    expect(siteDay("2026-10-02T03:30:00.000Z")).toBe("2026-10-01");
    expect(siteDay(new Date("2026-10-02T04:00:00.000Z"))).toBe("2026-10-02");
    // In winter the site is five hours behind UTC, not four.
    expect(siteDay("2026-01-15T04:30:00.000Z")).toBe("2026-01-14");
    expect(siteDay("2026-01-15T05:00:00.000Z")).toBe("2026-01-15");
  });

  it("turns a camera's local time into a real moment, summer and winter", () => {
    expect(siteTimeToDate(Date.UTC(2026, 6, 1, 14, 5, 0)).toISOString()).toBe(
      "2026-07-01T18:05:00.000Z",
    );
    expect(siteTimeToDate(Date.UTC(2026, 0, 15, 14, 5, 0)).toISOString()).toBe(
      "2026-01-15T19:05:00.000Z",
    );
  });

  it("holds around the changes of hour", () => {
    // 8 March 2026: clocks jump from 2:00 to 3:00.
    expect(siteTimeToDate(Date.UTC(2026, 2, 8, 1, 30)).toISOString()).toBe(
      "2026-03-08T06:30:00.000Z",
    );
    expect(siteTimeToDate(Date.UTC(2026, 2, 8, 3, 30)).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    // 1 November 2026: clocks fall back from 2:00 to 1:00.
    expect(siteTimeToDate(Date.UTC(2026, 10, 1, 0, 30)).toISOString()).toBe(
      "2026-11-01T04:30:00.000Z",
    );
    expect(siteTimeToDate(Date.UTC(2026, 10, 1, 3, 0)).toISOString()).toBe(
      "2026-11-01T08:00:00.000Z",
    );
  });

  it("bounds a day from midnight to midnight at the site", () => {
    const day = siteDayBounds("2026-10-01");
    expect(day.from.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(day.to.toISOString()).toBe("2026-10-02T04:00:00.000Z");
    // The day clocks go forward lasts 23 hours, the day they go back 25.
    const short = siteDayBounds("2026-03-08");
    expect(short.to.getTime() - short.from.getTime()).toBe(23 * 3_600_000);
    const long = siteDayBounds("2026-11-01");
    expect(long.to.getTime() - long.from.getTime()).toBe(25 * 3_600_000);
    // The end of a month runs into the next.
    expect(siteDayBounds("2026-01-31").to.toISOString()).toBe("2026-02-01T05:00:00.000Z");
  });

  it("puts every moment of a day inside its bounds", () => {
    for (const instant of ["2026-03-08T04:59:59.000Z", "2026-11-01T05:30:00.000Z"]) {
      const { from, to } = siteDayBounds(siteDay(instant));
      const time = new Date(instant).getTime();
      expect(time >= from.getTime() && time < to.getTime()).toBe(true);
    }
  });
});

describe("days as text", () => {
  it("tells real days from the rest", () => {
    expect(isDay("2026-10-01")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-1-1")).toBe(false);
    expect(isDay("hier")).toBe(false);
  });

  it("steps from a day to its neighbours", () => {
    expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-08", 1)).toBe("2026-03-09");
  });
});

describe("what names a photo", () => {
  it("resumes a list after a photo", () => {
    expect(photoCursor({ takenAt: "2026-10-01T18:05:00.000Z", id: "abcdefghjkmnpqrs" })).toBe(
      "2026-10-01T18:05:00.000Z_abcdefghjkmnpqrs",
    );
  });

  it("reads back a cursor it made, and nothing else", () => {
    const photo = { takenAt: "2026-10-01T18:05:00.000Z", id: "abcdefghjkmnpqrs" };
    expect(readPhotoCursor(photoCursor(photo))).toEqual({
      takenAt: new Date(photo.takenAt),
      id: photo.id,
    });
    expect(readPhotoCursor("2026-10-01T18:05:00Z_abc")?.id).toBe("abc");
    for (const wrong of [
      "",
      "abc",
      "2026-10-01T18:05:00.000Z",
      "2026-10-01T18:05:00.000Z_",
      "2026-13-45T18:05:00.000Z_abc",
      "2026-02-30T18:05:00.000Z_abc",
      "2026-10-01T25:05:00.000Z_abc",
      "2026-10-01T18:05:00.000+02:00_abc",
      "2026-10-01T18:05:00.000Z_ABC",
      `2026-10-01T18:05:00.000Z_${"a".repeat(41)}`,
      "2026-10-01T18:05:00.000Z_abc;drop",
    ])
      expect(readPhotoCursor(wrong), wrong).toBeNull();
  });

  it("keeps the shape the reports module reads", () => {
    // Every field of a photo, named here: removing or renaming one fails the
    // type check, and the reports' day view would break with it.
    const photo: Required<{ [K in keyof Photo]: Photo[K] }> = {
      id: "abcdefghjkmnpqrs",
      url: "/files/public/p/x/full.jpg",
      thumbUrl: "/files/public/p/x/thumb.webp",
      width: 2560,
      height: 1920,
      takenAt: "2026-10-01T18:05:00.000Z",
      day: "2026-10-01",
      caption: null,
      authorId: null,
      authorName: null,
      canEdit: false,
    };
    expect(Object.keys(photo).sort()).toEqual([
      "authorId",
      "authorName",
      "canEdit",
      "caption",
      "day",
      "height",
      "id",
      "takenAt",
      "thumbUrl",
      "url",
      "width",
    ]);
  });

  it("accepts ids of the server's shape only", () => {
    expect(PHOTO_ID_PATTERN.test("abcdefghjkmnpqrs")).toBe(true);
    expect(PHOTO_ID_PATTERN.test("abcdefghjkmnpqr")).toBe(false);
    // No look-alike characters: i, l, o, 0, 1.
    expect(PHOTO_ID_PATTERN.test("abcdefghijkmnpqr")).toBe(false);
    expect(PHOTO_ID_PATTERN.test("abcdefgh0kmnpqrs")).toBe(false);
    expect(PHOTO_ID_PATTERN.test("../../etc/passwd")).toBe(false);
  });
});
