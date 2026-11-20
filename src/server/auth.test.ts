import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inviteIsFull,
  isSetupCode,
  SESSION_DAYS,
  sessionRenewal,
  typedLine,
  UNREVIEWED_SESSION_DAYS,
} from "./auth";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-19T15:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const ahead = (ms: number) => new Date(now.getTime() + ms);

describe("sessionRenewal", () => {
  it("renews a confirmed person's session to its full length, at most every six hours", () => {
    const session = { lastSeenAt: ago(7 * HOUR), expiresAt: ahead(300 * DAY) };
    expect(sessionRenewal(session, false, now)).toEqual({
      lastSeenAt: now,
      expiresAt: ahead(SESSION_DAYS * DAY),
    });
    const fresh = { lastSeenAt: ago(HOUR), expiresAt: ahead(300 * DAY) };
    expect(sessionRenewal(fresh, false, now)).toBeNull();
  });

  it("never pushes back the end of an unreviewed person's session", () => {
    // Scanned six days ago, in use every day: the end stays where the scan put it.
    const session = { lastSeenAt: ago(7 * HOUR), expiresAt: ahead(DAY) };
    const renewal = sessionRenewal(session, true, now);
    expect(renewal).toEqual({ lastSeenAt: now });
    expect(renewal).not.toHaveProperty("expiresAt");
    expect(sessionRenewal({ lastSeenAt: ago(HOUR), expiresAt: ahead(DAY) }, true, now)).toBeNull();
  });

  it("resumes renewal on the next request once the person is confirmed", () => {
    // Seen an hour ago, two hours left: without this the session would end
    // before the six-hourly renewal came round.
    const session = { lastSeenAt: ago(HOUR), expiresAt: ahead(2 * HOUR) };
    expect(sessionRenewal(session, false, now)).toEqual({
      lastSeenAt: now,
      expiresAt: ahead(SESSION_DAYS * DAY),
    });
  });

  it("keeps a QR-code session far shorter than an ordinary one", () => {
    expect(UNREVIEWED_SESSION_DAYS).toBe(7);
    expect(UNREVIEWED_SESSION_DAYS).toBeLessThan(SESSION_DAYS / 10);
  });
});

describe("isSetupCode", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Set here: the shell that runs the tests may export a SETUP_CODE of its own.
  it("accepts the configured code and nothing else", () => {
    vi.stubEnv("SETUP_CODE", "le-code-de-cet-essai");
    expect(isSetupCode("le-code-de-cet-essai")).toBe(true);
    expect(isSetupCode("le-code-de-cet-essa")).toBe(false);
    expect(isSetupCode("le-code-de-cet-essai ")).toBe(false);
    expect(isSetupCode("dev")).toBe(false);
    expect(isSetupCode("")).toBe(false);
  });

  it('is "dev" in development when none is set', () => {
    vi.stubEnv("SETUP_CODE", undefined);
    expect(isSetupCode("dev")).toBe(true);
    expect(isSetupCode("de")).toBe(false);
  });
});

describe("inviteIsFull", () => {
  it("says when every place of a code has been taken", () => {
    expect(inviteIsFull({ uses: 39, maxUses: 40 })).toBe(false);
    expect(inviteIsFull({ uses: 40, maxUses: 40 })).toBe(true);
    expect(inviteIsFull({ uses: 1000, maxUses: null })).toBe(false);
  });
});

describe("typedLine", () => {
  it("keeps a line as it was typed, spaces tidied", () => {
    expect(typedLine("  Jean   Tremblay ")).toBe("Jean Tremblay");
    expect(typedLine("Jean\tTremblay\n")).toBe("Jean Tremblay");
    expect(typedLine("Éloïse D'Amours-Côté")).toBe("Éloïse D'Amours-Côté");
    expect(typedLine("418 555-0123")).toBe("418 555-0123");
  });

  it("keeps the names people have", () => {
    for (const name of ["Jean-François Côté", "O'Brien", "Noël Lévesque", "Ève L’Heureux"])
      expect(typedLine(name)).toBe(name);
    // A non-breaking space, as a phone may put between two names.
    expect(typedLine("Marie\u00a0Gagnon")).toBe("Marie Gagnon");
  });

  // A NUL used to take one of a code's places before the database refused it.
  it("refuses any other control character", () => {
    for (const text of [
      "Jean\u0000Tremblay",
      "Jean\u0007",
      "\u001bJean",
      "Jean\u007f",
      "Jean\u0085",
    ])
      expect(typedLine(text), JSON.stringify(text)).toBeNull();
  });

  // They would show in the member list as another name, or as nothing.
  it("refuses invisible and direction-changing characters", () => {
    for (const text of [
      "Jean\u200bTremblay",
      "Jean\u200dTremblay",
      "Jean\u200fTremblay",
      "Jean\u202eTremblay",
      "\u2066Jean\u2069",
      "Jean\u00adTremblay",
      "Jean\u2060Tremblay",
      "418\u202a555-0123",
    ])
      expect(typedLine(text), JSON.stringify(text)).toBeNull();
  });

  it("refuses half of a character", () => {
    for (const text of ["Jean\ud800", "\udc00Jean", "Jean\udfff\ud800"])
      expect(typedLine(text), JSON.stringify(text)).toBeNull();
    // A whole character beyond the first plane is fine.
    expect(typedLine("Jean 🦺")).toBe("Jean 🦺");
  });
});
