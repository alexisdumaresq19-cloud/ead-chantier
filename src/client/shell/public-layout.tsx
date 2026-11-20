import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { LogoFull } from "../ui/logo";

/**
 * The frame of the screens seen before signing in: the logo over one card.
 * `compact`: a smaller logo, so that a form and its button fit on a phone.
 */
export function PublicLayout({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <div
      className={cn(
        "bg-ink flex min-h-dvh flex-col items-center justify-center px-5",
        compact
          ? "pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          : "pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]",
      )}
    >
      <LogoFull className={compact ? "w-28" : "w-40"} />
      <main
        className={cn(
          "animate-rise bg-surface w-full max-w-sm rounded-3xl p-6 shadow-2xl",
          compact ? "mt-5" : "mt-8",
        )}
      >
        {children}
      </main>
      <p
        className={cn("text-xs font-medium tracking-wide text-white/45", compact ? "mt-4" : "mt-6")}
      >
        EAD Chantier
      </p>
    </div>
  );
}
