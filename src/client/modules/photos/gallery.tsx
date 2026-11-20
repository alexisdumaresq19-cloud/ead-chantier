import { useMutation } from "@tanstack/react-query";
import {
  CalendarDays,
  Camera,
  ChevronRight,
  Clock,
  CloudOff,
  Image as ImageIcon,
  ImagePlus,
  Images,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useSearch } from "wouter";

import { PHOTO_CAPTION_MAX, siteDay, type Photo, type PhotoDay } from "@/shared/photos";

import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { count } from "../../lib/format";
import { navigate } from "../../lib/location";
import { useOnline } from "../../lib/online";
import { useCurrentProject, useCurrentUser } from "../../lib/session";
import { Page } from "../../shell/page";
import {
  Button,
  buttonClass,
  Card,
  confirmAction,
  EmptyState,
  ErrorState,
  FormError,
  IconButton,
  Input,
  QueryState,
  Sheet,
  Skeleton,
  Spinner,
  toast,
} from "../../ui";
import { failureOf, photoChanged, refreshProject, usePhotoDays, usePhotoList } from "./data";
import { dayTitle, groupByDay, monthTitle, type DayGroup, type LocalPhoto } from "./logic";
import {
  addPhotos,
  captionWaiting,
  localPreviewUrl,
  removeWaiting,
  sendNow,
  useLocalPhotos,
  useSendProgress,
} from "./outbox";
import { PhotoViewer } from "./viewer";

// The gallery: a project's photos by day, newest first, with what is still
// on its way from this device mixed in; and the buttons that add photos.

const GRID = "grid grid-cols-3 gap-0.5 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6";

