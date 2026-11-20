import { expect, test, type Page } from "@playwright/test";

import { device, fictionalPhone, personWithCode, typeCode } from "./access-support";
import { call, contextAs, post, seed } from "./support";

// Getting in by typing: the office adds someone and reads the code beside
// their link, the person types their cell number and that code (the iPhone
// app's way in) and is in; the code is used up with its link, dies with a new
// one, is refused when wrong, and a network that keeps guessing is told
// plainly to wait. Someone without a cell number on file is pointed out to
// the office, which adds it on the spot.

/** The form's own message (Next's route announcer is an alert too, always empty). */
const formError = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

const tag = Math.random().toString(36).slice(2, 6);
const run = () => `${test.info().project.name} ${tag}`;

test("the office reads the code beside the link; the person types it and is in, once", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const desk = await office.newPage();
  await desk.goto("/equipe");
  await desk.getByRole("button", { name: "Ajouter une personne" }).first().click();
  // A window ignores taps during its first moments.
  await expect(desk.getByRole("dialog", { name: "Ajouter une personne" })).toBeVisible();
  await desk.waitForTimeout(450);
  const phone = fictionalPhone();
  const name = `Luc Code ${run()}`;
  await desk.getByLabel("Prénom et nom").fill(name);
  await desk.getByLabel("Cellulaire").fill(phone);
  await desk.getByLabel("Réfection de la rue Principale").check();
  await desk.getByRole("button", { name: "Ajouter et créer le lien" }).click();
  const sheet = desk.getByRole("dialog", { name: "Luc peut entrer" });
  await expect(sheet).toBeVisible();
  // Large, in two groups of four, with how to use it and the number it goes with.
  const shown = sheet.getByTestId("access-code");
  await expect(shown).toHaveText(/^\d{4}\u00a0\d{4}$/);
  await expect(sheet).toContainText(
    "Dans l'application\u00a0: J'ai déjà un compte, puis Avec un code du bureau.",
  );
  await expect(sheet).toContainText(`À taper avec son cellulaire, le ${phone}.`);
  const code = (await shown.textContent())!.replace(/\D/g, "");
  // The text message carries it too.
  const sms = await sheet.getByRole("link", { name: "Texto" }).getAttribute("href");
  expect(decodeURIComponent(sms!)).toContain(
    `Votre code\u00a0: ${code.slice(0, 4)}\u00a0${code.slice(4)}`,
  );
  const link = new URL(await sheet.getByLabel(`Lien personnel de ${name}`).inputValue()).pathname;
  await office.close();

  const phoneDevice = await device(browser);
  const page = await phoneDevice.newPage();
  // Typed the way people type: with the leading 1 and dashes.
  await typeCode(page, `1-${phone.replace(" ", "-")}`, code);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await expect(page.getByText("Réfection de la rue Principale")).toBeVisible();
  await expect((await call(phoneDevice.request, "GET", "/api/me")).body.name).toBe(name);

  // Used once, by the code: its link is used up too.
  const other = await device(browser);
  const second = await other.newPage();
  await second.goto(link);
  await expect(second.getByRole("heading", { name: "Ce lien ne fonctionne plus" })).toBeVisible();
  await Promise.all([phoneDevice.close(), other.close()]);
});

test("a wrong code is refused, and too many tries are said plainly", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const phone = fictionalPhone();
  const made = await personWithCode(office, { name: `Anne Erreur ${run()}`, phone });
  await office.close();
  const wrong = made.invite.code.slice(0, 7) + ((Number(made.invite.code[7]) + 1) % 10);

  const visitor = await device(browser);
  const page = await visitor.newPage();
  await typeCode(page, phone, wrong);
  await expect(formError(page)).toContainText(
    "Ce numéro ou ce code n'est pas le bon. Vérifiez les deux, ou demandez un nouveau code au bureau.",
  );
  // The cursor is back in the code, which is what most often needs another look.
  await expect(page.getByLabel("Code du bureau")).toBeFocused();
  // A number that belongs to nobody gets the very same answer.
  const nobody = await call(visitor.request, "POST", "/api/sessions/code", {
    phone: "418 555-0199",
    code: wrong,
  });
  expect(nobody.status).toBe(400);
  expect(nobody.body.error.code).toBe("wrong_access_code");
  // A network that keeps guessing is held, the right code included.
  for (let i = 0; i < 8; i++)
    await call(visitor.request, "POST", "/api/sessions/code", {
      phone: `418 555-018${i}`,
      code: "11112222",
    });
  await page.getByLabel("Code du bureau").fill(made.invite.code);
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(formError(page)).toContainText(
    /^Trop d'essais à partir de ce réseau\. Réessayez (à|demain à) \d+\u00a0h\u00a0\d\d, ou demandez au bureau un lien pour entrer\.$/,
  );
  // Another network, with the right code, still gets in.
  const elsewhere = await device(browser);
  const entered = await call(elsewhere.request, "POST", "/api/sessions/code", {
    phone,
    code: made.invite.code,
  });
  expect(entered.status).toBe(200);
  await Promise.all([visitor.close(), elsewhere.close()]);
});

