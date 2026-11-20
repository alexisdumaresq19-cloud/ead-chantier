import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, EllipsisVertical } from "lucide-react";
import { memo, type ReactNode } from "react";
import { Link } from "wouter";

import type { Sheet as PlanSheet } from "@/shared/plans";

import { cn } from "../../lib/cn";
import { IconButton } from "../../ui";
import { planPaths, warmSheet } from "./data";
import { Highlight, PlanThumb, RevisionBadge } from "./parts";
import type { PlanView } from "./prefs";

// The sheets of a list, as dense rows or as cards with a large thumbnail.

/** What every list of sheets needs to draw its items. */
export type ListProps = {
  projectId: string;
  canManage: boolean;
  onMenu: (sheetId: string) => void;
};

export function SheetList({
  projectId,
  sheets,
  view,
  canManage,
  onMenu,
  query = "",
}: ListProps & { sheets: PlanSheet[]; view: PlanView; query?: string }) {
  const Item = view === "grid" ? SheetCard : SheetRow;
  return (
    <ul
      className={
        view === "grid"
          ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          : "divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border shadow-xs"
      }
    >
      {sheets.map((sheet) => (
        <Item
          key={sheet.id}
          projectId={projectId}
          sheet={sheet}
          query={query}
          canManage={canManage}
          onMenu={onMenu}
        />
      ))}
    </ul>
  );
}

type ItemProps = ListProps & { sheet: PlanSheet; query: string };

/** The link to a sheet's viewer. The sheet is fetched as the finger lands. */
export function SheetLink({
  projectId,
  sheetId,
  title,
  className,
  children,
}: {
  projectId: string;
  sheetId: string;
  /** Shown on hover, when the link itself says only the number. */
  title?: string;
  className: string;
  children: ReactNode;
}) {
  const client = useQueryClient();
  return (
    <Link
      href={planPaths.sheet(projectId, sheetId)}
      onPointerDown={() => warmSheet(client, projectId, sheetId)}
      title={title}
      className={className}
    >
      {children}
    </Link>
  );
}

function MenuButton({
  sheet,
  onMenu,
  floating,
  className,
}: {
  sheet: PlanSheet;
  onMenu: (id: string) => void;
  /** Over a thumbnail: a small white disc, in a target that stays 44 px. */
  floating?: boolean;
  className?: string;
}) {
  return (
    <IconButton
      label={`Gérer la feuille ${sheet.number}`}
      onClick={() => onMenu(sheet.id)}
      className={cn(floating && "group/menu hover:bg-transparent active:bg-transparent", className)}
    >
      {floating ? (
        <span className="border-line bg-surface/95 text-text group-hover/menu:bg-canvas flex size-8 items-center justify-center rounded-full border shadow-sm transition-colors">
          <EllipsisVertical className="size-5" aria-hidden />
        </span>
      ) : (
        <EllipsisVertical aria-hidden />
      )}
    </IconButton>
  );
}

/** A dense row: the fastest to scan on a phone. */
const SheetRow = memo(function SheetRow({ projectId, sheet, query, canManage, onMenu }: ItemProps) {
  return (
    <li className="flex items-center">
      <SheetLink
        projectId={projectId}
        sheetId={sheet.id}
        className="hover:bg-canvas active:bg-canvas flex min-h-[4.75rem] min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3 -outline-offset-2 transition-colors"
      >
        <PlanThumb
          url={sheet.current?.thumbUrl}
          tiles={sheet.current?.tiles}
          className="h-14 w-19"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-display truncate text-[17px] leading-tight font-bold">
              <Highlight text={sheet.number} query={query} />
            </span>
            <RevisionBadge sheet={sheet} />
          </span>
          {sheet.title ? (
            // Three lines: the chainage at the end of a civil title is what
            // tells two sheets apart, and must never be cut.
            <span className="text-dim mt-0.5 line-clamp-3 text-sm leading-snug">
              <Highlight text={sheet.title} query={query} />
            </span>
          ) : null}
        </span>
        {canManage ? null : <ChevronRight className="text-dim/70 size-5 shrink-0" aria-hidden />}
      </SheetLink>
      {canManage ? <MenuButton sheet={sheet} onMenu={onMenu} className="mr-1" /> : null}
    </li>
  );
});

/** A card with a large thumbnail, to recognise a sheet by its drawing. */
const SheetCard = memo(function SheetCard({
  projectId,
  sheet,
  query,
  canManage,
  onMenu,
}: ItemProps) {
  return (
    <li className="relative">
      <SheetLink
        projectId={projectId}
        sheetId={sheet.id}
        className="border-line bg-surface hover:border-ead/60 active:bg-canvas flex h-full flex-col overflow-hidden rounded-2xl border shadow-xs transition hover:shadow-md"
      >
        <span className="border-line block border-b">
          <PlanThumb
            url={sheet.current?.thumbUrl}
            tiles={sheet.current?.tiles}
            className="aspect-[7/5] w-full rounded-none border-0"
          />
        </span>
        <span className="block p-3">
          {/* A long revision name goes under the number rather than squeeze it. */}
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="font-display min-w-0 truncate text-[17px] leading-tight font-bold">
              <Highlight text={sheet.number} query={query} />
            </span>
            <RevisionBadge sheet={sheet} className="max-w-full" />
          </span>
          {sheet.title ? (
            <span className="text-dim mt-1 line-clamp-3 text-sm leading-snug">
              <Highlight text={sheet.title} query={query} />
            </span>
          ) : null}
        </span>
      </SheetLink>
      {canManage ? (
        <MenuButton sheet={sheet} onMenu={onMenu} floating className="absolute top-0 right-0" />
      ) : null}
    </li>
  );
});
