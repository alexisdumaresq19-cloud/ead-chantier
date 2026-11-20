import { describe, expect, it } from "vitest";

import type { CrewLine, ReportContent } from "@/shared/reports";

import {
  addBlankRow,
  addMember,
  checkForm,
  emptyForm,
  formFromReport,
  formSignature,
  formTotals,
  isBlankForm,
  membersToAdd,
  removeRow,
  setDayHours,
  setRowHours,
  setRowName,
  stepDayHours,
  stepRowHours,
  takeCrew,
  usualHours,
  type ReportForm,
} from "./form";

const TODAY = "2026-11-19";
const julie = { id: "u-julie", name: "Julie Cyr" };
const marc = { id: "u-marc", name: "Marc Lévesque" };
const simon = { id: "u-simon", name: "Simon Arsenault" };

const report: ReportContent = {
  day: "2026-11-18",
  weather: { condition: "neige", temperatureC: -12, note: "Vent fort" },
  crew: [
    { name: "Julie Cyr", hours: 10, userId: julie.id },
    { name: "Marc Lévesque", hours: 10, userId: marc.id },
    { name: "Pavage Exemple inc.", hours: 6.5, userId: null },
  ],
  equipment: "Pelle",
  workDone: "Excavation.",
  notes: "",
};

/** The crew as [name, hours typed, written by hand]. */
const rows = (form: ReportForm) => form.crew.map((row) => [row.name, row.hours, row.own]);

