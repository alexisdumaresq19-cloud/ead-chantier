import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";

import { call, contextAs, post, seed } from "./support";

// The daily report, against the production build: a foreman writes the day
// on a phone, two saves meet, the people who may not see reports are turned
// away, an archived project stays read-only, and the day's photos come from
// the photos module. Each test works in projects of its own, made by the
// office, so the phone and desktop runs never meet.

type Report = { id: string; day: string; updatedAt: string; crew: { hours: number }[] };

/** The day at the site (the tests' browsers are on the site's clock too). */
const siteDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    Date.now() - daysAgo * 86_400_000,
  );

const reportOf = (day: string, workDone = "Excavation de la tranchée.") => ({
  day,
  weather: { condition: "nuageux", temperatureC: 4, note: "" },
  crew: [{ name: "Pavage Exemple inc.", hours: 8, userId: null }],
  equipment: "",
  workDone,
  notes: "",
});

const idOf = async (who: BrowserContext) => (await call(who.request, "GET", "/api/me")).body.id;

/** A project of the test's own, with these people on it. */
async function projectWith(office: BrowserContext, name: string, people: BrowserContext[]) {
  const run = test.info().project.name;
  const project = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai rapports, ${name} (${run})`,
  });
  const userIds = await Promise.all(people.map(idOf));
  if (userIds.length)
    await post(office.request, `/api/projects/${project.id}/members`, { userIds });
  return project.id;
}

/** Takes the seeded people off a test project, so their project lists stay as seeded. */
async function leave(office: BrowserContext, projectId: string, people: BrowserContext[]) {
  for (const id of await Promise.all(people.map(idOf)))
    await call(office.request, "DELETE", `/api/projects/${projectId}/members/${id}`);
}

/** A small photo sent the way the app sends one: announced, uploaded, then added. */
async function addPhoto(who: BrowserContext, projectId: string, takenAt?: string) {
  const image = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 40, g: 110, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  const ticket = await post<{ uploadId: string; target: { url: string; headers: object } }>(
    who.request,
    "/api/uploads",
    {
      projectId,
      kind: "photo",
      filename: "chantier.jpg",
      contentType: "image/jpeg",
      size: image.length,
    },
  );
  const sent = await who.request.fetch(new URL(ticket.target.url, seed.base).href, {
    method: "PUT",
    headers: ticket.target.headers as Record<string, string>,
    data: image,
  });
  expect(sent.ok()).toBe(true);
  await post(who.request, `/api/uploads/${ticket.uploadId}/complete`);
  return post<{ id: string; day: string }>(who.request, `/api/projects/${projectId}/photos`, {
    uploadId: ticket.uploadId,
    ...(takenAt ? { takenAt } : {}),
  });
}

/** A window opened by a tap ignores taps for a moment (against double taps). */
async function choose(page: Page, dialog: string, button: string) {
  const sheet = page.getByRole("dialog", { name: dialog });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(450);
  await sheet.getByRole("button", { name: button }).click();
}

test("the foreman writes today's report on the screen, and a day keeps one report", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const worker = await contextAs(browser, "worker");
  const projectId = await projectWith(office, "écrire", [foreman, worker]);
  const [foremanId, workerId] = await Promise.all([idOf(foreman), idOf(worker)]);
  // Yesterday's report, with the crew to take over.
  await post(foreman.request, `/api/projects/${projectId}/reports`, {
    ...reportOf(siteDay(1)),
    crew: [
      { name: seed.people.foreman, hours: 10, userId: foremanId },
      { name: seed.people.worker, hours: 10, userId: workerId },
    ],
  });

  const page = await foreman.newPage();
  await page.goto(`/projets/${projectId}/rapports`);
  await page.getByRole("link", { name: /Rapport d'aujourd'hui/ }).click();
  await expect(page.getByRole("heading", { name: "Nouveau rapport" })).toBeVisible();

  await page.getByRole("button", { name: "Neige" }).click();
  await page.getByLabel("Température").fill("12");
  await page.getByRole("button", { name: "Sous zéro" }).click();
  await page.getByRole("button", { name: "Reprendre l'équipe d'hier" }).click();
  await expect(page.getByLabel(`Heures de ${seed.people.worker}`)).toHaveValue("10");
  // Everyone's hours at once, typed with a comma; one person's own hours by hand.
  await page.getByLabel("Heures pour tous").fill("7,5");
  await page.getByLabel(`Heures de ${seed.people.worker}`).fill("6h15");
  await page.getByRole("button", { name: "Ajouter un nom" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Pavage Exemple inc.");
  await page.getByLabel("Travaux réalisés").fill("Pose de 24 m de conduite d'égout 300 mm.");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page).toHaveURL(new RegExp(`/rapports/(?!nouveau)[a-z0-9]+$`));
  await expect(page.getByText("Neige, −12 °C")).toBeVisible();
  await expect(page.getByText("3 personnes · 21,25 h").first()).toBeVisible();
  const reportId = page.url().split("/").at(-1) ?? "";
  const saved = (await call<Report>(foreman.request, "GET", `/api/reports/${reportId}`)).body;
  expect(saved.day).toBe(siteDay());
  expect(saved.crew.map((line) => line.hours)).toEqual([7.5, 6.25, 7.5]);

  // In the list, under today, and the big button now leads to that report.
  await page.getByRole("link", { name: "Rapports", exact: true }).first().click();
  await expect(page.getByRole("link", { name: /Pose de 24 m de conduite/ })).toBeVisible();
  await page.getByRole("link", { name: /Compléter le rapport d'aujourd'hui/ }).click();
  await expect(page.getByRole("heading", { name: "Modifier le rapport" })).toBeVisible();

  // A new report for a day that has one opens that one instead.
  await page.goto(`/projets/${projectId}/rapports/nouveau?jour=${siteDay()}`);
  await expect(page).toHaveURL(new RegExp(`/rapports/${reportId}/modifier$`));
  await page.getByLabel("Notes").fill("Visite de l'ingénieur.");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(new RegExp(`/rapports/${reportId}$`));
  await expect(page.getByText("Visite de l'ingénieur.")).toBeVisible();
  const all = (await call<Report[]>(foreman.request, "GET", `/api/projects/${projectId}/reports`))
    .body;
  expect(all.map((report) => report.day)).toEqual([siteDay(), siteDay(1)]);

  // The same day sent five times at once is still one report.
  const day = siteDay(3);
  const saves = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(foreman.request, "POST", `/api/projects/${projectId}/reports`, reportOf(day)),
    ),
  );
  expect(saves.map((save) => save.status)).toEqual([200, 200, 200, 200, 200]);
  expect(saves.filter((save) => save.body.created)).toHaveLength(1);

  // Moving a report onto a day that has one is refused, never a server error.
  const moved = await call(foreman.request, "PATCH", `/api/reports/${reportId}`, {
    day: siteDay(1),
    baseUpdatedAt: (await call<Report>(foreman.request, "GET", `/api/reports/${reportId}`)).body
      .updatedAt,
  });
  expect(moved.status).toBe(409);
  expect(moved.body.error).toEqual({
    code: "day_taken",
    message: "Un rapport existe déjà pour cette journée.",
  });

  // A day to come, an impossible hour count, a text past the limit.
  for (const [change, message] of [
    [{ day: "2999-01-01" }, /journée à venir/],
    [{ crew: [{ name: "Julie", hours: 7.3, userId: null }] }, /quart d'heure/],
    [{ notes: "x".repeat(10_001) }, /Texte trop long/],
  ] as const) {
    const refused = await call(foreman.request, "POST", `/api/projects/${projectId}/reports`, {
      ...reportOf(siteDay(5)),
      ...change,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(message);
  }

  await leave(office, projectId, [foreman, worker]);
  await Promise.all([office.close(), foreman.close(), worker.close()]);
});

test("a save over a version saved since is refused, and the foreman chooses", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const projectId = await projectWith(office, "conflit", [foreman]);
  const page = await foreman.newPage();
  await page.goto(`/projets/${projectId}/rapports`);
  await expect(page.getByText("Aucun rapport pour l'instant")).toBeVisible();

  // Someone writes today's report while the list is open: the form, opened
  // from the list as it was, leads to that report instead of a second one.
  const { report } = await post<{ report: Report }>(
    office.request,
    `/api/projects/${projectId}/reports`,
    reportOf(siteDay()),
  );
  await page.getByRole("link", { name: /^Rapport d'aujourd'hui/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rapports/${report.id}/modifier$`));
  await expect(page.getByLabel("Travaux réalisés")).toHaveValue("Excavation de la tranchée.");

  // The office saves in the meantime.
  const theirs = await call<Report>(office.request, "PATCH", `/api/reports/${report.id}`, {
    workDone: "Version du bureau.",
    baseUpdatedAt: report.updatedAt,
  });
  expect(theirs.status).toBe(200);

  // The API alone says why nothing was written.
  const stale = await call(foreman.request, "PATCH", `/api/reports/${report.id}`, {
    workDone: "Version du chantier.",
    baseUpdatedAt: report.updatedAt,
  });
  expect(stale.status).toBe(409);
  expect(stale.body.error.code).toBe("conflict");
  expect(stale.body.error.message).toBe(
    "Ce rapport a été modifié depuis que vous l'avez ouvert. Rien n'a été enregistré.",
  );

  await page.getByLabel("Travaux réalisés").fill("Version du chantier.");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const sheet = page.getByRole("dialog", { name: "Le rapport a changé" });
  await expect(sheet).toContainText("Rien n'a été remplacé.");
  await expect(sheet).toContainText("Version du bureau.");
  expect(
    (await call<{ workDone: string }>(foreman.request, "GET", `/api/reports/${report.id}`)).body
      .workDone,
  ).toBe("Version du bureau.");

  await choose(page, "Le rapport a changé", "Remplacer par ma version");
  await expect(page).toHaveURL(new RegExp(`/rapports/${report.id}$`));
  await expect(page.getByText("Version du chantier.")).toBeVisible();

  await leave(office, projectId, [foreman]);
  await Promise.all([office.close(), foreman.close()]);
});

