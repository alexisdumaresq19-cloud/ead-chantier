import { useMutation } from "@tanstack/react-query";
import { Camera, CloudOff, Image as ImageIcon, Images } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PHOTO_CAPTION_MAX, type Photo } from "@/shared/photos";

import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useOnline } from "../../lib/online";
import { Button, buttonClass, Field, FormError, Input, Sheet, Spinner, toast } from "../../ui";
import { photoChanged, refreshProject } from "./data";
import { captionWaiting, localPreviewUrl, useLocalPhotos } from "./outbox";
import { PhotoInput } from "./take";

// The window over the screen a photo was just taken from: what was added, an
// optional description for it, and the next photo.

/** Gives a description to photos, wherever they are: still on the device or with the server. */
async function describe(projectId: string, ids: string[], caption: string) {
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
  void refreshProject(projectId);
}

const described = (ids: string[]) =>
  ids.length > 1 ? "Description ajoutée aux photos." : "Description ajoutée.";

export default function AddedSheet({
  projectId,
  ids,
  camera,
  busy,
  onMore,
  onClose,
}: {
  projectId: string;
  ids: string[];
  /** The photos came from the camera; otherwise from the phone's gallery. */
  camera: boolean;
  /** The next photos are being taken in. */
  busy: boolean;
  onMore: (files: File[]) => void;
  onClose: () => void;
}) {
  const online = useOnline();
  // Read so that the small images appear as soon as they are made.
  useLocalPhotos();
  const [text, setText] = useState("");
  const caption = text.trim();
  const save = useMutation({
    mutationFn: () => describe(projectId, ids, caption),
    onSuccess: () => {
      toast.success(described(ids));
      onClose();
    },
  });

  const finish = (event?: FormEvent) => {
    event?.preventDefault();
    if (caption) save.mutate();
    else onClose();
  };

  /** The next photo: what was typed goes with these ones, without holding up the camera. */
  const more = (files: File[]) => {
    if (!files.length) return;
    if (caption)
      describe(projectId, ids, caption).then(
        () => toast.success(described(ids)),
        (error) => toast.error(errorMessage(error)),
      );
    onMore(files);
  };

  const many = ids.length > 1;
  return (
    <Sheet
      open
      onClose={() => finish()}
      title={many ? `${ids.length} photos ajoutées` : "Photo ajoutée"}
      description={
        online ? undefined : (
          <span className="text-warn flex items-center gap-1.5 font-medium">
            <CloudOff className="size-4 shrink-0" aria-hidden />
            Pas de réseau : {many ? "elles partiront" : "elle partira"} dès qu&apos;il reviendra.
          </span>
        )
      }
      footer={
        <>
          <Button variant="secondary" size="lg" loading={save.isPending} onClick={() => finish()}>
            Terminé
          </Button>
          <label
            aria-busy={busy || undefined}
            className={buttonClass({
              size: "lg",
              className: cn(
                "has-focus-visible:outline-ead/55 relative has-focus-visible:outline-3 has-focus-visible:outline-offset-2",
                (busy || save.isPending) && "pointer-events-none opacity-60",
              ),
            })}
          >
            {busy ? (
              <Spinner className="size-[1.2em] text-current" label="Ajout en cours" />
            ) : camera ? (
              <Camera aria-hidden />
            ) : (
              <Images aria-hidden />
            )}
            {camera ? "Une autre photo" : "D'autres photos"}
            <PhotoInput
              camera={camera}
              disabled={busy || save.isPending}
              label={camera ? "Une autre photo" : "D'autres photos"}
              onFiles={more}
            />
          </label>
        </>
      }
    >
      <form onSubmit={finish} className="space-y-4">
        <ul
          aria-label={many ? "Les photos ajoutées" : "La photo ajoutée"}
          className={cn(
            "flex gap-2",
            // A burst from the gallery scrolls sideways rather than pushing the field down.
            many && "-mx-5 overflow-x-auto overscroll-x-contain px-5 pb-1",
          )}
        >
          {ids.map((id) => (
            <li key={id} className="shrink-0">
              <Thumbnail id={id} large={!many} />
            </li>
          ))}
        </ul>
        <Field label="Description" optional>
          <Input
            id="batch-caption"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={PHOTO_CAPTION_MAX}
            placeholder="Ex. : regard R‑4 avant remblai"
            enterKeyHint="done"
            autoComplete="off"
          />
        </Field>
        <FormError>{save.isError ? errorMessage(save.error) : null}</FormError>
      </form>
    </Sheet>
  );
}

function Thumbnail({ id, large }: { id: string; large: boolean }) {
  const preview = localPreviewUrl(id);
  return (
    <span
      className={cn(
        "bg-line/70 ring-line flex items-center justify-center overflow-hidden rounded-xl ring-1",
        large ? "h-36 w-48" : "size-20",
      )}
    >
      {preview ? (
        <img src={preview} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        // Still being made smaller, or a file the browser cannot draw.
        <ImageIcon className="text-dim/50 size-7" aria-hidden />
      )}
    </span>
  );
}
