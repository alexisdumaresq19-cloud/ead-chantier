import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  CircleHelp,
  Keyboard,
  LoaderCircle,
  Mic,
  RotateCcw,
  Send,
  Square,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  DICTATION_FIELD_LABELS,
  DICTATION_MAX_SECONDS,
  DICTATION_MAX_TEXT,
  type AssistantStatus,
  type DictationField,
  type DictationResult,
} from "@/shared/dictation";

import { api, ApiFailure, errorMessage } from "../../../lib/api";
import { cn } from "../../../lib/cn";
import { useOnline } from "../../../lib/online";
import { Button, Sheet, Textarea, toast } from "../../../ui";
import type { ReportForm } from "../form";
import { Notice } from "../status";
import { contentForDictation, formAfterDictation } from "./convert";
import { canRecord, useRecorder, type RecorderProblem, type Recording } from "./recorder";

// Dictating a report: the foreman talks, the report fills itself, and what is
// still missing comes back as questions to answer the same way. Nothing is
// saved here: the form is filled, then checked and saved as usual.

/** Whether reports can be dictated here; unknown (undefined) until the server said. */
export function useAssistant() {
  return useQuery({
    queryKey: ["assistant"],
    queryFn: () => api<AssistantStatus>("/api/assistant"),
    staleTime: 10 * 60 * 1000,
  });
}

type Job = { recording: Recording; text?: undefined } | { text: string; recording?: undefined };

type Turn = {
  id: number;
  heard: string;
  changed: DictationField[];
  questions: string[];
  /** The form as it was before this turn, while it can still be put back. */
  before: ReportForm | null;
};

const PROBLEMS: Record<RecorderProblem, string> = {
  denied:
    "Le micro est bloqué pour cette application. Autorisez-le dans les réglages du téléphone, ou écrivez votre texte.",
  unsupported:
    "Cet appareil ne peut pas enregistrer ici. Écrivez votre texte, ou servez-vous du micro du clavier.",
  failed: "L'enregistrement n'a pas fonctionné. Réessayez.",
};

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const EXTENSIONS: Record<string, string> = { webm: "webm", mp4: "m4a", ogg: "ogg" };
const fileName = (audio: Blob) =>
  `dictee.${EXTENSIONS[/^audio\/(\w+)/.exec(audio.type)?.[1] ?? ""] ?? "webm"}`;

