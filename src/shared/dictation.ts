// Dictating the daily report: the foreman talks, the report fills itself.
//
//   GET  /api/assistant                                   { dictation: boolean }
//   POST /api/projects/:id/reports/dictation              multipart form:
//          audio    a recording (webm, mp4, ogg, wav or mp3; 4 MB at most), or
//          text     what was said, typed or dictated with the keyboard
//          day      the report's day, "2026-10-01"
//          current  the report as it stands on screen (ReportContent, as JSON)
//          asked    the questions of the previous answer, if any (JSON list)
//          photos   the report's photos as the screen numbers them (DictationPhoto[],
//                   as JSON; the first is "photo 1")
//          task     instead of audio or text: "describe" (give the photos without a
//                   description one) or "tidy" (rewrite the texts cleanly)
//        → DictationResult
//
// For foremen and the office, like the reports themselves. The report is not
// saved: the screen shows the result and the person saves it as usual. The
// photos' descriptions are the project's: the screen gives them at once.

import type { ReportContent } from "./reports";

export type AssistantStatus = {
  /** Whether reports can be dictated here (the AI service is reachable). */
  dictation: boolean;
};

export type DictationField = "weather" | "crew" | "equipment" | "workDone" | "notes";

export const DICTATION_FIELD_LABELS: Record<DictationField, string> = {
  weather: "Météo",
  crew: "Équipe",
  equipment: "Équipement",
  workDone: "Travaux réalisés",
  notes: "Notes",
};

/** What the assistant can do without being told anything. */
export type AssistantTask = "describe" | "tidy";

export const ASSISTANT_TASKS: readonly AssistantTask[] = ["describe", "tidy"];

export const ASSISTANT_TASK_LABELS: Record<AssistantTask, string> = {
  describe: "Décrire les photos",
  tidy: "Mettre au propre",
};

/** A photo of the report, as the screen sends it. */
export type DictationPhoto = {
  id: string;
  /** Its description, if it has one. */
  caption: string | null;
  /** When it was taken, ISO 8601. */
  takenAt: string;
  /** The project has it (one still on the phone cannot be looked at). */
  onServer: boolean;
};

/** Photos the assistant looks at in one request, at most: the others wait for the next. */
export const PHOTOS_LOOKED_AT = 8;

export type PhotoCaption = {
  photoId: string;
  /** Its number on screen when it was sent. */
  number: number;
  caption: string;
};

export type DictationResult = {
  /** What was understood, word for word: shown so the person can check it. Empty for a task. */
  heard: string;
  /** The report with what was said put in its place. */
  content: ReportContent;
  /** The parts of the report that changed. */
  changed: DictationField[];
  /** What is still missing, as short questions (three at most). */
  questions: string[];
  /** New descriptions for photos, to be given to them. */
  captions: PhotoCaption[];
  /** Photos without a description that could not be looked at (still on the phone, unreadable, refused). */
  unseen: string[];
  /** Photos without a description left for the next time: one request looks at a few only. */
  later: string[];
};

/** A recording longer than this is cut: speak in several goes instead. */
export const DICTATION_MAX_SECONDS = 180;
export const DICTATION_MAX_BYTES = 4 * 1024 * 1024;
export const DICTATION_MAX_TEXT = 8000;
