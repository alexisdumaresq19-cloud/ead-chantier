import type { Plans, SheetDetail, SheetRevision } from "@/shared/plans";

// What the viewer shows for an address, worked out from whatever the device
// holds: the sheet's own detail when it has it, otherwise the sheet as the
// plan list knows it. A sheet seen in the list therefore opens at once, and
// still opens without a network; the detail only adds its older revisions.

export type SheetView = {
  id: string;
  number: string;
  title: string;
  /** Newest first. Only the current one until the sheet's detail arrives. */
  revisions: SheetRevision[];
  /** How many revisions the sheet has, even when they are not all known here. */
  revisionCount: number;
  current: SheetRevision | null;
  /** The revision on screen; null when there is nothing to draw (see `gap`). */
  shown: SheetRevision | null;
  /** The revision on screen has been replaced by a newer one. */
  replaced: boolean;
  /**
   * Why nothing can be drawn:
   *  - "unrendered": the sheet has no revision ready yet;
   *  - "unknown-revision": the address names a revision this sheet does not have;
   *  - "awaiting-revisions": the address names an older revision and the
   *    sheet's detail, which lists them, is not on the device yet.
   */
  gap: "unrendered" | "unknown-revision" | "awaiting-revisions" | null;
  previousId: string | null;
  nextId: string | null;
  /** "3 / 8". Known only when the plan list is on the device. */
  position: { index: number; total: number } | null;
};

export function resolveSheetView(input: {
  sheetId: string;
  /** From `?rev=`; null for the current revision. */
  revisionId: string | null;
  detail: SheetDetail | undefined;
  plans: Plans | undefined;
}): SheetView | null {
  const { sheetId, revisionId, plans } = input;
  // Leaving a sheet, its detail may still be the one in hand for a moment.
  const detail = input.detail?.id === sheetId ? input.detail : undefined;
  const listed = plans?.sheets ?? [];
  const at = listed.findIndex((sheet) => sheet.id === sheetId);
  const sheet = detail ?? listed[at];
  if (!sheet) return null;

  const current = sheet.current;
  const revisions = detail?.revisions ?? (current ? [current] : []);
  const asked = revisionId && revisionId !== current?.id ? revisionId : null;
  const older = asked ? revisions.find((revision) => revision.id === asked) : undefined;
  const shown = asked ? (older ?? null) : current;

  let gap: SheetView["gap"] = null;
  if (asked && !older) gap = detail ? "unknown-revision" : "awaiting-revisions";
  else if (!shown) gap = "unrendered";

  return {
    id: sheet.id,
    number: sheet.number,
    title: sheet.title,
    revisions,
    revisionCount: Math.max(sheet.revisionCount, revisions.length),
    current,
    shown,
    replaced: Boolean(shown && current && shown.id !== current.id),
    gap,
    previousId: detail ? detail.previousId : at > 0 ? listed[at - 1].id : null,
    nextId: detail ? detail.nextId : at >= 0 && at < listed.length - 1 ? listed[at + 1].id : null,
    position: at >= 0 ? { index: at + 1, total: listed.length } : null,
  };
}

/** The sheets on either side, as the plan list knows them: enough to preload their image. */
export function neighbourRevisions(view: SheetView, plans: Plans | undefined): SheetRevision[] {
  return [view.nextId, view.previousId].flatMap((id) => {
    const revision = plans?.sheets.find((sheet) => sheet.id === id)?.current;
    return revision ? [revision] : [];
  });
}

/**
 * The letter or number offices give a revision ("B", "2"), when its label is
 * just that; null when it is a few words ("Émis pour construction") or empty.
 */
export function revisionCode(revision: Pick<SheetRevision, "label">): string | null {
  const label = revision.label?.trim();
  return label && /^[\p{L}\d]{1,3}$/u.test(label) ? label : null;
}

/**
 * A revision's name as the bar shows it: "Rév. B" for a letter or a number,
 * the label itself when it already reads as words, null when the office gave
 * none.
 */
export function revisionName(revision: Pick<SheetRevision, "label">): string | null {
  const code = revisionCode(revision);
  return code ? `Rév. ${code}` : revision.label?.trim() || null;
}
