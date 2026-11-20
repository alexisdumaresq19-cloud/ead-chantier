// What a typeface can draw. A character it lacks would print as an empty
// box: it is replaced by its plain form when the typeface has that ("ﬁ"
// becomes "fi", "㎡" becomes "m2"), and left out otherwise (an emoji, a
// script none of the typefaces covers), without leaving two spaces behind.

/** Whether the typeface has a drawing for this character. */
export type Coverage = (codePoint: number) => boolean;

const NBSP = "\u00a0";
const NNBSP = "\u202f";

/** Spaces of every width are written as a plain one; the narrow no-break space is handled below. */
const SPACES = /[\t\u2000-\u200a\u205f\u3000]/g;
/**
 * Characters that are never drawn: controls (the line end aside), invisible
 * joiners and marks, variation selectors (the "emoji" form of a symbol).
 */
const INVISIBLE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]|\udb40[\udd00-\uddef]/g;

/** The text, as this typeface can draw it. */
export function drawable(text: string, has: Coverage): string {
  const flat = text
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(SPACES, " ")
    .replace(INVISIBLE, "");
  let out = "";
  // Set when a character was left out: the next space may be one too many.
  let dropped = false;
  const trimEnd = () => {
    if (dropped) out = out.replace(/ +$/, "");
  };
  for (const char of flat) {
    if (char === "\n") {
      trimEnd();
      out += char;
      dropped = false;
      continue;
    }
    if (char === " ") {
      if (dropped && (out === "" || out.endsWith(" ") || out.endsWith("\n"))) continue;
      out += char;
      continue;
    }
    const kept = drawn(char, has);
    if (kept) {
      // A space left by what was dropped never stands before a comma, a period or a closing bracket.
      if (dropped && /^[,.)\]…]/.test(kept)) out = out.replace(/ +$/, "");
      out += kept;
      dropped = false;
    } else dropped = true;
  }
  trimEnd();
  return out;
}

function drawn(char: string, has: Coverage): string | null {
  if (has(char.codePointAt(0)!)) return char;
  // A narrow no-break space (in numbers, before ";" in French) stays unbreakable.
  if (char === NNBSP) return has(0xa0) ? NBSP : " ";
  const plain = char.normalize("NFKC");
  if (plain !== char && [...plain].every((part) => part === " " || has(part.codePointAt(0)!)))
    return plain;
  return null;
}

/** Whether every character of the text is in the typeface (spaces and line ends aside). */
export function covers(text: string, has: Coverage): boolean {
  for (const char of text)
    if (char !== " " && char !== "\n" && !has(char.codePointAt(0)!)) return false;
  return true;
}
