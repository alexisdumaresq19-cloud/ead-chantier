import PDFDocument from "pdfkit";

import { crewTotals, type CrewLine, type Weather } from "@/shared/reports";

import { pdfAssets, type FontName, type PdfAssets } from "./assets";
import {
  countLabel,
  fullDay,
  hoursLabel,
  printable,
  siteMoment,
  siteTime,
  weatherLabel,
} from "./words";

// The daily report as a document to send or print: a letter-size page with
// EAD's logo on a black band, the facts of the day, then the photos. Drawn
// directly (no browser, no layout engine), which is what makes it ready in a
// fraction of a second.

export const COMPANY = "Les Entreprises Allen Dumaresq";

export type ReportPdfPhoto = {
  /** The image as the page takes it: a JPEG, upright. */
  jpeg: Buffer;
  width: number;
  height: number;
  caption: string | null;
  takenAt: Date;
};

/** Everything the document says. */
export type ReportPdf = {
  project: { number: string | null; name: string };
  /** "2026-11-19" */
  day: string;
  authorName: string | null;
  weather: Weather;
  crew: CrewLine[];
  equipment: string;
  workDone: string;
  notes: string;
  /** In the order they are shown. */
  photos: ReportPdfPhoto[];
  /** When the document is made. */
  producedAt: Date;
};

// A letter-size page, in points (1/72 in).
const PAGE = { width: 612, height: 792 };
const SIDE = 42;
const INNER = PAGE.width - 2 * SIDE;
/** Where the text starts under the large band of the first page, and under the small one after. */
const FIRST_TOP = 120;
const TOP = 62;
/** The text stops here; the footer is below. */
const BOTTOM = PAGE.height - 58;

// The app's colours (src/app/globals.css).
const INK = "#0b0d10";
const EAD = "#1e8bc0";
const EAD_DARK = "#226995";
const ON_BLACK = "#8fd0f0";
const CANVAS = "#f2f4f6";
const LINE = "#dfe3e8";
const TEXT = "#12161b";
const DIM = "#5a6572";

type Style = { font: FontName; size: number; color: string };

export async function renderReportPdf(report: ReportPdf): Promise<Buffer> {
  return draw(report, await pdfAssets());
}

