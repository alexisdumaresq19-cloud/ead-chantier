import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import {
  expect,
  request as api,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import { siteDay } from "../src/shared/photos";
import { call, contextAs, post, seed, sessionOf, type Role } from "./support";

// The site photos, as the people of a project use them: adding from the
// screen, the large view, captions, removing, and the photos that wait on a
// phone without a network. Each test works on a project of its own, so that
// what it counts is only what it did.

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, prepare: false });
const STORAGE = process.env.STORAGE_DIR ?? ".data/e2e-storage";

/** A small JPEG, different each time (as two photos of a site are). */
const jpeg = () =>
  sharp(randomBytes(64 * 48 * 3), { raw: { width: 64, height: 48, channels: 3 } })
    .resize(640, 480, { kernel: "nearest" })
    .jpeg({ quality: 80 })
    .toBuffer();

const today = () => siteDay(new Date());

/** Projects made by the test under way: their members are taken off at the end. */
let made: { id: string; members: string[] }[] = [];

test.afterEach(async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  for (const project of made)
    for (const id of project.members)
      await call(office.request, "DELETE", `/api/projects/${project.id}/members/${id}`);
  made = [];
  await office.close();
});

const idOf = async (context: BrowserContext) =>
  (await call(context.request, "GET", "/api/me")).body.id;

/** A project of the test's own, with the seeded foreman and worker on it. */
async function newProject(browser: Browser, label: string) {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const worker = await contextAs(browser, "worker");
  const project = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai photos, ${label} (${test.info().project.name})`,
  });
  const members = [await idOf(foreman), await idOf(worker)];
  await post(office.request, `/api/projects/${project.id}/members`, { userIds: members });
  made.push({ id: project.id, members });
  return {
    id: project.id,
    office,
    foreman,
    worker,
    close: () => Promise.all([office, foreman, worker].map((c) => c.close())),
  };
}

/** Sends a file the way the app does: announce, send, confirm. Returns the upload's id. */
async function upload(context: BrowserContext, projectId: string, file: Buffer) {
  const ticket = await post<{
    uploadId: string;
    target: { url: string; headers: Record<string, string> };
  }>(context.request, "/api/uploads", {
    projectId,
    kind: "photo",
    filename: "essai.jpg",
    contentType: "image/jpeg",
    size: file.length,
  });
  const sent = await context.request.put(ticket.target.url, {
    headers: { ...ticket.target.headers, "content-type": "image/jpeg" },
    data: file,
  });
  expect(sent.ok()).toBe(true);
  await post(context.request, `/api/uploads/${ticket.uploadId}/complete`);
  return ticket.uploadId;
}

/** A photo added through the API, as `who`. */
async function addPhoto(context: BrowserContext, projectId: string, caption: string | null = null) {
  const uploadId = await upload(context, projectId, await jpeg());
  return post<{ id: string; imageKey?: string }>(
    context.request,
    `/api/projects/${projectId}/photos`,
    {
      uploadId,
      caption,
    },
  );
}

const photosOf = async (context: BrowserContext, projectId: string, query = "") =>
  (await call(context.request, "GET", `/api/projects/${projectId}/photos${query}`)).body as {
    id: string;
    caption: string | null;
    authorName: string | null;
    canEdit: boolean;
    day: string;
  }[];

/** Picks files in the screen's own file input (camera or gallery: the same input). */
async function pickPhoto(page: Page, name = "IMG_2041.jpg") {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name, mimeType: "image/jpeg", buffer: await jpeg() });
}

/** Answers a window: it ignores taps during its first moments, as a phone would want. */
async function answer(page: Page, title: string, button: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  await dialog.getByRole("button", { name: button }).click();
}

const viewer = (page: Page) => page.getByRole("dialog", { name: "Photo en grand" });

test("a worker adds a photo from the screen and finds it under today", async ({ browser }) => {
  const project = await newProject(browser, "ajout");
  const page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByRole("heading", { name: "Aucune photo pour l'instant" })).toBeVisible();

  await pickPhoto(page);
  // A window over the gallery, which stays where it is.
  const added = page.getByRole("dialog", { name: "Photo ajoutée" });
  await expect(added).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projets/${project.id}/photos$`));
  await added.getByLabel("Description").fill("Regard 3, côté nord");
  await answer(page, "Photo ajoutée", "Terminé");
  await expect(page.getByText("Description ajoutée.")).toBeVisible();
  await expect(added).toHaveCount(0);

  const group = page.getByRole("region", { name: "Aujourd'hui" });
  await expect(group.getByRole("button", { name: "Regard 3, côté nord" })).toBeVisible();
  await expect(group.getByText("1 photo", { exact: true })).toBeVisible();

  const photos = await photosOf(project.worker, project.id);
  expect(photos).toHaveLength(1);
  expect(photos[0]).toMatchObject({
    caption: "Regard 3, côté nord",
    authorName: seed.people.worker,
    day: today(),
    canEdit: true,
  });
  // The original sent from the phone is not kept once the photo is made.
  const [used] =
    await sql`select id from uploads where project_id = ${project.id} and kind = 'photo'`;
  expect(existsSync(`${STORAGE}/private/u/${used.id}`)).toBe(false);
  await project.close();
});

