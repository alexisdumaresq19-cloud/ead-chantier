import { describe, expect, it } from "vitest";

import { latestReportDay } from "@/shared/reports";

import { newReport, reportChange } from "./input";

const today = latestReportDay();
const report = {
  day: today,
  weather: { condition: "neige", temperatureC: -12, note: " Vent fort " },
  crew: [
    { name: " Julie Cyr ", hours: 8, userId: "u1" },
    { name: "Pavage Exemple inc.", hours: 6.25 },
  ],
  equipment: "Pelle",
  workDone: "  Excavation de la tranchée.\n",
  notes: "",
};
const refused = (change: object) => !newReport.safeParse({ ...report, ...change }).success;
const tomorrow = () => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

describe("what the API accepts for a report", () => {
  it("takes a report and tidies it", () => {
    expect(newReport.parse(report)).toEqual({
      day: today,
      weather: { condition: "neige", temperatureC: -12, note: "Vent fort" },
      crew: [
        { name: "Julie Cyr", hours: 8, userId: "u1" },
        { name: "Pavage Exemple inc.", hours: 6.25, userId: null },
      ],
      equipment: "Pelle",
      workDone: "Excavation de la tranchée.",
      notes: "",
    });
  });

  it("takes a closed day: no crew, no temperature", () => {
    const closed = {
      ...report,
      weather: { condition: null, temperatureC: null, note: "" },
      crew: [],
      equipment: "",
      workDone: "Chantier fermé.",
    };
    expect(newReport.safeParse(closed).success).toBe(true);
  });

  it("refuses days that do not exist, are to come, or are far too old", () => {
    expect(refused({ day: "2026-02-30" })).toBe(true);
    expect(refused({ day: "19/11/2026" })).toBe(true);
    expect(refused({ day: tomorrow() })).toBe(true);
    expect(refused({ day: "1999-12-31" })).toBe(true);
    expect(refused({ day: "2000-01-01" })).toBe(false);
  });

  it("refuses hours outside 0 to 24 or finer than a quarter", () => {
    const withHours = (hours: unknown) => refused({ crew: [{ name: "X", hours }] });
    for (const hours of [0, 0.25, 7.5, 7.75, 24]) expect(withHours(hours)).toBe(false);
    for (const hours of [-0.5, 7.3, 24.25, "8", null, Number.NaN])
      expect(withHours(hours)).toBe(true);
  });

  it("refuses a nameless line, the same person twice, and a crew beyond 100 lines", () => {
    expect(refused({ crew: [{ name: "   ", hours: 8 }] })).toBe(true);
    expect(refused({ crew: [{ name: "x".repeat(81), hours: 8 }] })).toBe(true);
    const twice = [
      { name: "Marc", hours: 4, userId: "u2" },
      { name: "Marc", hours: 4, userId: "u2" },
    ];
    expect(refused({ crew: twice })).toBe(true);
    // Two lines typed by hand may carry the same name.
    expect(refused({ crew: twice.map((line) => ({ ...line, userId: null })) })).toBe(false);
    const many = (count: number) => Array.from({ length: count }, () => ({ name: "X", hours: 8 }));
    expect(refused({ crew: many(100) })).toBe(false);
    expect(refused({ crew: many(101) })).toBe(true);
  });

  it("refuses weather that makes no sense", () => {
    const withWeather = (change: object) => refused({ weather: { ...report.weather, ...change } });
    expect(withWeather({ condition: "grêle" })).toBe(true);
    expect(withWeather({ temperatureC: 61 })).toBe(true);
    expect(withWeather({ temperatureC: -61 })).toBe(true);
    expect(withWeather({ temperatureC: -4.5 })).toBe(true);
    expect(withWeather({ temperatureC: -60 })).toBe(false);
    expect(withWeather({ note: "x".repeat(201) })).toBe(true);
  });

  it("refuses texts beyond their length, and a report with nothing in it", () => {
    expect(refused({ workDone: "x".repeat(10_001) })).toBe(true);
    expect(refused({ workDone: "x".repeat(10_000) })).toBe(false);
    expect(refused({ notes: "x".repeat(10_001) })).toBe(true);
    expect(refused({ equipment: "x".repeat(2001) })).toBe(true);
    const blank = {
      weather: { condition: null, temperatureC: null, note: "  " },
      crew: [],
      equipment: " ",
      workDone: "\n",
      notes: "",
    };
    expect(refused(blank)).toBe(true);
    expect(refused({ notes: undefined })).toBe(true);
  });

  it("takes a change of some fields, with the version it starts from", () => {
    const version = "2026-11-19T21:10:11.123Z";
    expect(reportChange.parse({ notes: " Visite ", baseUpdatedAt: version })).toEqual({
      notes: "Visite",
      baseUpdatedAt: version,
    });
    expect(reportChange.safeParse({ notes: "Visite" }).success).toBe(false);
    expect(reportChange.safeParse({ notes: "Visite", baseUpdatedAt: "hier" }).success).toBe(false);
    expect(reportChange.safeParse({ day: tomorrow(), baseUpdatedAt: version }).success).toBe(false);
  });
});
