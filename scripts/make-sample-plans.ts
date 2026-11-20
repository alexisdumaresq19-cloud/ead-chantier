/**
 * Generates a fictional set of civil plans as a large-format vector PDF, for
 * development, tests and the demo project. Every sheet is stamped "EXEMPLE".
 *
 *   npx tsx scripts/make-sample-plans.ts [out.pdf] [sheetCount]
 */
import { writeFileSync } from "node:fs";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type Color,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

// ISO A1 landscape, in points (1/72 in).
const W = 2384;
const H = 1684;

const SHEETS = [
  ["C-001", "Page titre et liste des dessins"],
  ["C-101", "Plan d'ensemble — Aqueduc et égouts"],
  ["C-102", "Plan et profil — Rue Principale, ch. 0+000 à 0+300"],
  ["C-103", "Plan et profil — Rue Principale, ch. 0+300 à 0+600"],
  ["C-201", "Drainage et nivellement"],
  ["C-301", "Coupes types de chaussée"],
  ["C-401", "Détails — Regards et puisards"],
  ["C-402", "Détails — Branchements de service"],
] as const;

// Small deterministic generator, so the file is the same on every run.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ink = rgb(0.08, 0.08, 0.1);
const soft = rgb(0.45, 0.47, 0.5);
const blue = rgb(0.1, 0.4, 0.75);
const red = rgb(0.75, 0.15, 0.12);
const green = rgb(0.12, 0.5, 0.25);

function frame(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  number: string,
  title: string,
  index: number,
  total: number,
) {
  page.drawRectangle({
    x: 40,
    y: 40,
    width: W - 80,
    height: H - 80,
    borderColor: ink,
    borderWidth: 2.5,
  });
  page.drawRectangle({
    x: 52,
    y: 52,
    width: W - 104,
    height: H - 104,
    borderColor: ink,
    borderWidth: 0.6,
  });

  // Title block, bottom right.
  const bw = 560;
  const bh = 230;
  const bx = W - 52 - bw;
  const by = 52;
  page.drawRectangle({
    x: bx,
    y: by,
    width: bw,
    height: bh,
    borderColor: ink,
    borderWidth: 1.5,
    color: rgb(1, 1, 1),
  });
  for (const y of [by + 60, by + 120, by + 170])
    page.drawLine({ start: { x: bx, y }, end: { x: bx + bw, y }, thickness: 0.8, color: ink });
  page.drawLine({
    start: { x: bx + 380, y: by },
    end: { x: bx + 380, y: by + 120 },
    thickness: 0.8,
    color: ink,
  });
  page.drawText("PROJET EXEMPLE — DONNÉES FICTIVES", {
    x: bx + 14,
    y: by + 195,
    size: 15,
    font: bold,
    color: red,
  });
  page.drawText("Réfection des infrastructures — Rue Principale", {
    x: bx + 14,
    y: by + 176,
    size: 12,
    font,
    color: ink,
  });
  page.drawText("TITRE DU DESSIN", { x: bx + 14, y: by + 152, size: 8, font, color: soft });
  page.drawText(title, {
    x: bx + 14,
    y: by + 130,
    size: 14,
    font: bold,
    color: ink,
    maxWidth: bw - 28,
  });
  page.drawText("ÉCHELLE", { x: bx + 14, y: by + 102, size: 8, font, color: soft });
  page.drawText("1:500", { x: bx + 14, y: by + 76, size: 20, font: bold, color: ink });
  page.drawText("DATE", { x: bx + 150, y: by + 102, size: 8, font, color: soft });
  page.drawText("2026-10-01", { x: bx + 150, y: by + 78, size: 14, font, color: ink });
  page.drawText("RÉVISION", { x: bx + 280, y: by + 102, size: 8, font, color: soft });
  page.drawText("0", { x: bx + 280, y: by + 76, size: 20, font: bold, color: ink });
  page.drawText("FEUILLE", { x: bx + 394, y: by + 102, size: 8, font, color: soft });
  page.drawText(number, { x: bx + 394, y: by + 70, size: 30, font: bold, color: ink });
  page.drawText("Émis pour construction", {
    x: bx + 14,
    y: by + 34,
    size: 12,
    font: bold,
    color: ink,
  });
  page.drawText(`Feuille ${index + 1} de ${total}`, {
    x: bx + 394,
    y: by + 34,
    size: 12,
    font,
    color: ink,
  });
  page.drawText("Dessin généré pour démonstration. Ne pas utiliser pour construction.", {
    x: bx + 14,
    y: by + 14,
    size: 8,
    font,
    color: soft,
  });
}

