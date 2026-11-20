import { describe, expect, it } from "vitest";

import {
  plainText,
  sheetNumberKey,
  type ImportPage,
  type PlanFolder,
  type Sheet,
} from "@/shared/plans";

import {
  draftProblems,
  filterSheets,
  groupByFolder,
  highlightParts,
  indexSheets,
  keptPages,
  revisionName,
  sheetsByNumber,
  sortPdfFiles,
} from "./logic";

const sheet = (number: string, title: string, folderId: string | null = null): Sheet => ({
  id: number,
  number,
  title,
  folderId,
  sort: 0,
  current: null,
  revisionCount: 1,
});

const sheets = [
  sheet("C-001", "Page titre et liste des dessins"),
  sheet("C-101", "Plan d'ensemble — Aqueduc et égouts"),
  sheet("C-201", "Drainage et nivellement"),
  sheet("C-2010", "Détails du drainage"),
  sheet("S-102", "Coupes — murs de soutènement, feuille 201"),
];
const numbers = (found: Sheet[]) => found.map((found) => found.number);

describe("sheet numbers", () => {
  it("are the same sheet whatever their case and separators", () => {
    expect(sheetNumberKey("C-101")).toBe(sheetNumberKey("c 101"));
    expect(sheetNumberKey("C.101")).toBe(sheetNumberKey("C101"));
    expect(sheetNumberKey(" C-101 ")).toBe("C101");
    expect(sheetNumberKey("C-101")).not.toBe(sheetNumberKey("C-1010"));
  });

  it("keep a number made only of separators as itself", () => {
    expect(sheetNumberKey("-")).toBe("-");
    expect(sheetNumberKey("-")).not.toBe(sheetNumberKey("."));
  });

  it("find the project's sheet a page would replace", () => {
    const existing = sheetsByNumber(sheets);
    expect(existing.get(sheetNumberKey("c201"))?.number).toBe("C-201");
    expect(existing.get(sheetNumberKey("C-999"))).toBeUndefined();
  });
});

