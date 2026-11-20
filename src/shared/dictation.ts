// Dictating the daily report: the foreman talks, the report fills itself.
//
//   GET  /api/assistant                                   { dictation: boolean }
//   POST /api/projects/:id/reports/dictation              multipart form:
//          audio    a recording (webm, mp4, ogg, wav or mp3; 4 MB at most), or
//          text     what was said, typed or dictated with the keyboard
//          day      the report's day, "2026-10-01"
//          current  the report as it stands on screen (ReportContent, as JSON)
//          asked    the questions of the previous answer, if any (JSON list)
//        → DictationResult
//
// For foremen and the office, like the reports themselves. Nothing is saved:
// the screen shows the result and the person saves the report as usual.

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

export type DictationResult = {
  /** What was understood, word for word: shown so the person can check it. */
  heard: string;
  /** The report with what was said put in its place. */
  content: ReportContent;
  /** The parts of the report that changed. */
  changed: DictationField[];
  /** What is still missing, as short questions (three at most). */
  questions: string[];
};

/** A recording longer than this is cut: speak in several goes instead. */
export const DICTATION_MAX_SECONDS = 180;
export const DICTATION_MAX_BYTES = 4 * 1024 * 1024;
export const DICTATION_MAX_TEXT = 8000;
