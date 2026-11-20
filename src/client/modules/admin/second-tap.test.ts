import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmAction } from "../../ui";
import { confirmCalmly, ignoreSecondTap } from "./second-tap";

vi.mock("../../ui", () => ({ confirmAction: vi.fn(async () => true) }));

/** A tap on the screen; true when it was swallowed before reaching anything. */
function tap(): boolean {
  const click = new Event("click", { cancelable: true });
  window.dispatchEvent(click);
  return click.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ignoreSecondTap", () => {
  it("swallows the taps that follow at once, then lets them through again", () => {
    expect(tap()).toBe(false);
    ignoreSecondTap();
    expect(tap()).toBe(true);
    vi.advanceTimersByTime(399);
    expect(tap()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tap()).toBe(false);
  });

  it("keeps quiet until the last call has run out", () => {
    ignoreSecondTap();
    vi.advanceTimersByTime(300);
    ignoreSecondTap();
    vi.advanceTimersByTime(300);
    expect(tap()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(tap()).toBe(false);
  });
});

describe("confirmCalmly", () => {
  it("asks the question with the taps held back, and gives the answer", async () => {
    const question = { title: "Retirer cette personne?", danger: true };
    const answer = confirmCalmly(question);
    expect(confirmAction).toHaveBeenCalledWith(question);
    expect(tap()).toBe(true);
    await expect(answer).resolves.toBe(true);
  });
});
