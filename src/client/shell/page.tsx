import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";

import { cn } from "../lib/cn";

/**
 * A screen's content: an optional way back, the title, its buttons, then the
 * rest. Every screen inside the frame starts with one.
 */
export function Page({
  title,
  subtitle,
  back,
  actions,
  narrow,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** A link back to the screen above, e.g. { href: "/projets/abc/plans", label: "Plans" }. */
  back?: { href: string; label: string };
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  /** A narrow column, for forms. */
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "animate-fade mx-auto w-full px-4 pt-4 pb-8 sm:px-6 lg:px-10 lg:pt-8",
        narrow ? "max-w-2xl" : "max-w-6xl",
      )}
    >
      {back ? (
        <Link
          href={back.href}
          className="no-print text-ead-dark hover:bg-ead-tint mb-1 -ml-1.5 inline-flex h-11 items-center gap-0.5 rounded-lg pr-2 text-sm font-semibold"
        >
          <ChevronLeft className="size-5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] leading-tight font-bold tracking-tight text-balance lg:text-3xl">
            {title}
          </h1>
          {subtitle ? <div className="text-dim mt-1 text-[15px]">{subtitle}</div> : null}
        </div>
        {actions ? (
          <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/** A titled group of content inside a page. */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-dim text-sm font-bold tracking-wider uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
