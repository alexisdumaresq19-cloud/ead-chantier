import PDFDocument from "pdfkit";

import { crewTotals, type CrewLine, type Weather } from "@/shared/reports";

import { pdfAssets, type PdfAssets } from "./assets";
import { photoPages, type LayoutRules, type PhotoRow } from "./layout";
import type { Line, Run } from "./lines";
import { penFor, type Style } from "./pen";
import {
  countLabel,
  fullDay,
  hoursLabel,
  placeLabel,
  siteMoment,
  siteTime,
  weatherLabel,
} from "./words";

// The daily report as a document to send or print: a letter-size page with
// EAD's logo on a black band, the facts of the day, the parts of the report,
// then the photos. Drawn directly (no browser, no layout engine), which is
// what makes it ready in a fraction of a second. Every line is placed by this
// file, page breaks included: a title stays with what follows it, a
// paragraph leaves no lone line at the top or the bottom of a page, a row of
// photos is never cut.

export const COMPANY = "Les Entreprises Allen Dumaresq";

export type ReportPdfPhoto = {
  /** Its size as stored: what the layout is made from before the image is read. */
  width: number;
  height: number;
  caption: string | null;
  takenAt: Date;
  /** The image as the page takes it, or null when it cannot be read. */
  image: () => Promise<PageImage | null>;
};

/** A JPEG, upright, and its size in pixels. */
export type PageImage = { jpeg: Buffer; width: number; height: number };

/** Everything the document says. */
export type ReportPdf = {
  project: {
    number: string | null;
    name: string;
    client: string | null;
    address: string | null;
    city: string | null;
  };
  /** "2026-11-19" */
  day: string;
  author: { name: string; title: string | null } | null;
  weather: Weather;
  crew: CrewLine[];
  equipment: string;
  workDone: string;
  notes: string;
  /** In the order they are shown. */
  photos: ReportPdfPhoto[];
  /** When the report was first saved, and last changed. */
  writtenAt: Date;
  changedAt: Date;
  /** When the document is made. */
  producedAt: Date;
};

// --- The page, in points (1/72 in) -------------------------------------------

const PAGE = { width: 612, height: 792 };
const SIDE = 42;
const INNER = PAGE.width - 2 * SIDE;
const FIRST_BAND = 96;
const BAND = 36;
/** Where the text starts under the large band of the first page, and under the small one after. */
const FIRST_TOP = FIRST_BAND + 3 + 24;
const TOP = BAND + 2 + 20;
/** The text stops here; the foot is below. */
const BOTTOM = PAGE.height - 52;
const FOOT_RULE = PAGE.height - 40;

// The app's colours (src/app/globals.css).
const INK = "#0b0d10";
const EAD = "#1e8bc0";
const EAD_DARK = "#226995";
const ON_BLACK = "#8fd0f0";
const CANVAS = "#f2f4f6";
const LINE = "#dfe3e8";
const TEXT = "#12161b";
const DIM = "#5a6572";
const WHITE = "#ffffff";

const S = {
  label: { font: "strong", size: 6.8, color: DIM, spacing: 0.9 },
  body: { font: "text", size: 10, color: TEXT },
  quiet: { font: "italic", size: 10, color: DIM },
  strong: { font: "strong", size: 10, color: TEXT },
  part: { font: "title", size: 9, color: EAD_DARK, spacing: 1 },
  partMore: { font: "text", size: 8, color: DIM },
  small: { font: "text", size: 7.5, color: DIM },
  smallStrong: { font: "strong", size: 7.5, color: DIM },
  meta: { font: "text", size: 9, color: TEXT },
  metaLabel: { font: "strong", size: 6.8, color: DIM, spacing: 0.9 },
  number: { font: "bold", size: 8, color: EAD_DARK },
  caption: { font: "text", size: 8, color: TEXT },
  captionTime: { font: "text", size: 8, color: DIM },
  total: { font: "title", size: 10.5, color: TEXT },
} satisfies Record<string, Style>;

