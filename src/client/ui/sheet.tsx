import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { IconButton } from "./button";

// A window over the screen: slides up from the bottom on a phone, sits in the
// middle on a larger screen. Built on <dialog>, so the keyboard is trapped
// inside, Escape closes it, and it always shows above everything else.

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons pinned under the content. */
  footer?: ReactNode;
  /** A wider window on large screens. */
  wide?: boolean;
};

export function Sheet({ open, onClose, title, description, children, footer, wide }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click that lands on the dialog itself is a click on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "bg-surface text-text fixed inset-x-0 top-auto bottom-0 m-0 max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl p-0 shadow-2xl outline-none",
        "backdrop:bg-ink/55 open:animate-sheet",
        "sm:open:animate-pop sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[86dvh] sm:rounded-2xl",
        wide ? "sm:max-w-2xl" : "sm:max-w-lg",
      )}
    >
      {open ? (
        <div className="flex max-h-[92dvh] flex-col sm:max-h-[86dvh]">
          <header className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-display text-xl leading-tight font-bold">
                {title}
              </h2>
              {description ? <div className="text-dim mt-1 text-sm">{description}</div> : null}
            </div>
            <IconButton label="Fermer" onClick={onClose} className="-mt-1.5 -mr-2">
              <X aria-hidden />
            </IconButton>
          </header>
          {children ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
              {children}
            </div>
          ) : null}
          {footer ? (
            <footer className="border-line flex flex-col-reverse gap-2 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              {footer}
            </footer>
          ) : (
            <div className="pb-[env(safe-area-inset-bottom)]" />
          )}
        </div>
      ) : null}
    </dialog>
  );
}
