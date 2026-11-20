import { expect, test } from "@playwright/test";

import { freeDay, newForeman, put } from "./privacy-support";
import { call, contextAs, seed } from "./support";

// What Apple and Québec's Law 25 ask of the app: a privacy policy and a
// support page anyone can read, the company's details kept by the office,
// and the person's agreement before the assistant sends anything to an AI
// service.

const dictation = `/api/projects/${seed.projectId}/reports/dictation`;

test("the privacy policy and the support page are the server's, open to anyone, without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: seed.base, javaScriptEnabled: false });
  const page = await context.newPage();

  for (const [path, title] of [
    ["/confidentialite", "Politique de confidentialité"],
    ["/soutien", "Aide et soutien"],
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    // The page itself, written by the server: the app's one page would draw nothing here.
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'application" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page).toHaveTitle(new RegExp(title));
  }

  await page.goto("/confidentialite");
  await expect(page.getByText(/Version du \d+(er)? \w+ 20\d\d/).first()).toBeVisible();
  await expect(page.getByText("Les Entreprises Allen Dumaresq").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Commission d'accès à l'information du Québec" }),
  ).toBeVisible();
  // While the office has not named anyone, the page says who it is by law.
  await expect(page.getByText(/la personne qui a la plus haute autorité/)).toBeVisible();
  await page.goto("/soutien");
  await expect(page.getByText("adressez-vous au bureau de votre entreprise")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Politique de confidentialité", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("the office keeps the company's details, and the public pages show them", async ({
  browser,
}) => {
  const worker = await contextAs(browser, "worker");
  expect((await call(worker.request, "GET", "/api/company/profile")).status).toBe(403);
  await worker.close();

  const context = await contextAs(browser, "admin");
  const api = context.request;
  const before = (await call(api, "GET", "/api/company/profile")).body;
  // Nothing is ever filled in but the name.
  expect(before).toMatchObject({ name: "Les Entreprises Allen Dumaresq", phone: "", email: "" });
  const refused = await put(api, "/api/company/profile", {
    ...before,
    email: "bureau@",
  });
  expect(refused.status).toBe(400);

  const page = await context.newPage();
  await page.goto("/equipe");
  const card = page.getByRole("region", { name: "Coordonnées de l'entreprise" });
  await expect(card.getByText(/Il manque l'adresse, le téléphone, le courriel/)).toBeVisible();
  await expect(
    card.getByText("La politique de confidentialité affiche ces coordonnées."),
  ).toBeVisible();
  await card.getByRole("button", { name: "Compléter" }).click();

  const sheet = page.getByRole("dialog", { name: "Coordonnées de l'entreprise" });
  // A window ignores taps in its first instants (src/client/ui/sheet.tsx).
  await page.waitForTimeout(400);
  await sheet.getByLabel("Téléphone").fill("418 555-0100");
  await sheet.getByRole("textbox", { name: /^Courriel Facultatif/ }).fill("pas un courriel");
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet.getByText("Ce courriel n'est pas valide.")).toBeVisible();
  await sheet.getByRole("textbox", { name: /^Courriel Facultatif/ }).fill("  Bureau@Exemple.test ");
  await sheet.getByLabel("Adresse postale").fill("100, rue Exemple\nVille Exemple (Québec)");
  await sheet
    .getByRole("textbox", { name: "Nom Facultatif", exact: true })
    .fill("Personne Exemple");
  await sheet.getByLabel("Titre").fill("Responsable fictive");
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet).toBeHidden();
  await expect(card.getByText("bureau@exemple.test")).toBeVisible();
  await expect(card.getByText("Complet")).toBeVisible();
  await expect(card.getByText(/Il manque/)).toHaveCount(0);

  const visitor = await browser.newContext({ baseURL: seed.base });
  const pub = await visitor.newPage();
  await pub.goto("/confidentialite");
  await expect(pub.getByText("Personne Exemple")).toBeVisible();
  await expect(pub.getByText(/plus haute autorité/)).toHaveCount(0);
  await expect(pub.getByRole("link", { name: "418 555-0100" })).toHaveAttribute(
    "href",
    "tel:+14185550100",
  );
  await pub.goto("/soutien");
  await expect(pub.getByRole("link", { name: "bureau@exemple.test" })).toHaveAttribute(
    "href",
    "mailto:bureau@exemple.test",
  );
  await visitor.close();

  // Put back as it was, for the specs that follow.
  expect((await put(api, "/api/company/profile", before)).status).toBe(200);
  await context.close();
});

