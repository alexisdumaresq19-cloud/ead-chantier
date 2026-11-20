import { FileImage } from "lucide-react";
import { memo, useId, type ReactNode } from "react";

import type { Tiles } from "@/shared/plans";

import { cn } from "../../lib/cn";
import { Badge } from "../../ui";
import { highlightParts, revisionName } from "./logic";

// Small pieces the plan screens share.

/**
 * A sheet's thumbnail in a box whose size is set by the caller, so nothing
 * moves when the image arrives. Plans are drawn on white: so is the box.
 */
export function PlanThumb({
  url,
  tiles,
  className,
}: {
  url: string | null | undefined;
  tiles?: Tiles | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-line text-dim/50 flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white",
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          crossOrigin="anonymous"
          width={tiles?.width}
          height={tiles?.height}
          className="size-full object-contain"
        />
      ) : (
        <FileImage className="size-6" aria-hidden />
      )}
    </span>
  );
}

/** The revision the site sees, as a small label; nothing if it has no name. */
export function RevisionBadge({ label, className }: { label: string | null; className?: string }) {
  const name = revisionName(label);
  if (!name) return null;
  return (
    <Badge tone="blue" className={cn("max-w-32 shrink-0", className)}>
      <span className="truncate">{name}</span>
    </Badge>
  );
}

/** `text` with the words searched for set apart. */
export const Highlight = memo(function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.hit ? (
          <mark key={index} className="bg-ead/20 rounded-xs text-inherit">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
});

/** An on/off switch with its label; the whole line is the target. */
export function Switch({
  checked,
  onChange,
  disabled,
  className,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group -my-1 inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg text-sm font-semibold disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span id={labelId}>{children}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
          checked ? "bg-ead-dark" : "bg-dim/40",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}
