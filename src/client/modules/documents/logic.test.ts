import { describe, expect, it } from "vitest";

import type { DocumentCategory, ProjectDocument } from "@/shared/documents";

import { addDrafts, formatAdded, groupDocuments, matchesSearch, sameTitle } from "./logic";

let serial = 0;
const doc = (
  title: string,
  category: DocumentCategory,
  addedAt = "2026-10-01T12:00:00.000Z",
): ProjectDocument => ({
  id: `d${++serial}`,
  title,
  category,
  filename: `${title}.pdf`,
  size: 1000,
  addedAt,
  addedBy: "Julie Cyr",
});

describe("matchesSearch", () => {
  it("ignores accents and case", () => {
    expect(matchesSearch("Échéancier des travaux", "echeancier")).toBe(true);
    expect(matchesSearch("Permis MELCCFP", "melccfp")).toBe(true);
  });

  it("wants every word, in any order", () => {
    expect(matchesSearch("Devis — section 3, égout pluvial", "egout devis")).toBe(true);
    expect(matchesSearch("Devis — section 3, égout pluvial", "devis aqueduc")).toBe(false);
  });

  it("matches everything while nothing is typed", () => {
    expect(matchesSearch("Devis", "")).toBe(true);
    expect(matchesSearch("Devis", "   ")).toBe(true);
  });
});

describe("sameTitle", () => {
  it("looks past case, accents and spacing", () => {
    expect(sameTitle("Programme de prévention", " programme  de prevention ")).toBe(true);
    expect(sameTitle("Devis section 2", "Devis section 3")).toBe(false);
  });
});

describe("groupDocuments", () => {
  const documents = [
    doc("Fiche tuyau PVC", "fiches"),
    doc("Devis section 10", "contrat"),
    doc("Programme de prévention", "sst"),
    doc("Devis section 2", "contrat"),
    doc("contrat signé", "contrat"),
    doc("Note de chantier", "autre"),
  ];

  it("puts categories in their fixed order and leaves out the empty ones", () => {
    expect(groupDocuments(documents).map((group) => group.category)).toEqual([
      "contrat",
      "sst",
      "fiches",
      "autre",
    ]);
  });

  it("sorts titles as a person would, numbers included", () => {
    expect(groupDocuments(documents)[0].documents.map((d) => d.title)).toEqual([
      "contrat signé",
      "Devis section 2",
      "Devis section 10",
    ]);
  });

  it("shows the newest first among documents with the same title", () => {
    const twins = [
      doc("Essai de compaction", "essais", "2026-10-01T12:00:00.000Z"),
      doc("Essai de compaction", "essais", "2026-10-08T12:00:00.000Z"),
    ];
    expect(groupDocuments(twins)[0].documents.map((d) => d.addedAt)).toEqual([
      "2026-10-08T12:00:00.000Z",
      "2026-10-01T12:00:00.000Z",
    ]);
  });

  it("keeps only what the search finds", () => {
    const groups = groupDocuments(documents, "devis");
    expect(groups).toHaveLength(1);
    expect(groups[0].documents).toHaveLength(2);
    expect(groupDocuments(documents, "introuvable")).toEqual([]);
  });

  it("does not reorder the list it is given", () => {
    const before = documents.map((d) => d.id);
    groupDocuments(documents);
    expect(documents.map((d) => d.id)).toEqual(before);
  });
});

describe("formatAdded", () => {
  const now = new Date(2026, 10, 19, 9, 0);

  it("leaves the year out for this year", () => {
    expect(formatAdded(new Date(2026, 9, 14, 8, 0).toISOString(), now)).toBe("14 oct.");
  });

  it("says the year for an older document", () => {
    expect(formatAdded(new Date(2025, 11, 3, 8, 0).toISOString(), now)).toBe("3 déc. 2025");
  });
});

describe("addDrafts", () => {
  const file = (name: string, size = 1000, lastModified = 1) => ({ name, size, lastModified });

  it("titles each file after its name and checks it", () => {
    const drafts = addDrafts(
      [],
      [file("Permis_MELCCFP.pdf"), file("virus.exe"), file("vide.pdf", 0)],
    );
    expect(drafts.map((draft) => [draft.title, draft.problem])).toEqual([
      ["Permis MELCCFP", null],
      ["virus", "type"],
      ["vide", "empty"],
    ]);
  });

  it("keeps a file picked twice only once", () => {
    const first = addDrafts([], [file("Devis.pdf")]);
    const second = addDrafts(first, [file("Devis.pdf"), file("Devis.pdf")]);
    expect(second).toHaveLength(1);
    expect(second[0]).toBe(first[0]);
  });

  it("keeps two different files that share a name", () => {
    const drafts = addDrafts([], [file("Devis.pdf", 1000, 1), file("Devis.pdf", 2400, 7)]);
    expect(drafts).toHaveLength(2);
    expect(new Set(drafts.map((draft) => draft.key)).size).toBe(2);
  });

  it("keeps titles already edited", () => {
    const [first] = addDrafts([], [file("Devis.pdf")]);
    const edited = [{ ...first, title: "Devis signé" }];
    expect(addDrafts(edited, [file("Permis.pdf")]).map((draft) => draft.title)).toEqual([
      "Devis signé",
      "Permis",
    ]);
  });
});
