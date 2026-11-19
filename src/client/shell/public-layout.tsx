import type { ReactNode } from "react";

import { LogoFull } from "../ui/logo";

/** The frame of the screens seen before signing in: the logo over one card. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-ink flex min-h-dvh flex-col items-center justify-center px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <LogoFull className="w-40" />
      <main className="animate-rise bg-surface mt-8 w-full max-w-sm rounded-3xl p-6 shadow-2xl">
        {children}
      </main>
      <p className="mt-6 text-xs font-medium tracking-wide text-white/45">EAD Chantier</p>
    </div>
  );
}
