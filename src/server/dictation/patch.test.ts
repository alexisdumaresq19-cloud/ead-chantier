import { describe, expect, it } from "vitest";

import type { ReportContent } from "@/shared/reports";

import { applyDictation, applyTidy, keepsTheFacts, matchName, type DictationPatch } from "./patch";

const members = [
  { id: "u1", name: "Julie Cyr" },
  { id: "u2", name: "Marc Lévesque" },
  { id: "u3", name: "Simon Arsenault" },
  { id: "u4", name: "Marc Gagnon" },
];

const empty: ReportContent = {
  day: "2026-11-19",
  weather: { condition: null, temperatureC: null, note: "" },
  crew: [],
  equipment: "",
  workDone: "",
  notes: "",
  photoIds: [],
};

const nothing: DictationPatch = {
  weather: { condition: null, temperatureC: null, note: null },
  crew: [],
  equipment: null,
  workDone: null,
  notes: null,
  replace: { equipment: false, workDone: false, notes: false },
  questions: [],
  photos: [],
};

describe("matchName", () => {
  it("finds a person by full name, without accents or capitals", () => {
    expect(matchName("marc levesque", members)?.id).toBe("u2");
  });
  it("finds a person by a first or last name only when one person carries it", () => {
    expect(matchName("Simon", members)?.id).toBe("u3");
    expect(matchName("Lévesque", members)?.id).toBe("u2");
    expect(matchName("Marc", members)).toBeNull();
    expect(matchName("Kevin", members)).toBeNull();
  });
});

describe("applyDictation", () => {
  it("fills an empty report and says what changed", () => {
    const { content, changed, questions } = applyDictation(
      empty,
      {
        ...nothing,
        weather: { condition: "soleil", temperatureC: -2.4, note: null },
        crew: [
          { name: "Julie Cyr", hours: 10, remove: false },
          { name: "Simon", hours: 7.6, remove: false },
        ],
        workDone: "Pose de 40 m d'aqueduc entre R-3 et R-4.",
      },
      members,
    );
    expect(content.weather).toEqual({ condition: "soleil", temperatureC: -2, note: "" });
    expect(content.crew).toEqual([
      { name: "Julie Cyr", hours: 10, userId: "u1" },
      { name: "Simon Arsenault", hours: 7.5, userId: "u3" },
    ]);
    expect(content.workDone).toBe("Pose de 40 m d'aqueduc entre R-3 et R-4.");
    expect(changed).toEqual(["weather", "crew", "workDone"]);
    expect(questions).toEqual([]);
  });

  it("adds to what is written and never loses it", () => {
    const current = {
      ...empty,
      workDone: "Excavation de la tranchée.",
      notes: "Visite de l'ingénieur.",
    };
    const { content, changed } = applyDictation(
      current,
      { ...nothing, workDone: "Remblayage en après-midi." },
      members,
    );
    expect(content.workDone).toBe("Excavation de la tranchée.\nRemblayage en après-midi.");
    expect(content.notes).toBe("Visite de l'ingénieur.");
    expect(changed).toEqual(["workDone"]);
  });

  it("replaces a part only when asked to", () => {
    const current = { ...empty, workDone: "Texte à refaire." };
    const { content } = applyDictation(
      current,
      { ...nothing, workDone: "Nouveau texte.", replace: { ...nothing.replace, workDone: true } },
      members,
    );
    expect(content.workDone).toBe("Nouveau texte.");
  });

  it("updates the hours of someone already listed, and removes someone", () => {
    const current = {
      ...empty,
      crew: [
        { name: "Julie Cyr", hours: 10, userId: "u1" },
        { name: "Marc Lévesque", hours: 10, userId: "u2" },
        { name: "Steve Tremblay", hours: 8, userId: null },
      ],
    };
    const { content } = applyDictation(
      current,
      {
        ...nothing,
        crew: [
          { name: "Lévesque", hours: 6, remove: false },
          { name: "Steve", hours: null, remove: true },
        ],
      },
      members,
    );
    expect(content.crew).toEqual([
      { name: "Julie Cyr", hours: 10, userId: "u1" },
      { name: "Marc Lévesque", hours: 6, userId: "u2" },
    ]);
  });

  it("keeps a name nobody carries on the project, and asks for missing hours", () => {
    const { content, questions } = applyDictation(
      empty,
      { ...nothing, crew: [{ name: "Kevin Roy", hours: null, remove: false }] },
      members,
    );
    expect(content.crew).toEqual([{ name: "Kevin Roy", hours: 0, userId: null }]);
    expect(questions).toEqual(["Combien d'heures pour Kevin Roy?"]);
  });

  it("does not list the same person twice", () => {
    const current = { ...empty, crew: [{ name: "Julie Cyr", hours: 8, userId: "u1" }] };
    const { content } = applyDictation(
      current,
      { ...nothing, crew: [{ name: "Julie", hours: 9, remove: false }] },
      members,
    );
    expect(content.crew).toEqual([{ name: "Julie Cyr", hours: 9, userId: "u1" }]);
  });

  it("changes nothing when nothing was said", () => {
    const { content, changed } = applyDictation(empty, nothing, members);
    expect(content).toEqual(empty);
    expect(changed).toEqual([]);
  });
});

describe("applyTidy", () => {
  const current = {
    ...empty,
    weather: { condition: "pluie" as const, temperatureC: 4, note: "" },
    equipment: "pelle, 2 camions",
    workDone: "euh on a posé 40 m d'aqueduc entre R-3 et R-4 heu",
    notes: "",
  };

  it("replaces the texts with their clean version, and nothing else", () => {
    const { content, changed, questions } = applyTidy(current, {
      ...nothing,
      weather: { condition: "soleil", temperatureC: 20, note: "Beau" },
      crew: [{ name: "Julie Cyr", hours: 8, remove: false }],
      equipment: "Pelle et 2 camions.",
      workDone: "Pose de 40 m de conduite d'aqueduc entre R-3 et R-4.",
      notes: "Une note inventée.",
      questions: ["Combien d'heures?"],
    });
    expect(content.equipment).toBe("Pelle et 2 camions.");
    expect(content.workDone).toBe("Pose de 40 m de conduite d'aqueduc entre R-3 et R-4.");
    // An empty part stays empty; the weather and the crew are not touched.
    expect(content.notes).toBe("");
    expect(content.weather).toEqual(current.weather);
    expect(content.crew).toEqual([]);
    expect(changed).toEqual(["equipment", "workDone"]);
    expect(questions).toEqual([]);
  });

  it("keeps a text whose rewriting loses a figure or most of its words", () => {
    const { content, changed } = applyTidy(current, {
      ...nothing,
      equipment: "Pelle et camions.",
      workDone: "Pose.",
    });
    expect(content).toEqual(current);
    expect(changed).toEqual([]);
  });

  it("keepsTheFacts compares the figures and the length", () => {
    expect(keepsTheFacts("7,5 h et 200 mm", "200 mm, 7,5 h")).toBe(true);
    expect(keepsTheFacts("7,5 h et 200 mm", "200 mm")).toBe(false);
  });
});