function draw(report: ReportPdf, assets: PdfAssets): Promise<Buffer> {
  const day = fullDay(report.day);
  const projectLabel = [report.project.number, report.project.name]
    .filter(Boolean)
    .map((part) => printable(part!))
    .join(" · ");

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: TOP, bottom: PAGE.height - BOTTOM, left: SIDE, right: SIDE },
    bufferPages: true,
    // No built-in typeface: everything is drawn with the app's own.
    font: "",
    lang: "fr-CA",
    displayTitle: true,
    info: {
      Title: `Rapport journalier — ${projectLabel} — ${day}`,
      Author: COMPANY,
      Creator: "EAD Chantier",
      CreationDate: report.producedAt,
    },
  });
  for (const [name, data] of Object.entries(assets.fonts)) doc.registerFont(name, data);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // The style in use, so that a page added in the middle of a text (which
  // draws its band) hands the text back its own.
  let current: Style = { font: "text", size: 10, color: TEXT };
  const setStyle = (style: Style) => {
    current = style;
    return doc.font(style.font).fontSize(style.size).fillColor(style.color);
  };
  const say = (
    style: Style,
    text: string,
    x: number,
    y: number,
    options: PDFKit.Mixins.TextOptions = {},
  ) => setStyle(style).text(printable(text), x, y, { lineBreak: false, ...options });

  const smallBand = () => {
    const before = current;
    doc.rect(0, 0, PAGE.width, 40).fill(INK);
    doc.image(assets.mark, SIDE, 9, { height: 22 });
    say(
      { font: "strong", size: 8.5, color: "#ffffff" },
      `Rapport journalier · ${day}`,
      SIDE,
      15.5,
      {
        width: INNER,
        align: "right",
      },
    );
    doc.rect(0, 40, PAGE.width, 2).fill(EAD);
    setStyle(before);
  };
  doc.on("pageAdded", smallBand);

  let y = FIRST_TOP;
  /** Makes sure `height` fits under the cursor, on a new page if it does not. */
  const room = (height: number) => {
    if (y + height <= BOTTOM) return;
    doc.addPage();
    y = TOP;
  };

  // --- The band of the first page
  doc.rect(0, 0, PAGE.width, 96).fill(INK);
  doc.image(assets.logo, SIDE, 14, { height: 68 });
  say({ font: "display", size: 22, color: "#ffffff" }, "RAPPORT JOURNALIER", SIDE, 30, {
    width: INNER,
    align: "right",
    characterSpacing: 0.6,
  });
  say({ font: "strong", size: 11, color: ON_BLACK }, day, SIDE, 58, {
    width: INNER,
    align: "right",
  });
  doc.rect(0, 96, PAGE.width, 3).fill(EAD);

  // --- The project
  say(
    { font: "strong", size: 7.5, color: DIM },
    report.project.number ? `PROJET ${report.project.number}` : "PROJET",
    SIDE,
    y,
    { characterSpacing: 0.9 },
  );
  y += 12;
  say({ font: "title", size: 16, color: TEXT }, report.project.name, SIDE, y, {
    width: INNER,
    lineBreak: true,
    lineGap: 1,
  });
  y = doc.y + 12;

  // --- The day at a glance
  const totals = crewTotals(report.crew);
  const facts: [string, string][] = [
    ["MÉTÉO", weatherLabel(report.weather) || "Non notée"],
    ["ÉQUIPE", totals.people > 0 ? countLabel(totals.people, "personne") : "Personne"],
    ["HEURES", hoursLabel(totals.hours)],
    ["RÉDIGÉ PAR", report.authorName ?? "Auteur inconnu"],
  ];
  const gap = 8;
  const cell = (INNER - gap * (facts.length - 1)) / facts.length;
  facts.forEach(([label, value], index) => {
    const x = SIDE + index * (cell + gap);
    doc.roundedRect(x, y, cell, 44, 6).fill(CANVAS);
    say({ font: "strong", size: 6.8, color: DIM }, label, x + 10, y + 9, { characterSpacing: 0.9 });
    say({ font: "title", size: 12, color: TEXT }, value, x + 10, y + 21, {
      width: cell - 18,
      ellipsis: true,
    });
  });
  y += 44 + 20;

  /** A part's title, kept with at least `keep` points of what follows. */
  const part = (title: string, aside: string | null, keep: number) => {
    room(18 + keep);
    const label = title.toUpperCase();
    say({ font: "title", size: 9.5, color: EAD_DARK }, label, SIDE, y, { characterSpacing: 1 });
    const labelWidth = doc.widthOfString(label, { characterSpacing: 1 });
    let asideWidth = 0;
    if (aside) {
      say({ font: "text", size: 8.5, color: DIM }, aside, SIDE, y + 0.5, {
        width: INNER,
        align: "right",
      });
      asideWidth = doc.widthOfString(printable(aside)) + 8;
    }
    doc
      .moveTo(SIDE + labelWidth + 10, y + 5.5)
      .lineTo(PAGE.width - SIDE - asideWidth, y + 5.5)
      .lineWidth(0.7)
      .strokeColor(LINE)
      .stroke();
    y += 18;
  };
  /** A text as it was written, line ends included; it runs onto the next page by itself. */
  const body = (text: string, empty: string) => {
    if (text.trim())
      say({ font: "text", size: 10, color: TEXT }, text.trim(), SIDE, y, {
        width: INNER,
        lineBreak: true,
        lineGap: 3.2,
        paragraphGap: 3,
      });
    else say({ font: "italic", size: 10, color: DIM }, empty, SIDE, y);
    y = doc.y + 16;
  };

  // --- Weather
  if (report.weather.note.trim()) {
    part("Météo", null, 30);
    body(report.weather.note, "");
  }

  // --- Crew, in two columns
  part(
    "Équipe",
    totals.people > 0
      ? `${countLabel(totals.people, "personne")} · ${hoursLabel(totals.hours)}`
      : null,
    30,
  );
  if (report.crew.length === 0) body("", "Personne au chantier");
  else {
    const columnGap = 28;
    const column = (INNER - columnGap) / 2;
    const rowHeight = 19;
    const rows = Math.ceil(report.crew.length / 2);
    for (let row = 0; row < rows; row++) {
      room(rowHeight);
      for (const [side, line] of [report.crew[row], report.crew[row + rows]].entries()) {
        if (!line) continue;
        const x = SIDE + side * (column + columnGap);
        say({ font: "text", size: 10, color: TEXT }, line.name, x, y, {
          width: column - 62,
          ellipsis: true,
        });
        say({ font: "strong", size: 10, color: TEXT }, hoursLabel(line.hours), x, y, {
          width: column,
          align: "right",
        });
        doc
          .moveTo(x, y + 14.5)
          .lineTo(x + column, y + 14.5)
          .lineWidth(0.5)
          .strokeColor(LINE)
          .stroke();
      }
      y += rowHeight;
    }
    room(26);
    y += 6;
    say({ font: "title", size: 10.5, color: TEXT }, "Total des heures", SIDE, y);
    say({ font: "title", size: 10.5, color: TEXT }, hoursLabel(totals.hours), SIDE, y, {
      width: INNER,
      align: "right",
    });
    y += 30;
  }

  part("Équipement", null, 30);
  body(report.equipment, "Aucun équipement inscrit");
  part("Travaux réalisés", null, 30);
  body(report.workDone, "Aucun travail inscrit");
  part("Notes", null, 30);
  body(report.notes, "Aucune note");

  // --- Photos, two to a row, each with its number and description
  if (report.photos.length > 0) {
    const between = 12;
    const boxWidth = (INNER - between) / 2;
    const boxHeight = boxWidth * 0.72;
    const captionStyle: Style = { font: "text", size: 8.5, color: TEXT };
    const captionOf = (photo: ReportPdfPhoto, number: number) =>
      printable(
        `${number}. ${photo.caption?.trim() || "Sans description"} · ${siteTime(photo.takenAt)}`,
      );
    const captionHeight = (text: string) => {
      setStyle(captionStyle);
      return Math.min(doc.heightOfString(text, { width: boxWidth, lineGap: 1.5 }), 34);
    };
    for (let first = 0; first < report.photos.length; first += 2) {
      const pair = report.photos.slice(first, first + 2);
      const captions = pair.map((photo, index) => captionOf(photo, first + index + 1));
      const rowHeight = boxHeight + 6 + Math.max(...captions.map(captionHeight)) + 14;
      if (first === 0) part("Photos", countLabel(report.photos.length, "photo"), rowHeight);
      else room(rowHeight);
      pair.forEach((photo, index) => {
        const x = SIDE + index * (boxWidth + between);
        doc.save();
        doc.roundedRect(x, y, boxWidth, boxHeight, 5).clip();
        doc.rect(x, y, boxWidth, boxHeight).fill(CANVAS);
        doc.image(photo.jpeg, x, y, {
          fit: [boxWidth, boxHeight],
          align: "center",
          valign: "center",
        });
        doc.restore();
        setStyle(captionStyle).text(captions[index], x, y + boxHeight + 6, {
          width: boxWidth,
          height: 34,
          lineGap: 1.5,
          ellipsis: true,
        });
      });
      y += rowHeight;
    }
  }

  // --- The foot of each page, once their number is known
  const pages = doc.bufferedPageRange();
  for (let index = 0; index < pages.count; index++) {
    doc.switchToPage(pages.start + index);
    // Written under the text's own limit: it must not start a new page.
    doc.page.margins.bottom = 0;
    const footY = PAGE.height - 36;
    doc
      .moveTo(SIDE, footY - 8)
      .lineTo(PAGE.width - SIDE, footY - 8)
      .lineWidth(0.7)
      .strokeColor(LINE)
      .stroke();
    const foot: Style = { font: "text", size: 8, color: DIM };
    say(foot, `${COMPANY} · Produit le ${siteMoment(report.producedAt)}`, SIDE, footY, {
      width: INNER - 80,
      ellipsis: true,
    });
    say(foot, `Page ${index + 1} de ${pages.count}`, SIDE, footY, { width: INNER, align: "right" });
  }

  doc.end();
  return finished;
}
