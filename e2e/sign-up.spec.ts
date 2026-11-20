import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

import { call, contextAs, deviceAt, post, seed } from "./support";

// Making one's own account with the company's code: the office opens it and
// reads the code, a newcomer makes an account from the first screen and is
// welcomed, the office confirms them and puts them on a project; the door
// refuses wrong codes, a closed or replaced code and too many tries; and
// anyone deletes their own account, except the last of the office.

const DAY = 86_400;
const NBSP = "\u00a0";
const tag = Math.random().toString(36).slice(2, 6);
const run = () => `${test.info().project.name} ${tag}`;
/** An address of the test's own, from a range kept for documentation. */
let addresses = 0;
const address = () =>
  `198.18.${test.info().project.name === "phone" ? 1 : 2}.${(++addresses % 250) + 1}`;
/** A Canadian cell number nobody else in the tests has. */
let numbers = 0;
const phone = () =>
  `418 ${test.info().project.name === "phone" ? 555 : 556}-${String((Date.now() % 9000) + ++numbers)
    .padStart(4, "0")
    .slice(-4)}`;

async function windowOpen(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(450);
}
async function confirm(page: Page, label: string) {
  await windowOpen(page);
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}

/** Opens account creation (or gives it a new code) and returns the code. */
async function openSignup(office: BrowserContext): Promise<string> {
  return (await post<{ code: string }>(office.request, "/api/company/code")).code;
}

/** A newcomer who makes an account through the API, on a device of their own. */
async function signUp(browser: Browser, code: string, name: string) {
  const device = await deviceAt(browser, address());
  const made = await call(device.request, "POST", "/api/signup", { name, phone: phone(), code });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const id = (await call(device.request, "GET", "/api/me")).body.id as string;
  return { device, id };
}

test.afterAll(async ({ browser }) => {
  // The other specs start with account creation closed, as installed.
  const office = await contextAs(browser, "admin");
  await call(office.request, "DELETE", "/api/company/code");
  await office.close();
});

test("the office opens account creation and reads the code; nobody else can", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  await call(office.request, "DELETE", "/api/company/code");
  const page = await office.newPage();
  await page.goto("/equipe");
  const card = page.getByRole("region", { name: "Code d'entreprise" });
  await expect(card.getByText("Création de comptes fermée")).toBeVisible();
  await card.getByRole("button", { name: "Ouvrir la création de comptes" }).click();
  await expect(card.getByText("Création de comptes ouverte")).toBeVisible();
  const { code } = (await call(office.request, "GET", "/api/company/code")).body;
  expect(code).toMatch(/^\d{8}$/);
  // Shown in two groups of four that never break apart.
  await expect(card.getByText(`${code.slice(0, 4)}${NBSP}${code.slice(4)}`)).toBeVisible();
  await card.getByRole("button", { name: "Code QR" }).click();
  await windowOpen(page);
  await expect(page.getByLabel("Lien pour créer son compte")).toHaveValue(
    `${seed.base}/inscription?code=${code}`,
  );
  await page.getByRole("button", { name: "Fermer", exact: true }).click();

  // The first screen learns only that it is open.
  const anyone = await deviceAt(browser, address());
  expect((await call(anyone.request, "GET", "/api/signup")).body).toEqual({ open: true });
  for (const context of [await contextAs(browser, "worker"), await contextAs(browser, "foreman")]) {
    expect((await call(context.request, "GET", "/api/company/code")).status).toBe(403);
    expect((await call(context.request, "POST", "/api/company/code")).status).toBe(403);
    expect((await call(context.request, "DELETE", "/api/company/code")).status).toBe(403);
    await context.close();
  }
  expect((await call(anyone.request, "GET", "/api/company/code")).status).toBe(401);
  // Nothing was changed by those refusals.
  expect((await call(office.request, "GET", "/api/company/code")).body.code).toBe(code);
  await Promise.all([anyone.close(), office.close()]);
});

