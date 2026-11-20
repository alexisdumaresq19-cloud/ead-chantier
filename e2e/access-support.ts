import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { deviceAt, post } from "./support";

// What the specs of signing in by a typed code share (access-code.spec.ts,
// demo-access.spec.ts).

/** A network address of the test's own: the door counts wrong tries per network. */
let addresses = 0;
export const address = () =>
  `198.19.${test.info().project.name === "phone" ? 1 : 2}.${(++addresses % 250) + 1}`;

/**
 * A cell number from the range kept for fiction (418 555-0100 to -0199)
 * that no other test of this size uses. 0100 is left to the demonstration.
 */
let numbers = 0;
export const fictionalPhone = () =>
  `418 555-0${(test.info().project.name === "phone" ? 110 : 150) + (++numbers % 30)}`;

/** A clean device on a network of its own. */
export const device = (browser: Browser) => deviceAt(browser, address());

/** Someone the office adds through the API, with their link and its code. */
export async function personWithCode(
  office: BrowserContext,
  fields: { name: string; phone?: string; projectIds?: string[] },
) {
  return post<{ id: string; invite: { url: string; expiresAt: string; code: string } }>(
    office.request,
    "/api/users",
    { role: "travailleur", projectIds: [], ...fields },
  );
}

/** Types a number and a code on the sign-in screen, reached as people reach it. */
export async function typeCode(page: Page, phone: string, code: string) {
  // "J'ai déjà un compte": the ways in, whether account creation is open or not.
  await page.goto("/bienvenue/compte");
  await page.getByRole("link", { name: /Avec un code du bureau/ }).click();
  await expect(page.getByRole("heading", { name: "Entrer avec un code" })).toBeVisible();
  await page.getByLabel("Cellulaire").fill(phone);
  await page.getByLabel("Code du bureau").fill(code);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
}

/** A window ignores taps during its first moments: the test reads before answering. */
export async function confirm(page: Page, label: string) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(450);
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}
