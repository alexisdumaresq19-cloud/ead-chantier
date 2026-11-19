import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { Device, Member, Person } from "@/shared/api";

import { api } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { keys } from "../../lib/session";

// What the people and project management screens fetch, and what to refresh
// after a change.

export const adminKeys = {
  /** GET /api/users — everyone, for the office (`Person[]`). */
  people: ["people"] as const,
  /** GET /api/users/:id/sessions — someone's devices; "me" for one's own. */
  devices: (userId: string) => ["devices", userId] as const,
  /** GET /api/projects/:id/qr — whether the code this device holds is still the one in force. */
  siteCodeCheck: (projectId: string) => ["site-code-check", projectId] as const,
};

export const usePeople = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: adminKeys.people,
    queryFn: () => api<Person[]>("/api/users"),
    enabled,
  });

export const useMembers = (projectId: string, { watch = false }: { watch?: boolean } = {}) =>
  useQuery({
    queryKey: keys.members(projectId),
    queryFn: () => api<Member[]>(`/api/projects/${projectId}/members`),
    // While the QR code is up, people are joining: the list follows.
    refetchInterval: watch ? 10_000 : false,
  });

export const useDevices = (userId: string) =>
  useQuery({
    queryKey: adminKeys.devices(userId),
    queryFn: () => api<Device[]>(`/api/users/${userId}/sessions`),
  });

/** After people or their projects changed: lists, counts and contact lists follow. */
export function refreshPeople() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: adminKeys.people }),
    queryClient.invalidateQueries({ queryKey: keys.projects }),
  ]);
}

/** The time, refreshed often enough to notice that a code has run out. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
