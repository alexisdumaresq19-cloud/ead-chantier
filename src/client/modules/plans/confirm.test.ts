import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmAction } from "../../ui";
import { confirmDeliberately } from "./confirm";

vi.mock("../../ui", () => ({ confirmAction: vi.fn() }));

const ask = vi.mocked(confirmAction);
/** The person answers after `delay` ms. */
const answers = (answer: boolean, delay: number) => () =>
  new Promise<boolean>((resolve) => setTimeout(() => resolve(answer), delay));

describe("a confirmation that a double tap cannot give", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ask.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes a yes given after the question could be read", async () => {
    ask.mockImplementationOnce(answers(true, 1200));
    const confirmed = confirmDeliberately({ title: "Publier 3 feuilles?" });
    await vi.advanceTimersByTimeAsync(1200);
    expect(await confirmed).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again when the yes comes at once", async () => {
    ask.mockImplementationOnce(answers(true, 150)).mockImplementationOnce(answers(true, 900));
    const confirmed = confirmDeliberately({ title: "Publier 3 feuilles?" });
    await vi.advanceTimersByTimeAsync(150 + 900);
    expect(await confirmed).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("takes a no at any time", async () => {
    ask.mockImplementationOnce(answers(false, 100));
    const confirmed = confirmDeliberately({ title: "Archiver la feuille C-201?" });
    await vi.advanceTimersByTimeAsync(100);
    expect(await confirmed).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
