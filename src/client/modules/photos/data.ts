import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { useState } from "react";

import type { ProjectDetail } from "@/shared/api";
import { photoCursor, type Photo, type PhotoDay } from "@/shared/photos";

import { api, ApiFailure } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { keys } from "../../lib/session";

// The photos the server has, as the screens read them, and how what the
// device already holds is corrected after a change without waiting for the
// network.

/** Photos asked for at a time: a few screens of the grid. */
const PAGE_SIZE = 90;
/** Pages kept when the gallery is opened again: refreshing a list refetches every page. */
const PAGES_KEPT = 2;

type Pages = InfiniteData<Photo[], string | null>;

export const photoKeys = {
  lists: (projectId: string) => [...keys.project(projectId), "photos", "list"] as const,
  /** One list: every day (`null`) or a single one. */
  list: (projectId: string, day: string | null) =>
    [...keys.project(projectId), "photos", "list", day ?? "all"] as const,
  days: (projectId: string) => [...keys.project(projectId), "photos", "days"] as const,
  one: (projectId: string, photoId: string) =>
    [...keys.project(projectId), "photos", "one", photoId] as const,
};

/** The project's photos, newest first, a page at a time. */
export function usePhotoList(projectId: string, day: string | null) {
  const queryKey = photoKeys.list(projectId, day);
  // Once, when the gallery opens: someone who scrolled far last time starts
  // again from the top, with a list that refreshes in one or two requests.
  useState(() =>
    queryClient.setQueryData<Pages>(queryKey, (data) =>
      data && data.pages.length > PAGES_KEPT
        ? {
            pages: data.pages.slice(0, PAGES_KEPT),
            pageParams: data.pageParams.slice(0, PAGES_KEPT),
          }
        : data,
    ),
  );
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (day) query.set("day", day);
      if (pageParam) query.set("before", pageParam);
      return api<Photo[]>(`/api/projects/${projectId}/photos?${query}`, { signal });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.length < PAGE_SIZE ? undefined : photoCursor(last[last.length - 1]),
  });
}

export const usePhotoDays = (projectId: string) =>
  useQuery({
    queryKey: photoKeys.days(projectId),
    queryFn: () => api<PhotoDay[]>(`/api/projects/${projectId}/photos/days`),
  });

/** One photo by its id, for when the lists on the device do not hold it. */
export const usePhoto = (projectId: string, photoId: string, enabled: boolean) =>
  useQuery({
    queryKey: photoKeys.one(projectId, photoId),
    queryFn: () => api<Photo>(`/api/photos/${photoId}`),
    enabled,
    // A photo that is gone will not come back, and must not be shown from
    // what the device kept.
    retry: false,
    meta: { persist: false },
  });

const noNetwork = new ApiFailure(
  0,
  "offline",
  "Pas de réseau. Réessayez quand la connexion revient.",
);

/**
 * Why a query has nothing to show, if it has failed. Without a network a
 * first fetch does not fail: it waits for the network to return, which a
 * screen must show as "no network" rather than as loading without end.
 */
export function failureOf(query: {
  data: unknown;
  isError: boolean;
  error: unknown;
  isPaused: boolean;
}): unknown {
  if (query.data !== undefined) return null;
  return query.isError ? query.error : query.isPaused ? noNetwork : null;
}

// --- Keeping what the device holds in step ------------------------------------

/** Rewrites each page of each list of the project that the device holds. */
function rewriteLists(
  projectId: string,
  change: (page: Photo[], index: number, day: string) => Photo[],
) {
  for (const [key, data] of queryClient.getQueriesData<Pages>({
    queryKey: photoKeys.lists(projectId),
  })) {
    if (!data) continue;
    const day = String(key[key.length - 1]);
    queryClient.setQueryData<Pages>(key, {
      ...data,
      pages: data.pages.map((page, index) => change(page, index, day)),
    });
  }
}

/** One photo more or less on a day: the day's count and the project's follow. */
function changeCounts(projectId: string, day: string, by: number) {
  queryClient.setQueryData<PhotoDay[]>(photoKeys.days(projectId), (days) => {
    if (!days) return days;
    const known = days.some((d) => d.day === day);
    const next = known
      ? days.map((d) => (d.day === day ? { ...d, count: d.count + by } : d))
      : [...days, { day, count: by }];
    return next.filter((d) => d.count > 0).sort((a, b) => (a.day < b.day ? 1 : -1));
  });
  queryClient.setQueryData<ProjectDetail>(keys.project(projectId), (project) =>
    project ? { ...project, photoCount: Math.max(0, project.photoCount + by) } : project,
  );
}

const holds = (projectId: string, photoId: string) =>
  queryClient
    .getQueriesData<Pages>({ queryKey: photoKeys.lists(projectId) })
    .some(([, data]) => data?.pages.some((page) => page.some((photo) => photo.id === photoId)));

/** A photo the server has just accepted takes its place in the lists. */
export function photoAdded(projectId: string, photo: Photo) {
  if (holds(projectId, photo.id)) return photoChanged(projectId, photo);
  // At the head of the lists it belongs to: the gallery sorts what it shows.
  rewriteLists(projectId, (page, index, day) =>
    index === 0 && (day === "all" || day === photo.day) ? [photo, ...page] : page,
  );
  changeCounts(projectId, photo.day, 1);
}

export function photoChanged(projectId: string, photo: Photo) {
  rewriteLists(projectId, (page) => page.map((p) => (p.id === photo.id ? photo : p)));
  if (queryClient.getQueryData(photoKeys.one(projectId, photo.id)))
    queryClient.setQueryData(photoKeys.one(projectId, photo.id), photo);
}

export function photoRemoved(projectId: string, photo: Pick<Photo, "id" | "day">) {
  const known = holds(projectId, photo.id);
  rewriteLists(projectId, (page) => page.filter((p) => p.id !== photo.id));
  queryClient.removeQueries({ queryKey: photoKeys.one(projectId, photo.id) });
  if (known) changeCounts(projectId, photo.day, -1);
}

/** After any change: the gallery and the count on the project's home refresh. */
export const refreshProject = (projectId: string) =>
  queryClient.invalidateQueries({ queryKey: keys.project(projectId) });