test("a newcomer makes an account from the first screen, then the office puts them on a project", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const office = await contextAs(browser, "admin");
  const code = await openSignup(office);
  const name = `Essai Inscription ${run()}`;
  const device = await deviceAt(browser, address());
  const page = await device.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/inscription$/);
  // Sent empty: each field says what it needs, the cursor in the first.
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Inscrivez votre prénom et votre nom.")).toBeVisible();
  await expect(page.getByText("Inscrivez votre numéro de cellulaire.")).toBeVisible();
  await expect(page.getByLabel("Prénom et nom")).toBeFocused();
  // The right keyboards: a number pad for the code, the phone's for the number.
  await expect(page.getByLabel("Code d'entreprise")).toHaveAttribute("inputmode", "numeric");
  await expect(page.getByLabel("Cellulaire")).toHaveAttribute("type", "tel");
  await page.getByLabel("Prénom et nom").fill(name);
  await page.getByLabel("Cellulaire").fill("418-555");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText(/Vérifiez le numéro.*10 chiffres/)).toBeVisible();
  await expect(page.getByLabel("Cellulaire")).toBeFocused();
  const number = phone();
  await page.getByLabel("Cellulaire").fill(number.replace(/\D/g, ""));
  await page.getByLabel("Code d'entreprise").fill(code);
  // Typed as eight digits, shown as two groups.
  await expect(page.getByLabel("Code d'entreprise")).toHaveValue(
    `${code.slice(0, 4)} ${code.slice(4)}`,
  );
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { name: `Bienvenue, Essai!` })).toBeVisible();
  await expect(page.getByText("Votre compte est créé")).toBeVisible();
  await expect(page.getByText(/Le bureau vous ajoute à vos chantiers/)).toBeVisible();

  // A worker, unreviewed, signed in for seven days.
  const me = (await call(device.request, "GET", "/api/me")).body;
  expect(me).toMatchObject({ name, role: "travailleur", unreviewed: true });
  const cookie = (await device.storageState()).cookies.find((c) => c.name === "ead_session");
  expect(Math.abs((cookie?.expires ?? 0) - (Date.now() / 1000 + 7 * DAY))).toBeLessThan(120);

  // The office sees who to confirm, where they came from and when.
  const desk = await office.newPage();
  await desk.goto("/equipe");
  const row = desk.getByRole("link", { name: new RegExp(name) });
  await expect(row).toContainText("À confirmer");
  await expect(row).toContainText(/Compte créé avec le code d'entreprise · aujourd'hui à/);
  await expect(row).toContainText("Aucun projet");
  await row.click();
  await expect(desk.getByText(/a créé son compte avec le code d'entreprise/)).toBeVisible();
  await expect(desk.getByText(/418 \d{3}-\d{4}/).first()).toBeVisible();
  await desk.getByRole("button", { name: "Confirmer" }).click();
  await expect(desk.getByText("Personne confirmée")).toBeVisible();
  await desk.getByRole("checkbox", { name: /Réfection de la rue Principale/ }).check();
  await desk.getByRole("button", { name: "Enregistrer" }).click();
  await expect(desk.getByText("Fiche enregistrée")).toBeVisible();

  // The project appears on the newcomer's list by itself.
  await expect(page.getByText("Réfection de la rue Principale")).toBeVisible({ timeout: 45_000 });
  expect((await call(device.request, "GET", "/api/me")).body.unreviewed).toBe(false);
  await call(office.request, "PATCH", `/api/users/${me.id}`, { active: false });
  await Promise.all([device.close(), office.close()]);
});

