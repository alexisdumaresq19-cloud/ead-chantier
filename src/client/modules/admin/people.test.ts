import { describe, expect, it } from "vitest";

import { codeFromText } from "@/shared/access";
import type { Person } from "@/shared/api";

import { ApiFailure } from "../../lib/api";
import {
  accessEndText,
  daysLeft,
  firstName,
  formatPhone,
  inviteMessage,
  lastSeenText,
  mailHref,
  matchesPerson,
  pauseText,
  roleAndTitle,
  sameNameAs,
  sameNameText,
  scannedText,
  signOutFailure,
  smsHref,
  sortByName,
  sortMembers,
  sortPeople,
  telHref,
  siteCodeText,
  titleIsRole,
  toConfirmText,
  joinedWithText,
  untilText,
  whenText,
  titleOrRole,
} from "./people";

describe("phone numbers", () => {
  it("writes a ten-digit number as in Québec, however it was typed", () => {
    expect(formatPhone("4185550142")).toBe("418 555-0142");
    expect(formatPhone("418-555-0142")).toBe("418 555-0142");
    expect(formatPhone("(418) 555.0142")).toBe("418 555-0142");
    expect(formatPhone("+1 418 555 0142")).toBe("418 555-0142");
    expect(formatPhone(" 1-418-555-0142 ")).toBe("418 555-0142");
  });

  it("keeps an extension", () => {
    expect(formatPhone("418 555-0142 poste 23")).toBe("418 555-0142, poste 23");
    expect(formatPhone("418-555-0142 x23")).toBe("418 555-0142, poste 23");
    expect(formatPhone("4185550142 #7")).toBe("418 555-0142, poste 7");
  });

  it("leaves alone what is not a ten-digit number", () => {
    expect(formatPhone("555-0142")).toBe("555-0142");
    expect(formatPhone("+33 6 12 34 56 78")).toBe("+33 6 12 34 56 78");
    expect(formatPhone("418 555-0142 (cell. de sa conjointe)")).toBe(
      "418 555-0142 (cell. de sa conjointe)",
    );
    expect(formatPhone("")).toBe("");
  });

  it("makes a link that dials the number", () => {
    expect(telHref("418 555-0142")).toBe("tel:+14185550142");
    expect(telHref("1 (418) 555-0142 poste 23")).toBe("tel:+14185550142");
    expect(telHref("418 555-0142 (cell.)")).toBe("tel:+14185550142");
    expect(telHref("+33 6 12 34 56 78")).toBe("tel:+33612345678");
    expect(telHref("555-0142")).toBe("tel:5550142");
    expect(telHref("au bureau")).toBeNull();
    expect(telHref("")).toBeNull();
  });
});

describe("sending an invitation", () => {
  it("opens the messages app with the number and the text", () => {
    expect(smsHref("418 555-0142", "Bonjour & bienvenue")).toBe(
      "sms:+14185550142?&body=Bonjour%20%26%20bienvenue",
    );
  });

  it("leaves the recipient empty when there is no number", () => {
    expect(smsHref(null, "Allo")).toBe("sms:?&body=Allo");
    expect(smsHref("à demander", "Allo")).toBe("sms:?&body=Allo");
  });

  it("opens an email with the subject and the text", () => {
    expect(mailHref("julie.cyr@exemple.ca", "Votre accès", "Ligne 1\nLigne 2")).toBe(
      "mailto:julie.cyr@exemple.ca?subject=Votre%20acc%C3%A8s&body=Ligne%201%0ALigne%202",
    );
    expect(mailHref(null, "S", "T")).toBe("mailto:?subject=S&body=T");
  });

  it("greets by the first name and says how long the link works", () => {
    expect(firstName("  Jean-Philippe St-Onge Bélanger")).toBe("Jean-Philippe");
    const text = inviteMessage("Julie Cyr", "https://exemple.ca/i/abc", 14);
    expect(text).toContain("Bonjour Julie,");
    expect(text).toContain("\nhttps://exemple.ca/i/abc\n");
    expect(text).toContain("Il sert une seule fois, pendant 14 jours.");
    expect(inviteMessage("Julie Cyr", "https://exemple.ca/i/abc", 1)).toContain("jusqu'à demain.");
  });

  it("ends the invitation with its code, and how to type it in the app", () => {
    const text = inviteMessage("Julie Cyr", "https://exemple.ca/i/abc", 14, "48271936");
    expect(text).toContain(
      "J'ai déjà un compte, puis Avec un code du bureau. Votre code\u00a0: 4827\u00a01936\n",
    );
    expect(text).toMatch(/\nLe lien et le code servent une seule fois, pendant 14 jours\.$/);
    expect(codeFromText(text)).toBe("48271936");
  });

  it("counts the days a link has left", () => {
    const now = new Date(2026, 10, 19, 9, 0);
    expect(daysLeft(new Date(2026, 11, 3, 9, 0).toISOString(), now)).toBe(14);
    expect(daysLeft(new Date(2026, 10, 19, 15, 0).toISOString(), now)).toBe(1);
  });

  it("says plainly how long a site's code works, and until when", () => {
    expect(siteCodeText(new Date(2026, 10, 26, 22, 1).toISOString())).toBe(
      "Ce code fonctionne 7\u00a0jours, jusqu'au jeudi\u00a026\u00a0novembre.",
    );
  });
});

