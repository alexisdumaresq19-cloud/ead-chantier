import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { call, contextAs, post, seed, sessionOf } from "./support";

// The plans of a project: the list and its search, opening a sheet, bringing
// a PDF in through the screen, a new revision, and what is refused to a
// worker, on an archived project, and for a PDF that cannot be read.

const project = seed.projectId;
const plansOf = (projectId: string) => `/projets/${projectId}/plans`;

/** A window ignores taps for a moment after it opens (a double tap is no answer). */
const settle = (page: Page) => page.waitForTimeout(450);

/** A small fictional plan set: one page per number, "" for a page with none. */
async function planPdf(numbers: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  numbers.forEach((number, index) => {
    const page = pdf.addPage([612, 396]);
    page.drawRectangle({ x: 12, y: 12, width: 588, height: 372, borderWidth: 1.5 });
    page.drawText("EXEMPLE - PLAN D'ESSAI", { x: 40, y: 330, size: 18, font });
    page.drawText(`Regard ${index + 1}`, { x: 60, y: 240, size: 11, font });
    if (!number) return;
    page.drawText("TITRE DU DESSIN", { x: 420, y: 90, size: 7, font });
    page.drawText(`Essai, page ${index + 1}`, { x: 420, y: 78, size: 9, font });
    page.drawText("FEUILLE", { x: 420, y: 58, size: 7, font });
    page.drawText(number, { x: 420, y: 42, size: 13, font });
  });
  return Buffer.from(await pdf.save());
}

/** Chooses PDFs in the plan list, as the file picker would. */
async function choosePdf(page: Page, name: string, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer,
  });
}

/** Sends a PDF and starts its import through the API, then waits for its pages. */
async function importByApi(request: APIRequestContext, projectId: string, file: Buffer) {
  const ticket = await post<{
    uploadId: string;
    target: { url: string; headers: Record<string, string> };
  }>(request, "/api/uploads", {
    projectId,
    kind: "plan",
    filename: "essai.pdf",
    contentType: "application/pdf",
    size: file.length,
  });
  const sent = await request.put(new URL(ticket.target.url, seed.base).href, {
    headers: ticket.target.headers,
    data: file,
  });
  expect(sent.ok()).toBe(true);
  await post(request, `/api/uploads/${ticket.uploadId}/complete`);
  const started = await post<{ id: string }>(request, `/api/projects/${projectId}/plan-imports`, {
    uploadId: ticket.uploadId,
  });
  await expect
    .poll(async () => (await call(request, "GET", `/api/plan-imports/${started.id}`)).body.status, {
      timeout: 60_000,
    })
    .toBe("review");
  return started.id;
}

/** Numbers unique to this run: the phone and desktop runs share one database. */
const runNumber = (base: number) =>
  `P-${(test.info().project.name === "phone" ? 700 : 800) + base}`;