test("the assistant asks first, takes no for an answer, and the agreement can be taken back", async ({
  browser,
}) => {
  const { context } = await newForeman(browser);
  const api = context.request;

  // Without an agreement the server sends nothing anywhere, whatever the page.
  expect((await call(api, "GET", "/api/assistant")).body).toMatchObject({ consentAt: null });
  const form = { multipart: { day: freeDay(70), current: "{}", text: "Soleil toute la journée." } };
  const early = await api.post(dictation, { ...form, headers: { origin: seed.base } });
  expect(early.status()).toBe(403);
  expect((await early.json()).error.code).toBe("assistant_consent_required");

  const page = await context.newPage();
  await page.goto(`/projets/${seed.projectId}/rapports/nouveau?jour=${freeDay(70)}`);
  await page.getByRole("button", { name: /Dicter le rapport/ }).click();
  const question = page.getByRole("dialog", { name: "Avant d'utiliser l'assistant" });
  await expect(question).toBeVisible();
  await expect(
    question.getByText("l'enregistrement de votre voix, quand vous dictez;"),
  ).toBeVisible();
  await expect(question.getByText("les photos du rapport.")).toBeVisible();
  await expect(question.getByText(/États-Unis/)).toBeVisible();
  await expect(
    question.getByRole("link", { name: "Politique de confidentialité" }),
  ).toHaveAttribute("href", "/confidentialite");
  // Nothing records while the question is open.
  await expect(page.getByRole("button", { name: "Terminer l'enregistrement" })).toHaveCount(0);

  // "Pas maintenant": the window closes, the report is still written by hand.
  await page.waitForTimeout(400);
  await question.getByRole("button", { name: "Pas maintenant" }).click();
  await expect(question).toBeHidden();
  await expect(page.getByLabel("Travaux réalisés")).toBeVisible();
  expect((await call(api, "GET", "/api/assistant")).body.consentAt).toBeNull();

  // Asked again next time; agreeing starts the recording the tap asked for.
  await page.getByRole("button", { name: /Dicter le rapport/ }).click();
  await expect(question).toBeVisible();
  await page.waitForTimeout(400);
  await question.getByRole("button", { name: "J'accepte" }).click();
  await expect(page.getByRole("button", { name: "Terminer l'enregistrement" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Annuler", exact: true }).click();
  expect((await call(api, "GET", "/api/assistant")).body.consentAt).toEqual(expect.any(String));
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

  // Once agreed, the question does not come back.
  await page.getByRole("button", { name: /Dicter le rapport/ }).click();
  await expect(page.getByRole("dialog", { name: /J'écoute|Dicter le rapport/ })).toBeVisible();
  await expect(question).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

  // Mon compte shows the agreement with its date, and takes it back.
  await page.goto("/moi");
  await expect(page.getByText(/^Accepté le \d+(er)? \w+ 20\d\d$/)).toBeVisible();
  await page.getByRole("button", { name: "Retirer mon accord" }).click();
  // A window ignores taps in its first instants (src/client/ui/sheet.tsx).
  await page.waitForTimeout(400);
  await page
    .getByRole("dialog", { name: "Retirer votre accord?" })
    .getByRole("button", { name: "Retirer mon accord" })
    .click();
  await expect(page.getByText("Pas encore accepté")).toBeVisible();
  expect((await call(api, "GET", "/api/assistant")).body.consentAt).toBeNull();
  const after = await api.post(dictation, { ...form, headers: { origin: seed.base } });
  expect(after.status()).toBe(403);
  await context.close();
});

test("a worker sees no assistant setting on the account screen", async ({ browser }) => {
  const context = await contextAs(browser, "worker");
  const page = await context.newPage();
  await page.goto("/moi");
  await expect(page.getByRole("heading", { name: "Mon compte", exact: true })).toBeVisible();
  await expect(page.getByText("Assistant du rapport")).toHaveCount(0);
  await context.close();
});