/** A touch screen: the device has a camera worth a button of its own. */
function useTouchDevice() {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia("(pointer: coarse)");
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

export function GalleryScreen({ day }: { day: string | null }) {
  const project = useCurrentProject();
  const me = useCurrentUser();
  const [path] = useLocation();
  const openId = new URLSearchParams(useSearch()).get("photo");
  const base = `/projets/${project.id}/photos`;
  const touch = useTouchDevice();
  const [today] = useState(() => siteDay(new Date()));

  const list = usePhotoList(project.id, day);
  const days = usePhotoDays(project.id);
  const locals = useLocalPhotos();

  const mine = useMemo(
    () =>
      locals.filter(
        (local) =>
          local.projectId === project.id &&
          local.ownerId === me.id &&
          (!day || siteDay(local.takenAt) === day),
      ),
    [locals, project.id, me.id, day],
  );
  const groups = useMemo(() => groupByDay(list.data?.pages.flat() ?? [], mine), [list.data, mine]);
  // What the large view goes through, in the order of the grid.
  const photos = useMemo(
    () =>
      groups.flatMap((group) =>
        group.tiles.flatMap((tile) => (tile.kind === "photo" ? [tile.photo] : [])),
      ),
    [groups],
  );
  const counts = useMemo(() => new Map(days.data?.map((d) => [d.day, d.count])), [days.data]);
  const total = day ? counts.get(day) : project.photoCount;

  const [choosingDay, setChoosingDay] = useState(false);
  const [batch, setBatch] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [localId, setLocalId] = useState<string | null>(null);
  const openLocal = mine.find((local) => local.id === localId && local.state !== "sent");

  // The large view is an entry of the browser's history, so that its back
  // button closes it; moving between photos replaces that entry.
  const openPhoto = useCallback(
    (id: string) => navigate(`${path}?photo=${id}`, { state: { photoViewer: true } }),
    [path],
  );
  const showPhoto = useCallback(
    (id: string) =>
      navigate(`${path}?photo=${id}`, {
        replace: true,
        state: { photoViewer: Boolean(window.history.state?.photoViewer) },
      }),
    [path],
  );
  const closePhoto = useCallback(() => {
    // Opened from the grid: going back returns to it. Opened by its address
    // (a reload, a link): there is nothing to go back to.
    if (window.history.state?.photoViewer) window.history.back();
    else navigate(path, { replace: true });
  }, [path]);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // So that choosing the same file again is still a change.
    event.target.value = "";
    if (!files.length) return;
    setAdding(true);
    try {
      const { ids, refused } = await addPhotos(project.id, me.id, files);
      if (refused)
        toast.error(
          refused === 1
            ? "Un fichier n'est pas une image. Il n'a pas été ajouté."
            : `${refused} fichiers ne sont pas des images. Ils n'ont pas été ajoutés.`,
        );
      if (ids.length) {
        setBatch(ids);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setAdding(false);
    }
  }

  // Thumbnails that could not load without a network are asked for again
  // when it returns.
  useEffect(() => {
    const reload = () =>
      document.querySelectorAll<HTMLImageElement>("img[data-broken]").forEach((image) => {
        delete image.dataset.broken;
        image.setAttribute("src", image.src);
      });
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, []);

  const waiting = mine.filter((local) => local.state === "waiting");
  const more = useLoadMore(list);
  const { fetchNextPage } = list;
  const loadMore = useCallback(() => fetchNextPage({ cancelRefetch: false }), [fetchNextPage]);

  const sections = groups.map((group) => (
    <DaySection
      key={group.day}
      group={group}
      title={dayTitle(group.day, today)}
      // The server's count for the day, which may not all be loaded yet,
      // plus what has not reached it.
      count={
        (counts.get(group.day) ?? group.tiles.filter((tile) => tile.kind === "photo").length) +
        group.tiles.filter((tile) => tile.kind === "local" && tile.local.state !== "sent").length
      }
      single={Boolean(day)}
      onOpen={openPhoto}
      onOpenLocal={setLocalId}
    />
  ));

  const failure = failureOf(list);
  let content: ReactNode;
  if (list.data === undefined) {
    // Nothing from the server yet (or no network, on a device that never
    // opened this page): what waits on the device is shown all the same.
    content = (
      <>
        {sections}
        {failure ? <ErrorState error={failure} onRetry={() => list.refetch()} /> : <GridSkeleton />}
      </>
    );
  } else if (groups.length > 0) {
    content = (
      <>
        {sections}
        {more}
      </>
    );
  } else if (day) {
    content = (
      <EmptyState
        icon={Images}
        title="Aucune photo ce jour-là"
        text="Les photos prises ce jour-là ont peut-être été supprimées."
        action={
          <Link href={base} className={buttonClass({ variant: "secondary" })}>
            Voir toutes les photos
          </Link>
        }
      />
    );
  } else {
    content = (
      <EmptyState
        icon={Camera}
        title="Aucune photo pour l'instant"
        text={
          touch
            ? "Prenez en photo l'avancement, un imprévu, l'état des lieux. Toute l'équipe du projet les verra ici."
            : "Ajoutez des photos de l'avancement, d'un imprévu, de l'état des lieux. Toute l'équipe du projet les verra ici."
        }
      />
    );
  }

  return (
    <Page
      title={day ? dayTitle(day, today) : "Photos"}
      subtitle={total ? count(total, "photo") : undefined}
      back={day ? { href: base, label: "Toutes les photos" } : undefined}
      actions={
        <>
          {day || project.photoCount > 0 ? (
            <Button variant="secondary" onClick={() => setChoosingDay(true)}>
              <CalendarDays aria-hidden /> {day ? "Autre jour" : "Par jour"}
            </Button>
          ) : null}
          {day ? null : (
            // On a phone these are in the bar at the bottom, under the thumb.
            <div className="hidden gap-2 lg:flex">
              {touch ? (
                <>
                  <FileButton variant="secondary" multiple busy={adding} onFiles={addFiles}>
                    <Images aria-hidden /> Choisir des photos
                  </FileButton>
                  <FileButton camera busy={adding} onFiles={addFiles}>
                    <Camera aria-hidden /> Prendre une photo
                  </FileButton>
                </>
              ) : (
                <FileButton multiple busy={adding} onFiles={addFiles}>
                  <ImagePlus aria-hidden /> Ajouter des photos
                </FileButton>
              )}
            </div>
          )}
        </>
      }
    >
      {batch ? (
        <BatchCaption
          key={batch.join()}
          projectId={project.id}
          ids={batch}
          onDone={() => setBatch(null)}
        />
      ) : null}
      {waiting.length > 0 ? <WaitingNotice waiting={waiting} /> : null}
      {content}

      {day ? null : (
        <>
          {/* Room for the bar below, so that it never hides the last row. */}
          <div className="h-20 lg:hidden" />
          <div className="no-print border-line bg-surface/95 fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+1px)] z-20 border-t px-3 py-2.5 backdrop-blur lg:hidden">
            <div className="mx-auto flex max-w-lg gap-2">
              <FileButton
                variant="secondary"
                size="lg"
                multiple
                busy={adding}
                onFiles={addFiles}
                label="Choisir des photos"
                className="px-4"
              >
                <Images aria-hidden />
                <span className="max-[23rem]:hidden">Choisir</span>
              </FileButton>
              <FileButton size="lg" camera busy={adding} onFiles={addFiles} className="flex-1 px-4">
                <Camera aria-hidden /> Prendre une photo
              </FileButton>
            </div>
          </div>
        </>
      )}

      <DaySheet
        open={choosingDay}
        onClose={() => setChoosingDay(false)}
        days={days}
        base={base}
        current={day}
        today={today}
      />
      <LocalSheet local={openLocal} onClose={() => setLocalId(null)} />
      {openId ? (
        <PhotoViewer
          projectId={project.id}
          photoId={openId}
          photos={photos}
          total={total}
          today={today}
          hasMore={list.hasNextPage}
          loadMore={loadMore}
          onShow={showPhoto}
          onClose={closePhoto}
        />
      ) : null}
    </Page>
  );
}

// --- Adding ---------------------------------------------------------------------

/**
 * A button that opens the camera or the phone's gallery. It is a label
 * around a file input, which is what phones open most reliably.
 */
function FileButton({
  camera,
  multiple,
  busy,
  onFiles,
  variant,
  size,
  label,
  className,
  children,
}: {
  /** Opens the camera, facing the work. */
  camera?: boolean;
  multiple?: boolean;
  busy: boolean;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  /** The button's full name, for when its text is shortened on a narrow screen. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      title={label}
      aria-busy={busy || undefined}
      className={buttonClass({
        variant,
        size,
        className: cn(
          "has-focus-visible:outline-ead/55 relative has-focus-visible:outline-3 has-focus-visible:outline-offset-2",
          busy && "pointer-events-none opacity-60",
          className,
        ),
      })}
    >
      {busy ? <Spinner className="size-[1.2em] text-current" label="Ajout en cours" /> : null}
      {children}
      <input
        type="file"
        // "image/*" rather than a list of types: an iPhone then hands over a
        // JPEG even when it keeps its photos as HEIC.
        accept="image/*"
        capture={camera ? "environment" : undefined}
        multiple={multiple}
        disabled={busy}
        onChange={onFiles}
        aria-label={label}
        className="sr-only"
      />
    </label>
  );
}

/** Right after choosing: an optional word about the photos just added. */
function BatchCaption({
  projectId,
  ids,
  onDone,
}: {
  projectId: string;
  ids: string[];
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const caption = text.trim() || null;
      // Photos still on the device take the caption with them; those the
      // server already has are changed there.
      const sent = await captionWaiting(ids, caption);
      const results = await Promise.allSettled(
        sent.map((id) =>
          api<Photo>(`/api/photos/${id}`, { method: "PATCH", body: { caption } }).then((photo) =>
            photoChanged(projectId, photo),
          ),
        ),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },
    onSuccess: () => {
      toast.success(ids.length > 1 ? "Description ajoutée aux photos." : "Description ajoutée.");
      void refreshProject(projectId);
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) save.mutate();
    else onDone();
  }

  return (
    <Card className="animate-rise mb-4 p-3.5 sm:p-4">
      <form onSubmit={submit}>
        <div className="flex items-start justify-between gap-2">
          <label htmlFor="batch-caption" className="pt-0.5 font-semibold">
            {ids.length > 1 ? `${ids.length} photos ajoutées` : "Photo ajoutée"}
            <span className="text-dim block text-sm font-normal">
              Vous pouvez dire ce qu&apos;{ids.length > 1 ? "elles montrent" : "elle montre"}. Ce
              n&apos;est pas obligatoire.
            </span>
          </label>
          <IconButton label="Fermer" onClick={onDone} className="-mt-1.5 -mr-1.5">
            <X aria-hidden />
          </IconButton>
        </div>
        <div className="mt-2.5 flex gap-2">
          <Input
            id="batch-caption"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={PHOTO_CAPTION_MAX}
            placeholder="Ex. : tranchée avant remblai"
            enterKeyHint="done"
            autoComplete="off"
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="lg" loading={save.isPending} className="h-12 px-5">
            OK
          </Button>
        </div>
        {save.isError ? (
          <div className="mt-2.5">
            <FormError>{errorMessage(save.error)}</FormError>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

/** Photos that could not leave yet: said once, above the grid. */
function WaitingNotice({ waiting }: { waiting: LocalPhoto[] }) {
  const online = useOnline();
  const [trying, setTrying] = useState(false);
  const problem = waiting.find((local) => local.error)?.error;
  return (
    <div
      role="status"
      className="bg-warn-tint text-warn mb-4 flex items-center gap-3 rounded-2xl px-4 py-3"
    >
      {online ? (
        <Clock className="size-5 shrink-0" aria-hidden />
      ) : (
        <CloudOff className="size-5 shrink-0" aria-hidden />
      )}
      <p className="min-w-0 flex-1 text-sm">
        <span className="block font-bold">
          {count(waiting.length, "photo")} en attente d&apos;envoi
        </span>
        {online
          ? (problem ?? "L'envoi n'a pas abouti. Un nouvel essai se fera tout seul.")
          : `${waiting.length > 1 ? "Elles sont gardées" : "Elle est gardée"} sur cet appareil et ${waiting.length > 1 ? "partiront" : "partira"} dès que le réseau reviendra.`}
      </p>
      {online ? (
        <Button
          variant="secondary"
          size="sm"
          loading={trying}
          onClick={() => {
            setTrying(true);
            void sendNow().finally(() => setTrying(false));
          }}
          className="h-11"
        >
          Réessayer
        </Button>
      ) : null}
    </div>
  );
}

// --- The grid --------------------------------------------------------------------

const DaySection = memo(function DaySection({
  group,
  title,
  count: photoCount,
  single,
  onOpen,
  onOpenLocal,
}: {
  group: DayGroup;
  title: string;
  count: number;
  /** The page is about this day alone: its title already says which. */
  single: boolean;
  onOpen: (id: string) => void;
  onOpenLocal: (id: string) => void;
}) {
  return (
    <section aria-label={title} className="mb-5">
      {single ? null : (
        <h2 className="bg-canvas/95 sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 flex items-baseline justify-between gap-3 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0 lg:top-0">
          <span className="font-display text-[17px] font-bold">{title}</span>
          <span className="text-dim text-sm">{count(photoCount, "photo")}</span>
        </h2>
      )}
      {/* Edge to edge on a phone: three photos as large as the screen allows. */}
      <ul className={cn(GRID, "-mx-4 sm:mx-0 sm:overflow-hidden sm:rounded-xl")}>
        {group.tiles.map((tile) =>
          tile.kind === "photo" ? (
            <PhotoTile key={tile.id} photo={tile.photo} onOpen={onOpen} />
          ) : (
            <LocalTile key={tile.id} local={tile.local} onOpen={onOpenLocal} />
          ),
        )}
      </ul>
    </section>
  );
});

const tileClass =
  "bg-line/70 relative block aspect-square w-full cursor-pointer overflow-hidden focus-visible:z-[1] focus-visible:-outline-offset-3";

const PhotoTile = memo(function PhotoTile({
  photo,
  onOpen,
}: {
  photo: Photo;
  onOpen: (id: string) => void;
}) {
  // Just sent from this device: its small image stays under the real
  // thumbnail until that one has loaded, so the tile never blinks.
  const preview = localPreviewUrl(photo.id);
  return (
    <li>
      <button
        type="button"
        id={`photo-${photo.id}`}
        onClick={() => onOpen(photo.id)}
        aria-label={photo.caption ?? `Photo de ${photo.authorName ?? "l'équipe"}`}
        className={cn(tileClass, "group")}
        style={
          preview ? { backgroundImage: `url(${preview})`, backgroundSize: "cover" } : undefined
        }
      >
        <img
          src={photo.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          crossOrigin="anonymous"
          draggable={false}
          // Not on the device and no network: an empty tile until it returns.
          onError={(event) => (event.currentTarget.dataset.broken = "")}
          className="size-full object-cover transition-[filter] group-hover:brightness-90 data-broken:invisible"
        />
      </button>
    </li>
  );
});

const LocalTile = memo(function LocalTile({
  local,
  onOpen,
}: {
  local: LocalPhoto;
  onOpen: (id: string) => void;
}) {
  const preview = localPreviewUrl(local.id);
  const label =
    local.state === "waiting"
      ? "Photo en attente d'envoi"
      : local.state === "sent"
        ? "Photo envoyée"
        : "Photo en cours d'envoi";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(local.id)}
        aria-label={label}
        className={tileClass}
      >
        {preview ? (
          <img src={preview} alt="" draggable={false} className="size-full object-cover" />
        ) : local.state === "preparing" ? null : (
          // A file the browser could not draw, sent as it is.
          <span className="text-dim/50 flex size-full items-center justify-center">
            <ImageIcon className="size-8" aria-hidden />
          </span>
        )}
        {local.state === "preparing" ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner className="text-dim/70 size-7" label="Préparation" />
          </span>
        ) : local.state === "sending" ? (
          <SendingMark id={local.id} />
        ) : local.state === "waiting" ? (
          <span className="bg-ink/75 absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1 text-[11px] font-semibold text-white">
            <Clock className="size-3.5" aria-hidden /> En attente
          </span>
        ) : null}
      </button>
    </li>
  );
});

/** A ring that fills as the photo leaves. */
function SendingMark({ id }: { id: string }) {
  const sent = useSendProgress(id);
  const radius = 15;
  const around = 2 * Math.PI * radius;
  return (
    <span className="bg-ink/30 absolute inset-0 flex items-center justify-center">
      <svg
        viewBox="0 0 36 36"
        role="progressbar"
        aria-label="Envoi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sent * 100)}
        className="size-10 -rotate-90 drop-shadow"
      >
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          className="stroke-white/35"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={around}
          strokeDashoffset={around * (1 - Math.max(0.04, sent))}
          className="stroke-white transition-[stroke-dashoffset] duration-300"
        />
      </svg>
    </span>
  );
}

function GridSkeleton() {
  return (
    <div role="status" aria-label="Chargement">
      <Skeleton className="mt-2 mb-3 h-5 w-32" />
      <div className={cn(GRID, "-mx-4 sm:mx-0 sm:overflow-hidden sm:rounded-xl")}>
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="aspect-square rounded-none" />
        ))}
      </div>
    </div>
  );
}

/** Loads the next photos as the end of the grid comes near, and says so. */
function useLoadMore(list: ReturnType<typeof usePhotoList>) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  const pages = list.data?.pages.length ?? 0;

  useEffect(() => {
    const element = sentinel.current;
    // After a failure the person asks for the rest: no retrying in a loop.
    if (!element || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
    // `pages`: a page that did not fill the screen must trigger the next one.
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, pages]);

  if (!hasNextPage) {
    return pages > 1 ? (
      <p className="text-dim py-6 text-center text-sm">Toutes les photos sont affichées.</p>
    ) : null;
  }
  return (
    <div ref={sentinel} className="flex min-h-16 flex-col items-center justify-center gap-2 py-4">
      {isFetchNextPageError ? (
        <>
          <p className="text-dim text-sm">La suite n&apos;a pas pu être chargée.</p>
          <Button variant="secondary" onClick={() => fetchNextPage()}>
            Réessayer
          </Button>
        </>
      ) : (
        <Spinner />
      )}
    </div>
  );
}

// --- Sheets ----------------------------------------------------------------------

/** The days that have photos, to go straight to one of them. */
function DaySheet({
  open,
  onClose,
  days,
  base,
  current,
  today,
}: {
  open: boolean;
  onClose: () => void;
  days: ReturnType<typeof usePhotoDays>;
  base: string;
  current: string | null;
  today: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Photos par jour">
      <QueryState
        query={days}
        loading={
          failureOf(days) ? (
            <p className="text-dim py-6 text-center">
              Pas de réseau. La liste des jours s&apos;affichera quand il reviendra.
            </p>
          ) : undefined
        }
      >
        {(all) => {
          if (all.length === 0)
            return <p className="text-dim py-6 text-center">Aucune photo pour l&apos;instant.</p>;
          const months = new Map<string, PhotoDay[]>();
          for (const day of all) {
            const month = day.day.slice(0, 7);
            months.set(month, [...(months.get(month) ?? []), day]);
          }
          return (
            <div className="-mx-2">
              {current ? <DayLink href={base} onClick={onClose} label="Toutes les photos" /> : null}
              {[...months.values()].map((month) => (
                <section key={month[0].day}>
                  <h3 className="font-display text-dim px-3 pt-4 pb-1 text-xs font-bold tracking-wider uppercase">
                    {monthTitle(month[0].day)}
                  </h3>
                  {month.map((day) => (
                    <DayLink
                      key={day.day}
                      href={`${base}/jour/${day.day}`}
                      onClick={onClose}
                      label={dayTitle(day.day, today)}
                      detail={count(day.count, "photo")}
                      active={day.day === current}
                    />
                  ))}
                </section>
              ))}
            </div>
          );
        }}
      </QueryState>
    </Sheet>
  );
}

function DayLink({
  href,
  onClick,
  label,
  detail,
  active,
}: {
  href: string;
  onClick: () => void;
  label: string;
  detail?: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "hover:bg-canvas active:bg-canvas flex min-h-13 items-center gap-3 rounded-xl px-3 transition-colors",
        active && "bg-ead-tint text-ead-dark",
      )}
    >
      <span className="flex-1 font-semibold">{label}</span>
      {detail ? <span className="text-dim text-sm">{detail}</span> : null}
      <ChevronRight className="text-dim size-5" aria-hidden />
    </Link>
  );
}

/** A photo still on the device: what is happening to it, and the way out. */
function LocalSheet({ local, onClose }: { local: LocalPhoto | undefined; onClose: () => void }) {
  const online = useOnline();
  const [trying, setTrying] = useState(false);
  const preview = local ? localPreviewUrl(local.id) : null;
  const waiting = local?.state === "waiting";

  async function remove() {
    if (!local) return;
    const sure = await confirmAction({
      title: "Retirer cette photo ?",
      text: "Elle n'a pas encore été envoyée : elle sera perdue.",
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!sure) return;
    if (await removeWaiting(local.id)) toast.success("Photo retirée.");
    else toast.error("Cette photo est en train de partir. Elle ne peut plus être retirée.");
    onClose();
  }

  return (
    <Sheet
      open={Boolean(local)}
      onClose={onClose}
      title={waiting ? "Photo en attente d'envoi" : "Photo en cours d'envoi"}
      description={
        !waiting
          ? "Elle sera visible par toute l'équipe dans un instant."
          : online
            ? (local?.error ?? "L'envoi n'a pas abouti. Un nouvel essai se fera tout seul.")
            : "Elle est gardée sur cet appareil et partira dès que le réseau reviendra."
      }
      footer={
        waiting ? (
          <>
            <Button variant="secondary" onClick={remove}>
              Retirer la photo
            </Button>
            <Button
              loading={trying}
              disabled={!online}
              onClick={() => {
                setTrying(true);
                void sendNow().finally(() => setTrying(false));
              }}
            >
              Envoyer maintenant
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        )
      }
    >
      {preview ? (
        <img
          src={preview}
          alt=""
          className="bg-canvas mx-auto max-h-[45dvh] rounded-xl object-contain"
        />
      ) : null}
    </Sheet>
  );
}