test("a worker on no project reaches nothing of the company's", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const code = await openSignup(office);
  const { device, id } = await signUp(browser, code, `Essai Sans Projet ${run()}`);
  const project = seed.projectId;
  const reports = (await call(office.request, "GET", `/api/projects/${project}/reports`)).body;
  const sheetId = seed.sheetIds[0];
  expect((await call(device.request, "GET", "/api/projects")).body).toEqual([]);
  const refused: [string, "GET" | "POST" | "PATCH" | "DELETE", string, unknown?][] = [
    ["a project", "GET", `/api/projects/${project}`],
    ["its people", "GET", `/api/projects/${project}/members`],
    ["its plans", "GET", `/api/projects/${project}/plans`],
    ["a search in its plans", "GET", `/api/projects/${project}/plans/search?q=plan`],
    ["a sheet", "GET", `/api/sheets/${sheetId}`],
    ["its documents", "GET", `/api/projects/${project}/documents`],
    ["its photos", "GET", `/api/projects/${project}/photos`],
    ["its photo days", "GET", `/api/projects/${project}/photos/days`],
    ["its reports", "GET", `/api/projects/${project}/reports`],
    ["a report", "GET", `/api/reports/${reports[0]?.id ?? "x"}`],
    ["a report's PDF", "GET", `/api/reports/${reports[0]?.id ?? "x"}/pdf`],
    ["its QR code", "GET", `/api/projects/${project}/qr`],
    ["its plan imports", "GET", `/api/projects/${project}/plan-imports`],
    [
      "an upload to it",
      "POST",
      "/api/uploads",
      { projectId: project, kind: "photo", filename: "a.jpg", contentType: "image/jpeg", size: 10 },
    ],
    ["the people", "GET", "/api/users"],
    ["someone's devices", "GET", `/api/users/${seed.people.admin}/sessions`],
    ["the company code", "GET", "/api/company/code"],
    ["confirming oneself", "PATCH", `/api/users/${id}`, { unreviewed: false }],
    ["a second account", "POST", "/api/signup", { name: "Essai Deux", phone: phone(), code }],
  ];
  for (const [label, method, path, data] of refused) {
    const answer = await call(device.request, method, path, data);
    expect([403, 404, 409], `${label}: ${answer.status}`).toContain(answer.status);
  }
  // What is theirs answers: who they are, their devices.
  expect((await call(device.request, "GET", "/api/me")).status).toBe(200);
  expect((await call(device.request, "GET", "/api/users/me/sessions")).body).toHaveLength(1);
  await call(office.request, "PATCH", `/api/users/${id}`, { active: false });
  await Promise.all([device.close(), office.close()]);
});

test("a wrong code, a closed door and a replaced code all get the same answer", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const first = await openSignup(office);
  const device = await deviceAt(browser, address());
  const page = await device.newPage();
  await page.goto("/inscription");
  await page.getByLabel("Prénom et nom").fill(`Essai Mauvais Code ${run()}`);
  await page.getByLabel("Cellulaire").fill(phone());
  const wrong = first === "48271936" ? "48271937" : "48271936";
  await page.getByLabel("Code d'entreprise").fill(wrong);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(
    page.getByText("Ce code ne fonctionne pas. Vérifiez-le auprès du bureau."),
  ).toBeVisible();
  await expect(page.getByLabel("Code d'entreprise")).toBeFocused();
  expect((await call(device.request, "GET", "/api/me")).status).toBe(401);

  const tryWith = async (code: string) =>
    call((await deviceAt(browser, address())).request, "POST", "/api/signup", {
      name: "Essai Porte",
      phone: phone(),
      code,
    });
  const wrongAnswer = await tryWith(wrong);
  const second = await openSignup(office);
  const replaced = await tryWith(first);
  await call(office.request, "DELETE", "/api/company/code");
  const closed = await tryWith(second);
  expect(wrongAnswer.status).toBe(400);
  expect(replaced).toMatchObject({ status: 400, body: wrongAnswer.body });
  expect(closed).toMatchObject({ status: 400, body: wrongAnswer.body });

  // Closed, the first screen offers only the ways in that need no code.
  await page.goto("/bienvenue");
  await expect(page.getByRole("heading", { name: "Bienvenue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Créer mon compte" })).toHaveCount(0);
  await expect(page.getByText("Nouveau téléphone ou lien expiré?")).toBeVisible();
  await page.goto(`/inscription?code=${second}`);
  await expect(
    page.getByRole("heading", { name: "La création de comptes est fermée" }),
  ).toBeVisible();
  await device.close();
  await office.close();
});

