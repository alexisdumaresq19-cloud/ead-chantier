import { and, asc, eq } from "drizzle-orm";

import { projectToChange } from "@/server/access";
import { countDictation } from "@/server/ai/usage";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { applyDictation, reportOnScreen } from "@/server/dictation/patch";
import { readDictation, transcribeDictation } from "@/server/dictation/write";
import { badRequest, HttpError, route } from "@/server/http";
import { DICTATION_MAX_BYTES, DICTATION_MAX_TEXT, type DictationResult } from "@/shared/dictation";

// Two calls to the AI service, one after the other: allow for a slow one.
export const maxDuration = 90;

const AUDIO = /^audio\/(webm|mp4|ogg|wav|x-wav|mpeg|mp3|aac|x-m4a|m4a)\b/;

/**
 * Fills a daily report from what the foreman says: a recording or a text,
 * and the report as it stands on screen. Nothing is saved here.
 */
export const POST = route<{ id: string }>(async (request, { id }) => {
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
  const recorded = audio instanceof Blob && audio.size > 0 ? audio : null;
  let heard = String(form.get("text") ?? "").trim();
  if (recorded) {
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
    heard = await transcribeDictation(new Uint8Array(await recorded.arrayBuffer()), known);
    if (heard.length < 3) throw nothingHeard();
    heard = heard.slice(0, DICTATION_MAX_TEXT);
  }

  const patch = await readDictation({
    heard,
    current: report,
    members: known,
    speaker: user.name,
    asked,
  });
  const applied = applyDictation(report, patch, known);
  return { heard, ...applied } satisfies DictationResult;
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
