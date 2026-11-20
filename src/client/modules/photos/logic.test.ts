import { describe, expect, it } from "vitest";

import type { Photo } from "@/shared/photos";

import { ApiFailure } from "../../lib/api";
import {
  BUSY_RETRY_DELAY,
  dayTitle,
  failureKind,
  fitWithin,
  groupByDay,
  monthTitle,
  newPhotoId,
  pickTakenAt,
  retryDelay,
  takenLabel,
  type LocalPhoto,
} from "./logic";

const photo = (id: string, takenAt: string, day: string): Photo => ({
  id,
  url: `/p/${id}/full.jpg`,
  thumbUrl: `/p/${id}/thumb.webp`,
  width: 1600,
  height: 1200,
  takenAt,
  day,
  caption: null,
  authorId: "u1",
  authorName: "Marc Lévesque",
  canEdit: true,
});

const local = (
  id: string,
  takenAt: string,
  state: LocalPhoto["state"] = "waiting",
): LocalPhoto => ({
  id,
  projectId: "p1",
  ownerId: "u1",
  takenAt,
  caption: null,
  state,
  error: null,
});

describe("the gallery's content", () => {
  it("groups by day, newest day and newest photo first", () => {
    const groups = groupByDay(
      [
        photo("a", "2026-10-01T14:00:00.000Z", "2026-10-01"),
        photo("c", "2026-10-02T15:00:00.000Z", "2026-10-02"),
        photo("b", "2026-10-01T18:00:00.000Z", "2026-10-01"),
      ],
      [],
    );
    expect(groups.map((group) => [group.day, group.tiles.map((tile) => tile.id)])).toEqual([
      ["2026-10-02", ["c"]],
      ["2026-10-01", ["b", "a"]],
    ]);
  });

  it("mixes in what waits on the device, on the day at the site", () => {
    const groups = groupByDay(
      [photo("a", "2026-10-01T14:00:00.000Z", "2026-10-01")],
      // 23:30 at the site on the 1st: already the 2nd in UTC.
      [local("w", "2026-10-02T03:30:00.000Z"), local("x", "2026-10-02T12:00:00.000Z")],
    );
    expect(groups.map((group) => [group.day, group.tiles.map((tile) => tile.id)])).toEqual([
      ["2026-10-02", ["x"]],
      ["2026-10-01", ["w", "a"]],
    ]);
    expect(groups[1].tiles[0].kind).toBe("local");
  });

  it("shows a photo once: the server's, as soon as it lists it", () => {
    const groups = groupByDay(
      [photo("a", "2026-10-01T14:00:00.000Z", "2026-10-01")],
      [local("a", "2026-10-01T14:00:00.000Z", "sent")],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].tiles).toHaveLength(1);
    expect(groups[0].tiles[0].kind).toBe("photo");
  });

  it("keeps a fixed order for photos taken in the same instant", () => {
    const same = "2026-10-01T14:00:00.000Z";
    const one = groupByDay([photo("a", same, "2026-10-01"), photo("b", same, "2026-10-01")], []);
    const other = groupByDay([photo("b", same, "2026-10-01"), photo("a", same, "2026-10-01")], []);
    expect(one[0].tiles.map((tile) => tile.id)).toEqual(["b", "a"]);
    expect(other[0].tiles.map((tile) => tile.id)).toEqual(["b", "a"]);
  });

  it("is empty when there is nothing", () => {
    expect(groupByDay([], [])).toEqual([]);
  });
});

describe("days in words", () => {
  it("says today, yesterday, then the date", () => {
    expect(dayTitle("2026-10-08", "2026-10-08")).toBe("Aujourd'hui");
    expect(dayTitle("2026-10-07", "2026-10-08")).toBe("Hier");
    expect(dayTitle("2026-10-01", "2026-10-08")).toBe("Jeudi 1er octobre");
    expect(dayTitle("2026-09-30", "2026-10-01")).toBe("Hier");
  });

  it("adds the year when it is another one", () => {
    expect(dayTitle("2025-12-31", "2026-01-01")).toBe("Hier");
    expect(dayTitle("2025-12-30", "2026-01-01")).toBe("Mardi 30 décembre 2025");
  });

  it("names a month", () => {
    expect(monthTitle("2026-11-16")).toBe("Novembre 2026");
  });

  it("says when a photo was taken, on the site's clock", () => {
    const taken = { takenAt: "2026-10-08T18:05:00.000Z", day: "2026-10-08" };
    expect(takenLabel(taken, "2026-10-08")).toBe("Aujourd'hui à 14 h 05");
    expect(takenLabel(taken, "2026-10-09")).toBe("Hier à 14 h 05");
    expect(takenLabel(taken, "2026-11-20")).toBe("8 octobre 2026 à 14 h 05");
  });
});