export function DictationSheet({
  open,
  onClose,
  projectId,
  form,
  onApply,
  startRecording,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The report being written. */
  form: ReportForm;
  /** Receives the form once filled, and the parts that changed. */
  onApply: (next: ReportForm, changed: DictationField[]) => void;
  /** Opened by a tap on the microphone: recording starts at once. */
  startRecording: boolean;
}) {
  const online = useOnline();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [writing, setWriting] = useState(() => !canRecord());
  const [text, setText] = useState("");
  /** What could not be sent, kept so nothing has to be said twice. */
  const [failed, setFailed] = useState<{ job: Job; message: string; offline: boolean } | null>(
    null,
  );
  const latest = useRef(form);
  useEffect(() => {
    latest.current = form;
  });
  const nextId = useRef(1);
  const end = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (job: Job) => {
      const body = new FormData();
      body.set("day", latest.current.day);
      body.set("current", JSON.stringify(contentForDictation(latest.current)));
      body.set("asked", JSON.stringify(turns.at(-1)?.questions ?? []));
      if (job.recording) body.set("audio", job.recording.audio, fileName(job.recording.audio));
      else body.set("text", job.text);
      return api<DictationResult>(`/api/projects/${projectId}/reports/dictation`, {
        method: "POST",
        body,
      });
    },
    onMutate: () => setFailed(null),
    onSuccess: (result, job) => {
      const before = latest.current;
      onApply(formAfterDictation(before, result.content), result.changed);
      setTurns((list) => [
        ...list.map((turn) => ({ ...turn, before: null })),
        {
          id: nextId.current++,
          heard: result.heard,
          changed: result.changed,
          questions: result.questions,
          before,
        },
      ]);
      if (job.text !== undefined) setText("");
    },
    onError: (error, job) =>
      setFailed({
        job,
        message: errorMessage(error),
        offline: error instanceof ApiFailure && error.offline,
      }),
  });

  const recorder = useRecorder({
    maxSeconds: DICTATION_MAX_SECONDS,
    onDone: (recording) => {
      if (recording.seconds < 1) {
        toast.warning("Trop court. Appuyez, parlez, puis appuyez de nouveau.");
        return;
      }
      send.mutate({ recording });
    },
  });
  const { phase, start, cancel } = recorder;
  const recording = phase === "recording";
  const busy = send.isPending;

  // Opened by the microphone button: the same tap starts the recording.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && startRecording && canRecord() && online) void start();
    if (!open && wasOpen.current) {
      cancel();
      // Once the window is closed the form can be edited by hand: a turn can
      // no longer be put back without losing that.
      setTurns((list) => list.map((turn) => ({ ...turn, before: null })));
    }
    wasOpen.current = open;
  }, [open, startRecording, online, start, cancel]);

  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [open, turns.length, busy, failed, recorder.problem]);

  const undo = (turn: Turn) => {
    if (!turn.before) return;
    onApply(turn.before, []);
    setTurns((list) => list.filter((other) => other.id !== turn.id));
  };

  const sendText = () => {
    const said = text.trim();
    if (said.length >= 3) send.mutate({ text: said });
  };

  const left = DICTATION_MAX_SECONDS - recorder.seconds;
  const status = recording
    ? left <= 15
      ? `Encore ${left} s`
      : "Appuyez pour terminer"
    : phase === "asking"
      ? "Autorisez le micro…"
      : busy
        ? "Un instant…"
        : turns.length > 0
          ? "Appuyez pour ajouter ou répondre"
          : "Appuyez pour parler";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Dicter le rapport"
      description={
        turns.length === 0
          ? "Racontez votre journée. Le rapport se remplit, vous le vérifiez, puis vous l'enregistrez."
          : undefined
      }
      footer={
        <div className="w-full">
          {writing ? (
            <div className="space-y-2">
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={DICTATION_MAX_TEXT}
                rows={3}
                data-autofocus
                aria-label="Votre texte"
                placeholder="Écrivez, ou dictez avec le micro du clavier…"
                className="field-sizing-content max-h-40 min-h-24 resize-none"
              />
              <div className="flex gap-2">
                {canRecord() ? (
                  <Button variant="secondary" onClick={() => setWriting(false)} disabled={busy}>
                    <Mic aria-hidden />
                    Micro
                  </Button>
                ) : null}
                <Button
                  className="flex-1"
                  onClick={sendText}
                  loading={busy}
                  disabled={text.trim().length < 3 || !online}
                >
                  {busy ? null : <Send aria-hidden />}
                  Envoyer
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="justify-self-start">
                {recording ? (
                  <Button variant="ghost" onClick={cancel}>
                    Annuler
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setWriting(true)} disabled={busy}>
                    <Keyboard aria-hidden />
                    Écrire
                  </Button>
                )}
              </div>
              <MicButton
                recording={recording}
                waiting={phase === "asking" || busy}
                level={recorder.level}
                disabled={!online}
                onPress={recording ? recorder.stop : () => void start()}
              />
              <div className="justify-self-end">
                {turns.length > 0 && !recording ? (
                  <Button variant="secondary" onClick={onClose} disabled={busy}>
                    Terminé
                  </Button>
                ) : null}
              </div>
              <p
                aria-live="polite"
                className="text-dim col-span-3 text-center text-sm font-medium tabular-nums"
              >
                {recording ? (
                  <span className="text-text font-display mr-2 text-base font-bold">
                    {clock(recorder.seconds)}
                  </span>
                ) : null}
                {status}
              </p>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {turns.length === 0 && !busy ? <Example /> : null}

        {turns.map((turn, index) => (
          <TurnView
            key={turn.id}
            turn={turn}
            crew={
              index === turns.length - 1 ? form.crew.filter((row) => row.name.trim()).length : 0
            }
            onUndo={turn.before && !busy && !recording ? () => undo(turn) : null}
          />
        ))}

        {busy ? (
          <p
            role="status"
            className="text-dim animate-fade flex items-center gap-2.5 px-1 py-2 text-[15px] font-medium"
          >
            <LoaderCircle className="text-ead size-5 animate-spin" aria-hidden />
            Je rédige le rapport…
          </p>
        ) : null}

        {failed ? (
          <Notice
            tone={failed.offline ? "warn" : "bad"}
            icon={failed.offline ? <WifiOff aria-hidden /> : <TriangleAlert aria-hidden />}
          >
            <p>
              {failed.offline
                ? "Pas de réseau. Ce que vous avez dit est gardé ici : renvoyez-le quand le réseau revient."
                : failed.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => send.mutate(failed.job)}
              disabled={busy}
            >
              <RotateCcw aria-hidden />
              Renvoyer
            </Button>
          </Notice>
        ) : null}

        {recorder.problem && !writing ? (
          <Notice tone="bad" icon={<TriangleAlert aria-hidden />}>
            {PROBLEMS[recorder.problem]}
          </Notice>
        ) : null}

        {!online && !failed ? (
          <Notice tone="warn" icon={<WifiOff aria-hidden />}>
            La dictée demande du réseau. Sans réseau, remplissez le rapport à la main : il reste
            gardé sur cet appareil.
          </Notice>
        ) : null}

        <div ref={end} />
      </div>
    </Sheet>
  );
}

