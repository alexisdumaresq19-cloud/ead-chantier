import { expect, request as api, test, type Locator, type Page } from "@playwright/test";

import { call, contextAs, post, seed } from "./support";

// The documents of a project, against the production build: a foreman adds,
// opens and manages them; a worker reads them and is refused the rest;
// someone outside the project learns nothing; an archived project takes
// nothing new except from the office.

type Request = Parameters<typeof call>[0];
type Doc = { id: string; title: string; category: string; filename: string };

// Small files made here: a one-page PDF and a 1×1 PNG.
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** A run-unique word, so the phone and desktop runs never meet in the shared database. */
const run = () => `${test.info().project.name}${Date.now().toString(36)}`;

/** Announces, sends and confirms a file the way the app does; answers the upload id. */
async function sendFile(
  request: Request,
  projectId: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
) {
  const ticket = await post<{ uploadId: string; target: { url: string; headers: object } }>(
    request,
    "/api/uploads",
    { projectId, kind: "document", filename, contentType, size: bytes.length },
  );
  const put = await request.fetch(ticket.target.url, {
    method: "PUT",
    headers: ticket.target.headers as Record<string, string>,
    data: bytes,
  });
  expect(put.status()).toBe(200);
  await post(request, `/api/uploads/${ticket.uploadId}/complete`);
  return ticket.uploadId;
}

async function addDocument(request: Request, projectId: string, title: string) {
  const uploadId = await sendFile(request, projectId, `${title}.pdf`, "application/pdf", PDF);
  return post<Doc>(request, `/api/projects/${projectId}/documents`, {
    uploadId,
    title,
    category: "permis",
  });
}

/**
 * Taps a button of a window once it can be tapped: a window ignores taps
 * for a moment after it opens, so that a double tap cannot answer it.
 */
async function tapInWindow(page: Page, title: string, button: string | RegExp) {
  const window = page.getByRole("dialog", { name: title });
  await expect(window).toBeVisible();
  await page.waitForTimeout(400);
  await window.getByRole("button", { name: button, exact: true }).click();
}

const row = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title }).getByRole("button").first();
const menuOf = (page: Page, title: string) =>
  page.getByRole("button", { name: `Gérer « ${title} »` });
const addButton = (page: Page) => page.getByRole("link", { name: /^Ajouter/ });

/** What only those who may change the documents see. */
const managementControls = (page: Page): Locator[] => [
  addButton(page),
  page.getByRole("button", { name: /^Gérer « / }),
];

