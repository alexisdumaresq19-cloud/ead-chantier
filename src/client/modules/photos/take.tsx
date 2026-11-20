import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { createPortal } from "react-dom";

import { cn } from "../../lib/cn";
import { useCurrentUser } from "../../lib/session";
import { Spinner, toast } from "../../ui";

// Taking a photo from any screen: the camera (or the phone's gallery) opens,
// the photo goes to the outbox, and a window over the same screen offers a
// description and the next photo. Nothing navigates: photos come in bursts.

// The window and the outbox load on the first photo: a screen that only
// offers the button (the project's home) does not carry them.
const loadSheet = () => import("./take-sheet");
const AddedSheet = lazy(loadSheet);
const loadOutbox = () => import("./outbox");

export function TakePhotoButton({
  projectId,
  camera = true,
  className,
  children,
  label,
  onAdded,
}: {
  projectId: string;
  /** Opens the camera, facing the work; false opens the phone's gallery, for several photos. */
  camera?: boolean;
  className?: string;
  children: ReactNode;
  /** The input's name, read aloud (the visible text may be shortened on a narrow screen). */
  label: string;
  /**
   * Called with the ids of the photos just taken in, before they have left
   * the device: a daily report puts them with itself.
   */
  onAdded?: (ids: string[]) => void;
}) {
  const me = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[] | null>(null);
  // Fetched once the screen is drawn, while there is a network: a photo taken
  // without one must still find its window.
  useEffect(() => {
    void loadSheet().catch(() => {});
    void loadOutbox().catch(() => {});
  }, []);

  async function add(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const { addPhotos } = await loadOutbox();
      const { ids, refused } = await addPhotos(projectId, me.id, files);
      if (refused)
        toast.error(
          refused === 1
            ? "Un fichier n'est pas une image. Il n'a pas été ajouté."
            : `${refused} fichiers ne sont pas des images. Ils n'ont pas été ajoutés.`,
        );
      if (ids.length) {
        markJustAdded(ids);
        setAdded(ids);
        onAdded?.(ids);
      }
    } catch {
      toast.error("La photo n'a pas pu être ajoutée. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label
        aria-busy={busy || undefined}
        data-busy={busy || undefined}
        className={cn(
          "has-focus-visible:outline-ead/55 relative cursor-pointer has-focus-visible:outline-3 has-focus-visible:outline-offset-2",
          busy && "pointer-events-none opacity-60",
          className,
        )}
      >
        {busy ? <Spinner className="size-[1.2em] text-current" label="Ajout en cours" /> : null}
        {children}
        <PhotoInput camera={camera} disabled={busy} label={label} onFiles={add} />
      </label>
      {/* At the end of the page: the button may sit in a part hidden at this size. */}
      {added
        ? createPortal(
            <Suspense fallback={null}>
              <AddedSheet
                key={added.join()}
                projectId={projectId}
                ids={added}
                camera={camera}
                busy={busy}
                onMore={add}
                onClose={() => {
                  setAdded(null);
                  releaseJustAdded();
                }}
              />
            </Suspense>,
            document.body,
          )
        : null}
    </>
  );
}

/** The hidden file input inside a label: what phones open most reliably. */
export function PhotoInput({
  camera,
  disabled,
  label,
  onFiles,
}: {
  camera: boolean;
  disabled?: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      type="file"
      // "image/*" rather than a list of types: an iPhone then hands over a
      // JPEG even when it keeps its photos as HEIC.
      accept="image/*"
      capture={camera ? "environment" : undefined}
      multiple={!camera}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const files = [...(event.target.files ?? [])];
        // So that choosing the same file again is still a change.
        event.target.value = "";
        onFiles(files);
      }}
      aria-label={label}
      className="sr-only"
    />
  );
}

// --- Just added --------------------------------------------------------------

// The photos just taken, outlined in the gallery until a moment after their
// window closes, so the eye finds them among the others.

const OUTLINED_FOR = 4000;
let justAdded: ReadonlySet<string> = new Set();
let fading: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const publish = (next: ReadonlySet<string>) => {
  justAdded = next;
  listeners.forEach((listener) => listener());
};

function markJustAdded(ids: string[]) {
  clearTimeout(fading);
  publish(new Set([...justAdded, ...ids]));
}

function releaseJustAdded() {
  clearTimeout(fading);
  fading = setTimeout(() => publish(new Set()), OUTLINED_FOR);
}

/** The ids of the photos just taken on this device. */
export function useJustAdded(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => justAdded,
    () => justAdded,
  );
}
