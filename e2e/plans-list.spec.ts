import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { contextAs, seed, type Role } from "./support";

// The plan list on a phone: a search with all the width, titles kept whole up
// to their chainage, quiet revision labels, the words found on every sheet
// said once, and forms that say in French what is missing.

const LIST_PATH = `/projets/${seed.projectId}/plans`;

/** The settings of the device the test runs as (phone or desktop). */
function device() {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, timezoneId } =
    test.info().project.use;
  return { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, timezoneId };
}

const signedIn = (browser: Browser, role: Role, viewport = device().viewport) =>
  contextAs(browser, role, { ...device(), viewport });

/** A window ignores taps for a moment after it opens (a double tap is no answer). */
const settle = (page: Page) => page.waitForTimeout(450);

/** Whether an element shows all its text: nothing clamped, nothing scrolled away. */
const whole = (element: Locator) =>
  element.evaluate(
    (node) =>
      node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1,
  );

const row = (page: Page, number: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("link", { name: new RegExp(number) }) });

test("on the narrowest phone the search has the whole width and titles keep their chainage", async ({
  browser,
}) => {
  // A foreman: the menu button narrows the rows.
  const context = await signedIn(browser, "foreman", { width: 360, height: 740 });
  const page = await context.newPage();
  await page.goto(LIST_PATH);
  const search = page.getByPlaceholder("Rechercher un plan");
  await expect(search).toBeVisible();

  // The search runs from one side of the column to the other; the choice of
  // view sits under it, on the line of the count.
  const field = (await search.boundingBox())!;
  expect(field.width).toBeGreaterThan(360 - 2 * 16 - 4);
  const toggle = (await page.getByRole("button", { name: "Afficher en vignettes" }).boundingBox())!;
  expect(toggle.y).toBeGreaterThan(field.y + field.height);
  expect(toggle.height).toBeGreaterThanOrEqual(40);
  // Nothing goes sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  for (const view of ["Afficher en liste", "Afficher en vignettes"]) {
    await page.getByRole("button", { name: view }).click();
    for (const number of ["C-102", "C-103"]) {
      const title = row(page, number).getByText(/ch\. 0\+\d{3} à 0\+\d{3}/);
      await expect(title).toBeVisible();
      expect(await whole(title)).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Afficher en liste" }).click();
  await context.close();
});

test("a sheet's first revision is a quiet grey label", async ({ browser }) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  await page.goto(LIST_PATH);
  const label = row(page, "C-001").getByText(/^Rév\. 0/);
  await expect(label).toBeVisible();
  await expect(label).toHaveText("Rév. 0");
  await expect(page.getByText("· nouvelle")).toHaveCount(0);
  // Not in the blue that marks what is new.
  const colour = await label.evaluate((node) => getComputedStyle(node).color);
  expect(colour).not.toBe("rgb(34, 105, 149)");
  await context.close();
});

test("words drawn on every sheet are found once, with the sheets that carry them", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  await page.goto(LIST_PATH);
  await page.getByPlaceholder("Rechercher un plan").fill("regards sont");
  const drawn = page.getByRole("region", { name: "Trouvé sur les plans" });
  await expect(drawn).toBeVisible();

  // The general notes, said once, from the start of their sentence.
  await expect(drawn.getByRole("listitem")).not.toHaveCount(0);
  const unfold = drawn.getByRole("button", { name: /^Sur \d+ feuilles/ });
  await expect(unfold).toHaveCount(1);
  await expect(drawn.getByText(/^6\. Les regards sont préfabriqués/)).toBeVisible();
  await expect(drawn.getByText(/^…/)).toHaveCount(0);

  // Alone in its section, it opens unfolded: one tap per sheet.
  await expect(unfold).toHaveAttribute("aria-expanded", "true");
  const total = Number((await unfold.textContent())!.match(/\d+/)![0]);
  const sheets = drawn.getByRole("link");
  await expect(sheets).toHaveCount(total);
  for (const link of await sheets.all()) {
    await expect(link).toHaveText(/^C-\d{3}$/);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await unfold.click();
  await expect(unfold).toHaveAttribute("aria-expanded", "false");
  await expect(sheets).toHaveCount(0);
  await unfold.click();

  // A sheet opens, and the way back finds the results as they were left.
  await sheets.filter({ hasText: "C-201" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "C-201" })).toBeVisible();
  await page.goBack();
  await expect(page.getByPlaceholder("Rechercher un plan")).toHaveValue("regards sont");
  await expect(drawn.getByRole("link", { name: "C-201" })).toBeVisible();
  await context.close();
});

test("the plan forms say in French what is missing, under the field", async ({ browser }) => {
  const context = await signedIn(browser, "foreman");
  const page = await context.newPage();
  await page.goto(LIST_PATH);

  // A new folder without a name.
  await page.getByRole("button", { name: /Nouveau dossier/ }).click();
  const folder = page.getByRole("dialog", { name: "Nouveau dossier" });
  await settle(page);
  await folder.getByRole("button", { name: "Créer le dossier" }).click();
  await expect(folder.getByText("Inscrivez le nom du dossier.")).toBeVisible();
  const name = folder.getByLabel("Nom du dossier");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.fill("Civil");
  await expect(folder.getByText("Inscrivez le nom du dossier.")).toHaveCount(0);
  await folder.getByRole("button", { name: "Annuler" }).click();
  await expect(folder).toBeHidden();

  // A sheet renamed without a number.
  await page.getByRole("button", { name: "Gérer la feuille C-102" }).click();
  const menu = page.getByRole("dialog", { name: "C-102" });
  await settle(page);
  // The actions are grouped in one frame, as in the documents.
  await expect(menu.getByRole("list")).toHaveCount(1);
  await menu.getByRole("button", { name: /^Renommer/ }).click();
  const rename = page.getByRole("dialog", { name: "Renommer C-102" });
  await settle(page);
  await rename.getByLabel("Numéro").fill("");
  await rename.getByRole("button", { name: "Enregistrer" }).click();
  await expect(rename.getByText("Inscrivez le numéro de la feuille.")).toBeVisible();
  await expect(rename.getByLabel("Numéro")).toBeFocused();
  await rename.getByRole("button", { name: "Retour" }).click();

  // A folder made on the way, without a name.
  await menu.getByRole("button", { name: /^Déplacer/ }).click();
  const move = page.getByRole("dialog", { name: "Déplacer C-102" });
  await settle(page);
  await move.getByRole("button", { name: "Créer" }).click();
  await expect(move.getByText("Inscrivez le nom du dossier.")).toBeVisible();
  await expect(move.getByLabel("Nouveau dossier")).toBeFocused();
  await move.getByRole("button", { name: "Fermer" }).click();
  await expect(move).toBeHidden();
  // Nothing was changed.
  await expect(row(page, "C-102").getByRole("link", { name: /C-102/ })).toBeVisible();
  await context.close();
});
