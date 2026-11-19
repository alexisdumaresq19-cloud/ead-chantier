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