describe("the crew of a report being written", () => {
  it("gives each person added the hours of the day, once", () => {
    let form = addMember(emptyForm(TODAY), julie);
    form = addMember(form, marc);
    form = addMember(form, julie);
    expect(rows(form)).toEqual([
      ["Julie Cyr", "8", false],
      ["Marc Lévesque", "8", false],
    ]);
    expect(form.crew[0].userId).toBe(julie.id);
  });

  it("changes the hours for everyone at once, except hours written by hand", () => {
    let form = [julie, marc, simon].reduce(addMember, emptyForm(TODAY));
    form = setRowHours(form, form.crew[1].key, "4,5");
    form = setDayHours(form, "10");
    expect(rows(form)).toEqual([
      ["Julie Cyr", "10", false],
      ["Marc Lévesque", "4,5", true],
      ["Simon Arsenault", "10", false],
    ]);
    // Stepping through 4,5 must not sweep Marc along.
    form = setDayHours(form, "4,5");
    form = setDayHours(form, "9");
    expect(rows(form)[1]).toEqual(["Marc Lévesque", "4,5", true]);
    // Writing the hours of the day back by hand makes the line follow again.
    form = setRowHours(form, form.crew[1].key, "9");
    form = setDayHours(form, "8");
    expect(rows(form)[1]).toEqual(["Marc Lévesque", "8", false]);
  });

  it("steps the hours of the day by halves, between 0 and 24", () => {
    let form = addMember(emptyForm(TODAY), julie);
    form = stepDayHours(form, 0.5);
    expect(form.dayHours).toBe("8,5");
    expect(form.crew[0].hours).toBe("8,5");
    expect(stepDayHours(setDayHours(form, "24"), 0.5).dayHours).toBe("24");
    expect(stepDayHours(setDayHours(form, "0"), -0.5).dayHours).toBe("0");
    expect(stepDayHours(setDayHours(form, "n'importe quoi"), 0.5).dayHours).toBe("8,5");
  });

  it("steps one person's hours by halves, as their own hours", () => {
    let form = addMember(addMember(emptyForm(TODAY), julie), marc);
    const key = form.crew[1].key;
    form = stepRowHours(form, key, 0.5);
    expect(rows(form)).toEqual([
      ["Julie Cyr", "8", false],
      ["Marc Lévesque", "8,5", true],
    ]);
    // Back on the hours of the day, the line follows them again.
    form = stepRowHours(form, key, -0.5);
    expect(rows(form)[1]).toEqual(["Marc Lévesque", "8", false]);
    expect(stepRowHours(setRowHours(form, key, "24"), key, 0.5).crew[1].hours).toBe("24");
    expect(stepRowHours(setRowHours(form, key, "0"), key, -0.5).crew[1].hours).toBe("0");
    // Unreadable hours start again from the hours of the day.
    expect(stepRowHours(setRowHours(form, key, "abc"), key, 1).crew[1].hours).toBe("9");
    expect(stepRowHours(form, "nobody", 0.5)).toBe(form);
  });

  it("adds a line to write a name in, and removes lines", () => {
    const { form, key } = addBlankRow(addMember(emptyForm(TODAY), julie));
    expect(rows(form)[1]).toEqual(["", "8", false]);
    expect(form.crew[1].key).toBe(key);
    const named = setRowName(form, key!, "Arpentage Exemple");
    expect(named.crew[1].name).toBe("Arpentage Exemple");
    expect(rows(removeRow(named, named.crew[0].key))).toEqual([["Arpentage Exemple", "8", false]]);
  });

  it("stops at 100 lines", () => {
    let form = emptyForm(TODAY);
    for (let i = 0; i < 120; i++) form = addMember(form, { id: `u${i}`, name: `Personne ${i}` });
    expect(form.crew).toHaveLength(100);
    expect(addBlankRow(form)).toEqual({ form, key: null });
  });

  it("takes yesterday's crew as it was into an empty list", () => {
    const { form, added } = takeCrew(emptyForm(TODAY), report.crew);
    expect(added).toBe(3);
    expect(form.dayHours).toBe("10");
    expect(rows(form)).toEqual([
      ["Julie Cyr", "10", false],
      ["Marc Lévesque", "10", false],
      ["Pavage Exemple inc.", "6,5", true],
    ]);
    expect(form.crew.map((row) => row.userId)).toEqual([julie.id, marc.id, null]);
  });

  it("adds only the people missing to a list already started", () => {
    const { form: started, key } = addBlankRow(addMember(emptyForm(TODAY), marc));
    // The subcontractor was typed by hand, not quite as yesterday.
    const form = setRowName(started, key!, "pavage exemple INC. ");
    const taken = takeCrew(form, report.crew);
    expect(taken.added).toBe(1);
    expect(rows(taken.form)).toEqual([
      ["Marc Lévesque", "8", false],
      ["pavage exemple INC. ", "8", false],
      ["Julie Cyr", "10", true],
    ]);
    expect(takeCrew(taken.form, report.crew).added).toBe(0);
  });

  it("finds the hours most of the crew did", () => {
    const hours = (...list: number[]): Pick<CrewLine, "hours">[] => list.map((h) => ({ hours: h }));
    expect(usualHours([])).toBe(8);
    expect(usualHours(hours(10, 10, 6.5))).toBe(10);
    expect(usualHours(hours(6, 9))).toBe(9);
    expect(usualHours(hours(4))).toBe(4);
  });

  it("totals the people named and the hours that can be read", () => {
    let form = [julie, marc].reduce(addMember, emptyForm(TODAY));
    form = setRowHours(form, form.crew[1].key, "7h30");
    form = addBlankRow(form).form;
    expect(formTotals(form)).toEqual({ people: 2, hours: 15.5 });
    form = setRowHours(form, form.crew[0].key, "beaucoup");
    expect(formTotals(form)).toEqual({ people: 2, hours: 7.5 });
    expect(formTotals(emptyForm(TODAY))).toEqual({ people: 0, hours: 0 });
  });
});

describe("the people offered to add", () => {
  it("leaves out who is on the crew, by account or by a name typed by hand", () => {
    const emilie = { id: "u-emilie", name: "Émilie Bouchard" };
    const xavier = { id: "u-xavier", name: "Xavier Roy" };
    let form = addMember(emptyForm(TODAY), julie);
    // Yesterday's crew taken over as names, as a report saved without accounts has it.
    form = takeCrew(form, [{ name: " marc lévesque ", hours: 8, userId: null }]).form;
    expect(membersToAdd(form, [xavier, marc, julie, emilie, simon]).map((m) => m.name)).toEqual([
      "Émilie Bouchard",
      "Simon Arsenault",
      "Xavier Roy",
    ]);
  });
});

