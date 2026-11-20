import { describe, expect, it } from "vitest";

import {
  EMPTY_COMPANY_PROFILE,
  emailProblem,
  frenchList,
  missingDetails,
  officerProblem,
  phoneHref,
  phoneProblem,
} from "./company";

describe("the company's details", () => {
  it("say what is missing, everything but the name at first", () => {
    expect(EMPTY_COMPANY_PROFILE.name).toBe("Les Entreprises Allen Dumaresq");
    expect(missingDetails(EMPTY_COMPANY_PROFILE)).toEqual([
      "address",
      "phone",
      "email",
      "privacyOfficer",
    ]);
    expect(
      missingDetails({
        ...EMPTY_COMPANY_PROFILE,
        phone: "418 555-0100",
        privacyOfficer: { name: "Prénom Nom", title: "", contact: "" },
      }),
    ).toEqual(["address", "email"]);
  });

  it("take a title alone for the responsible person, never a contact alone", () => {
    const officer = (name: string, title: string, contact: string) => ({ name, title, contact });
    // The law asks for the title and the contact; a name is welcome.
    expect(
      missingDetails({
        ...EMPTY_COMPANY_PROFILE,
        privacyOfficer: officer("", "Direction générale", ""),
      }),
    ).not.toContain("privacyOfficer");
    expect(officerProblem(officer("", "Direction générale", "vieprivee@exemple.test"))).toBeNull();
    expect(officerProblem(officer("", "", ""))).toBeNull();
    expect(officerProblem(officer("", " ", "vieprivee@exemple.test"))).toMatch(/nom ou son titre/);
  });

  it("are listed the way it is said", () => {
    expect(frenchList([])).toBe("");
    expect(frenchList(["a"])).toBe("a");
    expect(frenchList(["a", "b"])).toBe("a et b");
    expect(frenchList(["a", "b", "c"])).toBe("a, b et c");
  });

  it("dial a North American number, its extension left out", () => {
    expect(phoneHref("418 555-0100")).toBe("tel:+14185550100");
    expect(phoneHref("1-418-555-0100")).toBe("tel:+14185550100");
    expect(phoneHref("418 555-0100 poste 12")).toBe("tel:+14185550100");
    expect(phoneHref("+33 1 23 45 67 89")).toBe("tel:+33123456789");
  });

  it("tell a slip from a number or an address", () => {
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("(418) 555-0100")).toBeNull();
    expect(phoneProblem("555")).not.toBeNull();
    expect(emailProblem("")).toBeNull();
    expect(emailProblem("bureau@exemple.ca")).toBeNull();
    expect(emailProblem("bureau@exemple")).not.toBeNull();
  });
});
