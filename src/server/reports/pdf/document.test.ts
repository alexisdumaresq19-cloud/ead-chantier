import { PDFiumLibrary } from "@hyzyla/pdfium";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pdfAssets } from "./assets";
import { renderReportPdf, type ReportPdf, type ReportPdfPhoto } from "./document";

// The PDF is read back with the same library that draws the plans: its
// pages, the words on them, line by line, and the images they hold.

let library: PDFiumLibrary;
beforeAll(async () => {
  library = await PDFiumLibrary.init();
});
afterAll(() => library.destroy());

type Page = { text: string; lines: string[]; images: number };

async function read(pdf: Buffer): Promise<Page[]> {
  const document = await library.loadDocument(pdf);
  try {
    return [...document.pages()].map((page) => {
      const text = page.getText().replaceAll("\u00a0", " ");
      return {
        text,
        lines: text.split(/\r?\n/).map((line) => line.trim()),
        images: [...page.objects()].filter((object) => object.type === "image").length,
      };
    });
  } finally {
    document.destroy();
  }
}

/** The lines of a page between its band and its foot. */
const body = (page: Page, index: number) =>
  page.lines.filter(
    (line) =>
      line &&
      !line.startsWith("Les Entreprises Allen Dumaresq") &&
      !/^Page \d+ de \d+$/.test(line) &&
      !(index > 0 && (line.startsWith("Rapport journalier ·") || /^\w+di \d/.test(line))),
  );

const image = async (width: number, height: number) => {
  const jpeg = await sharp({ create: { width, height, channels: 3, background: "#7a8c99" } })
    .jpeg()
    .toBuffer();
  return { jpeg, width, height };
};

const photo = async (
  width: number,
  height: number,
  caption: string | null = "Conduite en place entre R-4 et R-5",
): Promise<ReportPdfPhoto> => {
  const ready = await image(width, height);
  return {
    width,
    height,
    caption,
    takenAt: new Date("2026-11-19T19:05:00Z"),
    image: async () => ready,
  };
};
const LANDSCAPE = [1100, 825] as const;
const PORTRAIT = [825, 1100] as const;

const report: ReportPdf = {
  project: {
    number: "24-118",
    name: "Réfection de la rue Principale (EXEMPLE)",
    client: "Ville de Gaspé",
    address: "Rue Principale",
    city: "Gaspé",
  },
  day: "2026-11-19",
  author: { name: "Marc Lévesque", title: "Contremaître" },
  weather: { condition: "brouillard", temperatureC: -12, note: "Vent fort en après-midi." },
  crew: [
    { name: "Marc Lévesque", hours: 10, userId: "u1" },
    { name: "Julie Tremblay", hours: 7.5, userId: "u2" },
    { name: "Transport Exemple inc.", hours: 6, userId: null },
  ],
  equipment: "Pelle, rouleau, camion 10 roues.",
  workDone: "Pose de 42 m de conduite d'aqueduc entre les regards R-4 et R-5.",
  notes: "Passage de l'ingénieur vers 14 h.",
  photos: [],
  writtenAt: new Date("2026-11-19T21:42:00Z"),
  changedAt: new Date("2026-11-20T13:10:00Z"),
  producedAt: new Date("2026-11-20T15:00:00Z"),
};

const PARTS = ["MÉTÉO", "ÉQUIPE", "ÉQUIPEMENT", "TRAVAUX RÉALISÉS", "NOTES", "PHOTOS"];
const isTitle = (line: string) => PARTS.some((part) => line.startsWith(part));

