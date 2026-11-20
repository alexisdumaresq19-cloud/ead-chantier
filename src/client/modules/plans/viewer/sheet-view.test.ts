import { describe, expect, it } from "vitest";

import type { Plans, Sheet, SheetDetail, SheetRevision } from "@/shared/plans";

import { neighbourRevisions, resolveSheetView, revisionCode, revisionName } from "./sheet-view";

const revision = (id: string, label: string | null = id): SheetRevision => ({
  id,
  label,
  issuedOn: null,
  addedAt: "2026-10-01T12:00:00.000Z",
  tiles: {
    url: `/t/${id}`,
    width: 6622,
    height: 4677,
    tileSize: 1024,
    overlap: 1,
    minLevel: 8,
    maxLevel: 13,
  },
  thumbUrl: `/t/${id}/thumb.webp`,
});

const sheet = (id: string, current: SheetRevision | null, revisionCount = 1): Sheet => ({
  id,
  number: id.toUpperCase(),
  title: `Feuille ${id}`,
  folderId: null,
  sort: 0,
  current,
  revisionCount,
});

const plans: Plans = {
  folders: [],
  sheets: [sheet("a", revision("a1")), sheet("b", revision("b2"), 2), sheet("c", null, 0)],
};

const detailOfB: SheetDetail = {
  ...plans.sheets[1],
  revisions: [revision("b2"), revision("b1")],
  previousId: "a",
  nextId: "c",
};

describe("what the viewer shows", () => {
  it("opens a listed sheet before its detail has arrived", () => {
    const view = resolveSheetView({ sheetId: "b", revisionId: null, detail: undefined, plans });
    expect(view).toMatchObject({
      number: "B",
      shown: { id: "b2" },
      replaced: false,
      gap: null,
      previousId: "a",
      nextId: "c",
      position: { index: 2, total: 3 },
      revisionCount: 2,
    });
    expect(view?.revisions.map((r) => r.id)).toEqual(["b2"]);
  });

  it("prefers the detail, and keeps the position from the list", () => {
    const view = resolveSheetView({ sheetId: "b", revisionId: null, detail: detailOfB, plans });
    expect(view?.revisions.map((r) => r.id)).toEqual(["b2", "b1"]);
    expect(view?.position).toEqual({ index: 2, total: 3 });
  });

  it("opens from the detail alone, without a position", () => {
    const view = resolveSheetView({
      sheetId: "b",
      revisionId: null,
      detail: detailOfB,
      plans: undefined,
    });
    expect(view).toMatchObject({ shown: { id: "b2" }, previousId: "a", nextId: "c" });
    expect(view?.position).toBeNull();
  });

  it("knows nothing about a sheet that is nowhere on the device", () => {
    expect(
      resolveSheetView({ sheetId: "z", revisionId: null, detail: undefined, plans }),
    ).toBeNull();
    expect(
      resolveSheetView({ sheetId: "z", revisionId: null, detail: undefined, plans: undefined }),
    ).toBeNull();
  });

  it("ignores the detail of the sheet just left", () => {
    const view = resolveSheetView({ sheetId: "a", revisionId: null, detail: detailOfB, plans });
    expect(view).toMatchObject({ id: "a", shown: { id: "a1" }, previousId: null, nextId: "b" });
  });

  it("shows an older revision and says it is replaced", () => {
    const view = resolveSheetView({ sheetId: "b", revisionId: "b1", detail: detailOfB, plans });
    expect(view).toMatchObject({ shown: { id: "b1" }, current: { id: "b2" }, replaced: true });
  });

  it("treats the current revision's own id as no request at all", () => {
    const view = resolveSheetView({ sheetId: "b", revisionId: "b2", detail: detailOfB, plans });
    expect(view).toMatchObject({ shown: { id: "b2" }, replaced: false, gap: null });
  });

  it("waits for the detail before giving up on an older revision", () => {
    const waiting = resolveSheetView({ sheetId: "b", revisionId: "b1", detail: undefined, plans });
    expect(waiting).toMatchObject({ shown: null, gap: "awaiting-revisions" });
    const absent = resolveSheetView({ sheetId: "b", revisionId: "nope", detail: detailOfB, plans });
    expect(absent).toMatchObject({ shown: null, gap: "unknown-revision", current: { id: "b2" } });
  });

  it("says when a sheet has nothing drawn yet", () => {
    const view = resolveSheetView({ sheetId: "c", revisionId: null, detail: undefined, plans });
    expect(view).toMatchObject({ shown: null, gap: "unrendered", previousId: "b", nextId: null });
  });
});

describe("the sheets on either side", () => {
  it("gives their current revisions, the next one first", () => {
    const view = resolveSheetView({ sheetId: "b", revisionId: null, detail: detailOfB, plans })!;
    // "c" has nothing drawn yet: nothing to preload.
    expect(neighbourRevisions(view, plans).map((r) => r.id)).toEqual(["a1"]);
    const first = resolveSheetView({ sheetId: "a", revisionId: null, detail: undefined, plans })!;
    expect(neighbourRevisions(first, plans).map((r) => r.id)).toEqual(["b2"]);
    expect(neighbourRevisions(view, undefined)).toEqual([]);
  });
});

describe("a revision's name", () => {
  it("adds « Rév. » to a bare letter or number", () => {
    expect(revisionName({ label: "0" })).toBe("Rév. 0");
    expect(revisionName({ label: " B " })).toBe("Rév. B");
    expect(revisionName({ label: "12" })).toBe("Rév. 12");
  });

  it("keeps a label that already reads as words", () => {
    expect(revisionName({ label: "Rév. 2" })).toBe("Rév. 2");
    expect(revisionName({ label: "Émis pour construction" })).toBe("Émis pour construction");
  });

  it("has nothing to say when the office gave no label", () => {
    expect(revisionName({ label: null })).toBeNull();
    expect(revisionName({ label: "  " })).toBeNull();
  });

  it("tells a bare letter or number from a label in words", () => {
    expect(revisionCode({ label: " B " })).toBe("B");
    expect(revisionCode({ label: "12" })).toBe("12");
    expect(revisionCode({ label: "Rév. 2" })).toBeNull();
    expect(revisionCode({ label: "Émis pour construction" })).toBeNull();
    expect(revisionCode({ label: null })).toBeNull();
  });
});