test("photos come in bursts: the next one is taken from the window, each with its own description", async ({
  browser,
}) => {
  const project = await newProject(browser, "rafale");
  const page = await project.foreman.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByRole("button", { name: "Calendrier" })).toHaveCount(0);
  if (test.info().project.name === "phone")
    await expect(page.getByText("De la galerie", { exact: true })).toBeVisible();

  await pickPhoto(page, "IMG_1.jpg");
  const added = page.getByRole("dialog", { name: "Photo ajoutée" });
  await expect(added).toBeVisible();
  await added.getByLabel("Description").fill("Tranchée, côté est");
  // The window's own button takes the next photo (the camera on a phone).
  await page.waitForTimeout(450);
  await added
    .getByLabel(/Une autre photo|D'autres photos/)
    .setInputFiles({ name: "IMG_2.jpg", mimeType: "image/jpeg", buffer: await jpeg() });
  await expect(page.getByText("Description ajoutée.")).toBeVisible();
  // Still the same window, for the new photo, with an empty field.
  await expect(added).toBeVisible();
  await expect(added.getByLabel("Description")).toHaveValue("");
  await answer(page, "Photo ajoutée", "Terminé");
  await expect(added).toHaveCount(0);

  const today = page.getByRole("region", { name: "Aujourd'hui" });
  await expect(today.getByText("2 photos", { exact: true })).toBeVisible();
  await expect(today.getByRole("button", { name: "Tranchée, côté est" })).toBeVisible();
  await expect
    .poll(async () =>
      (await photosOf(project.foreman, project.id)).map((photo) => photo.caption ?? "").sort(),
    )
    .toEqual(["", "Tranchée, côté est"]);
  // With photos, the days are reached through the calendar.
  await page.getByRole("button", { name: "Calendrier" }).click();
  await expect(page.getByRole("dialog", { name: "Photos par jour" })).toBeVisible();
  await project.close();
});

