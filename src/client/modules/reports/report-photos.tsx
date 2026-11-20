import { useMutation } from "@tanstack/react-query";
import { CircleAlert, Clock, ImageMinus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PHOTO_CAPTION_MAX } from "@/shared/photos";

import { errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatTime } from "../../lib/format";
import { useOnline } from "../../lib/online";
import { describePhotos } from "../photos/describe";
import { localPreviewUrl } from "../photos/outbox";
import { LocalImage, localLabel, LocalMark, tileClass, useSendAgain } from "../photos/tiles";
import { Button, FormError, Sheet, Textarea, toast } from "../../ui";
import type { ReportPhoto } from "./photos";
import { Notice } from "./status";

// A report's photos as its screens show them: numbered in the order they
// were taken, as the PDF numbers them, each with its description.

/** "Photo prise à 14 h 05", for a photo without a description. */
const takenAt = (photo: ReportPhoto) => `Photo prise à ${formatTime(photo.takenAt)}`;

/** The thumbnail of a report's photo, with what a photo still on this device is going through. */
function Thumbnail({ photo }: { photo: ReportPhoto }) {
  if (photo.local) return <LocalImage local={photo.local} />;
  // Just sent from this device: its small image stays under the real one while it loads.
  const preview = localPreviewUrl(photo.id);
  return (
    <img
      src={photo.photo.thumbUrl}
      alt=""
      loading="lazy"
      decoding="async"
      crossOrigin="anonymous"
      draggable={false}
      style={preview ? { backgroundImage: `url(${preview})`, backgroundSize: "cover" } : undefined}
      className="size-full object-cover"
    />
  );
}

