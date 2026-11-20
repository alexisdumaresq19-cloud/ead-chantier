import { RefreshCw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ProjectSummary } from "@/shared/api";

import { cn } from "../lib/cn";
import { useAppLocation } from "../lib/location";
import { queryClient } from "../lib/query";
import { keys } from "../lib/session";
import { Button, IconButton } from "../ui";
import { forgetKeptProjects, forgetProjectsNotIn } from "./kept";
import { applyUpdate, dismissUpdate, useUpdateAvailable } from "./update";

/** Rendered once at the root: what the offline module shows over any screen. */
export function PwaHost() {
  useForgetOnSignOut();
  useForgetLostProjects();
  return <UpdateBar />;
}

/** Signing in, the diagnostic and a sheet in full screen are drawn without the frame, so without its tabs. */
const WITHOUT_TABS = /^\/(bienvenue|demarrer|inscription|diagnostic|[ij]\/)|\/feuilles\//;

/**
 * "A new version is ready", just above the tabs. It only offers: reloading
 * under someone reading a plan would lose their place.
 */
function UpdateBar() {
  const available = useUpdateAvailable();
  const [path] = useAppLocation();
  const [updating, setUpdating] = useState(false);
  if (!available) return null;
  return (
    <div
      className={cn(
        "no-print pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3",
        WITHOUT_TABS.test(path)
          ? "bottom-[max(1rem,env(safe-area-inset-bottom))]"
          : "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-64",
      )}
    >
      <div
        role="status"
        className="animate-rise bg-ink pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl py-1.5 pr-1.5 pl-4 text-white shadow-xl ring-1 ring-white/10"
      >
        <RefreshCw className="text-ead hidden size-5 shrink-0 min-[390px]:block" aria-hidden />
        <p className="min-w-0 flex-1 text-sm leading-tight font-semibold min-[390px]:text-[15px]">
          Nouvelle version disponible
        </p>
        <Button
          variant="secondary"
          loading={updating}
          onClick={() => {
            setUpdating(true);
            void applyUpdate();
          }}
          className="border-transparent"
        >
          Mettre à jour
        </Button>
        <IconButton
          label="Plus tard"
          onClick={dismissUpdate}
          className="text-white/70 hover:bg-white/10 hover:text-white active:bg-white/10"
        >
          <X aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * A device that is signed out keeps no project: its plans leave with the
 * session, whether the person signed out or the office ended it.
 */
function useForgetOnSignOut() {
  // Read from the stored data as the screens fill it: asking the server from
  // here would add a request to pages that do not need one.
  const signedOut = useSyncExternalStore(
    (listener) => queryClient.getQueryCache().subscribe(listener),
    () => queryClient.getQueryData(keys.me) === null,
    () => false,
  );
  useEffect(() => {
    if (signedOut) void forgetKeptProjects();
  }, [signedOut]);
}

/**
 * A project this person can no longer open (removed from its team, or the
 * project deleted) leaves the device too: its card, the only place to remove
 * it by hand, is out of reach.
 */
function useForgetLostProjects() {
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        // Only a list the server has just sent: a stored one may be out of date.
        if (event.type !== "updated" || event.action.type !== "success" || event.action.manual)
          return;
        const { queryKey, state } = event.query;
        if (queryKey.length !== 1 || queryKey[0] !== keys.projects[0]) return;
        const projects = state.data as ProjectSummary[];
        void forgetProjectsNotIn(projects.map((project) => project.id));
      }),
    [],
  );
}
