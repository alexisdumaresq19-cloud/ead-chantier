import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { DictationPhoto } from "@/shared/dictation";
import { PHOTO_CAPTION_MAX } from "@/shared/photos";

import type { PhotoRow } from "../photos/queries";
import type { DictationPatch } from "./patch";
import {
  captionsFromPatch,
  imageForModel,
  imagesForModel,
  MODEL_IMAGE_SIDE,
  photosOnScreen,
  planPhotos,
  taskOf,
  tidyCaption,
} from "./photos";

const ID = (n: number) => `abcdefghjkmnpq${"abcdefghjkmnpqrstuvwxyz"[n]}z`;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 19, 14, minute));

const onScreen = (n: number, change: Partial<DictationPhoto> = {}): DictationPhoto => ({
  id: ID(n),
  caption: null,
  takenAt: at(n).toISOString(),
  onServer: true,
  ...change,
});

const row = (n: number, caption: string | null = null) =>
  ({ id: ID(n), imageKey: `p/${n}`, takenAt: at(n), caption }) as PhotoRow;

const nothing: DictationPatch = {
  weather: { condition: null, temperatureC: null, note: null },
  crew: [],
  equipment: null,
  workDone: null,
  notes: null,
  replace: { equipment: false, workDone: false, notes: false },
  questions: [],
  photos: [],
};

describe("photosOnScreen", () => {
  it("keeps the photos the report names, in the screen's order, once each", () => {
    const sent = JSON.stringify([onScreen(2), onScreen(1), onScreen(9), onScreen(2)]);
    expect(photosOnScreen(sent, [ID(1), ID(2)]).map((photo) => photo.id)).toEqual([ID(2), ID(1)]);
  });
  it("counts anything unreadable as no photos", () => {
    expect(photosOnScreen("pas du json", [ID(1)])).toEqual([]);
    expect(photosOnScreen(JSON.stringify([{ id: "../../etc" }]), [ID(1)])).toEqual([]);
    expect(photosOnScreen(null, [ID(1)])).toEqual([]);
  });
});

describe("taskOf", () => {
  it("knows the two tasks, and a dictation by no task", () => {
    expect(taskOf("describe")).toBe("describe");
    expect(taskOf("tidy")).toBe("tidy");
    expect(taskOf(null)).toBeNull();
    expect(taskOf("rm -rf")).toBe("invalid");
  });
});

describe("planPhotos", () => {
  it("looks at the photos without a description that the project holds", () => {
    const plan = planPhotos(
      [onScreen(1), onScreen(2), onScreen(3), onScreen(4, { onServer: false })],
      [row(1, "Regard R-3"), row(2), row(3)],
      null,
    );
    expect(plan.listed.map((photo) => photo.number)).toEqual([1, 2, 3, 4]);
    expect(plan.listed[0].caption).toBe("Regard R-3");
    expect(plan.toLook.map((photo) => photo.number)).toEqual([2, 3]);
    expect(plan.notArrived).toEqual([ID(4)]);
    expect(plan.later).toEqual([]);
  });

  it("trusts the project over the screen for the photos it holds", () => {
    // The screen claims a description; the project's photo has none: it is looked at.
    const plan = planPhotos([onScreen(1, { caption: "Faux" })], [row(1)], null);
    expect(plan.toLook).toHaveLength(1);
    expect(plan.listed[0].caption).toBeNull();
  });

  it("an id the project does not hold is never looked at, whatever the screen says", () => {
    const plan = planPhotos([onScreen(1, { onServer: true })], [], "describe");
    expect(plan.toLook).toEqual([]);
    expect(plan.notArrived).toEqual([ID(1)]);
  });

  it("looks at eight at most, the latest, and leaves the others for the next time", () => {
    const list = Array.from({ length: 11 }, (_, index) => index + 1);
    const plan = planPhotos(
      list.map((n) => onScreen(n)),
      list.map((n) => row(n)),
      "describe",
    );
    expect(plan.toLook.map((photo) => photo.number)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(plan.later).toEqual([ID(1), ID(2), ID(3)]);
  });

  it("looks at nothing to put texts in clean French", () => {
    const plan = planPhotos([onScreen(1)], [row(1)], "tidy");
    expect(plan.toLook).toEqual([]);
    expect(plan.notArrived).toEqual([]);
  });
});

describe("images for the model", () => {
  const big = () =>
    sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#7a6a55" } })
      .jpeg()
      .toBuffer();

  it("makes a photo about 1024 px on its long side, as a JPEG", async () => {
    const small = await imageForModel(await big());
    const meta = await sharp(small).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(MODEL_IMAGE_SIDE);
  });

  it("reads each photo from storage and names those it could not read", async () => {
    const image = await big();
    const plan = planPhotos([onScreen(1), onScreen(2)], [row(1), row(2)], null);
    const keys: string[] = [];
    const { images, failed } = await imagesForModel(plan.toLook, async (key) => {
      keys.push(key);
      if (key === "p/2/full.jpg") throw new Error("missing");
      return image;
    });
    expect(keys.sort()).toEqual(["p/1/full.jpg", "p/2/full.jpg"]);
    expect(images.map((one) => one.number)).toEqual([1]);
    expect(failed).toEqual([ID(2)]);
  });
});

describe("tidyCaption", () => {
  it("puts a description on one line, without quotes", () => {
    expect(tidyCaption("  « Conduite 200 mm\n en place »  ")).toBe("Conduite 200 mm en place");
  });
  it("cuts a long one between two words", () => {
    const long = "regard ".repeat(100);
    const caption = tidyCaption(long);
    expect(caption.length).toBeLessThanOrEqual(PHOTO_CAPTION_MAX);
    expect(caption.endsWith("regard")).toBe(true);
  });
});

describe("captionsFromPatch", () => {
  const plan = planPhotos(
    [onScreen(1), onScreen(2), onScreen(3)],
    [row(1, "Tranchée"), row(2), row(3)],
    null,
  );
  const patch = (photos: DictationPatch["photos"]): DictationPatch => ({ ...nothing, photos });

  it("maps the numbers back to the photos, and drops what is not allowed", () => {
    const captions = captionsFromPatch(
      patch([
        { number: 2, description: "Regard R-4 en place" },
        { number: 2, description: "Une seconde fois" },
        { number: 7, description: "Hors de la liste" },
        { number: 3, description: "   " },
        { number: 1, description: "Tranchée" },
      ]),
      plan,
      null,
      new Set([2, 3]),
    );
    expect(captions).toEqual([{ photoId: ID(2), number: 2, caption: "Regard R-4 en place" }]);
  });

  it("lets a dictation describe a photo again when asked", () => {
    const captions = captionsFromPatch(
      patch([{ number: 1, description: "Tranchée côté nord" }]),
      plan,
      null,
      new Set(),
    );
    expect(captions).toEqual([{ photoId: ID(1), number: 1, caption: "Tranchée côté nord" }]);
  });

  it("describes only the photos looked at for the task, and none to tidy", () => {
    const answer = patch([
      { number: 1, description: "Autre chose" },
      { number: 3, description: "Remblai terminé" },
    ]);
    expect(captionsFromPatch(answer, plan, "describe", new Set([3]))).toEqual([
      { photoId: ID(3), number: 3, caption: "Remblai terminé" },
    ]);
    expect(captionsFromPatch(answer, plan, "tidy", new Set([3]))).toEqual([]);
  });
});
