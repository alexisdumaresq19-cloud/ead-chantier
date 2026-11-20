import { expect, test } from "@playwright/test";

import { post, seed, sessionOf } from "./support";

// Getting in without a password: the welcome screen, the personal link, the
// site's QR code, and what happens to a link that was already used.

test("someone who is not signed in lands on the welcome screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await expect(page.getByRole("heading", { name: "Bienvenue" })).toBeVisible();
  // The office account exists: the first-time setup is no longer offered.
  await expect(page.getByRole("link", { name: /configurer/i })).toHaveCount(0);
});

test("the first-time setup cannot be used again", async ({ page }) => {
  await page.goto("/demarrer");
  await expect(
    page.getByRole("heading", { name: "L'application est déjà configurée" }),
  ).toBeVisible();
});

test("a deep address opens after a full page load, and unknown ones say so", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: sessionOf("worker") });
  const page = await context.newPage();
  await page.goto(`/projets/${seed.projectId}/documents`);
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await page.goto("/projets/inconnu/plans");
  await expect(page.getByRole("heading", { name: "Projet introuvable" })).toBeVisible();
  await page.goto("/une/adresse/qui/nexiste/pas");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await context.close();
});

test("a personal link signs a device in once", async ({ browser, baseURL }) => {
  const office = await browser.newContext({ storageState: sessionOf("admin") });
  const created = await post<{ invite: { url: string } }>(office.request, "/api/users", {
    name: `Essai Lien ${test.info().project.name}`,
    role: "travailleur",
    projectIds: [seed.projectId],
  });
  await office.close();
  const link = new URL(created.invite.url).pathname;

  const device = await browser.newContext({ baseURL });
  const page = await device.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: /^Bonjour Essai Lien/ })).toBeVisible();
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await expect(page.getByText("Réfection de la rue Principale")).toBeVisible();
  // A worker sees only their project and cannot create one.
  await expect(page.getByText("Stationnement du centre aquatique")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Nouveau projet/ })).toHaveCount(0);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Ce lien ne fonctionne plus" })).toBeVisible();
  await expect(
    page.getByText("Il a déjà servi ou il a expiré. Demandez un nouveau lien au bureau."),
  ).toBeVisible();
  // This device is signed in: the app is one tap away.
  await page.getByRole("link", { name: "Ouvrir l'application" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await device.close();
});

test("a code or link that no longer works says whom to ask, and how to get in", async ({
  browser,
  baseURL,
}) => {
  const device = await browser.newContext({ baseURL });
  const page = await device.newPage();
  await page.goto("/j/ce-code-n-existe-plus");
  await expect(page.getByRole("heading", { name: "Ce code QR ne fonctionne plus" })).toBeVisible();
  await expect(
    page.getByText("Demandez à votre contremaître d'afficher le code de la semaine."),
  ).toBeVisible();
  // Nobody is signed in here: no way into the app, only the ways in.
  await expect(page.getByRole("link", { name: "Ouvrir l'application" })).toHaveCount(0);
  await page.getByRole("link", { name: "Comment entrer?" }).click();
  await expect(page.getByRole("heading", { name: "Bienvenue" })).toBeVisible();

  await page.goto("/i/ce-lien-n-existe-plus");
  await expect(page.getByRole("heading", { name: "Ce lien ne fonctionne plus" })).toBeVisible();
  await expect(page.getByText(/Demandez un nouveau lien au bureau/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Comment entrer?" })).toBeVisible();
  await device.close();
});

test("the site's QR code lets a new worker in, straight into the project", async ({
  browser,
  baseURL,
}) => {
  const foreman = await browser.newContext({ storageState: sessionOf("foreman") });
  const qr = await post<{ url: string }>(foreman.request, `/api/projects/${seed.projectId}/qr`);
  await foreman.close();

  const device = await browser.newContext({ baseURL });
  const page = await device.newPage();
  await page.goto(new URL(qr.url).pathname);
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  // Sent without a name: asked for in French under the field, the cursor in it.
  await page.getByRole("button", { name: "Entrer sur le chantier" }).click();
  await expect(page.getByText("Inscrivez votre prénom et votre nom.")).toBeVisible();
  await expect(page.getByLabel("Prénom et nom")).toBeFocused();
  await expect(page).toHaveURL(/\/j\//);
  await page.getByLabel("Prénom et nom").fill(`Essai QR ${test.info().project.name}`);
  await page.getByRole("button", { name: "Entrer sur le chantier" }).click();
  await expect(page).toHaveURL(new RegExp(`/projets/${seed.projectId}$`));
  await expect(page.getByRole("link", { name: /Plans/ }).first()).toBeVisible();
  // Daily reports and management are not for workers.
  await expect(page.getByRole("link", { name: /Rapports/ })).toHaveCount(0);
  await expect(page.getByText("Gestion du projet")).toHaveCount(0);
  await device.close();
});

test("moving between screens never reloads the page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: sessionOf("foreman") });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("Réfection de la rue Principale")).toBeVisible();
  await page.evaluate(() => Object.assign(window, { stillHere: true }));
  await page.getByText("Réfection de la rue Principale").click();
  await expect(page).toHaveURL(new RegExp(`/projets/${seed.projectId}$`));
  await page.getByRole("navigation").getByRole("link", { name: "Plans" }).click();
  await expect(page).toHaveURL(/\/plans$/);
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/projets/${seed.projectId}$`));
  expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(
    true,
  );
  await context.close();
});

test("with account creation open, the first screen offers it, and the ways in one tap away", async ({
  browser,
  baseURL,
}) => {
  const office = await browser.newContext({ storageState: sessionOf("admin") });
  await post(office.request, "/api/company/code");
  const device = await browser.newContext({ baseURL });
  const page = await device.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bienvenue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Créer mon compte" })).toBeVisible();
  await page.getByRole("link", { name: "J'ai déjà un compte" }).click();
  await expect(page).toHaveURL(/\/bienvenue\/compte$/);
  await expect(
    page.getByText("Scannez le code QR de votre contremaître", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Nouveau téléphone ou lien expiré? Demandez un nouveau lien au bureau."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Retour" }).click();
  await expect(page.getByRole("link", { name: "Créer mon compte" })).toBeVisible();
  await office.request.delete("/api/company/code", { headers: { origin: seed.base } });
  await Promise.all([device.close(), office.close()]);
});
