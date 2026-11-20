import sharp from "sharp";
import { z } from "zod";

import {
  ASSISTANT_TASKS,
  PHOTOS_LOOKED_AT,
  type AssistantTask,
  type DictationPhoto,
  type PhotoCaption,
} from "@/shared/dictation";
import { PHOTO_CAPTION_MAX, PHOTO_ID_PATTERN } from "@/shared/photos";
import { REPORT_LIMITS } from "@/shared/reports";

import type { PhotoRow } from "../photos/queries";
import type { DictationPatch } from "./patch";

// The report's photos on their way to the assistant: which ones it looks at,
// how small they are made, and how its descriptions come back to them.

const photoOnScreen = z.object({
  id: z.string().regex(PHOTO_ID_PATTERN),
  caption: z.string().nullable().catch(null),
  takenAt: z.iso.datetime({ offset: true }),
  onServer: z.boolean().catch(false),
});

/** A photo as the screen sent it, with the number the screen gave it. */
export type PhotoOnScreen = DictationPhoto & { number: number };

/** Far more than 40 photos with their descriptions take: anything larger is not read. */
const PHOTOS_FIELD_MAX = 100_000;

/**
 * The photos as the screen sends them, in its order, kept only when the
 * report names them. Each keeps the number the screen gave it, so that an
 * entry left out never shifts the others ("la photo 3" stays photo 3). An
 * entry that cannot be read is left out; a field that cannot be read at all
 * counts as no photos: the dictation still works without them.
 */
export function photosOnScreen(value: unknown, photoIds: string[]): PhotoOnScreen[] {
  if (typeof value !== "string" || value.length > PHOTOS_FIELD_MAX) return [];
  let list: unknown;
  try {
    list = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(list) || list.length > REPORT_LIMITS.photos) return [];
  const named = new Set(photoIds);
  const kept: PhotoOnScreen[] = [];
  list.forEach((entry: unknown, index) => {
    const parsed = photoOnScreen.safeParse(entry);
    if (!parsed.success) return;
    const photo = parsed.data;
    if (!named.has(photo.id) || kept.some((one) => one.id === photo.id)) return;
    // A description longer than a photo takes (an older device) is only cut.
    const caption = photo.caption?.trim().slice(0, PHOTO_CAPTION_MAX) || null;
    kept.push({ ...photo, caption, number: index + 1 });
  });
  return kept;
}

/** The task asked for, or null for a dictation. */
export function taskOf(value: unknown): AssistantTask | null | "invalid" {
  if (value === null || value === "") return null;
  return ASSISTANT_TASKS.find((task) => task === value) ?? "invalid";
}

/** A photo as the model is told about it. */
export type ListedPhoto = {
  /** As the screen numbers it, from 1. */
  number: number;
  id: string;
  takenAt: Date;
  caption: string | null;
  /** Its record, when the project holds it: only those can be looked at. */
  row: PhotoRow | null;
};

export type PhotoPlan = {
  listed: ListedPhoto[];
  /** To be looked at in this request. */
  toLook: ListedPhoto[];
  /** Without a description and held by the project, left for the next request. */
  later: string[];
  /** Without a description and not on the server yet. */
  notArrived: string[];
};

/**
 * Which photos the model sees. An id is only ever looked up among the
 * project's photos (`rows`): what the project holds is told as it is there,
 * the rest as the screen said. Photos without a description are looked at,
 * the latest first (those the foreman is talking about), a few at a time.
 */
export function planPhotos(
  onScreen: PhotoOnScreen[],
  rows: PhotoRow[],
  task: AssistantTask | null,
): PhotoPlan {
  const held = new Map(rows.map((row) => [row.id, row]));
  const listed: ListedPhoto[] = onScreen.map((photo) => {
    const row = held.get(photo.id) ?? null;
    return {
      number: photo.number,
      id: photo.id,
      takenAt: row ? row.takenAt : new Date(photo.takenAt),
      caption: (row ? row.caption : photo.caption)?.trim() || null,
      row,
    };
  });
  // Rewriting the texts needs no image.
  const wanted = task === "tidy" ? [] : listed.filter((photo) => !photo.caption);
  const lookable = wanted.filter((photo) => photo.row);
  const toLook = lookable.slice(-PHOTOS_LOOKED_AT);
  return {
    listed,
    toLook,
    later: lookable.slice(0, -PHOTOS_LOOKED_AT).map((photo) => photo.id),
    notArrived: wanted.filter((photo) => !photo.row).map((photo) => photo.id),
  };
}

