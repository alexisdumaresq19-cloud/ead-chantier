// Breaking a paragraph into lines, done here rather than by pdfkit: the
// document has to know where each line ends before it draws anything, to
// keep a title with what follows it and to avoid a lone line at the top or
// the bottom of a page. A paragraph is a list of runs, each in its own style
// (a photo's number, its description, its time).

export type Run<S> = { text: string; style: S };
export type Line<S> = { runs: Run<S>[]; width: number };
export type Measure<S> = (text: string, style: S) => number;

type Piece<S> = { text: string; style: S; width: number };
/** What lies between two places a line may end, and the spaces after it. */
type Word<S> = { pieces: Piece<S>[]; width: number; space: Piece<S>[]; spaceWidth: number };

/**
 * Where a word may break besides its spaces: after a hyphen or a slash with
 * at least three characters on each side ("Marie-|Ève", "aqueduc/|égout"),
 * never in "R-4".
 */
const SOFT_BREAK = /(?<=[^\s\u00a0]{3}[-/‐–])(?=[^\s\u00a0]{3})/u;

/**
 * The words of the runs. A word may span runs (a number in bold glued to its
 * text by a no-break space): a line ends only at a space or a soft break.
 */
function wordsOf<S>(runs: Run<S>[], measure: Measure<S>): Word<S>[] {
  const words: Word<S>[] = [];
  let current = null as Word<S> | null;
  for (const { text, style } of runs)
    for (const part of text.split(/( +)/)) {
      if (!part) continue;
      if (part.startsWith(" ")) {
        // Spaces at the start of a paragraph are dropped.
        if (!current) continue;
        const width = measure(part, style);
        current.space.push({ text: part, style, width });
        current.spaceWidth += width;
        continue;
      }
      part.split(SOFT_BREAK).forEach((chunk, index) => {
        if (!current || current.space.length || index > 0) {
          current = { pieces: [], width: 0, space: [], spaceWidth: 0 };
          words.push(current);
        }
        const width = measure(chunk, style);
        current.pieces.push({ text: chunk, style, width });
        current.width += width;
      });
    }
  return words;
}

/**
 * The lines of one paragraph (no line end inside) within `width`. Lines
 * break at spaces; a word longer than a whole line (an address, a serial
 * number) is broken between two characters, so that nothing leaves the page.
 */
export function breakLines<S>(runs: Run<S>[], width: number, measure: Measure<S>): Line<S>[] {
  const lines: Line<S>[] = [];
  let line: Piece<S>[] = [];
  let used = 0;
  /** The spaces after the last word placed: they count only if a word follows on the line. */
  let pending: Piece<S>[] = [];
  let pendingWidth = 0;

  const close = () => {
    if (line.length) lines.push(lineOf(line, used));
    line = [];
    used = 0;
    pending = [];
    pendingWidth = 0;
  };
  const place = (pieces: Piece<S>[], piecesWidth: number) => {
    line.push(...pending, ...pieces);
    used += pendingWidth + piecesWidth;
    pending = [];
    pendingWidth = 0;
  };

  for (const word of wordsOf(runs, measure)) {
    if (used + pendingWidth + word.width > width && word.width <= width) close();
    if (used + pendingWidth + word.width <= width) place(word.pieces, word.width);
    else {
      // Longer than a line: cut it, starting on this line when a fair part of it is free.
      if (width - used - pendingWidth < width * 0.3) close();
      for (const piece of word.pieces)
        for (const char of piece.text) {
          // Character by character: kerning changes such a line by a hair at most.
          const charWidth = measure(char, piece.style);
          if (used + pendingWidth + charWidth > width && line.length) close();
          place([{ text: char, style: piece.style, width: charWidth }], charWidth);
        }
    }
    if (line.length) {
      pending = word.space;
      pendingWidth = word.spaceWidth;
    }
  }
  close();
  return lines;
}

/** Joins the pieces of one style, so that each line is drawn in as few calls as possible. */
function lineOf<S>(pieces: Piece<S>[], width: number): Line<S> {
  const runs: Run<S>[] = [];
  for (const { text, style } of pieces) {
    const last = runs.at(-1);
    if (last && last.style === style) last.text += text;
    else runs.push({ text, style });
  }
  return { runs, width };
}
