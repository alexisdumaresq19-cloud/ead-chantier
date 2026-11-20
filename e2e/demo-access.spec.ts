import { expect, test } from "@playwright/test";

import { confirm, device, typeCode } from "./access-support";
import { call, contextAs, seed } from "./support";

// The demonstration access, as Apple's reviewer will meet it: the office
// makes it on a project and reads its number and code; a visitor types them
// and sees the project as a foreman does, assistant and reports included;
// they delete the account, as the reviewer must be able to, and the next
// visitor still gets in. The account never touches the team, by the screens
// or by the API, and the office removes the access when it is done.

test.describe.configure({ mode: "serial" });

let access: { phone: string; code: string };

test("the office makes the access on a project and reads its number and code", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const page = await office.newPage();
  await page.goto("/equipe");
  const card = page.getByRole("region", { name: "Accès de démonstration" });
  await card.getByRole("button", { name: "Créer l'accès de démonstration" }).click();
  const sheet = page.getByRole("dialog", { name: "Créer l'accès de démonstration" });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(450);
  // At least one project: said before anything is sent.
  await sheet.getByRole("button", { name: "Créer l'accès", exact: true }).click();
  await expect(sheet).toContainText("Cochez au moins un projet à montrer.");
  await sheet.getByLabel("Réfection de la rue Principale").check();
  await sheet.getByRole("button", { name: "Créer l'accès", exact: true }).click();
  await expect(card.getByText("Actif")).toBeVisible();
  // A number from the range kept for fiction, and eight digits.
  await expect(card).toContainText("418 555-0100");
  await expect(card).toContainText(/\d{4}\u00a0\d{4}/);
  await expect(card).toContainText("Réfection de la rue Principale");
  const read = await call(office.request, "GET", "/api/company/demo");
  access = read.body.access;
  expect(access.phone).toBe("418 555-0100");
  await expect(card).toContainText(`${access.code.slice(0, 4)}\u00a0${access.code.slice(4)}`);
  // The team's list names it for what it is.
  await expect(
    page.getByRole("link", { name: /Compte de démonstration/ }).getByText("Démonstration", {
      exact: true,
    }),
  ).toBeVisible();
  // Only the office reads it.
  const foreman = await contextAs(browser, "foreman");
  expect((await call(foreman.request, "GET", "/api/company/demo")).status).toBe(403);
  await Promise.all([office.close(), foreman.close()]);
});

test("a visitor types them and sees the project as a foreman, for a day", async ({ browser }) => {
  const visitor = await device(browser);
  const page = await visitor.newPage();
  await typeCode(page, access.phone, access.code);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await expect(page.getByText("Réfection de la rue Principale")).toBeVisible();
  await expect(page.getByText("Stationnement du centre aquatique")).toHaveCount(0);
  const cookie = (await visitor.cookies()).find((c) => c.name === "ead_session")!;
  const hours = (cookie.expires * 1000 - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23);
  expect(hours).toBeLessThan(25);

  await page.getByText("Réfection de la rue Principale").click();
  // The daily reports, which only foremen and the office see, beside the plans.
  await page.getByRole("link", { name: "Rapports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Rapports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plans", exact: true }).first()).toBeVisible();
  await visitor.close();
});

test("the account never touches the team, by the screens or by the API", async ({ browser }) => {
  const visitor = await device(browser);
  const page = await visitor.newPage();
  await typeCode(page, access.phone, access.code);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await page.goto(`/projets/${seed.projectId}/equipe`);
  await expect(page.getByRole("heading", { name: "Équipe du projet" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Code QR du chantier/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Ajouter des personnes/ })).toHaveCount(0);
  // The team's numbers are not handed to a visitor.
  await expect(page.getByRole("link", { name: /^Appeler / })).toHaveCount(0);
  await page.goto("/equipe");
  await expect(page.getByText("Réservé au bureau")).toBeVisible();

  const office = await contextAs(browser, "admin");
  const people = (await call(office.request, "GET", "/api/users")).body as {
    id: string;
    demo: boolean;
    name: string;
    unreviewed: boolean;
  }[];
  const demo = people.find((person) => person.demo)!;
  const worker = people.find((person) => person.name === "Marc Lévesque")!;
  const tries = [
    ["POST", `/api/projects/${seed.projectId}/qr`, {}],
    ["POST", `/api/projects/${seed.projectId}/members/${worker.id}/review`, { decision: "refuse" }],
    ["POST", `/api/projects/${seed.projectId}/members`, { userIds: [worker.id] }],
    ["DELETE", `/api/projects/${seed.projectId}/members/${worker.id}`, undefined],
    ["POST", "/api/users", { name: "Intrus", role: "admin", projectIds: [] }],
    ["PATCH", `/api/users/${worker.id}`, { active: false }],
    ["PATCH", `/api/users/${demo.id}`, { role: "admin" }],
    ["GET", "/api/users", undefined],
    ["POST", "/api/company/demo", { projectIds: [seed.projectId] }],
  ] as const;
  for (const [method, path, data] of tries) {
    const refused = await call(visitor.request, method, path, data);
    expect(refused.status, `${method} ${path}`).toBe(403);
  }
  // Nor does the office make it anything else, or send it a link.
  const promoted = await call(office.request, "PATCH", `/api/users/${demo.id}`, { role: "admin" });
  expect(promoted.status).toBe(403);
  expect((await call(office.request, "POST", `/api/users/${demo.id}/invite`)).status).toBe(403);
  expect((await call(visitor.request, "GET", "/api/me")).body).toMatchObject({
    demo: true,
    role: "contremaitre",
  });
  await Promise.all([office.close(), visitor.close()]);
});

test("the visitor deletes the account, and the next visitor still gets in", async ({ browser }) => {
  const first = await device(browser);
  const page = await first.newPage();
  await typeCode(page, access.phone, access.code);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  const before = (await call(first.request, "GET", "/api/me")).body.id;
  await page.goto("/moi");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await confirm(page, "Supprimer mon compte");
  await expect(page).toHaveURL(/\/bienvenue/);
  expect((await call(first.request, "GET", "/api/me")).status).toBe(401);
  await first.close();

  const next = await device(browser);
  const again = await next.newPage();
  await typeCode(again, access.phone, access.code);
  await expect(again.getByRole("heading", { name: "Projets" })).toBeVisible();
  await expect(again.getByText("Réfection de la rue Principale")).toBeVisible();
  const after = (await call(next.request, "GET", "/api/me")).body.id;
  expect(after).not.toBe(before);
  await next.close();
});

test("the office removes the access: the number and the code stop working", async ({ browser }) => {
  const visitor = await device(browser);
  const inside = await call(visitor.request, "POST", "/api/sessions/code", access);
  expect(inside.status).toBe(200);

  const office = await contextAs(browser, "admin");
  const page = await office.newPage();
  await page.goto("/equipe");
  const card = page.getByRole("region", { name: "Accès de démonstration" });
  await card.getByRole("button", { name: "Retirer l'accès" }).click();
  await confirm(page, "Retirer l'accès");
  await expect(card.getByRole("button", { name: "Créer l'accès de démonstration" })).toBeVisible();
  // Signed out everywhere, and its code refused like any wrong one.
  expect((await call(visitor.request, "GET", "/api/me")).status).toBe(401);
  const refused = await call(visitor.request, "POST", "/api/sessions/code", access);
  expect(refused.body.error.code).toBe("wrong_access_code");
  await Promise.all([office.close(), visitor.close()]);
});