describe("sending again", () => {
  it("waits a little longer after each failure, up to five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(retryDelay)).toEqual([
      5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000,
    ]);
    expect(retryDelay(0)).toBe(5_000);
    expect(BUSY_RETRY_DELAY).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it("only discards a photo the server has looked at and refused", () => {
    expect(failureKind(new ApiFailure(400, "invalid_image", "…"))).toBe("invalid");
    // Everything else keeps the photo.
    expect(failureKind(new ApiFailure(0, "offline", "…"))).toBe("offline");
    expect(failureKind(new DOMException("Envoi annulé.", "AbortError"))).toBe("offline");
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("offline");
    expect(failureKind(new ApiFailure(401, "unauthorized", "…"))).toBe("signed-out");
    expect(failureKind(new ApiFailure(409, "upload_missing", "…"))).toBe("resend");
    expect(failureKind(new ApiFailure(404, "not_found", "…"))).toBe("refused");
    expect(failureKind(new ApiFailure(403, "forbidden", "…"))).toBe("refused");
    expect(failureKind(new ApiFailure(409, "conflict", "…"))).toBe("refused");
    expect(failureKind(new ApiFailure(403, "forbidden", "Ce projet est archivé."))).toBe("refused");
    // Too many sends: wait, never try again at once.
    expect(failureKind(new ApiFailure(429, "too_many_uploads", "…"))).toBe("busy");
    expect(failureKind(new ApiFailure(429, "daily_upload_limit", "…"))).toBe("busy");
    expect(failureKind(new ApiFailure(500, "server_error", "…"))).toBe("failed");
    expect(failureKind(new ApiFailure(502, "error", "…"))).toBe("failed");
    expect(failureKind(new ApiFailure(400, "bad_request", "…"))).toBe("failed");
    expect(failureKind(new ApiFailure(400, "invalid", "…"))).toBe("failed");
  });
});

describe("a photo's id and date", () => {
  it("makes ids of the server's shape", () => {
    const id = newPhotoId();
    expect(id).toMatch(/^[a-hjkmnp-z2-9]{16}$/);
    expect(newPhotoId()).not.toBe(id);
    expect(newPhotoId(new Uint8Array(16))).toBe("aaaaaaaaaaaaaaaa");
  });

  it("takes the camera's date, then the file's, then now", () => {
    const now = new Date("2026-10-08T18:00:00.000Z");
    const yesterday = new Date("2026-10-07T15:00:00.000Z");
    const lastWeek = new Date("2026-10-01T15:00:00.000Z").getTime();
    expect(pickTakenAt(yesterday, lastWeek, now)).toEqual(yesterday);
    expect(pickTakenAt(null, lastWeek, now)).toEqual(new Date(lastWeek));
    expect(pickTakenAt(null, undefined, now)).toEqual(now);
    expect(pickTakenAt(null, Number.NaN, now)).toEqual(now);
  });

  it("does not believe the future or a clock that was never set", () => {
    const now = new Date("2026-10-08T18:00:00.000Z");
    const lastWeek = new Date("2026-10-01T15:00:00.000Z").getTime();
    expect(pickTakenAt(new Date("2027-01-01T00:00:00Z"), lastWeek, now)).toEqual(
      new Date(lastWeek),
    );
    expect(pickTakenAt(new Date("1980-01-01T00:00:00Z"), 0, now)).toEqual(now);
    // A clock a few minutes ahead: now, not later.
    expect(pickTakenAt(new Date("2026-10-08T18:03:00.000Z"), undefined, now)).toEqual(now);
  });
});

describe("shrinking", () => {
  it("brings the longest side down to the limit", () => {
    expect(fitWithin(4032, 3024, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3024, 4032, 2560)).toEqual({ width: 1920, height: 2560 });
    expect(fitWithin(12000, 300, 2560)).toEqual({ width: 2560, height: 64 });
  });

  it("never enlarges", () => {
    expect(fitWithin(1170, 2532, 2560)).toEqual({ width: 1170, height: 2532 });
    expect(fitWithin(2560, 1440, 2560)).toEqual({ width: 2560, height: 1440 });
  });
});
