import { plainText } from "@/shared/plans";

/**
 * A few words on each side of where `words` (lowercase, without accents)
 * appear in a page's text: what a search result shows of the drawing.
 */
export function excerptAround(text: string, words: string): string | null {
  // Composed first, so that folding keeps one character for one character.
  const flat = text.normalize("NFC").replace(/\s+/g, " ");
  const at = flat
    .split("")
    .map((character) => plainText(character)[0] ?? character)
    .join("")
    .indexOf(words);
  if (at < 0) return null;
  const from = Math.max(0, at - 40);
  const to = at + words.length + 60;
  return `${from > 0 ? "…" : ""}${flat.slice(from, to).trim()}${to < flat.length ? "…" : ""}`;
}
