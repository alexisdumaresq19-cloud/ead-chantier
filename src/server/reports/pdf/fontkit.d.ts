// The little of fontkit the PDF asks of a typeface directly (pdfkit draws
// with it too): which characters it has, and where its capitals sit.
declare module "fontkit" {
  export interface Font {
    unitsPerEm: number;
    capHeight: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Uint8Array): Font;
}
