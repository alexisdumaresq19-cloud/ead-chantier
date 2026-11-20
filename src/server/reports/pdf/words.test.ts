import { describe, expect, it } from "vitest";

import { dayInSentence, fullDay, placeLabel, typeset } from "./words";

const NBSP = "\u00a0";

describe("the words of a report's PDF", () => {
  it("writes the day at the start of a line and inside a sentence", () => {
    expect(fullDay("2026-11-19")).toBe("Jeudi 19 novembre 2026");
    expect(dayInSentence("2026-11-19")).toBe("jeudi 19 novembre 2026");
    expect(dayInSentence("2026-12-01")).toBe("mardi 1er décembre 2026");
  });

  it("joins an address and its city once", () => {
    expect(placeLabel("Rue Principale", "Gaspé")).toBe("Rue Principale, Gaspé");
    expect(placeLabel("12 rue Principale, Gaspé", "Gaspé")).toBe("12 rue Principale, Gaspé");
    expect(placeLabel(null, "Gaspé")).toBe("Gaspé");
  });
});

describe("typed text, set for the page", () => {
  it("turns the typewriter apostrophe between letters into a true one", () => {
    expect(typeset("l'ingénieur jusqu'à l'entrée")).toBe("l’ingénieur jusqu’à l’entrée");
    // A foot mark after a number stays.
    expect(typeset("tuyau de 6' de long")).toBe("tuyau de 6' de long");
  });

  it("turns typed quotes into guillemets with their no-break spaces", () => {
    expect(typeset('Il a dit "bien" hier')).toBe(`Il a dit «${NBSP}bien${NBSP}» hier`);
    expect(typeset("« bien »")).toBe(`«${NBSP}bien${NBSP}»`);
    expect(typeset("«bien»")).toBe(`«${NBSP}bien${NBSP}»`);
    // Inch marks are left alone.
    expect(typeset('conduite 6" et 8"')).toBe('conduite 6" et 8"');
  });

  it("keeps a punctuation mark with the word before it", () => {
    expect(typeset("Note : rien ; fini !")).toBe(`Note${NBSP}: rien${NBSP}; fini${NBSP}!`);
    // No space is added where none was typed.
    expect(typeset("Fini!")).toBe("Fini!");
  });

  it("keeps a number with its unit, and the parts of a number together", () => {
    expect(typeset("300 mm, 42 m, 10 h, 14 h 30, -12 °C, 15 %, 1 035 kPa")).toBe(
      `300${NBSP}mm, 42${NBSP}m, 10${NBSP}h, 14${NBSP}h${NBSP}30, -12${NBSP}°C, 15${NBSP}%, 1${NBSP}035${NBSP}kPa`,
    );
    // A word that only starts like a unit is not one.
    expect(typeset("3 hommes et 2 mats")).toBe("3 hommes et 2 mats");
  });
});
