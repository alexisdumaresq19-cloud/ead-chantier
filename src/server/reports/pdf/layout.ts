// How the photos of a report are laid out: in rows whose photos share one
// height and fill the width together (two landscapes, a landscape and a
// portrait, three portraits, a panorama alone), each kept whole and in its
// proportions, and the rows in pages. Rows and pages are chosen together, as
// a typesetter breaks lines and pages: the layout whose rows stay closest to
// the height aimed at, and whose pages end closest to their foot, wins.

export type LayoutRules = {
  /** The width the rows fill, in points. */
  width: number;
  /** Between two photos of a row. */
  gap: number;
  /** The height a row aims at. */
  target: number;
  /** No row of several photos is lower (a panorama alone may be). */
  min: number;
  /** No row is higher: a photo alone that would be stays at a sensible size. */
  max: number;
  /**
   * No photo of a row of several is narrower (it would no longer show
   * anything), unless it is narrower alone at the usual height.
   */
  minWidth: number;
  /** Photos in a row, at most. */
  most: number;
  /** Between two rows, at least. */
  rowGap: number;
  /** The height a whole page of photos offers. */
  page: number;
  /**
   * The most a row may take on a page, captions included (a page less the
   * title that may sit above it). A taller row is made smaller, and a page
   * that offers this much always takes at least one row: every photo finds
   * a place.
   */
  tallest: number;
};

export type PhotoRow = {
  /** The first photo of the row, and how many photos it holds. */
  start: number;
  count: number;
  /** The height of its photos. */
  height: number;
  /** Each photo's width; with the gaps they fill the row, unless it is `short`. */
  widths: number[];
  /** Too few photos to fill the width at a sensible height (the last ones): kept at the usual height. */
  short: boolean;
  /** Its photos and their captions, the height the row takes on the page. */
  space: number;
};

/** The height of the captions of a photo shown `width` points wide, with the gap above them. */
export type CaptionHeight = (index: number, width: number) => number;

/** What a row that cannot fill the width costs, for each part of the width it leaves. */
const SHORT_COST = 0.3;
/** What a row breaking the rules costs: chosen only when nothing else can be. */
const BROKEN_COST = 100;
/** The lowest a row is made when it is too tall for a page. */
const SMALLEST = 40;
/** What a page costs for the part of its height it leaves empty (squared), unless it is the last. */
const EMPTY_PAGE_COST = 8;

/**
 * The photos of these proportions (width / height), in their order, laid out
 * in pages: the first page has `first` points left (the photos follow the
 * text), each next one `rules.page`. The first page may hold nothing only
 * when not one row fits there. Pure: the same input always gives the same
 * layout.
 */
