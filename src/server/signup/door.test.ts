import { describe, expect, it } from "vitest";

import { SIGNUP_LIMITS, signupLimitsFrom } from "../env";
import { addressOf, doorRefusal, fullUntil, tooMany, whenText } from "./door";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const now = new Date("2026-11-20T15:00:00Z"); // 10 h, Québec time
const ago = (ms: number) => new Date(now.getTime() - ms);
/** n times, newest first, `step` apart, the newest `first` ago. */
const times = (n: number, first: number, step: number) =>
  Array.from({ length: n }, (_, i) => ago(first + i * step));
const limits = { triesPerHour: 5, wrongCodesPerDay: 40, accountsPerDay: 30 };
const none = { address: [], wrongCodes: [], accounts: [] };

describe("fullUntil", () => {
  it("has room while fewer than the limit are in the window", () => {
    expect(fullUntil(times(4, 0, MINUTE), 5, HOUR)).toBeNull();
  });

  it("is full until the limit-th newest leaves the window", () => {
    const tries = times(5, 10 * MINUTE, MINUTE); // 10 to 14 minutes ago
    expect(fullUntil(tries, 5, HOUR)).toEqual(new Date(now.getTime() + 46 * MINUTE));
  });
});

describe("doorRefusal", () => {
  it("lets a handful of tries per address per hour through", () => {
    expect(doorRefusal(none, limits)).toBeNull();
    expect(doorRefusal({ ...none, address: times(4, 0, MINUTE) }, limits)).toBeNull();
    expect(doorRefusal({ ...none, address: times(5, 0, MINUTE) }, limits)).toEqual({
      reason: "address",
      retryAt: new Date(now.getTime() + HOUR - 4 * MINUTE),
    });
  });

  it("pauses for everyone once the day's wrong codes are spent", () => {
    const wrong = times(40, 0, 10 * MINUTE);
    expect(doorRefusal({ ...none, wrongCodes: wrong }, limits)?.reason).toBe("everyone");
    expect(doorRefusal({ ...none, wrongCodes: wrong.slice(1) }, limits)).toBeNull();
  });

  it("stops at the day's ceiling of accounts", () => {
    expect(doorRefusal({ ...none, accounts: times(30, 0, MINUTE) }, limits)?.reason).toBe(
      "accounts",
    );
  });

  it("names the pause for everyone first: it is what lasts longest", () => {
    const refusal = doorRefusal(
      { address: times(5, 0, MINUTE), wrongCodes: times(40, 0, MINUTE), accounts: [] },
      limits,
    );
    expect(refusal?.reason).toBe("everyone");
  });
});

describe("what the refusal says", () => {
  it("says when, in Québec time, today or tomorrow", () => {
    expect(whenText(new Date("2026-11-20T19:30:00Z"), now)).toBe("à 14\u00a0h\u00a030");
    expect(whenText(new Date("2026-11-21T14:05:00Z"), now)).toBe("demain à 9\u00a0h\u00a005");
  });

  it("is a 429 in plain French, a minute after the exact end", () => {
    const error = tooMany({ reason: "address", retryAt: new Date("2026-11-20T15:29:00Z") }, now);
    expect(error.status).toBe(429);
    expect(error.code).toBe("too_many_signups");
    expect(error.message).toBe(
      "Trop d'essais à partir de ce réseau. Réessayez à 10\u00a0h\u00a030.",
    );
    expect(
      tooMany({ reason: "everyone", retryAt: new Date("2026-11-21T14:00:00Z") }, now).message,
    ).toMatch(/^La création de comptes est en pause\. Réessayez demain à 9/);
  });
});

describe("addressOf", () => {
  const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
  it("takes the first address the host's proxy wrote", () => {
    expect(addressOf(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(addressOf(request({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(addressOf(request({}))).toBe("unknown");
  });
});

describe("signupLimitsFrom", () => {
  it("keeps the defaults unless a sensible whole number is given", () => {
    expect(signupLimitsFrom({})).toEqual(SIGNUP_LIMITS);
    expect(
      signupLimitsFrom({
        SIGNUP_TRIES_PER_HOUR: "3",
        SIGNUP_WRONG_CODES_PER_DAY: "abc",
        SIGNUP_ACCOUNTS_PER_DAY: "0",
      }),
    ).toEqual({ ...SIGNUP_LIMITS, triesPerHour: 3 });
  });
});