test("too many tries: from one address, then from everyone together", async ({ browser }) => {
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, prepare: false });
  const office = await contextAs(browser, "admin");
  const code = await openSignup(office);
  const device = await deviceAt(browser, address());
  const send = (given: string, from = device) =>
    call(from.request, "POST", "/api/signup", { name: "Essai Trop", phone: phone(), code: given });
  const wrong = code === "11112222" ? "11112223" : "11112222";
  for (let i = 0; i < 5; i++) expect((await send(wrong)).status).toBe(400);
  // Shut for this address, even with the right code, and said when to come back.
  const shut = await send(code);
  expect(shut.status).toBe(429);
  expect(shut.body.error.message).toMatch(/^Trop d'essais à partir de ce réseau\. Réessayez à \d/);
  const page = await device.newPage();
  await page.goto(`/inscription?code=${code}`);
  await page.getByLabel("Prénom et nom").fill("Essai Trop");
  await page.getByLabel("Cellulaire").fill(phone());
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Trop d'essais à partir de ce réseau." }),
  ).toBeVisible();

  // The day's wrong codes from everyone (twenty on this test server; five
  // were just spent): another address is held back too.
  await sql`insert into signup_attempts (id, address_hash, outcome)
            select 'e2e-' || ${tag} || '-' || g, 'e2e', 'wrong_code' from generate_series(1, 15) g`;
  const elsewhere = await deviceAt(browser, address());
  const paused = await send(code, elsewhere);
  expect(paused.status).toBe(429);
  expect(paused.body.error.message).toMatch(/^La création de comptes est en pause\. Réessayez/);
  // A new code from the office starts a new count.
  const fresh = await openSignup(office);
  const made = await send(fresh, elsewhere);
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const id = (await call(elsewhere.request, "GET", "/api/me")).body.id;
  await call(office.request, "PATCH", `/api/users/${id}`, { active: false });

  // The day's ceiling of accounts.
  const later = await deviceAt(browser, address());
  await sql`insert into signup_attempts (id, address_hash, outcome)
            select 'e2e-c-' || ${tag} || '-' || g, 'e2e', 'created' from generate_series(1, 40) g`;
  const full = await send(fresh, later);
  expect(full.status).toBe(429);
  expect(full.body.error.message).toMatch(/^Beaucoup de comptes ont été créés aujourd'hui/);
  await sql`delete from signup_attempts where address_hash = 'e2e'`;
  await Promise.all([device.close(), elsewhere.close(), later.close(), office.close()]);
  await sql.end();
});

