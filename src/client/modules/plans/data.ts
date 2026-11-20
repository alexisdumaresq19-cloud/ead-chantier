import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type {
  PlanFolder,
  PlanImportDetail,
  PlanImportSummary,
  Plans,
  SheetDetail,
} from "@/shared/plans";
import { mayEditPlans } from "@/shared/demo";

import { api } from "../../lib/api";
import { keys, useCurrentProject, useCurrentUser } from "../../lib/session";
import { mayChangePlans } from "./logic";

// The plans of a project as the screens read and change them. Every change
// refreshes the whole project, so the list, the counts and the viewer follow.

export const planPaths = {
  list: (projectId: string) => `/projets/${projectId}/plans`,
  import: (projectId: string, importId: string) => `/projets/${projectId}/plans/import/${importId}`,
  sheet: (projectId: string, sheetId: string, revisionId?: string) =>
    `/projets/${projectId}/feuilles/${sheetId}${revisionId ? `?rev=${revisionId}` : ""}`,
};

export const planKeys = {
  imports: (projectId: string) => [...keys.project(projectId), "plan-imports"] as const,
  import: (projectId: string, importId: string) =>
    [...keys.project(projectId), "plan-imports", importId] as const,
  search: (projectId: string, words: string) =>
    [...keys.project(projectId), "plan-search", words] as const,
};

/**
 * Whether this person sees the controls that add and change plans, inside a
 * project. The demonstration account reads the plans and never changes them.
 */
export function useCanChangePlans(): boolean {
  const me = useCurrentUser();
  return mayChangePlans(useCurrentProject(), me.role) && mayEditPlans(me);
}

export const usePlans = (projectId: string) =>
  useQuery({
    queryKey: keys.plans(projectId),
    queryFn: () => api<Plans>(`/api/projects/${projectId}/plans`),
  });

const fetchSheet = (sheetId: string) => api<SheetDetail>(`/api/sheets/${sheetId}`);

export const useSheet = (projectId: string, sheetId: string) =>
  useQuery({ queryKey: keys.sheet(projectId, sheetId), queryFn: () => fetchSheet(sheetId) });

/** Fetches a sheet as soon as a finger lands on it, so the viewer opens with it. */
export function warmSheet(client: QueryClient, projectId: string, sheetId: string) {
  void client.prefetchQuery({
    queryKey: keys.sheet(projectId, sheetId),
    queryFn: () => fetchSheet(sheetId),
  });
}

const converting = (status: PlanImportSummary["status"]) =>
  status === "reading" || status === "processing";

/**
 * The imports not yet published, for those who manage the project. Asked
 * again every two seconds while one is converting: that shows its progress
 * and, on the server, keeps the conversion going.
 */
export const usePendingImports = (projectId: string, enabled: boolean) =>
  useQuery({
    queryKey: planKeys.imports(projectId),
    queryFn: () => api<PlanImportSummary[]>(`/api/projects/${projectId}/plan-imports`),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((current) => converting(current.status)) ? 2000 : false,
    // Work in progress at the office: of no use offline, and soon out of date.
    meta: { persist: false },
  });

export const usePlanImport = (projectId: string, importId: string, enabled: boolean) =>
  useQuery({
    queryKey: planKeys.import(projectId, importId),
    queryFn: () => api<PlanImportDetail>(`/api/plan-imports/${importId}`),
    enabled,
    refetchInterval: (query) =>
      query.state.data && converting(query.state.data.status) ? 1500 : false,
    // Never shown from memory: an import changes under the office's hands,
    // and may be published or cancelled by the time its page is opened again.
    gcTime: 0,
    meta: { persist: false },
  });

/** Refreshes everything fetched for the project; resolves once the screen is up to date. */
export const refreshProject = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: keys.project(projectId) });

// A mutation ends when the project has been fetched again, so a window that
// closes on success closes over a list that already shows the change.

export function useUpdateSheet(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sheetId,
      ...changes
    }: {
      sheetId: string;
      number?: string;
      title?: string;
      folderId?: string | null;
    }) => api<SheetDetail>(`/api/sheets/${sheetId}`, { method: "PATCH", body: changes }),
    onSuccess: () => refreshProject(client, projectId),
  });
}

export function useArchiveSheet(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sheetId: string) => api(`/api/sheets/${sheetId}`, { method: "DELETE" }),
    onSuccess: () => refreshProject(client, projectId),
  });
}

export function useSetCurrentRevision(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sheetId, revisionId }: { sheetId: string; revisionId: string }) =>
      api<SheetDetail>(`/api/sheets/${sheetId}/current`, { method: "POST", body: { revisionId } }),
    onSuccess: (sheet, { sheetId }) => {
      client.setQueryData(keys.sheet(projectId, sheetId), sheet);
      return refreshProject(client, projectId);
    },
  });
}

export function useCreateFolder(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<PlanFolder>(`/api/projects/${projectId}/plan-folders`, {
        method: "POST",
        body: { name },
      }),
    onSuccess: () => refreshProject(client, projectId),
  });
}

export function useRenameFolder(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api(`/api/plan-folders/${folderId}`, { method: "PATCH", body: { name } }),
    onSuccess: () => refreshProject(client, projectId),
  });
}

export function useDeleteFolder(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => api(`/api/plan-folders/${folderId}`, { method: "DELETE" }),
    onSuccess: () => refreshProject(client, projectId),
  });
}
