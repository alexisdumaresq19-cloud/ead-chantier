// Guesses a sheet's number and title from the text of its page, so that a
// set of forty sheets does not have to be named by hand. A guess only: the
// office checks every name before the plans are published.

const NUMBER = /^[A-Z]{1,4}[-.]?\d{1,4}(?:[-.]\d{1,3})?[A-Z]?$/;
// Codes of pipes and materials that look like sheet numbers.
const NOT_A_SHEET = /^(DR|MG|EB|PVC|CL|CG|PEHD|TBA|ESG|NQ|BNQ|CSA|ASTM|ISO|RS|RP|VA|PI|BF)[-.]?\d/;
const NEAR_NUMBER = /\b(FEUILLE|FEUILLET|DESSIN|PLAN\s*N|SHEET|DWG|NUM[ÉE]RO)\b/i;
const NEAR_TITLE = /\b(TITRE|TITLE)\b/i;

export function suggestSheetName(
  text: string,
  pageIndex: number,
  filename: string,
): { number: string; title: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Map<string, number>();
  for (const line of lines) {
    for (const word of line.split(/\s+/)) seen.set(word, (seen.get(word) ?? 0) + 1);
  }

  let best: { number: string; score: number } | null = null;
  lines.forEach((line, i) => {
    for (const word of line.split(/\s+/)) {
      if (!NUMBER.test(word) || NOT_A_SHEET.test(word)) continue;
      let score = 0;
      // A sheet number stands alone, appears once, and sits by its label.
      if (line === word) score += 2;
      if (seen.get(word) === 1) score += 2;
      if (lines.slice(Math.max(0, i - 2), i + 1).some((l) => NEAR_NUMBER.test(l))) score += 3;
      if (/[-.]/.test(word)) score += 1;
      if (!best || score > best.score) best = { number: word, score };
    }
  });
  const found = best as { number: string; score: number } | null;

  let title = "";
  const titleAt = lines.findIndex((line) => NEAR_TITLE.test(line));
  if (titleAt >= 0) {
    const sameLine = lines[titleAt]
      .replace(/^.*?(TITRE|TITLE)[^:]*:?\s*/i, "")
      .replace(/^(DU|DE LA|OF THE)?\s*(DESSIN|FEUILLE|DRAWING)\s*:?\s*/i, "");
    title = sameLine.length > 3 ? sameLine : (lines[titleAt + 1] ?? "");
  }

  const base = filename.replace(/\.pdf$/i, "");
  return {
    number: found && found.score >= 3 ? found.number : String(pageIndex + 1).padStart(2, "0"),
    title: title.slice(0, 160) || `${base} — page ${pageIndex + 1}`,
  };
}

/** "C-101", "c 101" and "C101" are the same sheet. */
export function sheetNumberKey(number: string): string {
  return number.toUpperCase().replace(/[\s._-]+/g, "");
}