export function photoPages(
  aspects: number[],
  caption: CaptionHeight,
  rules: LayoutRules,
  first: number,
): PhotoRow[][] {
  const count = aspects.length;
  if (count === 0) return [];
  const { width, gap, target, min, max, minWidth, most, rowGap, page, tallest } = rules;

  const captions = new Map<string, number>();
  const captionOf = (index: number, shown: number) => {
    const key = `${index}:${Math.floor(shown)}`;
    let height = captions.get(key);
    if (height === undefined) {
      height = caption(index, shown);
      captions.set(key, height);
    }
    return height;
  };

  /**
   * Whether a photo of a row of several is shown narrower than is useful,
   * or than it would be alone at the usual height (a very tall one).
   */
  const squeezed = (start: number, widths: number[]) =>
    widths.length > 1 &&
    widths.some((shown, at) => shown < Math.min(minWidth, aspects[start + at] * target) - 0.01);

  /** The widths of `size` photos from `start` shown `height` high, and the height they take with their captions. */
  const rowAt = (start: number, size: number, height: number) => {
    const widths = aspects.slice(start, start + size).map((aspect) => aspect * height);
    const space = height + Math.max(...widths.map((shown, at) => captionOf(start + at, shown)));
    return { widths, space };
  };

  /**
   * The last photos in one row lowered to fit `room`, the space left at the
   * foot of a page (under the text, or under other photos): shown there, a
   * little smaller, rather than alone on a page of their own. Never lower
   * than the smallest height.
   */
  const lastRowWithin = (start: number, room: number) => {
    const size = count - start;
    if (size > most) return null;
    const { row } = rowOf(start, size);
    let height = row.height;
    let { widths, space } = rowAt(start, size, height);
    while (space > room && height >= min) {
      height -= Math.max(1, space - room);
      ({ widths, space } = rowAt(start, size, height));
    }
    if (height < min || squeezed(start, widths)) return null;
    const used = widths.reduce((total, shown) => total + shown, 0) + gap * (size - 1);
    const cost = (Math.log(height / target) ** 2 + SHORT_COST * (1 - used / width)) * size;
    return { row: { start, count: size, height, widths, short: true, space }, cost };
  };

  /** A row of `size` photos from `start`. */
  const rowOf = (start: number, size: number) => {
    let sum = 0;
    for (let index = start; index < start + size; index++) sum += aspects[index];
    const natural = (width - gap * (size - 1)) / sum;
    const short = natural > max;
    // A short row is not stretched: it takes the usual height and leaves the rest of the width.
    let height = short ? target : natural;
    let { widths, space } = rowAt(start, size, height);
    // Taller than a page takes (captions too long for the photo's width): made smaller.
    while (space > tallest && height > SMALLEST) {
      height = Math.max(SMALLEST, height - Math.max(1, space - tallest));
      ({ widths, space } = rowAt(start, size, height));
    }
    const narrow = squeezed(start, widths);
    let cost: number;
    // A squeezed photo is the worst a row can do: a photo alone at the usual height is better.
    if (narrow) cost = BROKEN_COST + size;
    else if (short) {
      const used = widths.reduce((total, shown) => total + shown, 0) + gap * (size - 1);
      cost = (start + size === count ? 0 : BROKEN_COST) + SHORT_COST * (1 - used / width) * size;
    } else if (size > 1 && natural < min) cost = BROKEN_COST + size;
    else cost = Math.log(natural / target) ** 2 * size;
    if (height !== (short ? target : natural)) cost += BROKEN_COST;
    return { row: { start, count: size, height, widths, short, space }, cost };
  };

  /** The rows that may start at `start`: one breaking the rules only when no other can. */
  const candidatesFrom = (start: number) => {
    const all = [];
    for (let size = 1; size <= most && start + size <= count; size++) all.push(rowOf(start, size));
    const fair = all.filter((candidate) => candidate.cost < BROKEN_COST);
    if (fair.length) return fair;
    // Only the least bad one otherwise (a photo alone at the usual height, as a rule): several
    // poor rows must not beat one fair row and one poor one by taking more photos each.
    return [all.reduce((best, candidate) => (candidate.cost < best.cost ? candidate : best))];
  };

  type Plan = { cost: number; pages: PhotoRow[][] };
  const fresh = new Map<number, Plan>();

  /** The best layout of the photos from `start`, the first of them on a page with `room` left. */
  const layout = (start: number, room: number, isFirst: boolean): Plan => {
    if (!isFirst) {
      const known = fresh.get(start);
      if (known) return known;
    }
    let best: Plan = { cost: Infinity, pages: [] };
    const rows: PhotoRow[] = [];
    // Every way of filling this page with rows, each ending the page somewhere.
    const fill = (next: number, used: number, cost: number) => {
      if (cost >= best.cost) return;
      if (next === count) {
        best = { cost, pages: [[...rows]] };
        return;
      }
      const candidates = candidatesFrom(next);
      const above = used + (rows.length ? rowGap : 0);
      if (candidates.every(({ row }) => above + row.space > room)) {
        const lowered = lastRowWithin(next, room - above);
        if (lowered) candidates.push(lowered);
      }
      for (const { row, cost: rowCost } of candidates) {
        const height = above + row.space;
        // A page that offers a whole row's room takes its first row whatever it is.
        if (height > room && (rows.length > 0 || room < tallest)) continue;
        rows.push(row);
        fill(row.start + row.count, height, cost + rowCost);
        rows.pop();
      }
      // The page ends here, the rest starts on the next one.
      if (rows.length === 0 && !(isFirst && !fitsOne(next, room))) return;
      const after = layout(next, page, false);
      const total = cost + EMPTY_PAGE_COST * ((room - used) / room) ** 2 + after.cost;
      if (total < best.cost) best = { cost: total, pages: [[...rows], ...after.pages] };
    };
    fill(start, 0, 0);
    if (!isFirst) fresh.set(start, best);
    return best;
  };

  /** Whether any row from `start` that the layout would choose fits in `room`. */
  const fitsOne = (start: number, room: number) =>
    room >= tallest || candidatesFrom(start).some(({ row }) => row.space <= room);

  return layout(0, first, true).pages;
}
