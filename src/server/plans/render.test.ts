import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

// Pages are drawn in a worker thread with a time limit: a PDF made to draw
// for minutes neither holds up the server nor breaks the PDFs after it.
process.env.PLAN_PAGE_TIME_LIMIT_MS = "2000";
const { openPlanPdf, PAGE_TOO_SLOW, PDF_UNREADABLE } = await import("./render");

/** A PDF from object bodies, numbered from 1, with a correct cross-reference table. */
function rawPdf(objects: string[]): Buffer {
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** An A0 sheet painted over and over: about 50 ms per coat at the size pages are drawn. */
function slowPdf(coats: number): Buffer {
  const content = `0.5 g\n${"0 0 3370 2384 re f\n".repeat(coats)}`;
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3370 2384] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

async function smallPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 396]);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("FEUILLE", { x: 400, y: 80, size: 10, font });
  page.drawText("C-101", { x: 400, y: 60, size: 16, font });
  return Buffer.from(await pdf.save());
}

describe("drawing the pages of a PDF", () => {
  it("draws a page into tiles, a thumbnail and its text", async () => {
    const pdf = await openPlanPdf(await smallPdf());
    try {
      expect(pdf.pageCount).toBe(1);
      const page = await pdf.render(0);
      expect(page.width).toBeGreaterThan(1000);
      expect(page.files.length).toBeGreaterThan(0);
      expect((await page.files[0].data()).subarray(8, 12).toString()).toBe("WEBP");
      expect(page.thumb.subarray(8, 12).toString()).toBe("WEBP");
      expect(page.text).toContain("C-101");
      await page.dispose();
    } finally {
      await pdf.close();
    }
  });

  it("gives up a page at its time limit, and the server goes on meanwhile", async () => {
    const pdf = await openPlanPdf(slowPdf(1000));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 100);
    const started = performance.now();
    try {
      await expect(pdf.render(0)).rejects.toThrow(PAGE_TOO_SLOW);
    } finally {
      clearInterval(timer);
      await pdf.close();
    }
    const took = performance.now() - started;
    // About a minute of drawing, stopped at 2 s.
    expect(took).toBeGreaterThanOrEqual(2000);
    expect(took).toBeLessThan(6000);
    expect(ticks).toBeGreaterThanOrEqual(15);

    // The next PDF gets a PDFium of its own.
    const next = await openPlanPdf(await smallPdf());
    const page = await next.render(0);
    expect(page.text).toContain("FEUILLE");
    await page.dispose();
    await next.close();
  }, 20_000);

  it("refuses what is not a PDF", async () => {
    await expect(openPlanPdf(Buffer.from("%PDF-1.7 rien d'autre"))).rejects.toThrow(PDF_UNREADABLE);
  });
});
