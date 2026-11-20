import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * A bar stuck to the bottom of the screen, so the main action stays under the
 * thumb. It sits on the phone's tabs when they show, and on the bottom edge
 * when the frame hides them: the frame says where the tabs end in --ead-tabs
 * on <html> ("0px" without tabs or on a computer); until it does, the tabs'
 * own height is assumed. Without tabs under it, the bar keeps clear of the
 * iPhone's home bar itself.
 */
export function BottomBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "from-canvas sticky z-20 -mx-4 bg-linear-to-t from-60% to-transparent px-4 pt-3 sm:-mx-6 sm:px-6",
        "bottom-[var(--ead-tabs,calc(4rem+1px+env(safe-area-inset-bottom)))]",
        "pb-[max(0.5rem,calc(env(safe-area-inset-bottom)-var(--ead-tabs,calc(4rem+1px+env(safe-area-inset-bottom)))))]",
        "lg:bottom-0 lg:pb-4",
        className,
      )}
    >
      <div className="border-line bg-surface/95 flex items-center gap-3 rounded-2xl border p-2.5 shadow-lg backdrop-blur">
        {children}
      </div>
    </div>
  );
}