/** A paragraph of `words` numbered words of one kind, to find its lines on the pages. */
const words = (tag: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${tag}${index + 1}`).join(" ");

describe("a report's PDF", () => {
  it("says what the report says, on one page", async () => {
    const pages = await read(await renderReportPdf(report));
    expect(pages).toHaveLength(1);
    const [{ text }] = pages;
    for (const said of [
      "RAPPORT JOURNALIER",
      "Jeudi 19 novembre 2026",
      "PROJET 24-118",
      "Réfection de la rue Principale (EXEMPLE)",
      "CLIENT",
      "Ville de Gaspé",
      "LIEU",
      "Rue Principale, Gaspé",
      "Brouillard, −12 °C",
      "Contremaître",
      "Vent fort en après-midi.",
      "Julie Tremblay",
      "7,5 h",
      "23,5 h",
      "Pelle, rouleau, camion 10 roues.",
      "Pose de 42 m de conduite",
      "Passage de l'ingénieur vers 14 h.",
      "Rédigé le 19 novembre 2026 à 16 h 42",
      "modifié le 20 novembre 2026 à 8 h 10",
      "Produit le 20 novembre 2026 à 10 h 00",
      "Page 1 de 1",
    ])
      expect(text).toContain(said);
    // The weather is said once in the cell; its note has a part of its own.
    expect(text.match(/Brouillard/g)).toHaveLength(1);
  });

  it("carries its title, author and language", async () => {
    const pdf = await renderReportPdf(report);
    const info = await PDFDocument.load(pdf, { updateMetadata: false });
    expect(info.getTitle()).toBe(
      "Rapport journalier — 24-118 · Réfection de la rue Principale (EXEMPLE) — Jeudi 19 novembre 2026",
    );
    expect(info.getAuthor()).toBe("Marc Lévesque — Les Entreprises Allen Dumaresq");
    const raw = pdf.toString("latin1");
    expect(raw).toContain("/Lang (fr-CA)");
    expect(raw).toContain("/DisplayDocTitle true");
  });

  it("says when a report was not changed after it was written", async () => {
    const [{ text }] = await read(
      await renderReportPdf({ ...report, changedAt: report.writtenAt }),
    );
    expect(text).toContain("Rédigé le");
    expect(text).not.toContain("modifié");
  });

  it("stands with nothing but a date, every part saying it is empty", async () => {
    const empty: ReportPdf = {
      ...report,
      project: { number: null, name: "Projet (EXEMPLE)", client: null, address: null, city: null },
      author: null,
      weather: { condition: null, temperatureC: null, note: "" },
      crew: [],
      equipment: "",
      workDone: "",
      notes: "",
    };
    const pages = await read(await renderReportPdf(empty));
    expect(pages).toHaveLength(1);
    for (const said of [
      "Non notée",
      "Non indiqué",
      "Aucune personne inscrite",
      "Aucun équipement inscrit",
      "Aucun travail inscrit",
      "Aucune note",
      "Aucune photo",
    ])
      expect(pages[0].text).toContain(said);
    expect(pages[0].text).not.toContain("CLIENT");
  });

  it("puts the photos after the text, numbered, with their description and time", async () => {
    const photos = [
      await photo(...LANDSCAPE),
      await photo(...PORTRAIT),
      await photo(...LANDSCAPE, ""),
    ];
    const pages = await read(await renderReportPdf({ ...report, photos }));
    const text = pages.map((page) => page.text).join("\n");
    expect(text).toMatch(/1\s+Conduite en place entre R-4 et R-5 · 14 h 05/);
    expect(text).toMatch(/3\s+14 h 05/);
    expect(text).not.toContain("Sans description");
    expect(pages.reduce((total, page) => total + page.images, 0)).toBe(3 + pages.length);
  });

  it("leaves out a photo that cannot be read, and numbers the others in turn", async () => {
    const photos = [
      await photo(...LANDSCAPE, "Première"),
      { ...(await photo(...LANDSCAPE, "Perdue")), image: async () => null },
      { ...(await photo(...LANDSCAPE, "En panne")), image: () => Promise.reject(new Error("x")) },
      await photo(...LANDSCAPE, "Dernière"),
    ];
    const pages = await read(await renderReportPdf({ ...report, photos }));
    const text = pages.map((page) => page.text).join("\n");
    expect(text).toMatch(/1\s+Première/);
    expect(text).toMatch(/2\s+Dernière/);
    expect(text).not.toContain("Perdue");
    expect(text).not.toContain("En panne");
  });

  it("fills a page with six landscape photos", async () => {
    const photos = await Promise.all(Array.from({ length: 6 }, () => photo(...LANDSCAPE)));
    const pages = await read(await renderReportPdf({ ...report, photos }));
    // The logo on the first page, the emblem on the next, and the six photos on one page.
    const photoPages = pages.map((page) => page.images - 1).filter((count) => count > 0);
    expect(photoPages).toEqual([6]);
  });

  it("never leaves a part's title alone at the foot of a page", async () => {
    // Text that ends at every height of the first page in turn.
    for (let lines = 18; lines <= 34; lines += 2) {
      const pages = await read(
        await renderReportPdf({
          ...report,
          workDone: Array.from({ length: lines }, (_, index) => `Ligne ${index + 1}.`).join("\n"),
          photos: [await photo(...LANDSCAPE)],
        }),
      );
      pages.forEach((page, index) => {
        const lines = body(page, index);
        expect(isTitle(lines.at(-1)!), `page ${index + 1}: ${lines.at(-1)}`).toBe(false);
      });
    }
  });

  it("leaves no line of a paragraph alone at the top or the foot of a page", async () => {
    for (let before = 20; before <= 34; before++) {
      const workDone = [
        ...Array.from({ length: before }, (_, index) => `Ligne ${index + 1}.`),
        words("mot", 60),
        words("terme", 45),
      ].join("\n");
      const pages = await read(await renderReportPdf({ ...report, workDone }));
      for (const tag of ["mot", "terme"]) {
        const counts = pages
          .map((page) => page.lines.filter((line) => new RegExp(`\\b${tag}\\d`).test(line)).length)
          .filter((count) => count > 0);
        expect(counts.length).toBeGreaterThan(0);
        for (const count of counts) expect(count, `${tag} after ${before}`).toBeGreaterThan(1);
      }
    }
  });

  it("runs a long crew list onto the next page with its total beside its last rows", async () => {
    const crew = Array.from({ length: 100 }, (_, index) => ({
      name: `Personne ${index + 1} (EXEMPLE)`,
      hours: 8,
      userId: null,
    }));
    const pages = await read(await renderReportPdf({ ...report, crew }));
    const text = pages.map((page) => page.text).join("\n");
    for (let index = 1; index <= 100; index++) expect(text).toContain(`Personne ${index} (`);
    const withTotal = pages.findIndex((page) => page.text.includes("Total des heures"));
    expect(pages[withTotal].text).toContain("800 h");
    const rowsThere = pages[withTotal].lines.filter((line) => line.startsWith("Personne"));
    expect(rowsThere.length).toBeGreaterThanOrEqual(2);
    expect(pages[withTotal].text).toContain("ÉQUIPE (suite)");
  });

  it("holds the largest report: 10 000 characters twice, 100 crew lines, 40 photos", async () => {
    const long = "Remblai et compaction de la tranchée par couches. ".repeat(200).slice(0, 10_000);
    const photos = await Promise.all(
      Array.from({ length: 40 }, (_, index) => {
        const [width, height] = index % 3 === 2 ? PORTRAIT : LANDSCAPE;
        return photo(width, height, index % 4 ? `Photo ${index + 1}` : null);
      }),
    );
    const crew = Array.from({ length: 100 }, (_, index) => ({
      name: `Personne ${index + 1}`,
      hours: 8,
      userId: null,
    }));
    const started = performance.now();
    const pdf = await renderReportPdf({ ...report, workDone: long, notes: long, crew, photos });
    const pages = await read(pdf);
    expect(performance.now() - started).toBeLessThan(5_000);
    const text = pages.map((page) => page.text).join("\n");
    expect(text).toMatch(/40\s+Photo 40/);
    pages.forEach((page, index) => {
      expect(page.text).toContain(`Page ${index + 1} de ${pages.length}`);
      if (index > 0) expect(page.text).toContain("Rapport journalier · 24-118");
    });
  });

  it("breaks a long unbroken string and wraps a long project name", async () => {
    const serial = "XJ29384756".repeat(14);
    const name = `${"Reconstruction du boulevard Jacques-Cartier ".repeat(4)}(EXEMPLE)`;
    const pages = await read(
      await renderReportPdf({ ...report, project: { ...report.project, name }, equipment: serial }),
    );
    const flat = pages[0].lines.join("");
    expect(flat).toContain(serial);
    // The serial number takes more than one line.
    expect(pages[0].lines.some((line) => line === serial)).toBe(false);
    expect(pages[0].text).toContain("(EXEMPLE)");
  });

  it("prints no character its typefaces lack, and no double space where one was left out", async () => {
    const pages = await read(
      await renderReportPdf({
        ...report,
        project: { ...report.project, name: "Дмитрий 👷 Παπαδόπουλος" },
        crew: [{ name: "王小明", hours: 8, userId: null }],
        workDone: "Travaux 👍 terminés ! Température −12 °C ; « bien » — ﬁn de journée.",
      }),
    );
    const text = pages[0].text;
    expect(text).toContain("Дмитрий Παπαδόπουλος");
    expect(text).toContain("Travaux terminés ! Température −12 °C ; « bien » — fin de journée.");
    expect(text).toContain("Nom illisible");
    const { faces } = await pdfAssets();
    for (const char of text.replace(/\s/g, ""))
      expect(faces.text.has(char.codePointAt(0)!), char).toBe(true);
  });

  it("writes a title Archivo cannot draw in Inter Bold", async () => {
    const fontsOf = async (name: string) =>
      (await renderReportPdf({ ...report, project: { ...report.project, name } }))
        .toString("latin1")
        .match(/\/BaseFont \/[A-Z]+\+[\w-]+/g)!
        .map((font) => font.split("+")[1]);
    expect(await fontsOf("Réfection de la rue Principale")).not.toContain("Inter-Bold");
    expect(await fontsOf("Реконструкция")).toContain("Inter-Bold");
  });

  it("is ready in a fraction of a second", async () => {
    await renderReportPdf(report);
    const photos = await Promise.all(Array.from({ length: 8 }, () => photo(...LANDSCAPE)));
    const started = performance.now();
    await renderReportPdf({ ...report, photos });
    expect(performance.now() - started).toBeLessThan(200);
  });
});
