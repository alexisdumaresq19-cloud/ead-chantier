import { describe, expect, it } from "vitest";

import { looksLikeEmail, newPerson, officeLockout, personChange, personProblem } from "./rules";

const office = { id: "a", role: "admin", active: true } as const;

describe("officeLockout", () => {
  it("lets ordinary changes through", () => {
    expect(
      officeLockout({ target: office, change: {}, actorId: "b", otherActiveAdmins: 1 }),
    ).toBeNull();
    expect(
      officeLockout({
        target: office,
        change: { role: "admin", active: true },
        actorId: "a",
        otherActiveAdmins: 0,
      }),
    ).toBeNull();
    expect(
      officeLockout({
        target: { id: "w", role: "travailleur", active: true },
        change: { active: false },
        actorId: "a",
        otherActiveAdmins: 0,
      }),
    ).toBeNull();
  });

  it("refuses to take away one's own office access", () => {
    expect(
      officeLockout({
        target: office,
        change: { role: "contremaitre" },
        actorId: "a",
        otherActiveAdmins: 3,
      }),
    ).toMatch(/votre propre accès/);
    expect(
      officeLockout({
        target: office,
        change: { active: false },
        actorId: "a",
        otherActiveAdmins: 3,
      }),
    ).toMatch(/votre propre accès/);
  });

  it("refuses to demote or deactivate the last active office account", () => {
    expect(
      officeLockout({
        target: office,
        change: { role: "travailleur" },
        actorId: "b",
        otherActiveAdmins: 0,
      }),
    ).toMatch(/au moins une personne/);
    expect(
      officeLockout({
        target: office,
        change: { active: false },
        actorId: "b",
        otherActiveAdmins: 0,
      }),
    ).toMatch(/au moins une personne/);
  });

  it("allows it while another active office account remains", () => {
    expect(
      officeLockout({
        target: office,
        change: { active: false },
        actorId: "b",
        otherActiveAdmins: 1,
      }),
    ).toBeNull();
  });

  it("does not count an office account that is already deactivated", () => {
    expect(
      officeLockout({
        target: { id: "a", role: "admin", active: false },
        change: { role: "travailleur" },
        actorId: "b",
        otherActiveAdmins: 0,
      }),
    ).toBeNull();
  });
});

describe("person input", () => {
  it("trims, and keeps the details that are not given out of a change", () => {
    expect(personChange.parse({ name: "  Julie Cyr " })).toEqual({ name: "Julie Cyr" });
    expect(personChange.parse({ phone: null })).toEqual({ phone: null });
    expect(personChange.parse({})).toEqual({});
  });

  it("refuses an unknown role and a name too long", () => {
    expect(personChange.safeParse({ role: "patron" }).success).toBe(false);
    expect(newPerson.safeParse({ name: "J".repeat(81), role: "travailleur" }).success).toBe(false);
  });

  it("says in French what is wrong with a name or an email", () => {
    expect(personProblem(newPerson.parse({ name: "   ", role: "travailleur" }))).toMatch(/nom/);
    expect(personProblem(personChange.parse({ name: " J " }))).toMatch(/nom/);
    expect(personProblem({ name: "Luc Roy", email: "luc.roy" })).toMatch(/courriel/);
    expect(personProblem({ name: "Luc Roy", email: "luc.roy@exemple.ca" })).toBeNull();
    // A change that leaves the name and the email alone has nothing to check.
    expect(personProblem(personChange.parse({ title: "Arpenteur", email: null }))).toBeNull();
  });

  it("starts a new person without projects unless some are given", () => {
    expect(newPerson.parse({ name: "Luc Roy", role: "travailleur" }).projectIds).toEqual([]);
  });

  it("tells a plausible email from a slip", () => {
    expect(looksLikeEmail("julie.cyr@exemple.ca")).toBe(true);
    expect(looksLikeEmail("julie.cyr")).toBe(false);
    expect(looksLikeEmail("julie @exemple.ca")).toBe(false);
  });
});