/** Line heights. */
const LEAD = { body: 15, crew: 14, caption: 10, part: 12, meta: 14 };
/** Space before a part's title, and between it and what follows. */
const PART_BEFORE = 24;
const PART_AFTER = 10;
const PART_HEIGHT = LEAD.part + PART_AFTER;

const PHOTO = {
  /** Between a photo and its caption. */
  captionGap: 5,
  captionLines: 3,
  /** Between two rows: at least, as written, and at most when a full page is spread out. */
  rowGap: { least: 12, usual: 16, most: 28 },
  /** Photos read ahead of the one being drawn. */
  ahead: 4,
} as const;
const PHOTO_RULES: LayoutRules = {
  width: INNER,
  gap: 12,
  target: 200,
  min: 110,
  max: 250,
  most: 4,
  rowGap: PHOTO.rowGap.least,
  page: BOTTOM - TOP,
};

export async function renderReportPdf(report: ReportPdf): Promise<Buffer> {
  return draw(report, await pdfAssets());
}

async function draw(report: ReportPdf, assets: PdfAssets): Promise<Buffer> {
  const day = fullDay(report.day);
  const project = report.project;
  const projectLabel = [project.number?.trim(), project.name.trim()].filter(Boolean).join(" · ");

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
      Author: report.author ? `${report.author.name} — ${COMPANY}` : COMPANY,
      Subject: `Rapport journalier de chantier du ${day}`,
      Keywords: ["rapport journalier", project.number?.trim()].filter(Boolean).join(", "),
      Creator: "EAD Chantier",
      CreationDate: report.producedAt,
    },
  });
  // pdfkit takes a typeface already read by fontkit (its own engine) as well as a file.
  for (const [name, face] of Object.entries(assets.faces))
    doc.registerFont(name, face.font as unknown as PDFKit.Mixins.PDFFontSource);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pen = penFor(doc, assets);
  const one = (text: string, style: Style): Line<Style> => {
    const shown = pen.run(text, style);
    return { runs: [shown], width: pen.measure(shown.text, style) };
  };
  /** A line placed in a box of height `lead` from `top`, from x or against the right edge `right`. */
  const put = (
    line: Line<Style>,
    top: number,
    lead: number,
    at: { x: number } | { right: number },
  ) => {
    const style = line.runs[0]?.style ?? S.body;
    const x = "x" in at ? at.x : at.right - line.width;
    pen.draw(line, x, pen.baseline(top, lead, style));
  };
  const hairline = (x1: number, x2: number, at: number, width = 0.6, color = LINE) =>
    doc.moveTo(x1, at).lineTo(x2, at).lineWidth(width).strokeColor(color).stroke();

  // --- Pages ------------------------------------------------------------------

  /** The running head of the pages after the first: which report, which day. */
  const smallBand = () =>
    pen.keep(() => {
      doc.rect(0, 0, PAGE.width, BAND).fill(INK);
      doc.image(assets.mark, SIDE, 8, { height: BAND - 16 });
      const right = PAGE.width - SIDE;
      const dayLine = one(day, { ...S.smallStrong, color: ON_BLACK, size: 8 });
      put(dayLine, 0, BAND, { right });
      const head = pen.single(
        `Rapport journalier · ${project.number?.trim() || project.name}`,
        { ...S.smallStrong, color: WHITE, size: 8 },
        INNER - 80 - dayLine.width - 14,
      );
      put(head, 0, BAND, { right: right - dayLine.width - 14 });
      doc.rect(0, BAND, PAGE.width, 2).fill(EAD);
    });
  doc.on("pageAdded", smallBand);

  let y = FIRST_TOP;
  /** The page's first line: nothing needs space above it there. */
  let pageTop = FIRST_TOP;
  /** The part being written, repeated with "(suite)" at the top of a new page. */
  let continuing: string | null = null;

  const newPage = () => {
    doc.addPage();
    y = TOP;
    if (continuing) partTitle(continuing, true);
    pageTop = y;
  };
  /** Space above, unless at the top of a page. */
  const space = (points: number) => {
    if (y > pageTop) y += points;
  };
  const left = () => BOTTOM - y;

  // --- The band of the first page
  doc.rect(0, 0, PAGE.width, FIRST_BAND).fill(INK);
  doc.image(assets.logo, SIDE, 14, { height: 68 });
  put(
    one("RAPPORT JOURNALIER", { font: "display", size: 22, color: WHITE, spacing: 0.6 }),
    26,
    26,
    { right: PAGE.width - SIDE },
  );
  put(one(day, { font: "strong", size: 11, color: ON_BLACK }), 54, 16, {
    right: PAGE.width - SIDE,
  });
  doc.rect(0, FIRST_BAND, PAGE.width, 3).fill(EAD);

  // --- The project: its number, its name, its client and place
  put(one(project.number?.trim() ? `PROJET ${project.number.trim()}` : "PROJET", S.label), y, 10, {
    x: SIDE,
  });
  y += 13;
  const nameStyle = pen.titled(project.name, { font: "title", size: 18, color: TEXT });
  for (const line of pen.lines([pen.run(project.name.trim(), nameStyle)], INNER)) {
    put(line, y, 22, { x: SIDE });
    y += 22;
  }
  // Its client and place: on one line when they fit there, in two columns otherwise.
  const about: [string, string][] = [
    ["CLIENT", project.client?.trim() ?? ""],
    ["LIEU", placeLabel(project.address, project.city)],
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));
  if (about.length) {
    y += 2;
    const runs = about.flatMap(([label, value], index) => [
      ...(index ? [pen.run("     ", S.meta)] : []),
      pen.run(`${label}\u00a0\u00a0`, S.metaLabel),
      pen.run(value, S.meta),
    ]);
    const together = pen.lines(runs, INNER);
    if (together.length === 1) {
      pen.draw(together[0], SIDE, pen.baseline(y, LEAD.meta, S.meta));
      y += LEAD.meta;
    } else {
      const hang = Math.max(...about.map(([label]) => pen.measure(label, S.metaLabel))) + 10;
      for (const [label, value] of about) {
        put(one(label, S.metaLabel), y, LEAD.meta, { x: SIDE });
        for (const line of pen.lines([pen.run(value, S.meta)], INNER - hang)) {
          pen.draw(line, SIDE + hang, pen.baseline(y, LEAD.meta, S.meta));
          y += LEAD.meta;
        }
      }
    }
  }
  y += 14;

  // --- The day at a glance: four cells that grow to what they hold
  const totals = crewTotals(report.crew);
  const weather = weatherLabel(report.weather);
  const facts: { label: string; value: string; missing: boolean; sub?: string | null }[] = [
    { label: "MÉTÉO", value: weather || "Non notée", missing: !weather },
    {
      label: "ÉQUIPE",
      value: totals.people > 0 ? countLabel(totals.people, "personne") : "Aucune",
      missing: totals.people === 0,
    },
    { label: "HEURES", value: hoursLabel(totals.hours), missing: totals.people === 0 },
    {
      label: "RÉDIGÉ PAR",
      value: report.author?.name.trim() || "Non indiqué",
      missing: !report.author?.name.trim(),
      sub: report.author?.title?.trim() || null,
    },
  ];
  const cellGap = 8;
  const cellWidth = (INNER - cellGap * (facts.length - 1)) / facts.length;
  const cellPad = 10;
  const cellInner = cellWidth - 2 * cellPad;
  const cells = facts.map((written) => {
    const fact = pen.run(written.value, { ...S.body, font: "bold" }).text.trim()
      ? written
      : { ...written, value: "Nom illisible", missing: true };
    const base = pen.titled(fact.value, {
      font: "title",
      size: 12.5,
      color: fact.missing ? DIM : TEXT,
    });
    // The largest size at which the value holds on one line; wrapped at the smallest otherwise.
    let lines: Line<Style>[] = [];
    let lead = 0;
    for (const size of [12.5, 11.5, 10.5]) {
      const style = { ...base, size };
      lines = pen.lines([pen.run(fact.value, style)], cellInner);
      lead = Math.round(size * 1.25);
      if (lines.length === 1) break;
    }
    const sub = fact.sub ? pen.lines([pen.run(fact.sub, S.small)], cellInner) : [];
    return { fact, lines, lead, sub, height: 9 + 5 + lines.length * lead + sub.length * 10 };
  });
  const cellHeight = 2 * cellPad + Math.max(...cells.map((cell) => cell.height));
  cells.forEach((cell, index) => {
    const x = SIDE + index * (cellWidth + cellGap);
    doc.roundedRect(x, y, cellWidth, cellHeight, 6).fill(CANVAS);
    let top = y + cellPad;
    put(one(cell.fact.label, S.label), top, 9, { x: x + cellPad });
    top += 9 + 5;
    for (const line of cell.lines) {
      put(line, top, cell.lead, { x: x + cellPad });
      top += cell.lead;
    }
    for (const line of cell.sub) {
      put(line, top, 10, { x: x + cellPad });
      top += 10;
    }
  });
  y += cellHeight + 8;

  // When it was written, and changed if it was, in small print.
  const changed = report.changedAt.getTime() - report.writtenAt.getTime() >= 60_000;
  const when: Run<Style>[] = [pen.run(`Rédigé le ${siteMoment(report.writtenAt)}`, S.small)];
  if (changed) when.push(pen.run(` · modifié le ${siteMoment(report.changedAt)}`, S.small));
  for (const line of pen.lines(when, INNER)) {
    pen.draw(line, SIDE, pen.baseline(y, 10, S.small));
    y += 10;
  }

  /** A name as written, or a quiet word when none of its characters can be printed. */
  function printableName(name: string): Run<Style> {
    const shown = pen.run(name.trim(), S.body);
    return shown.text.trim() ? shown : pen.run("Nom illisible", S.quiet);
  }

  // --- Parts ------------------------------------------------------------------

  /** A part's title in small capitals, with a hairline to the right edge. */
  function partTitle(title: string, more = false) {
    const label = one(title.toUpperCase(), S.part);
    put(label, y, LEAD.part, { x: SIDE });
    let end = SIDE + label.width;
    if (more) {
      const suite = one("(suite)", S.partMore);
      put(suite, y, LEAD.part, { x: end + 6 });
      end += 6 + suite.width;
    }
    hairline(end + 10, PAGE.width - SIDE, y + LEAD.part / 2);
    y += PART_HEIGHT;
  }

  /**
   * Starts a part: its title on this page only if `keep` points of what
   * follows fit under it.
   */
  const startPart = (title: string, keep: number) => {
    continuing = null;
    space(PART_BEFORE);
    if (PART_HEIGHT + keep > left()) newPage();
    partTitle(title);
    continuing = title;
  };
  const endPart = () => {
    continuing = null;
  };

  type TextLine = { line: Line<Style>; x: number; marker?: Line<Style> };
  type Paragraph = { lines: TextLine[]; before: number };

  /**
   * A text as it was written, one paragraph per line: a blank line makes a
   * wider space, a line starting with a dash or a number is a list item
   * with its text hanging from the marker.
   */
  const paragraphsOf = (text: string): Paragraph[] => {
    const paragraphs: Paragraph[] = [];
    let blank = false;
    for (const raw of text.trim().split(/\r?\n/)) {
      const written = raw.trim();
      if (!written) {
        blank = true;
        continue;
      }
      const item = /^([-–—•*·]|\d{1,3}[.)])\s+(.*)$/u.exec(written);
      const before = paragraphs.length === 0 ? 0 : blank ? 9 : 4;
      blank = false;
      if (item) {
        const numbered = /\d/.test(item[1]);
        const marker = one(numbered ? item[1] : "•", S.body);
        // Items of one list line up whatever the width of their number.
        const indent = numbered ? Math.max(pen.measure("00.", S.body) + 6, marker.width + 6) : 14;
        paragraphs.push({
          before,
          lines: pen.lines([pen.run(item[2], S.body)], INNER - indent).map((line, index) => ({
            line,
            x: SIDE + indent,
            marker: index === 0 ? marker : undefined,
          })),
        });
      } else
        paragraphs.push({
          before,
          lines: pen.lines([pen.run(written, S.body)], INNER).map((line) => ({ line, x: SIDE })),
        });
    }
    return paragraphs;
  };

  /**
   * Places a paragraph's lines, onto the next pages if needed: a page never
   * ends with its first line alone, nor starts with its last line alone.
   */
  const flow = (paragraph: Paragraph) => {
    space(paragraph.before);
    const lines = paragraph.lines;
    let next = 0;
    while (next < lines.length) {
      const remaining = lines.length - next;
      const room = Math.floor(left() / LEAD.body);
      let count = Math.min(room, remaining);
      if (count < remaining) {
        if (remaining - count < 2) count = remaining - 2;
        if (count < 2) count = 0;
        // A paragraph longer than a whole page breaks where it must.
        if (count <= 0 && y <= pageTop) count = Math.max(1, room);
      }
      for (const { line, x, marker } of lines.slice(next, next + count)) {
        if (marker) put(marker, y, LEAD.body, { x: SIDE });
        put(line, y, LEAD.body, { x });
        y += LEAD.body;
      }
      next += count;
      if (next < lines.length) newPage();
    }
  };

  /** A part holding a written text, or a quiet line when nothing was written. */
  const textPart = (title: string, text: string, empty: string) => {
    const paragraphs = text.trim() ? paragraphsOf(text) : [];
    // What the first paragraph needs on this page: all of it when short, two lines otherwise.
    const first = paragraphs[0]?.lines.length ?? 1;
    startPart(title, (first <= 3 ? first : 2) * LEAD.body);
    if (paragraphs.length === 0) {
      put(one(empty, S.quiet), y, LEAD.body, { x: SIDE });
      y += LEAD.body;
    }
    for (const paragraph of paragraphs) flow(paragraph);
    endPart();
  };

  // --- Weather, when a note says more than the cell above
  if (report.weather.note.trim()) textPart("Météo", report.weather.note, "");

  // --- The crew, in two columns
  crewPart(report.crew, totals.hours);

  function crewPart(crew: CrewLine[], hours: number) {
    const columnGap = 28;
    const column = (INNER - columnGap) / 2;
    const hoursWidth = 50;
    const people = crew.map((line) => ({
      name: pen.lines([printableName(line.name)], column - hoursWidth),
      hours: one(hoursLabel(line.hours), S.strong),
    }));
    const heightOf = (person: (typeof people)[number] | undefined) =>
      person ? person.name.length * LEAD.crew + 6 : 0;
    /** The heights of the rows when the next `rows` rows hold the people from `from`. */
    const rowsOf = (from: number, rows: number) =>
      Array.from({ length: rows }, (_, row) =>
        Math.max(heightOf(people[from + row]), heightOf(people[from + rows + row])),
      );
    const sum = (heights: number[]) => heights.reduce((total, height) => total + height, 0);
    const totalHeight = 8 + 18;

    // Its title goes with one row when the list may break after it (five people and more:
    // two rows stay for the total), with the whole list and its total otherwise.
    const firstRows = Math.ceil(people.length / 2);
    startPart(
      "Équipe",
      people.length === 0
        ? LEAD.body
        : people.length >= 5
          ? rowsOf(0, 1)[0]
          : sum(rowsOf(0, firstRows)) + totalHeight,
    );
    if (people.length === 0) {
      put(one("Aucune personne inscrite", S.quiet), y, LEAD.body, { x: SIDE });
      y += LEAD.body;
      endPart();
      return;
    }
    let from = 0;
    while (from < people.length) {
      const remaining = people.length - from;
      const all = Math.ceil(remaining / 2);
      let rows = all;
      if (sum(rowsOf(from, all)) + totalHeight > left()) {
        // As many rows as the page takes, leaving at least two for the total to go with.
        rows = 0;
        while (rows < all - 1 && sum(rowsOf(from, rows + 1)) <= left()) rows++;
        while (rows > 0 && remaining - 2 * rows < 3) rows--;
      }
      if (rows === 0) {
        newPage();
        continue;
      }
      // Down the left column, then the right one, on each page.
      const heights = rowsOf(from, rows);
      const count = Math.min(remaining, 2 * rows);
      for (let row = 0; row < rows; row++) {
        for (const side of [0, 1]) {
          const person = people[from + side * rows + row];
          if (!person || side * rows + row >= count) continue;
          const x = SIDE + side * (column + columnGap);
          let top = y + 3;
          for (const line of person.name) {
            put(line, top, LEAD.crew, { x });
            top += LEAD.crew;
          }
          put(person.hours, y + 3, LEAD.crew, { right: x + column });
          hairline(x, x + column, y + heights[row] - 0.5, 0.5);
        }
        y += heights[row];
      }
      from += count;
      if (from < people.length) newPage();
    }
    y += 8;
    put(one("Total des heures", S.total), y, 18, { x: SIDE });
    put(one(hoursLabel(hours), S.total), y, 18, { right: PAGE.width - SIDE });
    y += 18;
    endPart();
  }

  textPart("Équipement", report.equipment, "Aucun équipement inscrit");
  textPart("Travaux réalisés", report.workDone, "Aucun travail inscrit");
  textPart("Notes", report.notes, "Aucune note");

  // --- Photos -------------------------------------------------------------------

  await photosPart(report.photos);

  async function photosPart(photos: ReportPdfPhoto[]) {
    // Each photo is read once, a few ahead of the one being drawn, and let go once drawn.
    const reading = new Map<number, Promise<PageImage | null>>();
    const read = (index: number) => {
      let image = reading.get(index);
      if (!image) {
        image = photos[index].image().catch(() => null);
        reading.set(index, image);
      }
      return image;
    };

    let remaining = photos.map((_, index) => index);
    let shown = 0;
    let titled = false;

    const captionOf = (index: number, number: number, width: number) => {
      const photo = photos[index];
      const time = siteTime(photo.takenAt);
      const words = (photo.caption ?? "").replace(/\s+/g, " ").trim();
      const make = (description: string) =>
        pen.lines(
          [
            pen.run(`${number}\u00a0\u00a0`, S.number),
            ...(description ? [pen.run(`${description}\u00a0`, S.caption)] : []),
            pen.run(`${description ? "·\u00a0" : ""}${time}`, S.captionTime),
          ],
          width,
        );
      let lines = make(words);
      if (lines.length > PHOTO.captionLines) {
        // Shortened at a word, to the three lines a caption may take.
        const kept = words.split(" ");
        while (kept.length > 1 && lines.length > PHOTO.captionLines) {
          kept.pop();
          lines = make(`${kept.join(" ").replace(/[\s,;:.]+$/, "")}…`);
        }
      }
      return lines;
    };

    /** The caption lines of the photo `remaining[at]`, numbered as if every photo before it is shown. */
    const captionAt = (at: number, width: number) =>
      captionOf(remaining[at], shown + at + 1, Math.floor(width));

    while (remaining.length) {
      const room = left() - (titled ? 0 : (y > pageTop ? PART_BEFORE : 0) + PART_HEIGHT);
      const pages = photoPages(
        remaining.map((index) => photos[index].width / photos[index].height),
        (at, width) => PHOTO.captionGap + captionAt(at, width).length * LEAD.caption,
        PHOTO_RULES,
        room,
      );
      const rows: PhotoRow[] = pages[0] ?? [];
      if (rows.length === 0) {
        newPage();
        continue;
      }
      // The images of this page, and a few of the next one, are read before anything is drawn:
      // a photo that cannot be read is left out, and the page laid out again without it.
      const placed = rows.reduce((total, row) => total + row.count, 0);
      const wanted = remaining.slice(0, placed);
      for (const index of remaining.slice(placed, placed + PHOTO.ahead)) void read(index);
      const images = await Promise.all(wanted.map(read));
      const missing = new Set(wanted.filter((_, at) => images[at] === null));
      if (missing.size) {
        for (const index of missing) reading.delete(index);
        remaining = remaining.filter((index) => !missing.has(index));
        continue;
      }
      if (!titled) {
        startPart("Photos", rows[0].space);
        endPart();
        titled = true;
      }
      // A full page spreads its rows down to its foot; the last page keeps them close.
      const used = rows.reduce((total, row) => total + row.space, 0);
      const free = rows.length > 1 ? (left() - used) / (rows.length - 1) : 0;
      const gap =
        pages.length > 1
          ? Math.min(PHOTO.rowGap.most, Math.max(PHOTO.rowGap.least, free))
          : Math.min(PHOTO.rowGap.usual, Math.max(PHOTO.rowGap.least, free));
      rows.forEach((row, rowIndex) => {
        if (rowIndex > 0) y += gap;
        let x = SIDE;
        for (let at = row.start; at < row.start + row.count; at++) {
          const width = row.widths[at - row.start];
          placePhoto(images[at]!, x, y, width, row.height);
          let top = y + row.height + PHOTO.captionGap;
          for (const line of captionAt(at, width)) {
            pen.draw(line, x, pen.baseline(top, LEAD.caption, S.caption));
            top += LEAD.caption;
          }
          reading.delete(remaining[at]);
          x += width + PHOTO_RULES.gap;
        }
        y += row.space;
      });
      shown += placed;
      remaining = remaining.slice(placed);
      if (remaining.length) newPage();
    }

    if (!titled) {
      startPart("Photos", LEAD.body);
      put(one("Aucune photo", S.quiet), y, LEAD.body, { x: SIDE });
      y += LEAD.body;
      endPart();
    }
  }

  /** A photo in its box, whole: it is cut only by what rounding leaves over. */
  function placePhoto(image: PageImage, x: number, top: number, width: number, height: number) {
    doc.save();
    doc.roundedRect(x, top, width, height, 2).clip();
    const aspect = width / height;
    // Its record and its file disagree on its shape: shown whole on a quiet ground.
    const close = Math.abs(image.width / image.height - aspect) < 0.02 * aspect;
    if (!close) doc.rect(x, top, width, height).fill(CANVAS);
    doc.image(image.jpeg, x, top, {
      ...(close
        ? { cover: [width, height] as [number, number] }
        : { fit: [width, height] as [number, number] }),
      align: "center",
      valign: "center",
    });
    doc.restore();
  }

  // --- The foot of each page, once their number is known ------------------------

  const pages = doc.bufferedPageRange();
  const produced = `${COMPANY} · Produit le ${siteMoment(report.producedAt)}`;
  for (let index = 0; index < pages.count; index++) {
    doc.switchToPage(pages.start + index);
    // Written under the text's own limit: it must not start a new page.
    doc.page.margins.bottom = 0;
    hairline(SIDE, PAGE.width - SIDE, FOOT_RULE, 0.6);
    const pageLine = one(`Page ${index + 1} de ${pages.count}`, S.smallStrong);
    put(pageLine, FOOT_RULE + 6, 14, { right: PAGE.width - SIDE });
    put(pen.single(produced, S.small, INNER - pageLine.width - 20), FOOT_RULE + 6, 14, { x: SIDE });
  }

  doc.end();
  return finished;
}
