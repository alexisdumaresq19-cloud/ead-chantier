import { describe, expect, it } from "vitest";

import type { Plans, Sheet, Tiles } from "@/shared/plans";

import {
  estimateBytes,
  filesToKeep,
  isSpaceShort,
  keptStatus,
  keptTotals,
  sheetsStillThere,
  sheetsToFetch,
  unusedFolders,
  type KeptProject,
} from "./keep";

// A small sheet: one tile at each of its two levels.
const tiles = (folder: string): Tiles => ({
  url: folder,
  width: 1500,
  height: 1000,
  tileSize: 1024,
  overlap: 1,
  minLevel: 10,
  maxLevel: 11,
});

const sheet = (id: string, revisionId: string | null): Sheet => ({
  id,
  number: id.toUpperCase(),
  title: "Exemple",
  folderId: null,
  sort: 0,
  revisionCount: revisionId ? 1 : 0,
  current: revisionId
    ? {
        id: revisionId,
        label: "0",
        issuedOn: null,
        addedAt: "2026-10-01T12:00:00.000Z",
        tiles: tiles(`/files/public/t/${revisionId}`),
        thumbUrl: `/files/public/t/${revisionId}/thumb.webp`,
      }
    : null,
});

const plans = (...sheets: Sheet[]): Plans => ({ folders: [], sheets });

const keptSheet = (revisionId: string, files = 4, bytes = 4000) => ({
  revisionId,
  folder: `/files/public/t/${revisionId}`,
  files,
  bytes,
});

const kept = (sheets: KeptProject["sheets"], keptAt: string | null = "2026-11-19T15:00:00.000Z") =>
  ({
    projectId: "p1",
    keptAt,
    sheets,
    folders: Object.values(sheets).map((each) => each.folder),
  }) satisfies KeptProject;

describe("what keeping a project takes", () => {
  it("lists the thumbnail first, then every tile from the smallest level", () => {
    const [files] = filesToKeep(plans(sheet("c-001", "r1")));
    expect(files).toEqual({
      sheetId: "c-001",
      revisionId: "r1",
      folder: "/files/public/t/r1",
      urls: [
        "/files/public/t/r1/thumb.webp",
        "/files/public/t/r1/10/0_0.webp",
        "/files/public/t/r1/11/0_0.webp",
        "/files/public/t/r1/11/1_0.webp",
      ],
    });
  });

  it("skips a sheet that has nothing to show yet", () => {
    expect(filesToKeep(plans(sheet("c-001", null), sheet("c-002", "r2")))).toHaveLength(1);
  });
});

describe("what the device lacks", () => {
  const wanted = filesToKeep(
    plans(sheet("c-001", "r1"), sheet("c-002", "r2b"), sheet("c-003", "r3")),
  );

  it("is everything when nothing is kept", () => {
    expect(sheetsToFetch(null, wanted)).toHaveLength(3);
  });

  it("is the new sheets and the revised ones", () => {
    const device = kept({ "c-001": keptSheet("r1"), "c-002": keptSheet("r2") });
    expect(sheetsToFetch(device, wanted).map((each) => each.sheetId)).toEqual(["c-002", "c-003"]);
  });

  it("names the folders the plans no longer use", () => {
    const device = kept({
      "c-001": keptSheet("r1"),
      "c-002": keptSheet("r2"),
      "c-009": keptSheet("r9"),
    });
    expect(unusedFolders(device, wanted)).toEqual(["/files/public/t/r2", "/files/public/t/r9"]);
  });
});

describe("checking the files are still there", () => {
  const absolute = (url: string) => `https://chantier.example${url}`;
  const device = kept({ "c-001": keptSheet("r1"), "c-002": keptSheet("r2") });
  const stored = (revisionId: string, files: number) =>
    Array.from({ length: files }, (_, index) =>
      absolute(`/files/public/t/${revisionId}/${index}.webp`),
    );

  it("keeps the sheets whose files are all in the cache", () => {
    expect(sheetsStillThere(device, [...stored("r1", 4), ...stored("r2", 4)], absolute)).toEqual(
      device,
    );
  });

  it("drops a sheet the browser has cleared, even in part", () => {
    const after = sheetsStillThere(device, [...stored("r1", 4), ...stored("r2", 3)], absolute);
    expect(Object.keys(after.sheets)).toEqual(["c-001"]);
    // The folder stays noted: what is left of it must still be removable.
    expect(after.folders).toEqual(device.folders);
  });

  it("does not take one folder for another that starts the same", () => {
    const after = sheetsStillThere(device, stored("r11", 4), absolute);
    expect(after.sheets).toEqual({});
  });
});

describe("sizes", () => {
  it("adds up the sheets on the device", () => {
    expect(keptTotals([keptSheet("r1", 55, 1_800_000), keptSheet("r2", 55, 2_200_000)])).toEqual({
      sheets: 2,
      files: 110,
      bytes: 4_000_000,
    });
  });

  it("estimates from a typical tile until the device knows better", () => {
    expect(estimateBytes(440, { files: 0, bytes: 0 })).toBe(440 * 45_000);
    expect(estimateBytes(440, { files: 55, bytes: 55 * 90_000 })).toBe(440 * 45_000);
    expect(estimateBytes(440, { files: 110, bytes: 110 * 90_000 })).toBe(440 * 90_000);
  });

  it("warns when the room left is about what the download takes", () => {
    expect(isSpaceShort(80_000_000, 100_000_000)).toBe(false);
    expect(isSpaceShort(95_000_000, 100_000_000)).toBe(true);
    expect(isSpaceShort(95_000_000, null)).toBe(false);
  });
});

describe("what the card shows", () => {
  const whole = kept({ "c-001": keptSheet("r1") });
  const started = kept({ "c-001": keptSheet("r1") }, null);

  it("follows the download while it runs", () => {
    expect(keptStatus(null, true, 3)).toBe("downloading");
    expect(keptStatus(whole, true, 1)).toBe("downloading");
  });

  it("offers to keep a project that is not on the device", () => {
    expect(keptStatus(null, false, 3)).toBe("none");
  });

  it("says a first download did not finish", () => {
    expect(keptStatus(started, false, 2)).toBe("interrupted");
    expect(keptStatus(started, false, undefined)).toBe("interrupted");
  });

  it("tells a kept project from one whose plans changed", () => {
    expect(keptStatus(whole, false, 0)).toBe("kept");
    expect(keptStatus(whole, false, 2)).toBe("outdated");
  });

  it("trusts the kept copy when the plan list cannot be read", () => {
    expect(keptStatus(whole, false, undefined)).toBe("kept");
  });
});
