import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { Member } from "@/shared/api";
import type { Photo } from "@/shared/photos";
import type { DayReport, Report, ReportSummary } from "@/shared/reports";

import { api, ApiFailure } from "../../lib/api";
import { todayKey } from "../../lib/format";
import { keys, useCurrentProject, useCurrentUser } from "../../lib/session";
import { draftsVersion, listDrafts, subscribeToDrafts } from "./drafts";

// What the reports screens fetch. Every key starts with the project's, so a
// change anywhere in the project refreshes these too.

export const reportKeys = {
  list: (projectId: string) => [...keys.project(projectId), "reports"] as const,
  day: (projectId: string, day: string) =>
    [...keys.project(projectId), "reports", "day", day] as const,
  one: (projectId: string, reportId: string) =>
    [...keys.project(projectId), "reports", "one", reportId] as const,
  photos: (projectId: string, day: string) =>
    [...keys.project(projectId), "photos", "day", day] as const,
};

export const reportsPath = (projectId: string) => `/projets/${projectId}/rapports`;

/**
 * Whether the person may write, change or remove reports here: an archived
 * project is read-only, except for the office. The server decides again.
 */
export function useCanChangeReports() {
  const project = useCurrentProject();
  const me = useCurrentUser();
  return project.status !== "archive" || me.role === "admin";
}

const listQuery = (projectId: string) => ({
  queryKey: reportKeys.list(projectId),
  queryFn: () => api<ReportSummary[]>(`/api/projects/${projectId}/reports`),
});

export const dayQuery = (projectId: string, day: string) => ({
  queryKey: reportKeys.day(projectId, day),
  queryFn: () => api<DayReport>(`/api/projects/${projectId}/reports/day/${day}`),
});

export const membersQuery = (projectId: string) => ({
  queryKey: keys.members(projectId),
  queryFn: () => api<Member[]>(`/api/projects/${projectId}/members`),
});

export const useReports = (projectId: string) => useQuery(listQuery(projectId));

/**
 * A report of this project. The API answers for any project the person
 * manages: an id from another one, put in this project's address, is not
 * shown (nor changed) here as if it belonged to it.
 */
export const useReport = (projectId: string, reportId: string) =>
  useQuery({
    queryKey: reportKeys.one(projectId, reportId),
    queryFn: async () => {
      const report = await api<Report>(`/api/reports/${reportId}`);
      if (report.projectId !== projectId)
        throw new ApiFailure(404, "not_found", "Rapport introuvable.");
      return report;
    },
  });

/**
 * Asked again each time the form opens, even just after the list fetched it:
 * whether the day already has a report decides between writing a new one and
 * opening that one.
 */
export const useDayReport = (projectId: string, day: string, enabled = true) =>
  useQuery({ ...dayQuery(projectId, day), enabled, staleTime: 0 });

export const useMembers = (projectId: string) => useQuery(membersQuery(projectId));

/**
 * The photos taken that day. They belong to the photos module: if they cannot
 * be fetched, the report simply shows none.
 */
export const useDayPhotos = (projectId: string, day: string | undefined) =>
  useQuery({
    queryKey: reportKeys.photos(projectId, day ?? ""),
    queryFn: async () => {
      const photos = await api<Photo[]>(`/api/projects/${projectId}/photos?day=${day}`);
      return Array.isArray(photos) ? photos : [];
    },
    enabled: Boolean(day),
    retry: false,
  });

/**
 * Whether the screen is still shown. On a slow network the answer to a save
 * can come after the person has gone elsewhere: it must not pull them back.
 */
export function useStillShown() {
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  return shown;
}

function subscribeToClock(listener: () => void) {
  // The app often stays open for days: the day is read again when the person
  // comes back to it, and every minute for a screen left on.
  const timer = window.setInterval(listener, 60_000);
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
  };
}

/** Today's date on this device, kept current past midnight. */
export const useToday = () =>
  useSyncExternalStore(
    subscribeToClock,
    () => todayKey(),
    () => "",
  );

type Drafts = ReturnType<typeof listDrafts>;
const NO_DRAFTS: Drafts = [];
let draftsRead: { of: string; version: number; drafts: Drafts } | null = null;

/** The same list is handed back until a draft changes, as React expects of a snapshot. */
function draftsSnapshot(userId: string, projectId: string): Drafts {
  const of = `${userId}:${projectId}`;
  if (draftsRead?.of !== of || draftsRead.version !== draftsVersion())
    draftsRead = { of, version: draftsVersion(), drafts: listDrafts(userId, projectId) };
  return draftsRead.drafts;
}

/** The reports this person has started on this device and not saved yet. */
export const useDrafts = (userId: string, projectId: string) =>
  useSyncExternalStore(
    subscribeToDrafts,
    () => draftsSnapshot(userId, projectId),
    () => NO_DRAFTS,
  );