// Where texts go. A drafter never lets a line strike through a word: a label
// along a pipe follows it and sits clear of it, and a contour figure breaks
// its own line. The sheet is laid out first, then every text is given the
// nearest spot where it touches nothing, checked against the actual line
// work rather than spaced by eye.

type Point = { x: number; y: number };

/** A text's footprint: a rectangle of size w by h, centred on (x, y), turned by `angle` radians. */
type Box = { x: number; y: number; w: number; h: number; angle: number };

/**
 * A drawn segment, half its stroke width on each side. Background lines (the
 * survey grid and the contours) may run under a text, which then masks them;
 * everything else must stay clear of it.
 */
type Segment = { a: Point; b: Point; half: number; background: boolean; owner: number };

/** Air between a text and anything else, in points. */
const CLEAR = 1;
/** Air between two texts, enough that two labels on one line do not read as one. */
const CLEAR_TEXT = 6;
/** White drawn around a text, past its glyphs, where background lines run under it. */
const MASK = 1.2;
/** A background line under a text costs as much as moving the text this far along. */
const BACKGROUND_COST = 25;
// Helvetica's cap height and descender, as fractions of the size.
const CAP = 0.718;
const DESCENT = 0.207;

function segmentMeetsBox(s: Segment, box: Box, pad: number): boolean {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const ex = box.w / 2 + pad + s.half;
  const ey = box.h / 2 + pad + s.half;
  const x0 = (s.a.x - box.x) * cos + (s.a.y - box.y) * sin;
  const y0 = -(s.a.x - box.x) * sin + (s.a.y - box.y) * cos;
  const dx = (s.b.x - box.x) * cos + (s.b.y - box.y) * sin - x0;
  const dy = -(s.b.x - box.x) * sin + (s.b.y - box.y) * cos - y0;
  // Liang-Barsky: clip the segment, in the box's frame, to the padded box.
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, x0 + ex],
    [dx, ex - x0],
    [-dy, y0 + ey],
    [dy, ey - y0],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
  }
  return true;
}

function reach(box: Box, ux: number, uy: number): number {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  return (
    Math.abs((box.w / 2) * (cos * ux + sin * uy)) + Math.abs((box.h / 2) * (-sin * ux + cos * uy))
  );
}

/** Whether two boxes come closer than `pad`, by their separating axes. */
function boxesMeet(a: Box, b: Box, pad: number): boolean {
  for (const angle of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const gap = Math.abs((b.x - a.x) * ux + (b.y - a.y) * uy);
    if (gap > reach(a, ux, uy) + reach(b, ux, uy) + pad) return false;
  }
  return true;
}

/** The corners of a box, for keeping it inside the drawing. */
function corners(box: Box): Point[] {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => ({
    x: box.x + ((i * box.w) / 2) * cos - ((j * box.h) / 2) * sin,
    y: box.y + ((i * box.w) / 2) * sin + ((j * box.h) / 2) * cos,
  }));
}

/** Everything drawn so far, bucketed by area so that a text checks only its neighbours. */
class Drawn {
  private static readonly CELL = 40;
  private segments = new Map<number, Segment[]>();
  private boxes = new Map<number, { box: Box; clear: number }[]>();

  private keys(x0: number, y0: number, x1: number, y1: number): number[] {
    const keys = [];
    for (let i = Math.floor(x0 / Drawn.CELL); i <= Math.floor(x1 / Drawn.CELL); i++)
      for (let j = Math.floor(y0 / Drawn.CELL); j <= Math.floor(y1 / Drawn.CELL); j++)
        keys.push(i * 1000 + j);
    return keys;
  }

  private static put<T>(map: Map<number, T[]>, key: number, item: T) {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }

