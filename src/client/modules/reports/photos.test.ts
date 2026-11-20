import { describe, expect, it, vi } from "vitest";

import type { Photo } from "@/shared/photos";

import type { LocalPhoto } from "../photos/logic";

// The outbox opens the device's storage as it loads: none of it is used here.
vi.mock("../photos/outbox", () => ({ useLocalPhotos: () => [] }));
const { reportPhotos } = await import("./photos");

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
