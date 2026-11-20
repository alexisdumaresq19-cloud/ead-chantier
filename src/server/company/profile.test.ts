import { describe, expect, it } from "vitest";

import { COMPANY_NAME } from "@/shared/company";

import { companyProfileInput, parseStoredProfile } from "./profile";

const filled = {
  name: "  Les Entreprises   Allen Dumaresq ",
  address: "  12, rue Exemple \n\n  Ville (Québec)   G0A 0A0  ",
  phone: " 418 555-0100 poste 12 ",
  email: " Bureau@Exemple.CA ",
  privacyOfficer: { name: " Prénom Nom ", title: " Directrice ", contact: "" },
};

describe("the company's details as the office sends them", () => {
  it("are trimmed, with the address kept on its lines", () => {
    const profile = companyProfileInput.parse(filled);
    expect(profile).toEqual({
      name: "Les Entreprises Allen Dumaresq",
      address: "12, rue Exemple\nVille (Québec) G0A 0A0",
      phone: "418 555-0100 poste 12",
      email: "bureau@exemple.ca",
      privacyOfficer: { name: "Prénom Nom", title: "Directrice", contact: "" },
    });
  });

  it("may leave everything but the name empty", () => {
    const empty = {
      name: COMPANY_NAME,
      address: "",
      phone: "",
      email: "",
      privacyOfficer: { name: "", title: "", contact: "" },
    };
    expect(companyProfileInput.parse(empty)).toEqual(empty);
    expect(companyProfileInput.safeParse({ ...empty, name: "  " }).success).toBe(false);
  });

  it("refuses what is not a phone, an email, or is too long", () => {
    const bad = (patch: object) => companyProfileInput.safeParse({ ...filled, ...patch }).success;
    expect(bad({ phone: "appelez-nous" })).toBe(false);
    expect(bad({ phone: "12" })).toBe(false);
    expect(bad({ email: "bureau@" })).toBe(false);
    expect(bad({ email: "bureau exemple.ca" })).toBe(false);
    expect(bad({ name: "x".repeat(121) })).toBe(false);
    expect(bad({ address: "a\nb\nc\nd" })).toBe(false);
    expect(bad({ privacyOfficer: { ...filled.privacyOfficer, contact: "x".repeat(201) } })).toBe(
      false,
    );
    expect(bad({ privacyOfficer: undefined })).toBe(false);
    // A way to reach nobody in particular.
    expect(
      bad({ privacyOfficer: { name: "", title: "", contact: "vieprivee@exemple.test" } }),
    ).toBe(false);
    expect(bad({ privacyOfficer: { name: "", title: "Direction générale", contact: "" } })).toBe(
      true,
    );
    expect(bad({ phone: "+1 (418) 555-0100" })).toBe(true);
  });
});

describe("the stored details", () => {
  it("read nothing but the name when nothing is stored, or it is unreadable", () => {
    for (const value of [null, "", "{", "[]", '"texte"'])
      expect(parseStoredProfile(value)).toEqual({
        name: COMPANY_NAME,
        address: "",
        phone: "",
        email: "",
        privacyOfficer: { name: "", title: "", contact: "" },
      });
  });

  it("keep what is still valid and drop the rest", () => {
    const stored = JSON.stringify({ ...filled, phone: "pas un numéro", privacyOfficer: "?" });
    expect(parseStoredProfile(stored)).toMatchObject({
      name: "Les Entreprises Allen Dumaresq",
      phone: "",
      email: "bureau@exemple.ca",
      privacyOfficer: { name: "", title: "", contact: "" },
    });
  });
});