test("a device already signed in is told so, and the link fills the code", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const code = await openSignup(office);
  const worker = await contextAs(browser, "worker");
  const page = await worker.newPage();
  await page.goto(`/inscription?code=${code}`);
  await expect(page.getByRole("heading", { name: "Cet appareil est déjà connecté" })).toBeVisible();
  await expect(
    page.getByText(`Il est connecté sous le nom de ${seed.people.worker}.`),
  ).toBeVisible();
  await expect(page.getByLabel("Code d'entreprise")).toHaveCount(0);
  const refused = await call(worker.request, "POST", "/api/signup", {
    name: "Essai Second Compte",
    phone: phone(),
    code,
  });
  expect(refused.status).toBe(409);
  expect(refused.body.error.code).toBe("signed_in");
  await page.getByRole("link", { name: "Ouvrir l'application" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();

  // From the office's link, on a clean device, the code is already there.
  const device = await deviceAt(browser, address());
  const fresh = await device.newPage();
  await fresh.goto(`/inscription?code=${code}`);
  await expect(fresh.getByLabel("Code d'entreprise")).toHaveValue(
    `${code.slice(0, 4)} ${code.slice(4)}`,
  );
  await expect(fresh.getByText("Rempli à partir du lien du bureau.")).toBeVisible();
  // A number that already belongs to an account: ask the office for a link.
  await fresh.getByLabel("Prénom et nom").fill("Essai Même Numéro");
  const taken = phone();
  await post(office.request, "/api/users", {
    name: `Essai Numéro ${run()}`,
    role: "travailleur",
    phone: taken,
  });
  await fresh.getByLabel("Cellulaire").fill(taken);
  await fresh.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(fresh.getByText(/Ce numéro est déjà celui d'un compte/)).toBeVisible();
  await Promise.all([worker.close(), device.close(), office.close()]);
});

test("deleting one's account: nothing left, or the name on what one wrote", async ({ browser }) => {
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, prepare: false });
  const office = await contextAs(browser, "admin");
  const code = await openSignup(office);

  // Someone who wrote nothing: gone entirely.
  const quiet = await signUp(browser, code, `Essai Départ ${run()}`);
  const page = await quiet.device.newPage();
  await page.goto("/moi");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await windowOpen(page);
  await expect(page.getByRole("dialog")).toContainText(
    "Les rapports, les photos et les documents que vous avez ajoutés restent à l'entreprise, avec votre nom.",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer mon compte" }).click();
  await expect(page).toHaveURL(/\/bienvenue$/);
  expect((await call(quiet.device.request, "GET", "/api/me")).status).toBe(401);
  const people = (await call(office.request, "GET", "/api/users")).body as { id: string }[];
  expect(people.some((person) => person.id === quiet.id)).toBe(false);
  expect(await sql`select 1 from users where id = ${quiet.id}`).toHaveLength(0);

  // A foreman who took a photo and made a site's QR code: the name stays on
  // the photo, the code stops working, the account is never back.
  const made = await post<{ id: string; invite: { url: string } }>(office.request, "/api/users", {
    name: `Essai Auteur ${run()}`,
    role: "contremaitre",
    phone: phone(),
    projectIds: [seed.projectId],
  });
  const author = await deviceAt(browser, address());
  await post(author.request, `/api/invites/${new URL(made.invite.url).pathname.split("/i/")[1]}`);
  const qr = await post<{ url: string }>(author.request, `/api/projects/${seed.projectId}/qr`);
  const qrToken = new URL(qr.url).pathname.split("/j/")[1];
  const photoId = `e2e${tag}${test.info().project.name}`;
  await sql`insert into photos (id, project_id, image_key, width, height, taken_at, created_by)
            values (${photoId}, ${seed.projectId}, ${`p/${photoId}`}, 10, 10, now(), ${made.id})`;
  expect((await call(author.request, "DELETE", "/api/me")).body.outcome).toBe("kept");
  expect((await call(author.request, "GET", "/api/me")).status).toBe(401);
  const photo = (await call(office.request, "GET", `/api/photos/${photoId}`)).body;
  expect(photo.authorName).toBe(`Essai Auteur ${run()}`);
  const after = (await call(office.request, "GET", "/api/users")).body as { id: string }[];
  expect(after.some((person) => person.id === made.id)).toBe(false);
  expect(
    (await call(office.request, "PATCH", `/api/users/${made.id}`, { active: true })).status,
  ).toBe(404);
  expect((await call(office.request, "POST", `/api/users/${made.id}/invite`)).status).toBe(404);
  const stranger = await deviceAt(browser, address());
  expect((await call(stranger.request, "GET", `/api/invites/${qrToken}`)).status).toBe(410);
  await sql`delete from photos where id = ${photoId}`;
  await Promise.all([quiet.device.close(), author.close(), stranger.close(), office.close()]);
  await sql.end();
});

test("the last office account cannot be deleted, and says what to do instead", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const me = (await call(office.request, "GET", "/api/me")).body.id;
  // Other office accounts made by earlier tests are switched off: this one is the last.
  const people = (await call(office.request, "GET", "/api/users")).body as {
    id: string;
    role: string;
    active: boolean;
  }[];
  for (const other of people.filter((p) => p.role === "admin" && p.active && p.id !== me))
    await call(office.request, "PATCH", `/api/users/${other.id}`, { active: false });

  const page = await office.newPage();
  await page.goto("/moi");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await confirm(page, "Supprimer mon compte");
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Vous êtes la seule personne active au bureau. Donnez d'abord l'accès du bureau à une autre personne, puis supprimez votre compte.",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/moi$/);
  expect((await call(office.request, "GET", "/api/me")).body.id).toBe(me);
  await office.close();
});
