import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Photo } from "@/shared/photos";
import { REPORT_LIMITS } from "@/shared/reports";

import { api } from "../../lib/api";
import { photoKeys } from "../photos/data";
import type { LocalPhoto } from "../photos/logic";
import { useLocalPhotos } from "../photos/outbox";

// The photos that go with a report, as its screens show them. A report only
// names its photos (`photoIds`); each one is found wherever it is right now:
// still on this device (just taken, on its way), or in the project.

/** A photo of a report: `photo` once the project has it, `local` while it is still on this device. */
export type ReportPhoto = {
  id: string;
  /** ISO 8601. */
  takenAt: string;
  caption: string | null;
} & ({ photo: Photo; local?: undefined } | { local: LocalPhoto; photo?: undefined });

/** What the device knows of the report's photos from the report itself, and since when. */
export type KnownPhotos = { photos: Photo[]; at: number };

/**
 * Puts the photos a report names in the order they were taken, each from
 * where it is. `fetched` holds what was read or changed one photo at a time
 * (a description just written), with the moment it was: the newer of it and
 * of what came with the report wins. An id found nowhere (a photo removed
 * since, or still on someone else's phone) is left out.
 */
export function reportPhotos(
  photoIds: string[],
  known: KnownPhotos | undefined,
  fetched: Map<string, { photo: Photo; at: number }>,
  locals: LocalPhoto[],
): ReportPhoto[] {
  const withReport = new Map(known?.photos.map((photo) => [photo.id, photo]));
  const onDevice = new Map(locals.map((local) => [local.id, local]));
  const found: ReportPhoto[] = [];
  for (const id of new Set(photoIds)) {
    const one = fetched.get(id);
    const photo =
      one && (!known || one.at >= known.at || !withReport.has(id)) ? one.photo : withReport.get(id);
    const local = onDevice.get(id);
    if (photo) found.push({ id, takenAt: photo.takenAt, caption: photo.caption, photo });
    else if (local) found.push({ id, takenAt: local.takenAt, caption: local.caption, local });
  }
  return found.sort((a, b) =>
    a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : a.id < b.id ? -1 : 1,
  );
}

/** The report's photos that have not reached the server yet: they are not in its PDF. */
export const stillOnDevice = (photos: ReportPhoto[]) =>
  photos.filter((photo) => photo.local && photo.local.state !== "sent");

/** The day's photos that do not go with the report yet, oldest first, to choose from. */
export function photosToOffer(dayPhotos: Photo[], photoIds: string[]): Photo[] {
  const taken = new Set(photoIds);
  return dayPhotos
    .filter((photo) => !taken.has(photo.id))
    .sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
}

/** Said when photos could not go with a report that already has as many as it takes. */
export function leftOutText(refused: number): string {
  const one = refused === 1;
  return `${one ? "1 photo n'a pas été ajoutée" : `${refused} photos n'ont pas été ajoutées`} au rapport\u00a0: il en a déjà ${REPORT_LIMITS.photos}, le maximum. ${one ? "Elle reste" : "Elles restent"} dans les photos du projet.`;
}

/** The address of a report's PDF: shown by the browser, or kept as a file. */
export const reportPdfUrl = (reportId: string, download = false) =>
  `/api/reports/${reportId}/pdf${download ? "?download" : ""}`;

/**
 * The photos of the report being shown or written.
 * `known`: the photos that came with the saved report (`report.photos`) and
 * when (`dataUpdatedAt` of its query); leave it out for a report not saved yet.
 */
export function useReportPhotos(
  projectId: string,
  photoIds: string[],
  known?: KnownPhotos,
): {
  photos: ReportPhoto[];
  /** Some are still being looked for: the list may grow. */
  loading: boolean;
} {
  const locals = useLocalPhotos();
  const ids = useMemo(() => [...new Set(photoIds)], [photoIds]);
  const results = useQueries({
    queries: ids.map((id) => {
      const local = locals.find((photo) => photo.id === id);
      return {
        queryKey: photoKeys.one(projectId, id),
        queryFn: () => api<Photo>(`/api/photos/${id}`),
        // Asked for only when nothing here has it: it did not come with the
        // report, and it is not waiting on this device (the server would not
        // know it yet).
        enabled:
          !known?.photos.some((photo) => photo.id === id) && (!local || local.state === "sent"),
        retry: false,
        staleTime: Infinity,
        meta: { persist: false },
      };
    }),
  });
  const fetched = new Map<string, { photo: Photo; at: number }>();
  results.forEach((result, index) => {
    if (result.data) fetched.set(ids[index], { photo: result.data, at: result.dataUpdatedAt });
  });
  return {
    photos: reportPhotos(ids, known, fetched, locals),
    loading: results.some((result) => result.isLoading),
  };
}
