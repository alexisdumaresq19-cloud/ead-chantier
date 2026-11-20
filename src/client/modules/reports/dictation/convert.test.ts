import { describe, expect, it } from "vitest";

import type { ReportContent } from "@/shared/reports";

import { emptyForm, type ReportForm } from "../form";
import { contentForDictation, formAfterDictation } from "./convert";

const form = (change: Partial<ReportForm> = {}): ReportForm => ({
  ...emptyForm("2026-11-19"),
  ...change,
});
const row = (name: string, hours: string, userId: string | null = null, own = false) => ({
  key: name,
  userId,
  name,
  hours,
  own,
});

describe("contentForDictation", () => {
  it("reads what is typed, and leaves out what cannot be read yet", () => {
    const content = contentForDictation(
      form({
        condition: "pluie",
        temperature: "-4",
        crew: [row("Julie Cyr", "7 h 30", "u1"), row("", "8"), row("Kevin Roy", "abc")],
        workDone: "Excavation.",
      }),
    );
    expect(content.weather).toEqual({ condition: "pluie", temperatureC: -4, note: "" });
    expect(content.crew).toEqual([
      { name: "Julie Cyr", hours: 7.5, userId: "u1" },
      { name: "Kevin Roy", hours: 0, userId: null },
    ]);
    expect(content.workDone).toBe("Excavation.");
  });

  it("counts a temperature being typed as not given", () => {
    expect(contentForDictation(form({ temperature: "-" })).weather.temperatureC).toBeNull();
  });
});

describe("formAfterDictation", () => {
  const dictated: ReportContent = {
    day: "2026-11-19",
    weather: { condition: "soleil", temperatureC: -2, note: "" },
    crew: [
      { name: "Julie Cyr", hours: 10, userId: "u1" },
      { name: "Marc Lévesque", hours: 10, userId: "u2" },
      { name: "Kevin Roy", hours: 0, userId: null },
    ],
    equipment: "Pelle, rouleau.",
    workDone: "Pose de 40 m d'aqueduc.",
    notes: "",
  };

  it("fills an empty form: the crew sets the hours of the day", () => {
    const next = formAfterDictation(form(), dictated);
    expect(next.condition).toBe("soleil");
    expect(next.temperature).toBe("-2");
    expect(next.dayHours).toBe("10");
    expect(next.crew.map(({ name, hours, own }) => ({ name, hours, own }))).toEqual([
      { name: "Julie Cyr", hours: "10", own: false },
      { name: "Marc Lévesque", hours: "10", own: false },
      // Named without hours: the field is left empty, for the form to ask.
      { name: "Kevin Roy", hours: "", own: true },
    ]);
    expect(next.workDone).toBe("Pose de 40 m d'aqueduc.");
    expect(next.day).toBe("2026-11-19");
  });

  it("keeps the lines already there, and what was typed on them", () => {
    const before = form({
      dayHours: "8",
      crew: [row("Julie Cyr", "7 h 30", "u1", true), row("", "8")],
    });
    const next = formAfterDictation(before, {
      ...dictated,
      crew: [
        { name: "Julie Cyr", hours: 7.5, userId: "u1" },
        { name: "Marc Lévesque", hours: 6, userId: "u2" },
      ],
    });
    expect(next.dayHours).toBe("8");
    expect(next.crew[0]).toEqual(row("Julie Cyr", "7 h 30", "u1", true));
    expect(next.crew[1]).toMatchObject({ name: "Marc Lévesque", hours: "6", own: true });
    expect(next.crew).toHaveLength(2);
  });

  it("changes hours the dictation corrected, and drops a person it removed", () => {
    const before = form({
      dayHours: "10",
      crew: [row("Julie Cyr", "10", "u1"), row("Steve Tremblay", "10")],
    });
    const next = formAfterDictation(before, {
      ...dictated,
      crew: [{ name: "Julie Cyr", hours: 6, userId: "u1" }],
    });
    expect(next.crew).toEqual([{ ...row("Julie Cyr", "6", "u1", true) }]);
  });

  it("leaves a temperature as typed when the dictation did not touch it", () => {
    const before = form({ temperature: "−2" });
    expect(formAfterDictation(before, dictated).temperature).toBe("−2");
  });

  it("gives back the form it was given when nothing changed", () => {
    const before = form({
      condition: "neige",
      temperature: "-8",
      dayHours: "9",
      crew: [row("Julie Cyr", "9", "u1")],
      workDone: "Déneigement.",
    });
    expect(formAfterDictation(before, contentForDictation(before))).toEqual(before);
  });
});
