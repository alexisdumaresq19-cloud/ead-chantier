import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, WifiOff } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import type { PlanSearchHit } from "@/shared/plans";

import { api, ApiFailure } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count } from "../../lib/format";
import { Button, Spinner } from "../../ui";
import { planKeys } from "./data";
import { filterSheets, type IndexedSheet } from "./logic";
import { Highlight, PlanThumb } from "./parts";
import type { PlanView } from "./prefs";
import { SheetLink, SheetList, type ListProps } from "./sheets";

// Searching the plans: what was typed, and what it finds.

/** What was typed in the search box, kept with the screen's place in the history. */
const SEARCH_STATE = "eadPlanSearch";

const storedSearch = (): string => {
  const state = window.history.state as Record<string, unknown> | null;
  return typeof state?.[SEARCH_STATE] === "string" ? (state[SEARCH_STATE] as string) : "";
};

/**
 * The search text. Coming back from a sheet finds it as it was left, since
 * people open several results in a row; arriving any other way starts empty.
 */
export function useSearchText(): [string, (text: string) => void] {
  const [text, setText] = useState(storedSearch);
  useEffect(() => {
    if (storedSearch() === text) return;
    // Not on every key: browsers limit how often the history may be written.
    const timer = window.setTimeout(() => {
      try {
        window.history.replaceState({ ...window.history.state, [SEARCH_STATE]: text }, "");
      } catch {
        // The browser refused (too many writes): the search still works.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  return [text, setText];
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Numbers and titles are searched on the device, at once and without a
 * network. The words drawn on the plans are searched by the server, a moment
 * after the person stops typing.
 */
export const SearchResults = memo(function SearchResults({
  projectId,
  index,
  query,
  view,
  canManage,
  onMenu,
  onClear,
}: ListProps & {
  index: IndexedSheet[];
  query: string;
  view: PlanView;
  onClear: () => void;
}) {
  const matches = useMemo(() => filterSheets(index, query), [index, query]);
  const words = useDebounced(query, 300);
  const drawn = useQuery({
    queryKey: planKeys.search(projectId, words),
    queryFn: ({ signal }) =>
      api<PlanSearchHit[]>(
        `/api/projects/${projectId}/plans/search?q=${encodeURIComponent(words)}`,
        { signal },
      ),
    enabled: words.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    // Without a network, say so at once: the list has already answered.
    retry: false,
    meta: { persist: false },
  });

  const inDrawings = useMemo(() => {
    const listed = new Set(matches.map((sheet) => sheet.id));
    return (drawn.data ?? []).filter((hit) => hit.excerpt && !listed.has(hit.sheetId));
  }, [drawn.data, matches]);
  const searching = query.length >= 2 && (words !== query || drawn.isFetching);
  const unanswered = drawn.isError || drawn.fetchStatus === "paused";
  const offline =
    drawn.fetchStatus === "paused" || (drawn.error instanceof ApiFailure && drawn.error.offline);

  return (
    <div className="mt-3 space-y-6" aria-live="polite">
      {matches.length > 0 ? (
        <section aria-label="Feuilles trouvées">
          <p className="text-dim mb-2 text-sm font-medium">
            {count(matches.length, "feuille trouvée", "feuilles trouvées")}
          </p>
          <SheetList
            projectId={projectId}
            sheets={matches}
            view={view}
            canManage={canManage}
            onMenu={onMenu}
            query={query}
          />
        </section>
      ) : null}

      {inDrawings.length > 0 ? (
        <section
          aria-label="Trouvé sur les plans"
          className={cn("transition-opacity", words !== query && "opacity-60")}
        >
          <h2 className="font-display text-dim mb-2 text-sm font-bold tracking-wider uppercase">
            Écrit sur les plans
          </h2>
          <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border shadow-xs">
            {inDrawings.map((hit) => (
              <DrawnHit key={hit.sheetId} projectId={projectId} hit={hit} words={words} />
            ))}
          </ul>
        </section>
      ) : null}

      {searching ? (
        <p className="text-dim flex items-center gap-2.5 text-sm">
          <Spinner className="size-4.5" label="Recherche" /> Recherche dans le texte des plans…
        </p>
      ) : (
        <>
          {matches.length === 0 && inDrawings.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-dim text-pretty">Aucune feuille ne correspond à « {query} ».</p>
              <Button variant="secondary" className="mt-4" onClick={onClear}>
                Effacer la recherche
              </Button>
            </div>
          ) : null}
          {unanswered ? (
            <p className="text-dim flex items-center gap-2.5 text-sm">
              <WifiOff className="size-4.5 shrink-0" aria-hidden />
              {offline
                ? "Sans réseau, la recherche se limite aux numéros et aux titres."
                : "Le texte des plans n'a pas pu être cherché. Les numéros et les titres l'ont été."}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
});

const DrawnHit = memo(function DrawnHit({
  projectId,
  hit,
  words,
}: {
  projectId: string;
  hit: PlanSearchHit;
  words: string;
}) {
  return (
    <li>
      <SheetLink
        projectId={projectId}
        sheetId={hit.sheetId}
        className="hover:bg-canvas active:bg-canvas flex min-h-[4.75rem] items-center gap-3 py-2.5 pr-2 pl-3 -outline-offset-2 transition-colors"
      >
        <PlanThumb url={hit.thumbUrl} className="h-14 w-19" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="font-display shrink-0 text-[17px] leading-tight font-bold">
              {hit.number}
            </span>
            <span className="text-dim truncate text-sm">{hit.title}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 text-sm leading-snug">
            <Highlight text={hit.excerpt ?? ""} query={words} />
          </span>
        </span>
        <ChevronRight className="text-dim/70 size-5 shrink-0" aria-hidden />
      </SheetLink>
    </li>
  );
});
