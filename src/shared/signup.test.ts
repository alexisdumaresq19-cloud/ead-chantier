import { describe, expect, it } from "vitest";

import { canadianPhone, codeDigits, formatCompanyCode, signupLink } from "./signup";

describe("the company code", () => {
  it("is shown in two groups of four that never break apart", () => {
    expect(formatCompanyCode("48271936")).toBe("4827\u00a01936");
    expect(formatCompanyCode("4827 1936")).toBe("4827\u00a01936");
  });

  it("keeps only the digits of what was typed or pasted", () => {
    expect(codeDigits(" 4827-1936 ")).toBe("48271936");
    expect(codeDigits("4827\u00a01936")).toBe("48271936");
  });

  it("makes a link that fills the code", () => {
    expect(signupLink("https://chantier.exemple.ca", "4827 1936")).toBe(
      "https://chantier.exemple.ca/inscription?code=48271936",
    );
  });
});

describe("canadianPhone", () => {
  it("stores ten digits in one form, however they were typed", () => {
    for (const typed of [
      "4185550123",
      "418 555-0123",
      "(418) 555-0123",
      "418.555.0123",
      "1 418 555 0123",
      "+1 (418) 555-0123",
    ])
      expect(canadianPhone(typed), typed).toBe("418 555-0123");
  });

  it("refuses what is not a Canadian number", () => {
    for (const typed of [
      "",
      "555-0123",
      "41855501234",
      "0185550123",
      "4181550123",
      "418 555-0123 poste 2",
      "+33 6 12 34 56 78",
      "418-555-O123",
    ])
      expect(canadianPhone(typed), typed).toBeNull();
  });
});
