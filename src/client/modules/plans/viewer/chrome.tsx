import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Maximize,
  Minus,
  Plus,
  RefreshCw,
  RotateCwSquare,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "../../../lib/cn";
import { IconButton } from "../../../ui";
import type { ZoomRoom } from "./canvas";
import { revisionCode, revisionName, type SheetView } from "./sheet-view";

// What surrounds the sheet: a slim bar on top to know which sheet this is and
// to leave, the controls under the thumb, and the warnings. All of it floats
// over the plan in translucent black and slides away on a tap.

const bar = "bg-ink/85 text-white backdrop-blur-md";
const slide = "transition-transform duration-200 ease-out";

/** A round-cornered icon button for black bars. */
function BarButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <IconButton
      className={cn(
        "text-white hover:bg-white/15 hover:text-white active:bg-white/25 disabled:opacity-35",
        className,
      )}
      {...props}
    />
  );
}

/**
 * On a phone held sideways height is short: the top bar becomes one slim
 * line, number · title, so the sheet keeps the room it was turned for.
 */
export function TopBar({
  ref,
  visible,
  view,
  onBack,
  onRevisions,
}: {
  ref: Ref<HTMLElement>;
  visible: boolean;
  /** Null while the sheet is not known: only the way back is shown. */
  view: SheetView | null;
  onBack: () => void;
  onRevisions: () => void;
}) {
  const revision = view?.shown ? revisionName(view.shown) : null;
  return (
    <header
      ref={ref}
      inert={!visible}
      className={cn(
        bar,
        slide,
        "absolute inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)]",
        !visible && "-translate-y-full",
      )}
    >
      <div className="flex min-h-14 items-center gap-1 py-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))] [@media(orientation:landscape)_and_(max-height:500px)]:min-h-11 [@media(orientation:landscape)_and_(max-height:500px)]:py-0">
        <BarButton label="Retour aux plans" onClick={onBack}>
          <ChevronLeft className="size-6!" aria-hidden />
        </BarButton>
        <div className="flex min-w-0 flex-1 flex-col [@media(orientation:landscape)_and_(max-height:500px)]:flex-row [@media(orientation:landscape)_and_(max-height:500px)]:items-baseline [@media(orientation:landscape)_and_(max-height:500px)]:gap-1.5">
          {view ? (
            <>
              <h1 className="font-display shrink-0 text-[17px] leading-tight font-bold">
                {view.number}
              </h1>
              {view.title ? (
                // The end of a title (the chainage) tells two sheets apart: two
                // lines in portrait rather than an ellipsis.
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-white/75 [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 [@media(orientation:landscape)_and_(max-height:500px)]:line-clamp-1 [@media(orientation:landscape)_and_(max-height:500px)]:text-sm [@media(orientation:landscape)_and_(max-height:500px)]:before:mr-1.5 [@media(orientation:landscape)_and_(max-height:500px)]:before:content-['·']">
                  {view.title}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {view?.shown ? (
          <button
            type="button"
            onClick={onRevisions}
            aria-haspopup="dialog"
            aria-label={revision ? `${revision}, voir les révisions` : "Voir les révisions"}
            className={cn(
              "flex h-11 max-w-[40%] shrink-0 cursor-pointer items-center gap-1 rounded-xl pr-2 pl-3 text-sm font-semibold transition-colors",
              view.replaced
                ? "text-ink bg-amber-400 hover:bg-amber-300 active:bg-amber-300"
                : "bg-white/12 ring-1 ring-white/20 ring-inset hover:bg-white/20 active:bg-white/25",
            )}
          >
            <span className="truncate">{revision ?? "Révisions"}</span>
            <ChevronDown className="size-4 shrink-0 opacity-75" aria-hidden />
          </button>
        ) : null}
      </div>
    </header>
  );
}

/** An older revision is on screen: nobody should build from it without knowing. */
export function ReplacedBanner({
  ref,
  offset,
  view,
  onShowCurrent,
}: {
  ref: Ref<HTMLDivElement>;
  /** Pixels from the top of the screen: under the bar, or under the notch. */
  offset: number;
  view: SheetView;
  onShowCurrent: () => void;
}) {
  const code = view.shown ? revisionCode(view.shown) : null;
  return (
    <div
      ref={ref}
      role="alert"
      style={{ transform: `translateY(${offset}px)` }}
      className={cn(
        slide,
        "text-ink absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-amber-400 py-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.875rem,env(safe-area-inset-left))] shadow-md",
      )}
    >
      <p className="flex min-w-0 items-center gap-2 text-sm leading-tight font-bold">
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
        <span>{code ? `Rév. ${code} remplacée` : "Révision remplacée"}</span>
      </p>
      <button
        type="button"
        onClick={onShowCurrent}
        className="bg-ink hover:bg-ink/85 active:bg-ink/85 ml-auto flex h-11 shrink-0 cursor-pointer items-center rounded-xl px-3 text-sm font-semibold text-white transition-colors"
      >
        Voir celle en vigueur
      </button>
    </div>
  );
}

export function Controls({
  ref,
  visible,
  view,
  zoom,
  onPrevious,
  onNext,
  onPickSheet,
  onZoomIn,
  onZoomOut,
  onFit,
  onRotate,
}: {
  ref: Ref<HTMLDivElement>;
  visible: boolean;
  view: SheetView;
  /** What the zoom buttons may do; null when no plan is drawn. */
  zoom: ZoomRoom | null;
  onPrevious: () => void;
  onNext: () => void;
  /** Opens the list of all the sheets, to jump to any of them. */
  onPickSheet: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onRotate: () => void;
}) {
  const at = view.position;
  return (
    <div
      ref={ref}
      inert={!visible}
      className={cn(
        slide,
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center",
        !visible && "translate-y-full",
      )}
    >
      <div
        className={cn(
          bar,
          "pointer-events-auto flex w-full items-center justify-between gap-1 px-1.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] min-[400px]:px-2",
          "sm:mb-[max(1rem,env(safe-area-inset-bottom))] sm:w-auto sm:gap-3 sm:rounded-2xl sm:p-1.5 sm:shadow-lg sm:ring-1 sm:ring-white/10",
        )}
      >
        <nav aria-label="Feuilles" className="flex items-center">
          {/* Turned all day: taller and wider than the other buttons. */}
          <BarButton
            label="Feuille précédente"
            disabled={!view.previousId}
            onClick={onPrevious}
            className="h-12 w-13"
          >
            <ChevronLeft className="size-7!" aria-hidden />
          </BarButton>
          {at ? (
            <button
              type="button"
              onClick={onPickSheet}
              aria-label={`Feuille ${at.index} de ${at.total}, choisir une feuille`}
              title="Choisir une feuille"
              className={cn(
                "font-display flex h-12 min-w-14 cursor-pointer items-center justify-center gap-1 rounded-xl bg-white/10 text-center font-bold whitespace-nowrap tabular-nums transition-colors hover:bg-white/20 active:bg-white/20",
                // A set of a hundred sheets and more still fits a 360 px phone.
                at.total > 99 ? "px-2 text-[13px] sm:text-[15px]" : "px-2.5 text-[15px]",
              )}
            >
              {at.index} / {at.total}
              <ChevronsUpDown className="size-4 text-white/60" aria-hidden />
            </button>
          ) : null}
          <BarButton
            label="Feuille suivante"
            disabled={!view.nextId}
            onClick={onNext}
            className="h-12 w-13"
          >
            <ChevronRight className="size-7!" aria-hidden />
          </BarButton>
        </nav>
        <span className="hidden h-7 w-px bg-white/15 sm:block" aria-hidden />
        <div
          role="group"
          aria-label="Affichage"
          className="flex items-center gap-0.5 min-[400px]:gap-1"
        >
          {/* Short of room on the narrowest phones: pinching and "whole
              sheet" already zoom out. */}
          <BarButton
            label="Réduire"
            disabled={!zoom?.out}
            onClick={onZoomOut}
            className="max-[379px]:hidden"
          >
            <Minus aria-hidden />
          </BarButton>
          <BarButton label="Agrandir" disabled={!zoom?.in} onClick={onZoomIn}>
            <Plus aria-hidden />
          </BarButton>
          <BarButton label="Voir toute la feuille" disabled={!zoom?.out} onClick={onFit}>
            <Maximize aria-hidden />
          </BarButton>
          <BarButton label="Tourner d'un quart de tour" disabled={!zoom} onClick={onRotate}>
            <RotateCwSquare aria-hidden />
          </BarButton>
        </div>
      </div>
    </div>
  );
}

/** Said over the plan when its tiles could not all be fetched. */
export function TileNotice({
  offset,
  missing,
  online,
  onRetry,
}: {
  /** Pixels from the bottom of the screen: above the controls. */
  offset: number;
  /** Nothing sharp could be drawn at all (some of it could, otherwise). */
  missing: boolean;
  online: boolean;
  onRetry: () => void;
}) {
  let title: string;
  let text: string | null = null;
  if (missing) {
    title = online ? "Le plan n'a pas pu être chargé" : "Ce plan n'est pas encore sur cet appareil";
    text = online
      ? "Le réseau est peut-être trop faible ici. Réessayez dans un instant."
      : "Il s'affichera dès que le réseau reviendra.";
  } else {
    title = online
      ? "Des détails n'ont pas pu être chargés"
      : "Hors ligne\u00a0: les détails de ce plan ne sont pas sur cet appareil";
  }
  return (
    <div
      style={{ transform: `translateY(-${offset}px)` }}
      className={cn(
        slide,
        "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-3",
      )}
    >
      <div
        role="status"
        // On a narrow phone the button goes under the words rather than squeeze them.
        className="bg-surface text-text animate-rise pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-0.5 rounded-2xl py-2.5 pr-2.5 pl-3.5 shadow-xl"
      >
        <WifiOff className="text-warn size-5 shrink-0" aria-hidden />
        <div className="min-w-48 flex-1">
          <p className="text-sm leading-snug font-semibold">{title}</p>
          {text ? <p className="text-dim mt-0.5 text-sm leading-snug">{text}</p> : null}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-ead-dark hover:bg-ead-tint active:bg-ead-tint ml-auto flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors"
        >
          <RefreshCw className="size-4" aria-hidden />
          Réessayer
        </button>
      </div>
    </div>
  );
}

/** A white card in the middle of the screen, for when there is no plan to draw. */
export function Message({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto px-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="animate-fade w-full max-w-sm">{children}</div>
    </div>
  );
}

/** How the building blocks for lists look when they stand alone on the dark screen. */
export const messageCard = "border-0 bg-surface text-text shadow-xl";