  line(a: Point, b: Point, width: number, background = false, owner = -1) {
    const s = { a, b, half: width / 2, background, owner };
    for (const key of this.keys(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.max(a.x, b.x),
      Math.max(a.y, b.y),
    ))
      Drawn.put(this.segments, key, s);
  }

  polyline(points: Point[], width: number, background = false, owner = -1) {
    for (let i = 1; i < points.length; i++)
      this.line(points[i - 1], points[i], width, background, owner);
  }

  rectangle(x: number, y: number, w: number, h: number, width: number) {
    const p = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    this.polyline([...p, p[0]], width);
  }

  /** A text, or a solid shape (`clear` then the air a text keeps from it). */
  box(box: Box, clear = CLEAR_TEXT) {
    const all = corners(box);
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    for (const key of this.keys(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)))
      Drawn.put(this.boxes, key, { box, clear });
  }

  /**
   * What a text at `box` would touch: `hard` when it meets a line or a text
   * it may not cover, `background` the number of grid and contour segments
   * under it. Segments of `ignore` (a contour, for its own figure) are left out.
   */
  touches(box: Box, ignore = -2): { hard: boolean; background: number } {
    const all = corners(box);
    const span = CLEAR_TEXT + 2;
    const keys = this.keys(
      Math.min(...all.map((p) => p.x)) - span,
      Math.min(...all.map((p) => p.y)) - span,
      Math.max(...all.map((p) => p.x)) + span,
      Math.max(...all.map((p) => p.y)) + span,
    );
    const seen = new Set<object>();
    let background = 0;
    let hard = false;
    for (const key of keys) {
      for (const s of this.segments.get(key) ?? []) {
        if (seen.has(s) || s.owner === ignore) continue;
        seen.add(s);
        if (!segmentMeetsBox(s, box, CLEAR)) continue;
        if (s.background) background++;
        else hard = true;
      }
      for (const item of this.boxes.get(key) ?? []) {
        if (seen.has(item)) continue;
        seen.add(item);
        if (boxesMeet(box, item.box, item.clear)) hard = true;
      }
    }
    return { hard, background };
  }
}

type Line = { text: string; size: number };

/** A text of one or more lines, left-aligned, measured as Helvetica sets it. */
class Label {
  readonly w: number;
  readonly h: number;
  private readonly baselines: number[];

  constructor(
    private readonly font: PDFFont,
    private readonly lines: Line[],
    private readonly color: Color,
    lead = 0,
  ) {
    this.w = Math.max(...lines.map((l) => font.widthOfTextAtSize(l.text, l.size)));
    const last = lines[lines.length - 1];
    const descent = /[gjpqyQ,;()]/.test(last.text) ? DESCENT * last.size : 0;
    const top = CAP * lines[0].size;
    this.h = top + lead * (lines.length - 1) + descent;
    this.baselines = lines.map((_, i) => this.h / 2 - top - lead * i);
  }

  at(x: number, y: number, angle = 0): Box {
    return { x, y, w: this.w, h: this.h, angle };
  }

  draw(page: PDFPage, box: Box) {
    const cos = Math.cos(box.angle);
    const sin = Math.sin(box.angle);
    this.lines.forEach((line, i) => {
      const lx = -this.w / 2;
      const ly = this.baselines[i];
      page.drawText(line.text, {
        x: box.x + lx * cos - ly * sin,
        y: box.y + lx * sin + ly * cos,
        size: line.size,
        font: this.font,
        color: this.color,
        rotate: degrees((box.angle * 180) / Math.PI),
      });
    });
  }
}

/** White under a text, so that the background lines it sits on stop short of it. */
function mask(page: PDFPage, box: Box) {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const lx = -box.w / 2 - MASK;
  const ly = -box.h / 2 - MASK;
  page.drawRectangle({
    x: box.x + lx * cos - ly * sin,
    y: box.y + lx * sin + ly * cos,
    width: box.w + 2 * MASK,
    height: box.h + 2 * MASK,
    rotate: degrees((box.angle * 180) / Math.PI),
    color: rgb(1, 1, 1),
  });
}

/** A text to place and the spots it may take, each with what moving there costs. */
type Spot = { box: Box; cost: number };

