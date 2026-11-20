// The assistant's answer read aloud by the phone itself, for those who want
// to dictate without looking at the screen. Off until the person turns it on.

const KEY = "ead:dictee:voix";

/** Whether this device can read a text aloud. */
export const canSpeak = () =>
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  typeof SpeechSynthesisUtterance !== "undefined";

export function wantsAnswersAloud(): boolean {
  try {
    return canSpeak() && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAnswersAloud(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Not kept: the choice holds for this visit only.
  }
  if (!on) stopSpeaking();
}

/** A French voice of this device, Canadian first. */
function frenchVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((voice) => /^fr\b/i.test(voice.lang));
  return (
    voices.find((voice) => /^fr[-_]CA$/i.test(voice.lang)) ??
    voices.find((voice) => voice.default) ??
    voices[0] ??
    null
  );
}

/**
 * To be called inside a tap: an iPhone only speaks later, by itself, once a
 * tap has made it speak (even nothing).
 */
export function prepareSpeech() {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
  } catch {
    // No voice on this device.
  }
}

export function speak(text: string) {
  if (!canSpeak() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = frenchVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "fr-CA";
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch {
    // No voice on this device.
  }
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing was being said.
  }
}