test("a foreman adds two files, opens them, renames, moves and archives one", async ({
  browser,
  baseURL,
}) => {
  const tag = run();
  const foreman = await contextAs(browser, "foreman");
  const page = await foreman.newPage();
  const list = `/projets/${seed.projectId}/documents`;
  await page.goto(list);

  // The seeded document is there, under its category.
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await expect(row(page, "Programme de prévention (exemple)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Santé et sécurité/ })).toBeVisible();

  // A search that finds nothing says so, with the way back to the list.
  await page.getByRole("searchbox").fill("zzqx");
  await expect(page.getByRole("heading", { name: "Aucun document trouvé" })).toBeVisible();
  await page.getByRole("button", { name: "Effacer la recherche" }).last().click();
  await expect(row(page, "Programme de prévention (exemple)")).toBeVisible();

  // Two files, picked together, in one category.
  await addButton(page).click();
  await expect(page).toHaveURL(`${list}/ajouter`);
  await page.locator('input[type="file"]').setInputFiles([
    { name: `Devis ${tag}.pdf`, mimeType: "application/pdf", buffer: PDF },
    { name: `Croquis_${tag}.png`, mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.getByRole("heading", { name: "2 fichiers" })).toBeVisible();
  const pdfTitle = `Devis signé ${tag}`;
  const pngTitle = `Croquis ${tag}`;
  // A file without a title is pointed out, in French, before anything leaves.
  await page.getByLabel(`Titre de Devis ${tag}.pdf`).fill("");
  await page.getByRole("button", { name: "Envoyer 2 documents" }).click();
  await expect(page.getByText("Inscrivez le titre du document.")).toBeVisible();
  await page.getByLabel(`Titre de Devis ${tag}.pdf`).fill(pdfTitle);
  await expect(page.getByText("Inscrivez le titre du document.")).toHaveCount(0);
  await expect(page.getByLabel(`Titre de Croquis_${tag}.png`)).toHaveValue(pngTitle);

  // Without a category, nothing leaves: the field says why.
  await page.getByRole("button", { name: "Envoyer 2 documents" }).click();
  await expect(page.getByText("Choisissez une catégorie.")).toBeVisible();
  await page.getByLabel("Catégorie").selectOption("contrat");
  await page.getByRole("button", { name: "Envoyer 2 documents" }).click();
  await expect(page.getByRole("heading", { name: "2 documents ajoutés" })).toBeVisible();
  await page.getByRole("link", { name: "Voir les documents" }).click();

  await expect(page).toHaveURL(list);
  const contract = page.locator("section").filter({ hasText: "Contrat et devis" });
  await expect(contract.getByText(pdfTitle)).toBeVisible();
  await expect(contract.getByText(pngTitle)).toBeVisible();

  // Opening asks for a short-lived link, in a tab opened during the tap; the
  // link gives back the very file, under its own type.
  for (const [title, bytes, type] of [
    [pngTitle, PNG, "image/png"],
    [pdfTitle, PDF, "application/pdf"],
  ] as const) {
    const answered = page.waitForResponse((response) =>
      /\/api\/documents\/\w+\/link$/.test(response.url()),
    );
    const tab = foreman.waitForEvent("page");
    await row(page, title).click();
    const link = await answered;
    expect(link.status()).toBe(200);
    expect(link.headers()["cache-control"]).toContain("no-store");
    const { url } = (await link.json()) as { url: string };
    await (await tab).close();
    const file = await foreman.request.get(new URL(url, baseURL).toString());
    expect(file.status(), title).toBe(200);
    expect(file.headers()["content-type"], title).toBe(type);
    expect(file.headers()["content-disposition"], title).toMatch(/^inline/);
    expect(Buffer.compare(await file.body(), bytes), title).toBe(0);
  }

  // Rename.
  const renamed = `Croquis du regard ${tag}`;
  await menuOf(page, pngTitle).click();
  await tapInWindow(page, "Gérer le document", "Renommer");
  const field = page.getByRole("dialog").getByLabel("Titre");
  await expect(field).toBeFocused();
  await field.fill("");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("dialog").getByText("Inscrivez le titre du document.")).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill(renamed);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Document renommé")).toBeVisible();
  await expect(contract.getByText(renamed)).toBeVisible();

  // Move to another category.
  await menuOf(page, renamed).click();
  await tapInWindow(page, "Gérer le document", /^Changer de catégorie/);
  await page.getByRole("radio", { name: "Essais et rapports" }).click();
  await expect(page.getByText("Document classé dans « Essais et rapports »")).toBeVisible();
  const tests = page.locator("section").filter({ hasText: "Essais et rapports" });
  await expect(tests.getByText(renamed)).toBeVisible();
  await expect(contract.getByText(renamed)).toHaveCount(0);

  // Archive: asked first; saying no keeps it.
  await menuOf(page, renamed).click();
  await tapInWindow(page, "Gérer le document", "Archiver");
  await tapInWindow(page, "Archiver ce document?", "Annuler");
  await expect(row(page, renamed)).toBeVisible();
  await menuOf(page, renamed).click();
  await tapInWindow(page, "Gérer le document", "Archiver");
  await tapInWindow(page, "Archiver ce document?", "Archiver");
  await expect(page.getByText("Document archivé")).toBeVisible();
  await expect(page.getByText(renamed)).toHaveCount(0);

  const { body: after } = await call<Doc[]>(
    foreman.request,
    "GET",
    `/api/projects/${seed.projectId}/documents`,
  );
  expect(after.map((document) => document.title)).toContain(pdfTitle);
  expect(after.map((document) => document.title)).not.toContain(renamed);
  await foreman.close();
});

test("a worker reads the documents, has no managing control and is refused by the API", async ({
  browser,
  baseURL,
}) => {
  const tag = run();
  const foreman = await contextAs(browser, "foreman");
  const document = await addDocument(foreman.request, seed.projectId, `Permis ${tag}`);
  const uploadId = await sendFile(foreman.request, seed.projectId, "x.pdf", "application/pdf", PDF);

  const worker = await contextAs(browser, "worker");
  const page = await worker.newPage();
  const list = `/projets/${seed.projectId}/documents`;
  await page.goto(list);
  await expect(row(page, document.title)).toBeVisible();
  await expect(row(page, "Programme de prévention (exemple)")).toBeVisible();
  for (const control of managementControls(page)) await expect(control).toHaveCount(0);
  // The sending screen is for those who manage: the list is the way back.
  await page.goto(`${list}/ajouter`);
  await expect(page).toHaveURL(list);
  await expect(row(page, document.title)).toBeVisible();

  // Reading and opening are for everyone on the project.
  const link = await call<{ url: string }>(
    worker.request,
    "GET",
    `/api/documents/${document.id}/link`,
  );
  expect(link.status).toBe(200);
  const file = await worker.request.get(new URL(link.body.url, baseURL).toString());
  expect(Buffer.compare(await file.body(), PDF)).toBe(0);

  // The rest is refused, whatever the screens show.
  const refusals = [
    await call(worker.request, "POST", "/api/uploads", {
      projectId: seed.projectId,
      kind: "document",
      filename: "a.pdf",
      contentType: "application/pdf",
      size: 10,
    }),
    await call(worker.request, "POST", `/api/projects/${seed.projectId}/documents`, {
      uploadId,
      title: "Essai",
      category: "autre",
    }),
    await call(worker.request, "PATCH", `/api/documents/${document.id}`, { title: "Essai" }),
    await call(worker.request, "DELETE", `/api/documents/${document.id}`),
  ];
  expect(refusals.map((answer) => answer.status)).toEqual([403, 403, 403, 403]);
  const { body: still } = await call<Doc>(
    foreman.request,
    "GET",
    `/api/documents/${document.id}/link`,
  );
  expect(still).toHaveProperty("url");
  await Promise.all([worker.close(), foreman.close()]);
});

test("someone outside the project gets the answer of a document that does not exist", async ({
  browser,
  baseURL,
}) => {
  const tag = run();
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const document = await addDocument(foreman.request, seed.projectId, `Contrat ${tag}`);
  // A foreman of another project only, signed in on their own device.
  const other = await post<{ invite: { url: string } }>(office.request, "/api/users", {
    name: `Contremaître Ailleurs ${tag}`,
    role: "contremaitre",
    projectIds: [seed.otherProjectIds[1]],
  });
  const outsider = await api.newContext({ baseURL });
  await post(outsider, `/api/invites/${new URL(other.invite.url).pathname.split("/i/")[1]}`, {});
  const uploadId = await sendFile(
    outsider,
    seed.otherProjectIds[1],
    "y.pdf",
    "application/pdf",
    PDF,
  );

  const missing = await call(outsider, "GET", "/api/documents/introuvable/link");
  expect(missing.status).toBe(404);
  for (const [method, path, data] of [
    ["GET", `/api/projects/${seed.projectId}/documents`, undefined],
    [
      "POST",
      `/api/projects/${seed.projectId}/documents`,
      { uploadId, title: "x", category: "autre" },
    ],
    ["GET", `/api/documents/${document.id}/link`, undefined],
    ["PATCH", `/api/documents/${document.id}`, { title: "Essai" }],
    ["DELETE", `/api/documents/${document.id}`, undefined],
  ] as const) {
    const answer = await call(outsider, method, path, data);
    expect(answer.status, `${method} ${path}`).toBe(404);
  }
  // Word for word what a missing document answers: nothing tells it exists.
  expect((await call(outsider, "GET", `/api/documents/${document.id}/link`)).body).toEqual(
    missing.body,
  );
  await outsider.dispose();
  await Promise.all([office.close(), foreman.close()]);
});

test("an archived project keeps its documents readable and takes nothing new", async ({
  browser,
}) => {
  const tag = run();
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const worker = await contextAs(browser, "worker");
  const project = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai documents, projet archivé (${tag})`,
  });
  const ids = await Promise.all(
    [foreman, worker].map(async (who) => (await call(who.request, "GET", "/api/me")).body.id),
  );
  await post(office.request, `/api/projects/${project.id}/members`, { userIds: ids });
  const document = await addDocument(foreman.request, project.id, `Échéancier ${tag}`);
  // Sent before the archiving, not yet a document.
  const uploadId = await sendFile(foreman.request, project.id, "z.pdf", "application/pdf", PDF);

  const archived = await call(office.request, "PATCH", `/api/projects/${project.id}`, {
    status: "archive",
  });
  expect(archived.body.status).toBe("archive");

  // Nothing changes for the foreman, through any route.
  const refusals = {
    announce: await call(foreman.request, "POST", "/api/uploads", {
      projectId: project.id,
      kind: "document",
      filename: "a.pdf",
      contentType: "application/pdf",
      size: PDF.length,
    }),
    add: await call(foreman.request, "POST", `/api/projects/${project.id}/documents`, {
      uploadId,
      title: "Ajout tardif",
      category: "autre",
    }),
    rename: await call(foreman.request, "PATCH", `/api/documents/${document.id}`, {
      title: "Renommé",
    }),
    move: await call(foreman.request, "PATCH", `/api/documents/${document.id}`, {
      category: "autre",
    }),
    archive: await call(foreman.request, "DELETE", `/api/documents/${document.id}`),
  };
  for (const [what, answer] of Object.entries(refusals)) {
    expect(answer.status, what).toBe(403);
    expect(answer.body.error.message, what).toBe("Ce projet est archivé.");
  }

  // Its members still read and open it.
  for (const who of [foreman, worker]) {
    const { body: list } = await call<Doc[]>(
      who.request,
      "GET",
      `/api/projects/${project.id}/documents`,
    );
    expect(list.map((current) => current.id)).toEqual([document.id]);
    expect((await call(who.request, "GET", `/api/documents/${document.id}/link`)).status).toBe(200);
  }

  // The foreman's screens offer nothing to change, and say why.
  const page = await foreman.newPage();
  const list = `/projets/${project.id}/documents`;
  await page.goto(list);
  await expect(row(page, document.title)).toBeVisible();
  await expect(page.getByText("Projet archivé : ses documents se consultent")).toBeVisible();
  for (const control of managementControls(page)) await expect(control).toHaveCount(0);
  await page.goto(`${list}/ajouter`);
  await expect(page).toHaveURL(list);

  // The office still manages it.
  const desk = await office.newPage();
  await desk.goto(list);
  await expect(desk.getByText("Projet archivé : seul le bureau peut encore changer")).toBeVisible();
  await expect(addButton(desk)).toBeVisible();
  await expect(menuOf(desk, document.title)).toBeVisible();
  const moved = await call<Doc>(office.request, "PATCH", `/api/documents/${document.id}`, {
    category: "echeancier",
  });
  expect(moved).toMatchObject({ status: 200, body: { category: "echeancier" } });

  // The seeded people's project lists are left as they were.
  for (const id of ids)
    await call(office.request, "DELETE", `/api/projects/${project.id}/members/${id}`);
  await Promise.all([office.close(), foreman.close(), worker.close()]);
});

test("a refusal for too many uploads is shown as it is and not retried by the queue", async ({
  browser,
}) => {
  const tag = run();
  const office = await contextAs(browser, "admin");
  // A foreman of their own, whose allowance this test uses up.
  const created = await post<{ invite: { url: string } }>(office.request, "/api/users", {
    name: `Contremaître Pressé ${tag}`,
    role: "contremaitre",
    projectIds: [seed.projectId],
  });
  const device = await browser.newContext();
  await post(
    device.request,
    `/api/invites/${new URL(created.invite.url).pathname.split("/i/")[1]}`,
  );
  let refusal = "";
  for (let i = 0; i < 40 && !refusal; i++) {
    const answer = await call(device.request, "POST", "/api/uploads", {
      projectId: seed.projectId,
      kind: "document",
      filename: `vide-${i}.pdf`,
      contentType: "application/pdf",
      size: 10,
    });
    if (answer.status === 429) refusal = answer.body.error.message;
  }
  expect(refusal).not.toBe("");

  const page = await device.newPage();
  const announced: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/uploads")
      announced.push(request.url());
  });
  await page.goto(`/projets/${seed.projectId}/documents/ajouter`);
  await page.locator('input[type="file"]').setInputFiles([
    { name: `Un ${tag}.pdf`, mimeType: "application/pdf", buffer: PDF },
    { name: `Deux ${tag}.pdf`, mimeType: "application/pdf", buffer: PDF },
  ]);
  await page.getByLabel("Catégorie").selectOption("autre");
  await page.getByRole("button", { name: "Envoyer 2 documents" }).click();
  await expect(page.getByRole("heading", { name: "Envoi incomplet" })).toBeVisible();
  // The server's sentence, on both files: the second was not sent into the same refusal.
  await expect(page.getByRole("alert").filter({ hasText: refusal })).toHaveCount(2);
  // Nor is anything sent again by itself, network back or not.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1500);
  expect(announced).toHaveLength(1);
  await Promise.all([device.close(), office.close()]);
});
