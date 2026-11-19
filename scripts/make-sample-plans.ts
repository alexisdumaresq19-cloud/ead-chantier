/**
 * Generates a fictional set of civil plans as a large-format vector PDF, for
 * development, tests and the demo project. Every sheet is stamped "EXEMPLE".
 *
 *   npx tsx scripts/make-sample-plans.ts [out.pdf] [sheetCount]
 */
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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

function drawing(page: PDFPage, font: PDFFont, seed: number) {
  const rand = seeded(seed);
  const left = 90;
  const right = W - 90;
  const bottom = 320;
  const top = H - 90;

  // Survey grid with coordinates.
  for (let x = left; x <= right; x += 110) {
    page.drawLine({
      start: { x, y: bottom },
      end: { x, y: top },
      thickness: 0.25,
      color: rgb(0.8, 0.82, 0.85),
    });
    page.drawText(`E ${(275000 + x * 3).toFixed(0)}`, {
      x: x + 3,
      y: top - 10,
      size: 6,
      font,
      color: soft,
    });
  }
  for (let y = bottom; y <= top; y += 110) {
    page.drawLine({
      start: { x: left, y },
      end: { x: right, y },
      thickness: 0.25,
      color: rgb(0.8, 0.82, 0.85),
    });
    page.drawText(`N ${(5412000 + y * 3).toFixed(0)}`, {
      x: left + 3,
      y: y + 3,
      size: 6,
      font,
      color: soft,
    });
  }

  // Contour lines: long wandering polylines, as a ground survey gives.
  for (let c = 0; c < 46; c++) {
    let y = bottom + 20 + c * ((top - bottom - 40) / 46);
    let x = left;
    let path = `M ${x} ${H - y}`;
    while (x < right) {
      x += 6 + rand() * 6;
      y += (rand() - 0.5) * 7 + Math.sin(x / 90 + c) * 1.6;
      path += ` L ${Math.min(x, right).toFixed(1)} ${(H - y).toFixed(1)}`;
    }
    const major = c % 5 === 0;
    page.drawSvgPath(path, {
      x: 0,
      y: H,
      borderColor: major ? rgb(0.5, 0.38, 0.2) : rgb(0.72, 0.62, 0.48),
      borderWidth: major ? 0.7 : 0.3,
    });
    if (major)
      page.drawText(`${(24 + c * 0.5).toFixed(1)}`, {
        x: left + 200 + rand() * 900,
        y: y + 2,
        size: 6,
        font,
        color: rgb(0.5, 0.38, 0.2),
      });
  }

  // The street: centreline, edges, sidewalks, chainage ticks.
  const street = (offset: number) => (x: number) => bottom + 520 + Math.sin(x / 420) * 130 + offset;
  const strokes: [number, number, ReturnType<typeof rgb>, number[]?][] = [
    [0, 0.5, red, [18, 5, 3, 5]],
    [38, 1.1, ink],
    [-38, 1.1, ink],
    [52, 0.5, soft],
    [-52, 0.5, soft],
    [110, 0.4, green, [10, 4]],
    [-110, 0.4, green, [10, 4]],
  ];
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
  const centre = street(0);
  for (let i = 0, x = left + 40; x < right; x += 110, i++) {
    page.drawLine({
      start: { x, y: centre(x) - 6 },
      end: { x, y: centre(x) + 6 },
      thickness: 0.5,
      color: red,
    });
    page.drawText(`0+${String(i * 20).padStart(3, "0")}`, {
      x: x - 12,
      y: centre(x) + 10,
      size: 6.5,
      font,
      color: red,
    });
  }

  // Water main and sewer along the street, with structures and labels.
  const water = street(16);
  const sewer = street(-14);
  for (const [f, color, label, dash] of [
    [water, blue, "AQ 200 mm PVC DR-18", [14, 4]],
    [sewer, green, "SAN 250 mm PVC DR-35  p=0,8 %", [22, 4, 4, 4]],
  ] as const) {
    let path = `M ${left} ${H - f(left)}`;
    for (let x = left + 8; x <= right; x += 8) path += ` L ${x} ${(H - f(x)).toFixed(1)}`;
    page.drawSvgPath(path, {
      x: 0,
      y: H,
      borderColor: color,
      borderWidth: 1.4,
      borderDashArray: [...dash],
    });
    for (let x = left + 180; x < right - 100; x += 420)
      page.drawText(label, { x, y: f(x) + 5, size: 7, font, color });
  }
  for (let i = 1, x = left + 150; x < right; x += 260, i++) {
    page.drawCircle({
      x,
      y: sewer(x),
      size: 7,
      borderColor: green,
      borderWidth: 1.2,
      color: rgb(1, 1, 1),
    });
    page.drawText(`RS-${i}`, { x: x + 10, y: sewer(x) - 14, size: 7, font, color: green });
    page.drawText(`Rad. ${(21.4 - i * 0.21).toFixed(2)}`, {
      x: x + 10,
      y: sewer(x) - 23,
      size: 6,
      font,
      color: green,
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
    page.drawText(`VA-${i}`, { x: x + 72, y: water(x + 64) + 8, size: 6.5, font, color: blue });
  }

  // Lots and buildings on both sides, each with a service connection.
  for (const side of [1, -1]) {
    for (let i = 0, x = left + 30; x < right - 150; i++) {
      const w = 120 + rand() * 90;
      const base = street(side * 125)(x + w / 2);
      const depth = 230 + rand() * 60;
      const y0 = side === 1 ? base : base - depth;
      page.drawRectangle({
        x,
        y: y0,
        width: w,
        height: depth,
        borderColor: soft,
        borderWidth: 0.4,
      });
      const bw = w * (0.4 + rand() * 0.25);
      const bd = 55 + rand() * 45;
      const bx = x + (w - bw) / 2;
      const by = side === 1 ? y0 + 50 + rand() * 30 : y0 + depth - 50 - bd - rand() * 30;
      page.drawRectangle({
        x: bx,
        y: by,
        width: bw,
        height: bd,
        borderColor: ink,
        borderWidth: 0.8,
      });
      for (let h = 6; h < bw + bd; h += 7) {
        page.drawLine({
          start: { x: bx + Math.max(0, h - bd), y: by + Math.min(h, bd) },
          end: { x: bx + Math.min(h, bw), y: by + Math.max(0, h - bw) },
          thickness: 0.2,
          color: soft,
        });
      }
      const civic = side === 1 ? 100 + i * 2 : 101 + i * 2;
      page.drawText(`${civic}`, {
        x: bx + bw / 2 - 8,
        y: by + bd / 2 - 3,
        size: 9,
        font,
        color: ink,
      });
      page.drawText(`Lot ${4_215_300 + Math.floor(rand() * 600)}`, {
        x: x + 4,
        y: y0 + (side === 1 ? depth - 12 : 5),
        size: 5.5,
        font,
        color: soft,
      });
      const sx = bx + bw / 2;
      page.drawLine({
        start: { x: sx, y: side === 1 ? by : by + bd },
        end: { x: sx, y: water(sx) },
        thickness: 0.5,
        color: blue,
        dashArray: [4, 3],
      });
      page.drawLine({
        start: { x: sx + 9, y: side === 1 ? by : by + bd },
        end: { x: sx + 9, y: sewer(sx + 9) },
        thickness: 0.5,
        color: green,
        dashArray: [6, 3],
      });
      x += w;
    }
  }

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
