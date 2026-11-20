import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import type { Me, ProjectDetail, ProjectSummary } from "@/shared/api";

import { api, ApiFailure } from "./api";
import { clearStoredData, queryClient } from "./query";

// Who is signed in, and the projects they see. The keys are shared: any
// screen that changes a project invalidates ["projects"].

export const keys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  members: (id: string) => ["projects", id, "members"] as const,
  /** GET /api/projects/:id/plans — the plan list (`Plans`). */
  plans: (id: string) => ["projects", id, "plans"] as const,
  /** GET /api/sheets/:sheetId — one sheet with its revisions (`SheetDetail`). */
  sheet: (id: string, sheetId: string) => ["projects", id, "sheet", sheetId] as const,
};

/**
 * The signed-in person; null when the server says nobody is. Without a
 * network, the person stored on the device is kept, so the app still opens.
 */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<Me>("/api/me");
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    // Asked again at every opening of the app, however fresh the copy: a
    // person deactivated meanwhile is sent to the welcome screen at once.
    refetchOnMount: "always",
  });
}

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectSummary[]>("/api/projects") });

export const useProject = (id: string | undefined) =>
  useQuery({
    queryKey: keys.project(id ?? ""),
    queryFn: () => api<ProjectDetail>(`/api/projects/${id}`),
    enabled: Boolean(id),
  });

/**
 * Signs this device out, then opens `to` (the welcome screen).
 *
 * Only the server can sign a device out: it ends the session and removes the
 * cookie, which the page cannot touch. So nothing is cleared and the page is
 * not left until the server has confirmed. Without a network, or on any
 * refusal or server error, this rejects with the ApiFailure and changes
 * nothing: the person is still signed in on this device. The caller must say
 * so (call it from a mutation and show errorMessage(error)), never show a
 * signed-out screen: the next person to pick up the device would be let in
 * as soon as the network returns.
 */
export async function signOut(to = "/bienvenue") {
  await api("/api/logout", { method: "POST" });
  await clearStoredData();
  forgetLocalTraces();
  window.location.assign(to);
}

/**
 * What modules keep in the browser's local storage for the person: unsaved
 * daily reports, the site code they made, the plans they opened last. A device that is handed on after a
 * sign-out keeps none of it. (Display preferences stay.)
 */
function forgetLocalTraces() {
  try {
    for (const key of Object.keys(window.localStorage))
      if (
        key.startsWith("ead:rapport:") ||
        key.startsWith("ead-site-code:") ||
        key.startsWith("ead:recents:")
      )
        window.localStorage.removeItem(key);
  } catch {
    // Local storage can be closed to the page (private mode): nothing to forget.
  }
}

/**
 * After the server has signed this device in (an accepted invitation, the
 * first setup): drop whatever a previous person left on the device and start
 * the app afresh at `path`.
 */
export async function enterApp(path = "/") {
  await clearStoredData();
  window.location.replace(path);
}

/** The server no longer knows this device: back to the welcome screen. */
export function handleSignedOut() {
  if (queryClient.getQueryData(keys.me) == null) return;
  queryClient.setQueryData(keys.me, null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
}

// Inside the signed-in part of the app, the person and the open project are
// already loaded: screens read them here and never handle their absence.

export const MeContext = createContext<Me | null>(null);
export const ProjectContext = createContext<ProjectDetail | null>(null);

/** The signed-in person. */
export function useCurrentUser(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useCurrentUser is for signed-in screens.");
  return me;
}

/** The project of the current screen (any address under /projets/:projectId). */
export function useCurrentProject(): ProjectDetail {
  const project = useContext(ProjectContext);
  if (!project) throw new Error("useCurrentProject is for a project's screens.");
  return project;
}
