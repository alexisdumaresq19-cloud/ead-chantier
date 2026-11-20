import { and, asc, eq } from "drizzle-orm";

import { projectToChange } from "@/server/access";
import { countDictation } from "@/server/ai/usage";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { applyDictation, applyTidy, reportOnScreen } from "@/server/dictation/patch";
import {
  captionsFromPatch,
  imagesForModel,
  photosOnScreen,
  planPhotos,
  taskOf,
} from "@/server/dictation/photos";
import { AI_BUDGET_MS, readDictation, transcribeDictation } from "@/server/dictation/write";
import { badRequest, HttpError, route } from "@/server/http";
import { photoRowsByIds } from "@/server/photos/queries";
import { storage } from "@/server/storage";
import { DICTATION_MAX_BYTES, DICTATION_MAX_TEXT, type DictationResult } from "@/shared/dictation";

// Two calls to the AI service, one after the other: allow for a slow one.
// The calls themselves end within AI_BUDGET_MS of the request's start.
export const maxDuration = 90;

const AUDIO = /^audio\/(webm|mp4|ogg|wav|x-wav|mpeg|mp3|aac|x-m4a|m4a)\b/;

/**
 * Fills a daily report from what the foreman says (a recording or a text)
 * and the photos that go with it, or does a task without a dictation
 * (describe the photos, put the texts in clean French). Nothing is saved
 * here: the screen gives the photos their descriptions.
 */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const deadline = Date.now() + AI_BUDGET_MS;
  const user = await requireUser(request);
  await projectToChange(user, id);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest("Envoi illisible. Réessayez.");
  }
  let current: unknown;
  try {
    current = JSON.parse(String(form.get("current") ?? ""));
  } catch {
    throw badRequest("Rapport illisible. Réessayez.");
  }
  const report = reportOnScreen.parse(current);
  const asked = questionsAsked(form.get("asked"));
  const task = taskOf(form.get("task"));
  if (task === "invalid") throw badRequest("Demande inconnue.");
  // An id is only ever looked up among this project's photos.
  const onScreen = photosOnScreen(form.get("photos"), report.photoIds);
  const rows = await photoRowsByIds(
    id,
    onScreen.map((photo) => photo.id),
  );
  const plan = planPhotos(
    onScreen,
    rows.map((row) => row.photo),
    task,
  );

  const members = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(and(eq(schema.projectMembers.projectId, id), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.name));
  // The office dictates too, without being on the project's list.
  const known = members.some((member) => member.id === user.id)
    ? members
    : [...members, { id: user.id, name: user.name }];

  const audio = form.get("audio");
  const recorded = audio instanceof Blob && audio.size > 0 && !task ? audio : null;
  let heard = task ? "" : String(form.get("text") ?? "").trim();
  if (task === "describe") {
    if (plan.toLook.length === 0)
      throw new HttpError(
        422,
        "nothing_to_describe",
        "Toutes les photos reçues ont une description.",
      );
  } else if (task === "tidy") {
    if (![report.equipment, report.workDone, report.notes].some((text) => text.trim()))
      throw new HttpError(
        422,
        "nothing_to_tidy",
        "Le rapport n'a pas encore de texte à mettre au propre.",
      );
  } else if (recorded) {
    if (!AUDIO.test(recorded.type))
      throw badRequest("Cet enregistrement n'est pas dans un format accepté.");
    if (recorded.size > DICTATION_MAX_BYTES)
      throw badRequest("L'enregistrement est trop long. Dictez en plusieurs fois.");
  } else {
    if (heard.length > DICTATION_MAX_TEXT)
      throw badRequest("Le texte est trop long. Dictez en plusieurs fois.");
    if (heard.length < 3) throw nothingHeard();
  }

  // From here on the request costs money: it counts against the person's allowance.
  await countDictation(user.id);
  if (recorded) {
    heard = await transcribeDictation(
      new Uint8Array(await recorded.arrayBuffer()),
      known,
      deadline,
    );
    if (heard.length < 3) throw nothingHeard();
    heard = heard.slice(0, DICTATION_MAX_TEXT);
  }

  const { images, failed } = await imagesForModel(plan.toLook, (key) =>
    storage().get("public", key),
  );
  // A "describe" left with no image to look at asks nothing: it costs nothing more.
  const { patch, sawImages } = await readDictation(
    {
      heard,
      current: report,
      members: known,
      speaker: user.name,
      asked,
      task,
      photos: plan.listed,
      images,
    },
    { deadline },
  );
  // Each task changes only what it is for.
  const applied =
    task === "tidy"
      ? applyTidy(report, patch)
      : task === "describe"
        ? { content: report, changed: [], questions: [] }
        : applyDictation(report, patch, known);
  const looked = new Set(sawImages ? images.map((image) => image.number) : []);
  const captions = captionsFromPatch(patch, plan, { task, heard, looked });
  const unseen = [
    ...plan.notArrived,
    ...failed,
    ...(sawImages ? [] : plan.toLook.map((photo) => photo.id).filter((id) => !failed.includes(id))),
  ];
  return { heard, ...applied, captions, unseen, later: plan.later } satisfies DictationResult;
});

const nothingHeard = () =>
  new HttpError(
    422,
    "nothing_heard",
    "Je n'ai rien entendu. Réessayez en parlant plus près du micro.",
  );

/** The questions of the previous turn, as the screen sends them back: a few short lines at most. */
function questionsAsked(value: FormDataEntryValue | null): string[] {
  try {
    const list: unknown = JSON.parse(typeof value === "string" ? value : "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((question): question is string => typeof question === "string")
      .map((question) => question.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}