/** About 1024 px on the long side: enough to tell a manhole from a catch basin, light to send. */
export const MODEL_IMAGE_SIDE = 1024;
const MODEL_IMAGE_QUALITY = 70;
/** A photo still larger than this once shrunk is not sent (none should be). */
const MODEL_IMAGE_MAX_BYTES = 1_000_000;

/** A photo as the model receives it. */
export type ModelImage = { number: number; jpeg: Buffer };

/** The image made small for the model. */
export async function imageForModel(original: Buffer): Promise<Buffer> {
  return sharp(original, { failOn: "none" })
    .resize({
      width: MODEL_IMAGE_SIDE,
      height: MODEL_IMAGE_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: MODEL_IMAGE_QUALITY })
    .toBuffer();
}

/**
 * The photos to look at, fetched and made small, in their order. A photo that
 * cannot be read is left out and named in `failed`.
 */
export async function imagesForModel(
  photos: ListedPhoto[],
  read: (key: string) => Promise<Buffer>,
): Promise<{ images: ModelImage[]; failed: string[] }> {
  const results = await Promise.all(
    photos.map(async (photo) => {
      if (!photo.row) return null;
      try {
        const jpeg = await imageForModel(await read(`${photo.row.imageKey}/full.jpg`));
        return jpeg.length > MODEL_IMAGE_MAX_BYTES ? null : { number: photo.number, jpeg };
      } catch (error) {
        console.error("dictation: photo", photo.id, error);
        return null;
      }
    }),
  );
  return {
    images: results.filter((image) => image !== null),
    failed: photos.filter((_, index) => !results[index]).map((photo) => photo.id),
  };
}

/**
 * Quotes around a whole description are the model's way of handing it over:
 * they go. Quotes inside one (the words on a sign) are part of it and stay.
 */
const WRAPPED = [/^«\s*([^«»]*?)\s*»$/, /^"([^"]*)"$/, /^“([^“”]*)”$/, /^'([^']*)'$/];

/** A description on one line, within the size a photo takes. */
export function tidyCaption(text: string): string {
  let flat = text.replace(/\s+/g, " ").trim();
  for (const wrapped of WRAPPED) flat = (wrapped.exec(flat)?.[1] ?? flat).trim();
  if (flat.length <= PHOTO_CAPTION_MAX) return flat;
  const cut = flat.slice(0, PHOTO_CAPTION_MAX + 1);
  const end = cut.lastIndexOf(" ");
  return cut
    .slice(0, end > PHOTO_CAPTION_MAX / 2 ? end : PHOTO_CAPTION_MAX)
    .replace(/[\s,;:]+$/, "");
}

/** What a request was, for the descriptions its answer may give. */
export type CaptionRequest = {
  task: AssistantTask | null;
  /** What was said; empty for a task. */
  heard: string;
  /** The numbers of the photos the model saw. */
  looked: Set<number>;
};

/** A dictation that speaks of a photo: only one can change a description already written. */
const SPEAKS_OF_A_PHOTO = /\bphotos?\b/i;

/**
 * The model's descriptions, back on the photos they are for. Only what the
 * request allows is kept: no description from "tidy"; from "describe", only
 * for the photos it looked at; from a dictation, for any photo of the list
 * (the foreman may describe one in words), and for one that already has a
 * description only when the foreman spoke of a photo ("la photo 2, c'est
 * plutôt…"). A number outside the list, a second description for the same
 * photo, an empty one or one that changes nothing are dropped.
 */
export function captionsFromPatch(
  patch: DictationPatch,
  plan: PhotoPlan,
  { task, heard, looked }: CaptionRequest,
): PhotoCaption[] {
  if (task === "tidy") return [];
  const captions: PhotoCaption[] = [];
  for (const { number, description } of patch.photos) {
    const photo = plan.listed.find((one) => one.number === number);
    if (!photo || captions.some((done) => done.photoId === photo.id)) continue;
    if (task === "describe" && !looked.has(number)) continue;
    if (photo.caption && !SPEAKS_OF_A_PHOTO.test(heard)) continue;
    const caption = tidyCaption(description);
    if (!caption || caption === photo.caption) continue;
    captions.push({ photoId: photo.id, number, caption });
  }
  return captions;
}
