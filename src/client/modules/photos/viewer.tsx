import { useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Pencil,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { PHOTO_CAPTION_MAX, type Photo } from "@/shared/photos";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { queryClient } from "../../lib/query";
import { isNativeApp } from "../../native";
import { Button, confirmAction, FormError, Sheet, Spinner, Textarea, toast } from "../../ui";
import { photoChanged, photoKeys, photoRemoved, refreshProject, usePhoto } from "./data";
import { takenLabel } from "./logic";
import {
  AT_REST,
  clampView,
  fitInside,
  swipeTurn,
  TAP_ZOOM,
  zoomAround,
  type Size,
  type View,
} from "./zoom";

// A photo in large, over the page: drag or use the arrows for the next and
// previous ones, pinch or double-tap to look closely, drag down to close.

/** Black between two photos while one slides in after the other. */
const GAP = 24;
/** The bars and buttons step aside while a photo is enlarged or dragged down. */
const ASIDE =
  "group-data-zoomed/viewer:pointer-events-none group-data-zoomed/viewer:opacity-0 group-data-dragging/viewer:opacity-0";

type Props = {
  projectId: string;
  photoId: string;
  /** The photos to go through, in the order of the grid. */
  photos: Photo[];
  /** How many there are in all (the list may not be loaded to its end). */
  total: number | undefined;
  today: string;
  hasMore: boolean;
  loadMore: () => unknown;
  /** Another photo is shown. */
  onShow: (id: string) => void;
  onClose: () => void;
};

/** Rendered at the end of the page, above the app's bars. */
export function PhotoViewer(props: Props) {
  return createPortal(<Viewer {...props} />, document.body);
}

function Viewer({
  projectId,
  photoId,
  photos,
  total,
  today,
  hasMore,
  loadMore,
  onShow,
  onClose,
}: Props) {
  const index = photos.findIndex((p) => p.id === photoId);
  // Not in the lists on the device (opened by its address, or just removed
  // by someone): the server says whether it still exists.
  const lone = usePhoto(projectId, photoId, index < 0);
  const photo = index >= 0 ? photos[index] : lone.isError ? undefined : lone.data;
  const previous = index > 0 ? photos[index - 1] : undefined;
  const next = index >= 0 ? photos[index + 1] : undefined;

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  const [screen, setScreen] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [bars, setBars] = useState(true);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [failedId, setFailedId] = useState<string | null>(null);
  const isLoaded = photo ? loaded.has(photo.id) : false;
  const onLoaded = useCallback(
    (id: string) => setLoaded((ids) => (ids.has(id) ? ids : new Set(ids).add(id))),
    [],
  );
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setScreen({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The end of what is loaded comes near: fetch the next photos.
  useEffect(() => {
    if (hasMore && index >= 0 && index >= photos.length - 4) loadMore();
  }, [hasMore, index, photos.length, loadMore]);

  const turn = useGestures({
    key: photo?.id ?? "",
    root,
    stage,
    track,
    frame,
    backdrop,
    drawn: photo ? fitInside(photo, screen) : { width: 0, height: 0 },
    screen,
    canPrevious: Boolean(previous),
    canNext: Boolean(next),
    onTurn: (direction) => {
      const target = direction === 1 ? next : previous;
      if (target) onShow(target.id);
    },
    onClose,
    onTap: () => setBars((shown) => !shown),
  });

  // Back in the grid, at the photo that was last looked at: the page has not
  // moved, unless that photo is now out of sight.
  const returnToGrid = useEffectEvent(() => {
    const tile = document.getElementById(`photo-${photoId}`);
    if (!tile) return;
    tile.focus({ preventScroll: true });
    const box = tile.getBoundingClientRect();
    if (box.top < 72 || box.bottom > window.innerHeight - 150)
      tile.scrollIntoView({ block: "center" });
  });
  // The page behind stays where it is, and the keyboard stays in here.
  useEffect(() => {
    const page = document.documentElement;
    const overflow = page.style.overflow;
    page.style.overflow = "hidden";
    root.current?.focus({ preventScroll: true });
    return () => {
      page.style.overflow = overflow;
      returnToGrid();
    };
  }, []);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // A sheet is open over the photo (its description, a confirmation).
    if (document.querySelector("dialog[open]")) return;
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowRight") turn(1);
    else if (event.key === "ArrowLeft") turn(-1);
    else if (event.key === "Tab" && root.current) {
      const stops = [...root.current.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter(
        (element) => element.offsetParent !== null,
      );
      if (!stops.length) return;
      // The buttons may have been tapped away.
      setBars(true);
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const to = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
      stops[to].focus();
    } else return;
    event.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const remove = useMutation({
    mutationFn: (target: Photo) =>
      api(`/api/photos/${target.id}`, { method: "DELETE" }).catch((error) => {
        // Someone else removed it first: the result is the same.
        if (!(error instanceof ApiFailure && error.status === 404)) throw error;
      }),
    onSuccess: (_, target) => {
      photoRemoved(projectId, target);
      toast.success("Photo supprimée.");
      void refreshProject(projectId);
      // Unless the person has moved on meanwhile: on to its neighbour, or
      // back to the grid after the last one.
      if (photoId !== target.id) return;
      const after = next ?? previous;
      if (after) onShow(after.id);
      else onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function askRemove() {
    if (!photo) return;
    const sure = await confirmAction({
      title: "Supprimer cette photo ?",
      text: "Elle sera retirée du projet pour toute l'équipe. C'est définitif.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (sure) remove.mutate(photo);
  }

  const sharing = useSharing(photo, isLoaded);

  const hidden = "pointer-events-none opacity-0";
  const position = index >= 0 ? `${index + 1} / ${Math.max(total ?? 0, photos.length)}` : null;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Photo en grand"
      tabIndex={-1}
      className="group/viewer animate-fade fixed inset-0 z-50 touch-none overflow-hidden text-white outline-none select-none"
    >
      <div ref={backdrop} className="absolute inset-0 bg-black" />

      {photo ? (
        <div ref={stage} className="absolute inset-0">
          <div ref={track} className="absolute inset-0 will-change-transform">
            {previous ? (
              <Slide key={previous.id} photo={previous} offset={-1} screen={screen} />
            ) : null}
            <Slide
              key={photo.id}
              photo={photo}
              offset={0}
              screen={screen}
              frame={frame}
              full
              attempt={attempt}
              onLoaded={onLoaded}
              onFailed={(id) => {
                setFailedId(id);
                // If it failed because the photo was removed, the list will say so.
                void queryClient.invalidateQueries({ queryKey: photoKeys.lists(projectId) });
              }}
            />
            {next ? (
              <Slide
                key={next.id}
                photo={next}
                offset={1}
                screen={screen}
                // Ready before the person asks for it, once this one is in.
                full={isLoaded}
                onLoaded={onLoaded}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <Missing
          error={lone.isError ? lone.error : null}
          // Waiting for a network that is not there: say so rather than spin.
          paused={lone.isPaused}
          onRetry={() => lone.refetch()}
          onClose={onClose}
        />
      )}

      <header
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-linear-to-b from-black/70 to-transparent px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-10 transition-opacity duration-200",
          ASIDE,
          !bars && hidden,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-white/15 pr-4 pl-3 text-[15px] font-semibold backdrop-blur-sm transition-colors hover:bg-white/25"
        >
          <X className="size-5" aria-hidden /> Fermer
        </button>
        {photo && position ? (
          <p className="pr-2 text-sm font-semibold text-white/85 tabular-nums">{position}</p>
        ) : null}
      </header>

      {photo ? (
        <>
          {failedId === photo.id && !isLoaded ? (
            <div className="absolute inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] flex justify-center px-4">
              <p className="flex items-center gap-3 rounded-xl bg-black/75 py-1.5 pr-1.5 pl-4 text-sm backdrop-blur-sm">
                L&apos;image n&apos;a pas pu être chargée en entier.
                <button
                  type="button"
                  onClick={() => {
                    setFailedId(null);
                    setAttempt((n) => n + 1);
                  }}
                  className="h-11 cursor-pointer rounded-lg bg-white/20 px-3.5 font-semibold hover:bg-white/30"
                >
                  Réessayer
                </button>
              </p>
            </div>
          ) : null}

          {[
            { direction: -1 as const, to: previous, label: "Photo précédente", Icon: ChevronLeft },
            { direction: 1 as const, to: next, label: "Photo suivante", Icon: ChevronRight },
          ].map(({ direction, to, label, Icon }) =>
            to ? (
              <button
                key={direction}
                type="button"
                aria-label={label}
                title={label}
                onClick={() => turn(direction)}
                className={cn(
                  "absolute top-1/2 hidden size-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/45 backdrop-blur-sm transition hover:bg-black/70 sm:flex",
                  direction === 1 ? "right-4" : "left-4",
                  ASIDE,
                  !bars && hidden,
                )}
              >
                <Icon className="size-7" aria-hidden />
              </button>
            ) : null,
          )}

          <footer
            className={cn(
              "absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/60 to-transparent px-4 pt-12 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-200",
              ASIDE,
              !bars && hidden,
            )}
          >
            {/* On a phone the buttons sit under the text, within reach of the thumb. */}
            <div className="sm:flex sm:items-end sm:justify-between sm:gap-8 sm:px-2">
              <div className="min-w-0 sm:max-w-2xl sm:pb-0.5">
                {photo.caption ? (
                  <p className="max-h-[26dvh] touch-pan-y overflow-y-auto overscroll-contain text-[15px] leading-snug whitespace-pre-line select-text sm:text-base">
                    {photo.caption}
                  </p>
                ) : photo.canEdit ? (
                  // A site photo without a word is hard to use later: an invitation, in passing.
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="-my-2.5 inline-flex min-h-11 cursor-pointer items-center text-[15px] text-white/60 italic transition-colors hover:text-white/85"
                  >
                    Ajouter une description…
                  </button>
                ) : null}
                <p className="mt-1.5 text-sm text-white/75">
                  {photo.authorName ?? "Auteur inconnu"} · {takenLabel(photo, today)}
                </p>
              </div>
              {/* The harmless actions first; removing, in red, last. */}
              <div className="mt-3 flex shrink-0 gap-2 sm:mt-0">
                {photo.canEdit ? (
                  <ViewerButton onClick={() => setEditing(true)}>
                    <Pencil aria-hidden /> Description
                  </ViewerButton>
                ) : null}
                <ViewerButton loading={sharing.busy} onClick={sharing.run}>
                  {sharing.native ? <Share2 aria-hidden /> : <Download aria-hidden />}
                  {sharing.native ? "Partager" : "Télécharger"}
                </ViewerButton>
                {photo.canEdit ? (
                  <ViewerButton
                    loading={remove.isPending}
                    onClick={askRemove}
                    // The app's red, lifted enough to read on black.
                    className="text-[color-mix(in_oklab,var(--color-bad),white_38%)]"
                  >
                    <Trash2 aria-hidden /> Supprimer
                  </ViewerButton>
                ) : null}
              </div>
            </div>
          </footer>

          <CaptionSheet
            key={photo.id}
            projectId={projectId}
            photo={photo}
            open={editing}
            onClose={() => setEditing(false)}
          />
        </>
      ) : null}
    </div>
  );
}

/** One photo of the row of three: the one shown and its neighbours on either side. */
function Slide({
  photo,
  offset,
  screen,
  frame,
  full = false,
  attempt = 0,
  onLoaded,
  onFailed,
}: {
  photo: Photo;
  offset: -1 | 0 | 1;
  screen: Size;
  frame?: RefObject<HTMLDivElement | null>;
  /** Load the full image (the thumbnail, already on the device, shows meanwhile). */
  full?: boolean;
  attempt?: number;
  onLoaded?: (id: string) => void;
  onFailed?: (id: string) => void;
}) {
  const drawn = fitInside(photo, screen);
  // Once asked for, the full image stays, so that coming back to it is instant.
  const [wanted, setWanted] = useState(full);
  if (full && !wanted) setWanted(true);
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      aria-hidden={offset !== 0}
      className="absolute inset-0 flex items-center justify-center"
      style={{ transform: `translate3d(calc(${offset} * (100% + ${GAP}px)), 0, 0)` }}
    >
      <div
        ref={frame}
        className="relative shrink-0 will-change-transform"
        style={{ width: drawn.width, height: drawn.height }}
      >
        <img
          src={photo.thumbUrl}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
          // Not on the device and no network: black is better than a broken image.
          onError={(event) => (event.currentTarget.hidden = true)}
          className="absolute inset-0 size-full"
        />
        {wanted ? (
          <img
            key={attempt}
            src={photo.url}
            alt={photo.caption ?? "Photo du chantier"}
            crossOrigin="anonymous"
            decoding="async"
            draggable={false}
            onLoad={() => {
              setLoaded(true);
              onLoaded?.(photo.id);
            }}
            onError={() => onFailed?.(photo.id)}
            className={cn(
              "absolute inset-0 size-full transition-opacity duration-200",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

/** In place of a photo that cannot be shown. */
function Missing({
  error,
  paused,
  onRetry,
  onClose,
}: {
  error: unknown;
  paused: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  if (!error && !paused)
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Spinner className="size-9 text-white" />
      </div>
    );
  const gone = error instanceof ApiFailure && error.status === 404;
  const offline = paused || (error instanceof ApiFailure && error.offline);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <ImageOff className="size-12 text-white/60" aria-hidden />
      <h2 className="font-display mt-4 text-xl font-bold">
        {gone ? "Cette photo n'existe plus" : offline ? "Pas de réseau" : "Photo indisponible"}
      </h2>
      <p className="mt-1.5 max-w-sm text-[15px] text-white/75">
        {gone
          ? "Elle a été supprimée."
          : offline
            ? "Cette photo n'est pas sur cet appareil. Elle s'affichera quand le réseau reviendra."
            : errorMessage(error)}
      </p>
      <div className="mt-6 flex gap-2">
        {gone ? null : (
          <ViewerButton onClick={onRetry} className="h-12 flex-none px-5 text-[15px]">
            Réessayer
          </ViewerButton>
        )}
        <ViewerButton onClick={onClose} className="h-12 flex-none px-5 text-[15px]">
          Revenir aux photos
        </ViewerButton>
      </div>
    </div>
  );
}

/** A button on the black of the viewer. Stacked on a phone, so that three fit side by side. */
function ViewerButton({
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-14 min-w-24 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl bg-white/15 px-3 text-[13px] font-semibold whitespace-nowrap backdrop-blur-sm transition-colors hover:bg-white/25 active:bg-white/25 disabled:opacity-60 sm:h-11 sm:flex-none sm:flex-row sm:gap-2 sm:px-4 sm:text-[15px] [&_svg]:size-5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function CaptionSheet({
  projectId,
  photo,
  open,
  onClose,
}: {
  projectId: string;
  photo: Photo;
  open: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState(photo.caption ?? "");
  const save = useMutation({
    mutationFn: () =>
      api<Photo>(`/api/photos/${photo.id}`, {
        method: "PATCH",
        body: { caption: text.trim() || null },
      }),
    onSuccess: (updated) => {
      photoChanged(projectId, updated);
      toast.success(updated.caption ? "Description enregistrée." : "Description retirée.");
      void refreshProject(projectId);
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiFailure && error.status === 404)) return;
      // Removed by someone else while it was being described.
      toast.error("Cette photo vient d'être supprimée.");
      void refreshProject(projectId);
      onClose();
    },
  });
  const close = () => {
    save.reset();
    setText(photo.caption ?? "");
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Description de la photo"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Annuler
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3 select-text">
        <Textarea
          // The person came here to type.
          data-autofocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={PHOTO_CAPTION_MAX}
          rows={4}
          aria-label="Description"
          placeholder="Ce que la photo montre : où, quoi, pourquoi."
        />
        <FormError>{save.isError ? errorMessage(save.error) : null}</FormError>
      </div>
    </Sheet>
  );
}

// --- Sharing ---------------------------------------------------------------------

/** A phone that can hand an image to its other apps (messages, email…). */
function canShareImages() {
  // The iPhone app has the share sheet, which also saves to Photos.
  if (isNativeApp()) return true;
  try {
    return (
      window.matchMedia("(pointer: coarse)").matches &&
      typeof navigator.share === "function" &&
      navigator.canShare?.({ files: [new File([""], "photo.jpg", { type: "image/jpeg" })] }) ===
        true
    );
  } catch {
    return false;
  }
}

const fetchImage = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`image ${response.status}`);
  return response.blob();
};

/**
 * Sharing the photo where the device can, downloading it elsewhere. Phones
 * only open their share sheet straight from a tap, so the image is fetched
 * as soon as it is displayed (from the browser's cache) and is ready by then.
 */
function useSharing(photo: Photo | undefined, displayed: boolean) {
  const [native] = useState(canShareImages);
  const [busy, setBusy] = useState(false);
  const held = useRef<{ id: string; blob: Blob } | null>(null);
  const id = photo?.id;
  const url = photo?.url;

  useEffect(() => {
    if (!native || !displayed || !id || !url) return;
    let current = true;
    fetchImage(url)
      .then((blob) => {
        if (current) held.current = { id, blob };
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [native, displayed, id, url]);

  async function run() {
    if (!photo) return;
    const name = `photo-${photo.day}-${photo.id.slice(0, 6)}.jpg`;
    setBusy(true);
    try {
      const blob = held.current?.id === photo.id ? held.current.blob : await fetchImage(photo.url);
      const file = new File([blob], name, { type: "image/jpeg" });
      if (isNativeApp()) {
        // The image is in hand: what fails from here is the sheet, never the network.
        try {
          const { shareFile } = await import("../../native/files");
          await shareFile(file, { text: photo.caption ?? undefined });
        } catch {
          toast.error("Le partage n'a pas abouti. Réessayez.");
        }
        return;
      }
      if (native && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: photo.caption ?? undefined });
          return;
        } catch (error) {
          // Closed without sharing: nothing more to do.
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    } catch {
      toast.error("L'image n'a pas pu être récupérée. Vérifiez le réseau, puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return { native, busy, run };
}

// --- Gestures --------------------------------------------------------------------

type Point = { x: number; y: number };

/**
 * Fingers and mouse on the photo. Everything is applied straight to the
 * elements while a gesture lasts (a render per movement would stutter); the
 * app only hears about the outcome: another photo, closing, a tap.
 * Returns what the arrows and the keyboard call to turn to a neighbour.
 */
function useGestures(options: {
  /** The photo shown: gestures start afresh with each. */
  key: string;
  root: RefObject<HTMLDivElement | null>;
  stage: RefObject<HTMLDivElement | null>;
  track: RefObject<HTMLDivElement | null>;
  frame: RefObject<HTMLDivElement | null>;
  backdrop: RefObject<HTMLDivElement | null>;
  drawn: Size;
  screen: Size;
  canPrevious: boolean;
  canNext: boolean;
  onTurn: (direction: 1 | -1) => void;
  onClose: () => void;
  onTap: () => void;
}) {
  const { key, root, stage, track, frame, backdrop, canPrevious, canNext } = options;
  const { width, height } = options.drawn;
  const { width: screenWidth, height: screenHeight } = options.screen;
  const onTurn = useEffectEvent(options.onTurn);
  const onClose = useEffectEvent(options.onClose);
  const onTap = useEffectEvent(options.onTap);
  const turner = useRef<(direction: 1 | -1) => void>(null);

  useLayoutEffect(() => {
    const rootElement = root.current;
    const stageElement = stage.current;
    const trackElement = track.current;
    const backdropElement = backdrop.current;
    if (!rootElement || !stageElement || !trackElement || !backdropElement) return;
    const frameElement = frame.current;
    const drawn = { width, height };
    const screen = { width: screenWidth, height: screenHeight };

    let view: View = AT_REST;
    let mode: "idle" | "undecided" | "swipe" | "pan" | "pinch" | "dismiss" = "idle";
    let turning = false;
    const pointers = new Map<number, Point>();
    let start = { x: 0, y: 0 };
    let origin = view;
    let pinch = { distance: 1, middle: { x: 0, y: 0 } };
    let travelled = 0;
    let speed = { x: 0, at: 0, value: 0 };
    let lastTap = 0;
    let byMouse = false;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    let turnTimer: ReturnType<typeof setTimeout> | undefined;

    /** Measured from the middle of the screen, like the photo's position. */
    const fromCentre = (x: number, y: number): Point => {
      const box = stageElement.getBoundingClientRect();
      return { x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 };
    };
    const draw = (next: View, animated = false) => {
      view = next;
      if (!frameElement) return;
      frameElement.style.transition = animated ? "transform 200ms ease-out" : "none";
      frameElement.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      // Looking closely: the buttons get out of the way.
      if (next.scale > 1) rootElement.dataset.zoomed = "";
      else delete rootElement.dataset.zoomed;
    };
    const slide = (x: number, y: number, animated = false) => {
      trackElement.style.transition = animated
        ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)"
        : "none";
      trackElement.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const dim = (y: number, animated = false) => {
      backdropElement.style.transition = animated ? "opacity 200ms ease-out" : "none";
      backdropElement.style.opacity = String(1 - Math.min(0.75, y / 400));
      if (y > 0) rootElement.dataset.dragging = "";
      else delete rootElement.dataset.dragging;
    };

    // A new photo is in the middle: everything back in place before it is painted.
    draw(AT_REST);
    slide(0, 0);
    dim(0);

    const turn = (direction: 1 | -1) => {
      if (turning) return;
      if (direction === 1 ? !canNext : !canPrevious) return slide(0, 0, true);
      turning = true;
      draw(AT_REST, true);
      slide(-direction * (screen.width + GAP), 0, true);
      const arrived = () => {
        clearTimeout(turnTimer);
        trackElement.removeEventListener("transitionend", arrived);
        onTurn(direction);
      };
      trackElement.addEventListener("transitionend", arrived);
      // In case the browser skips the transition (reduced motion, a hidden tab).
      turnTimer = setTimeout(arrived, 320);
    };
    turner.current = turn;

    const zoomAt = (at: Point) => {
      if (!drawn.width) return;
      draw(
        view.scale > 1 ? AT_REST : clampView(zoomAround(view, TAP_ZOOM, at), drawn, screen),
        true,
      );
    };

    const down = (event: PointerEvent) => {
      if (turning || (event.pointerType === "mouse" && event.button !== 0)) return;
      byMouse = event.pointerType === "mouse";
      stageElement.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        mode = "undecided";
        start = { x: event.clientX, y: event.clientY };
        origin = view;
        travelled = 0;
        speed = { x: event.clientX, at: event.timeStamp, value: 0 };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        mode = "pinch";
        origin = view;
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          middle: fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2),
        };
        // A second finger ends whatever the first one had started.
        travelled = Infinity;
        slide(0, 0);
        dim(0);
      }
    };

    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (mode === "pinch") {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const scale = (origin.scale * (Math.hypot(a.x - b.x, a.y - b.y) || 1)) / pinch.distance;
        const middle = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
        return draw(clampView(zoomAround(origin, scale, pinch.middle, middle), drawn, screen));
      }
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      travelled = Math.max(travelled, Math.hypot(dx, dy));
      if (mode === "undecided" && travelled > 8)
        mode =
          view.scale > 1
            ? "pan"
            : Math.abs(dx) >= Math.abs(dy)
              ? "swipe"
              : dy > 0
                ? "dismiss"
                : "idle";
      if (mode === "pan") {
        draw(clampView({ scale: origin.scale, x: origin.x + dx, y: origin.y + dy }, drawn, screen));
      } else if (mode === "swipe") {
        const elapsed = event.timeStamp - speed.at;
        if (elapsed > 0)
          speed = {
            x: event.clientX,
            at: event.timeStamp,
            value: (event.clientX - speed.x) / elapsed,
          };
        // Nothing on that side: the photo resists.
        slide((dx > 0 ? canPrevious : canNext) ? dx : dx * 0.25, 0);
      } else if (mode === "dismiss") {
        const y = Math.max(0, dy);
        slide(0, y);
        dim(y);
      }
    };

    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (mode === "pinch") {
        const [left] = [...pointers.values()];
        if (left) {
          // One finger stays down: it now drags the enlarged photo.
          start = left;
          origin = view;
          mode = view.scale > 1 ? "pan" : "idle";
        } else {
          mode = "idle";
          if (view.scale < 1.05) draw(AT_REST, true);
        }
        return;
      }
      if (pointers.size > 0) return;
      const ended = mode;
      mode = "idle";
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const cancelled = event.type === "pointercancel";
      if (ended === "swipe") {
        const direction = cancelled ? 0 : swipeTurn(dx, speed.value, screen.width);
        if (direction) turn(direction);
        else slide(0, 0, true);
      } else if (ended === "dismiss") {
        if (!cancelled && dy > 110) return onClose();
        slide(0, 0, true);
        dim(0, true);
      } else if (ended === "undecided" && !cancelled && travelled <= 8) {
        const onPhoto = Boolean(
          frameElement?.contains(document.elementFromPoint(event.clientX, event.clientY)),
        );
        if (event.pointerType === "mouse") {
          // A click beside the photo closes; on it, a double click zooms.
          if (!onPhoto) onClose();
        } else if (event.timeStamp - lastTap < 300) {
          clearTimeout(tapTimer);
          lastTap = 0;
          zoomAt(fromCentre(event.clientX, event.clientY));
        } else {
          // Wait to see whether a second tap follows.
          lastTap = event.timeStamp;
          tapTimer = setTimeout(() => onTap(), 300);
        }
      }
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (turning || !drawn.width) return;
      // A pinch on a trackpad arrives as a wheel with Ctrl held, in small steps.
      const scale = view.scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      draw(
        clampView(zoomAround(view, scale, fromCentre(event.clientX, event.clientY)), drawn, screen),
      );
    };
    // Browsers also send a double click after two taps of a finger, which
    // have already been handled above.
    const doubleClick = (event: MouseEvent) => {
      if (byMouse) zoomAt(fromCentre(event.clientX, event.clientY));
    };

    stageElement.addEventListener("pointerdown", down);
    stageElement.addEventListener("pointermove", move);
    stageElement.addEventListener("pointerup", up);
    stageElement.addEventListener("pointercancel", up);
    stageElement.addEventListener("wheel", wheel, { passive: false });
    stageElement.addEventListener("dblclick", doubleClick);
    return () => {
      clearTimeout(tapTimer);
      clearTimeout(turnTimer);
      turner.current = null;
      stageElement.removeEventListener("pointerdown", down);
      stageElement.removeEventListener("pointermove", move);
      stageElement.removeEventListener("pointerup", up);
      stageElement.removeEventListener("pointercancel", up);
      stageElement.removeEventListener("wheel", wheel);
      stageElement.removeEventListener("dblclick", doubleClick);
    };
  }, [
    key,
    root,
    stage,
    track,
    frame,
    backdrop,
    width,
    height,
    screenWidth,
    screenHeight,
    canPrevious,
    canNext,
  ]);

  return useCallback((direction: 1 | -1) => turner.current?.(direction), []);
}