describe("searching the list", () => {
  const index = indexSheets(sheets);

  it("returns the whole list, in order, when nothing is typed", () => {
    expect(numbers(filterSheets(index, "  "))).toEqual(numbers(sheets));
  });

  it("finds a number typed without its dash, in any case", () => {
    expect(numbers(filterSheets(index, "c201"))).toEqual(["C-201", "C-2010"]);
    expect(numbers(filterSheets(index, "c-101"))).toEqual(["C-101"]);
    // "c" and "201" are also both in the title of S-102: found, but last.
    expect(numbers(filterSheets(index, "C 201"))).toEqual(["C-201", "C-2010", "S-102"]);
  });

  it("puts numbers before titles that hold the same digits", () => {
    expect(numbers(filterSheets(index, "201"))).toEqual(["C-201", "C-2010", "S-102"]);
  });

  it("ignores accents, both ways", () => {
    expect(numbers(filterSheets(index, "egout"))).toEqual(["C-101"]);
    expect(numbers(filterSheets(index, "DÉTAILS"))).toEqual(["C-2010"]);
    expect(numbers(filterSheets(index, "soutenement"))).toEqual(["S-102"]);
  });

  it("needs every word, in the number or in the title", () => {
    expect(numbers(filterSheets(index, "drainage c"))).toEqual(["C-201", "C-2010"]);
    expect(numbers(filterSheets(index, "drainage details"))).toEqual(["C-2010"]);
    expect(filterSheets(index, "drainage toiture")).toEqual([]);
  });

  it("stays quick on a large set", () => {
    const many = indexSheets(
      Array.from({ length: 2000 }, (_, i) => sheet(`A-${i}`, `Niveau ${i} — plan d'étage`)),
    );
    const started = performance.now();
    expect(filterSheets(many, "a-1999")).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("highlighting what was found", () => {
  it("marks the words where they are, keeping the text as written", () => {
    expect(highlightParts("Aqueduc et égouts", "egout")).toEqual([
      { text: "Aqueduc et ", hit: false },
      { text: "égout", hit: true },
      { text: "s", hit: false },
    ]);
  });

  it("marks every word and every place", () => {
    const parts = highlightParts("Regards et puisards, regard type", "REGARD puisard");
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual([
      "Regard",
      "puisard",
      "regard",
    ]);
    expect(parts.map((part) => part.text).join("")).toBe("Regards et puisards, regard type");
  });

  it("leaves the text whole when nothing matches", () => {
    expect(highlightParts("C-201", "zz")).toEqual([{ text: "C-201", hit: false }]);
    expect(highlightParts("", "zz")).toEqual([]);
  });
});

describe("folders", () => {
  const folders: PlanFolder[] = [
    { id: "civil", name: "Civil", sort: 1 },
    { id: "structure", name: "Structure", sort: 2 },
  ];
  const plans = {
    folders,
    sheets: [sheet("C-101", "", "civil"), sheet("X-1", ""), sheet("C-102", "", "civil")],
  };

  it("groups sheets by folder, loose sheets last", () => {
    const groups = groupByFolder(plans, { keepEmpty: false });
    expect(groups.map((group) => [group.folder?.name ?? null, numbers(group.sheets)])).toEqual([
      ["Civil", ["C-101", "C-102"]],
      [null, ["X-1"]],
    ]);
  });

  it("shows empty folders only to those who manage them", () => {
    const groups = groupByFolder(plans, { keepEmpty: true });
    expect(groups.map((group) => group.folder?.name ?? null)).toEqual(["Civil", "Structure", null]);
  });

  it("never shows an empty group of loose sheets", () => {
    const groups = groupByFolder({ folders, sheets: [] }, { keepEmpty: true });
    expect(groups.map((group) => group.folder?.name)).toEqual(["Civil", "Structure"]);
  });

  it("keeps a sheet whose folder is gone among the loose ones", () => {
    const groups = groupByFolder(
      { folders, sheets: [sheet("Z-1", "", "deleted")] },
      { keepEmpty: false },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBeNull();
  });
});

describe("revision names", () => {
  it("spells out a bare number or letter", () => {
    expect(revisionName("0")).toBe("Rév. 0");
    expect(revisionName(" B ")).toBe("Rév. B");
    expect(revisionName("12")).toBe("Rév. 12");
  });

  it("keeps a label that is already words", () => {
    expect(revisionName("Rév. 2")).toBe("Rév. 2");
    expect(revisionName("Émis pour construction")).toBe("Émis pour construction");
  });

  it("is nothing without a label", () => {
    expect(revisionName(null)).toBeNull();
    expect(revisionName("  ")).toBeNull();
  });
});

describe("checking an import", () => {
  const page = (pageIndex: number, draftNumber: string, more: Partial<ImportPage> = {}) =>
    ({
      id: `p${pageIndex + 1}`,
      pageIndex,
      status: "ready",
      error: null,
      thumbUrl: null,
      tiles: null,
      draftNumber,
      draftTitle: "",
      draftSheetId: null,
      draftSkip: false,
      ...more,
    }) satisfies ImportPage;

  it("finds nothing wrong with distinct numbers", () => {
    expect(draftProblems([page(0, "C-101"), page(1, "C-102")], {}).size).toBe(0);
  });

  it("asks for a missing number", () => {
    const problems = draftProblems([page(0, "  "), page(1, "C-102")], {});
    expect([...problems.keys()]).toEqual(["p1"]);
  });

  it("points two pages with one number at each other", () => {
    const problems = draftProblems([page(0, "C-101"), page(1, "c101"), page(2, "C-103")], {});
    expect(problems.get("p1")).toContain("page 2");
    expect(problems.get("p2")).toContain("page 1");
    expect(problems.has("p3")).toBe(false);
  });

  it("goes by what was typed rather than what was read on the page", () => {
    const pages = [page(0, "C-101"), page(1, "C-101")];
    const typed = { p2: { number: "C-102", title: "", skip: false } };
    expect(draftProblems(pages, typed).size).toBe(0);
  });

  it("leaves aside pages that are skipped or not converted", () => {
    const pages = [
      page(0, "C-101"),
      page(1, "C-101", { draftSkip: true }),
      page(2, "C-101", { status: "failed" }),
      page(3, "", { status: "queued" }),
    ];
    expect(draftProblems(pages, {}).size).toBe(0);
    expect(keptPages(pages, {}).map((kept) => kept.id)).toEqual(["p1"]);
    const typed = { p1: { number: "C-101", title: "", skip: true } };
    expect(keptPages(pages, typed)).toEqual([]);
  });
});

describe("choosing files", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("takes PDFs, by type or by name", () => {
    const { accepted, refused } = sortPdfFiles([
      file("plans.pdf", "application/pdf"),
      file("PLANS-REV2.PDF", ""),
      file("civil.pdf", "application/octet-stream"),
    ]);
    expect(accepted).toHaveLength(3);
    expect(refused).toEqual([]);
  });

  it("refuses anything else, saying which file and why", () => {
    const { accepted, refused } = sortPdfFiles([
      file("devis.docx", "application/msword"),
      file("photo.jpg", "image/jpeg"),
      file("vide.pdf", "application/pdf", 0),
      file("enorme.pdf", "application/pdf", 600 * 1024 * 1024),
    ]);
    expect(accepted).toEqual([]);
    expect(refused).toEqual([
      "« devis.docx » n'est pas un PDF.",
      "« photo.jpg » n'est pas un PDF.",
      "« vide.pdf » est vide.",
      "« enorme.pdf » dépasse 500 Mo.",
    ]);
  });
});

describe("plain text", () => {
  it("drops accents and case", () => {
    expect(plainText("Égout PLUVIAL à 0,5 %")).toBe("egout pluvial a 0,5 %");
  });
});
