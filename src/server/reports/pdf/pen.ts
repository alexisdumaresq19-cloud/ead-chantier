import type { FontName, PdfAssets } from "./assets";
import { covers, drawable } from "./glyphs";
import { breakLines, type Line, type Run } from "./lines";

// Writing on the page: styles, the width of a text, lines placed on a
// baseline. Every text goes through `run()`, which keeps only what its
// typeface can draw.

export type Style = {
  font: FontName;
  size: number;
  color: string;
  /** Extra space between letters, in points (small capitals labels). */
  spacing?: number;
};

export type Pen = ReturnType<typeof penFor>;

export function penFor(doc: PDFKit.PDFDocument, assets: PdfAssets) {
  const faces = assets.faces;
  // The typeface and size in use; the colour is set at every text, since
  // shapes change it too.
  let current: Style | null = null;

  const setFont = (style: Style) => {
    if (current?.font !== style.font || current.size !== style.size) {
      doc.font(style.font).fontSize(style.size);
      current = style;
    }
  };
  const apply = (style: Style) => {
    setFont(style);
    doc.fillColor(style.color);
  };

  const measure = (text: string, style: Style) => {
    setFont(style);
    return doc.widthOfString(text, { characterSpacing: style.spacing ?? 0 });
  };

  /** A text in a style, with only the characters its typeface has. */
  const run = (text: string, style: Style): Run<Style> => ({
    text: drawable(text, faces[style.font].has),
    style,
  });

  /**
   * The style for a title: in Archivo when it has every character, in Inter
   * Bold otherwise (Archivo has no Greek or Cyrillic, for one).
   */
  const titled = (text: string, style: Style): Style => {
    const shown = drawable(text, faces.bold.has);
    return covers(shown, faces[style.font].has) ? style : { ...style, font: "bold" };
  };

  /**
   * Where the baseline of a line goes so that its capitals sit in the middle
   * of a line box of height `lead` starting at `top`.
   */
  const baseline = (top: number, lead: number, style: Style) =>
    top + (lead + faces[style.font].capHeight * style.size) / 2;

  /** Draws one line, its left end at x, on a baseline. */
  const draw = (line: Line<Style>, x: number, base: number) => {
    let left = x;
    for (const { text, style } of line.runs) {
      if (text.trim()) {
        apply(style);
        doc.text(text, left, base, {
          lineBreak: false,
          baseline: "alphabetic",
          characterSpacing: style.spacing ?? 0,
        });
      }
      left += measure(text, style);
    }
  };

  const lines = (runs: Run<Style>[], width: number) => breakLines(runs, width, measure);

  /** One line of a single style, shortened with "…" when it does not fit `width`. */
  const single = (text: string, style: Style, width: number): Line<Style> => {
    const { text: shown } = run(text.replace(/\s+/g, " ").trim(), style);
    let kept = shown;
    if (measure(kept, style) > width) {
      const chars = [...shown];
      while (chars.length && measure(`${chars.join("").trimEnd()}…`, style) > width) chars.pop();
      kept = `${chars.join("").trimEnd()}…`;
    }
    return { runs: [{ text: kept, style }], width: measure(kept, style) };
  };

  return {
    doc,
    measure,
    run,
    titled,
    baseline,
    draw,
    lines,
    single,
    /**
     * Hands the style in use back after something drew in another: a page
     * added in the middle of a text draws its band.
     */
    keep<T>(drawing: () => T): T {
      const before = current;
      const result = drawing();
      if (before) apply(before);
      return result;
    },
  };
}