test.describe("as someone on the site", () => {
  test.use({ storageState: sessionOf("worker") });

  test("the list finds a sheet by number, title or words drawn on it, and opens it", async ({
    page,
  }) => {
    await page.goto(plansOf(project));
    await expect(page.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
    const search = page.getByPlaceholder("Rechercher un plan");

    // By number, typed the lazy way.
    await search.fill("c201");
    await expect(page.getByText("1 feuille trouvée")).toBeVisible();
    await expect(page.getByRole("link", { name: /C-201/ })).toBeVisible();

    // By title, without its accents.
    await search.fill("details regards");
    await expect(page.getByRole("link", { name: /C-401/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /C-201/ })).toHaveCount(0);

    // By words that are only drawn on the plans.
    await search.fill("proctor modifie");
    const drawn = page.getByRole("region", { name: "Trouvé sur les plans" });
    await expect(drawn.getByRole("link").first()).toBeVisible();
    await expect(drawn.locator("mark").first()).toHaveText(/^proctor$/i);
    await drawn.getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/projets/${project}/feuilles/[^/?]+$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^C-/);

    // Back to the list: the search is still there.
    await page.goBack();
    await expect(search).toHaveValue("proctor modifie");

    // Nothing found says so, with a way out.
    await search.fill("zzzz");
    await expect(page.getByText("Aucune feuille ne correspond à « zzzz ».")).toBeVisible();
    await page.getByRole("main").getByText("Effacer la recherche").click();
    await expect(search).toHaveValue("");

    // Opening a sheet from the list.
    await page.getByRole("link", { name: /C-102/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projets/${project}/feuilles/[^/?]+$`));
    await expect(page.getByRole("heading", { level: 1, name: "C-102" })).toBeVisible();
  });

  test("a worker sees no control that changes the plans, and the server refuses them", async ({
    page,
  }) => {
    await page.goto(plansOf(project));
    await expect(page.getByRole("link", { name: /C-101/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ajouter des plans/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Gérer la feuille/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Nouveau dossier/ })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.goto(`${plansOf(project)}/import/abcdefgh`);
    await expect(page.getByText("Réservé au bureau et aux contremaîtres")).toBeVisible();

    const before = await call(page.request, "GET", `/api/projects/${project}/plans`);
    const sheetId = seed.sheetIds[0];
    const refused = [
      await call(page.request, "POST", `/api/projects/${project}/plan-folders`, { name: "X" }),
      await call(page.request, "GET", `/api/projects/${project}/plan-imports`),
      await call(page.request, "POST", `/api/projects/${project}/plan-imports`, {
        uploadId: "abcdefgh",
      }),
      await call(page.request, "PATCH", `/api/sheets/${sheetId}`, { title: "Changé" }),
      await call(page.request, "DELETE", `/api/sheets/${sheetId}`),
      await call(page.request, "POST", `/api/sheets/${sheetId}/current`, {
        revisionId: "abcdefgh",
      }),
      await call(page.request, "POST", "/api/uploads", {
        projectId: project,
        kind: "plan",
        filename: "x.pdf",
        contentType: "application/pdf",
        size: 10,
      }),
    ];
    for (const answer of refused) {
      expect(answer.status).toBe(403);
      expect(answer.body.error.message).toBe("Réservé au bureau et aux contremaîtres.");
    }
    const after = await call(page.request, "GET", `/api/projects/${project}/plans`);
    expect(after.body).toEqual(before.body);
  });
});

test.describe("as a foreman", () => {
  test.use({ storageState: sessionOf("foreman") });

  test("imports a PDF through the screen, corrects a number and publishes", async ({ page }) => {
    const [first, second, third] = [runNumber(1), runNumber(2), runNumber(3)];
    await page.goto(plansOf(project));
    await expect(page.getByRole("button", { name: /Ajouter des plans/ })).toBeVisible();
    await choosePdf(page, `Essai ${first}.pdf`, await planPdf([first, second, ""]));

    // One PDF leads straight to its pages.
    await expect(page).toHaveURL(new RegExp(`${plansOf(project)}/import/`));
    await expect(page.getByRole("heading", { name: "Vérifier avant de publier" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByLabel("Numéro de la feuille, Page 1")).toHaveValue(first);
    await expect(page.getByLabel("Numéro de la feuille, Page 2")).toHaveValue(second);
    await expect(page.getByLabel("Titre de la feuille, Page 1")).toHaveValue("Essai, page 1");

    // The third page had no number to read: it is given one.
    const third_ = page.getByLabel("Numéro de la feuille, Page 3");
    await expect(third_).toHaveValue("03");
    await third_.fill(second);
    await expect(page.getByText("Même numéro que la page 2")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Publier \d/ })).toBeDisabled();
    await third_.fill(third);
    await page.getByLabel("Titre de la feuille, Page 3").fill("Plan corrigé");
    await expect(page.getByText("Corrections enregistrées")).toBeVisible();

    await page.getByRole("button", { name: "Publier 3 feuilles" }).click();
    const question = page.getByRole("dialog", { name: "Publier 3 feuilles?" });
    await expect(question).toBeVisible();
    await settle(page);
    await question.getByRole("button", { name: "Publier", exact: true }).click();

    await expect(page.getByText("3 feuilles publiées. Le chantier les voit.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${plansOf(project)}$`));
    // The sheets' own links: for a moment the list may still show the import
    // from before, whose name carries the same numbers.
    for (const number of [first, second, third])
      await expect(page.getByRole("link", { name: new RegExp(`^${number} `) })).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(`${third}.*Plan corrigé`) }),
    ).toBeVisible();

    // The site sees them.
    const site = await call(page.request, "GET", `/api/projects/${project}/plans`);
    const published = site.body.sheets.filter((sheet: { number: string }) =>
      [first, second, third].includes(sheet.number),
    );
    expect(published).toHaveLength(3);
  });

  test("a page with the number of a sheet becomes its new revision", async ({ page }) => {
    const label = test.info().project.name === "phone" ? "B" : "C";
    await page.goto(plansOf(project));
    await choosePdf(page, "C-102 révisé.pdf", await planPdf(["C-102"]));
    await expect(page.getByRole("heading", { name: "Vérifier avant de publier" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Nouvelle révision de C-102/)).toBeVisible();
    await page.getByLabel("Révision").fill(label);
    await page.getByRole("button", { name: "Publier 1 feuille" }).click();
    const question = page.getByRole("dialog", { name: "Publier 1 feuille?" });
    await expect(question).toContainText("1 feuille existante passe à sa nouvelle révision.");
    await settle(page);
    await question.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(page.getByText("1 feuille publiée. Le chantier les voit.")).toBeVisible();

    // Still one C-102, now at the new revision; the earlier ones are kept.
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: /C-102/ }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Rév. ${label}`);
    await row.getByRole("button", { name: "Gérer la feuille C-102" }).click();
    await settle(page);
    await page.getByRole("button", { name: /Révisions/ }).click();
    const revisions = page.getByRole("dialog", { name: "Révisions de C-102" });
    await expect(revisions.getByText("Vue au chantier")).toHaveCount(1);
    await expect(revisions.getByRole("link", { name: "Ouvrir" }).nth(1)).toBeVisible();

    // An earlier revision opens in the viewer by its own address.
    await revisions.getByRole("link", { name: "Ouvrir" }).last().click();
    await expect(page).toHaveURL(/\/feuilles\/[^/?]+\?rev=/);
    await expect(page.getByRole("heading", { level: 1, name: "C-102" })).toBeVisible();
  });

  test("an unreadable PDF ends as failed, with a way out", async ({ page }) => {
    await page.goto(plansOf(project));
    await choosePdf(page, "Illisible.pdf", Buffer.from("%PDF-1.7\nceci n'est pas un plan\n"));
    await expect(page.getByText("La conversion a échoué")).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(/Ce PDF est illisible ou protégé par un mot de passe\./),
    ).toBeVisible();
    // Trying the same file again would only fail again.
    await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);

    const importUrl = page.url();
    await page.getByRole("button", { name: "Annuler l'import" }).click();
    const question = page.getByRole("dialog", { name: "Annuler cet import?" });
    await settle(page);
    await question.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé. Rien n'a été publié.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${plansOf(project)}$`));
    await expect(page.getByText("Illisible.pdf")).toHaveCount(0);
    await page.goto(importUrl);
    await expect(page.getByText("Cet import n'existe plus")).toBeVisible();
  });
});