test("the code dies when the office makes a new link, and the new one works", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const phone = fictionalPhone();
  const made = await personWithCode(office, {
    name: `Paul Nouveau ${run()}`,
    phone,
    projectIds: [seed.projectId],
  });
  const fresh = await post<{ code: string }>(office.request, `/api/users/${made.id}/invite`);
  expect(fresh.code).not.toBe(made.invite.code);
  await office.close();

  const visitor = await device(browser);
  const page = await visitor.newPage();
  await typeCode(page, phone, made.invite.code);
  await expect(formError(page)).toContainText("Ce numéro ou ce code n'est pas le bon.");
  // A whole text message pasted in the code field: the code is found in it.
  await page.getByLabel("Code du bureau").fill("");
  await page.getByLabel("Code du bureau").focus();
  await page.evaluate(
    (text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    `Bonjour Paul, voici votre lien.\nhttps://exemple.ca/i/Ab12345678cD\nVotre code\u00a0: ${fresh.code.slice(0, 4)}\u00a0${fresh.code.slice(4)}`,
  );
  await expect(page.getByLabel("Code du bureau")).toHaveValue(
    `${fresh.code.slice(0, 4)} ${fresh.code.slice(4)}`,
  );
  await page.getByRole("button", { name: "Entrer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await visitor.close();
});

test("without a cell number on file, the office is told and adds it on the spot", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const desk = await office.newPage();
  await desk.goto("/equipe");
  await desk.getByRole("button", { name: "Ajouter une personne" }).first().click();
  // A window ignores taps during its first moments.
  await expect(desk.getByRole("dialog", { name: "Ajouter une personne" })).toBeVisible();
  await desk.waitForTimeout(450);
  const name = `Rose Sansnum ${run()}`;
  await desk.getByLabel("Prénom et nom").fill(name);
  await desk.getByRole("button", { name: "Ajouter et créer le lien" }).click();
  const sheet = desk.getByRole("dialog", { name: "Rose peut entrer" });
  await expect(sheet).toContainText(
    "Le code fonctionne avec le cellulaire de la fiche, et Rose n'en a pas. Ajoutez son numéro.",
  );
  const code = (await sheet.getByTestId("access-code").textContent())!.replace(/\D/g, "");
  await sheet.getByLabel(`Cellulaire de ${name}`).fill("12");
  await sheet.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(sheet).toContainText("Vérifiez le numéro");
  const phone = fictionalPhone();
  await sheet.getByLabel(`Cellulaire de ${name}`).fill(phone);
  await sheet.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(sheet).toContainText(`À taper avec son cellulaire, le ${phone}.`);
  await office.close();

  const visitor = await device(browser);
  const entered = await call(visitor.request, "POST", "/api/sessions/code", { phone, code });
  expect(entered.status, JSON.stringify(entered.body)).toBe(200);
  await visitor.close();
});

test("someone signed in under another name is told to sign out first", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const phone = fictionalPhone();
  const made = await personWithCode(office, { name: `Eve Autre ${run()}`, phone });
  await office.close();
  const worker = await contextAs(browser, "worker");
  const refused = await call(worker.request, "POST", "/api/sessions/code", {
    phone,
    code: made.invite.code,
  });
  expect(refused.status).toBe(409);
  expect(refused.body.error.message).toMatch(/^Cet appareil est déjà connecté sous le nom de /);
  // The screen says so too, before anything is typed.
  const page = await worker.newPage();
  await page.goto("/bienvenue/code");
  await expect(page.getByRole("heading", { name: "Cet appareil est déjà connecté" })).toBeVisible();
  await worker.close();
  // The code still works for its owner.
  const own = await device(browser);
  expect(
    (await call(own.request, "POST", "/api/sessions/code", { phone, code: made.invite.code }))
      .status,
  ).toBe(200);
  await own.close();
});