test("the large view closes with the back button where the grid was; its author describes and removes it", async ({
  browser,
}) => {
  const project = await newProject(browser, "grand");
  const own = await addPhoto(project.worker, project.id);
  // Enough photos to scroll: copies of that one, taken earlier the same day.
  const [row] = await sql`select image_key, created_by from photos where id = ${own.id}`;
  await sql`insert into photos (id, project_id, image_key, width, height, taken_at, created_by)
            select left(md5(${project.id} || g), 16), ${project.id},
                   ${row.image_key}, 640, 480, now() - g * interval '20 seconds', ${row.created_by}
            from generate_series(1, 45) g`;

  const page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  const tiles = page.locator("button[id^=photo-]");
  await expect(tiles).toHaveCount(46);
  const far = tiles.nth(36);
  await far.evaluate((tile) => tile.scrollIntoView({ block: "center" }));
  const at = await page.evaluate(() => window.scrollY);
  expect(at).toBeGreaterThan(200);
  await far.click();
  await expect(viewer(page)).toBeVisible();
  await expect(page).toHaveURL(/\?photo=/);
  await expect(viewer(page).getByText("37 / 46")).toBeVisible();
  if (test.info().project.name === "desktop") {
    await page.keyboard.press("ArrowRight");
    await expect(viewer(page).getByText("38 / 46")).toBeVisible();
  }
  await page.goBack();
  await expect(viewer(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/\?photo=/);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - at)).toBeLessThan(4);

  // Its author describes it, then removes it.
  await page.goto(`/projets/${project.id}/photos?photo=${own.id}`);
  await expect(viewer(page)).toBeVisible();
  // Without a description, the photo invites one, in passing; the actions keep
  // their order, removing last.
  await expect(
    viewer(page).getByRole("button", { name: "Ajouter une description…" }),
  ).toBeVisible();
  await expect(viewer(page).locator("footer button")).toHaveText([
    "Ajouter une description…",
    "Description",
    /Télécharger|Partager/,
    "Supprimer",
  ]);
  await viewer(page).getByRole("button", { name: "Ajouter une description…" }).click();
  const sheet = page.getByRole("dialog", { name: "Description de la photo" });
  await expect(sheet.getByRole("textbox")).toBeFocused();
  await page.keyboard.type("Fissure dans la dalle");
  await answer(page, "Description de la photo", "Enregistrer");
  await expect(page.getByText("Description enregistrée.")).toBeVisible();
  await expect(viewer(page).getByText("Fissure dans la dalle")).toBeVisible();
  await expect(viewer(page).getByRole("button", { name: "Ajouter une description…" })).toHaveCount(
    0,
  );
  expect((await call(project.foreman.request, "GET", `/api/photos/${own.id}`)).body.caption).toBe(
    "Fissure dans la dalle",
  );

  await viewer(page).getByRole("button", { name: "Supprimer" }).click();
  await answer(page, "Supprimer cette photo ?", "Annuler");
  expect((await call(project.worker.request, "GET", `/api/photos/${own.id}`)).status).toBe(200);
  await viewer(page).getByRole("button", { name: "Supprimer" }).click();
  await answer(page, "Supprimer cette photo ?", "Supprimer");
  await expect(page.getByText("Photo supprimée.")).toBeVisible();
  expect((await call(project.worker.request, "GET", `/api/photos/${own.id}`)).status).toBe(404);
  await project.close();
});