function Example() {
  return (
    <div className="bg-canvas rounded-2xl px-4 py-3.5">
      <p className="text-dim text-xs font-semibold tracking-wide uppercase">Par exemple</p>
      <p className="mt-1.5 text-[15px] leading-relaxed">
        «&nbsp;Soleil, moins deux ce matin. Marc, Simon et moi, dix heures chacun. On a posé
        quarante mètres d&apos;aqueduc entre R-3 et R-4. La pelle et deux camions. L&apos;ingénieur
        est passé, il veut un essai de compaction demain.&nbsp;»
      </p>
      <p className="text-dim mt-2.5 text-sm">
        Votre voix est transcrite par un service d&apos;intelligence artificielle.
        L&apos;application ne garde pas l&apos;enregistrement.
      </p>
    </div>
  );
}

function TurnView({
  turn,
  crew,
  onUndo,
}: {
  turn: Turn;
  /** The people now in the report, for the latest turn (0 hides the count). */
  crew: number;
  onUndo: (() => void) | null;
}) {
  const [whole, setWhole] = useState(false);
  const long = turn.heard.length > 220;
  return (
    <div className="animate-rise space-y-2">
      <div className="bg-ead-tint ml-8 rounded-2xl rounded-br-md px-3.5 py-2.5">
        <p className={cn("text-[15px] leading-relaxed", long && !whole && "line-clamp-4")}>
          {turn.heard}
        </p>
        {long ? (
          <button
            type="button"
            onClick={() => setWhole((shown) => !shown)}
            className="text-ead-dark mt-1 cursor-pointer text-sm font-semibold"
          >
            {whole ? "Réduire" : "Tout lire"}
          </button>
        ) : null}
      </div>

      <div className="border-line mr-8 rounded-2xl rounded-bl-md border px-3.5 py-3">
        {turn.changed.length > 0 ? (
          <>
            <p className="text-sm font-semibold">C&apos;est noté</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {turn.changed.map((field) => (
                <li
                  key={field}
                  className="bg-good-tint text-good inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold"
                >
                  <Check className="size-4" aria-hidden />
                  {DICTATION_FIELD_LABELS[field]}
                  {field === "crew" && crew > 0 ? ` · ${crew}` : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[15px]">
            Je n&apos;ai rien trouvé à inscrire dans ce que vous avez dit.
          </p>
        )}

        {turn.questions.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-semibold">Il me manque</p>
            <ul className="mt-1 space-y-1">
              {turn.questions.map((question) => (
                <li key={question} className="flex items-start gap-2 text-[15px] leading-snug">
                  <CircleHelp className="text-ead mt-0.5 size-4.5 shrink-0" aria-hidden />
                  {question}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {onUndo && turn.changed.length > 0 ? (
          <button
            type="button"
            onClick={onUndo}
            className="text-dim hover:text-text mt-2 -mb-1 inline-flex h-9 cursor-pointer items-center gap-1.5 text-sm font-semibold"
          >
            <RotateCcw className="size-4" aria-hidden />
            Annuler cette dictée
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The one large control: press to talk, press again when done. */
function MicButton({
  recording,
  waiting,
  level,
  disabled,
  onPress,
}: {
  recording: boolean;
  waiting: boolean;
  level: number;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <span className="relative grid size-22 place-items-center">
      {/* The ring follows the voice, so the person sees they are heard. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-2 rounded-full transition-transform duration-100 ease-out",
          recording ? "bg-bad/20" : "bg-ead/15",
        )}
        style={{ transform: `scale(${recording ? 1 + level * 0.35 : 1})` }}
      />
      <button
        type="button"
        onClick={onPress}
        disabled={disabled || waiting}
        aria-label={recording ? "Terminer l'enregistrement" : "Parler"}
        aria-pressed={recording}
        className={cn(
          "relative grid size-18 cursor-pointer place-items-center rounded-full text-white shadow-lg transition-colors select-none",
          "active:scale-95 disabled:pointer-events-none",
          recording ? "bg-bad" : "bg-ead-dark hover:bg-ead-darker",
          disabled && "opacity-50",
        )}
      >
        {waiting ? (
          <LoaderCircle className="size-8 animate-spin" aria-hidden />
        ) : recording ? (
          <Square className="size-7 fill-current" aria-hidden />
        ) : (
          <Mic className="size-8" aria-hidden />
        )}
      </button>
    </span>
  );
}

/** The way in, at the top of the report: one tap and the person is talking. */
export function DictationCard({
  onOpen,
}: {
  /** `record` is true when the tap should start the recording at once. */
  onOpen: (record: boolean) => void;
}) {
  const online = useOnline();
  return (
    <button
      type="button"
      onClick={() => onOpen(online)}
      className="bg-ink flex w-full cursor-pointer items-center gap-4 rounded-2xl p-4 text-left text-white shadow-sm transition-transform active:scale-[0.99]"
    >
      <span className="bg-ead grid size-14 shrink-0 place-items-center rounded-full shadow-md">
        <Mic className="size-7" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-display block text-lg leading-tight font-bold">
          Dicter le rapport
        </span>
        <span className="mt-0.5 block text-sm text-white/70">
          {online
            ? "Racontez votre journée, le rapport se remplit."
            : "Demande du réseau. Sans réseau, remplissez à la main."}
        </span>
      </span>
    </button>
  );
}
