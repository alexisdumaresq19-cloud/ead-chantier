import { describe, expect, it } from "vitest";

import { DICTATIONS_PER_DAY, DICTATIONS_PER_HOUR, exceedsDictationAllowance } from "./usage";

describe("exceedsDictationAllowance", () => {
  it("lets a day's work through", () => {
    expect(exceedsDictationAllowance(0, 0)).toBe(false);
    expect(exceedsDictationAllowance(DICTATIONS_PER_HOUR - 1, DICTATIONS_PER_DAY - 1)).toBe(false);
  });
  it("stops at the hour's or the day's allowance", () => {
    expect(exceedsDictationAllowance(DICTATIONS_PER_HOUR, DICTATIONS_PER_HOUR)).toBe(true);
    expect(exceedsDictationAllowance(0, DICTATIONS_PER_DAY)).toBe(true);
  });
});
