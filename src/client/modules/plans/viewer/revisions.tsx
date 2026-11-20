import type { UseQueryResult } from "@tanstack/react-query";
import { Check } from "lucide-react";

import type { SheetDetail, SheetRevision } from "@/shared/plans";

import { cn } from "../../../lib/cn";
import { formatDay } from "../../../lib/format";
import { Badge, ErrorState, QueryState, Sheet } from "../../../ui";
import { failureOf } from "./network";
import { revisionName, type SheetView } from "./sheet-view";

/** Every revision of a sheet, newest first, to look at an earlier one. */
export function RevisionsSheet({
  open,
  onClose,
  view,
  detail,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  view: SheetView;
  /** The sheet's detail: the only place its older revisions are listed. */
  detail: UseQueryResult<SheetDetail>;
  onPick: (revision: SheetRevision) => void;
}) {
  // The list is only in the detail; the building block below waits for it,
  // but would wait forever for a request held back for lack of a network.
  const failure = detail.data === undefined ? failureOf(detail) : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Révisions"
      description={[view.number, view.title].filter(Boolean).join(" — ")}
    >
      {failure ? (
        <ErrorState error={failure} onRetry={() => detail.refetch()} />
      ) : (
        <QueryState query={detail}>
          {(sheet) => (
            <ul className="space-y-2">
              {sheet.revisions.map((revision) => {
                const shown = revision.id === view.shown?.id;
                return (
                  <li key={revision.id}>
                    <button
                      type="button"
                      onClick={() => onPick(revision)}
                      aria-current={shown || undefined}
                      className={cn(
                        "flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors",
                        shown
                          ? "border-ead bg-ead-tint"
                          : "border-line bg-surface hover:bg-canvas active:bg-canvas",
                      )}
                    >
                      <img
                        src={revision.thumbUrl}
                        crossOrigin="anonymous"
                        alt=""
                        loading="lazy"
                        className="border-line h-12 w-17 shrink-0 rounded-md border bg-white object-cover"
                      />
                      {/* Names and dates are read to pick the right one: on a
                          narrow phone they take a second line, never an ellipsis. */}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-display leading-snug font-bold wrap-anywhere">
                            {revisionName(revision) ?? "Révision"}
                          </span>
                          {revision.id === sheet.current?.id ? (
                            <Badge tone="good">En vigueur</Badge>
                          ) : null}
                        </span>
                        <span className="text-dim mt-0.5 block text-sm leading-snug">
                          {revision.issuedOn
                            ? `Émise le ${formatDay(revision.issuedOn)}`
                            : `Ajoutée le ${formatDay(revision.addedAt)}`}
                        </span>
                      </span>
                      {shown ? (
                        <Check className="text-ead-dark mr-1 size-5 shrink-0" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      )}
    </Sheet>
  );
}
