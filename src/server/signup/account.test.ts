import { describe, expect, it } from "vitest";

import { cleanSignup, mixesScripts } from "./account";

const refusal = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return (error as { code: string }).code;
  }
};

describe("mixesScripts", () => {
  it("lets names in one alphabet through, accents and hyphens included", () => {
    for (const name of ["Camille Roy", "Marc-André Lévesque", "Zoë O’Neil", "Ελένη Παππά"])
      expect(mixesScripts(name)).toBe(false);
  });

  it("catches a word that passes for another with look-alike letters", () => {
    // Cyrillic С, а and м inside a Latin word.
    expect(mixesScripts("Самille Roy")).toBe(true);
    // A Greek ο in "Roy".
    expect(mixesScripts("Camille Rοy")).toBe(true);
  });
});

describe("cleanSignup", () => {
  const typed = { name: "Luc Roy", phone: "418 555-0123", code: "4827 1936" };

  it("cleans what was typed", () => {
    expect(cleanSignup(typed)).toEqual({
      name: "Luc Roy",
      phone: "418 555-0123",
      code: "48271936",
    });
  });

  it("refuses a look-alike name under the name field", () => {
    expect(refusal(() => cleanSignup({ ...typed, name: "Самille Roy" }))).toBe("bad_name");
  });
});
