import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { call, contextAs, post, seed } from "./support";

// People, invitations and projects: the office adds and manages people, the
// foreman shows the site's QR code and confirms who came in with it, the
// office creates, archives and reopens projects, and everyone signs out from
// their account screen. The server refuses whatever a role may not do.

// Names carry the device size and a few random letters: the phone and desktop
// runs share one database, and a name must find one person.
const tag = Math.random().toString(36).slice(2, 6);
const run = () => `${test.info().project.name} ${tag}`;

/**
 * A window ignores taps during its first moments (a second tap of a double
 * tap must not answer it): a person reads before answering, and so does the test.
 */
async function windowOpen(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400);
}
const NBSP = " ";

/** The id of whoever a context is signed in as. */
async function idOf(context: BrowserContext): Promise<string> {
  return (await call(context.request, "GET", "/api/me")).body.id;
}

/** Answers the confirmation window with its main button. */
async function confirm(page: Page, label: string) {
  await windowOpen(page);
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}

/** A person made by the office through the API, with their personal link. */
async function newPerson(office: BrowserContext, name: string, role = "travailleur") {
  return post<{ id: string; invite: { url: string } }>(office.request, "/api/users", {
    name,
    role,
    projectIds: role === "admin" ? [] : [seed.projectId],
  });
}

/** A fresh device that opens a personal link and enters. */
async function enterWith(browser: import("@playwright/test").Browser, url: string) {
  const device = await browser.newContext({ baseURL: seed.base });
  const page = await device.newPage();
  await page.goto(new URL(url).pathname);
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  return { device, page };
}

test("the office adds a person and gets a personal link that works once", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const page = await office.newPage();
  const name = `Essai Ajout ${run()}`;
  await page.goto("/equipe");
  await page.getByRole("button", { name: "Ajouter une personne" }).first().click();
  await windowOpen(page);
  // The window opens on the name, ready to type.
  await expect(page.getByLabel("Prénom et nom")).toBeFocused();
  await page.getByLabel("Prénom et nom").fill(name);
  await page.getByLabel("Cellulaire").fill("418 555-0123");
  await page.getByRole("checkbox", { name: /Réfection de la rue Principale/ }).check();
  await page.getByRole("button", { name: "Ajouter et créer le lien" }).click();
  await expect(page.getByRole("heading", { name: "Essai peut entrer" })).toBeVisible();
  const url = await page.getByLabel(`Lien personnel de ${name}`).inputValue();
  await page.getByRole("button", { name: "Terminé" }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();

  const { device, page: phone } = await enterWith(browser, url);
  await expect(phone.getByText("Réfection de la rue Principale")).toBeVisible();
  // The link has served: the next device is turned away.
  const other = await browser.newContext({ baseURL: seed.base });
  const late = await other.newPage();
  await late.goto(new URL(url).pathname);
  await expect(late.getByRole("heading", { name: "Ce lien ne fonctionne plus" })).toBeVisible();
  await Promise.all([device.close(), other.close(), office.close()]);
});

test("the office edits a role, and cannot take its own office access away", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const person = await newPerson(office, `Essai Rôle ${run()}`);
  const page = await office.newPage();
  await page.goto(`/equipe?personne=${person.id}`);
  await expect(page.getByRole("heading", { name: `Essai Rôle ${run()}` })).toBeVisible();
  await page.getByLabel("Rôle").selectOption("contremaitre");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fiche enregistrée")).toBeVisible();
  const people = await call(office.request, "GET", "/api/users");
  expect(people.body.find((p: { id: string }) => p.id === person.id).role).toBe("contremaitre");

  // One's own role is locked on screen, and the server refuses it anyway.
  const me = await idOf(office);
  await page.goto(`/equipe?personne=${me}`);
  await expect(page.getByLabel("Rôle")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Désactiver l'accès" })).toHaveCount(0);
  for (const change of [{ role: "contremaitre" }, { active: false }]) {
    const refused = await call(office.request, "PATCH", `/api/users/${me}`, change);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain("votre propre accès");
  }
  expect((await call(office.request, "GET", "/api/me")).body.role).toBe("admin");
  await call(office.request, "PATCH", `/api/users/${person.id}`, { active: false });
  await office.close();
});

test("two office accounts demoting each other at once leave one in charge", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const a = await newPerson(office, `Essai Bureau A ${run()}`, "admin");
  const b = await newPerson(office, `Essai Bureau B ${run()}`, "admin");
  const [first, second] = await Promise.all([
    enterWith(browser, a.invite.url),
    enterWith(browser, b.invite.url),
  ]);
  const answers = await Promise.all([
    call(first.device.request, "PATCH", `/api/users/${b.id}`, { role: "travailleur" }),
    call(second.device.request, "PATCH", `/api/users/${a.id}`, { role: "travailleur" }),
  ]);
  expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403]);
  for (const id of [a.id, b.id])
    await call(office.request, "PATCH", `/api/users/${id}`, { active: false });
  await Promise.all([first.device.close(), second.device.close(), office.close()]);
});

