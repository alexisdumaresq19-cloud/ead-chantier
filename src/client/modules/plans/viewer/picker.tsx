import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import type { Plans, Sheet as PlanSheet } from "@/shared/plans";

import { cn } from "../../../lib/cn";
import { count } from "../../../lib/format";
import { SearchInput, Sheet } from "../../../ui";
import { filterSheets, groupByFolder, indexSheets } from "../logic";
import { Highlight, PlanThumb, RevisionBadge } from "../parts";

// Going from one sheet to any other without leaving the viewer: the whole
// set in a window, in the order of the plan list, with a search by number or
// title.

export function SheetPicker({
  open,
  onClose,
  plans,
  currentId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** The project's plans, as kept on the device. */
  plans: Plans | undefined;
  /** The sheet on screen. */
  currentId: string;
  onPick: (sheetId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => indexSheets(plans?.sheets ?? []), [plans]);
  const searching = query.trim() !== "";
  const found = useMemo(
    () => (searching ? filterSheets(index, query) : []),
    [index, query, searching],
  );
  const groups = useMemo(() => (plans ? groupByFolder(plans, { keepEmpty: false }) : []), [plans]);

  const close = () => {
    setQuery("");
    onClose();
  };
  const pick = (sheet: PlanSheet) => {
    setQuery("");
    onPick(sheet.id);
  };
  const row = (sheet: PlanSheet) => (
    <li key={sheet.id}>
      <SheetRow
        sheet={sheet}
        query={searching ? query : ""}
        current={sheet.id === currentId}
        onPick={() => pick(sheet)}
      />
    </li>
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Choisir une feuille"
      description={plans ? count(plans.sheets.length, "feuille") : undefined}
    >
      {/* Shown from eight sheets up: under that, the list is read at a glance. */}
      {(plans?.sheets.length ?? 0) >= 8 ? (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Numéro ou titre"
          className="bg-surface sticky top-0 z-10 -mt-1 pt-1 pb-3"
        />
      ) : null}

      {searching ? (
        found.length > 0 ? (
          <ul className="space-y-2">{found.map(row)}</ul>
        ) : (
          <p className="text-dim py-6 text-center text-[15px]">
            Aucune feuille ne correspond à «&nbsp;{query.trim()}&nbsp;».
          </p>
        )
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.folder?.id ?? "loose"}>
              {groups.length > 1 || group.folder ? (
                <h3 className="font-display text-dim mb-2 text-xs font-bold tracking-wider uppercase">
                  {group.folder?.name ?? "Autres feuilles"}
                </h3>
              ) : null}
              <ul className="space-y-2">{group.sheets.map(row)}</ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function SheetRow({
  sheet,
  query,
  current,
  onPick,
}: {
  sheet: PlanSheet;
  query: string;
  current: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={current || undefined}
      // The sheet on screen is where the list opens.
      ref={current ? (element) => element?.scrollIntoView({ block: "center" }) : undefined}
      className={cn(
        "flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border p-2 text-left transition-colors",
        current
          ? "border-ead bg-ead-tint"
          : "border-line bg-surface hover:bg-canvas active:bg-canvas",
      )}
    >
      <PlanThumb
        url={sheet.current?.thumbUrl}
        tiles={sheet.current?.tiles}
        className="h-13 w-18 rounded-lg"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display truncate text-[17px] leading-tight font-bold">
            <Highlight text={sheet.number} query={query} />
          </span>
          <RevisionBadge label={sheet.current?.label ?? null} />
        </span>
        <span className="text-dim mt-0.5 line-clamp-2 text-sm leading-snug">
          <Highlight text={sheet.title} query={query} />
        </span>
      </span>
      {current ? <Check className="text-ead-dark mr-1 size-5 shrink-0" aria-hidden /> : null}
    </button>
  );
}