test("a worker cannot change someone else's photo; the foreman can remove it", async ({
  browser,
}) => {
  const project = await newProject(browser, "droits");
  const theirs = await addPhoto(project.foreman, project.id, "Coffrage avant coulée");

  const seen = await call(project.worker.request, "GET", `/api/photos/${theirs.id}`);
  expect(seen).toMatchObject({ status: 200, body: { canEdit: false } });
  for (const [method, data] of [
    ["DELETE", undefined],
    ["PATCH", { caption: "Pas moi" }],
  ] as const) {
    const refused = await call(project.worker.request, method, `/api/photos/${theirs.id}`, data);
    expect(refused.status, method).toBe(403);
    expect(refused.body.error.message).toBe(
      "Seuls son auteur, les contremaîtres et le bureau peuvent modifier cette photo.",
    );
  }

  // The screen offers the worker nothing but keeping a copy.
  const page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos?photo=${theirs.id}`);
  await expect(viewer(page).getByText("Coffrage avant coulée")).toBeVisible();
  await expect(viewer(page).getByRole("button", { name: /Télécharger|Partager/ })).toBeVisible();
  await expect(viewer(page).getByRole("button", { name: "Supprimer" })).toHaveCount(0);
  await expect(viewer(page).getByRole("button", { name: "Description", exact: true })).toHaveCount(
    0,
  );
  await expect(viewer(page).getByText("Ajouter une description…")).toHaveCount(0);

  const desk = await project.foreman.newPage();
  await desk.goto(`/projets/${project.id}/photos?photo=${theirs.id}`);
  await viewer(desk).getByRole("button", { name: "Supprimer" }).click();
  await answer(desk, "Supprimer cette photo ?", "Supprimer");
  await expect(desk.getByText("Photo supprimée.")).toBeVisible();
  expect((await call(project.worker.request, "GET", `/api/photos/${theirs.id}`)).status).toBe(404);
  await project.close();
});

test("someone outside the project, or asking for another project's photo, is refused", async ({
  browser,
  baseURL,
}) => {
  const project = await newProject(browser, "dehors");
  const photo = await addPhoto(project.worker, project.id);

  // A person of the company who is on no project.
  const person = await post<{ invite: { url: string } }>(project.office.request, "/api/users", {
    name: `Essai Dehors ${test.info().project.name}`,
    role: "travailleur",
  });
  const outsider = await api.newContext({ baseURL });
  await post(outsider, `/api/invites/${person.invite.url.split("/i/")[1]}`, {});
  for (const [method, path, data] of [
    ["GET", `/api/projects/${project.id}/photos`, undefined],
    ["GET", `/api/projects/${project.id}/photos/days`, undefined],
    ["POST", `/api/projects/${project.id}/photos`, { uploadId: "x" }],
    ["GET", `/api/photos/${photo.id}`, undefined],
    ["PATCH", `/api/photos/${photo.id}`, { caption: "x" }],
    ["DELETE", `/api/photos/${photo.id}`, undefined],
  ] as const) {
    expect((await call(outsider, method, path, data)).status, `${method} ${path}`).toBe(404);
    const signedOut = await api.newContext({ baseURL });
    expect((await call(signedOut, method, path, data)).status, `${method} ${path}`).toBe(401);
    await signedOut.dispose();
  }
  await outsider.dispose();

  // A photo of a project the worker is not on: its project is the photo's own.
  const third = seed.otherProjectIds[1];
  expect((await call(project.worker.request, "GET", `/api/projects/${third}`)).status).toBe(404);
  const elsewhere = await addPhoto(project.office, third);
  for (const method of ["GET", "PATCH", "DELETE"] as const)
    expect(
      (await call(project.worker.request, method, `/api/photos/${elsewhere.id}`, { caption: "x" }))
        .status,
    ).toBe(404);
  // An upload is for the project it was announced for, and for the one who sent it.
  const uploadId = await upload(project.worker, project.id, await jpeg());
  expect(
    (
      await call(project.foreman.request, "POST", `/api/projects/${project.id}/photos`, {
        uploadId,
      })
    ).status,
  ).toBe(409);
  // Someone else's photo id cannot be taken over.
  expect(
    (
      await call(project.worker.request, "POST", `/api/projects/${project.id}/photos`, {
        uploadId,
        id: elsewhere.id,
      })
    ).body.error.code,
  ).toBe("conflict");
  await call(project.office.request, "DELETE", `/api/photos/${elsewhere.id}`);

  // Pages are asked for in the app's own words; anything else is refused plainly.
  for (const query of [
    "?limit=100000",
    "?limit=0",
    "?before=abc",
    "?before=2026-13-45T10:00:00.000Z_abc",
    "?day=2026-02-30",
  ]) {
    const refused = await call(
      project.worker.request,
      "GET",
      `/api/projects/${project.id}/photos${query}`,
    );
    expect(refused.status, query).toBe(400);
    expect(refused.body.error.message, query).not.toMatch(/\^|\\d|Invalid/);
  }
  await project.close();
});

test("the photos of a day come as the plain list the daily report reads", async ({ browser }) => {
  const project = await newProject(browser, "rapport");
  const first = await addPhoto(project.worker, project.id, "Excavation");
  const again = await call(project.worker.request, "POST", `/api/projects/${project.id}/photos`, {
    id: first.id,
    uploadId: "deja-envoyee",
  });
  // The same photo sent twice is the same photo.
  expect(again).toMatchObject({ status: 200, body: { id: first.id } });

  const day = await call(
    project.foreman.request,
    "GET",
    `/api/projects/${project.id}/photos?day=${today()}`,
  );
  expect(day.status).toBe(200);
  expect(Array.isArray(day.body)).toBe(true);
  expect(day.body).toHaveLength(1);
  expect(Object.keys(day.body[0]).sort()).toEqual([
    "authorId",
    "authorName",
    "canEdit",
    "caption",
    "day",
    "height",
    "id",
    "takenAt",
    "thumbUrl",
    "url",
    "width",
  ]);
  expect(day.body[0]).toMatchObject({
    id: first.id,
    caption: "Excavation",
    day: today(),
    width: 640,
    height: 480,
    authorName: seed.people.worker,
    canEdit: true,
  });
  const image = await project.foreman.request.get(day.body[0].url);
  expect(image.headers()["content-type"]).toBe("image/jpeg");
  const other = await call(
    project.foreman.request,
    "GET",
    `/api/projects/${project.id}/photos?day=2020-01-01`,
  );
  expect(other).toMatchObject({ status: 200, body: [] });
  await project.close();
});

test("an archived project takes no new photo and no change, except from the office", async ({
  browser,
}) => {
  const project = await newProject(browser, "archivé");
  const own = await addPhoto(project.worker, project.id);
  // A photo sent just before the project was archived.
  const late = await upload(project.worker, project.id, await jpeg());
  await call(project.office.request, "PATCH", `/api/projects/${project.id}`, { status: "archive" });

  const refused = await call(project.worker.request, "POST", `/api/projects/${project.id}/photos`, {
    uploadId: late,
  });
  expect(refused.status).toBe(403);
  expect(refused.body.error.message).toBe("Ce projet est archivé.");
  for (const [method, data] of [
    ["PATCH", { caption: "Trop tard" }],
    ["DELETE", undefined],
  ] as const)
    expect((await call(project.worker.request, method, `/api/photos/${own.id}`, data)).status).toBe(
      403,
    );
  expect((await call(project.worker.request, "GET", `/api/photos/${own.id}`)).body.canEdit).toBe(
    false,
  );

  const page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByText("Projet archivé")).toBeVisible();
  await expect(
    page.getByText("On ne peut plus y ajouter de photos.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Prendre une photo|Ajouter des photos/ }),
  ).toHaveCount(0);

  // The office still adds and changes.
  const desk = await project.office.newPage();
  await desk.goto(`/projets/${project.id}/photos`);
  await expect(desk.locator("button[id^=photo-]")).toHaveCount(1);
  await expect(desk.getByText("Projet archivé")).toHaveCount(0);
  await pickPhoto(desk);
  await expect(desk.locator("button[id^=photo-]")).toHaveCount(2);
  expect(
    (await call(project.office.request, "PATCH", `/api/photos/${own.id}`, { caption: "Bureau" }))
      .status,
  ).toBe(200);
  await project.close();
});

// --- Without a network --------------------------------------------------------------

/** Counts the photos the server made from this context's requests. */
function countMade(context: BrowserContext) {
  const made = { count: 0 };
  context.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      /\/api\/projects\/[^/]+\/photos$/.test(new URL(response.url()).pathname) &&
      response.ok()
    )
      made.count++;
  });
  return made;
}

/** A photo taken without a network, described, and waiting on the device. */
async function takeOffline(page: Page, context: BrowserContext, caption: string) {
  // The screen was open (and its project known) before the signal went.
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
  await context.setOffline(true);
  await pickPhoto(page);
  await expect(page.getByRole("dialog", { name: "Photo ajoutée" })).toContainText("Pas de réseau");
  await page.getByRole("dialog").getByLabel("Description").fill(caption);
  await answer(page, "Photo ajoutée", "Terminé");
  await expect(page.getByText("1 photo en attente d'envoi")).toBeVisible();
  await expect(
    page.getByText("partira dès que le réseau reviendra", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Photo en attente d'envoi" })).toBeVisible();
}

const withCaption = async (context: BrowserContext, projectId: string, caption: string) =>
  (await photosOf(context, projectId)).filter((photo) => photo.caption === caption);

test("a photo taken without a network waits, outlives the app, and goes once when the network returns", async ({
  browser,
}) => {
  const project = await newProject(browser, "hors ligne");
  const made = countMade(project.worker);
  let page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByRole("heading", { name: "Aucune photo pour l'instant" })).toBeVisible();
  await takeOffline(page, project.worker, "Prise sans réseau");

  // Closed with the photo still waiting; nothing reached the server.
  await page.waitForTimeout(500);
  await page.close();
  expect(await withCaption(project.foreman, project.id, "Prise sans réseau")).toHaveLength(0);

  // Opened again on another screen, with the network back: it goes, once.
  await project.worker.setOffline(false);
  page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}`);
  await expect(page.getByText("La photo en attente a été envoyée.")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => withCaption(project.foreman, project.id, "Prise sans réseau"))
    .toHaveLength(1);
  const [sent] = await withCaption(project.foreman, project.id, "Prise sans réseau");
  expect(sent.authorName).toBe(seed.people.worker);

  // Coming back to the front, or the network flickering, sends nothing more.
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByRole("button", { name: "Prise sans réseau" })).toBeVisible();
  await expect(page.getByText("en attente d'envoi")).toHaveCount(0);
  await project.worker.setOffline(true);
  await project.worker.setOffline(false);
  await page.waitForTimeout(2000);
  expect(await withCaption(project.foreman, project.id, "Prise sans réseau")).toHaveLength(1);
  expect(made.count).toBe(1);
  await project.close();
});

