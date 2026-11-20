import { expect, test, type Page } from "@playwright/test";

import { confirm, device, typeCode } from "./access-support";
import { call, contextAs, post, seed } from "./support";

// The demonstration access, as Apple's reviewer will meet it: the office
// makes it on a project and reads its number and code; a visitor types them
// and sees the project as a foreman does, assistant and reports included;
// they delete the account, as the reviewer must be able to, and the next
// visitor still gets in. The account never touches the team, by the screens
// or by the API, and the office removes the access when it is done.

test.describe.configure({ mode: "serial" });

let access: { phone: string; code: string };

/** The day at the site (the tests' browsers are on the site's clock too). */
const siteDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    Date.now() - daysAgo * 86_400_000,
  );

const reportOf = (day: string, workDone: string) => ({
  day,
  weather: { condition: "nuageux", temperatureC: 4, note: "" },
  crew: [{ name: "Pavage Exemple inc.", hours: 8, userId: null }],
  equipment: "",
  workDone,
  notes: "",
});

// A one-page PDF made here.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);

const DEMO_REPORT = "Le compte de démonstration modifie seulement les rapports qu'il a écrits.";

/** What the page shows at its size, of a control drawn twice (bar on a phone, header on a computer). */
const shown = (page: Page, role: "link" | "button", name: string | RegExp) =>
  page.getByRole(role, { name, exact: typeof name === "string" }).filter({ visible: true });

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
  // Where each goes for Apple, ready to paste.
  await expect(card).toContainText(
    "le cellulaire va comme nom d'utilisateur, le code comme mot de passe",
  );
  await expect(card.getByRole("button", { name: "Copier pour Apple" })).toBeVisible();
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
  // A report opens, with its PDF, and the assistant is offered.
  const reports = (await call(visitor.request, "GET", `/api/projects/${seed.projectId}/reports`))
    .body as { id: string }[];
  expect(reports.length).toBeGreaterThan(0);
  const pdf = await visitor.request.get(`/api/reports/${reports[0].id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await call(visitor.request, "GET", "/api/assistant")).body).toEqual({ dictation: true });
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
    // A foreman may do these two: only the demonstration's own check refuses them.
    ["POST", `/api/projects/${seed.projectId}/qr`, {}],
    ["POST", `/api/projects/${seed.projectId}/members/${worker.id}/review`, { decision: "refuse" }],
    // These were the office's already.
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
  // Nor does the office give a person its number.
  const shared = await call(office.request, "PATCH", `/api/users/${worker.id}`, {
    phone: access.phone,
  });
  expect([shared.status, shared.body.error.code]).toEqual([400, "demo_phone"]);
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

test("the account adds to its projects, and never removes or changes what the team made", async ({
  browser,
}) => {
  const visitor = await device(browser);
  expect((await call(visitor.request, "POST", "/api/sessions/code", access)).status).toBe(200);
  const project = `/api/projects/${seed.projectId}`;
  const [photo] = (await call(visitor.request, "GET", `${project}/photos`)).body as {
    id: string;
    canEdit: boolean;
  }[];
  const [document] = (await call(visitor.request, "GET", `${project}/documents`)).body as {
    id: string;
  }[];
  const [report] = (await call(visitor.request, "GET", `${project}/reports`)).body as {
    id: string;
  }[];
  // The screens offer no change to the foreman's photo.
  expect(photo.canEdit).toBe(false);
  const tries = [
    ["DELETE", `/api/photos/${photo.id}`, undefined, "modifie seulement ce qu'il a ajouté"],
    ["PATCH", `/api/photos/${photo.id}`, { caption: "Effacé" }, "modifie seulement"],
    ["DELETE", `/api/documents/${document.id}`, undefined, "modifie seulement"],
    ["PATCH", `/api/reports/${report.id}`, { notes: "Effacé" }, "modifie seulement"],
    ["DELETE", `/api/reports/${report.id}`, undefined, "modifie seulement"],
    ["PATCH", `/api/sheets/${seed.sheetIds[0]}`, { title: "Effacé" }, "sans les modifier"],
    ["DELETE", `/api/sheets/${seed.sheetIds[0]}`, undefined, "sans les modifier"],
    ["POST", `${project}/plan-folders`, { name: "Essai" }, "sans les modifier"],
  ] as const;
  for (const [method, path, data, said] of tries) {
    const refused = await call(visitor.request, method, path, data);
    expect(refused.status, `${method} ${path}`).toBe(403);
    expect(refused.body.error.message).toContain(said);
  }
  // Everything is still there for the team.
  const foreman = await contextAs(browser, "foreman");
  expect((await call(foreman.request, "GET", `/api/photos/${photo.id}`)).status).toBe(200);
  expect((await call(foreman.request, "GET", `/api/reports/${report.id}`)).status).toBe(200);
  await Promise.all([foreman.close(), visitor.close()]);
});

test("the screens offer it only what it may do, and say why where its way is closed", async ({
  browser,
}) => {
  const visitor = await device(browser);
  const page = await visitor.newPage();
  await typeCode(page, access.phone, access.code);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  const base = `/projets/${seed.projectId}`;
  const reports = `/api/projects/${seed.projectId}/reports`;
  const foreman = await contextAs(browser, "foreman");
  // Today's report, already written by the team's foreman; and one of the visitor's own.
  const team = (
    await post<{ report: { id: string } }>(
      foreman.request,
      reports,
      reportOf(siteDay(), "Pose du ponceau."),
    )
  ).report;
  const own = (
    await post<{ report: { id: string } }>(
      visitor.request,
      reports,
      reportOf(siteDay(4), "Visite du chantier."),
    )
  ).report;
  const title = `Document de la visite ${test.info().project.name}`;
  try {
    // The plans: read, searched and opened, never changed.
    await page.goto(`${base}/plans`);
    await expect(page.locator(`a[href*="/feuilles/"]`).first()).toBeVisible();
    for (const control of [
      page.getByRole("button", { name: /Ajouter des plans/ }),
      page.getByRole("button", { name: /Nouveau dossier/ }),
      page.getByRole("button", { name: /^Gérer la feuille/ }),
      page.getByRole("button", { name: /^Modifier le dossier/ }),
    ])
      await expect(control).toHaveCount(0);
    await page.locator(`a[href*="/feuilles/"]`).first().click();
    await expect(page.getByRole("button", { name: /révisions/i }).first()).toBeVisible();
    // An import's address typed by hand says why.
    await page.goto(`${base}/plans/import/inconnu`);
    await expect(
      page.getByText("Le compte de démonstration consulte les plans sans les modifier."),
    ).toBeVisible();

    // The documents: it adds, and manages only what it added.
    await page.goto(`${base}/documents`);
    await expect(page.getByText("Programme de prévention (exemple)")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Gérer « / })).toHaveCount(0);
    await page.getByRole("link", { name: /^Ajouter/ }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles([{ name: "visite.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await page.getByLabel("Titre de visite.pdf").fill(title);
    await page.getByLabel("Catégorie").selectOption("autre");
    await page.getByRole("button", { name: "Envoyer 1 document" }).click();
    await page.getByRole("link", { name: "Voir les documents" }).click();
    await expect(page.getByRole("button", { name: `Gérer « ${title} »` })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Gérer « / })).toHaveCount(1);
    await page.getByRole("button", { name: `Gérer « ${title} »` }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Renommer" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The reports: today's is the team's, read with its PDF, and the page says why.
    await page.goto(`${base}/rapports`);
    await expect(page.getByRole("link", { name: /Voir le rapport du jour/ })).toContainText(
      DEMO_REPORT,
    );
    await expect(page.getByRole("link", { name: /Compléter le rapport du jour/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Dicter le rapport du jour" })).toHaveCount(0);
    await page.getByRole("link", { name: /Voir le rapport du jour/ }).click();
    await expect(page).toHaveURL(`${base}/rapports/${team.id}`);
    await expect(page.getByText("Pose du ponceau.")).toBeVisible();
    await expect(page.getByText(DEMO_REPORT)).toBeVisible();
    await expect(shown(page, "link", /PDF/).or(shown(page, "button", "PDF"))).toBeVisible();
    for (const control of [
      page.getByRole("link", { name: /Modifier/ }),
      page.getByRole("button", { name: "Supprimer le rapport" }),
      page.getByRole("button", { name: "Autres actions" }),
    ])
      await expect(control).toHaveCount(0);
    // Its addresses for writing lead to reading it.
    await page.goto(`${base}/rapports/${team.id}/modifier`);
    await expect(page).toHaveURL(`${base}/rapports/${team.id}`);
    await page.goto(`${base}/rapports/nouveau`);
    await expect(page).toHaveURL(`${base}/rapports/${team.id}`);
    // The project's home leads there too, with no dictation of a report that exists.
    await page.goto(base);
    await expect(page.getByRole("link", { name: /Rapport du jour fait/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Dicter le rapport du jour/ })).toHaveCount(0);

    // Its own report keeps its controls.
    await page.goto(`${base}/rapports/${own.id}`);
    await expect(page.getByText("Visite du chantier.")).toBeVisible();
    await expect(shown(page, "link", /Modifier/)).toBeVisible();
    await expect(
      shown(page, "button", "Supprimer le rapport").or(shown(page, "button", "Autres actions")),
    ).toBeVisible();
    await expect(page.getByText(DEMO_REPORT)).toHaveCount(0);
  } finally {
    // The other specs find the project's days and documents as the sample data left them.
    expect((await call(foreman.request, "DELETE", `/api/reports/${team.id}`)).status).toBe(200);
    expect((await call(visitor.request, "DELETE", `/api/reports/${own.id}`)).status).toBe(200);
    const documents = (
      await call(visitor.request, "GET", `/api/projects/${seed.projectId}/documents`)
    ).body as { id: string; title: string }[];
    for (const document of documents.filter((d) => d.title === title))
      expect((await call(visitor.request, "DELETE", `/api/documents/${document.id}`)).status).toBe(
        200,
      );
    await Promise.all([foreman.close(), visitor.close()]);
  }
});

test("wrong codes on its number never shut the demonstration out", async ({ browser }) => {
  const wrong = access.code.slice(0, 7) + ((Number(access.code[7]) + 1) % 10);
  // More wrong codes than any person's number takes, each from its own network.
  for (let i = 0; i < 12; i++) {
    const stranger = await device(browser);
    const refused = await call(stranger.request, "POST", "/api/sessions/code", {
      phone: access.phone,
      code: wrong,
    });
    expect(refused.body.error.code).toBe("wrong_access_code");
    await stranger.close();
  }
  const reviewer = await device(browser);
  expect((await call(reviewer.request, "POST", "/api/sessions/code", access)).status).toBe(200);
  await reviewer.close();
});

test("the visitor deletes the account, and the next visitor still gets in", async ({ browser }) => {
  const first = await device(browser);
  const page = await first.newPage();
  await typeCode(page, access.phone, access.code);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  const before = (await call(first.request, "GET", "/api/me")).body.id;
  await page.goto("/moi");
  // What is true for it: the same number and code let it back in, and make a
  // new account once this one is deleted.
  const comeBack =
    "Le même cellulaire et le même code ouvrent ensuite un nouveau compte de démonstration.";
  await expect(page.getByText(comeBack)).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Pour revenir, entrez de nouveau le même cellulaire et le même code.",
  );
  await page.waitForTimeout(450);
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await expect(page.getByRole("dialog")).toContainText(comeBack);
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
  expect(refused.status).not.toBe(200);
  // Its number is now one like any other: the strangers' wrong codes of the
  // earlier test count against it, and it may already be held.
  expect(["wrong_access_code", "too_many_tries"]).toContain(refused.body.error.code);
  await Promise.all([office.close(), visitor.close()]);
});
