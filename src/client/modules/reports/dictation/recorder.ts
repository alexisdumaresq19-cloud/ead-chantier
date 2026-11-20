import { useCallback, useEffect, useRef, useState } from "react";

// Recording the foreman's voice with the phone's microphone. The recording
// is small on purpose (speech, 32 kbit/s): three minutes weigh under a
// megabyte and leave on a weak signal.

export type RecorderProblem =
  /** The person, or the phone's settings, refused the microphone. */
  | "denied"
  /** This browser cannot record. */
  | "unsupported"
  /** No microphone answered, or the recording broke. */
  | "failed";

export type Recording = { audio: Blob; seconds: number };

// What phones record, best first: Android and recent iPhones (webm), older iPhones (mp4).
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/** Whether this device can record at all. */
export const canRecord = () =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

type Session = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  /** False when the recording is thrown away instead of being handed over. */
  keep: boolean;
  context: AudioContext | null;
  frame: number;
  timer: number;
  lock: WakeLockSentinel | null;
};

/**
 * A recorder for one recording at a time. `onDone` receives the recording
 * when it stops by itself or by `stop()`; `cancel()` throws it away.
 */
export function useRecorder({
  maxSeconds,
  onDone,
}: {
  maxSeconds: number;
  onDone: (recording: Recording) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "asking" | "recording">("idle");
  const [problem, setProblem] = useState<RecorderProblem | null>(null);
  const [seconds, setSeconds] = useState(0);
  /** How loud the voice is right now, from 0 to 1. */
  const [level, setLevel] = useState(0);
  const session = useRef<Session | null>(null);
  /** Set when the person gave up while the phone was still asking for the microphone. */
  const gaveUp = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  const release = useCallback((current: Session) => {
    window.clearInterval(current.timer);
    cancelAnimationFrame(current.frame);
    for (const track of current.stream.getTracks()) track.stop();
    void current.context?.close().catch(() => {});
    void current.lock?.release().catch(() => {});
    if (session.current === current) session.current = null;
    setLevel(0);
  }, []);

  const finish = useCallback((keep: boolean) => {
    gaveUp.current = !keep;
    const current = session.current;
    if (!current) return;
    current.keep = keep;
    if (current.recorder.state !== "inactive") current.recorder.stop();
  }, []);
  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  const start = useCallback(async () => {
    if (session.current || phase !== "idle") return;
    setProblem(null);
    if (!canRecord()) {
      setProblem("unsupported");
      return;
    }
    gaveUp.current = false;
    setPhase("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // A site is loud: the phone's own noise filter helps the transcription.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      setPhase("idle");
      const name = error instanceof DOMException ? error.name : "";
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
      return;
    }
    if (gaveUp.current) {
      for (const track of stream.getTracks()) track.stop();
      setPhase("idle");
      return;
    }

    let recorder: MediaRecorder;
    try {
      const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setPhase("idle");
      setProblem("unsupported");
      return;
    }

    const current: Session = {
      stream,
      recorder,
      chunks: [],
      startedAt: performance.now(),
      keep: true,
      context: null,
      frame: 0,
      timer: 0,
      lock: null,
    };
    session.current = current;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) current.chunks.push(event.data);
    };
    recorder.onerror = () => {
      current.keep = false;
      setProblem("failed");
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.onstop = () => {
      const length = Math.round((performance.now() - current.startedAt) / 1000);
      const type = recorder.mimeType || current.chunks[0]?.type || "audio/webm";
      release(current);
      setPhase("idle");
      setSeconds(0);
      if (!current.keep) return;
      const audio = new Blob(current.chunks, { type });
      if (audio.size > 0) done.current({ audio, seconds: length });
      else setProblem("failed");
    };

    // The level of the voice, for the ring around the button. Without it the
    // recording works just the same.
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      current.context = context;
      const samples = new Uint8Array(analyser.fftSize);
      let shownAt = 0;
      const measure = (now: number) => {
        current.frame = requestAnimationFrame(measure);
        if (now - shownAt < 70) return;
        shownAt = now;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        // Speech sits around 0.05 to 0.3: stretched so the ring moves visibly.
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
      };
      current.frame = requestAnimationFrame(measure);
    } catch {
      // No meter on this browser.
    }

    // The screen stays on while the person talks.
    void navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        if (session.current === current) current.lock = lock;
        else void lock.release();
      })
      .catch(() => {});

    current.timer = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - current.startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) finish(true);
    }, 250);

    recorder.start(1000);
    setSeconds(0);
    setPhase("recording");
  }, [phase, maxSeconds, finish, release]);

  // A phone that locks, or an app sent to the background, stops recording:
  // what was said so far is kept.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) finish(true);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [finish]);

  // Leaving the screen lets go of the microphone.
  useEffect(
    () => () => {
      const current = session.current;
      if (!current) return;
      current.keep = false;
      if (current.recorder.state !== "inactive") current.recorder.stop();
      release(current);
    },
    [release],
  );

  return { phase, problem, seconds, level, start, stop, cancel };
}