test("a server error keeps the photo on the device until it goes, once", async ({ browser }) => {
  const project = await newProject(browser, "erreur");
  const made = countMade(project.worker);
  let failing = true;
  await project.worker.route(/\/api\/projects\/[^/]+\/photos$/, (route) =>
    failing && route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "server_error", message: "Une erreur est survenue. Réessayez." },
          }),
        })
      : route.continue(),
  );
  let page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await pickPhoto(page);
  await expect(page.getByText("1 photo en attente d'envoi")).toBeVisible();
  await expect(page.getByText("Une erreur est survenue. Réessayez.")).toBeVisible();

  // Still there after the app is closed and opened again.
  await page.close();
  page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByText("1 photo en attente d'envoi")).toBeVisible();
  expect(await photosOf(project.foreman, project.id)).toHaveLength(0);

  failing = false;
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByText("La photo en attente a été envoyée.")).toBeVisible();
  await expect(page.getByText("en attente d'envoi")).toHaveCount(0);
  expect(await photosOf(project.foreman, project.id)).toHaveLength(1);
  expect(made.count).toBe(1);
  await project.close();
});

test("a waiting photo is only ever sent as the person who took it", async ({ browser }) => {
  const project = await newProject(browser, "appareil partagé");
  const device = await contextAs(browser, "worker");
  let page = await device.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await takeOffline(page, device, "Prise par Marc");
  await page.close();

  // Someone else signs in on the same phone: the photo is neither shown nor sent.
  const sessionCookies = (role: Role) => JSON.parse(readFileSync(sessionOf(role), "utf8")).cookies;
  await device.clearCookies();
  await device.addCookies(sessionCookies("foreman"));
  await device.setOffline(false);
  page = await device.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect(page.getByRole("heading", { name: "Aucune photo pour l'instant" })).toBeVisible();
  await expect(page.getByText("en attente d'envoi")).toHaveCount(0);
  await page.waitForTimeout(3000);
  expect(await withCaption(project.foreman, project.id, "Prise par Marc")).toHaveLength(0);
  await page.close();

  // Back to its owner: it goes, as theirs.
  await device.clearCookies();
  await device.addCookies(sessionCookies("worker"));
  page = await device.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await expect
    .poll(() => withCaption(project.foreman, project.id, "Prise par Marc"))
    .toHaveLength(1);
  expect((await withCaption(project.foreman, project.id, "Prise par Marc"))[0].authorName).toBe(
    seed.people.worker,
  );
  await device.close();
  await project.close();
});