test("an archived project refuses changes to its plans, except from the office", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const archived = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai plans, projet archivé (${test.info().project.name})`,
  });
  const worker = await contextAs(browser, "worker");
  const foremanId = (await call(foreman.request, "GET", "/api/me")).body.id;
  const workerId = (await call(worker.request, "GET", "/api/me")).body.id;
  await post(office.request, `/api/projects/${archived.id}/members`, {
    userIds: [foremanId, workerId],
  });

  // While open: one sheet published, one import left to check, one folder.
  const published = await importByApi(office.request, archived.id, await planPdf(["A-101"]));
  const { sheetIds } = await post<{ sheetIds: string[] }>(
    office.request,
    `/api/plan-imports/${published}/publish`,
  );
  const pending = await importByApi(office.request, archived.id, await planPdf(["A-102"]));
  const folder = await post<{ id: string }>(
    office.request,
    `/api/projects/${archived.id}/plan-folders`,
    { name: "Civil" },
  );
  const sheet = (await call(office.request, "GET", `/api/sheets/${sheetIds[0]}`)).body;
  await call(office.request, "PATCH", `/api/projects/${archived.id}`, { status: "archive" });

  // The foreman still reads it, and sees no control that would change it.
  const page = await foreman.newPage();
  await page.goto(plansOf(archived.id));
  await expect(page.getByText("Projet archivé", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /A-101/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ajouter des plans/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Gérer la feuille/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Modifier le dossier/ })).toHaveCount(0);
  await expect(page.getByText("En cours d'ajout")).toHaveCount(0);
  await page.goto(`${plansOf(archived.id)}/import/${pending}`);
  await expect(page.getByText("Ce projet est archivé")).toBeVisible();
  // Told so from the project's status, whatever the person may manage.
  const workerPage = await worker.newPage();
  await workerPage.goto(`${plansOf(archived.id)}/import/${pending}`);
  await expect(workerPage.getByText("Ce projet est archivé")).toBeVisible();
  await expect(workerPage.getByText("Réservé au bureau et aux contremaîtres")).toHaveCount(0);

  // And the server refuses every change.
  const changes = [
    ["POST", `/api/projects/${archived.id}/plan-folders`, { name: "Structure" }],
    ["PATCH", `/api/plan-folders/${folder.id}`, { name: "Autre" }],
    ["DELETE", `/api/plan-folders/${folder.id}`],
    ["POST", `/api/projects/${archived.id}/plan-imports`, { uploadId: "abcdefgh" }],
    ["PATCH", `/api/plan-imports/${pending}`, { revisionLabel: "Z" }],
    ["POST", `/api/plan-imports/${pending}/retry`],
    ["POST", `/api/plan-imports/${pending}/publish`],
    ["DELETE", `/api/plan-imports/${pending}`],
    ["PATCH", `/api/sheets/${sheet.id}`, { title: "Changé" }],
    ["PATCH", `/api/sheets/${sheet.id}`, { folderId: folder.id }],
    ["DELETE", `/api/sheets/${sheet.id}`],
    ["POST", `/api/sheets/${sheet.id}/current`, { revisionId: sheet.current.id }],
  ] as const;
  for (const [method, path, data] of changes) {
    const refused = await call(foreman.request, method, path, data);
    expect(refused.status, `${method} ${path}`).toBe(403);
    expect(refused.body.error.message, `${method} ${path}`).toBe("Ce projet est archivé.");
  }
  expect((await call(foreman.request, "GET", `/api/plan-imports/${pending}`)).status).toBe(200);
  expect((await call(foreman.request, "GET", `/api/sheets/${sheet.id}`)).body.title).toBe(
    sheet.title,
  );

  // The office still may, and sees its controls.
  expect(
    (await call(office.request, "PATCH", `/api/sheets/${sheet.id}`, { title: "Par le bureau" }))
      .status,
  ).toBe(200);
  const officePage = await office.newPage();
  await officePage.goto(plansOf(archived.id));
  await expect(officePage.getByRole("button", { name: "Gérer la feuille A-101" })).toBeVisible();

  // The seeded people's project lists are left as they were.
  for (const userId of [foremanId, workerId])
    await call(office.request, "DELETE", `/api/projects/${archived.id}/members/${userId}`);
  await Promise.all([office.close(), foreman.close(), worker.close()]);
});
