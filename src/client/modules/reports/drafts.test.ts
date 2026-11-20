import { describe, expect, it } from "vitest";

import {
  canKeepDrafts,
  draftKey,
  draftsVersion,
  listDrafts,
  readDraft,
  removeDraft,
  writeDraft,
  type Draft,
} from "./drafts";
import { emptyForm } from "./form";

/** What a browser's localStorage does, in memory. */
function fakeStore(limit = Number.POSITIVE_INFINITY) {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new Error("QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

const draftFor = (day: string, reportId: string | null = null): Draft => ({
  savedAt: "2026-11-19T20:42:00.000Z",
  reportId,
  baseUpdatedAt: reportId ? "2026-11-18T21:00:00.000Z" : null,
  form: { ...emptyForm(day), workDone: `Travaux du ${day}` },
});

describe("drafts kept on the device", () => {
  it("gives back what was written, until it is removed", () => {
    const store = fakeStore();
    const key = draftKey("julie", "p1", "2026-11-19");
    expect(readDraft(key, store)).toBeNull();
    expect(writeDraft(key, draftFor("2026-11-19"), store)).toBe(true);
    expect(readDraft(key, store)).toEqual(draftFor("2026-11-19"));
    removeDraft(key, store);
    expect(readDraft(key, store)).toBeNull();
  });

  it("lists a person's drafts in a project, latest day first, and nobody else's", () => {
    const store = fakeStore();
    writeDraft(draftKey("julie", "p1", "2026-11-17"), draftFor("2026-11-17"), store);
    writeDraft(draftKey("julie", "p1", "r9"), draftFor("2026-11-18", "r9"), store);
    writeDraft(draftKey("julie", "p2", "2026-11-19"), draftFor("2026-11-19"), store);
    writeDraft(draftKey("annie", "p1", "2026-11-19"), draftFor("2026-11-19"), store);
    store.setItem("ead-query-cache", "{}");
    const drafts = listDrafts("julie", "p1", store);
    expect(drafts.map((draft) => [draft.form.day, draft.reportId])).toEqual([
      ["2026-11-18", "r9"],
      ["2026-11-17", null],
    ]);
    expect(drafts[0].key).toBe(draftKey("julie", "p1", "r9"));
    expect(listDrafts("julie", "p3", store)).toEqual([]);
  });

  it("ignores what is not a draft", () => {
    const store = fakeStore();
    const key = draftKey("julie", "p1", "2026-11-19");
    for (const stored of [
      "",
      "pas du JSON",
      "null",
      "42",
      '{"savedAt":"x"}',
      '{"form":{"day":1}}',
    ]) {
      store.setItem(key, stored);
      expect(readDraft(key, store)).toBeNull();
      expect(listDrafts("julie", "p1", store)).toEqual([]);
    }
  });

  it("says so when the device cannot keep a draft", () => {
    const full = fakeStore(10);
    expect(writeDraft("k", draftFor("2026-11-19"), full)).toBe(false);
    expect(canKeepDrafts(fakeStore(0))).toBe(false);
    expect(canKeepDrafts(fakeStore())).toBe(true);
    expect(canKeepDrafts(null)).toBe(false);
    expect(writeDraft("k", draftFor("2026-11-19"), null)).toBe(false);
    expect(readDraft("k", null)).toBeNull();
    expect(listDrafts("julie", "p1", null)).toEqual([]);
  });

  it("tells the screens that list drafts when one changes", () => {
    const store = fakeStore();
    const before = draftsVersion();
    writeDraft("k", draftFor("2026-11-19"), store);
    expect(draftsVersion()).toBe(before + 1);
    removeDraft("k", store);
    expect(draftsVersion()).toBe(before + 2);
    // Removing what is not there changes nothing.
    removeDraft("k", store);
    expect(draftsVersion()).toBe(before + 2);
  });
});