test("a photo the server refuses for good is kept on the device and no longer tried", async ({
  browser,
}) => {
  const project = await newProject(browser, "refusée");
  const page = await project.worker.newPage();
  await page.goto(`/projets/${project.id}/photos`);
  await takeOffline(page, project.worker, "Après l'archivage");
  await call(project.office.request, "PATCH", `/api/projects/${project.id}`, { status: "archive" });

  let tries = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/uploads") tries++;
  });
  await project.worker.setOffline(false);
  await expect(page.getByText("1 photo n'a pas été envoyée")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText("Ce projet est archivé. Elle reste sur cet appareil.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Photo non envoyée" })).toBeVisible();
  // The screen learns that the project is archived.
  await expect(page.getByText("Projet archivé")).toBeVisible();
  // Coming back to the app does not try again on its own.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(2000);
  expect(tries).toBe(1);

  await page.getByRole("button", { name: "Voir" }).click();
  await expect(page.getByRole("dialog", { name: "Photo non envoyée" })).toBeVisible();
  const saved = page.waitForEvent("download");
  await answer(page, "Photo non envoyée", "Enregistrer une copie");
  expect((await saved).suggestedFilename()).toMatch(/^photo-\d{4}-\d{2}-\d{2}-\w{6}\.jpg$/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Voir" }).click();
  await answer(page, "Photo non envoyée", "Retirer");
  await answer(page, "Retirer cette photo ?", "Retirer");
  await expect(page.getByText("Photo retirée.")).toBeVisible();
  await expect(page.getByText("n'a pas été envoyée")).toHaveCount(0);
  expect(await photosOf(project.office, project.id)).toHaveLength(0);
  await project.close();
});
