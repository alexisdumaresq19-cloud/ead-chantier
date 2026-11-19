import { LoaderCircle } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";
import { initials } from "../lib/format";

/** A white panel. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-line bg-surface rounded-2xl border shadow-xs", className)}
      {...props}
    />
  );
}

export type Tone = "neutral" | "blue" | "good" | "warn" | "bad";

const tones: Record<Tone, string> = {
  neutral: "bg-canvas text-dim ring-line",
  blue: "bg-ead-tint text-ead-dark ring-ead/25",
  good: "bg-good-tint text-good ring-good/20",
  warn: "bg-warn-tint text-warn ring-warn/25",
  bad: "bg-bad-tint text-bad ring-bad/20",
};

/** A small label: a state, a count, a revision. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A person, as their initials. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-ead-tint font-display text-ead-dark inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner({
  className,
  label = "Chargement",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <LoaderCircle className={cn("text-ead size-6 animate-spin", className)} aria-hidden />
    </span>
  );
}

/** A grey block in place of content that is on its way. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-line/70 animate-pulse rounded-xl", className)} />;
}

/** Progress from 0 to 1. Without a value, it shows that something is going on. */
export function ProgressBar({
  value,
  className,
  label,
}: {
  value?: number;
  className?: string;
  label?: string;
}) {
  const percent =
    value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("bg-line h-2 overflow-hidden rounded-full", className)}
    >
      <div
        className={cn(
          "bg-ead h-full rounded-full transition-[width] duration-300",
          percent === undefined && "w-1/3 animate-pulse",
        )}
        style={percent === undefined ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
