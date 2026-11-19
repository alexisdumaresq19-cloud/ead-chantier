import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import type { Member } from "@/shared/api";
import type { Photo } from "@/shared/photos";
import type { DayReport, Report, ReportSummary } from "@/shared/reports";

import { api } from "../../lib/api";
import { todayKey } from "../../lib/format";
import { keys } from "../../lib/session";
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

// The app's default (30 days, lib/query.ts) is more than a browser timer can
// count (24.8 days): it fires at once, and what no screen is showing is
// forgotten — the people of the project fetched ahead for the form, the list
// behind a report. Until the default is shorter, these say how long themselves.
const KEPT = 21 * 24 * 3600 * 1000;

const listQuery = (projectId: string) => ({
  queryKey: reportKeys.list(projectId),
  queryFn: () => api<ReportSummary[]>(`/api/projects/${projectId}/reports`),
  gcTime: KEPT,
});

export const dayQuery = (projectId: string, day: string) => ({
  queryKey: reportKeys.day(projectId, day),
  queryFn: () => api<DayReport>(`/api/projects/${projectId}/reports/day/${day}`),
  gcTime: KEPT,
});

export const membersQuery = (projectId: string) => ({
  queryKey: keys.members(projectId),
  queryFn: () => api<Member[]>(`/api/projects/${projectId}/members`),
  gcTime: KEPT,
});

export const useReports = (projectId: string) => useQuery(listQuery(projectId));

export const useReport = (projectId: string, reportId: string) =>
  useQuery({
    queryKey: reportKeys.one(projectId, reportId),
    queryFn: () => api<Report>(`/api/reports/${reportId}`),
    gcTime: KEPT,
  });

export const useDayReport = (projectId: string, day: string, enabled = true) =>
  useQuery({ ...dayQuery(projectId, day), enabled });

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
    gcTime: KEPT,
  });

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
