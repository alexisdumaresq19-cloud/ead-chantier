import { describe, expect, it } from "vitest";

import { ASSISTANT_CONSENT_REQUIRED } from "@/shared/dictation";

import { HttpError } from "../http";
import { assertAssistantConsent, ASSISTANT_TERMS_SINCE, consentInForce } from "./consent";

describe("the assistant's agreement", () => {
  it("lets through only someone who agreed", () => {
    expect(() => assertAssistantConsent({ assistantConsentAt: new Date() })).not.toThrow();
    try {
      assertAssistantConsent({ assistantConsentAt: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
      expect((error as HttpError).code).toBe(ASSISTANT_CONSENT_REQUIRED);
    }
  });

  it("asks again once what the assistant sends has changed since the agreement", () => {
    const before = new Date(ASSISTANT_TERMS_SINCE.getTime() - 1000);
    expect(consentInForce(before)).toBeNull();
    expect(consentInForce(ASSISTANT_TERMS_SINCE)).toEqual(ASSISTANT_TERMS_SINCE);
    expect(consentInForce(null)).toBeNull();
    expect(() => assertAssistantConsent({ assistantConsentAt: before })).toThrow(HttpError);
  });
});