export function ReportPhotoGrid({
  photos,
  onOpen,
  large,
}: {
  photos: ReportPhoto[];
  onOpen: (id: string) => void;
  /** The saved report: fewer photos to a row, as on paper. */
  large?: boolean;
}) {
  return (
    <ol
      className={cn(
        "grid gap-x-2 gap-y-3",
        large
          ? "grid-cols-2 sm:grid-cols-3 sm:gap-x-3 print:grid-cols-3"
          : "grid-cols-3 sm:grid-cols-4",
      )}
    >
      {photos.map((photo, index) => (
        <li key={photo.id} className="min-w-0 break-inside-avoid">
          <button
            type="button"
            onClick={() => onOpen(photo.id)}
            aria-label={`Photo ${index + 1}\u00a0: ${photo.caption ?? (photo.local ? localLabel(photo.local) : takenAt(photo))}`}
            className={cn(tileClass, "group rounded-xl", large && "aspect-4/3 print:outline-none")}
          >
            <Thumbnail photo={photo} />
            {photo.local ? <LocalMark local={photo.local} /> : null}
            <span className="bg-ink/80 font-display absolute top-1.5 left-1.5 flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-[13px] leading-none font-bold text-white tabular-nums">
              {index + 1}
            </span>
          </button>
          <p
            className={cn(
              "mt-1 line-clamp-2 text-[13px] leading-snug wrap-anywhere",
              !photo.caption && "text-dim italic",
              large && "sm:text-sm print:line-clamp-none",
            )}
          >
            {photo.caption ?? "Sans description"}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * One photo of the report, large. While the report is being written, its
 * description is changed here (saved at once, for every screen that shows
 * the photo) and it can leave the report; one still on this device says how
 * its sending goes.
 */
export function ReportPhotoSheet({
  projectId,
  photo,
  number,
  onClose,
  onRemove,
}: {
  projectId: string;
  photo: ReportPhoto | undefined;
  number: number;
  onClose: () => void;
  /** Takes the photo out of the report being written; without it, the photo is only shown. */
  onRemove?: (id: string) => void;
}) {
  return (
    <Sheet
      open={photo !== undefined}
      onClose={onClose}
      title={`Photo ${number}`}
      description={
        photo
          ? `Prise à ${formatTime(photo.takenAt)}${photo.photo?.authorName ? ` · ${photo.photo.authorName}` : ""}`
          : undefined
      }
      wide
    >
      {photo ? (
        <SheetContent
          key={photo.id}
          projectId={projectId}
          photo={photo}
          onClose={onClose}
          onRemove={onRemove}
        />
      ) : null}
    </Sheet>
  );
}

function SheetContent({
  projectId,
  photo,
  onClose,
  onRemove,
}: {
  projectId: string;
  photo: ReportPhoto;
  onClose: () => void;
  onRemove?: (id: string) => void;
}) {
  const source = photo.photo ? photo.photo.url : localPreviewUrl(photo.id);
  return (
    <div className="space-y-4">
      {source ? (
        <img
          src={source}
          alt={photo.caption ?? ""}
          width={photo.photo?.width}
          height={photo.photo?.height}
          crossOrigin={photo.photo ? "anonymous" : undefined}
          className="bg-line mx-auto h-auto max-h-[55dvh] w-full rounded-xl object-contain"
        />
      ) : null}
      {photo.local && photo.local.state !== "sent" ? <Sending photo={photo} /> : null}
      {onRemove ? (
        <>
          <Description projectId={projectId} photo={photo} onDone={onClose} />
          <div className="border-line border-t pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                onRemove(photo.id);
                onClose();
              }}
              className="-ml-3"
            >
              <ImageMinus aria-hidden /> Retirer du rapport
            </Button>
            <p className="text-dim text-sm">La photo restera dans les photos du projet.</p>
          </div>
        </>
      ) : photo.caption ? (
        <p className="leading-relaxed wrap-anywhere whitespace-pre-line">{photo.caption}</p>
      ) : null}
    </div>
  );
}

/** A photo of the report still on this device: why, and a way to send it now. */
function Sending({ photo }: { photo: ReportPhoto }) {
  const online = useOnline();
  const local = photo.local;
  const again = useSendAgain(local);
  if (!local) return null;
  if (local.state === "refused")
    return (
      <Notice tone="bad" icon={<CircleAlert aria-hidden />}>
        <p>Non envoyée. {local.error ?? "Le serveur l'a refusée."} Elle reste sur cet appareil.</p>
        <Button
          variant="secondary"
          loading={again.trying}
          disabled={!online}
          onClick={again.run}
          className="mt-2"
        >
          Réessayer
        </Button>
      </Notice>
    );
  if (local.state === "waiting")
    return (
      <Notice tone="warn" icon={<Clock aria-hidden />}>
        <p>
          {online
            ? (local.error ?? "L'envoi n'a pas abouti. Un nouvel essai se fera tout seul.")
            : "En attente du réseau. Elle est gardée sur cet appareil et partira dès qu'il reviendra."}
        </p>
        {online ? (
          <Button variant="secondary" loading={again.trying} onClick={again.run} className="mt-2">
            Envoyer maintenant
          </Button>
        ) : null}
      </Notice>
    );
  return (
    <Notice tone="neutral" icon={<Clock aria-hidden />}>
      {local.state === "preparing" ? "Préparation de la photo." : "Envoi en cours."} Le rapport peut
      être enregistré sans l&apos;attendre.
    </Notice>
  );
}

/** The photo's own description: the same in the gallery, in the report and in its PDF. */
function Description({
  projectId,
  photo,
  onDone,
}: {
  projectId: string;
  photo: ReportPhoto;
  onDone: () => void;
}) {
  const [text, setText] = useState(photo.caption ?? "");
  const changed = text.trim() !== (photo.caption ?? "");
  const canEdit = photo.photo ? photo.photo.canEdit : true;
  // What is typed is never lost: closing the window saves it too.
  const typed = useRef<string | null>(null);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    typed.current = changed ? text.trim() : null;
  });
  useEffect(
    () => () => {
      const caption = typed.current;
      if (caption === null || caption === sent.current) return;
      describePhotos(projectId, [photo.id], caption || null).then(
        () => toast.success(caption ? "Description enregistrée." : "Description retirée."),
        (error) => toast.error(errorMessage(error)),
      );
    },
    [projectId, photo.id],
  );
  const save = useMutation({
    mutationFn: () => {
      sent.current = text.trim();
      return describePhotos(projectId, [photo.id], text.trim() || null);
    },
    onSuccess: () => {
      toast.success(text.trim() ? "Description enregistrée." : "Description retirée.");
      onDone();
    },
    onError: () => {
      sent.current = null;
    },
  });
  if (!canEdit)
    return photo.caption ? (
      <p className="leading-relaxed wrap-anywhere whitespace-pre-line">{photo.caption}</p>
    ) : null;
  return (
    // Not a form of its own: the window lies inside the report's form.
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Description</span>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={PHOTO_CAPTION_MAX}
          rows={2}
          placeholder={"Ce que la photo montre\u00a0: où, quoi, pourquoi."}
          className="field-sizing-content min-h-20 resize-none"
        />
      </label>
      <FormError>{save.isError ? errorMessage(save.error) : null}</FormError>
      {changed ? (
        <div className="flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer la description
          </Button>
        </div>
      ) : null}
    </div>
  );
}
