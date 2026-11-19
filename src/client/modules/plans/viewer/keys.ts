// The viewer's keyboard, for the office's computers.

export type KeyCommand =
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "rotate"
  | "pan-left"
  | "pan-right"
  | "pan-up"
  | "pan-down"
  | "next"
  | "previous"
  | "back";

const commands: Record<string, KeyCommand> = {
  "+": "zoom-in",
  "=": "zoom-in",
  "-": "zoom-out",
  _: "zoom-out",
  "0": "fit",
  r: "rotate",
  R: "rotate",
  ArrowLeft: "pan-left",
  ArrowRight: "pan-right",
  ArrowUp: "pan-up",
  ArrowDown: "pan-down",
  PageDown: "next",
  "]": "next",
  PageUp: "previous",
  "[": "previous",
  Escape: "back",
};

/**
 * What a key press asks of the viewer, if anything. Shortcuts of the browser
 * (Ctrl and + to zoom the page, Alt and ← to go back) are left to it.
 */
export function keyCommand(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): KeyCommand | null {
  // On a Canadian French keyboard the brackets are typed with AltGr, which
  // Windows reports as Ctrl and Alt held together.
  const altGr = event.ctrlKey && event.altKey;
  if (event.metaKey || ((event.ctrlKey || event.altKey) && !altGr)) return null;
  return Object.hasOwn(commands, event.key) ? commands[event.key] : null;
}
