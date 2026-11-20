import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { transcribe } from "ai";

import type { ReportContent } from "@/shared/reports";

import { aiIsFake, claude, CLAUDE_MODEL, TRANSCRIPTION_MODEL } from "../ai/gateway";
import { HttpError } from "../http";
import { dictationPatch, type DictationPatch, type KnownPerson } from "./patch";

// From a foreman's voice to the change to make to a daily report: the
// recording is turned into text, then Claude reads that text and says what
// goes in each part of the report.

const unavailable = () =>
  new HttpError(
    503,
    "assistant_unavailable",
    "La dictée n'est pas disponible pour le moment. Remplissez le rapport à la main.",
  );

const SYSTEM = `Tu aides un contremaître de génie civil au Québec à remplir son rapport journalier de chantier. Il dicte sa journée à voix haute. Le texte que tu reçois vient d'une reconnaissance vocale et peut contenir des mots mal reconnus. Tu en tires ce qui va dans chaque case du rapport.

Les cases du rapport :
- météo : la condition (soleil, nuageux, pluie, neige, vent ou brouillard), la température en degrés Celsius, une courte note ;
- équipe : les personnes présentes et leurs heures ;
- équipement : les machines et outils utilisés ;
- travaux réalisés ;
- notes : retards, incidents, visiteurs, consignes reçues.

Comment remplir :
- Inscris seulement ce qui a été dit. Une case dont il n'a pas parlé reste à null, et la liste de l'équipe reste vide s'il n'a nommé personne. N'ajoute aucune supposition.
- Rédige en français simple et correct, en phrases courtes, comme un contremaître soigneux l'écrirait. Corrige ce que la dictée a mal reconnu en t'aidant du vocabulaire de chantier (regard, puisard, conduite, aqueduc, égout pluvial ou sanitaire, ponceau, MG-20, MG-112, compaction, remblai, pavage, pelle, rouleau, niveleuse, camion 10 roues). Retire les hésitations et les répétitions. Garde tels quels les chiffres, les unités, les numéros de regards et les chaînages.
- Le texte que tu donnes pour équipement, travaux et notes s'ajoute à ce que la case contient déjà : ne répète pas ce qui s'y trouve. Mets replace à true pour une case seulement s'il demande de la refaire ou de la corriger ; ton texte la remplace alors au complet.
- Équipe : une entrée par personne nommée. Quand un prénom ou un nom correspond à une seule personne de la liste des membres du projet, donne son nom complet tel qu'il est dans la liste. « Moi » et « je » désignent la personne qui dicte. Les heures sont un nombre décimal (7 h 30 donne 7.5). « Dix heures chacun » vaut pour toutes les personnes qu'il vient de nommer. Laisse hours à null si les heures n'ont pas été dites. Mets remove à true s'il dit qu'une personne n'était pas là ou qu'il faut la retirer. S'il donne un nombre de personnes sans les nommer, n'invente pas de noms : pose plutôt une question.
- Température : un nombre entier, négatif sous zéro (« moins cinq » donne -5).
- Quand des questions viennent de lui être posées, ce qu'il dit y répond souvent en peu de mots (« dix heures », « oui, tous les trois ») : rattache alors sa réponse à la question et à la personne concernées.
- questions : au plus trois questions courtes, au vouvoiement, sur ce qui manque d'essentiel une fois le rapport actuel et la dictée réunis : la météo, les heures d'une personne, les travaux réalisés. Si rien d'essentiel ne manque, la liste est vide.`;

const WEEKDAY = new Intl.DateTimeFormat("fr-CA", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export type DictationInput = {
  /** What was said, as text. */
  heard: string;
  current: ReportContent;
  members: KnownPerson[];
  /** The name of the person dictating: "moi" is them. */
  speaker: string;
  /** The questions asked after the previous dictation: this one may answer them. */
  asked: string[];
};

/** What Claude is given: the context first, then what was said. */
export function dictationMessage(input: DictationInput): string {
  const { heard, current, members, speaker, asked } = input;
  const day = WEEKDAY.format(new Date(`${current.day}T12:00:00`));
  const report = {
    météo: current.weather,
    // Hours at zero are hours nobody gave yet.
    équipe: current.crew.map((line) => ({ nom: line.name, heures: line.hours || null })),
    équipement: current.equipment,
    travaux: current.workDone,
    notes: current.notes,
  };
  return [
    `Jour du rapport : ${day}`,
    `Personne qui dicte : ${speaker}`,
    `Membres du projet : ${members.map((member) => member.name).join(" ; ") || "aucun inscrit"}`,
    `Rapport actuel : ${JSON.stringify(report)}`,
    ...(asked.length > 0
      ? [
          `Questions que tu viens de lui poser : ${asked.map((question) => `« ${question} »`).join(" ")}`,
        ]
      : []),
    "Ce que le contremaître vient de dicter :",
    `<dictee>\n${heard}\n</dictee>`,
  ].join("\n\n");
}

/** The words spoken in a recording. */
export async function transcribeDictation(
  audio: Uint8Array,
  members: KnownPerson[],
): Promise<string> {
  if (aiIsFake())
    return "Soleil, moins deux degrés. Marc Lévesque, dix heures. On a posé la conduite d'aqueduc.";
  try {
    const result = await transcribe({
      model: TRANSCRIPTION_MODEL,
      audio,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(45_000),
      providerOptions: {
        openai: {
          language: "fr",
          // Names and trade words the recognition should expect.
          prompt: `Rapport journalier d'un chantier de génie civil au Québec. ${members
            .map((member) => member.name)
            .join(
              ", ",
            )}. Regard, puisard, aqueduc, égout pluvial, ponceau, MG-20, compaction, remblai, pelle, rouleau, niveleuse.`,
        },
      },
    });
    return result.text.trim();
  } catch (error) {
    console.error("dictation: transcription failed", error);
    throw unavailable();
  }
}

/** What to change in the report, from what was said. */
export async function readDictation(input: DictationInput): Promise<DictationPatch> {
  if (aiIsFake()) return fakePatch(input.heard);
  const client = await claude();
  if (!client) throw unavailable();
  try {
    const response = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: dictationMessage(input) }],
      // A quick, bounded reading task: low effort keeps the wait short.
      output_config: { effort: "low", format: zodOutputFormat(dictationPatch) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      console.error("dictation: no usable answer", response.stop_reason);
      return asWorkDone(input.heard);
    }
    return response.parsed_output;
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`dictation: the AI service answered ${error.status}`, error.message);
      throw unavailable();
    }
    throw error;
  }
}

/** When the text cannot be sorted into the report's parts, none of it is lost: it goes to the work done. */
function asWorkDone(heard: string): DictationPatch {
  return {
    weather: { condition: null, temperatureC: null, note: null },
    crew: [],
    equipment: null,
    workDone: heard,
    notes: null,
    replace: { equipment: false, workDone: false, notes: false },
    questions: [],
  };
}

/** For tests, with no AI service: a few fixed rules instead of a model. */
function fakePatch(heard: string): DictationPatch {
  const patch = asWorkDone(heard);
  if (/soleil/i.test(heard)) patch.weather.condition = "soleil";
  const below = /moins (\w+)/i.exec(heard);
  if (below)
    patch.weather.temperatureC = -(
      { un: 1, deux: 2, cinq: 5, dix: 10 }[below[1].toLowerCase()] ?? 1
    );
  if (/marc l[ée]vesque/i.test(heard))
    patch.crew.push({ name: "Marc Lévesque", hours: 10, remove: false });
  return patch;
}
