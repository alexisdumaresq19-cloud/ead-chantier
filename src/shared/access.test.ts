import { describe, expect, it } from "vitest";

import { codeFromText, phoneKey, readMessage, typedCode } from "./access";

describe("the code in what was typed or pasted", () => {
  it("keeps the digits of a code typed, in two groups of four", () => {
    expect(codeFromText("4827 1936")).toBe("48271936");
    expect(codeFromText("4827-1936")).toBe("48271936");
    expect(typedCode("482719")).toBe("4827 19");
    expect(typedCode("4827193655")).toBe("4827 1936");
  });

  it("finds the code in the office's whole message, never the link's digits", () => {
    const message =
      "Bonjour Julie, voici votre lien personnel pour ouvrir EAD Chantier sur votre téléphone.\n" +
      "https://ead-chantier.vercel.app/i/Ab12345678cD-0987_6543Xy\n" +
      "Il sert une seule fois, pendant 14 jours.\n" +
      "Dans l'application\u00a0: J'ai déjà un compte, puis Avec un code du bureau. Code\u00a0: 4827\u00a01936";
    expect(codeFromText(message)).toBe("48271936");
    expect(readMessage(message)).toEqual({ phone: null, code: "48271936" });
    expect(codeFromText("https://ead-chantier.vercel.app/i/Ab12345678cD")).toBe("");
  });

  it("tells the number from the code in one pasted text", () => {
    expect(readMessage("Cellulaire 418 555-0100, code 4827 1936")).toEqual({
      phone: "418 555-0100",
      code: "48271936",
    });
    expect(readMessage("(418) 555-0142")).toEqual({ phone: "418 555-0142", code: null });
    expect(readMessage("48271936")).toEqual({ phone: null, code: "48271936" });
    expect(readMessage("bonjour")).toEqual({ phone: null, code: null });
  });

  it("looks a number up by its ten digits, however written", () => {
    expect(phoneKey("1-418-555-0142")).toBe("4185550142");
    expect(phoneKey("(418) 555-0142")).toBe("4185550142");
    expect(phoneKey("555-0142")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});