describe("the office's list", () => {
  const person = (name: string, more: Partial<Person> = {}) => ({
    name,
    title: null,
    role: "travailleur" as const,
    phone: null,
    email: null,
    unreviewed: false,
    ...more,
  });

  it("shows the title, or the role when there is none", () => {
    expect(titleOrRole({ title: "Opérateur de pelle", role: "travailleur" })).toBe(
      "Opérateur de pelle",
    );
    expect(titleOrRole({ title: null, role: "admin" })).toBe("Bureau");
    expect(titleOrRole({ title: "  ", role: "contremaitre" })).toBe("Contremaître");
  });

  it("never says the role twice: a title that repeats it takes its place", () => {
    expect(titleIsRole("Contremaîtresse", "contremaitre")).toBe(true);
    expect(titleIsRole("CONTREMAITRE", "contremaitre")).toBe(true);
    expect(titleIsRole("Travailleuse", "travailleur")).toBe(true);
    expect(titleIsRole("Opérateur", "travailleur")).toBe(false);
    expect(titleIsRole(null, "admin")).toBe(false);
    expect(roleAndTitle({ title: "Contremaîtresse", role: "contremaitre" })).toEqual({
      role: "Contremaîtresse",
      title: null,
    });
    expect(roleAndTitle({ title: " Opérateur de pelle ", role: "travailleur" })).toEqual({
      role: "Travailleur",
      title: "Opérateur de pelle",
    });
    expect(roleAndTitle({ title: null, role: "admin" })).toEqual({ role: "Bureau", title: null });
  });

  it("says when someone was last seen", () => {
    const now = new Date(2026, 10, 19, 9, 0);
    expect(lastSeenText(null, now)).toBe("Jamais connecté");
    expect(lastSeenText(new Date(2026, 10, 19, 7, 0).toISOString(), now)).toBe("Vu aujourd'hui");
    expect(lastSeenText(new Date(2026, 10, 18, 7, 0).toISOString(), now)).toBe("Vu hier");
    expect(lastSeenText(new Date(2026, 10, 16, 7, 0).toISOString(), now)).toBe("Vu il y a 3 jours");
    expect(lastSeenText(new Date(2026, 8, 1, 12, 0).toISOString(), now)).toBe(
      "Vu le 1er septembre 2026",
    );
  });

  it("puts people to check first, then sorts by name whatever the accents", () => {
    const sorted = sortPeople([
      person("Zoé Arsenault"),
      person("Éric Bujold"),
      person("Marc Lévesque", { unreviewed: true }),
      person("eric allard"),
    ]);
    expect(sorted.map((p) => p.name)).toEqual([
      "Marc Lévesque",
      "eric allard",
      "Éric Bujold",
      "Zoé Arsenault",
    ]);
  });

  it("sorts a plain list by name", () => {
    expect(
      sortByName([person("Zoé Roy"), person("Élise Cyr"), person("alain Roy")]).map((p) => p.name),
    ).toEqual(["alain Roy", "Élise Cyr", "Zoé Roy"]);
  });

  it("lists a site's foremen before the office and the crew", () => {
    const sorted = sortMembers([
      person("Simon Arsenault"),
      person("Camille Roy", { role: "admin" }),
      person("Julie Cyr", { role: "contremaitre" }),
      person("Alain Bernard"),
    ]);
    expect(sorted.map((p) => p.name)).toEqual([
      "Julie Cyr",
      "Camille Roy",
      "Alain Bernard",
      "Simon Arsenault",
    ]);
  });

  it("finds by name without accents, by title, role and email", () => {
    const marc = person("Marc Lévesque", {
      title: "Opérateur de pelle",
      email: "marc@exemple.ca",
      phone: "418 555-0177",
    });
    expect(matchesPerson(marc, "levesque")).toBe(true);
    expect(matchesPerson(marc, "LÉVESQUE marc")).toBe(true);
    expect(matchesPerson(marc, "pelle")).toBe(true);
    expect(matchesPerson(marc, "travailleur")).toBe(true);
    expect(matchesPerson(marc, "exemple.ca")).toBe(true);
    expect(matchesPerson(marc, "cyr")).toBe(false);
    expect(matchesPerson(marc, "  ")).toBe(true);
  });

  it("finds by phone digits, however they are typed", () => {
    const marc = person("Marc Lévesque", { phone: "(418) 555-0177" });
    expect(matchesPerson(marc, "5550177")).toBe(true);
    expect(matchesPerson(marc, "555-0177")).toBe(true);
    expect(matchesPerson(marc, "418 555")).toBe(true);
    expect(matchesPerson(marc, "0199")).toBe(false);
    expect(matchesPerson(person("Sans Numéro"), "555")).toBe(false);
  });
});

