import { describe, expect, it } from "vitest";

import {
  crewTotals,
  excerptOf,
  isEmptyContent,
  isRealDay,
  isValidHours,
  latestReportDay,
  sameContent,
  type ReportContent,
} from "./reports";

const report: ReportContent = {
  day: "2026-11-18",
  weather: { condition: "neige", temperatureC: -12, note: "" },
  crew: [
    { name: "Julie Cyr", hours: 8, userId: "u1" },
    { name: "Pavage Exemple inc.", hours: 6.5, userId: null },
  ],
  equipment: "Pelle",
  workDone: "Excavation de la tranchée.",
  notes: "",
};

describe("report rules", () => {
  it("accepts only days that exist", () => {
    expect(isRealDay("2026-11-18")).toBe(true);
    expect(isRealDay("2024-02-29")).toBe(true);
    expect(isRealDay("2026-02-29")).toBe(false);
    expect(isRealDay("2026-02-30")).toBe(false);
    expect(isRealDay("2026-13-01")).toBe(false);
    expect(isRealDay("2026-1-5")).toBe(false);
    expect(isRealDay("hier")).toBe(false);
    expect(isRealDay("")).toBe(false);
  });

  it("takes today where the day is the most advanced in Québec", () => {
    // 23:30 in Montréal on the 18th is already 00:30 on the 19th in the Atlantic zone.
    expect(latestReportDay(new Date("2026-11-19T04:30:00Z"))).toBe("2026-11-19");
    expect(latestReportDay(new Date("2026-11-19T03:30:00Z"))).toBe("2026-11-18");
    expect(latestReportDay(new Date("2026-07-01T02:59:00Z"))).toBe("2026-06-30");
    expect(latestReportDay(new Date("2026-07-01T03:00:00Z"))).toBe("2026-07-01");
  });

  it("counts hours by quarters, between 0 and 24", () => {
    for (const hours of [0, 0.25, 7.5, 7.75, 8, 24]) expect(isValidHours(hours)).toBe(true);
    for (const hours of [-1, 7.3, 7.1, 24.25, 25, Number.NaN, Number.POSITIVE_INFINITY])
      expect(isValidHours(hours)).toBe(false);
  });

  it("adds up a crew", () => {
    expect(crewTotals(report.crew)).toEqual({ people: 2, hours: 14.5 });
    expect(crewTotals([])).toEqual({ people: 0, hours: 0 });
    const crew = Array.from({ length: 25 }, (_, i) => ({ hours: i % 2 ? 7.25 : 8.75 }));
    expect(crewTotals(crew)).toEqual({ people: 25, hours: 200.75 });
  });

  it("keeps the first words of a text, cut between two words", () => {
    expect(excerptOf("Chantier fermé.")).toBe("Chantier fermé.");
    expect(excerptOf("  Pose de\n\nla   conduite  ")).toBe("Pose de la conduite");
    expect(excerptOf("Pose de la conduite d'aqueduc entre les regards", 20)).toBe(
      "Pose de la conduite…",
    );
    expect(excerptOf("Remblayage, compaction", 11)).toBe("Remblayage…");
    expect(excerptOf("x".repeat(500), 140)).toBe(`${"x".repeat(140)}…`);
    expect(excerptOf("")).toBe("");
  });

  it("knows a report in which nothing was written", () => {
    const blank = {
      weather: { condition: null, temperatureC: null, note: " " },
      crew: [],
      equipment: "",
      workDone: " \n",
      notes: "",
    };
    expect(isEmptyContent(blank)).toBe(true);
    expect(isEmptyContent({ ...blank, workDone: "Chantier fermé." })).toBe(false);
    expect(isEmptyContent({ ...blank, weather: { ...blank.weather, temperatureC: 0 } })).toBe(
      false,
    );
    expect(isEmptyContent({ ...blank, weather: { ...blank.weather, condition: "pluie" } })).toBe(
      false,
    );
    expect(isEmptyContent(report)).toBe(false);
  });

  it("tells whether two versions say the same thing", () => {
    expect(sameContent(report, structuredClone(report))).toBe(true);
    // What the server adds to a saved report does not count.
    expect(sameContent({ ...report, id: "r1", updatedAt: "x" } as ReportContent, report)).toBe(
      true,
    );
    expect(sameContent(report, { ...report, notes: "Visite" })).toBe(false);
    expect(sameContent(report, { ...report, day: "2026-11-17" })).toBe(false);
    expect(sameContent(report, { ...report, crew: report.crew.slice(0, 1) })).toBe(false);
    expect(
      sameContent(report, {
        ...report,
        crew: [report.crew[0], { ...report.crew[1], hours: 7 }],
      }),
    ).toBe(false);
    expect(
      sameContent(report, { ...report, weather: { ...report.weather, temperatureC: 12 } }),
    ).toBe(false);
  });
});
