import { describe, expect, it, vi } from "vitest";

import type { Photo } from "@/shared/photos";

import type { LocalPhoto } from "../photos/logic";

// The outbox opens the device's storage as it loads: none of it is used here.
vi.mock("../photos/outbox", () => ({ useLocalPhotos: () => [] }));
const { leftOutText, photosToOffer, reportPdfUrl, reportPhotos, stillOnDevice } =
  await import("./photos");

const saved = (id: string, takenAt: string, caption: string | null = null): Photo => ({
  id,
  url: `/p/${id}/full.jpg`,
  thumbUrl: `/p/${id}/thumb.webp`,
  width: 1600,
  height: 1200,
  takenAt,
  day: takenAt.slice(0, 10),
  caption,
  authorId: "u1",
  authorName: "Julie Cyr",
  canEdit: true,
});
const waiting = (
  id: string,
  takenAt: string,
  state: LocalPhoto["state"] = "sending",
): LocalPhoto => ({
  id,
  projectId: "p1",
  ownerId: "u1",
  takenAt,
  caption: "Sur l'appareil",
  state,
  error: null,
});
const none = new Map<string, { photo: Photo; at: number }>();
const ids = (photos: { id: string }[]) => photos.map((photo) => photo.id);

describe("the photos of a report, found where they are", () => {
  it("come in the order they were taken, whatever the order they were added in", () => {
    const known = {
      photos: [saved("b", "2026-11-19T15:00:00.000Z"), saved("a", "2026-11-19T13:00:00.000Z")],
      at: 1000,
    };
    const locals = [waiting("c", "2026-11-19T14:00:00.000Z")];
    const found = reportPhotos(["b", "c", "a", "b"], known, none, locals);
    expect(ids(found)).toEqual(["a", "c", "b"]);
    expect(found[1]).toMatchObject({ caption: "Sur l'appareil", local: locals[0] });
    expect(found[0].photo).toBe(known.photos[1]);
  });

  it("leave out a photo found nowhere, and one the report does not name", () => {
    const known = { photos: [saved("a", "2026-11-19T13:00:00.000Z")], at: 1000 };
    const locals = [waiting("z", "2026-11-19T14:00:00.000Z")];
    expect(ids(reportPhotos(["a", "gone"], known, none, locals))).toEqual(["a"]);
  });

  it("show the project's photo rather than the device's once the server has it", () => {
    const fetched = new Map([["a", { photo: saved("a", "2026-11-19T13:00:00.000Z"), at: 2000 }]]);
    const locals = [waiting("a", "2026-11-19T13:00:00.000Z", "sent")];
    const [found] = reportPhotos(["a"], undefined, fetched, locals);
    expect(found.photo).toBe(fetched.get("a")!.photo);
    expect(found.local).toBeUndefined();
  });

  it("take the newer of what came with the report and what was changed since", () => {
    const withReport = saved("a", "2026-11-19T13:00:00.000Z", "Avec le rapport");
    const changed = saved("a", "2026-11-19T13:00:00.000Z", "Corrigée ici");
    const fetched = new Map([["a", { photo: changed, at: 2000 }]]);
    expect(reportPhotos(["a"], { photos: [withReport], at: 1000 }, fetched, [])[0].caption).toBe(
      "Corrigée ici",
    );
    // The report read again afterwards knows better.
    expect(reportPhotos(["a"], { photos: [withReport], at: 3000 }, fetched, [])[0].caption).toBe(
      "Avec le rapport",
    );
  });
});

describe("what the screens say of a report's photos", () => {
  it("count as still on the device only those the server does not have yet", () => {
    const found = reportPhotos(
      ["a", "b", "c", "d"],
      { photos: [saved("a", "2026-11-19T12:00:00.000Z")], at: 1000 },
      none,
      [
        waiting("b", "2026-11-19T13:00:00.000Z", "waiting"),
        waiting("c", "2026-11-19T14:00:00.000Z", "sent"),
        waiting("d", "2026-11-19T15:00:00.000Z", "refused"),
      ],
    );
    expect(ids(stillOnDevice(found))).toEqual(["b", "d"]);
  });

  it("offer the day's photos not with the report yet, oldest first", () => {
    const day = [
      saved("late", "2026-11-19T20:00:00.000Z"),
      saved("taken", "2026-11-19T15:00:00.000Z"),
      saved("early", "2026-11-19T11:00:00.000Z"),
    ];
    expect(ids(photosToOffer(day, ["taken"]))).toEqual(["early", "late"]);
    expect(photosToOffer(day, ["late", "taken", "early"])).toEqual([]);
  });

  it("say how many photos were left out, and that they stay in the project", () => {
    expect(leftOutText(1)).toBe(
      "1 photo n'a pas été ajoutée au rapport\u00a0: il en a déjà 40, le maximum. Elle reste dans les photos du projet.",
    );
    expect(leftOutText(3)).toMatch(/^3 photos n'ont pas été ajoutées .* Elles restent/);
  });

  it("give the PDF's address, shown or kept as a file", () => {
    expect(reportPdfUrl("r1")).toBe("/api/reports/r1/pdf");
    expect(reportPdfUrl("r1", true)).toBe("/api/reports/r1/pdf?download");
  });
});