test("a worker has no reports, and someone outside the project finds none", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const worker = await contextAs(browser, "worker");
  const projectId = await projectWith(office, "accès", [foreman, worker]);
  const { report } = await post<{ report: Report }>(
    foreman.request,
    `/api/projects/${projectId}/reports`,
    reportOf(siteDay()),
  );
  const routes = (id: string, reportId: string) =>
    [
      ["GET", `/api/projects/${id}/reports`],
      ["GET", `/api/projects/${id}/reports/day/${siteDay()}`],
      ["POST", `/api/projects/${id}/reports`, reportOf(siteDay(1))],
      ["GET", `/api/reports/${reportId}`],
      ["PATCH", `/api/reports/${reportId}`, { notes: "x", baseUpdatedAt: report.updatedAt }],
      ["DELETE", `/api/reports/${reportId}`],
    ] as const;

  // The worker, on the project: refused everywhere, and no tab leads there.
  for (const [method, path, data] of routes(projectId, report.id))
    expect((await call(worker.request, method, path, data)).status, `${method} ${path}`).toBe(403);
  const page = await worker.newPage();
  await page.goto(`/projets/${projectId}`);
  await expect(page.getByRole("link", { name: "Plans", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Rapports", exact: true })).toHaveCount(0);
  for (const path of ["rapports", "rapports/nouveau", `rapports/${report.id}`]) {
    await page.goto(`/projets/${projectId}/${path}`);
    await expect(page.getByText("réservés aux contremaîtres et au bureau")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  }

  // A foreman outside the project: as if nothing were there, even by the report's id.
  const elsewhere = await projectWith(office, "ailleurs", []);
  const { report: hidden } = await post<{ report: Report }>(
    office.request,
    `/api/projects/${elsewhere}/reports`,
    reportOf(siteDay()),
  );
  for (const [method, path, data] of routes(elsewhere, hidden.id))
    expect((await call(foreman.request, method, path, data)).status, `${method} ${path}`).toBe(404);
  const outside = await foreman.newPage();
  await outside.goto(`/projets/${elsewhere}/rapports/${hidden.id}`);
  await expect(outside.getByRole("heading", { name: "Projet introuvable" })).toBeVisible();
  // Its report, reached through a project the foreman is on, is still not found.
  await outside.goto(`/projets/${projectId}/rapports/${hidden.id}`);
  await expect(outside.getByRole("heading", { name: "Rapport introuvable" })).toBeVisible();
  // The office sees both projects: still, a report shows only under its own.
  const desk = await office.newPage();
  await desk.goto(`/projets/${projectId}/rapports/${hidden.id}`);
  await expect(desk.getByRole("heading", { name: "Rapport introuvable" })).toBeVisible();
  await desk.goto(`/projets/${projectId}/rapports/${hidden.id}/modifier`);
  await expect(desk.getByRole("heading", { name: "Rapport introuvable" })).toBeVisible();
  await desk.goto(`/projets/${elsewhere}/rapports/${hidden.id}`);
  await expect(desk.getByText("Excavation de la tranchée.")).toBeVisible();

  await leave(office, projectId, [foreman, worker]);
  await Promise.all([office.close(), foreman.close(), worker.close()]);
});

test("an archived project's reports are read, not changed, except by the office", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const projectId = await projectWith(office, "archivé", [foreman]);
  const { report } = await post<{ report: Report }>(
    foreman.request,
    `/api/projects/${projectId}/reports`,
    reportOf(siteDay()),
  );
  const archived = await call(office.request, "PATCH", `/api/projects/${projectId}`, {
    status: "archive",
  });
  expect(archived.status).toBe(200);

  const change = { notes: "Trop tard.", baseUpdatedAt: report.updatedAt };
  for (const [method, path, data] of [
    ["POST", `/api/projects/${projectId}/reports`, reportOf(siteDay(1))],
    ["PATCH", `/api/reports/${report.id}`, change],
    ["DELETE", `/api/reports/${report.id}`],
  ] as const) {
    const refused = await call(foreman.request, method, path, data);
    expect(refused.status, `${method} ${path}`).toBe(403);
    expect(refused.body.error.message).toBe("Ce projet est archivé.");
  }
  expect((await call(foreman.request, "GET", `/api/reports/${report.id}`)).status).toBe(200);
  expect((await call(foreman.request, "GET", `/api/projects/${projectId}/reports`)).status).toBe(
    200,
  );

  const page = await foreman.newPage();
  await page.goto(`/projets/${projectId}/rapports`);
  await expect(page.getByText("Projet archivé")).toBeVisible();
  await expect(page.getByRole("link", { name: /Rapport d'aujourd'hui/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Excavation de la tranchée/ }).click();
  await expect(page.getByRole("heading", { name: "Rapport journalier" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Modifier" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Supprimer le rapport" })).toHaveCount(0);
  for (const path of ["nouveau", `${report.id}/modifier`]) {
    await page.goto(`/projets/${projectId}/rapports/${path}`);
    await expect(
      page.getByRole("heading", { name: "Les rapports ne se modifient plus" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  }

  // The office still corrects it, on the screen too.
  expect((await call(office.request, "PATCH", `/api/reports/${report.id}`, change)).status).toBe(
    200,
  );
  const desk = await office.newPage();
  await desk.goto(`/projets/${projectId}/rapports/${report.id}`);
  await expect(desk.getByRole("link", { name: "Modifier" })).toBeVisible();

  await leave(office, projectId, [foreman]);
  await Promise.all([office.close(), foreman.close()]);
});

test("the reading screen shows the photos of the site's day, and prints clean", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const projectId = await projectWith(office, "photos", [foreman]);
  const today = siteDay();
  const yesterday = siteDay(1);
  const { report } = await post<{ report: Report }>(
    foreman.request,
    `/api/projects/${projectId}/reports`,
    reportOf(today, "Coffrage du regard R-5."),
  );
  const { report: before } = await post<{ report: Report }>(
    foreman.request,
    `/api/projects/${projectId}/reports`,
    reportOf(yesterday, "Excavation du regard R-5."),
  );
  // Late last evening at the site: already today in UTC, still yesterday at the site.
  const late = await addPhoto(foreman, projectId, `${yesterday}T23:40:00-05:00`);
  expect(late.day).toBe(yesterday);
  const now = await addPhoto(foreman, projectId);
  expect(now.day).toBe(today);

  const page = await foreman.newPage();
  await page.goto(`/projets/${projectId}/rapports/${report.id}`);
  const photos = page.getByRole("region", { name: "Photos du jour" });
  await expect(page.getByText("Coffrage du regard R-5.")).toBeVisible();
  await expect(photos.getByRole("listitem")).toHaveCount(1);
  await expect(photos.getByRole("link", { name: "Voir la galerie" })).toHaveAttribute(
    "href",
    `/projets/${projectId}/photos/jour/${today}`,
  );
  await photos.getByRole("button", { name: /Photo prise à/ }).click();
  const large = page.getByRole("dialog", { name: "Photo du jour" }).locator("img");
  await expect(large).toBeVisible();
  await expect.poll(() => large.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
  await page.keyboard.press("Escape");

  await page.goto(`/projets/${projectId}/rapports/${before.id}`);
  await expect(page.getByText("Excavation du regard R-5.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Photos du jour" }).getByRole("listitem"),
  ).toHaveCount(1);

  // On paper: the company's name as text, none of the app's frame or buttons.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Les Entreprises Allen Dumaresq")).toBeVisible();
  // The app's black backdrop would edge every sheet printed with backgrounds.
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe("rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "Imprimer" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Rapports", exact: true })).toHaveCount(0);
  await page.emulateMedia({ media: "screen" });

  // The photos failing to come leaves the report whole (a device that holds none yet).
  const device = await contextAs(browser, "foreman");
  const fresh = await device.newPage();
  await fresh.route(/\/api\/projects\/[^/]+\/photos\?/, (route) => route.abort());
  await fresh.goto(`/projets/${projectId}/rapports/${report.id}`);
  await expect(fresh.getByText("Coffrage du regard R-5.")).toBeVisible();
  await expect(fresh.getByRole("link", { name: "Modifier" })).toBeVisible();
  await expect(fresh.getByRole("region", { name: "Photos du jour" })).toHaveCount(0);
  await expect(fresh.getByText("Impossible d'afficher")).toHaveCount(0);

  await leave(office, projectId, [foreman]);
  await Promise.all([office.close(), foreman.close(), device.close()]);
});

test("without a network the report stays on the device and says it is not saved", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const projectId = await projectWith(office, "sans réseau", [foreman]);
  const day = siteDay(2);
  const page = await foreman.newPage();
  await page.goto(`/projets/${projectId}/rapports/nouveau?jour=${day}`);
  await expect(page.getByRole("heading", { name: "Nouveau rapport" })).toBeVisible();
  await page.getByRole("button", { name: "Pluie" }).click();
  await page.getByLabel("Travaux réalisés").fill("Pompage de la tranchée inondée.");
  await expect(page.getByText("Pas encore enregistré.")).toBeVisible();

  await foreman.setOffline(true);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(
    page.getByText("le rapport n'est pas enregistré. Il est gardé sur cet appareil."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/nouveau\?jour=/);
  const kept = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("ead:rapport:")),
  );
  expect(kept).toHaveLength(1);
  expect((await call(office.request, "GET", `/api/projects/${projectId}/reports`)).body).toEqual(
    [],
  );

  // The text survives the page being closed and opened again.
  await foreman.setOffline(false);
  await page.reload();
  await expect(page.getByLabel("Travaux réalisés")).toHaveValue("Pompage de la tranchée inondée.");
  await expect(page.getByText(/Brouillon écrit .*, repris\./)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/rapports\/[a-z0-9]+$/);
  await expect(page.getByText("Pompage de la tranchée inondée.")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("ead:rapport:")),
    ),
  ).toEqual([]);

  await leave(office, projectId, [foreman]);
  await Promise.all([office.close(), foreman.close()]);
});