describe("a report and its form", () => {
  it("opens a saved report as a form and gives the same report back", () => {
    const form = formFromReport(report);
    expect(form.temperature).toBe("-12");
    expect(form.dayHours).toBe("10");
    expect(rows(form)[2]).toEqual(["Pavage Exemple inc.", "6,5", true]);
    expect(checkForm(form, TODAY)).toEqual({ content: report, problems: [] });
  });

  it("reads what a foreman types: commas, a time, spaces around", () => {
    let form = addMember(emptyForm(TODAY), julie);
    form = setRowHours(form, form.crew[0].key, "7,5");
    form = {
      ...form,
      temperature: " −4 ",
      workDone: "  Pose de la conduite.\n",
      condition: "vent",
    };
    expect(checkForm(form, TODAY).content).toEqual({
      day: TODAY,
      weather: { condition: "vent", temperatureC: -4, note: "" },
      crew: [{ name: "Julie Cyr", hours: 7.5, userId: julie.id }],
      equipment: "",
      workDone: "Pose de la conduite.",
      notes: "",
    });
  });

  it("accepts a day without a crew or a temperature", () => {
    const form = { ...emptyForm(TODAY), workDone: "Chantier fermé." };
    const { content, problems } = checkForm(form, TODAY);
    expect(problems).toEqual([]);
    expect(content?.crew).toEqual([]);
    expect(content?.weather).toEqual({ condition: null, temperatureC: null, note: "" });
  });

  it("refuses an empty report, a day to come and a date that is none", () => {
    expect(checkForm(emptyForm(TODAY), TODAY).problems.map((p) => p.where)).toEqual(["form"]);
    const written = { ...emptyForm("2026-11-20"), workDone: "x" };
    expect(checkForm(written, TODAY).problems.map((p) => p.where)).toEqual(["day"]);
    expect(checkForm({ ...written, day: "" }, TODAY).content).toBeNull();
    expect(checkForm({ ...written, day: "1926-11-19" }, TODAY).content).toBeNull();
    expect(checkForm({ ...written, day: TODAY }, TODAY).problems).toEqual([]);
  });

  it("points at the line whose hours cannot be right", () => {
    let form = [julie, marc, simon].reduce(addMember, { ...emptyForm(TODAY), workDone: "x" });
    form = setRowHours(form, form.crew[0].key, "7,3");
    form = setRowHours(form, form.crew[1].key, "");
    form = setRowHours(form, form.crew[2].key, "25");
    const { content, problems } = checkForm(form, TODAY);
    expect(content).toBeNull();
    expect(problems.map((p) => [p.where, p.rowKey])).toEqual(
      form.crew.map((row) => ["crew", row.key]),
    );
    expect(problems[1].message).toBe("Inscrivez les heures.");
  });

  it("refuses a temperature that is not one", () => {
    const form = { ...emptyForm(TODAY), workDone: "x", temperature: "froid" };
    expect(checkForm(form, TODAY).problems.map((p) => p.where)).toEqual(["temperature"]);
  });

  it("leaves out a line without a name, unless hours were written on it", () => {
    const started = addBlankRow({ ...emptyForm(TODAY), workDone: "x" });
    expect(checkForm(started.form, TODAY).content?.crew).toEqual([]);
    const withHours = setRowHours(started.form, started.key!, "4");
    expect(checkForm(withHours, TODAY).problems).toEqual([
      { where: "crew", rowKey: started.key, message: "Inscrivez le nom." },
    ]);
  });

  it("knows a form in which nothing was written yet", () => {
    expect(isBlankForm(emptyForm(TODAY))).toBe(true);
    expect(isBlankForm({ ...emptyForm(TODAY), dayHours: "10" })).toBe(true);
    expect(isBlankForm({ ...emptyForm(TODAY), temperature: "-" })).toBe(false);
    expect(isBlankForm(addMember(emptyForm(TODAY), julie))).toBe(false);
  });

  it("compares what two forms would save, whatever the way it was typed", () => {
    const saved = formSignature(formFromReport(report));
    // Opened twice, the lines get other keys: still the same report.
    expect(formSignature(formFromReport(report))).toBe(saved);
    const form = formFromReport(report);
    const retyped = setRowHours(form, form.crew[2].key, "6h30");
    expect(formSignature({ ...retyped, workDone: "Excavation.  " })).toBe(saved);
    expect(formSignature({ ...form, workDone: "Excavation et remblai." })).not.toBe(saved);
    expect(formSignature(setRowHours(form, form.crew[2].key, "7"))).not.toBe(saved);
    expect(formSignature({ ...form, day: "2026-11-17" })).not.toBe(saved);
  });
});
