import { Camera, CloudUpload } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../../../lib/cn";
import { localPreviewUrl } from "../../photos/outbox";
import { TakePhotoButton } from "../../photos/take";
import type { ReportPhoto } from "../photos";

// The report's photos inside the dictation window: a camera, then the photos
// with the numbers the foreman and the assistant both use ("la photo 2").

export function PhotoStrip({
  projectId,
  photos,
  disabled,
  onAdded,
}: {
  projectId: string;
  /** In the order they were taken: the first is photo 1. */
  photos: ReportPhoto[];
  /** While recording: the camera would take the microphone away. */
  disabled: boolean;
  onAdded: (ids: string[]) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  // A new photo comes into view at the end of the strip.
  const last = photos.at(-1)?.id;
  useEffect(() => {
    const strip = list.current;
    if (strip) strip.scrollTo({ left: strip.scrollWidth, behavior: "smooth" });
  }, [last]);

  return (
    <div className="flex items-center gap-2">
      <div inert={disabled} className={cn("shrink-0", disabled && "opacity-45")}>
        <TakePhotoButton
          projectId={projectId}
          label="Prendre une photo"
          onAdded={onAdded}
          className="border-line bg-canvas text-ead-dark hover:bg-ead-tint flex size-14 flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors"
        >
          <Camera className="size-6" aria-hidden />
          <span className="text-xs font-semibold">Photo</span>
        </TakePhotoButton>
      </div>
      {photos.length === 0 ? (
        <p className="text-dim min-w-0 flex-1 text-sm leading-snug">
          Prenez vos photos ici&nbsp;: l&apos;assistant les décrit.
        </p>
      ) : (
        <ul
          ref={list}
          aria-label="Photos du rapport"
          className="-my-1 -mr-5 flex min-w-0 flex-1 [scrollbar-width:none] gap-2 overflow-x-auto overscroll-x-contain py-1 pr-5"
        >
          {photos.map((photo, index) => (
            <li key={photo.id} className="shrink-0">
              <PhotoThumb photo={photo} number={index + 1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A photo of the report, small, with its number; marked while it is still on its way. */
export function PhotoThumb({
  photo,
  number,
  className,
}: {
  photo: ReportPhoto;
  number: number;
  /** Its size: 56 px unless said. */
  className?: string;
}) {
  const waiting = !photo.photo && photo.local.state !== "sent";
  const src = photo.photo ? photo.photo.thumbUrl : localPreviewUrl(photo.id);
  const name = `Photo ${number}${waiting ? ", pas encore envoyée" : ""}${photo.caption ? `\u00a0: ${photo.caption}` : ""}`;
  return (
    <figure
      aria-label={name}
      title={name}
      className={cn("bg-line relative size-14 shrink-0 overflow-hidden rounded-xl", className)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          crossOrigin={photo.photo ? "anonymous" : undefined}
          className={cn("size-full object-cover", waiting && "opacity-60")}
        />
      ) : null}
      <span
        aria-hidden
        className="bg-ink/80 absolute bottom-1 left-1 grid h-5 min-w-5 place-items-center rounded-md px-1 text-xs leading-none font-bold text-white tabular-nums"
      >
        {number}
      </span>
      {waiting ? (
        <span
          aria-hidden
          className="bg-surface/90 text-dim absolute top-1 right-1 grid size-5 place-items-center rounded-md"
        >
          <CloudUpload className="size-3.5" />
        </span>
      ) : null}
    </figure>
  );
}
