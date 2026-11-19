import { describe, expect, it } from "vitest";

import {
  formatFullDay,
  formatHours,
  formatTemperature,
  formatWhen,
  groupByMonth,
  hoursText,
  lastDays,
  monthLabel,
  parseHours,
  parseTemperature,
  shiftDay,
  weekdayShort,
} from "./lib";

describe("hours", () => {
  it("reads hours typed with a comma, a point or as a time", () => {
    expect(parseHours("8")).toBe(8);
    expect(parseHours("7,5")).toBe(7.5);
    expect(parseHours("7.5")).toBe(7.5);
    expect(parseHours(" 7,25 ")).toBe(7.25);
    expect(parseHours("7,5 h")).toBe(7.5);
    expect(parseHours("8h")).toBe(8);
    expect(parseHours("7 h 30")).toBe(7.5);
    expect(parseHours("7h15")).toBe(7.25);
    expect(parseHours("7:45")).toBe(7.75);
    expect(parseHours("0")).toBe(0);
    expect(parseHours("10 heures")).toBe(10);
  });

  it("does not guess when the text is not hours", () => {
    for (const text of ["", " ", "huit", "7,5,5", "-8", "7h75", "1e3", "8 personnes"])
      expect(parseHours(text)).toBeNull();
  });

  it("writes hours as in Québec", () => {
    expect(hoursText(7.5)).toBe("7,5");
    expect(hoursText(8)).toBe("8");
    expect(formatHours(7.5)).toBe("7,5\u00a0h");
    expect(formatHours(8)).toBe("8\u00a0h");
    expect(formatHours(0)).toBe("0\u00a0h");
    expect(formatHours(200.75)).toBe("200,75\u00a0h");
  });
});

describe("temperature", () => {
  it("reads degrees, below zero included", () => {
    expect(parseTemperature("12")).toBe(12);
    expect(parseTemperature("-12")).toBe(-12);
    expect(parseTemperature("−12")).toBe(-12);
    expect(parseTemperature("- 4")).toBe(-4);
    expect(parseTemperature("+3")).toBe(3);
    expect(parseTemperature("0")).toBe(0);
    expect(parseTemperature("-0")).toBe(0);
    expect(parseTemperature("4,6")).toBe(5);
    expect(parseTemperature("-12.4 °C")).toBe(-12);
  });

  it("leaves an empty field empty, and refuses the rest", () => {
    expect(parseTemperature("")).toBeNull();
    expect(parseTemperature("  ")).toBeNull();
    for (const text of ["-", "froid", "99", "-75", "1-2", "12-"])
      expect(parseTemperature(text)).toBe("invalid");
  });

  it("writes degrees with a true minus sign", () => {
    expect(formatTemperature(-12)).toBe("−12\u00a0°C");
    expect(formatTemperature(0)).toBe("0\u00a0°C");
    expect(formatTemperature(21)).toBe("21\u00a0°C");
  });
});

describe("days", () => {
  it("moves a day across months and years", () => {
    expect(shiftDay("2026-11-19", -1)).toBe("2026-11-18");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    // The night the clocks change is a day like any other.
    expect(shiftDay("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftDay("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("lists the last days, oldest first, ending today", () => {
    expect(lastDays("2026-11-02", 7)).toEqual([
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("names days and months in French", () => {
    expect(monthLabel("2026-11-19")).toBe("Novembre 2026");
    expect(monthLabel("2026-08-01")).toBe("Août 2026");
    expect(weekdayShort("2026-11-19")).toBe("jeu.");
    expect(formatFullDay("2026-11-19")).toBe("jeudi 19 novembre 2026");
  });

  it("says when something was written", () => {
    const now = new Date(2026, 10, 19, 17, 0);
    expect(formatWhen(new Date(2026, 10, 19, 15, 42), now)).toBe("aujourd'hui à 15\u00a0h\u00a042");
    expect(formatWhen(new Date(2026, 10, 18, 23, 5), now)).toBe("hier à 23\u00a0h\u00a005");
    expect(formatWhen(new Date(2026, 10, 17, 9, 0), now)).toBe("le mardi 17 novembre");
  });

  it("splits a list where the month changes, keeping its order", () => {
    const days = ["2026-11-18", "2026-11-02", "2026-10-29", "2025-11-30"].map((day) => ({ day }));
    expect(groupByMonth(days)).toEqual([
      { month: "2026-11", items: [{ day: "2026-11-18" }, { day: "2026-11-02" }] },
      { month: "2026-10", items: [{ day: "2026-10-29" }] },
      { month: "2025-11", items: [{ day: "2025-11-30" }] },
    ]);
    expect(groupByMonth([])).toEqual([]);
  });
});
