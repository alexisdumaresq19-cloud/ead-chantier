import { PDFiumLibrary } from "@hyzyla/pdfium";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderReportPdf, type ReportPdf } from "./document";

// The PDF is read back with the same library that draws the plans: its
// pages, and the words on them.

let library: PDFiumLibrary;
beforeAll(async () => {
  library = await PDFiumLibrary.init();
});
afterAll(() => library.destroy());

async function read(pdf: Buffer): Promise<string[]> {
  const document = await library.loadDocument(pdf);
  try {
    return [...document.pages()].map((page) => page.getText());
  } finally {
    document.destroy();
  }
}

const photo = async (width: number, height: number) => ({
  jpeg: await sharp({ create: { width, height, channels: 3, background: "#7a8c99" } })
    .jpeg()
    .toBuffer(),
  width,
  height,
  caption: "Conduite en place entre R-4 et R-5",
  takenAt: new Date("2026-11-19T19:05:00Z"),
});

const report: ReportPdf = {
  project: { number: "24-118", name: "Réfection de la rue Principale (EXEMPLE)" },
  day: "2026-11-19",
  authorName: "Marc Lévesque",
  weather: { condition: "soleil", temperatureC: -2, note: "Vent fort en après-midi." },
  crew: [
    { name: "Marc Lévesque", hours: 10, userId: "u1" },
    { name: "Julie Tremblay", hours: 7.5, userId: "u2" },
    { name: "Transport Exemple inc.", hours: 6, userId: null },
  ],
  equipment: "Pelle, rouleau, camion 10 roues.",
  workDone: "Pose de 42 m de conduite d'aqueduc entre les regards R-4 et R-5.",
  notes: "Passage de l'ingénieur vers 14 h.",
  photos: [],
  producedAt: new Date("2026-11-19T21:42:00Z"),
};

describe("a report's PDF", () => {
  it("says what the report says, on one page", async () => {
    const pages = await read(await renderReportPdf(report));
    expect(pages).toHaveLength(1);
    const [page] = pages;
    for (const words of [
      "RAPPORT JOURNALIER",
      "Jeudi 19 novembre 2026",
      "PROJET 24-118",
      "Réfection de la rue Principale (EXEMPLE)",
      "Soleil, −2 °C",
      "Vent fort en après-midi.",
      "Julie Tremblay",
      "7,5 h",
      "23,5 h",
      "Pelle, rouleau, camion 10 roues.",
      "Pose de 42 m de conduite",
      "Passage de l'ingénieur vers 14 h.",
      "Page 1 de 1",
    ])
      expect(page.replaceAll("\u00a0", " ")).toContain(words);
  });

  it("puts the photos after the text, numbered, with their description and time", async () => {
    const photos = [await photo(1100, 825), await photo(825, 1100), await photo(1100, 825)];
    photos[2].caption = "";
    const pages = await read(await renderReportPdf({ ...report, photos }));
    const text = pages.join("\n").replaceAll("\u00a0", " ");
    expect(text).toContain("1. Conduite en place entre R-4 et R-5 · 14 h 05");
    expect(text).toContain("3. Sans description · 14 h 05");
    expect(text).toContain(`Page ${pages.length} de ${pages.length}`);
  });

  it("runs a long report over several pages, each with its band and its foot", async () => {
    const long = Array.from(
      { length: 90 },
      (_, index) => `Ligne ${index + 1} : remblai et compaction de la tranchée par couches.`,
    ).join("\n");
    const crew = Array.from({ length: 45 }, (_, index) => ({
      name: `Personne ${index + 1}`,
      hours: 8,
      userId: null,
    }));
    const pages = await read(await renderReportPdf({ ...report, crew, workDone: long }));
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((page, index) => {
      expect(page).toContain(`Page ${index + 1} de ${pages.length}`);
      if (index > 0) expect(page.replaceAll("\u00a0", " ")).toContain("Rapport journalier · Jeudi");
    });
    expect(pages.join("\n")).toContain("Ligne 90");
    expect(pages.join("\n")).toContain("Personne 45");
  });

  it("stands with nothing but a date", async () => {
    const empty: ReportPdf = {
      ...report,
      authorName: null,
      weather: { condition: null, temperatureC: null, note: "" },
      crew: [],
      equipment: "",
      workDone: "",
      notes: "",
    };
    const [page] = await read(await renderReportPdf(empty));
    expect(page).toContain("Personne au chantier");
    expect(page).toContain("Aucune note");
  });
});