test("deactivating someone stops their session at once and kills their links", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const name = `Essai Départ ${run()}`;
  const person = await newPerson(office, name);
  const { device, page: phone } = await enterWith(browser, person.invite.url);
  // A second link, never opened.
  const unused = await post<{ url: string }>(office.request, `/api/users/${person.id}/invite`);
  const token = new URL(unused.url).pathname.split("/i/")[1];
  expect((await call(device.request, "GET", "/api/invites/" + token)).status).toBe(200);

  const page = await office.newPage();
  await page.goto(`/equipe?personne=${person.id}`);
  await page.getByRole("button", { name: "Désactiver l'accès" }).click();
  await confirm(page, "Désactiver l'accès");
  await expect(page.getByText("L'accès de Essai est désactivé.")).toBeVisible();

  expect((await call(device.request, "GET", "/api/me")).status).toBe(401);
  // The next screen that asks the server lands on the welcome screen.
  await phone.goto("/moi");
  await expect(phone).toHaveURL(/\/bienvenue$/);
  expect((await call(device.request, "GET", "/api/invites/" + token)).status).toBe(410);
  // Reactivated, the person still needs a new link: the old one stays dead.
  await page.getByRole("button", { name: "Réactiver l'accès" }).click();
  await expect(page.getByText("Accès réactivé")).toBeVisible();
  expect((await call(device.request, "GET", "/api/invites/" + token)).status).toBe(410);
  await call(office.request, "PATCH", `/api/users/${person.id}`, { active: false });
  await Promise.all([device.close(), office.close()]);
});

