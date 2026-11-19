import type { UseQueryResult } from "@tanstack/react-query";
import { CircleAlert, WifiOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ApiFailure, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { Spinner } from "./bits";
import { Button } from "./button";

/** What a list shows when it has nothing yet. */
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-line bg-surface/60 flex flex-col items-center rounded-2xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <span className="bg-ead-tint text-ead-dark flex size-14 items-center justify-center rounded-2xl">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="font-display mt-4 text-lg font-bold">{title}</h2>
      {text ? <p className="text-dim mt-1.5 max-w-sm text-[15px] text-pretty">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** What a screen shows when its data could not be fetched. */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const offline = error instanceof ApiFailure && error.offline;
  return (
    <EmptyState
      icon={offline ? WifiOff : CircleAlert}
      title={offline ? "Pas de réseau" : "Impossible d'afficher cette page"}
      text={
        offline
          ? "Cette page n'a pas encore été ouverte sur cet appareil. Elle s'affichera dès que le réseau reviendra."
          : errorMessage(error)
      }
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Réessayer
          </Button>
        ) : undefined
      }
      className={className}
    />
  );
}

/**
 * The three states of fetched data. What the device already holds is shown
 * even if refreshing it failed: on a site without signal, yesterday's list
 * beats an error.
 */
export function QueryState<T>({
  query,
  loading,
  children,
}: {
  query: UseQueryResult<T>;
  /** Shown while loading; a centred spinner by default. */
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return (
    <>
      {loading ?? (
        <div className="flex justify-center py-16">
          <Spinner className="size-8" />
        </div>
      )}
    </>
  );
}
