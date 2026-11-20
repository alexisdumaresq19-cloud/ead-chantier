import { describe, expect, it } from "vitest";

import { ASSISTANT_CONSENT_REQUIRED } from "@/shared/dictation";

import { HttpError } from "../http";
import { assertAssistantConsent } from "./consent";

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
});
