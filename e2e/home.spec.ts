import { expect, test, type Page } from "@playwright/test";

import { contextAs, seed } from "./support";

// The frame and the project's home: what a phone shows first, the way back,
// the tabs that make way on forms, and the list of projects.

const home = `/projets/${seed.projectId}`;
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

test("the home resumes the sheet opened last, and offers the others", async ({ browser }) => {
  const context = await contextAs(browser, "worker");
  const page = await context.newPage();
  await page.goto(home);
  // Nothing opened yet on this device: the plans card leads to the list.
  const plans = page.getByRole("link", { name: /^Plans\s*8 feuilles/ });
  await expect(plans).toBeVisible();
  await expect(page.getByRole("link", { name: /^Reprendre/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Autres plans récents" })).toHaveCount(0);

  for (const sheetId of [seed.sheetIds[1], seed.sheetIds[2]]) {
    await page.goto(`${home}/feuilles/${sheetId}`);
    await page.waitForTimeout(800);
  }
  await page.goto(home);
  const resume = page.getByRole("link", { name: /^Reprendre / });
  await expect(resume).toBeVisible();
  await expect(plans).toHaveCount(0);
  const others = page
    .getByRole("heading", { name: "Autres plans récents" })
    .locator("xpath=ancestor::section")
    .getByRole("link");
  await expect(others).toHaveCount(1);

  await page.getByRole("link", { name: "Toutes les feuilles (8)" }).click();
  await expect(page).toHaveURL(new RegExp(`${home}/plans$`));
  await page.goto(home);
  await resume.click();
  await expect(page).toHaveURL(new RegExp(`/feuilles/${seed.sheetIds[2]}`));
  await page.goto(home);
  await others.click();
  await expect(page).toHaveURL(new RegExp(`/feuilles/${seed.sheetIds[1]}`));
  await context.close();
});

test("from the project's home, one tap starts dictating the day's report", async ({ browser }) => {
  const context = await contextAs(browser, "foreman");
  const page = await context.newPage();
  await page.goto(home);
  await expect(page.getByLabel("Prendre une photo")).toBeAttached();
  await expect(page.getByText("Prendre une photo")).toBeVisible();
  const shortcut = page.getByRole("link", { name: /Dicter le rapport du jour/ });
  const done = page.getByRole("link", { name: /Rapport du jour fait/ });
  await expect(shortcut.or(done)).toBeVisible();
  // Another test may have written today's report: the home then links to it.
  test.skip(await done.isVisible(), "today's report exists");
  await shortcut.click();
  await expect(page.getByRole("button", { name: "Terminer l'enregistrement" })).toBeVisible();
  // The mark has left the address: reloading would not start a recording.
  await expect(page).toHaveURL(/\/rapports\/nouveau(\?jour=[\d-]+)?$/);
  await page.getByRole("button", { name: "Annuler" }).click();
  await context.close();
});

test("a worker's home offers a photo and no report", async ({ browser }) => {
  const context = await contextAs(browser, "worker");
  const page = await context.newPage();
  await page.goto(home);
  // One tap from the home opens the camera.
  await expect(page.getByLabel("Prendre une photo")).toBeAttached();
  await expect(page.getByText("Prendre une photo")).toBeVisible();
  await expect(page.getByRole("link", { name: /rapport du jour/i })).toHaveCount(0);
  await context.close();
});

test("one short row leads to the documents, the photos and the reports", async ({ browser }) => {
  const foreman = await contextAs(browser, "foreman");
  const page = await foreman.newPage();
  await page.goto(home);
  const documents = page.getByRole("link", { name: /^\d+ documents?$/ });
  await expect(documents).toBeVisible();
  await expect(page.getByRole("link", { name: /^\d+ photos?$/ })).toBeVisible();
  const reports = page.getByRole("link", { name: /^\d+ rapports?$/ });
  await expect(reports).toBeVisible();
  const box = await documents.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeLessThanOrEqual(56);
  await reports.click();
  await expect(page).toHaveURL(new RegExp(`${home}/rapports$`));
  await foreman.close();

  const worker = await contextAs(browser, "worker");
  const workerPage = await worker.newPage();
  await workerPage.goto(home);
  await expect(workerPage.getByRole("link", { name: /^\d+ photos?$/ })).toBeVisible();
  await expect(workerPage.getByRole("link", { name: /^\d+ rapports?$/ })).toHaveCount(0);
  await worker.close();
});

test("on a phone, the top bar's arrow goes back one screen", async ({ browser }) => {
  const context = await contextAs(browser, "foreman");
  const page = await context.newPage();
  test.skip(!isPhone(page), "the top bar is for phones");
  await page.goto(home);
  await expect(page.getByRole("link", { name: "Tous les projets" })).toBeVisible();

  await page.goto(`${home}/equipe`);
  const up = page.getByRole("link", { name: /^Retour\s:\sAccueil du projet$/ });
  await expect(up).toBeVisible();
  // A single way back: the page's own link is kept for computers.
  await expect(page.getByRole("link", { name: "Accueil du projet", exact: true })).toBeHidden();
  await up.click();
  await expect(page).toHaveURL(new RegExp(`${home}$`));

  await page.goto(`${home}/rapports/nouveau`);
  await page.getByRole("link", { name: /^Retour\s:\sRapports$/ }).click();
  await expect(page).toHaveURL(new RegExp(`${home}/rapports$`));
  await expect(page.getByRole("link", { name: "Tous les projets" })).toBeVisible();
  await context.close();
});

test("on a phone, the tabs make way on a form", async ({ browser }) => {
  const context = await contextAs(browser, "foreman");
  const page = await context.newPage();
  test.skip(!isPhone(page), "a computer has a sidebar");
  const tabs = page.getByRole("navigation", { name: "Navigation" });
  const tabsHeight = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--ead-tabs").trim(),
    );

  await page.goto(`${home}/rapports`);
  await expect(tabs.getByRole("link", { name: "Rapports" })).toBeVisible();
  expect(await tabsHeight()).not.toBe("0px");

  await page.goto(`${home}/rapports/nouveau`);
  await expect(page.getByRole("heading", { name: "Nouveau rapport" })).toBeVisible();
  await expect(tabs).toBeHidden();
  expect(await tabsHeight()).toBe("0px");

  await page.getByRole("link", { name: /^Retour\s:\sRapports$/ }).click();
  await expect(tabs.getByRole("link", { name: "Rapports" })).toBeVisible();
  await context.close();
});

test("the list of projects starts with the one opened last", async ({ browser }) => {
  const context = await contextAs(browser, "admin");
  const page = await context.newPage();
  await page.goto("/");
  const cards = page.getByRole("main").getByRole("list").first().getByRole("link");
  await expect(cards.first()).toBeVisible();
  // A project not set up yet says so in words.
  await expect(page.getByText("Aucun plan").first()).toBeVisible();
  await expect(page.getByText(/^0 feuille$/)).toHaveCount(0);

  const last = cards.last();
  const href = await last.getAttribute("href");
  expect(href).toBeTruthy();
  await last.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/");
  await expect(cards.first()).toHaveAttribute("href", href!);
  await context.close();
});
