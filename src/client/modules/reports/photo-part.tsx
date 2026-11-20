import {
  CalendarCheck,
  Camera,
  Check,
  CloudOff,
  ImagePlus,
  Images,
  Info,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { REPORT_LIMITS } from "@/shared/reports";
import type { Photo } from "@/shared/photos";

import { cn } from "../../lib/cn";
import { count, formatTime } from "../../lib/format";
import { useOnline } from "../../lib/online";
import { TakePhotoButton } from "../photos/take";
import { useTouchDevice } from "../photos/tiles";
import { Button, Sheet } from "../../ui";
import { useDayPhotos } from "./data";
import { leftOutText, photosToOffer, stillOnDevice, useReportPhotos } from "./photos";
import { ReportPhotoGrid, ReportPhotoSheet } from "./report-photos";
import { Notice } from "./status";

// The photos of the report being written: taken from the camera, chosen in
// the phone's gallery or among the day's photos of the project. They stay
// the project's; the report only names them.

/** The way a choice of the photos part looks: a large tile, as the weather's. */
const choiceClass =
  "border-line bg-surface hover:border-ead/60 active:bg-ead-tint relative flex min-h-19 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border px-1 text-center text-sm leading-tight font-semibold text-balance transition-colors sm:min-h-21";

function ChoiceFace({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <Icon className="text-ead-dark size-7 shrink-0" aria-hidden />
      <span>{children}</span>
    </>
  );
}

export function PhotoPart({
  projectId,
  day,
  photoIds,
  leftOut,
  onAdd,
  onRemove,
}: {
  projectId: string;
  /** The report's day: its photos in the project are offered. */
  day: string;
  photoIds: string[];
  /** Photos just left out because the report had as many as it takes. */
  leftOut: number;
  onAdd: (ids: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const touch = useTouchDevice();
  const online = useOnline();
  const { photos } = useReportPhotos(projectId, photoIds);
  const dayPhotos = useDayPhotos(projectId, day || undefined);
  const offered = photosToOffer(dayPhotos.data ?? [], photoIds);
  const [openId, setOpenId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const full = photoIds.length >= REPORT_LIMITS.photos;
  const leaving = stillOnDevice(photos);
  const openIndex = photos.findIndex((photo) => photo.id === openId);
  // The ways to add, side by side as large tiles: one alone lies across.
  const choices = (touch ? 2 : 1) + (offered.length > 0 ? 1 : 0);

  return (
    <div className="space-y-3">
      {photos.length > 0 ? <ReportPhotoGrid photos={photos} onOpen={setOpenId} /> : null}

      {full ? null : (
        <div
          className={cn(
            "grid gap-2",
            ["", "grid-cols-1 [&>*]:flex-row [&>*]:gap-3", "grid-cols-2", "grid-cols-3"][choices],
          )}
        >
          {touch ? (
            <>
              <TakePhotoButton
                projectId={projectId}
                label="Prendre une photo"
                onAdded={onAdd}
                className={choiceClass}
              >
                <ChoiceFace icon={Camera}>Prendre une photo</ChoiceFace>
              </TakePhotoButton>
              <TakePhotoButton
                projectId={projectId}
                camera={false}
                label="Choisir dans le téléphone"
                onAdded={onAdd}
                className={choiceClass}
              >
                <ChoiceFace icon={Images}>Du téléphone</ChoiceFace>
              </TakePhotoButton>
            </>
          ) : (
            <TakePhotoButton
              projectId={projectId}
              camera={false}
              label="Ajouter des photos"
              onAdded={onAdd}
              className={choiceClass}
            >
              <ChoiceFace icon={ImagePlus}>Ajouter des photos</ChoiceFace>
            </TakePhotoButton>
          )}
          {offered.length > 0 ? (
            <button type="button" onClick={() => setChoosing(true)} className={choiceClass}>
              <ChoiceFace icon={CalendarCheck}>Photos du jour</ChoiceFace>
              <span className="bg-ead-dark absolute top-1.5 right-1.5 flex h-5.5 min-w-5.5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white tabular-nums">
                {offered.length}
              </span>
            </button>
          ) : null}
        </div>
      )}

      {leftOut > 0 ? (
        <Notice tone="warn" icon={<Info aria-hidden />}>
          {leftOutText(leftOut)}
        </Notice>
      ) : full ? (
        <Notice tone="neutral" icon={<Info aria-hidden />}>
          Le rapport a {REPORT_LIMITS.photos} photos, le maximum. Retirez-en une pour en ajouter une
          autre.
        </Notice>
      ) : null}
      {leaving.length > 0 ? (
        <Notice tone="neutral" icon={online ? <Camera aria-hidden /> : <CloudOff aria-hidden />}>
          {online
            ? `${leaving.length > 1 ? `${leaving.length} photos partent` : "1 photo part"} encore. Vous pouvez enregistrer sans attendre\u00a0: le rapport ${leaving.length > 1 ? "les" : "l'"}a déjà.`
            : `${leaving.length > 1 ? `${leaving.length} photos attendent` : "1 photo attend"} le réseau sur cet appareil. Le rapport ${leaving.length > 1 ? "les" : "l'"}a déjà.`}
        </Notice>
      ) : null}

      <ReportPhotoSheet
        projectId={projectId}
        photo={photos[openIndex]}
        number={openIndex + 1}
        onClose={() => setOpenId(null)}
        onRemove={onRemove}
      />
      <DayPhotosSheet
        open={choosing}
        photos={offered}
        room={REPORT_LIMITS.photos - photoIds.length}
        onClose={() => setChoosing(false)}
        onChoose={(ids) => {
          setChoosing(false);
          onAdd(ids);
        }}
      />
    </div>
  );
}

/** The day's photos of the project not with the report yet: several chosen at once. */
function DayPhotosSheet({
  open,
  photos,
  room,
  onClose,
  onChoose,
}: {
  open: boolean;
  photos: Photo[];
  /** How many more the report takes. */
  room: number;
  onClose: () => void;
  onChoose: (ids: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const close = () => {
    setChosen([]);
    onClose();
  };
  const toggle = (id: string) =>
    setChosen((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));
  const all = photos.length > 0 && photos.every((photo) => chosen.includes(photo.id));
  const over = chosen.length > room;
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Photos du jour"
      description="Prises ce jour-là dans le projet. Touchez celles qui vont avec le rapport."
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>
            Annuler
          </Button>
          <Button
            size="lg"
            disabled={chosen.length === 0}
            onClick={() => {
              // In the order they were taken, as the report shows them.
              onChoose(photos.flatMap((photo) => (chosen.includes(photo.id) ? photo.id : [])));
              setChosen([]);
            }}
          >
            {chosen.length === 0 ? "Ajouter" : `Ajouter ${count(chosen.length, "photo")}`}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className={cn("text-sm", over ? "text-warn font-medium" : "text-dim")}>
          {over
            ? `Le rapport en prend encore ${room}.`
            : `${count(chosen.length, "photo choisie", "photos choisies")}`}
        </p>
        <Button
          variant="ghost"
          onClick={() => setChosen(all ? [] : photos.map((photo) => photo.id))}
          className="-mr-2"
        >
          {all ? "Aucune" : "Tout choisir"}
        </Button>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => {
          const picked = chosen.includes(photo.id);
          return (
            <li key={photo.id}>
              <button
                type="button"
                aria-pressed={picked}
                aria-label={photo.caption ?? `Photo prise à ${formatTime(photo.takenAt)}`}
                onClick={() => toggle(photo.id)}
                className="bg-line/70 relative block aspect-square w-full cursor-pointer overflow-hidden rounded-xl"
              >
                <img
                  src={photo.thumbUrl}
                  alt=""
                  loading="lazy"
                  crossOrigin="anonymous"
                  draggable={false}
                  className={cn(
                    "size-full object-cover transition",
                    picked && "scale-90 rounded-lg",
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full border-2 transition-colors",
                    picked ? "bg-ead-dark border-white text-white" : "bg-ink/25 border-white/90",
                  )}
                >
                  {picked ? <Check className="size-4" strokeWidth={3} /> : null}
                </span>
                {picked ? (
                  <span
                    aria-hidden
                    className="ring-ead-dark pointer-events-none absolute inset-0 rounded-xl ring-3 ring-inset"
                  />
                ) : null}
              </button>
              {photo.caption ? (
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug wrap-anywhere">
                  {photo.caption}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