describe("people to confirm", () => {
  const now = new Date("2026-11-20T15:00:00");

  it("says when the code was scanned", () => {
    expect(scannedText(new Date("2026-11-20T07:30:00").toISOString(), now)).toBe(
      "Code scanné aujourd'hui à 7 h 30",
    );
    expect(scannedText(new Date("2026-11-19T16:05:00").toISOString(), now)).toBe(
      "Code scanné hier à 16 h 05",
    );
    expect(scannedText(new Date("2026-11-17T09:00:00").toISOString(), now)).toBe(
      "Code scanné il y a 3 jours",
    );
  });

  it("gives the day the access ends without a confirmation, seven days after the scan", () => {
    expect(accessEndText(new Date("2026-11-19T16:05:00").toISOString())).toBe(
      "Accès jusqu'au jeudi 26 novembre",
    );
  });
});

describe("signOutFailure", () => {
  it("says the device is still signed in, whatever went wrong", () => {
    expect(signOutFailure(new ApiFailure(0, "offline", "Pas de réseau."))).toBe(
      "Pas de réseau\u00a0: vous êtes encore connecté sur cet appareil. Réessayez quand la connexion revient.",
    );
    expect(
      signOutFailure(new ApiFailure(500, "server_error", "Une erreur est survenue. Réessayez.")),
    ).toBe("Une erreur est survenue. Réessayez. Vous êtes encore connecté sur cet appareil.");
  });
});

describe("people who came in by themself", () => {
  const now = new Date("2026-11-20T12:00:00");
  it("says how and when they came in", () => {
    expect(joinedWithText("company_code")).toBe("Compte créé avec le code d'entreprise");
    expect(joinedWithText(null)).toBe("Entré avec le code QR d'un chantier");
    expect(whenText(new Date("2026-11-20T07:30:00").toISOString(), now)).toBe(
      "aujourd'hui à 7 h 30",
    );
  });

  it("explains the list to confirm by the ways they came in", () => {
    expect(toConfirmText([{ joinedWith: "company_code" }])).toMatch(
      /^Cette personne a créé son compte avec le code d'entreprise/,
    );
    expect(toConfirmText([{ joinedWith: null }, { joinedWith: null }])).toMatch(
      /^Ces personnes sont entrées avec le code QR d'un chantier/,
    );
    expect(toConfirmText([{ joinedWith: "company_code" }, {}])).toMatch(
      /code QR d'un chantier ou le code d'entreprise/,
    );
  });
});

describe("a newcomer with someone's name", () => {
  const camille = { id: "a", name: "Camille Roy", active: true, role: "admin" as const };
  it("is matched whatever the accents, capitals and spaces", () => {
    const twin = { id: "b", name: " camille  roy", active: true, role: "travailleur" as const };
    expect(sameNameAs(twin, [camille, twin])).toBe(camille);
    expect(sameNameAs({ ...twin, name: "Camille Rioux" }, [camille, twin])).toBeUndefined();
    // Someone switched off holds no name.
    expect(sameNameAs(twin, [{ ...camille, active: false }, twin])).toBeUndefined();
    expect(sameNameText(camille)).toBe("Même nom que Camille Roy (Bureau), déjà dans l'équipe.");
  });
});

describe("the company code's pause", () => {
  const now = new Date("2026-11-20T10:00:00");
  it("says until when, today or later", () => {
    expect(untilText(new Date("2026-11-20T14:30:00").toISOString(), now)).toMatch(
      /^jusqu'à 14\sh\s30$/,
    );
    expect(untilText(new Date("2026-11-21T09:05:00").toISOString(), now)).toMatch(
      /^jusqu'à demain 9\sh\s05$/,
    );
  });

  it("names the reason and the way to reopen", () => {
    const paused = pauseText(
      { reason: "wrong_codes", until: new Date("2026-11-21T09:05:00").toISOString() },
      now,
    );
    expect(paused.title).toMatch(/^En pause jusqu'à demain 9/);
    expect(paused.text).toMatch(/^Trop de codes erronés.*Changez le code pour rouvrir/);
    expect(
      pauseText({ reason: "accounts", until: new Date("2026-11-20T14:30:00").toISOString() }, now)
        .text,
    ).toMatch(/^Le nombre de comptes permis par jour est atteint/);
  });
});