function drawing(page: PDFPage, font: PDFFont, seed: number) {
  const rand = seeded(seed);
  const left = 90;
  const right = W - 90;
  const bottom = 320;
  const top = H - 90;
  const drawn = new Drawn();
  const inside = (box: Box) =>
    corners(box).every((p) => p.x >= left && p.x <= right && p.y >= bottom && p.y <= top);

  // ---- The line work, laid out before anything is drawn, so that texts can
  // be placed around all of it. The random draws keep their original order.

  const gridColor = rgb(0.8, 0.82, 0.85);
  const eastings: number[] = [];
  const northings: number[] = [];
  for (let x = left; x <= right; x += 110) eastings.push(x);
  for (let y = bottom; y <= top; y += 110) northings.push(y);
  for (const x of eastings) drawn.line({ x, y: bottom }, { x, y: top }, 0.25, true);
  for (const y of northings) drawn.line({ x: left, y }, { x: right, y }, 0.25, true);

  // Contour lines: long wandering polylines, as a ground survey gives.
  const contours = Array.from({ length: 46 }, (_, c) => {
    let y = bottom + 20 + c * ((top - bottom - 40) / 46);
    let x = left;
    const points: Point[] = [{ x, y }];
    while (x < right) {
      x += 6 + rand() * 6;
      y += (rand() - 0.5) * 7 + Math.sin(x / 90 + c) * 1.6;
      points.push({ x: Math.min(x, right), y });
    }
    const major = c % 5 === 0;
    // The figure's first guess, drawn here to keep the sequence of numbers.
    const hint = major ? left + 200 + rand() * 900 : 0;
    drawn.polyline(points, major ? 0.7 : 0.3, true, c);
    return { c, points, major, hint };
  });

  // The street: centreline, edges, sidewalks, right-of-way.
  const street = (offset: number) => (x: number) => bottom + 520 + Math.sin(x / 420) * 130 + offset;
  const heading = (x: number) => Math.atan((130 / 420) * Math.cos(x / 420));
  const along = (f: (x: number) => number, x: number, d: number): Point => {
    const t = heading(x);
    return { x: x - Math.sin(t) * d, y: f(x) + Math.cos(t) * d };
  };
  const trace = (f: (x: number) => number) => {
    const points = [{ x: left, y: f(left) }];
    for (let x = left + 8; x <= right; x += 8) points.push({ x, y: f(x) });
    return points;
  };
  const strokes: [number, number, Color, number[]?][] = [
    [0, 0.5, red, [18, 5, 3, 5]],
    [38, 1.1, ink],
    [-38, 1.1, ink],
    [52, 0.5, soft],
    [-52, 0.5, soft],
    [110, 0.4, green, [10, 4]],
    [-110, 0.4, green, [10, 4]],
  ];
  for (const [offset, width] of strokes) drawn.polyline(trace(street(offset)), width);
  const centre = street(0);
  const ticks: number[] = [];
  for (let x = left + 40; x < right; x += 110) {
    ticks.push(x);
    drawn.line({ x, y: centre(x) - 6 }, { x, y: centre(x) + 6 }, 0.5);
  }

  // Water main and sewer, with their manholes and valves.
  const water = street(16);
  const sewer = street(-14);
  const pipes = [
    { f: water, color: blue, label: "AQ 200 mm PVC DR-18", dash: [14, 4], side: 1 },
    {
      f: sewer,
      color: green,
      label: "SAN 250 mm PVC DR-35  p=0,8 %",
      dash: [22, 4, 4, 4],
      side: -1,
    },
  ];
  for (const pipe of pipes) drawn.polyline(trace(pipe.f), 1.4);
  const structures: number[] = [];
  for (let x = left + 150; x < right; x += 260) {
    structures.push(x);
    drawn.box({ x, y: sewer(x), w: 15.2, h: 15.2, angle: 0 }, CLEAR + 1);
    drawn.box({ x: x + 64, y: water(x + 64), w: 9, h: 9, angle: 0 }, CLEAR + 1);
  }

  // Lots and buildings on both sides, each with a service connection.
  const lots = [];
  for (const side of [1, -1]) {
    for (let i = 0, x = left + 30; x < right - 150; i++) {
      const w = 120 + rand() * 90;
      const base = street(side * 125)(x + w / 2);
      const depth = 230 + rand() * 60;
      const y0 = side === 1 ? base : base - depth;
      const bw = w * (0.4 + rand() * 0.25);
      const bd = 55 + rand() * 45;
      const bx = x + (w - bw) / 2;
      const by = side === 1 ? y0 + 50 + rand() * 30 : y0 + depth - 50 - bd - rand() * 30;
      const civic = side === 1 ? 100 + i * 2 : 101 + i * 2;
      const lot = 4_215_300 + Math.floor(rand() * 600);
      const sx = bx + bw / 2;
      const front = side === 1 ? by : by + bd;
      lots.push({ side, x, w, depth, y0, bx, by, bw, bd, civic, lot, sx, front });
      drawn.rectangle(x, y0, w, depth, 0.4);
      drawn.box({ x: bx + bw / 2, y: by + bd / 2, w: bw, h: bd, angle: 0 }, CLEAR + 1);
      drawn.line({ x: sx, y: front }, { x: sx, y: water(sx) }, 0.5);
      drawn.line({ x: sx + 9, y: front }, { x: sx + 9, y: sewer(sx + 9) }, 0.5);
      x += w;
    }
  }

  // Notes and north arrow, kept clear as well.
  drawn.box({ x: 320, y: 225, w: 460, h: 130, angle: 0 });
  drawn.box({ x: W - 130, y: H - 112, w: 30, h: 66, angle: 0 });

  // ---- The texts, from the most tied to their place to the most free.

  const placed: { label: Label; box: Box; masked: boolean }[] = [];
  const unplaced: string[] = [];
  const keep = (label: Label, box: Box) => {
    placed.push({ label, box, masked: drawn.touches(box).background > 0 });
    drawn.box(box);
  };
  /**
   * Takes the cheapest spot that touches nothing, masking what background runs
   * under it. Without one, the text is left out and `where` is reported.
   */
  const settle = (label: Label, spots: Spot[], where?: string) => {
    let best: Spot | null = null;
    for (const spot of spots) {
      if (best && spot.cost >= best.cost) continue;
      if (!inside(spot.box)) continue;
      const hit = drawn.touches(spot.box);
      if (hit.hard) continue;
      const cost = spot.cost + hit.background * BACKGROUND_COST;
      if (!best || cost < best.cost) best = { box: spot.box, cost };
    }
    if (!best) {
      if (where) unplaced.push(where);
      return false;
    }
    keep(label, best.box);
    return true;
  };
  /** Spots along the street at stations around `x`, `d` from the line `f`, nearest first. */
  const stations = (
    label: Label,
    f: (x: number) => number,
    x: number,
    d: number,
    range: number,
    step = 3,
  ): Spot[] => {
    const spots = [];
    for (let shift = 0; shift <= range; shift += step)
      for (const s of shift ? [shift, -shift] : [0]) {
        const at = along(f, x + s, d);
        spots.push({ box: label.at(at.x, at.y, heading(x + s)), cost: Math.abs(s) });
      }
    return spots;
  };

  // Grid coordinates at the ends of their lines, outside the drawing area, as
  // a surveyor's grid is read off the border.
  const coordinates: { label: Label; box: Box }[] = [];
  for (const x of eastings) {
    const label = new Label(font, [{ text: `E ${(275000 + x * 3).toFixed(0)}`, size: 6 }], soft);
    coordinates.push({ label, box: label.at(x, top + 4 + label.h / 2) });
  }
  for (const y of northings) {
    const label = new Label(font, [{ text: `N ${(5412000 + y * 3).toFixed(0)}`, size: 6 }], soft);
    coordinates.push({ label, box: label.at(left - 4 - label.w / 2, y) });
  }
  for (const { box } of coordinates) drawn.box(box);

  // Civic numbers stay in the middle of their building; lot numbers in the
  // corner of their lot, away from the street.
  const civics = lots.map((lot) => {
    const label = new Label(font, [{ text: `${lot.civic}`, size: 9 }], ink);
    const box = label.at(lot.bx + lot.bw / 2, lot.by + lot.bd / 2);
    return { label, box };
  });
  for (const lot of lots) {
    const label = new Label(font, [{ text: `Lot ${lot.lot}`, size: 5.5 }], soft);
    const y = lot.y0 + (lot.side === 1 ? lot.depth - 8 - label.h / 2 : 5 + label.h / 2);
    const box = label.at(lot.x + 4 + label.w / 2, y);
    if (drawn.touches(box).hard) unplaced.push(`Lot ${lot.lot}`);
    keep(label, box);
  }

  // Chainages: over the centreline, clear of the tick and of the main.
  ticks.forEach((x, i) => {
    const label = new Label(
      font,
      [{ text: `0+${String(i * 20).padStart(3, "0")}`, size: 6.5 }],
      red,
    );
    const d = 6 + CLEAR + 0.2 + label.h / 2;
    const beside = label.w / 2 + 3;
    // Centred on the tick, else beside it, else under the centreline.
    const spot = (s: number, side: number, cost: number) => {
      const at = along(centre, x + s, side * d);
      return { box: label.at(at.x, at.y, heading(x + s)), cost: cost + Math.abs(s) };
    };
    const spots = [
      spot(0, 1, 0),
      ...[beside, -beside, beside + 6, -beside - 6].map((s) => spot(s, 1, 10)),
      ...[0, beside, -beside].map((s) => spot(s, -1, 40)),
    ];
    settle(label, spots, `0+${i * 20}`);
  });

  // Manholes: name and invert on the far side of the sewer from the
  // centreline, beside the manhole; valves: their name over the main.
  structures.forEach((x, k) => {
    const i = k + 1;
    const manhole = new Label(
      font,
      [
        { text: `RS-${i}`, size: 7 },
        { text: `Rad. ${(21.4 - i * 0.21).toFixed(2)}`, size: 6 },
      ],
      green,
      9,
    );
    const d = -(0.7 + 2.5 + manhole.h / 2);
    const beside = 7.6 + 3 + manhole.w / 2;
    const spots = [
      ...stations(manhole, sewer, x + beside, d, 60),
      ...stations(manhole, sewer, x - beside, d, 60),
    ];
    settle(manhole, spots, `RS-${i}`);
    const valve = new Label(font, [{ text: `VA-${i}`, size: 6.5 }], blue);
    settle(valve, stations(valve, water, x + 64, 4.5 + 2.5 + valve.h / 2, 60, 2), `VA-${i}`);
  });

  // Pipe labels: along their pipe, on the side away from the centreline,
  // every 420 points or near it, between the service connections. Where the
  // connections leave no room for one line, the slope goes under the pipe's
  // description, as a drafter stacks them.
  for (const pipe of pipes) {
    const label = new Label(font, [{ text: pipe.label, size: 7 }], pipe.color);
    const parts = pipe.label.split("  ");
    const stacked =
      parts.length > 1
        ? new Label(
            font,
            parts.map((text) => ({ text, size: 7 })),
            pipe.color,
            9,
          )
        : null;
    const d = (l: Label) => pipe.side * (0.7 + 3 + l.h / 2);
    for (let x = left + 180; x < right - 100; x += 420) {
      if (settle(label, stations(label, pipe.f, x + label.w / 2, d(label), 200))) continue;
      if (stacked && settle(stacked, stations(stacked, pipe.f, x + stacked.w / 2, d(stacked), 200)))
        continue;
      unplaced.push(`${pipe.label} (${x})`);
    }
  }

  // Contour figures: on their line, upright along it, away from the street;
  // the line is broken under the figure.
  const gaps = new Map<number, { from: number; a: Point; b: Point; to: number }>();
  const figures: { label: Label; box: Box }[] = [];
  for (const contour of contours) {
    if (!contour.major) continue;
    const label = new Label(
      font,
      [{ text: `${(24 + contour.c * 0.5).toFixed(1)}`, size: 6 }],
      rgb(0.5, 0.38, 0.2),
    );
    const radius = label.w / 2 + 1.5;
    const pts = contour.points;
    let best: {
      cost: number;
      box: Box;
      gap: { from: number; a: Point; b: Point; to: number };
    } | null = null;
    for (let i = 1; i < pts.length - 1; i++) {
      const cost = Math.abs(pts[i].x - contour.hint);
      if (best && cost >= best.cost) continue;
      const a = cut(pts, i, radius, -1);
      const b = cut(pts, i, radius, 1);
      if (!a || !b) continue;
      const box = label.at((a.p.x + b.p.x) / 2, (a.p.y + b.p.y) / 2, 0);
      box.angle = Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x);
      // The line it replaces must have run under it, and the rest of the
      // contour must stay clear of it.
      const cos = Math.cos(box.angle);
      const sin = Math.sin(box.angle);
      const off = (p: Point) => Math.abs(-(p.x - box.x) * sin + (p.y - box.y) * cos);
      let wander = 0;
      for (let k = a.from + 1; k < b.to; k++) wander = Math.max(wander, off(pts[k]));
      if (wander > label.h / 2) continue;
      if (Math.abs(box.y - centre(box.x)) < 125 || !inside(box)) continue;
      const hit = drawn.touches(box, contour.c);
      if (hit.hard || hit.background) continue;
      // The contour itself, from a few vertices before the break to a few after.
      const before = [...pts.slice(Math.max(0, a.from - 6), a.from + 1), a.p];
      const after = [b.p, ...pts.slice(b.to, b.to + 7)];
      const meets = (run: Point[]) =>
        run.some(
          (p, k) =>
            k > 0 &&
            segmentMeetsBox(
              { a: run[k - 1], b: p, half: 0.35, background: true, owner: -1 },
              box,
              0,
            ),
        );
      if (meets(before) || meets(after)) continue;
      best = { cost: cost + wander * 20, box, gap: { from: a.from, a: a.p, b: b.p, to: b.to } };
    }
    if (!best) {
      unplaced.push(`courbe ${contour.c}`);
      continue;
    }
    drawn.box(best.box);
    figures.push({ label, box: best.box });
    gaps.set(contour.c, best.gap);
  }
  if (unplaced.length) console.warn(`Sans place libre : ${unplaced.join(", ")}`);

  // ---- Drawing, in the original order of the layers.

  for (const x of eastings)
    page.drawLine({
      start: { x, y: bottom },
      end: { x, y: top },
      thickness: 0.25,
      color: gridColor,
    });
  for (const y of northings)
    page.drawLine({
      start: { x: left, y },
      end: { x: right, y },
      thickness: 0.25,
      color: gridColor,
    });
  for (const { label, box } of coordinates) label.draw(page, box);

  const fixed = (p: Point) => `${p.x.toFixed(1)} ${(H - p.y).toFixed(1)}`;
  for (const { c, points, major } of contours) {
    const gap = gaps.get(c);
    let path = `M ${points[0].x} ${H - points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      if (gap && i > gap.from && i < gap.to) continue;
      if (gap && i === gap.to) path += ` L ${fixed(gap.a)} M ${fixed(gap.b)}`;
      path += ` L ${fixed(points[i])}`;
    }
    page.drawSvgPath(path, {
      x: 0,
      y: H,
      borderColor: major ? rgb(0.5, 0.38, 0.2) : rgb(0.72, 0.62, 0.48),
      borderWidth: major ? 0.7 : 0.3,
    });
  }
  for (const { label, box } of figures) label.draw(page, box);
  for (const { box, masked } of placed) if (masked) mask(page, box);

  for (const [offset, width, color, dash] of strokes) {
    const f = street(offset);
    let path = `M ${left} ${H - f(left)}`;
    for (let x = left + 8; x <= right; x += 8) path += ` L ${x} ${(H - f(x)).toFixed(1)}`;
    page.drawSvgPath(path, {
      x: 0,
      y: H,
      borderColor: color,
      borderWidth: width,
      borderDashArray: dash,
    });
  }
  for (const x of ticks)
    page.drawLine({
      start: { x, y: centre(x) - 6 },
      end: { x, y: centre(x) + 6 },
      thickness: 0.5,
      color: red,
    });

  for (const { f, color, dash } of pipes) {
    let path = `M ${left} ${H - f(left)}`;
    for (let x = left + 8; x <= right; x += 8) path += ` L ${x} ${(H - f(x)).toFixed(1)}`;
    page.drawSvgPath(path, {
      x: 0,
      y: H,
      borderColor: color,
      borderWidth: 1.4,
      borderDashArray: dash,
    });
  }
  for (const x of structures) {
    page.drawCircle({
      x,
      y: sewer(x),
      size: 7,
      borderColor: green,
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });
    page.drawRectangle({
      x: x + 60,
      y: water(x + 64) - 4,
      width: 8,
      height: 8,
      borderColor: blue,
      borderWidth: 1,
      color: rgb(1, 1, 1),
    });
  }

  lots.forEach((lot, n) => {
    const { x, y0, w, depth, bx, by, bw, bd, sx, front } = lot;
    page.drawRectangle({ x, y: y0, width: w, height: depth, borderColor: soft, borderWidth: 0.4 });
    page.drawRectangle({ x: bx, y: by, width: bw, height: bd, borderColor: ink, borderWidth: 0.8 });
    for (let h = 6; h < bw + bd; h += 7) {
      page.drawLine({
        start: { x: bx + Math.max(0, h - bd), y: by + Math.min(h, bd) },
        end: { x: bx + Math.min(h, bw), y: by + Math.max(0, h - bw) },
        thickness: 0.2,
        color: soft,
      });
    }
    // The hatching stops around the civic number.
    mask(page, civics[n].box);
    civics[n].label.draw(page, civics[n].box);
    page.drawLine({
      start: { x: sx, y: front },
      end: { x: sx, y: water(sx) },
      thickness: 0.5,
      color: blue,
      dashArray: [4, 3],
    });
    page.drawLine({
      start: { x: sx + 9, y: front },
      end: { x: sx + 9, y: sewer(sx + 9) },
      thickness: 0.5,
      color: green,
      dashArray: [6, 3],
    });
  });
  for (const { label, box } of placed) label.draw(page, box);

  // Notes column.
  const notes = [
    "NOTES GÉNÉRALES",
    "1. Toutes les dimensions sont en mètres, sauf indication contraire.",
    "2. L'entrepreneur doit localiser les services existants avant d'excaver.",
    "3. Conduite d'aqueduc : PVC DR-18, recouvrement minimal de 2,1 m.",
    "4. Conduite d'égout sanitaire : PVC DR-35, pente minimale de 0,5 %.",
    "5. Remblai de tranchée : MG-20 compacté à 95 % du Proctor modifié.",
    "6. Les regards sont préfabriqués en béton, diamètre intérieur 1 200 mm.",
    "7. Remise en état : fondation MG-20 300 mm, enrobé EB-14 60 mm, EB-10S 40 mm.",
  ];
  notes.forEach((line, i) =>
    page.drawText(line, { x: 100, y: 280 - i * 16, size: i === 0 ? 10 : 8, font, color: ink }),
  );

  // North arrow.
  page.drawSvgPath("M 0 0 L 12 40 L 0 30 L -12 40 Z", { x: W - 130, y: H - 110, color: ink });
  page.drawText("N", { x: W - 135, y: H - 92, size: 14, font, color: ink });
}

/**
 * Where a polyline, walked from vertex `i` in direction `dir`, first gets
 * `radius` away from that vertex: the point, and the vertex on the near side.
 */
function cut(points: Point[], i: number, radius: number, dir: 1 | -1) {
  const o = points[i];
  for (let k = i; k + dir >= 0 && k + dir < points.length; k += dir) {
    const p = points[k];
    const q = points[k + dir];
    const dq = Math.hypot(q.x - o.x, q.y - o.y);
    if (dq < radius) continue;
    // Solve |p + t (q - p) - o| = radius for t in [0, 1].
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const fx = p.x - o.x;
    const fy = p.y - o.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    const at = { x: p.x + t * dx, y: p.y + t * dy };
    return dir === -1 ? { p: at, from: k + dir, to: k } : { p: at, from: k, to: k + dir };
  }
  return null;
}

async function main() {
  const out = process.argv[2] ?? "sample-plans.pdf";
  const count = Math.min(Number(process.argv[3] ?? SHEETS.length), SHEETS.length);
  const pdf = await PDFDocument.create();
  pdf.setTitle("Plans — Projet exemple (données fictives)");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([W, H]);
    drawing(page, font, 1000 + i * 77);
    frame(page, font, bold, SHEETS[i][0], SHEETS[i][1], i, count);
  }
  writeFileSync(out, await pdf.save());
  console.log(`${out}: ${count} feuilles`);
}

main();