test("the foreman's site code: kept, used to join, then confirmed or refused", async ({
  browser,
}) => {
  const foreman = await contextAs(browser, "foreman");
  const page = await foreman.newPage();
  let made = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/projects/${seed.projectId}/qr`))
      made++;
  });
  await page.goto(`/projets/${seed.projectId}/equipe`);
  await page.getByRole("button", { name: "Code QR du chantier" }).first().click();
  const link = page.getByLabel("Lien du code QR");
  await expect(link).toHaveValue(/\/j\//);
  const url = await link.inputValue();
  await windowOpen(page);
  await page.getByRole("button", { name: "Fermer" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Code QR du chantier" }).first().click();
  // The same code, not a new one, after closing and reloading.
  await expect(link).toHaveValue(url);
  expect(made).toBe(1);
  await windowOpen(page);
  await page.getByRole("button", { name: "Fermer" }).click();

  // Two workers scan it.
  const join = async (name: string) => {
    const device = await browser.newContext({ baseURL: seed.base });
    const phone = await device.newPage();
    await phone.goto(new URL(url).pathname);
    await phone.getByLabel("Prénom et nom").fill(name);
    await phone.getByRole("button", { name: "Entrer sur le chantier" }).click();
    await expect(phone).toHaveURL(new RegExp(`/projets/${seed.projectId}$`));
    return device;
  };
  const known = `Essai Connu ${run()}`;
  const stranger = `Essai Inconnu ${run()}`;
  const knownDevice = await join(known);
  const strangerDevice = await join(stranger);

  await page.reload();
  const toConfirm = page.getByRole("region", { name: /À confirmer/ });
  await expect(toConfirm.getByText(known)).toBeVisible();
  await expect(toConfirm.getByText(stranger)).toBeVisible();
  await expect(toConfirm.getByText(/l'accès prend fin 7 jours après le scan/)).toBeVisible();
  // The worker of the project sees a contact list, nobody to confirm.
  const worker = await contextAs(browser, "worker");
  const crew = await call(worker.request, "GET", `/api/projects/${seed.projectId}/members`);
  expect(crew.body.some((member: { unreviewed: boolean }) => member.unreviewed)).toBe(false);

  await toConfirm.getByRole("button", { name: `Confirmer ${known}` }).click();
  await expect(page.getByText(`Accès confirmé pour ${known}`)).toBeVisible();
  await expect(toConfirm.getByText(known)).toHaveCount(0);
  const members = await call(foreman.request, "GET", `/api/projects/${seed.projectId}/members`);
  const confirmed = members.body.find((member: { name: string }) => member.name === known);
  expect(confirmed.unreviewed).toBe(false);

  await toConfirm.getByRole("button", { name: `Refuser ${stranger}` }).click();
  await confirm(page, "Refuser");
  await expect(page.getByText(`${stranger} n'a plus accès à l'application`)).toBeVisible();
  // Refused and on no other project: signed out at once. The one confirmed stays in.
  expect((await call(strangerDevice.request, "GET", "/api/me")).status).toBe(401);
  expect((await call(knownDevice.request, "GET", "/api/me")).status).toBe(200);
  // Deciding twice is refused, and so is a worker deciding at all.
  const again = await call(
    foreman.request,
    "POST",
    `/api/projects/${seed.projectId}/members/${confirmed.id}/review`,
    { decision: "refuse" },
  );
  expect(again.status).toBe(409);

  const office = await contextAs(browser, "admin");
  await call(office.request, "PATCH", `/api/users/${confirmed.id}`, { active: false });
  await Promise.all([
    knownDevice.close(),
    strangerDevice.close(),
    worker.close(),
    foreman.close(),
    office.close(),
  ]);
});

test("the office creates, edits, archives and reopens a project", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const page = await office.newPage();
  const name = `Essai Projet ${run()}`;
  await page.goto("/projets/nouveau");
  await page.getByLabel("Nom du projet").fill(name);
  await page.getByRole("button", { name: "Créer le projet" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/")[2];
  expect(projectId).not.toBe("nouveau");

  await page.goto(`/projets/${projectId}/reglages`);
  await page.getByLabel("Client").fill("Ville fictive");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();
  expect((await call(office.request, "GET", `/api/projects/${projectId}`)).body.client).toBe(
    "Ville fictive",
  );

  const foremanId = await idOf(foreman);
  await post(office.request, `/api/projects/${projectId}/members`, { userIds: [foremanId] });
  expect((await call(foreman.request, "GET", `/api/projects/${projectId}`)).body.canManage).toBe(
    true,
  );

  await expect(
    page.getByText(/plus rien n'y change et personne de nouveau n'y entre/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archiver le projet" }).click();
  await confirm(page, "Archiver");
  await expect(page.getByText("Projet archivé").first()).toBeVisible();

  // The foreman's management controls are gone, and the API refuses.
  expect((await call(foreman.request, "GET", `/api/projects/${projectId}`)).body.canManage).toBe(
    false,
  );
  const desk = await foreman.newPage();
  await desk.goto(`/projets/${projectId}/equipe`);
  await expect(desk.getByRole("heading", { name: "Équipe du projet" })).toBeVisible();
  await expect(desk.getByRole("button", { name: "Code QR du chantier" })).toHaveCount(0);
  const refused = await call(foreman.request, "POST", `/api/projects/${projectId}/qr`);
  expect(refused.status).toBe(403);
  // The office still changes who is on it, but makes no QR code for it.
  expect((await call(office.request, "POST", `/api/projects/${projectId}/qr`)).status).toBe(403);
  expect(
    (await call(office.request, "DELETE", `/api/projects/${projectId}/members/${foremanId}`))
      .status,
  ).toBe(200);
  expect(
    (
      await call(office.request, "POST", `/api/projects/${projectId}/members`, {
        userIds: [foremanId],
      })
    ).status,
  ).toBe(200);

  await page.getByRole("button", { name: "Rouvrir le projet" }).click();
  await confirm(page, "Rouvrir");
  await expect(page.getByText("Projet rouvert")).toBeVisible();
  expect((await call(foreman.request, "GET", `/api/projects/${projectId}`)).body.canManage).toBe(
    true,
  );
  // On a device that has not seen the archived project, the code is back.
  const again = await contextAs(browser, "foreman");
  const reopened = await again.newPage();
  await reopened.goto(`/projets/${projectId}/equipe`);
  await expect(reopened.getByRole("button", { name: "Code QR du chantier" }).first()).toBeVisible();
  await again.close();
  await call(office.request, "DELETE", `/api/projects/${projectId}/members/${foremanId}`);
  await Promise.all([office.close(), foreman.close()]);
});

test("workers and people outside a project are refused by every people route", async ({
  browser,
}) => {
  const worker = await contextAs(browser, "worker");
  const foreman = await contextAs(browser, "foreman");
  const office = await contextAs(browser, "admin");
  const anonymous = await browser.newContext({ baseURL: seed.base });
  const [workerId, foremanId] = await Promise.all([idOf(worker), idOf(foreman)]);
  const project = seed.projectId;
  // The seeded foreman is not on the third project.
  const elsewhere = seed.otherProjectIds[1];
  const routes: [string, "GET" | "POST" | "PATCH" | "DELETE", string, unknown?][] = [
    ["list people", "GET", "/api/users"],
    ["add someone", "POST", "/api/users", { name: "Essai Intrus", role: "admin" }],
    ["make oneself office", "PATCH", `/api/users/${workerId}`, { role: "admin" }],
    ["confirm oneself", "PATCH", `/api/users/${workerId}`, { unreviewed: false }],
    ["make a link", "POST", `/api/users/${foremanId}/invite`],
    ["read devices", "GET", `/api/users/${foremanId}/sessions`],
    ["create a project", "POST", "/api/projects", { name: "Essai Intrus" }],
    ["edit a project", "PATCH", `/api/projects/${project}`, { name: "Essai Intrus" }],
    ["add a member", "POST", `/api/projects/${project}/members`, { userIds: [workerId] }],
    ["remove a member", "DELETE", `/api/projects/${project}/members/${foremanId}`],
    ["see the code", "GET", `/api/projects/${project}/qr`],
    ["make a code", "POST", `/api/projects/${project}/qr`],
    [
      "decide about someone",
      "POST",
      `/api/projects/${project}/members/${workerId}/review`,
      { decision: "confirm" },
    ],
  ];
  for (const [label, method, path, data] of routes) {
    const answer = await call(worker.request, method, path, data);
    expect([403, 404], `worker: ${label}`).toContain(answer.status);
    expect((await call(anonymous.request, method, path, data)).status, `nobody: ${label}`).toBe(
      401,
    );
  }
  // A foreman manages people of their own projects only, and never the office's records.
  for (const [label, method, path, data] of [
    ["list people", "GET", "/api/users"],
    ["make oneself office", "PATCH", `/api/users/${foremanId}`, { role: "admin" }],
    ["read someone's devices", "GET", `/api/users/${workerId}/sessions`],
    ["see another project's team", "GET", `/api/projects/${elsewhere}/members`],
    ["make another project's code", "POST", `/api/projects/${elsewhere}/qr`],
    [
      "decide on another project",
      "POST",
      `/api/projects/${elsewhere}/members/${workerId}/review`,
      { decision: "refuse" },
    ],
  ] as const) {
    const answer = await call(foreman.request, method, path, data);
    expect([403, 404], `foreman: ${label}`).toContain(answer.status);
  }
  // A worker already confirmed is not the foreman's to refuse.
  const confirmed = await call(
    foreman.request,
    "POST",
    `/api/projects/${project}/members/${workerId}/review`,
    { decision: "refuse" },
  );
  expect(confirmed.status).toBe(409);
  expect((await call(worker.request, "GET", "/api/me")).body.role).toBe("travailleur");
  expect((await call(foreman.request, "GET", "/api/me")).body.role).toBe("contremaitre");
  // The office's own screens say so to the others.
  const page = await worker.newPage();
  await page.goto("/equipe");
  await expect(page.getByRole("heading", { name: "Réservé au bureau" })).toBeVisible();
  // People listed by the office are still all there.
  expect((await call(office.request, "GET", "/api/users")).status).toBe(200);
  await Promise.all([worker.close(), foreman.close(), office.close(), anonymous.close()]);
});

test("signing out from the account screen, and its failure without a network", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const person = await newPerson(office, `Essai Sortie ${run()}`);
  const { device, page } = await enterWith(browser, person.invite.url);
  await page.goto("/moi");
  await expect(page.getByRole("heading", { name: "Mon compte" })).toBeVisible();

  await page.route("**/api/logout", (route) => route.abort());
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await confirm(page, "Se déconnecter");
  await expect(page.getByRole("alert").filter({ hasText: "Pas de réseau" })).toHaveText(
    `Pas de réseau${NBSP}: vous êtes encore connecté sur cet appareil. Réessayez quand la connexion revient.`,
  );
  await expect(page).toHaveURL(/\/moi$/);
  expect((await call(device.request, "GET", "/api/me")).status).toBe(200);

  await page.unroute("**/api/logout");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await confirm(page, "Se déconnecter");
  await expect(page).toHaveURL(/\/bienvenue$/);
  expect((await call(device.request, "GET", "/api/me")).status).toBe(401);
  await call(office.request, "PATCH", `/api/users/${person.id}`, { active: false });
  await Promise.all([device.close(), office.close()]);
});

test("a personal link from the office confirms someone who came in by QR code", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const qr = await post<{ url: string }>(office.request, `/api/projects/${seed.projectId}/qr`);
  const device = await browser.newContext({ baseURL: seed.base });
  const name = `Essai Lien Confirme ${run()}`;
  await post(device.request, `/api/invites/${new URL(qr.url).pathname.split("/j/")[1]}`, { name });
  const find = async () =>
    (await call(office.request, "GET", "/api/users")).body.find(
      (person: { name: string }) => person.name === name,
    );
  const joined = await find();
  expect(joined.unreviewed).toBe(true);
  await post(office.request, `/api/users/${joined.id}/invite`);
  expect((await find()).unreviewed).toBe(false);
  await call(office.request, "PATCH", `/api/users/${joined.id}`, { active: false });
  await Promise.all([device.close(), office.close()]);
});
